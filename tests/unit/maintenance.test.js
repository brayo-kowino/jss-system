import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Firebase Firestore functions
vi.mock("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js", () => {
  return {
    doc: vi.fn((db, ...path) => ({ path: path.join("/") })),
    getDoc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(true),
    onSnapshot: vi.fn((ref, callback) => {
      // Return unlisten fn
      return vi.fn();
    }),
    serverTimestamp: vi.fn(() => ({ _methodName: "serverTimestamp" })),
    enableNetwork: vi.fn().mockResolvedValue(undefined),
    disableNetwork: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../js/firebase-config.js", () => ({
  db: { id: "mock-db" },
}));

vi.mock("../../js/services/audit.service.js", () => ({
  logAction: vi.fn().mockResolvedValue(true),
}));

import {
  getMaintenanceState,
  isPlatformLockedDown,
  applyClientMaintenancePolicy,
  setEmergencyKillswitch,
  initMaintenanceWatchdog,
  LOCKDOWN_EVENT,
  RESTORED_EVENT,
} from "../../js/services/maintenance.service.js";
import { enableNetwork, disableNetwork } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

describe("Emergency Platform Killswitch & Maintenance Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    initMaintenanceWatchdog(() => null);
    if (typeof window !== "undefined") {
      window.__eeskiaEmergencyLockdown = false;
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports unlocked by default", () => {
    const state = getMaintenanceState();
    expect(state.active).toBe(false);
    expect(isPlatformLockedDown()).toBe(false);
  });

  it("throws if setEmergencyKillswitch is called without superAdminUid", async () => {
    await expect(setEmergencyKillswitch(null, { active: true })).rejects.toThrow(
      "Super admin credentials required"
    );
  });

  it("severs network, freezes client and shows full-screen overlay for regular users on lockdown", async () => {
    const eventSpy = vi.fn();
    window.addEventListener(LOCKDOWN_EVENT, eventSpy);

    const lockdownState = {
      active: true,
      reason: "Emergency data repair in progress.",
      estimatedDuration: "20 minutes",
    };

    // User is a teacher/student (not super_admin)
    await applyClientMaintenancePolicy(lockdownState);

    expect(disableNetwork).toHaveBeenCalled();
    expect(window.__eeskiaEmergencyLockdown).toBe(true);
    expect(eventSpy).toHaveBeenCalled();
    expect(eventSpy.mock.calls[0][0].detail.reason).toBe("Emergency data repair in progress.");

    const overlay = document.getElementById("eeskia-emergency-lockdown-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain("System Under Emergency Maintenance");
    expect(overlay.textContent).toContain("Emergency data repair in progress.");
    expect(overlay.textContent).toContain("20 minutes");

    window.removeEventListener(LOCKDOWN_EVENT, eventSpy);
  });

  it("allows super_admin bypass and shows warning banner instead of locking screen", async () => {
    const mockSuperAdminProfile = { role: "super_admin", uid: "sa-123" };
    const { initMaintenanceWatchdog } = await import("../../js/services/maintenance.service.js");
    initMaintenanceWatchdog(() => mockSuperAdminProfile);

    const lockdownState = {
      active: true,
      reason: "Database maintenance",
      estimatedDuration: "10 mins",
    };

    await applyClientMaintenancePolicy(lockdownState);

    // Super admin must NOT have network disabled
    expect(enableNetwork).toHaveBeenCalled();
    expect(window.__eeskiaEmergencyLockdown).toBe(false);

    // Full-screen overlay should NOT be present
    const overlay = document.getElementById("eeskia-emergency-lockdown-overlay");
    expect(overlay).toBeNull();

    // Prominent warning banner SHOULD be mounted
    const banner = document.getElementById("eeskia-superadmin-killswitch-banner");
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("EMERGENCY PLATFORM KILLSWITCH IS ACTIVE");
  });

  it("restores network, removes overlay/banner and emits restored event when lockdown is deactivated", async () => {
    const restoredSpy = vi.fn();
    window.addEventListener(RESTORED_EVENT, restoredSpy);

    // First trigger lockdown
    await applyClientMaintenancePolicy({ active: true, reason: "Locking down" });
    expect(document.getElementById("eeskia-emergency-lockdown-overlay")).not.toBeNull();

    // Now restore
    await applyClientMaintenancePolicy({ active: false });

    expect(enableNetwork).toHaveBeenCalled();
    expect(window.__eeskiaEmergencyLockdown).toBe(false);
    expect(document.getElementById("eeskia-emergency-lockdown-overlay")).toBeNull();
    expect(document.getElementById("eeskia-superadmin-killswitch-banner")).toBeNull();
    expect(restoredSpy).toHaveBeenCalled();

    window.removeEventListener(RESTORED_EVENT, restoredSpy);
  });
});
