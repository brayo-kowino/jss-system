import { webcrypto } from "node:crypto";

const PROJECT_ID = "jss-management-system";
const GOOGLE_JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwkCache = null;
let jwkExpiry = 0;

function base64UrlToBytes(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJwtJson(segment) {
  let b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return JSON.parse(atob(b64));
}

async function getGoogleSigningKey(kid) {
  const now = Date.now();
  if (jwkCache && now < jwkExpiry && jwkCache[kid]) {
    return jwkCache[kid];
  }
  try {
    const res = await fetch(GOOGLE_JWK_URL);
    if (!res.ok) {
      console.error(`Firebase ID-token key fetch failed: ${res.status}`);
      return null;
    }
    const { keys } = await res.json();
    const imported = {};
    for (const jwk of keys || []) {
      if (!jwk.kid) continue;
      imported[jwk.kid] = await webcrypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
    const cacheControl = res.headers.get("cache-control") || "";
    const match = cacheControl.match(/max-age=(\d+)/);
    const maxAgeSecs = match ? parseInt(match[1], 10) : 3600;
    jwkCache = imported;
    jwkExpiry = now + maxAgeSecs * 1000;
    return imported[kid] || null;
  } catch (err) {
    console.error("Failed to fetch or import Google signing keys:", err);
    return null;
  }
}

/**
 * Verifies a Firebase ID token using Google's public JWK signing keys.
 * Returns the decoded token payload or null if invalid/expired.
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    console.warn("Firebase ID token rejected: malformed token");
    return null;
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = decodeJwtJson(headerB64);
    payload = decodeJwtJson(payloadB64);
  } catch {
    console.warn("Firebase ID token rejected: malformed JWT JSON");
    return null;
  }

  if (header.alg !== "RS256" || !header.kid) {
    console.warn("Firebase ID token rejected: unsupported JWT header");
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const SKEW = 300;
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) {
    console.warn(`Firebase ID token rejected: wrong issuer (${payload.iss || "missing"})`);
    return null;
  }
  if (payload.aud !== PROJECT_ID) {
    console.warn(`Firebase ID token rejected: wrong audience (${payload.aud || "missing"})`);
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= now - SKEW) {
    console.warn("Firebase ID token rejected: expired");
    return null;
  }
  if (typeof payload.iat !== "number" || payload.iat > now + SKEW) {
    console.warn("Firebase ID token rejected: invalid issued-at time");
    return null;
  }
  if (!payload.sub) {
    console.warn("Firebase ID token rejected: missing subject");
    return null;
  }

  try {
    const cryptoKey = await getGoogleSigningKey(header.kid);
    if (!cryptoKey) {
      console.warn(`Firebase ID token rejected: signing key not found (${header.kid})`);
      return null;
    }

    const valid = await webcrypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );

    if (!valid) console.warn("Firebase ID token rejected: invalid RSA signature");
    return valid ? payload : null;
  } catch (err) {
    console.error("Token signature verification failed:", err);
    return null;
  }
}
