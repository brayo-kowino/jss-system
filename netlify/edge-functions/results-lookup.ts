// ==========================================================================
// Public results lookup — server-side proxy, same shape as media-upload.ts.
// ==========================================================================
// Lets a parent/student check results with just an admission number + date
// of birth, WITHOUT creating a Firebase Auth account for every parent and
// WITHOUT loosening firestore.rules at all. firestore.rules stays exactly
// as locked-down as it is today — this function never uses the browser's
// Firebase session; it authenticates to Firestore itself with a Google
// service-account credential (Admin-level access that bypasses security
// rules by design, same as the Firebase Admin SDK would from a real
// backend). The browser only ever talks to THIS endpoint, never to
// Firestore directly, and only ever gets back a curated subset of one
// result doc — never the raw `students` doc (address, phone, medical info,
// parent IDs, KCPE number all stay server-side).
//
// WHY NOT A FIRESTORE RULE INSTEAD:
//   A rule keyed on "admissionNumber == input" is enumerable (admission
//   numbers are sequential and printed on ID cards/receipts) and can only
//   grant/deny access to a whole document — it can't hand back a redacted
//   subset of fields, and it can't rate-limit or lock out repeated guesses.
//   All three of those live here instead.
//
// REQUIRED SETUP (Netlify Console → Site configuration → Environment
// variables — secrets, never commit them):
//   GOOGLE_SERVICE_ACCOUNT_KEY  - the full JSON key for a service account
//                                 with Cloud Datastore User (or Firestore
//                                 User) role on the jss-management-system
//                                 project. Firebase Console → Project
//                                 Settings → Service Accounts → Generate
//                                 new private key. Paste the ENTIRE JSON
//                                 file contents as this one env var's value.
//                                 Treat it like a root password — it can
//                                 read/write every collection, bypassing
//                                 every rule in firestore.rules.
//   TURNSTILE_SECRET_KEY       - Cloudflare Turnstile secret key (from the
//                                 Turnstile dashboard). If unset, captcha
//                                 verification is skipped with a console
//                                 warning — fine for local dev, do NOT ship
//                                 to production without this set.
// A new deploy is needed after setting these (env vars are snapshotted at
// deploy time), same as every other edge function in this project.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";

const PROJECT_ID = "jss-management-system";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // See lib/firestore-rest.ts's jsonResponse() for why this is set
      // here directly rather than relied on from netlify.toml.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// --------------------------------------------------------------------------
// Google service-account auth (self-signed JWT -> OAuth2 access token).
// Cached at module scope so a warm edge invocation reuses a still-valid
// token instead of re-signing/re-exchanging on every request.
// --------------------------------------------------------------------------

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const rawKey = Netlify.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const serviceAccount = JSON.parse(rawKey) as { client_email: string; private_key: string };

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const unsigned =
    base64UrlEncode(enc.encode(JSON.stringify(header))) + "." + base64UrlEncode(enc.encode(JSON.stringify(claims)));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

// --------------------------------------------------------------------------
// Minimal Firestore REST helpers - just enough for this endpoint's needs.
// --------------------------------------------------------------------------

// Firestore REST wraps every value as { stringValue: "x" } / { integerValue:
// "3" } / etc. fsDecode() unwraps that back into a plain JS value/object.
function fsDecode(value: any): any {
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fsDecode);
  if ("mapValue" in value) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fsDecode(v);
    return out;
  }
  return null;
}

function fsEncode(value: any): any {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value == null) return { nullValue: null };
  return { stringValue: String(value) };
}

function fsDocToObject(doc: any): Record<string, any> {
  const out: Record<string, any> = { id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fsDecode(v);
  return out;
}

async function runQuery(token: string, collectionId: string, filters: Array<[string, string, any]>) {
  const structuredQuery: any = {
    from: [{ collectionId }],
    limit: 50,
  };
  if (filters.length === 1) {
    const [field, op, value] = filters[0];
    structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op, value: fsEncode(value) } };
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: "AND",
        filters: filters.map(([field, op, value]) => ({
          fieldFilter: { field: { fieldPath: field }, op, value: fsEncode(value) },
        })),
      },
    };
  }
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const rows = await res.json();
  return rows.filter((r: any) => r.document).map((r: any) => fsDocToObject(r.document));
}

async function getDoc(token: string, path: string) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  return fsDocToObject(await res.json());
}

