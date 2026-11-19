// ==========================================================================
// Version & App Freshness Service
// ==========================================================================
// Protects against:
//  - Stale cached JavaScript bundles causing false lockouts or login approval loops
//  - Protocol mismatches between old client code and updated server endpoints
//  - Stale PWA service worker shell caches
// ==========================================================================

const CURRENT_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0-dev";
const CURRENT_BUILD_ID = typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";
const CURRENT_BUILD_TIME = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";

const RELOAD_STATE_KEY = "jss_hard_refresh_state";
const LOOP_WINDOW_MS = 30000;
const MAX_REFRESH_ATTEMPTS = 2;

/**
 * Returns the currently running application build metadata.
 */
export function getCurrentVersion() {
  return {
    version: CURRENT_VERSION,
    buildId: CURRENT_BUILD_ID,
    builtAt: CURRENT_BUILD_TIME,
  };
}

/**
 * Checks whether the server version differs from the currently running client code.
 * @param {Object} remoteVersion - Remote version JSON object
 * @returns {boolean} True if remote build is strictly newer/different
 */
export function isAppOutdated(remoteVersion) {
  if (!remoteVersion || typeof remoteVersion !== "object") return false;
  const remoteBuildId = remoteVersion.buildId;
  if (!remoteBuildId || typeof remoteBuildId !== "string") return false;

  // Never trigger auto-reloads during local development if buildId is "dev"
  if (CURRENT_BUILD_ID === "dev" || remoteVersion.dev) return false;

  return remoteBuildId !== CURRENT_BUILD_ID;
}

/**
 * Fetches the freshest version.json metadata directly from the server,
 * strictly bypassing any browser HTTP cache and Service Worker caches.
 *
 * @param {Object} options
 * @param {number} [options.timeoutMs=2500] - Max time to wait before timing out (ms)
 * @returns {Promise<Object|null>} The parsed remote version metadata or null if unreachable
 */
