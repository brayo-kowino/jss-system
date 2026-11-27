// ==========================================================================
// Disable 2FA - only with a valid, freshly-issued step-up token proving
// two-factor-verify.ts already checked a code for this exact account.
// ==========================================================================
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY) and
// lib/step-up-token.ts (STEP_UP_TOKEN_SECRET).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, patchFsDoc, addFsDoc, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
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

  const rl = await checkRateLimit(`2fa-disable:uid:${uid}`, 5, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const secret = Netlify.env.get("STEP_UP_TOKEN_SECRET");
  if (!secret) {
    console.error("two-factor-disable: STEP_UP_TOKEN_SECRET not set");
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }
  const payload = await verifyStepUpToken(secret, String(body.stepUpToken || ""), { uid, purpose: "2fa" });
  if (!payload) {
    return jsonResponse({ error: "Verify your 2FA code again before disabling it." }, 401);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("two-factor-disable: service account auth failed", err);
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }

  try {
    await patchFsDoc(accessToken, `users/${uid}`, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorEnabledAt: null,
    });
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "disable_2fa",
      entity: "users",
      entityId: uid,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("two-factor-disable: write failed", err);
    return jsonResponse({ error: "Couldn't disable 2FA. Please try again." }, 500);
  }

  return jsonResponse({ disabled: true }, 200);
};

export const config = {
  path: "/two-factor-disable",
};
