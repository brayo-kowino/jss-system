// ==========================================================================
// List issued subscription tokens - super_admin only.
// ==========================================================================
// subscription_tokens/{jti} is `allow read, write: if false` in
// firestore.rules on purpose (see that file's comment) - it's a
// server-side ledger, not a collection any client SDK call can reach. This
// is the one deliberate window into it, for the Schools page's "token-issue
// history" panel (js/services/subscription.service.js's
// listSubscriptionTokens()). Read-only, super_admin-gated the same way
// subscription-issue.ts is.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc, runFsQuery, verifyFirebaseIdToken, jsonResponse } from "./lib/firestore-rest.ts";

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "You must be signed in." }, 401);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("subscription-tokens-list: service account auth failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }

  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${uid}`);
  } catch (err) {
    console.error("subscription-tokens-list: caller lookup failed", err);
    return jsonResponse({ error: "Subscription service is temporarily unavailable." }, 500);
  }
  if (!caller || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only the platform administrator can view token history." }, 403);
  }

  const url = new URL(request.url);
  const schoolId = url.searchParams.get("schoolId")?.trim();

  let tokens: Record<string, any>[];
  try {
    tokens = schoolId
      ? await runFsQuery(accessToken, "subscription_tokens", [["schoolId", "EQUAL", schoolId]])
      : await runFsQuery(accessToken, "subscription_tokens", []);
  } catch (err) {
    console.error("subscription-tokens-list: query failed", err);
    return jsonResponse({ error: "Couldn't load token history." }, 500);
  }

  tokens.sort((a, b) => new Date(b.issuedAt || 0).getTime() - new Date(a.issuedAt || 0).getTime());

  return jsonResponse(
    {
      tokens: tokens.map((t) => ({
        id: t.id,
        schoolId: t.schoolId,
        plan: t.plan,
        expiresAt: t.expiresAt,
        issuedBy: t.issuedBy,
        issuedAt: t.issuedAt,
        consumedAt: t.consumedAt || null,
        consumedBy: t.consumedBy || null,
      })),
    },
    200,
  );
};

export const config = {
  path: "/subscription-tokens-list",
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
