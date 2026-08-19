import { describe, it, expect } from "vitest";
import { getSubscriptionState } from "../../js/services/subscription.service.js";

describe("Subscription State Evaluation Logic", () => {
  it("returns suspended: true and active: false when school status is suspended", () => {
    const school = {
      status: "suspended",
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date(Date.now() + 86400000 * 30),
    };
    const state = getSubscriptionState(school);
    expect(state.active).toBe(false);
    expect(state.suspended).toBe(true);
    expect(state.revoked).toBe(false);
    expect(state.daysRemaining).toBeNull();
  });

  it("returns revoked: true and active: false when subscriptionStatus is revoked", () => {
    const school = {
      status: "active",
      subscriptionStatus: "revoked",
      subscriptionRevokeReason: "non_payment",
      subscriptionRevokeNote: "Failed payment notice sent",
      subscriptionExpiresAt: new Date(Date.now() + 86400000 * 30),
    };
    const state = getSubscriptionState(school);
    expect(state.active).toBe(false);
    expect(state.revoked).toBe(true);
    expect(state.revokeReason).toBe("non_payment");
    expect(state.revokeNote).toBe("Failed payment notice sent");
    expect(state.suspended).toBe(false);
    expect(state.daysRemaining).toBeNull();
  });

  it("returns active: true and positive daysRemaining when valid active subscription", () => {
    const thirtyDaysAhead = new Date(Date.now() + 86400000 * 30);
    const school = {
      status: "active",
      subscriptionStatus: "active",
      subscriptionExpiresAt: thirtyDaysAhead,
    };
    const state = getSubscriptionState(school);
    expect(state.active).toBe(true);
    expect(state.suspended).toBe(false);
    expect(state.revoked).toBe(false);
    expect(state.daysRemaining).toBeGreaterThanOrEqual(29);
    expect(state.daysRemaining).toBeLessThanOrEqual(31);
  });

  it("returns active: false and negative daysRemaining when subscription has expired", () => {
    const fiveDaysAgo = new Date(Date.now() - 86400000 * 5);
    const school = {
      status: "active",
      subscriptionStatus: "active",
      subscriptionExpiresAt: fiveDaysAgo,
    };
    const state = getSubscriptionState(school);
    expect(state.active).toBe(false);
    expect(state.suspended).toBe(false);
    expect(state.revoked).toBe(false);
    expect(state.daysRemaining).toBeLessThanOrEqual(0);
  });

  it("handles null, empty, or uninitialized school documents gracefully", () => {
    expect(getSubscriptionState(null)).toEqual({
      active: false,
      daysRemaining: null,
      suspended: false,
      revoked: false,
    });
    expect(getSubscriptionState({})).toEqual({
      active: false,
      daysRemaining: null,
      suspended: false,
      revoked: false,
    });
  });
});
