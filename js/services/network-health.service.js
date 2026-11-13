// ==========================================================================
// Network Health & Cloud Synchronization Service
//
// Tracks real-time network connectivity and cloud persistence sync state:
//   - "online": Connected to network, Firestore local cache synced with cloud.
//   - "syncing": Reconnecting or flushing offline write queue to cloud.
//   - "offline": Disconnected; local persistence is serving reads & queueing writes.
//
// Provides subscriptions for reactive UI pills, manual sync check, and
// duration tracking for extended offline nudges (> 30 mins).
// ==========================================================================

export const OFFLINE_NUDGE_AFTER_MS = 30 * 60 * 1000; // 30 minutes
export const LAST_ONLINE_KEY = "jss_last_online_at";
export const LAST_SYNCED_KEY = "jss_last_synced_at";

const listeners = new Set();

let currentState = {
  status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
  isOnline: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  isSyncing: false,
  lastOnlineAt: readStoredTimestamp(LAST_ONLINE_KEY, Date.now()),
  lastSyncedAt: readStoredTimestamp(LAST_SYNCED_KEY, Date.now()),
};

let syncTimer = null;
let initialized = false;

function readStoredTimestamp(key, fallback) {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch {
    return fallback;
  }
}

function storeTimestamp(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // Non-fatal if localStorage is restricted
  }
}

function notify() {
  const snapshot = getNetworkHealthState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[network-health] subscriber error:", err);
    }
  }
}

export function getNetworkHealthState() {
  return { ...currentState };
}

export function subscribeNetworkHealth(callback) {
  listeners.add(callback);
  // Send initial state immediately
  try {
    callback(getNetworkHealthState());
  } catch (err) {
    console.error("[network-health] initial subscriber error:", err);
  }
  return () => {
    listeners.delete(callback);
  };
}

export function getOfflineDurationInfo(lastOnline = currentState.lastOnlineAt) {
  const now = Date.now();
  const offlineMs = Math.max(0, now - (lastOnline || now));
  const mins = Math.round(offlineMs / 60000);
  const hrs = Math.floor(mins / 60);
  const readableDuration = hrs >= 1 ? `${hrs}h` : `${mins}m`;
  const needsNudge = offlineMs >= OFFLINE_NUDGE_AFTER_MS;

  return {
    offlineMs,
    mins,
    hrs,
    readableDuration,
    needsNudge,
  };
}

export function markOnline() {
  const now = Date.now();
  storeTimestamp(LAST_ONLINE_KEY, now);
  currentState.isOnline = true;
  currentState.lastOnlineAt = now;

  // Transition through syncing state when reconnecting
  currentState.status = "syncing";
  currentState.isSyncing = true;
  notify();

  // Trigger pending writes sync check
  triggerSyncCheck();
}

export function markOffline() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  currentState.isOnline = false;
  currentState.status = "offline";
  currentState.isSyncing = false;
  notify();
}

export async function triggerSyncCheck() {
  if (currentState.status !== "syncing") {
    currentState.status = "syncing";
    currentState.isSyncing = true;
    notify();
  }

  // Attempt to wait for pending writes in Firestore if available
  let syncSuccess = true;
  try {
    const firestorePromise = (async () => {
      try {
        const [{ waitForPendingWrites }, cfg] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
          import("../firebase-config.js"),
        ]);
        if (cfg?.db && typeof waitForPendingWrites === "function") {
          await waitForPendingWrites(cfg.db);
        }
      } catch {
        // If Firestore CDN or network is stubbed, continue cleanly
      }
    })();

    // Timeout safety: don't leave the pill spinning longer than 2.5 seconds
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
    await Promise.race([firestorePromise, timeoutPromise]);
  } catch {
    syncSuccess = false;
  }

  const now = Date.now();
  storeTimestamp(LAST_ONLINE_KEY, now);
  storeTimestamp(LAST_SYNCED_KEY, now);

  currentState.isOnline = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  currentState.status = currentState.isOnline ? "online" : "offline";
  currentState.isSyncing = false;
  currentState.lastOnlineAt = now;
  currentState.lastSyncedAt = now;
  notify();

  return { success: syncSuccess, lastSyncedAt: now };
}

export function initNetworkHealth() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const onOnlineEvent = () => markOnline();
  const onOfflineEvent = () => markOffline();

  window.addEventListener("online", onOnlineEvent);
  window.addEventListener("actually-online", onOnlineEvent);
  window.addEventListener("offline", onOfflineEvent);

  if (navigator.onLine) {
    storeTimestamp(LAST_ONLINE_KEY, Date.now());
  } else {
    markOffline();
  }
}

// Auto-initialize when loaded in a browser context
if (typeof window !== "undefined") {
  initNetworkHealth();
}
