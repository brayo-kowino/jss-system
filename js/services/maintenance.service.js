// ==========================================================================
// Emergency Platform Killswitch & Maintenance Service
//
// Allows Super Administrators to globally cut off inbound Firestore client
// connections, freeze pending background writes / auto-saves, and mount
// a full-screen maintenance lockdown across all connected client tabs worldwide.
// ==========================================================================

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  enableNetwork,
  disableNetwork,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

export const MAINTENANCE_DOC_PATH = ["platform_settings", "maintenance"];
export const LOCKDOWN_EVENT = "eeskia-platform-lockdown";
export const RESTORED_EVENT = "eeskia-platform-restored";

let activeState = {
  active: false,
  reason: "",
  estimatedDuration: "",
  activatedAt: null,
  activatedBy: null,
  allowSuperAdminBypass: true,
};

let watchdogUnsubscribe = null;
let currentProfileGetter = null;
let overlayElement = null;
let bannerElement = null;

/**
 * Returns current in-memory maintenance status.
 */
export function getMaintenanceState() {
  return { ...activeState };
}

/**
 * Check if the platform is currently locked down for normal users.
 */
export function isPlatformLockedDown() {
  return activeState.active === true;
}

/**
 * Reads the latest maintenance document directly from Firestore.
 */
export async function fetchMaintenanceStatus() {
  try {
    const snap = await getDoc(doc(db, ...MAINTENANCE_DOC_PATH));
    if (snap.exists()) {
      activeState = { ...activeState, ...snap.data() };
      return activeState;
    }
  } catch (err) {
    console.warn("[maintenance] Failed to fetch maintenance status:", err);
  }
  return { ...activeState, active: false };
}

/**
 * Subscribe to real-time maintenance updates from Firestore.
 */
export function subscribeMaintenanceStatus(callback) {
  try {
    const ref = doc(db, ...MAINTENANCE_DOC_PATH);
    return onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          activeState = { ...activeState, ...snap.data() };
        } else {
          activeState = { active: false, reason: "", estimatedDuration: "" };
        }
        try {
          callback(getMaintenanceState());
        } catch (err) {
          console.error("[maintenance] Subscriber error:", err);
        }
      },
      (err) => {
        // In offline / network-disabled / permission state, safely ignore without crashing
        console.warn("[maintenance] Listener notice:", err?.message || err);
      }
    );
  } catch (err) {
    console.warn("[maintenance] subscribeMaintenanceStatus error:", err);
    return () => {};
  }
}

/**
 * Engages or disengages the platform emergency killswitch.
 * Only callable by super_admin per firestore.rules.
 */
export async function setEmergencyKillswitch(superAdminUid, { active, reason, estimatedDuration }) {
  if (!superAdminUid) {
    throw new Error("Super admin credentials required to alter platform killswitch.");
  }

  const ref = doc(db, ...MAINTENANCE_DOC_PATH);
  const payload = {
    active: Boolean(active),
    reason: (reason || "").trim() || "Emergency platform maintenance. Inbound connections paused.",
    estimatedDuration: (estimatedDuration || "").trim() || "Temporary",
    updatedAt: serverTimestamp(),
    updatedBy: superAdminUid,
  };

  if (active) {
    payload.activatedAt = serverTimestamp();
    payload.activatedBy = superAdminUid;
  } else {
    payload.deactivatedAt = serverTimestamp();
    payload.deactivatedBy = superAdminUid;
  }

  await setDoc(ref, payload, { merge: true });

  await logAction(
    superAdminUid,
    active ? "activate_emergency_killswitch" : "deactivate_emergency_killswitch",
    "platform_settings",
    "maintenance",
    { reason: payload.reason, estimatedDuration: payload.estimatedDuration }
  );

  activeState = { ...activeState, ...payload };
  return activeState;
}

/**
 * Stops the active maintenance watchdog listener.
 */
export function stopMaintenanceWatchdog() {
  if (watchdogUnsubscribe) {
    try {
      watchdogUnsubscribe();
    } catch {}
    watchdogUnsubscribe = null;
  }
}

/**
 * Initializes the global client-side maintenance watchdog.
 * Runs on every client tab to enforce real-time socket shutdown and screen takeover.
 */
export function initMaintenanceWatchdog(getProfileFn) {
  currentProfileGetter = getProfileFn;
  stopMaintenanceWatchdog();

  // If there is no authenticated profile, do NOT start an unauthenticated Firestore stream
  const profile = typeof currentProfileGetter === "function" ? currentProfileGetter() : null;
  if (!profile) {
    return () => {};
  }

  try {
    watchdogUnsubscribe = subscribeMaintenanceStatus(async (state) => {
      await applyClientMaintenancePolicy(state);
    });
  } catch (err) {
    console.warn("[maintenance] Watchdog subscription notice:", err);
  }

  return watchdogUnsubscribe;
}

/**
 * Enforces the maintenance policy on the current browser tab.
 */
