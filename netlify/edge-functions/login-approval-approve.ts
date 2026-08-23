// ==========================================================================
// Approve or deny a login_approvals request.
// ==========================================================================
// Replaces login-approval.service.js's approveLogin()/denyLogin() writing
// straight to Firestore. That write was gated by firestore.rules'
// `allow update: if isSignedIn() && request.auth.uid == uid` on
// users/{uid}/login_approvals/{approvalId} - which meant the SAME session
// that triggered the "unrecognized device" approval prompt could just set
// its own request's status to "approved" directly, with no separate
// approving device or 2FA code ever involved. That's the second half of
// what made the prompt bypassable (device-register.ts's header covers the
// first half).
//
// The caller here must be signed in as the account owner AND currently
// sitting on a device already listed in that account's trusted_devices -
// i.e. this can only be called from the primary/already-approved device
// that's supposed to be doing the approving, never from the new device
// that's waiting to get in. If the account has 2FA enabled, a fresh
// step-up token (from two-factor-verify.ts) is required too.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY) and
// lib/step-up-token.ts (STEP_UP_TOKEN_SECRET).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { verifyStepUpToken } from "./lib/step-up-token.ts";
import { checkRateLimit, rateLimitedResponse } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  const rl = await checkRateLimit(`login-approval-approve:uid:${uid}`, 20, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }
  const approvalId = String(body.approvalId || "").trim();
  const decision = body.decision === "approved" || body.decision === "denied" ? body.decision : null;
  const approverFingerprint = String(body.approverFingerprint || "").trim();
  if (!approvalId || !decision || !approverFingerprint) {
    return jsonResponse({ error: "Missing approvalId, decision, or approverFingerprint." }, 400);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("login-approval-approve: service account auth failed", err);
    return jsonResponse({ error: "Approval service is temporarily unavailable." }, 500);
  }

  const userDoc = await getFsDoc(accessToken, `users/${uid}`);
  if (!userDoc) return jsonResponse({ error: "Account not found." }, 404);

  // Prove this call is coming from an already-trusted device for this
  // account - never trust a fingerprint the client merely claims without
  // checking it against the ledger of devices that were themselves
  // registered through a recent-auth check (device-register.ts).
  const approverDevice = await getFsDoc(accessToken, `users/${uid}/trusted_devices/${approverFingerprint}`);
  if (!approverDevice) {
    return jsonResponse({ error: "Approvals can only come from an already-trusted device." }, 403);
  }

  if (userDoc.twoFactorEnabled) {
    const secret = Netlify.env.get("STEP_UP_TOKEN_SECRET");
    if (!secret) {
      console.error("login-approval-approve: STEP_UP_TOKEN_SECRET not set");
      return jsonResponse({ error: "Approval service is temporarily unavailable." }, 500);
    }
    const payload = await verifyStepUpToken(secret, String(body.stepUpToken || ""), { uid, purpose: "2fa" });
    if (!payload) {
      return jsonResponse({ error: "Enter your 2FA code again to approve or deny this login." }, 401);
    }
  }

  const approval = await getFsDoc(accessToken, `users/${uid}/login_approvals/${approvalId}`);
  if (!approval) return jsonResponse({ error: "That approval request no longer exists." }, 404);
  if (approval.status !== "pending") {
    return jsonResponse({ error: "This request has already been resolved." }, 409);
  }

  try {
    await patchFsDoc(accessToken, `users/${uid}/login_approvals/${approvalId}`, {
      status: decision,
      resolvedAt: new Date(),
      resolvedBy: uid,
    });
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: decision === "approved" ? "approve_login" : "deny_login",
      entity: "login_approvals",
      entityId: approvalId,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("login-approval-approve: write failed", err);
    return jsonResponse({ error: "Couldn't record that decision. Please try again." }, 500);
  }

  return jsonResponse({ status: decision }, 200);
};

export const config = {
  path: "/login-approval-approve",
};
