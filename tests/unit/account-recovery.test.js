import { describe, it, expect, vi, beforeEach } from "vitest";

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signFreezeToken(secret, payload) {
  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

async function verifyFreezeToken(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expectedSigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
    const expectedSig = base64UrlEncode(new Uint8Array(expectedSigBuf));

    if (!safeEqual(sigB64, expectedSig)) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson);

    if (payload.purpose !== "emergency_freeze") return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (!payload.uid) return null;

    return payload;
  } catch {
    return null;
  }
}

describe("Account Recovery & Emergency Freeze Core Logic", () => {
  const SECRET = "test-recovery-secret-key-1234567890";

  it("signs and successfully verifies a valid emergency freeze token", async () => {
    const payload = {
      uid: "user-admin-999",
      email: "admin@school.ac.ke",
      schoolId: "school-123",
      purpose: "emergency_freeze",
      exp: Date.now() + 1000 * 60 * 60, // 1 hr future
    };

    const token = await signFreezeToken(SECRET, payload);
    expect(token).toContain(".");

    const verified = await verifyFreezeToken(SECRET, token);
    expect(verified).not.toBeNull();
    expect(verified.uid).toBe("user-admin-999");
    expect(verified.email).toBe("admin@school.ac.ke");
    expect(verified.schoolId).toBe("school-123");
  });

  it("rejects an expired emergency freeze token", async () => {
    const payload = {
      uid: "user-admin-999",
      email: "admin@school.ac.ke",
      schoolId: "school-123",
      purpose: "emergency_freeze",
      exp: Date.now() - 1000, // 1 sec in the past
    };

    const token = await signFreezeToken(SECRET, payload);
    const verified = await verifyFreezeToken(SECRET, token);
    expect(verified).toBeNull();
  });

  it("rejects a tampered emergency freeze token", async () => {
    const payload = {
      uid: "user-admin-999",
      email: "admin@school.ac.ke",
      schoolId: "school-123",
      purpose: "emergency_freeze",
      exp: Date.now() + 1000 * 60 * 60,
    };

    const token = await signFreezeToken(SECRET, payload);
    const [payloadB64, sigB64] = token.split(".");
    // Tamper with payload
    const tamperedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...payload, uid: "hacker-uid" })));
    const tamperedToken = `${tamperedPayload}.${sigB64}`;

    const verified = await verifyFreezeToken(SECRET, tamperedToken);
    expect(verified).toBeNull();
  });

  it("rejects tokens signed with a different secret", async () => {
    const payload = {
      uid: "user-admin-999",
      email: "admin@school.ac.ke",
      schoolId: "school-123",
      purpose: "emergency_freeze",
      exp: Date.now() + 1000 * 60 * 60,
    };

    const token = await signFreezeToken("wrong-secret-key", payload);
    const verified = await verifyFreezeToken(SECRET, token);
    expect(verified).toBeNull();
  });

  it("rejects tokens with wrong purpose", async () => {
    const payload = {
      uid: "user-admin-999",
      email: "admin@school.ac.ke",
      schoolId: "school-123",
      purpose: "other_action",
      exp: Date.now() + 1000 * 60 * 60,
    };

    const token = await signFreezeToken(SECRET, payload);
    const verified = await verifyFreezeToken(SECRET, token);
    expect(verified).toBeNull();
  });
});
