// ==========================================================================
// Shared Firestore REST + Google service-account auth helpers.
// ==========================================================================
// Factored out of the pattern netlify/edge-functions/results-lookup.ts
// proved out first (self-signed JWT -> OAuth2 access token -> raw Firestore
// REST calls, entirely inside the Deno edge runtime, no Admin SDK). Used by
// subscription-issue.ts and subscription-activate.ts so both privileged
// writes to schools/{id} and subscription_tokens/{id} go through the same,
// once-reviewed code path. results-lookup.ts and media-upload.ts are left
// with their own copies rather than migrated onto this - not touching
// already-working code for a pure refactor.
//
// REQUIRED SETUP (Netlify Console -> Site configuration -> Environment
// variables - secrets, never commit them):
//   GOOGLE_SERVICE_ACCOUNT_KEY - same var results-lookup.ts already
//                                documents; the full service-account JSON
//                                key. If that's already set for this site,
//                                nothing new to add here.
// ==========================================================================

const PROJECT_ID = "jss-management-system";
export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Same public Web API key already shipped in js/firebase-config.js and
// duplicated in media-upload.ts/results-lookup.ts for the same reason:
// this runs in a separate Deno edge runtime, not bundled with the app's JS.
const FIREBASE_API_KEY = "AIzaSyCURCEhuxdsfVNqBLdHTLfzZ8mYn_yQsVQ";

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

export async function getAccessToken(): Promise<string> {
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

// Confirms the caller's Firebase ID token is live and currently valid by
// asking Firebase itself (same reasoning as media-upload.ts's version),
// and returns the uid it belongs to - the subscription endpoints need the
// caller's uid to look up their role/schoolId from their own users/{uid}
// doc, not just proof that *someone* is signed in.
export async function verifyFirebaseIdToken(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const uid = data.users?.[0]?.localId;
    return typeof uid === "string" && uid ? uid : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Minimal Firestore REST helpers.
// --------------------------------------------------------------------------

export function fsDecode(value: any): any {
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

export function fsEncode(value: any): any {
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

export async function getFsDoc(token: string, path: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  return fsDocToObject(await res.json());
}

// Creates (or fully overwrites) a doc with exactly the given fields - only
// safe to use when every field the doc should ever hold is being passed in
// (e.g. creating a brand-new subscription_tokens/{jti} record). Never use
// this against an existing doc that has other fields worth keeping - it has
// no updateMask, so Firestore replaces the whole document.
export async function putFsDoc(token: string, path: string, fields: Record<string, any>): Promise<void> {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore write failed: ${res.status}`);
}

// True partial update - only the named fields change, every other field on
// the doc (all the settings/branding data on schools/{id}, for example)
// is left untouched. This is what schools/{id} and existing
// subscription_tokens/{jti} docs must always be updated with.
export async function patchFsDoc(token: string, path: string, fields: Record<string, any>): Promise<void> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${path}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore update failed: ${res.status}`);
}

export async function addFsDoc(token: string, collectionId: string, fields: Record<string, any>): Promise<void> {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${collectionId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore create failed: ${res.status}`);
}

export async function runFsQuery(
  token: string,
  collectionId: string,
  filters: Array<[string, string, any]>,
): Promise<Record<string, any>[]> {
  const structuredQuery: any = { from: [{ collectionId }], limit: 1000 };
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

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
