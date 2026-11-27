// ==========================================================================
// Signed subscription-token helpers, shared by subscription-issue.ts and
// subscription-activate.ts.
// ==========================================================================
// A token is `${payload}.${signature}`, where payload is a base64url JSON
// blob of { sid: schoolId, p: plan, exp: ISO expiry, jti: unique id } and
// signature is an HMAC-SHA256 of the payload string, keyed by
// SUBSCRIPTION_TOKEN_SECRET. The signature is what stops anyone from
// hand-crafting a token without that secret; the jti + subscription_tokens
// ledger (see subscription-issue.ts/subscription-activate.ts) is what
// stops a valid, correctly-signed token from being replayed a second time
// once it's been consumed - the signature alone never expires or
// single-uses itself, so both checks matter.
//
// REQUIRED SETUP (Netlify Console -> Site configuration -> Environment
// variables - a secret, never commit it):
//   SUBSCRIPTION_TOKEN_SECRET - any long random string (e.g.
//     `openssl rand -hex 32`), used only to sign/verify these tokens. Not
//     the same as GOOGLE_SERVICE_ACCOUNT_KEY - rotating this one just
//     invalidates any not-yet-redeemed tokens, nothing else.
// ==========================================================================

// Kenyan CBC runs 3 terms/year, so "1 term" = 4 months. A single tweakable
// constant rather than a hardcoded date range - change this if term length
// ever changes. Must match the identical constant in
// js/services/subscription.service.js's SUBSCRIPTION_DURATIONS label.
export const TERM_MONTHS = 4;
export const YEAR_MONTHS = 12;
// Sanity ceiling on a custom expiry date - stops a fat-fingered year (e.g.
// pasting 2124 instead of 2026) from issuing an effectively-permanent
// subscription.
export const MAX_CUSTOM_YEARS = 5;

export const VALID_PLANS = ["starter", "growth", "district"] as const;
export type SubscriptionPlan = (typeof VALID_PLANS)[number];

export function addMonthsUTC(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

// Constant-time-ish comparison - both sides are fixed-length HMAC outputs,
// so this is enough to avoid a naive early-exit timing leak without
// needing a dedicated constant-time-compare library.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SubscriptionTokenPayload {
  sid: string; // schoolId
  p: SubscriptionPlan;
  exp: string; // ISO expiry
  jti: string; // unique token id - also the subscription_tokens/{jti} doc id
}

export async function signSubscriptionToken(secret: string, payload: SubscriptionTokenPayload): Promise<string> {
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

// Returns the decoded payload if the signature is valid and the token is
// well-formed, null otherwise. Does NOT check expiry or consumption - the
// caller decides what to do with an expired-but-validly-signed token
// (subscription-activate.ts rejects it with a clear message), and
// consumption is checked against the subscription_tokens ledger, not
// anything encoded in the token itself.
export async function verifySubscriptionToken(secret: string, token: string): Promise<SubscriptionTokenPayload | null> {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  let expectedSig: string;
  try {
    expectedSig = await hmacSign(secret, payloadB64);
  } catch {
    return null;
  }
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    if (
      typeof json.sid === "string" &&
      typeof json.p === "string" &&
      typeof json.exp === "string" &&
      typeof json.jti === "string"
    ) {
      return json as SubscriptionTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
