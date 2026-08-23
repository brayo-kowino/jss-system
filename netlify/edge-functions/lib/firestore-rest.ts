// ==========================================================================
// Shared Firestore REST + Google service-account auth helpers.
// ==========================================================================
// Factored out of the pattern netlify/edge-functions/results-lookup.ts
// proved out first (self-signed JWT -> OAuth2 access token -> raw Firestore
// REST calls, entirely inside the Deno edge runtime, no Admin SDK). Used by
// subscription-issue.ts and subscription-activate.ts so both privileged
// writes to schools/{id} and subscription_tokens/{id} go through the same,
// once-reviewed code path. media-upload.ts imports verifyFirebaseIdToken()
// from here too, rather than keeping its own copy, so there's exactly one
// implementation of ID token verification to keep correct (see that
// function's own comment for why it no longer calls Identity Toolkit).
// results-lookup.ts doesn't verify user tokens at all - it's a public
// lookup endpoint - so it's untouched.
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

// --------------------------------------------------------------------------
// Firebase ID token verification - local JWT check, no Identity Toolkit call.
// --------------------------------------------------------------------------
// This used to ask Firebase itself via identitytoolkit.googleapis.com's
// accounts:lookup REST endpoint. That works right up until App Check
// enforcement is turned on for the Identity Toolkit API in the Firebase
// console (Console -> App Check -> APIs) - at that point Google starts
// rejecting accounts:lookup calls that don't carry an X-Firebase-AppCheck
// header, which this edge function has no way to attach (App Check tokens
// are minted client-side, per browser/app instance). Every caller then
// looks "not signed in" no matter how valid their session actually is.
//
// This verifies the ID token's RS256 signature ourselves instead, against
// Google's own rotating public keys - exactly what the Admin SDK does
// under the hood. It's one HTTP call to a public, unauthenticated Google
// metadata endpoint (not an app-facing Identity Toolkit API call, so App
// Check enforcement on that API has no effect on it), then pure crypto
// after that. Keys are cached in-memory for the response's declared
// max-age so a hot edge function isn't re-fetching them on every request.
const GOOGLE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwkCache: { keys: Record<string, CryptoKey>; expiresAt: number } | null = null;

async function fetchGoogleSigningKeys(): Promise<Record<string, CryptoKey>> {
  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google signing keys: ${res.status}`);
  const { keys: jwks } = await res.json();
  const keys: Record<string, CryptoKey> = {};
  for (const jwk of jwks) {
    keys[jwk.kid] = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  const maxAgeMatch = (res.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600_000; // Google sends one; 1h fallback
  jwkCache = { keys, expiresAt: Date.now() + maxAgeMs };
  return keys;
}

async function getGoogleSigningKey(kid: string): Promise<CryptoKey | null> {
  if (jwkCache && jwkCache.expiresAt > Date.now() && jwkCache.keys[kid]) {
    return jwkCache.keys[kid];
  }
  // Cache miss or unknown kid (keys rotate) - (re)fetch once before giving up.
  const keys = await fetchGoogleSigningKeys();
  return keys[kid] || null;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function decodeJwtJson(b64url: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

// Returns the uid the token belongs to, or null if it's missing, malformed,
// expired, wrong-project, or fails signature verification - the subscription
// endpoints need the caller's uid to look up their role/schoolId from their
// own users/{uid} doc, not just proof that *someone* is signed in.
export async function verifyFirebaseIdToken(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: any, payload: any;
  try {
    header = decodeJwtJson(headerB64);
    payload = decodeJwtJson(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SECS = 300; // tolerate a few minutes of drift, same as Admin SDK
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (payload.aud !== PROJECT_ID) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now - CLOCK_SKEW_SECS) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECS) return null;
  if (typeof payload.auth_time !== "number" || payload.auth_time > now + CLOCK_SKEW_SECS) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;

  try {
    const key = await getGoogleSigningKey(header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return payload.sub;
}

// Same verification as verifyFirebaseIdToken(), but also returns auth_time
// (epoch seconds of the underlying sign-in/reauth, not just "was this
// session ever authenticated"). device-register.ts uses this to require a
// genuinely recent password entry rather than trusting an old, merely
// still-valid session - see that file for why that distinction matters.
export async function verifyFirebaseIdTokenWithAuthTime(idToken: string): Promise<{ uid: string; authTime: number } | null> {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: any, payload: any;
  try {
    header = decodeJwtJson(headerB64);
    payload = decodeJwtJson(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SECS = 300;
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (payload.aud !== PROJECT_ID) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now - CLOCK_SKEW_SECS) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECS) return null;
  if (typeof payload.auth_time !== "number" || payload.auth_time > now + CLOCK_SKEW_SECS) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;

  try {
    const key = await getGoogleSigningKey(header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return { uid: payload.sub, authTime: payload.auth_time };
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

// Lists all documents directly under a subcollection path (e.g.
// "users/abc123/trusted_devices"). Uses the plain documents.list REST
// endpoint rather than runQuery, since runFsQuery above always queries
// against the database root and can't address a path nested under a
// specific parent document.
export async function listFsDocs(token: string, path: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FIRESTORE_BASE}/${path}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`Firestore list failed: ${res.status}`);
    const data = await res.json();
    for (const doc of data.documents || []) out.push(fsDocToObject(doc));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
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
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // netlify.toml's [[headers]] block (CSP, X-Frame-Options, nosniff,
      // etc.) only applies to responses that pass through Netlify's static
      // file layer - confirmed live that a pure edge-function JSON response
      // like this one doesn't inherit it. X-Frame-Options/CSP are moot on
      // application/json (nothing to frame or execute), but nosniff costs
      // nothing and closes the one header here that's still meaningful on
      // a non-HTML response, without depending on platform header
      // inheritance behavior this file can't control.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
