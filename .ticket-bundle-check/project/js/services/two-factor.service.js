// ==========================================================================
// Two-Factor Authentication Service (TOTP) - client side.
// ==========================================================================
// generate2FASetup() still runs client-side (it only proposes a candidate
// secret for the QR code - nothing is persisted or trusted until the code
// is verified). Every step that actually checks a code or writes 2FA state
// to Firestore now goes through same-origin edge functions
// (netlify/edge-functions/two-factor-*.ts), which hold the one
// service-account credential capable of writing twoFactorEnabled/
// twoFactorSecret/twoFactorBackupCodes - firestore.rules blocks a direct
// client write to those fields outright now (see users/{uid}'s allow
// update clause). This mirrors subscription.service.js's callFunction()
// pattern exactly.
// ==========================================================================

import {
  doc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "../firebase-config.js";

let OTPAuth = null;
async function loadOTPAuth() {
  if (OTPAuth) return OTPAuth;
  OTPAuth = await import("https://cdn.jsdelivr.net/npm/otpauth@9/dist/otpauth.esm.min.js");
  return OTPAuth;
}

async function callFunction(path, payload) {
  if (!auth.currentUser) throw new Error("You must be signed in.");
  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Unexpected response from the server.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// /two-factor-verify mints twoFactorVerifiedUntil on success. Every caller
// below that hits it needs to force a token refresh right after, or this
// browser keeps using its old token - which firestore.rules'
// isFullyVerified() sees as un-2FA'd - until the token naturally refreshes
// up to an hour later.
async function refreshClaimsToken() {
  if (!auth.currentUser) return;
  try {
    await auth.currentUser.getIdToken(true);
  } catch (err) {
    console.error("two-factor.service: token refresh after 2FA grant failed:", err);
  }
}

/**
 * Generates a candidate TOTP secret client-side for rendering the QR code.
 * Nothing is persisted or trusted yet - enable2FA() below is what actually
 * verifies and saves it.
 */
export async function generate2FASetup(uid, email) {
  const otpauth = await loadOTPAuth();
  const secret = new otpauth.Secret({ size: 20 });
  const secretString = secret.base32;
  const totp = new otpauth.TOTP({
    issuer: "Eeskia",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  return { secret: secretString, otpauthUri: totp.toString() };
}

/**
 * Verifies the enrollment code against the candidate secret server-side,
 * and only then persists twoFactorEnabled/twoFactorSecret and
 * server-generated backup codes (netlify/edge-functions/two-factor-enable.ts).
 * Returns the backup codes array (plaintext, shown once). Throws if the
 * code is invalid.
 */
export async function enable2FA(uid, secret, verificationCode) {
  const data = await callFunction("/two-factor-enable", { secret, code: verificationCode });
  return data.backupCodes;
}

/**
 * Verifies a code (TOTP or backup) server-side
 * (netlify/edge-functions/two-factor-verify.ts) and, only if valid,
 * clears 2FA fields via /two-factor-disable using the short-lived
 * step-up token the verify call returns. Throws if the code is invalid.
 */
export async function disable2FA(uid, verificationCode) {
  const verified = await callFunction("/two-factor-verify", { code: verificationCode });
  await refreshClaimsToken();
  await callFunction("/two-factor-disable", { stepUpToken: verified.stepUpToken });
}

/**
 * Verifies a code (TOTP or backup) at login time, server-side. Returns
 * boolean - true only if /two-factor-verify accepted the code.
 */
export async function validate2FALogin(uid, code) {
  try {
    const data = await callFunction("/two-factor-verify", { code });
    if (data.valid === true) await refreshClaimsToken();
    return data.valid === true;
  } catch {
    return false;
  }
}

/**
 * Same as validate2FALogin(), but also returns the short-lived step-up
 * token - used by the login-approval "approve" flow (shell.js), which
 * needs to prove a fresh code was just checked when handing off to
 * login-approval-approve.ts.
 */
export async function verify2FAForStepUp(code) {
  const data = await callFunction("/two-factor-verify", { code });
  await refreshClaimsToken();
  return data;
}

const TWOFA_SESSION_KEY_PREFIX = "jss_2fa_verified_";

/**
 * Marks this browser session as having verified a 2FA code for this uid.
 * sessionStorage-scoped (cleared when the tab/session ends) - purely a UX
 * signal so getAuthGateStatus() (auth.service.js) doesn't re-prompt for a
 * code on every navigation within the same sign-in. It grants nothing by
 * itself: every privileged server call (disable 2FA, approve a login) still
 * independently requires its own fresh step-up token from
 * /two-factor-verify, regardless of this flag.
 */
export function mark2FAVerifiedThisSession(uid) {
  try {
    sessionStorage.setItem(TWOFA_SESSION_KEY_PREFIX + uid, "1");
  } catch {
    // sessionStorage unavailable (e.g. private browsing edge cases) -
    // worst case the user is asked for a code again next navigation.
  }
}

export function is2FAVerifiedThisSession(uid) {
  try {
    return sessionStorage.getItem(TWOFA_SESSION_KEY_PREFIX + uid) === "1";
  } catch {
    return false;
  }
}

/**
 * Reads user doc, returns boolean (twoFactorEnabled === true). Read-only,
 * so this is still a direct Firestore read - no privileged write involved.
 */
export async function is2FAEnabled(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return false;
  return snap.data().twoFactorEnabled === true;
}
