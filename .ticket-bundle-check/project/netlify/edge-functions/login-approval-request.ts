// ==========================================================================
// Create a new login approval request.
// ==========================================================================
// Moved to an Edge Function to apply strict rate limits. Direct client
// writes to the login_approvals collection are no longer allowed to prevent
// abuse / MFA prompt fatigue attacks.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, addFsDoc, listFsDocs, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  // Rate limit: Max 3 requests per 5 minutes (300 seconds) to prevent prompt spamming
  const rl = await checkRateLimit(`login-approval-request:uid:${uid}`, 3, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const fingerprint = String(body.fingerprint || "").trim();
  if (!fingerprint) return jsonResponse({ error: "Missing fingerprint." }, 400);

  const deviceInfo = body.deviceInfo && typeof body.deviceInfo === "object" ? body.deviceInfo : {};

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("login-approval-request: service account auth failed", err);
    return jsonResponse({ error: "Service is temporarily unavailable." }, 500);
  }

  try {
    // Avoid creating duplicate pending requests for the same device if one already exists
    const allApprovals = await listFsDocs(accessToken, `users/${uid}/login_approvals`);
    const existing = allApprovals.find((a: any) => a.deviceFingerprint === fingerprint && a.status === "pending");
    
    if (existing) {
      return jsonResponse({ id: existing.id }, 200);
    }
  } catch(e) {
    // ignore list error and proceed to create
  }

  try {
    const docRef = await addFsDoc(accessToken, `users/${uid}/login_approvals`, {
      deviceFingerprint: fingerprint,
      deviceName: String(deviceInfo.deviceName || "Unknown Device"),
      screenRes: String(deviceInfo.screenRes || "Unknown"),
      timezone: String(deviceInfo.timezone || "Unknown"),
      status: "pending",
      requestedAt: new Date(),
      resolvedAt: null,
      resolvedBy: null
    });

    // Fire-and-forget audit log
    addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "create_login_approval",
      entity: "login_approvals",
      entityId: docRef.name.split("/").pop(),
      timestamp: new Date(),
    }).catch(() => {});

    const newId = docRef.name.split("/").pop();
    return jsonResponse({ id: newId }, 200);
  } catch (err) {
    console.error("login-approval-request: write failed", err);
    return jsonResponse({ error: "Failed to create approval request." }, 500);
  }
};

export const config = {
  path: "/login-approval-request",
};
