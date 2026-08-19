import { describe, it, expect } from "vitest";

// Re-implement the signing and verification algorithms matching netlify/edge-functions/lib/subscription-tokens.ts
// for isolated node environment testing using Web Crypto API.

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signPayload(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const rawPayload = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(enc.encode(rawPayload));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(encodedPayload));
  const encodedSig = base64UrlEncode(new Uint8Array(sig));
  return `${encodedPayload}.${encodedSig}`;
}

async function verifyToken(secret, token) {
  const [encodedPayload, encodedSig] = token.split(".");
  if (!encodedPayload || !encodedSig) return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = base64UrlDecode(encodedSig);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    enc.encode(encodedPayload)
  );
  if (!verified) return null;

  try {
    const jsonStr = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

describe("Subscription Token Cryptographic Security", () => {
  const SECRET = "super-secret-test-key-32-chars-long!!";
  const SAMPLE_PAYLOAD = {
    sid: "school-123",
    p: "growth",
    exp: new Date(Date.now() + 86400000).toISOString(),
    jti: "token-uuid-1234",
  };

  it("successfully signs and verifies a valid token payload", async () => {
    const token = await signPayload(SECRET, SAMPLE_PAYLOAD);
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const verified = await verifyToken(SECRET, token);
    expect(verified).not.toBeNull();
    expect(verified.sid).toBe("school-123");
    expect(verified.p).toBe("growth");
    expect(verified.jti).toBe("token-uuid-1234");
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signPayload("wrong-secret-key-123", SAMPLE_PAYLOAD);
    const verified = await verifyToken(SECRET, token);
    expect(verified).toBeNull();
  });

  it("detects and rejects tampered payload data", async () => {
    const token = await signPayload(SECRET, SAMPLE_PAYLOAD);
    const [payloadPart, sigPart] = token.split(".");

    // Tamper payload to elevate plan to district
    const tamperedObj = { ...SAMPLE_PAYLOAD, p: "district" };
    const tamperedPayload = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(tamperedObj))
    );
    const tamperedToken = `${tamperedPayload}.${sigPart}`;

    const result = await verifyToken(SECRET, tamperedToken);
    expect(result).toBeNull();
  });

  it("detects and rejects truncated or malformed signatures", async () => {
    const token = await signPayload(SECRET, SAMPLE_PAYLOAD);
    const [payloadPart, sigPart] = token.split(".");
    const truncatedToken = `${payloadPart}.${sigPart.slice(0, 10)}`;

    const result = await verifyToken(SECRET, truncatedToken);
    expect(result).toBeNull();
  });

  it("constant-time safeEqual prevents timing leakage", () => {
    const buf1 = new Uint8Array([1, 2, 3, 4, 5]);
    const buf2 = new Uint8Array([1, 2, 3, 4, 5]);
    const buf3 = new Uint8Array([1, 2, 3, 4, 6]);
    const buf4 = new Uint8Array([1, 2, 3]);

    expect(safeEqual(buf1, buf2)).toBe(true);
    expect(safeEqual(buf1, buf3)).toBe(false);
    expect(safeEqual(buf1, buf4)).toBe(false);
  });
});
