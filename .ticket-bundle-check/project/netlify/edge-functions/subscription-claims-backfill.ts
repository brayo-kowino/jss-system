// ==========================================================================
// ONE-TIME BACKFILL: mint subscriptionActiveUntil for every school's staff.
// ==========================================================================
// Needed once, the first time firestore.rules' isSubscriptionActive() moves
// from a live get() on schools/{schoolId} to the subscriptionActiveUntil
// custom claim (see the comment on isSubscriptionActive() in
// firestore.rules and on syncSubscriptionClaims() in lib/firestore-rest.ts).
//
// syncSubscriptionClaims() only ever runs as a side effect of
// subscription-activate.ts / subscription-revoke.ts / school-status.ts -
// i.e. something *changing*. A school whose subscription was already
// active before the new rules deployed never went through any of those
// paths, so its staff's ID tokens have NO subscriptionActiveUntil claim at
// all - not an expired one, an absent one - and isSubscriptionActive()'s
// `'subscriptionActiveUntil' in request.auth.token` check fails outright.
// That's a hard permission-denied on every operational read/write for
// every pre-existing school, until this runs once.
//
// super_admin only, and deliberately idempotent/safe to re-run - it's
// just syncSubscriptionClaims() for every school in one pass, so running
// it twice (or on a school that already has a claim) is a no-op beyond
// re-writing the same value.
//
// AFTER RUNNING THIS: existing signed-in sessions still won't see the new
// claim until their ID token refreshes (Firebase does this automatically,
// roughly hourly). To pick it up immediately, sign out and back in, or
// call `await auth.currentUser.getIdToken(true)` from the console.
//
// DELETE THIS FILE once you've confirmed the backfill ran successfully -
// it's a migration script, not a permanent piece of the app, and leaving
// it deployed means an unused privileged endpoint. Same guard style as
// the other privileged edge functions until then.
//
// REQUIRED SETUP: see lib/firestore-rest.ts (GOOGLE_SERVICE_ACCOUNT_KEY).
// No new secret needed.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, listFsDocs, syncSubscriptionClaims, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Tight limit - this is a migration tool meant to be called a handful
  // of times total, not a routine action.
  const rl = await checkRateLimit(`subscription-claims-backfill:${clientIp(request, context)}`, 3, 60);
  if (!rl.allowed) {
    return rateLimitedResponse(rl.retryAfterSeconds);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("subscription-claims-backfill: service account auth failed", err);
    return jsonResponse({ error: "Service is temporarily unavailable." }, 500);
  }

  // Confirm the caller is genuinely super_admin - same pattern as every
  // other privileged edge function in this project.
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("subscription-claims-backfill: caller lookup failed", err);
    return jsonResponse({ error: "Service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.status === "suspended" || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only the platform administrator can run this." }, 403);
  }

  let schools: Record<string, any>[];
  try {
    schools = await listFsDocs(accessToken, "schools");
  } catch (err) {
    console.error("subscription-claims-backfill: school list failed", err);
    return jsonResponse({ error: "Couldn't list schools." }, 500);
  }

  const results: Array<{ schoolId: string; ok: boolean; error?: string }> = [];
  for (const school of schools) {
    if (!school.id) continue;
    try {
      await syncSubscriptionClaims(accessToken, school.id);
      results.push({ schoolId: school.id, ok: true });
    } catch (err) {
      console.error(`subscription-claims-backfill: failed for school ${school.id}`, err);
      results.push({ schoolId: school.id, ok: false, error: String(err) });
    }
  }

  return jsonResponse(
    { schoolsProcessed: results.length, failed: results.filter((r) => !r.ok).length, results },
    200,
  );
};

export const config = {
  path: "/subscription-claims-backfill",
};
