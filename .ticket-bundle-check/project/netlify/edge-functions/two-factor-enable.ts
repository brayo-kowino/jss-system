// ==========================================================================
// Enable 2FA - verify the enrollment code, then persist the secret and
// server-generated backup codes with the service-account credential.
// ==========================================================================
// The candidate secret is still generated client-side by
// generate2FASetup() (js/services/two-factor.service.js) so the QR code can
// render immediately - that part is harmless, since nothing is persisted or
// trusted yet. What used to be unsafe was enable2FA() checking the code
// *and* writing twoFactorEnabled/twoFactorSecret to Firestore in one
// client-side call, protected only by a firestore.rules clause that let the
// signed-in user write those fields unconditionally - i.e. a compromised
// session could set twoFactorEnabled:true (or false) directly with no code
// check at all. Now the client can no longer write those fields (see
// firestore.rules), and this endpoint is the only path that can.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { verifyTotp, hashBackupCode, generateBackupCodes } from "./lib/totp.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  const rl = await checkRateLimit(`2fa-enable:uid:${uid}`, 5, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }
  const secret = String(body.secret || "").trim();
  const code = String(body.code || "").trim();
  if (!secret || !code) return jsonResponse({ error: "Missing secret or verification code." }, 400);

  const isValid = await verifyTotp(secret, code);
  if (!isValid) return jsonResponse({ error: "Invalid verification code." }, 401);

  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map(hashBackupCode);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("two-factor-enable: service account auth failed", err);
    return jsonResponse({ error: "2FA service is temporarily unavailable." }, 500);
  }

  const userDoc = await getFsDoc(accessToken, `users/${uid}`);
  if (!userDoc) return jsonResponse({ error: "Account not found." }, 404);

  try {
    await patchFsDoc(accessToken, `users/${uid}`, {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: hashedBackupCodes,
      twoFactorEnabledAt: new Date(),
    });
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "enable_2fa",
      entity: "users",
      entityId: uid,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("two-factor-enable: write failed", err);
    return jsonResponse({ error: "Couldn't enable 2FA. Please try again." }, 500);
  }

  return jsonResponse({ enabled: true, backupCodes }, 200);
};

export const config = {
  path: "/two-factor-enable",
};
