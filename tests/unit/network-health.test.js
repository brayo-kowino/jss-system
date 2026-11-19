import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getNetworkHealthState,
  subscribeNetworkHealth,
  markOnline,
  markOffline,
  triggerSyncCheck,
  getOfflineDurationInfo,
  OFFLINE_NUDGE_AFTER_MS,
  LAST_ONLINE_KEY,
} from "../../js/services/network-health.service.js";

describe("Network Health & Sync Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("provides initial state with valid health properties", () => {
    const state = getNetworkHealthState();
    expect(state).toBeDefined();
    expect(["online", "offline", "syncing"]).toContain(state.status);
    expect(typeof state.isOnline).toBe("boolean");
    expect(typeof state.isSyncing).toBe("boolean");
    expect(typeof state.lastOnlineAt).toBe("number");
    expect(typeof state.lastSyncedAt).toBe("number");
  });

  it("subscribes and notifies listener immediately and on state changes", () => {
    const listener = vi.fn();
    const unsub = subscribeNetworkHealth(listener);

    // Initial immediate notification
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].status).toBeDefined();

    // Mark offline
    markOffline();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].status).toBe("offline");
    expect(listener.mock.calls[1][0].isOnline).toBe(false);

    // Unsubscribe
    unsub();
    markOffline();
    expect(listener).toHaveBeenCalledTimes(2); // no extra calls after unsub
  });

  it("calculates offline duration and reconnect nudge correctly", () => {
    const now = Date.now();

    // 5 minutes offline
    const shortOffline = now - 5 * 60 * 1000;
    const infoShort = getOfflineDurationInfo(shortOffline);
    expect(infoShort.mins).toBe(5);
    expect(infoShort.needsNudge).toBe(false);
    expect(infoShort.readableDuration).toBe("5m");

    // 45 minutes offline (> 30 min nudge threshold)
    const longOffline = now - 45 * 60 * 1000;
    const infoLong = getOfflineDurationInfo(longOffline);
    expect(infoLong.mins).toBe(45);
    expect(infoLong.needsNudge).toBe(true);

    // 2 hours offline
    const veryLongOffline = now - 120 * 60 * 1000;
    const infoVeryLong = getOfflineDurationInfo(veryLongOffline);
    expect(infoVeryLong.hrs).toBe(2);
    expect(infoVeryLong.needsNudge).toBe(true);
    expect(infoVeryLong.readableDuration).toBe("2h");
  });

  it("triggers manual sync check and updates state upon completion", async () => {
    const states = [];
    const unsub = subscribeNetworkHealth((s) => states.push(s.status));

    const result = await triggerSyncCheck();
    expect(result).toBeDefined();
    expect(typeof result.lastSyncedAt).toBe("number");

    // Transitioned through syncing or finished online
    expect(states).toContain("syncing");
    const finalState = getNetworkHealthState();
    expect(finalState.isSyncing).toBe(false);

    unsub();
  });
});
