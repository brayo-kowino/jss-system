import { webcrypto } from "node:crypto";

const PROJECT_ID = "jss-management-system";
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedCerts = null;
let certsExpiry = 0;

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

function pemToDer(pem) {
  const clean = pem.replace(/-----BEGIN CERTIFICATE-----/, "").replace(/-----END CERTIFICATE-----/, "").replace(/\s+/g, "");
  return base64UrlToBytes(clean).buffer;
}

async function getGooglePublicCerts() {
  const now = Date.now();
  if (cachedCerts && now < certsExpiry) {
    return cachedCerts;
  }
  try {
    const res = await fetch(CERTS_URL);
    if (!res.ok) return null;
    const cacheControl = res.headers.get("cache-control") || "";
    const match = cacheControl.match(/max-age=(\d+)/);
    const maxAgeSecs = match ? parseInt(match[1], 10) : 3600;
    certsExpiry = now + maxAgeSecs * 1000;
    cachedCerts = await res.json();
    return cachedCerts;
  } catch (err) {
    console.error("Failed to fetch Google public certs:", err);
    return null;
  }
}

/**
 * Verifies a Firebase ID token using Google's public x509 certs.
 * Returns the decoded token payload or null if invalid/expired.
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = decodeJwtJson(headerB64);
    payload = decodeJwtJson(payloadB64);
  } catch {
    return null;
  }

  if (header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  const SKEW = 300;
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (payload.aud !== PROJECT_ID) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now - SKEW) return null;
  if (typeof payload.iat !== "number" || payload.iat > now + SKEW) return null;
  if (!payload.sub) return null;

  try {
    const certs = await getGooglePublicCerts();
    if (!certs || !certs[header.kid]) return null;

    const certPem = certs[header.kid];
    const der = pemToDer(certPem);
    const cryptoKey = await webcrypto.subtle.importKey(
      "spki",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await webcrypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );

    return valid ? payload : null;
  } catch (err) {
    console.error("Token signature verification failed:", err);
    return null;
  }
}
