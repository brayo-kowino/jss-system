// ==========================================================================
// Register the caller's current device as trusted.
// ==========================================================================
// Replaces device.service.js's registerTrustedDevice() writing straight to
// Firestore. That write was gated by firestore.rules' old
// `allow create, update: if isSignedIn() && request.auth.uid == uid` on
// users/{uid}/trusted_devices/{deviceId} - which meant ANY signed-in session
// for an account, however it was obtained, could mark itself as trusted at
// any time, with no proof a password or 2FA code had ever been entered.
// That's the core of what made the login-approval prompt bypassable: the
// "approval" was a doc in a collection the requester's own session could
// just write directly.
//
// This endpoint is called from three places in the app (see
// auth.service.js): after a forced password change, after a voluntary
// password change, and as the very first device to log into a brand-new
// account. All three follow a step Firebase Auth itself enforces
// server-side (a fresh sign-in, or updatePassword's requires-recent-login
// check) - so this requires the ID token's auth_time to be recent, which
// only a genuine password entry produces. The one true bootstrap case (a
// fresh account's very first login, with zero trusted devices yet and
// nobody to approve one) is allowed even without a fresh auth_time, since
// there's no existing trust boundary to bypass yet.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, putFsDoc, addFsDoc, listFsDocs, setCustomClaims, claimExpiryIso, verifyFirebaseIdTokenWithAuthTime, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse } from "./lib/rate-limit.ts";

// Firebase refreshes ID tokens roughly hourly, but auth_time only changes
// on a genuine sign-in/reauth - so a 15-minute window comfortably covers
// "just typed my password" without being wide enough to cover an
// hours-old idle session.
const RECENT_AUTH_WINDOW_SECS = 15 * 60;

// How long deviceApprovedUntil stays valid before the account needs a fresh
// device-register.ts or login-approval-redeem.ts call to renew it. 30 days
// keeps normal usage friction-free (nobody logs in daily on every school
// system) while still bounding a stolen/stale claim's lifetime instead of
// leaving it valid forever. Tune down if that window feels too wide.
const DEVICE_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const verified = await verifyFirebaseIdTokenWithAuthTime(idToken);
  if (!verified) return jsonResponse({ error: "You must be signed in." }, 401);
  const { uid, authTime } = verified;

  const rl = await checkRateLimit(`device-register:uid:${uid}`, 10, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }
  const fingerprint = String(body.fingerprint || "").trim();
  if (!fingerprint) return jsonResponse({ error: "Missing device fingerprint." }, 400);
  const deviceInfo = body.deviceInfo && typeof body.deviceInfo === "object" ? body.deviceInfo : {};

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("device-register: service account auth failed", err);
    return jsonResponse({ error: "Device service is temporarily unavailable." }, 500);
  }

  const userDoc = await getFsDoc(accessToken, `users/${uid}`);
  if (!userDoc) return jsonResponse({ error: "Account not found." }, 404);

  let existingDevices: Record<string, any>[];
  try {
    existingDevices = await listFsDocs(accessToken, `users/${uid}/trusted_devices`);
  } catch (err) {
    console.error("device-register: existing-device lookup failed", err);
    return jsonResponse({ error: "Device service is temporarily unavailable." }, 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const authIsRecent = now - authTime <= RECENT_AUTH_WINDOW_SECS;
  const isGenuineBootstrap = existingDevices.length === 0;

  if (!authIsRecent && !isGenuineBootstrap) {
    return jsonResponse(
      { error: "For your security, re-enter your password before registering a new trusted device." },
      403,
    );
  }

  const isPrimary = Boolean(body.isPrimary) || isGenuineBootstrap;

  try {
    await putFsDoc(accessToken, `users/${uid}/trusted_devices/${fingerprint}`, {
      fingerprint,
      deviceName: String(deviceInfo.deviceName || "Unknown Device"),
      screenRes: String(deviceInfo.screenRes || "Unknown"),
      timezone: String(deviceInfo.timezone || "UTC"),
      browser: String(deviceInfo.browser || "Unknown Browser"),
      os: String(deviceInfo.os || "Unknown OS"),
      isPrimary,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    });
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "register_device",
      entity: "users",
      entityId: fingerprint,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("device-register: write failed", err);
    return jsonResponse({ error: "Couldn't register this device. Please try again." }, 500);
  }

  // Mint the deviceApprovedUntil claim now that this device is genuinely on
  // record. firestore.rules' isFullyVerified() reads it back out of the
  // token - but only once the CLIENT refreshes its token (see
  // auth.service.js: getIdToken(true) must run right after this call
  // resolves, or the caller keeps hitting rules-denied against its old,
  // pre-claim token for up to an hour).
  try {
    const accessTokenForClaims = await getAccessToken();
    await setCustomClaims(accessTokenForClaims, uid, { deviceApprovedUntil: claimExpiryIso(DEVICE_CLAIM_TTL_MS) });
  } catch (err) {
    // Non-fatal to the device-registration itself, but the caller stays
    // gated until this succeeds - log loudly so it doesn't go unnoticed.
    console.error("device-register: setCustomClaims failed", err);
  }

  return jsonResponse({ registered: true, isPrimary }, 200);
};

export const config = {
  path: "/device-register",
};
