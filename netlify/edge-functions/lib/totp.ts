// ==========================================================================
// Server-side TOTP (RFC 6238) verification, Web Crypto only.
// ==========================================================================
// Mirrors what js/services/two-factor.service.js did with the `otpauth` npm
// package, but re-implemented with the platform's crypto.subtle so this
// runs in the Deno edge runtime without pulling in an external dependency
// (same reasoning lib/firestore-rest.ts gives for hand-rolling RS256 JWT
// verification instead of importing a JWT library).
//
// This is the ONLY place a TOTP code is allowed to be checked against a
// secret. The client-side otpauth-based verify2FACode() in
// two-factor.service.js must not be trusted for anything that gates
// access - see two-factor-verify.ts.
// ==========================================================================

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip anything malformed rather than throw
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, counterBytes);
  const sig = new Uint8Array(sigBuf);
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(binCode % 1_000_000).padStart(6, "0");
}

// Verifies a 6-digit code against a base32 secret, allowing +/-1 step
// (30s) of clock drift - same window the client-side implementation used.
// Returns true/false only; never leaks which offset matched.
export async function verifyTotp(secretBase32: string, code: string, periodSeconds = 30, window = 1): Promise<boolean> {
  const trimmed = String(code || "").trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const secretBytes = base32Decode(secretBase32);
  if (secretBytes.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / periodSeconds);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const candidate = await hotp(secretBytes, counter + errorWindow);
    if (candidate === trimmed) return true;
  }
  return false;
}

// Same FNV-1a hash two-factor.service.js already uses for backup codes -
// duplicated here (rather than imported) since edge functions can't import
// from js/services/* (different runtime/module graph), and it's a pure,
// tiny function worth keeping in sync by inspection rather than by import.
export function hashBackupCode(code: string): string {
  let hash = 2166136261;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

// Cryptographically random backup codes (crypto.getRandomValues, not
// Math.random - Math.random is not a CSPRNG and these codes are
// effectively a second password).
export function generateBackupCodes(count = 10, length = 8): string[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let code = "";
    for (let j = 0; j < length; j++) code += chars[bytes[j] % chars.length];
    codes.push(code);
  }
  return codes;
}

export function generateBase32Secret(bytesLen = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLen));
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}
