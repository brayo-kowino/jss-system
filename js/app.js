import { initErrorHandling, showFatalError } from "./error-handler.js";
import { checkVersionAtBoot, initVersionWatcher, forceHardRefresh } from "./services/version.service.js";
import { initTheme } from "./theme.js";
// Attaches the beforeinstallprompt listener as a side effect of import -
// needs to happen this early since the event can fire before the router
// or shell exist yet. See that module for why.
import "./services/install-prompt.js";

import "flatpickr/dist/flatpickr.min.css";
import "../css/datepicker.css";


// Installed first, before anything else - so a failure in auth, the router,
// or Firebase itself still gets caught and shown nicely instead of leaving
// a blank/frozen splash screen.
initErrorHandling();
initTheme();

// PWA shell caching (see /sw.js for what this does and doesn't cache).
// The file is served from the site root (same reason site.webmanifest is),
// but registered with an explicit narrower scope so it only ever controls
// the dashboard app - never the marketing site at "/". Registered
// fire-and-forget: a failure here (unsupported browser, blocked by an
// extension, served over plain http on some LAN setup) should never
// affect the app itself, so it's not awaited and has no effect on boot.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/app/" }).catch(() => {});

  // sw.js posts this once a new version has activated and taken over.
  // If the user is on login or the approval waiting gate, immediately
  // force a hard refresh so they never encounter false approval waiting
  // or false lockouts due to protocol/schema differences.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "EESKIA_SW_UPDATED") return;

    const isLoginOrGate =
      !location.hash ||
      location.hash.startsWith("#/login") ||
      document.querySelector(".approval-wait");

    if (isLoginOrGate) {
      forceHardRefresh({ reason: "sw_updated_login_gate" });
      return;
    }
  });
}

// Tells the early inline boot-watchdog in index.html that JS is alive and
// running, so it can stand down its "taking too long" fallback timer.
window.__jssBootPing?.();

async function bootApp() {
  try {
    // Check with the server if our code bundle is truly up to date.
    // If outdated, checkVersionAtBoot() clears caches and triggers a hard reload,
    // returning true so we abort booting the outdated bundle right here.
    window.__jssUpdateSplashProgress?.(10, "Checking for updates…");
    const isOutdated = await checkVersionAtBoot();
    if (isOutdated) {
      // Abort loading outdated code
      return;
    }

    // Initialize background watcher for visibility change, network reconnect, and periodic checks
    initVersionWatcher();

    const { preloadAllAppAssets } = await import("./services/asset-preloader.js");
    await preloadAllAppAssets((percent, text) => {
      window.__jssUpdateSplashProgress?.(percent, text);
    });

    const { onAuthChange, refreshCurrentSchool, getCurrentProfile } = await import("./services/auth.service.js");
    const { startRouter, renderRoute, navigate } = await import("./router.js");

    startRouter();

    let firstLoad = true;
    onAuthChange(async (profile) => {
      try {
        window.__jssUpdateSplashProgress?.(85, "Authenticating session…");
        if (firstLoad) {
          firstLoad = false;
          if (!location.hash) {
            const home = profile ? (profile.role === "super_admin" ? "/schools" : "/dashboard") : "/login";
            navigate(home);
          }
        }
        window.__jssUpdateSplashProgress?.(95, "Rendering view…");
        
        // The JS app has successfully loaded and is taking over routing/timeouts.
        // Cancel the global HTML watchdog so it doesn't race with router timeouts on slow networks.
        window.__jssCancelWatchdog?.();

        await renderRoute();
        if (typeof document !== "undefined" && document.fonts) {
          try {
            await document.fonts.ready;
          } catch {}
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.__jssUpdateSplashProgress?.(100, "Ready!");
        window.__jssBootOk?.();
      } catch (err) {
        showFatalError(err, { where: "app.onAuthChange" });
      }
    });

    // ------------------------------------------------------------------
    // Reconnect: re-check subscription status for real, immediately.
    //
    // router.js's lock gate reads getCurrentSchool()'s in-memory snapshot,
    // fetched once at sign-in - see that file's own comment: it's a UI
    // convenience, never the actual security boundary (firestore.rules'
    // isSubscriptionActive() re-checks live, server-side, on every real
    // request, and always wins - a stale/optimistic client value can never
    // grant more access than the rule allows). So there's no way to keep a
    // lapsed subscription "working" by staying offline: any write made
    // offline just sits queued until reconnect, and gets rejected then if
    // the subscription had actually expired in the meantime.
    //
    // What staying offline *can* do is leave the on-screen status looking
    // stale/wrong for longer than necessary - a school whose subscription
    // quietly lapsed while a device was offline would otherwise keep
    // showing the normal app (last known "active" snapshot) until the next
    // full page reload. This re-fetches the real school doc and re-renders
    // the moment connectivity returns, so the lock screen (or the all-clear)
    // reflects reality within seconds of reconnecting, rather than however
    // long it takes for the person to happen to navigate somewhere next.
    // ------------------------------------------------------------------
    window.addEventListener("actually-online", () => {
      if (!getCurrentProfile()) return; // signed out - nothing to refresh, avoid a needless read
      refreshCurrentSchool()
        .then(() => renderRoute())
        .catch(() => {}); // best-effort - a real problem here still surfaces normally on next navigation
    });
  } catch (err) {
    // Firebase/auth/router failed to even load (bad config, blocked CDN,
    // offline on first visit, syntax error in a module...). This is the one
    // place a hard failure is expected to be possible, so it gets its own
    // catch rather than relying on the global listeners.
    showFatalError(err, { where: "app.boot" });
  }
}

bootApp();