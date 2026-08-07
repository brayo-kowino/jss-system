import { initErrorHandling, showFatalError } from "./error-handler.js";

// Installed first, before anything else - so a failure in auth, the router,
// or Firebase itself still gets caught and shown nicely instead of leaving
// a blank/frozen splash screen.
initErrorHandling();

// Tells the early inline boot-watchdog in index.html that JS is alive and
// running, so it can stand down its "taking too long" fallback timer.
window.__jssBootPing?.();

try {
  const { onAuthChange } = await import("./services/auth.service.js");
  const { startRouter, renderRoute, navigate } = await import("./router.js");

  startRouter();

  let firstLoad = true;
  onAuthChange((profile) => {
    try {
      if (firstLoad) {
        firstLoad = false;
        if (!location.hash) {
          const home = profile ? (profile.role === "super_admin" ? "/schools" : "/dashboard") : "/login";
          navigate(home);
        }
      }
      renderRoute();
      window.__jssBootOk?.();
    } catch (err) {
      showFatalError(err, { where: "app.onAuthChange" });
    }
  });
} catch (err) {
  // Firebase/auth/router failed to even load (bad config, blocked CDN,
  // offline on first visit, syntax error in a module...). This is the one
  // place a hard failure is expected to be possible, so it gets its own
  // catch rather than relying on the global listeners.
  showFatalError(err, { where: "app.boot" });
}