async function setDoc(token: string, path: string, fields: Record<string, any>) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  await fetch(`${FIRESTORE_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function addDoc(token: string, collectionId: string, fields: Record<string, any>) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  await fetch(`${FIRESTORE_BASE}/${collectionId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --------------------------------------------------------------------------
// Turnstile captcha verification.
// --------------------------------------------------------------------------

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = Netlify.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    console.warn("results-lookup: TURNSTILE_SECRET_KEY not set - skipping captcha check (dev only)");
    return true;
  }
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Input validation - narrow, conservative character sets. Admission
// numbers in this app look like "JSS/2024/001"; dob comes from an
// <input type="date"> so it's always YYYY-MM-DD.
// --------------------------------------------------------------------------

// Must match js/services/academic.service.js's slugify() exactly - it's
// used there to build the deterministic result_releases doc ID
// (schoolId__academicYear_term_grade_reportMode via scopedId()), and this
// function has to reconstruct the same ID to look that doc up.
function slugify(text: unknown): string {
  return String(text).trim().replace(/\s+/g, "_");
}

function cleanSlug(raw: unknown): string {
  return String(raw || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}
function cleanAdmissionNumber(raw: unknown): string {
  return String(raw || "").trim().replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 40);
}
function isValidDob(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

// Attempt-lockout key must be filesystem/URL safe - collapse anything but
// alnum/underscore/hyphen so a crafted admission number can't smuggle a
// path segment into the Firestore REST path.
function attemptDocId(schoolId: string, admissionNumber: string): string {
  return `${schoolId}_${admissionNumber}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
}

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const slug = cleanSlug(body.slug);
  const admissionNumber = cleanAdmissionNumber(body.admissionNumber);
  const dob = body.dob;
  const captchaToken = String(body.captchaToken || "");

  if (!slug || !admissionNumber || !isValidDob(dob)) {
    return jsonResponse({ error: "Please provide your school, admission number, and date of birth." }, 400);
  }

  const ip = context.ip || request.headers.get("x-nf-client-connection-ip");
  if (!(await verifyTurnstile(captchaToken, ip))) {
    return jsonResponse({ error: "Captcha verification failed. Please try again." }, 400);
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error("results-lookup: service account auth failed", err);
    return jsonResponse({ error: "Results lookup is temporarily unavailable." }, 500);
  }

  // 1. Resolve the school - school_public/{slug} is the same doc the login
  //    screen already reads, so this stays consistent with what's public.
  const schoolPublic = await getDoc(token, `school_public/${slug}`);
  if (!schoolPublic || schoolPublic.status !== "active") {
    return jsonResponse({ error: "School not found." }, 404);
  }
  const schoolId = schoolPublic.schoolId;

  // 2. Lockout check, keyed per school+admission number (not per IP - an
  //    attacker rotating IPs shouldn't get more guesses at the same child's
  //    record; a legitimate family on a shared IP shouldn't get fewer).
  const lockKey = attemptDocId(schoolId, admissionNumber);
  const lockDoc = await getDoc(token, `lookup_attempts/${lockKey}`);
  if (lockDoc?.lockedUntil && new Date(lockDoc.lockedUntil).getTime() > Date.now()) {
    return jsonResponse({ error: "Too many attempts. Please try again later." }, 429);
  }

  async function recordAttempt(success: boolean) {
    await addDoc(token, "audit_logs", {
      schoolId,
      userId: "public_results_portal",
      action: success ? "public_results_lookup_success" : "public_results_lookup_failed",
      entity: "students",
      entityId: admissionNumber,
      timestamp: new Date(),
    });
    if (success) {
      await setDoc(token, `lookup_attempts/${lockKey}`, { count: 0, lockedUntil: null, updatedAt: new Date() });
    } else {
      const nextCount = (lockDoc?.count || 0) + 1;
      const lockedUntil =
        nextCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
      await setDoc(token, `lookup_attempts/${lockKey}`, { count: nextCount, lockedUntil, updatedAt: new Date() });
    }
  }

  // 3. Find the student and check both factors. Same generic error message
  //    whether the admission number doesn't exist or the DOB doesn't match
  //    - never reveal which half was wrong.
  let students: Record<string, any>[];
  try {
    students = await runQuery(token, "students", [
      ["schoolId", "EQUAL", schoolId],
      ["admissionNumber", "EQUAL", admissionNumber],
    ]);
  } catch (err) {
    console.error("results-lookup: student query failed", err);
    return jsonResponse({ error: "Results lookup is temporarily unavailable." }, 500);
  }

  const student = students.find((s) => s.dob === dob && s.status !== "archived");
  if (!student) {
    await recordAttempt(false);
    return jsonResponse({ error: "No record found for that admission number and date of birth." }, 404);
  }

  // 4. Pull that student's saved results, pick the most recent by
  //    computedAt. Curated fields only - never the raw student doc.
  let results: Record<string, any>[];
  try {
    results = await runQuery(token, "results", [
      ["schoolId", "EQUAL", schoolId],
      ["studentId", "EQUAL", student.id],
    ]);
  } catch (err) {
    console.error("results-lookup: results query failed", err);
    return jsonResponse({ error: "Results lookup is temporarily unavailable." }, 500);
  }

  await recordAttempt(true);

  if (!results.length) {
    return jsonResponse({
      student: { fullName: student.fullName, grade: student.grade, stream: student.stream },
      results: null,
      message: "No results have been released for this term yet. Please check back later or contact the school.",
    }, 200);
  }

  // 5. Release gate - and ONLY the release gate decides what a parent can
  //    see. A student can have several saved result docs (Midterm,
  //    Endterm, Average, across terms); which one is "current" is not
  //    "whichever was computed most recently" - it's whichever the admin
  //    has actually released via the Release Results screen. So every
  //    saved result gets checked against its own result_releases doc
  //    first, and only the ones that are published (and not expired) are
  //    even eligible to be shown.
  const withRelease = await Promise.all(
    results.map(async (r) => {
      // Matches scopedId(schoolId, ...parts) in js/utils.js exactly: every
      // part - including schoolId - joined with "__".
      const releaseKey = [
        schoolId,
        slugify(r.academicYear),
        slugify(r.term),
        slugify(r.grade),
        slugify(r.reportMode || "average"),
      ].join("__");
      const release = await getDoc(token, `result_releases/${releaseKey}`);
      return { result: r, release };
    }),
  );

  const isActive = (entry: any) =>
    entry.release?.published && !(entry.release.expiresAt && new Date(entry.release.expiresAt).getTime() < Date.now());
  const wasReleasedButExpired = (entry: any) =>
    entry.release?.published && entry.release.expiresAt && new Date(entry.release.expiresAt).getTime() < Date.now();

  const active = withRelease.filter(isActive).sort(
    (a, b) => new Date(b.result.computedAt || 0).getTime() - new Date(a.result.computedAt || 0).getTime(),
  );

  if (!active.length) {
    const expired = withRelease.filter(wasReleasedButExpired).sort(
      (a, b) => new Date(b.result.computedAt || 0).getTime() - new Date(a.result.computedAt || 0).getTime(),
    );
    return jsonResponse({
      student: { fullName: student.fullName, grade: student.grade, stream: student.stream },
      results: null,
      message: expired.length
        ? "Access to these results has expired. Please contact the school administrator."
        : "No results have been released for this term yet. Please check back later or contact the school.",
    }, 200);
  }

  const latest = active[0].result;

  return jsonResponse({
    student: { fullName: latest.fullName, grade: latest.grade, stream: latest.stream },
    results: {
      academicYear: latest.academicYear,
      term: latest.term,
      reportMode: latest.reportMode,
      subjects: (latest.subjects || []).map((s: any) => ({
        code: s.code, name: s.name, average: s.average, grade: s.grade, points: s.points, remark: s.remark,
      })),
      totalMarks: latest.totalMarks,
      totalOutOf: latest.totalOutOf,
      meanMarks: latest.meanMarks,
      meanGrade: latest.meanGrade,
      meanPoints: latest.meanPoints,
      overallPosition: latest.overallPosition,
      classPosition: latest.classPosition,
      classSize: latest.classSize,
      teacherRemark: latest.teacherRemark || "",
      principalRemark: latest.principalRemark || "",
    },
  }, 200);
};

export const config = {
  path: "/results-lookup",
  // Tighter than media-upload's 20/min since this endpoint is guessable-
  // input surface, not just abuse-of-a-feature surface. The per-admission-
  // number lockout above is the real defense; this is a blunt backstop
  // against one IP hammering many different admission numbers.
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