export async function applyClientMaintenancePolicy(state) {
  const profile = typeof currentProfileGetter === "function" ? currentProfileGetter() : null;
  const isSuperAdmin = profile?.role === "super_admin";

  if (state.active) {
    // Platform is in EMERGENCY LOCKDOWN
    if (isSuperAdmin) {
      if (typeof window !== "undefined") window.__eeskiaEmergencyLockdown = false;
      // Super admin is allowed in to diagnose and restore
      try {
        await enableNetwork(db);
      } catch {}
      removeLockdownOverlay();
      mountSuperAdminWarningBanner(state);
    } else {
      if (typeof window !== "undefined") window.__eeskiaEmergencyLockdown = true;
      // Normal staff / students / anonymous visitors: SEVER NETWORK & LOCK SCREEN
      removeSuperAdminWarningBanner();
      try {
        await disableNetwork(db);
      } catch (err) {
        console.warn("[maintenance] disableNetwork notice:", err);
      }

      // Dispatch global freeze event so forms and autosaves cancel timers
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(LOCKDOWN_EVENT, {
            detail: { reason: state.reason, estimatedDuration: state.estimatedDuration },
          })
        );
      }

      mountLockdownOverlay(state);
    }
  } else {
    // Normal operation
    if (typeof window !== "undefined") window.__eeskiaEmergencyLockdown = false;
    removeSuperAdminWarningBanner();
    removeLockdownOverlay();

    try {
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        await enableNetwork(db);
      }
    } catch {}

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(RESTORED_EVENT));
    }
  }
}

/**
 * Creates and displays an uncloseable full-screen emergency maintenance overlay.
 */
function mountLockdownOverlay(state) {
  if (typeof document === "undefined") return;

  if (!overlayElement || !overlayElement.isConnected) {
    overlayElement = document.createElement("div");
    overlayElement.id = "eeskia-emergency-lockdown-overlay";
    overlayElement.setAttribute("role", "alertdialog");
    overlayElement.setAttribute("aria-modal", "true");
    overlayElement.setAttribute("aria-labelledby", "lockdown-title");

    overlayElement.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(11, 37, 69, 0.96);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #FFFFFF;
      overflow-y: auto;
    `;

    document.body.appendChild(overlayElement);
  }

  const reasonText = state.reason || "Platform operations have been temporarily paused for emergency maintenance.";
  const durationText = state.estimatedDuration ? `Estimated window: ${state.estimatedDuration}` : "";

  overlayElement.innerHTML = `
    <div style="
      max-width: 500px;
      width: 100%;
      background: #FFFFFF;
      color: #1A202C;
      border-radius: 16px;
      padding: 36px 28px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
    ">
      <div style="
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: #FEE2E2;
        color: #DC2626;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 20px;
        box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.15);
      ">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>

      <div style="
        display: inline-block;
        padding: 4px 12px;
        background: #FEE2E2;
        color: #991B1B;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 12px;
      ">
        Inbound Connections Suspended
      </div>

      <h1 id="lockdown-title" style="
        margin: 0 0 10px;
        font-size: 22px;
        font-weight: 700;
        color: #0F172A;
      ">
        System Under Emergency Maintenance
      </h1>

      <p style="
        margin: 0 0 16px;
        font-size: 14px;
        line-height: 1.6;
        color: #475569;
      ">
        ${escapeHtml(reasonText)}
      </p>

      ${
        durationText
          ? `<p style="
              margin: 0 0 24px;
              font-size: 13px;
              color: #64748B;
              font-weight: 500;
            ">${escapeHtml(durationText)}</p>`
          : ""
      }

      <div style="
        background: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 10px;
        padding: 14px;
        margin-bottom: 24px;
        font-size: 12px;
        color: #64748B;
        text-align: left;
        line-height: 1.5;
      ">
        <strong style="color: #334155;">Data Protection Active:</strong>
        All client-side database connections have been temporarily disconnected to ensure zero data corruption. Auto-saves and unsaved background syncs are paused.
      </div>

      <button id="eeskia-recheck-btn" style="
        background: #0B2545;
        color: #FFFFFF;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: background 0.2s;
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        Recheck Platform Status
      </button>
    </div>
  `;

  const btn = overlayElement.querySelector("#eeskia-recheck-btn");
  if (btn) {
    btn.onclick = () => {
      btn.textContent = "Checking status…";
      setTimeout(() => {
        location.reload();
      }, 500);
    };
  }
}

/**
 * Removes the full-screen emergency maintenance overlay.
 */
function removeLockdownOverlay() {
  if (overlayElement) {
    if (overlayElement.parentNode) {
      overlayElement.parentNode.removeChild(overlayElement);
    }
    overlayElement = null;
  }
}

/**
 * Mounts a warning banner for Super Admins when platform killswitch is engaged.
 */
function mountSuperAdminWarningBanner(state) {
  if (typeof document === "undefined") return;

  if (!bannerElement || !bannerElement.isConnected) {
    bannerElement = document.createElement("div");
    bannerElement.id = "eeskia-superadmin-killswitch-banner";
    bannerElement.style.cssText = `
      position: sticky;
      top: 0;
      z-index: 999999;
      background: #DC2626;
      color: #FFFFFF;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    `;

    document.body.prepend(bannerElement);
  }

  bannerElement.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="font-size: 16px;">🚨</span>
      <span>EMERGENCY PLATFORM KILLSWITCH IS ACTIVE — Inbound client Firestore connections are severed worldwide.</span>
    </div>
    <a href="#/platform-settings?tab=security" style="
      background: #FFFFFF;
      color: #DC2626;
      padding: 4px 10px;
      border-radius: 4px;
      text-decoration: none;
      font-size: 12px;
      white-space: nowrap;
    ">
      Manage Killswitch
    </a>
  `;
}

/**
 * Removes the super admin warning banner.
 */
function removeSuperAdminWarningBanner() {
  if (bannerElement) {
    if (bannerElement.parentNode) {
      bannerElement.parentNode.removeChild(bannerElement);
    }
    bannerElement = null;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
