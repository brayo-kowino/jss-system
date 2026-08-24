import { initErrorHandling, showFatalError } from "./error-handler.js";
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

// PWA shell caching (see /sw.js for what this does and doesn't cache).
// The file is served from the site root (same reason site.webmanifest is),
// but registered with an explicit narrower scope so it only ever controls
// the dashboard app - never the marketing site at "/". Registered
// fire-and-forget: a failure here (unsupported browser, blocked by an
// extension, served over plain http on some LAN setup) should never
// affect the app itself, so it's not awaited and has no effect on boot.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/app/" }).catch(() => {});

  // sw.js posts this once a new version has activated and taken over -
  // only meaningful if this tab already had an older version running
  // (a brand new install has nothing to "update" from), so it's a toast,
  // not a forced reload: the person's current screen (mid-entering marks,
  // say) is more important than being on the latest bundle immediately.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "EESKIA_SW_UPDATED") return;
    const root = document.getElementById("toast-root");
    if (!root) return;
    const bar = document.createElement("div");
    bar.className = "toast toast--info";
    bar.style.cursor = "pointer";
    bar.textContent = "A new version of Eeskia is ready - tap to refresh.";
    bar.addEventListener("click", () => location.reload());
    root.appendChild(bar);
  });
}

// Tells the early inline boot-watchdog in index.html that JS is alive and
// running, so it can stand down its "taking too long" fallback timer.
window.__jssBootPing?.();

try {
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