export async function fetchServerVersion({ timeoutMs = 2500 } = {}) {
  // If the browser reports strictly offline, do not stall on fetch
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return null;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const cacheBuster = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const res = await fetch(`/version.json?_t=${cacheBuster}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Accept: "application/json",
      },
      signal: controller?.signal,
    });

    if (!res.ok) {
      console.warn(`[Version] Server returned HTTP ${res.status} for version.json`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    // Gracefully handle aborts, network errors, and offline modes
    if (err?.name !== "AbortError") {
      console.warn("[Version] Could not verify server version (offline or unreachable):", err?.message || err);
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Checks if a reload loop is happening to prevent infinite reload thrashing.
 */
function shouldPreventReloadLoop(targetVersion) {
  try {
    const raw = sessionStorage.getItem(RELOAD_STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    const now = Date.now();
    if (
      state.targetVersion === targetVersion &&
      now - state.timestamp < LOOP_WINDOW_MS &&
      state.attempts >= MAX_REFRESH_ATTEMPTS
    ) {
      return true;
    }
  } catch {
    // sessionStorage errors ignored
  }
  return false;
}

/**
 * Records a refresh attempt in sessionStorage.
 */
function recordReloadAttempt(targetVersion, reason) {
  try {
    const raw = sessionStorage.getItem(RELOAD_STATE_KEY);
    let attempts = 1;
    if (raw) {
      const state = JSON.parse(raw);
      if (state.targetVersion === targetVersion && Date.now() - state.timestamp < LOOP_WINDOW_MS) {
        attempts = (state.attempts || 1) + 1;
      }
    }
    sessionStorage.setItem(
      RELOAD_STATE_KEY,
      JSON.stringify({
        targetVersion,
        attempts,
        timestamp: Date.now(),
        reason,
      })
    );
  } catch {
    // sessionStorage errors ignored
  }
}

/**
 * Forces a clean, hard refresh of the application:
 * 1. Clears all Service Worker CacheStorage entries.
 * 2. Asks active Service Workers to update.
 * 3. Rewrites the URL with an explicit cache-busting search parameter so
 *    neither the browser HTTP cache nor Netlify edge cache serves stale HTML.
 *
 * @param {Object} [options]
 * @param {string} [options.reason="manual"]
 * @param {string} [options.targetVersion=null]
 * @param {boolean} [options.clearCaches=true]
 * @returns {Promise<boolean>} True if refresh initiated, false if prevented by loop guard
 */
export async function forceHardRefresh({
  reason = "manual",
  targetVersion = null,
  clearCaches = true,
} = {}) {
  const versionKey = targetVersion || "unknown";

  if (shouldPreventReloadLoop(versionKey)) {
    console.warn(`[Version] Prevented reload loop: Already attempted ${MAX_REFRESH_ATTEMPTS} reloads for version ${versionKey}`);
    showLoopPreventedBanner(versionKey);
    return false;
  }

  recordReloadAttempt(versionKey, reason);

  console.info(`[Version] Executing force hard refresh. Reason: ${reason}, Target: ${versionKey}`);

  // Update splash screen if still visible
  if (typeof window !== "undefined") {
    window.__jssUpdateSplashProgress?.(100, "Updating to latest version…");
    const statusEl = document.getElementById("splash-status");
    if (statusEl) statusEl.textContent = "Updating Eeskia to latest version…";
  }

  // 1. Purge all Service Worker caches in CacheStorage
  if (clearCaches && typeof window !== "undefined" && "caches" in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
      console.info(`[Version] Cleared ${cacheNames.length} CacheStorage entries`);
    } catch (err) {
      console.warn("[Version] Error clearing CacheStorage:", err);
    }
  }

  // 2. Trigger updates on registered Service Workers
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.update().catch(() => {});
      }
    } catch (err) {
      console.warn("[Version] Error updating Service Worker registrations:", err);
    }
  }

  // 3. Unconditionally reload page with a cache-busting timestamp parameter
  if (typeof window !== "undefined" && window.location) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_v", Date.now().toString(36));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }

  return true;
}

/**
 * Checks server version at app boot.
 * If the running code is outdated, immediately triggers a hard refresh
 * and returns true so the caller can abort loading outdated code.
 *
 * @returns {Promise<boolean>} True if outdated and refresh initiated; false to proceed.
 */
export async function checkVersionAtBoot() {
  try {
    const remote = await fetchServerVersion({ timeoutMs: 2500 });
    if (remote && isAppOutdated(remote)) {
      console.warn(`[Version] Outdated app code detected at boot! Current: ${CURRENT_BUILD_ID}, Server: ${remote.buildId}`);
      const refreshed = await forceHardRefresh({
        reason: "outdated_at_boot",
        targetVersion: remote.buildId,
      });
      return refreshed;
    }
  } catch (err) {
    console.warn("[Version] Boot version check error:", err);
  }
  return false;
}

/**
 * Displays a non-intrusive banner when an update is detected while working in the dashboard.
 */
export function showUpdateBanner(remoteVersion) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("eeskia-version-banner");
  if (existing) return;

  const targetVersion = remoteVersion?.buildId || "latest";

  const banner = document.createElement("div");
  banner.id = "eeskia-version-banner";
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:999999;background:#14538A;color:#FFFFFF;" +
    "padding:10px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,0.2);" +
    "font-family:Arial,Helvetica,sans-serif;font-size:13px;animation:slideDown 0.3s ease;";

  const text = document.createElement("span");
  text.textContent = "A new version of Eeskia is ready with important updates.";

  const btnWrap = document.createElement("div");
  btnWrap.style.cssText = "display:flex;gap:8px;align-items:center;";

  const updateBtn = document.createElement("button");
  updateBtn.textContent = "Update Now";
  updateBtn.style.cssText =
    "background:#F2994A;color:#FFFFFF;border:none;border-radius:4px;padding:6px 12px;font-weight:bold;cursor:pointer;";
  updateBtn.addEventListener("click", () => {
    forceHardRefresh({ reason: "user_banner_click", targetVersion });
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "×";
  dismissBtn.style.cssText =
    "background:transparent;color:#FFFFFF;border:none;font-size:18px;cursor:pointer;padding:0 6px;line-height:1;";
  dismissBtn.title = "Dismiss for now";
  dismissBtn.addEventListener("click", () => banner.remove());

  btnWrap.appendChild(updateBtn);
  btnWrap.appendChild(dismissBtn);

  banner.appendChild(text);
  banner.appendChild(btnWrap);
  document.body.prepend(banner);
}

/**
 * Fallback banner if reload loop prevention kicks in.
 */
function showLoopPreventedBanner(targetVersion) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("eeskia-version-loop-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "eeskia-version-loop-banner";
  banner.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:999999;background:#D9534F;color:#FFFFFF;" +
    "padding:14px 18px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.25);" +
    "font-family:Arial,Helvetica,sans-serif;font-size:13px;max-width:380px;";

  banner.innerHTML =
    '<p style="margin:0 0 8px;font-weight:bold;">Version update in progress</p>' +
    '<p style="margin:0 0 10px;line-height:1.4;">A new version is available on the server. If this screen does not update automatically, tap below to clear cache and reload.</p>';

  const btn = document.createElement("button");
  btn.textContent = "Force Refresh Now";
  btn.style.cssText =
    "background:#FFFFFF;color:#D9534F;border:none;border-radius:4px;padding:6px 12px;font-weight:bold;cursor:pointer;";
  btn.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(RELOAD_STATE_KEY);
    } catch {}
    forceHardRefresh({ reason: "loop_override_click", targetVersion });
  });

  banner.appendChild(btn);
  document.body.appendChild(banner);
}

/**
 * Initializes continuous background freshness checks:
 * - Checks when tab becomes visible after backgrounding
 * - Checks when network connection returns
 * - Runs periodic check every 15 minutes
 */
export function initVersionWatcher() {
  if (typeof window === "undefined") return () => {};

  let intervalId = null;

  async function check() {
    try {
      const remote = await fetchServerVersion({ timeoutMs: 3000 });
      if (remote && isAppOutdated(remote)) {
        // If the user is currently on the login screen or an auth approval gate,
        // force a hard refresh immediately so they never encounter false approval waiting!
        const hash = window.location.hash || "";
        const isAuthGate =
          hash.startsWith("#/login") ||
          !hash ||
          document.querySelector(".approval-wait");

        if (isAuthGate) {
          console.info("[Version] On auth/login gate with outdated code. Forcing hard refresh...");
          forceHardRefresh({ reason: "watcher_auth_gate", targetVersion: remote.buildId });
        } else {
          showUpdateBanner(remote);
        }
      }
    } catch (err) {
      console.warn("[Version] Freshness check error:", err);
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      check();
    }
  };

  const onOnline = () => {
    check();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("actually-online", onOnline);
  window.addEventListener("online", onOnline);

  // Check every 15 minutes
  intervalId = setInterval(check, 15 * 60 * 1000);

  // Return cleanup function
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("actually-online", onOnline);
    window.removeEventListener("online", onOnline);
    if (intervalId) clearInterval(intervalId);
  };
}
