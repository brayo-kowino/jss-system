// ==========================================================================
// Subscription service (client side).
// ==========================================================================
// The actual writes to schools/{id}'s subscription fields never happen from
// here, or anywhere else in the browser - firestore.rules' touchesSubscription
// Fields() carve-out blocks that outright, even for an admin editing their
// own school. This module only ever talks to two same-origin endpoints,
// handled by netlify/edge-functions/subscription-issue.ts and
// subscription-activate.ts, which hold the one Google service-account
// credential capable of writing those fields (see those files' headers for
// why they're edge functions rather than a Netlify Function/Admin SDK).
//
// getSubscriptionState() is the one shared definition of "is this school's
// subscription currently active" used on the client - by the Schools page
// badge, the Settings > Subscription tab, and indirectly by router.js's
// lock gate (which reads getCurrentSchool() from auth.service.js and calls
// this same function). The database-level truth is firestore.rules'
// isSubscriptionActive(), evaluated fresh against request.time on every
// read/write - this is just that same comparison done client-side for
// display purposes, so it can never be more permissive than the rule, only
// ever a UI-layer mirror of it.
// ==========================================================================
import { auth } from "../firebase-config.js";

export const SUBSCRIPTION_PLANS = [
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "district", label: "District" },
];

// "term" maps to TERM_MONTHS below (kept as a single tweakable constant
// since Kenyan CBC runs 3 terms/year - 4 months is one term's worth, not a
// hardcoded date range). Must match the identical constant in
// subscription-issue.ts - see the comment there.
export const SUBSCRIPTION_DURATIONS = [
  { value: "term", label: "1 Term (4 months)" },
  { value: "year", label: "1 Year" },
  { value: "custom", label: "Custom date" },
];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Single shared definition of "active" on the client - a school doc (or
// the settings.service.js merge-over-DEFAULT_SETTINGS shape, which is the
// same doc) in, { active, daysRemaining } out. daysRemaining is negative
// once lapsed (so callers can show "expired 3 days ago").
export function getSubscriptionState(school) {
  const expiresAt = toDate(school?.subscriptionExpiresAt);
  if (!expiresAt || school?.subscriptionStatus !== "active") {
    return { active: false, daysRemaining: null };
  }
  const msRemaining = expiresAt.getTime() - Date.now();
  return {
    active: msRemaining > 0,
    daysRemaining: Math.ceil(msRemaining / 86_400_000),
  };
}

async function callFunction(path, { method = "POST", payload, query } = {}) {
  if (!auth.currentUser) throw new Error("You must be signed in.");
  const idToken = await auth.currentUser.getIdToken();
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(payload || {}) }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Unexpected response from the server.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// super_admin only (enforced server-side by subscription-issue.ts, not
// just by the Schools page route gate) - mints a single-use signed token
// for one school. Returns { token, expiresAt, plan, jti }.
export function issueSubscriptionToken({ schoolId, plan, duration, customExpiresAt }) {
  return callFunction("/subscription-issue", { payload: { schoolId, plan, duration, customExpiresAt } });
}

// School admin only (enforced server-side by subscription-activate.ts) -
// redeems a token for the caller's own school. Returns
// { subscriptionStatus, subscriptionPlan, subscriptionExpiresAt }.
export function activateSubscription(token) {
  return callFunction("/subscription-activate", { payload: { token } });
}

// super_admin only (enforced server-side by subscription-tokens-list.ts) -
// subscription_tokens is otherwise unreadable by any client (see
// firestore.rules), this is the one deliberate window into it, for the
// Schools page's token-issue history. Returns { tokens: [...] }.
export function listSubscriptionTokens(schoolId) {
  return callFunction("/subscription-tokens-list", { method: "GET", query: schoolId ? { schoolId } : undefined });
}