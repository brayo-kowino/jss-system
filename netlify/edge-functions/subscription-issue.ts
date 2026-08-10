// ==========================================================================
// Issue a subscription token - super_admin only.
// ==========================================================================
// Called from views/schools.js's "Issue subscription" modal
// (js/services/subscription.service.js's issueSubscriptionToken()). Mints a
// signed, single-use token for one school + plan + expiry and records it in
// subscription_tokens/{jti} so it can only ever be redeemed once (see
// subscription-activate.ts). Same "browser never talks to Firestore
// directly for this" shape as results-lookup.ts/media-upload.ts - the
// caller's Firebase ID token is verified against Firebase itself, then
// their own users/{uid} doc is read with a privileged service-account
// credential to confirm they're actually super_admin, entirely server-side.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY) and
// lib/subscription-tokens.ts (SUBSCRIPTION_TOKEN_SECRET).
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import {
  getAccessToken,
  getFsDoc,
  putFsDoc,
  addFsDoc,
  verifyFirebaseIdToken,
  jsonResponse,
} from "./lib/firestore-rest.ts";
import {
  signSubscriptionToken,
  addMonthsUTC,
  TERM_MONTHS,
  YEAR_MONTHS,
  MAX_CUSTOM_YEARS,
  VALID_PLANS,
} from "./lib/subscription-tokens.ts";

function isValidPlan(v: unknown): v is (typeof VALID_PLANS)[number] {
  return typeof v === "string" && (VALID_PLANS as readonly string[]).includes(v);
}

function computeExpiresAt(duration: unknown, customExpiresAt: unknown): Date | { error: string } {
  const now = new Date();
  if (duration === "term") return addMonthsUTC(now, TERM_MONTHS);
  if (duration === "year") return addMonthsUTC(now, YEAR_MONTHS);
  if (duration === "custom") {
    if (typeof customExpiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(customExpiresAt)) {
      return { error: "Please provide a valid custom expiry date." };
    }
    // Treat the date input as end-of-day UTC so "today" is still a usable
    // (if unusual) choice rather than immediately expired.
    const d = new Date(`${customExpiresAt}T23:59:59.000Z`);
    if (Number.isNaN(d.getTime())) return { error: "Please provide a valid custom expiry date." };
    if (d.getTime() <= now.getTime()) return { error: "The expiry date must be in the future." };
    const ceiling = addMonthsUTC(now, MAX_CUSTOM_YEARS * 12);
    if (d.getTime() > ceiling.getTime()) return { error: `Custom expiry can't be more than ${MAX_CUSTOM_YEARS} years out.` };
    return d;
  }
  return { error: "Please choose a valid duration." };
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const schoolId = String(body.schoolId || "").trim();
  const plan = body.plan;
  if (!schoolId) return jsonResponse({ error: "A school is required." }, 400);
  if (!isValidPlan(plan)) return jsonResponse({ error: "Please choose a valid plan." }, 400);

  const expiresAt = computeExpiresAt(body.duration, body.customExpiresAt);
  if (!(expiresAt instanceof Date)) return jsonResponse(expiresAt, 400);

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  const tokenSecret = Netlify.env.get("SUBSCRIPTION_TOKEN_SECRET");
  if (!tokenSecret) {
    console.error("subscription-issue: SUBSCRIPTION_TOKEN_SECRET not set");
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("subscription-issue: service account auth failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  // Confirm the caller is genuinely super_admin - never trust a role claim
  // from the browser, this is looked up fresh from their own profile doc.
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("subscription-issue: caller lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only the platform administrator can issue subscription tokens." }, 403);
  }

  let school: Record<string, any> | null;
  try {
    school = await getFsDoc(accessToken, `schools/${schoolId}`);
  } catch (err) {
    console.error("subscription-issue: school lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!school) return jsonResponse({ error: "That school doesn't exist." }, 404);

  const jti = crypto.randomUUID();
  let token: string;
  try {
    token = await signSubscriptionToken(tokenSecret, { sid: schoolId, p: plan, exp: expiresAt.toISOString(), jti });
  } catch (err) {
    console.error("subscription-issue: signing failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  try {
    // subscription_tokens/{jti} - a brand-new doc with exactly these
    // fields, so a full-overwrite putFsDoc is fine here (nothing else on
    // this doc to preserve).
    await putFsDoc(accessToken, `subscription_tokens/${jti}`, {
      schoolId,
      plan,
      expiresAt,
      issuedBy: uid,
      issuedAt: new Date(),
      consumedAt: null,
      consumedBy: null,
    });
    await addFsDoc(accessToken, "audit_logs", {
      schoolId: null,
      userId: uid,
      action: "issue_subscription_token",
      entity: "subscription_tokens",
      entityId: jti,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("subscription-issue: write failed", err);
    return jsonResponse({ error: "Couldn't issue a token. Please try again." }, 500);
  }

  return jsonResponse({ token, expiresAt: expiresAt.toISOString(), plan, jti }, 200);
};

export const config = {
  path: "/subscription-issue",
  // Low-volume, super_admin-only action - generous enough for real use,
  // tight enough to blunt a compromised session hammering the endpoint.
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
