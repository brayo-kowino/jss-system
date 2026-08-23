// ==========================================================================
// Verify a 2FA code (TOTP or backup code) server-side.
// ==========================================================================
// Called from js/services/two-factor.service.js at login time, and before
// disabling 2FA. The old client-only validate2FALogin()/disable2FA() read
// the secret out of Firestore and checked it in the browser - anyone with a
// valid session (stolen token, XSS, or just devtools) could skip that check
// entirely, since nothing server-side ever confirmed a code was checked.
// This is now the only place a code is ever compared against the secret;
// the secret itself is read here with the service-account credential and
// never sent back to the client.
//
// On success, mints a short-lived step-up token (lib/step-up-token.ts,
// purpose "2fa") the caller can hand to two-factor-disable.ts or
// login-approval-approve.ts as proof this check just passed. It does NOT
// by itself grant access to anything - each of those endpoints independently
// re-verifies the signature and re-checks the account/purpose it's for.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY) and
// lib/step-up-token.ts (STEP_UP_TOKEN_SECRET).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, setCustomClaims, claimExpiryIso, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { verifyTotp, hashBackupCode } from "./lib/totp.ts";
import { signStepUpToken, newJti } from "./lib/step-up-token.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 minutes - long enough to complete the next call, short enough to not be worth stealing

// How long twoFactorVerifiedUntil stays valid before firestore.rules starts
// requiring a fresh code again. Deliberately much shorter than the device
// claim's 30 days - 2FA is meant to be a per-login/per-session proof, not a
// one-time account setup step, so this expiring on a working-day timescale
// is the mechanism that forces re-verification on the next fresh sign-in
// instead of a stale "verified" claim quietly carrying over indefinitely.
const TWO_FACTOR_CLAIM_TTL_MS = 12 * 60 * 60 * 1000;

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  // TOTP is a 6-digit space (1e6) - a tight per-account lockout matters far
  // more here than on most endpoints. 5 attempts / 5 minutes per uid, plus
  // a looser per-IP limit as a backstop against distributing attempts
  // across many accounts.
  const rlUid = await checkRateLimit(`2fa-verify:uid:${uid}`, 5, 300);
  if (!rlUid.allowed) return rateLimitedResponse(rlUid.retryAfterSeconds);
  const rlIp = await checkRateLimit(`2fa-verify:ip:${clientIp(request, context)}`, 20, 300);
  if (!rlIp.allowed) return rateLimitedResponse(rlIp.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }
  const code = String(body.code || "").trim();
  if (!code) return jsonResponse({ error: "Enter your 6-digit code or a backup code." }, 400);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("two-factor-verify: service account auth failed", err);
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }

  let userDoc: Record<string, any> | null;
  try {
    userDoc = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("two-factor-verify: user lookup failed", err);
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }
  if (!userDoc || !userDoc.twoFactorEnabled || !userDoc.twoFactorSecret) {
    return jsonResponse({ error: "2FA is not enabled on this account." }, 400);
  }

  const isValidTotp = await verifyTotp(userDoc.twoFactorSecret, code);
  let isValidBackup = false;
  let consumedBackup = false;

  if (!isValidTotp && Array.isArray(userDoc.twoFactorBackupCodes) && userDoc.twoFactorBackupCodes.length > 0) {
    const hashed = hashBackupCode(code.toUpperCase());
    const idx = userDoc.twoFactorBackupCodes.indexOf(hashed);
    if (idx !== -1) {
      isValidBackup = true;
      const remaining = userDoc.twoFactorBackupCodes.slice();
      remaining.splice(idx, 1);
      try {
        await patchFsDoc(accessToken, `users/${uid}`, { twoFactorBackupCodes: remaining });
        consumedBackup = true;
      } catch (err) {
        console.error("two-factor-verify: backup code consume failed", err);
        return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
      }
    }
  }

  if (!isValidTotp && !isValidBackup) {
    return jsonResponse({ error: "Invalid verification code." }, 401);
  }

  try {
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: consumedBackup ? "use_2fa_backup_code" : "verify_2fa",
      entity: "users",
      entityId: uid,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("two-factor-verify: audit log failed (non-fatal)", err);
  }

  // Mint twoFactorVerifiedUntil so firestore.rules' isFullyVerified() sees
  // this session as cleared, for the next TWO_FACTOR_CLAIM_TTL_MS. Unlike
  // the old permanent boolean, this expires on its own - so a fresh sign-in
  // hours or days later genuinely needs a new code, rather than silently
  // inheriting whatever "verified" state the account happened to have from
  // a previous session.
  try {
    await setCustomClaims(accessToken, uid, { twoFactorVerifiedUntil: claimExpiryIso(TWO_FACTOR_CLAIM_TTL_MS) });
  } catch (err) {
    console.error("two-factor-verify: setCustomClaims failed", err);
  }

  const secret = Netlify.env.get("STEP_UP_TOKEN_SECRET");
  if (!secret) {
    console.error("two-factor-verify: STEP_UP_TOKEN_SECRET not set");
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }
  const stepUpToken = await signStepUpToken(secret, {
    uid,
    purpose: "2fa",
    exp: Date.now() + STEP_UP_TTL_MS,
    jti: newJti(),
  });

  return jsonResponse({ valid: true, usedBackupCode: consumedBackup, stepUpToken }, 200);
};

export const config = {
  path: "/two-factor-verify",
};
