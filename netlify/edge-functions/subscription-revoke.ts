// ==========================================================================
// Revoke an active subscription early - super_admin only.
// ==========================================================================
// Called from views/schools.js's "Revoke subscription" action
// (js/services/subscription.service.js's revokeSubscription()). Distinct
// from setSchoolStatus(schoolId, "suspended") in school.service.js - that's
// an operational hold, independent of payment, lifted by the platform
// admin clicking Reactivate. This is a billing-family action: it cuts a
// school's already-active, not-yet-expired term short (non-payment,
// chargeback, fraud, contract default, or an issue-in-error correction -
// see REVOKE_REASONS below and the matching list in
// subscription.service.js), and is lifted the same way an expired
// subscription is - the platform admin issuing a fresh token, which the
// school's admin activates. See the comment on subscriptionStatus === "revoked"
// in subscription.service.js's getSubscriptionState() for how the two are
// told apart on screen.
//
// Same "browser never talks to Firestore directly for this" shape as
// subscription-issue.ts/subscription-activate.ts - this is the third and
// last piece able to write schools/{id}'s subscription fields, since
// firestore.rules' touchesSubscriptionFields() carve-out blocks a normal
// client write to them entirely, even from the super_admin's own browser
// session. subscriptionExpiresAt/subscriptionPlan/subscriptionActivatedAt
// are deliberately left untouched by this - only subscriptionStatus flips
// to "revoked" plus a new subscriptionRevokedAt/By/Reason/Note record - so
// the doc keeps an honest history of what the school had actually paid
// for, rather than silently rewriting it to look like nothing was ever
// active.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// No new secret needed - this doesn't mint or verify a signed token like
// the other two, it's a direct privileged write.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

// Mirrors REVOKE_REASONS in subscription.service.js - kept as two
// separately-maintained lists (same pattern VALID_PLANS/SUBSCRIPTION_PLANS
// already uses across lib/subscription-tokens.ts and
// subscription.service.js): the client list drives the dropdown, this one
// is the actual server-side validation and is what's trusted.
const VALID_REVOKE_REASONS = [
  "non_payment",
  "chargeback",
  "fraudulent_payment",
  "contract_default",
  "issued_in_error",
  "other",
] as const;

function isValidReason(v: unknown): v is (typeof VALID_REVOKE_REASONS)[number] {
  return typeof v === "string" && (VALID_REVOKE_REASONS as readonly string[]).includes(v);
}

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Same limit as subscription-activate.ts - a privileged, low-frequency
  // admin action, not something that should ever legitimately be called
  // often from one IP.
  const rl = await checkRateLimit(`subscription-revoke:${clientIp(request, context)}`, 10, 60);
  if (!rl.allowed) {
    return rateLimitedResponse(rl.retryAfterSeconds);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const schoolId = String(body.schoolId || "").trim();
  const reason = body.reason;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!schoolId) return jsonResponse({ error: "A school is required." }, 400);
  if (!isValidReason(reason)) return jsonResponse({ error: "Please choose a valid reason." }, 400);
  if (reason === "other" && !note) {
    return jsonResponse({ error: "Please describe the reason when choosing \"Other\"." }, 400);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("subscription-revoke: service account auth failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  // Confirm the caller is genuinely super_admin - never trust a role claim
  // from the browser, this is looked up fresh from their own profile doc.
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("subscription-revoke: caller lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only the platform administrator can revoke a subscription." }, 403);
  }

  let school: Record<string, any> | null;
  try {
    school = await getFsDoc(accessToken, `schools/${schoolId}`);
  } catch (err) {
    console.error("subscription-revoke: school lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!school) return jsonResponse({ error: "That school doesn't exist." }, 404);
  if (school.subscriptionStatus !== "active") {
    // Covers both "never had a subscription" and "already revoked" -
    // either way there's nothing active left to cut short, so this is a
    // 409 (state conflict) rather than silently no-op-ing.
    return jsonResponse({ error: "This school doesn't have an active subscription to revoke." }, 409);
  }

  const now = new Date();
  try {
    // subscriptionExpiresAt/subscriptionPlan/subscriptionActivatedAt are
    // deliberately NOT touched - see file header. Only subscriptionStatus
    // changes (so firestore.rules' isSubscriptionActive() - which requires
    // subscriptionStatus == 'active' - immediately denies access, no rules
    // change needed) plus a record of why.
    await patchFsDoc(accessToken, `schools/${schoolId}`, {
      subscriptionStatus: "revoked",
      subscriptionRevokedAt: now,
      subscriptionRevokedBy: uid,
      subscriptionRevokeReason: reason,
      subscriptionRevokeNote: note || null,
    });
    await addFsDoc(accessToken, "audit_logs", {
      schoolId,
      userId: uid,
      action: "revoke_subscription",
      entity: "schools",
      entityId: schoolId,
      timestamp: now,
      reason,
    });
  } catch (err) {
    console.error("subscription-revoke: write failed", err);
    return jsonResponse({ error: "Couldn't revoke the subscription. Please try again." }, 500);
  }

  return jsonResponse({ subscriptionStatus: "revoked", subscriptionRevokeReason: reason }, 200);
};

export const config = {
  path: "/subscription-revoke",
  // Rate limiting is enforced in-code (see lib/rate-limit.ts) rather than
  // declared here - same reasoning as subscription-issue.ts/
  // subscription-activate.ts.
};
