// ==========================================================================
// Suspend or reactivate a school - super_admin only.
// ==========================================================================
// Called from views/schools.js's Suspend/Reactivate action
// (js/services/school.service.js's setSchoolStatus()). Used to be a plain
// client SDK write straight to schools/{schoolId}.status from the
// super_admin's own browser session - firestore.rules allowed it because
// isSuperAdmin() was exempt from touchesSubscriptionFields(). That exemption
// is gone now: `status` feeds firestore.rules' isSubscriptionActive() via
// the subscriptionActiveUntil custom claim (see the comment on
// isSubscriptionActive() in firestore.rules and on syncSubscriptionClaims()
// in lib/firestore-rest.ts), and a direct client write would change the
// doc without ever re-minting that claim for the school's staff - exactly
// the "suspended school's staff can keep writing" gap this whole thing
// exists to close. So, same shape as subscription-activate.ts/
// subscription-revoke.ts: this is now the only path that can write
// schools/{id}.status, using the privileged service-account credential,
// and it fans the claim out to the school's staff as its last step.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// No new secret needed - same as subscription-revoke.ts.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, patchFsDoc, addFsDoc, syncSubscriptionClaims, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Same limit as subscription-revoke.ts - a privileged, low-frequency
  // admin action.
  const rl = await checkRateLimit(`school-status:${clientIp(request, context)}`, 10, 60);
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
  const status = body.status;
  if (!schoolId) return jsonResponse({ error: "A school is required." }, 400);
  if (status !== "active" && status !== "suspended") {
    return jsonResponse({ error: "Status must be either active or suspended." }, 400);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("school-status: service account auth failed", err);
    return jsonResponse({ error: "School service is temporarily unavailable." }, 500);
  }

  // Confirm the caller is genuinely super_admin - never trust a role claim
  // from the browser, this is looked up fresh from their own profile doc.
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("school-status: caller lookup failed", err);
    return jsonResponse({ error: "School service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.status === "suspended" || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only the platform administrator can change a school's status." }, 403);
  }

  let school: Record<string, any> | null;
  try {
    school = await getFsDoc(accessToken, `schools/${schoolId}`);
  } catch (err) {
    console.error("school-status: school lookup failed", err);
    return jsonResponse({ error: "School service is temporarily unavailable." }, 500);
  }
  if (!school) return jsonResponse({ error: "That school doesn't exist." }, 404);

  const now = new Date();
  try {
    await patchFsDoc(accessToken, `schools/${schoolId}`, { status, updatedAt: now });
    // Keep the public login-branding doc's status in step, same as the
    // client used to do (a merge-only write touching just `status`, so no
    // other branding field on that doc is disturbed) - so a suspended
    // school's direct login link stops resolving instead of still showing
    // its branding to anonymous visitors. Best-effort: a school without a
    // slug yet has never had a public branding doc created, nothing to
    // keep in step.
    if (school.slug) {
      try {
        await patchFsDoc(accessToken, `school_public/${school.slug}`, { status });
      } catch (err) {
        console.error("school-status: school_public sync failed", err);
      }
    }
    await addFsDoc(accessToken, "audit_logs", {
      schoolId,
      userId: uid,
      action: status === "suspended" ? "suspend_school" : "activate_school",
      entity: "schools",
      entityId: schoolId,
      timestamp: now,
    });
  } catch (err) {
    console.error("school-status: write failed", err);
    return jsonResponse({ error: "Couldn't update this school's status. Please try again." }, 500);
  }

  // Best-effort - see the matching comment in subscription-activate.ts.
  try {
    await syncSubscriptionClaims(accessToken, schoolId);
  } catch (err) {
    console.error("school-status: claim sync failed", err);
  }

  return jsonResponse({ status }, 200);
};

export const config = {
  path: "/school-status",
  // Rate limiting is enforced in-code (see lib/rate-limit.ts) rather than
  // declared here - same reasoning as subscription-issue.ts/
  // subscription-activate.ts/subscription-revoke.ts.
};
