// ==========================================================================
// Signed "step-up" token helpers - same shape as lib/subscription-tokens.ts
// (base64url JSON payload + HMAC-SHA256 signature), reused here for a
// different purpose: proving to a *second* edge-function call that a
// privileged check (a TOTP/backup code, or a request from an
// already-trusted device) already passed in a *first* call, a few seconds
// or minutes earlier, without the browser being able to forge that proof
// itself.
//
// Used by: two-factor-verify.ts (issues), two-factor-disable.ts (verifies),
// login-approval-approve.ts (verifies, when the target account has 2FA on).
//
// REQUIRED SETUP (Netlify Console -> Site configuration -> Environment
// variables - a secret, never commit it):
//   STEP_UP_TOKEN_SECRET - any long random string (e.g. `openssl rand -hex 32`).
//   Not the same secret as SUBSCRIPTION_TOKEN_SECRET - keep them distinct so
//   rotating one doesn't affect the other.
// ==========================================================================

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StepUpTokenPayload {
  uid: string;
  purpose: string; // e.g. "2fa" or "trusted_device" - a token minted for one purpose can't be replayed for another
  exp: number; // epoch ms
  jti: string;
}

export async function signStepUpToken(secret: string, payload: StepUpTokenPayload): Promise<string> {
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

// Returns the payload if the signature is valid, well-formed, unexpired,
// and (when uid/purpose are passed) matches both - null otherwise. Callers
// should always pass the uid and purpose they expect so a token minted for
// a different account or a different purpose can never be reused.
export async function verifyStepUpToken(
  secret: string,
  token: string,
  expect: { uid: string; purpose: string },
): Promise<StepUpTokenPayload | null> {
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
    if (typeof json.uid !== "string" || typeof json.purpose !== "string" || typeof json.exp !== "number" || typeof json.jti !== "string") {
      return null;
    }
    if (json.uid !== expect.uid || json.purpose !== expect.purpose) return null;
    if (json.exp <= Date.now()) return null;
    return json as StepUpTokenPayload;
  } catch {
    return null;
  }
}

export function newJti(): string {
  return crypto.randomUUID();
}
