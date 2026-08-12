// ==========================================================================
// Activate a subscription token - the caller's own school's admin only.
// ==========================================================================
// Called from views/school-settings.js's Subscription tab
// (js/services/subscription.service.js's activateSubscription()). Re-verifies
// the token's signature, confirms it belongs to the caller's own school,
// confirms it hasn't already been consumed, marks it consumed, and writes
// the subscription fields onto schools/{schoolId} - all with the same
// privileged service-account credential subscription-issue.ts uses, which
// is the only thing that can ever write those fields (firestore.rules'
// touchesSubscriptionFields() carve-out blocks a normal client write, even
// from that school's own admin, on purpose).
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY) and
// lib/subscription-tokens.ts (SUBSCRIPTION_TOKEN_SECRET).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { verifySubscriptionToken } from "./lib/subscription-tokens.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Guessable-input surface (a token forgery/guessing attempt) - same
  // reasoning results-lookup.ts uses for its lower limit.
  const rl = await checkRateLimit(`subscription-activate:${clientIp(request, context)}`, 10, 60);
  if (!rl.allowed) {
    return rateLimitedResponse(rl.retryAfterSeconds);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const rawToken = String(body.token || "").trim();
  if (!rawToken) return jsonResponse({ error: "Paste the token you were given first." }, 400);

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  const tokenSecret = Netlify.env.get("SUBSCRIPTION_TOKEN_SECRET");
  if (!tokenSecret) {
    console.error("subscription-activate: SUBSCRIPTION_TOKEN_SECRET not set");
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  const payload = await verifySubscriptionToken(tokenSecret, rawToken);
  if (!payload) return jsonResponse({ error: "That token isn't valid. Check you copied it in full." }, 400);

  if (new Date(payload.exp).getTime() <= Date.now()) {
    return jsonResponse({ error: "This token has already expired. Ask the platform administrator for a new one." }, 400);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("subscription-activate: service account auth failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  // Confirm the caller is genuinely this school's admin - never trust a
  // schoolId claim from the browser, this is looked up fresh from their
  // own profile doc. Matches the /settings route gate (admin only).
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("subscription-activate: caller lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.role !== "admin" || !caller.schoolId) {
    return jsonResponse({ error: "Only a school administrator can activate a subscription." }, 403);
  }
  if (caller.schoolId !== payload.sid) {
    return jsonResponse({ error: "This token was issued for a different school." }, 403);
  }

  let tokenDoc: Record<string, any> | null;
  try {
    tokenDoc = await getFsDoc(accessToken, `subscription_tokens/${payload.jti}`);
  } catch (err) {
    console.error("subscription-activate: token lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!tokenDoc) {
    return jsonResponse({ error: "That token isn't recognized. Ask the platform administrator for a new one." }, 400);
  }
  if (tokenDoc.consumedAt) {
    return jsonResponse({ error: "That token has already been used." }, 409);
  }

  const now = new Date();
  try {
    // Mark consumed first - if the schools/{id} write below somehow fails
    // after this, the safe failure mode is "token burned, admin asks the
    // platform administrator for a new one," not "token silently reusable."
    await patchFsDoc(accessToken, `subscription_tokens/${payload.jti}`, {
      consumedAt: now,
      consumedBy: uid,
    });
    await patchFsDoc(accessToken, `schools/${payload.sid}`, {
      subscriptionStatus: "active",
      subscriptionPlan: payload.p,
      subscriptionExpiresAt: new Date(payload.exp),
      subscriptionActivatedAt: now,
      subscriptionActivatedBy: uid,
      subscriptionTokenId: payload.jti,
    });
    await addFsDoc(accessToken, "audit_logs", {
      schoolId: payload.sid,
      userId: uid,
      action: "activate_subscription",
      entity: "schools",
      entityId: payload.sid,
      timestamp: now,
    });
  } catch (err) {
    console.error("subscription-activate: write failed", err);
    return jsonResponse({ error: "Couldn't activate that token. Please try again." }, 500);
  }

  return jsonResponse(
    { subscriptionStatus: "active", subscriptionPlan: payload.p, subscriptionExpiresAt: payload.exp },
    200,
  );
};

export const config = {
  path: "/subscription-activate",
  // Rate limiting is enforced in-code now (see lib/rate-limit.ts) rather
  // than declared here - see the comment at the top of that file for why.
};
