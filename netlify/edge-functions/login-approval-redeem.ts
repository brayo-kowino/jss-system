// ==========================================================================
// Redeem an approved login_approvals request from the waiting/new device.
// ==========================================================================
// Called by the device that created the approval request, once its
// onSnapshot listener (watchLoginApproval in login-approval.service.js)
// sees status flip to "approved". That listener is read-only and can only
// ever reflect what login-approval-approve.ts already wrote with the
// service-account credential - so unlike the old flow, there's no path left
// where the requesting device can write "approved" for itself. This
// endpoint re-checks the approval doc itself (never trusts a status the
// client merely claims to have seen), marks it redeemed so it can't be
// replayed, and only then registers the device as trusted.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, putFsDoc, patchFsDoc, addFsDoc, setCustomClaims, claimExpiryIso, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse } from "./lib/rate-limit.ts";

// Same TTL as device-register.ts - keep the two in sync since they grant
// the same claim for the same conceptual event ("this device is now on
// record").
const DEVICE_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  const rl = await checkRateLimit(`login-approval-redeem:uid:${uid}`, 20, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }
  const approvalId = String(body.approvalId || "").trim();
  const fingerprint = String(body.fingerprint || "").trim();
  if (!approvalId || !fingerprint) return jsonResponse({ error: "Missing approvalId or fingerprint." }, 400);
  const deviceInfo = body.deviceInfo && typeof body.deviceInfo === "object" ? body.deviceInfo : {};

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("login-approval-redeem: service account auth failed", err);
    return jsonResponse({ error: "Approval service is temporarily unavailable." }, 500);
  }

  const approval = await getFsDoc(accessToken, `users/${uid}/login_approvals/${approvalId}`);
  if (!approval) return jsonResponse({ error: "That approval request no longer exists." }, 404);
  if (approval.status !== "approved") {
    return jsonResponse({ error: "This request hasn't been approved yet." }, 403);
  }
  if (approval.redeemedAt) {
    return jsonResponse({ error: "This approval has already been used." }, 409);
  }
  // The fingerprint being registered must match the one the request was
  // actually created for - stops a redeem call substituting a different
  // device than the one that was shown to the approver.
  if (approval.deviceFingerprint && approval.deviceFingerprint !== fingerprint) {
    return jsonResponse({ error: "This approval was issued for a different device." }, 403);
  }

  try {
    // Mark redeemed first, same reasoning subscription-activate.ts uses:
    // if the trusted-device write below fails, the safe failure mode is
    // "approval burned, user asks their primary device to approve again,"
    // not "approval silently reusable."
    await patchFsDoc(accessToken, `users/${uid}/login_approvals/${approvalId}`, {
      redeemedAt: new Date(),
    });
    await putFsDoc(accessToken, `users/${uid}/trusted_devices/${fingerprint}`, {
      fingerprint,
      deviceName: String(deviceInfo.deviceName || "Unknown Device"),
      screenRes: String(deviceInfo.screenRes || "Unknown"),
      timezone: String(deviceInfo.timezone || "UTC"),
      browser: String(deviceInfo.browser || "Unknown Browser"),
      os: String(deviceInfo.os || "Unknown OS"),
      isPrimary: false,
      registeredAt: new Date(),
      lastSeenAt: new Date(),
    });
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "redeem_login_approval",
      entity: "trusted_devices",
      entityId: fingerprint,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("login-approval-redeem: write failed", err);
    return jsonResponse({ error: "Couldn't complete sign-in. Please try again." }, 500);
  }

  // Same claim-mint as device-register.ts's bootstrap path - this device is
  // now genuinely on record too, having gone through a separate approver's
  // sign-off rather than self-bootstrap.
  try {
    await setCustomClaims(accessToken, uid, { deviceApprovedUntil: claimExpiryIso(DEVICE_CLAIM_TTL_MS) });
  } catch (err) {
    console.error("login-approval-redeem: setCustomClaims failed", err);
  }

  return jsonResponse({ redeemed: true }, 200);
};

export const config = {
  path: "/login-approval-redeem",
};
