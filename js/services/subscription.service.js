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

// Mirrors VALID_REVOKE_REASONS in netlify/edge-functions/subscription-revoke.ts
// - that's the list actually enforced server-side, this one only drives
// the Schools page's dropdown. "other" requires a note (enforced both
// client- and server-side).
export const REVOKE_REASONS = [
  { value: "non_payment", label: "Non-payment on an active term" },
  { value: "chargeback", label: "Chargeback / payment reversal" },
  { value: "fraudulent_payment", label: "Fraudulent payment" },
  { value: "contract_default", label: "Contract default" },
  { value: "issued_in_error", label: "Issued in error" },
  { value: "other", label: "Other" },
];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + (value.nanoseconds ? Math.floor(value.nanoseconds / 1e6) : 0));
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000 + (value._nanoseconds ? Math.floor(value._nanoseconds / 1e6) : 0));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Single shared definition of "active" on the client - a school doc (or
// the settings.service.js merge-over-DEFAULT_SETTINGS shape, which is the
// same doc) in, { active, daysRemaining, suspended, revoked } out.
// daysRemaining is negative once lapsed (so callers can show "expired 3
// days ago").
//
// Checked in this order, each an independent way to be locked out:
//  1. `status: "suspended"` (Platform Admin's Suspend button) - an
//     operational hold, unrelated to payment. Only lifted by the platform
//     admin reactivating; see subscription-locked.js, which hides the
//     token form for this case.
//  2. `subscriptionStatus: "revoked"` (Platform Admin's Revoke subscription
//     action, subscription-revoke.ts) - a billing-family cutoff of an
//     already-active term (non-payment, chargeback, fraud, etc. - see
//     REVOKE_REASONS above). Lifted the same way an expired subscription
//     is: the platform admin issues a fresh token. Reported distinctly
//     from plain "expired" so the lock screen can name the reason, but
//     subscriptionExpiresAt/subscriptionPlan are deliberately left alone
//     by the revoke action, so daysRemaining below would otherwise report
//     a misleading "still time left" - this branch short-circuits before
//     that math runs.
//  3. Plain expiry - subscriptionExpiresAt has simply passed, or a
//     subscription was never activated at all.
// This mirrors firestore.rules' isSubscriptionActive(), which is the real
// enforcement - this is only ever a same-tick UI reflection of it, never
// more permissive.
export function getSubscriptionState(school) {
  if (school?.status === "suspended") {
    return { active: false, daysRemaining: null, suspended: true, revoked: false };
  }
  if (school?.subscriptionStatus === "revoked") {
    return { active: false, daysRemaining: null, suspended: false, revoked: true, revokeReason: school.subscriptionRevokeReason || null, revokeNote: school.subscriptionRevokeNote || null };
  }
  const expiresAt = toDate(school?.subscriptionExpiresAt);
  if (!expiresAt || school?.subscriptionStatus !== "active") {
    return { active: false, daysRemaining: null, suspended: false, revoked: false };
  }
  const msRemaining = expiresAt.getTime() - Date.now();
  return {
    active: msRemaining > 0,
    daysRemaining: Math.ceil(msRemaining / 86_400_000),
    suspended: false,
    revoked: false,
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
export async function activateSubscription(token) {
  const result = await callFunction("/subscription-activate", { payload: { token } });
  if (auth.currentUser) {
    try {
      await auth.currentUser.getIdToken(true);
    } catch (err) {
      console.error("Token refresh after subscription activation failed:", err);
    }
  }
  return result;
}

// super_admin only (enforced server-side by subscription-revoke.ts) - cuts
// an already-active, not-yet-expired subscription short. `reason` must be
// one of REVOKE_REASONS' values; `note` is required when reason is
// "other" and optional (max 500 chars, enforced server-side) otherwise.
// Returns { subscriptionStatus: "revoked", subscriptionRevokeReason }.
export function revokeSubscription({ schoolId, reason, note }) {
  return callFunction("/subscription-revoke", { payload: { schoolId, reason, note } });
}

// super_admin only (enforced server-side by subscription-tokens-list.ts) -
// subscription_tokens is otherwise unreadable by any client (see
// firestore.rules), this is the one deliberate window into it, for the
// Schools page's token-issue history. Returns { tokens: [...] }.
export function listSubscriptionTokens(schoolId) {
  return callFunction("/subscription-tokens-list", { method: "GET", query: schoolId ? { schoolId } : undefined });
}