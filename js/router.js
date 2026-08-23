// ==========================================================================
// Minimal hash router.
// Each route declares which roles may view it. `allRoles: true` = any
// authenticated user.
//
// Resilience notes:
//  - currentPath() never trusts location.hash as-is: it's decoded and
//    validated defensively before being used to look anything up, so a
//    malformed, oversized, or booby-trapped link can't do anything worse
//    than land on the "page not found" screen.
//  - Every view's render()/init() is wrapped so a bug in one page can't
//    blank the whole app - it falls back to a friendly in-shell error card
//    with a "try again" button, and the sidebar/nav stay usable.
// ==========================================================================
import { getCurrentProfile, getCurrentSchool, refreshCurrentSchool, getAuthGateStatus } from "./services/auth.service.js";
import { getSubscriptionState } from "./services/subscription.service.js";
import { renderShell } from "./components/shell.js";
import { renderApprovalGate, renderTwoFactorGate } from "./components/auth-gate.js";
import { toast, skeletonPage, el, icon } from "./utils.js";
import { renderInlineError, showFatalError } from "./error-handler.js";

// These three are the only views that can be reached *before* we know a
// visitor is on an active subscription (login, forced password change, and
// the lock screen itself), so they're loaded eagerly like before - they're
// small, and lazy-loading them would just add a network round trip to a
// path everyone hits. Every other view below is loaded on demand (see
// loadView()) so a signed-in-but-locked visitor's browser never has to
// download reports.js/marks.js/fees.js/etc. just to be shown the lock
// screen - only the handful of modules the route they land on actually
// needs. This is also what makes the edge-side gating in
// netlify/edge-functions/subscription-gate.ts worth doing: without this
// split, one big eagerly-imported bundle would ship the whole app to a
// suspended/expired school regardless of what the edge function blocks.
import * as loginView from "../views/login.js";
import * as changePasswordView from "../views/change-password.js";
import * as subscriptionLockedView from "../views/subscription-locked.js";

// path -> () => import("../views/x.js"). Each entry is a *function*, not
// the module itself - calling it kicks off the dynamic import, which Vite
// splits into its own content-hashed chunk at build time (see
// vite.config.js / netlify.toml's build-step comment). loadView() below
// resolves and caches these on first visit to a route so navigating back
// to an already-visited page doesn't re-fetch its chunk.
export const routes = {
  "/login": { view: () => Promise.resolve(loginView), public: true },
  "/change-password": { view: () => Promise.resolve(changePasswordView), allRoles: true, title: "Change Password" },
  "/dashboard": { view: () => import("../views/dashboard.js"), allRoles: true },
  "/settings": { view: () => import("../views/school-settings.js"), roles: ["admin"] },

  "/students": { view: () => import("../views/students.js"), roles: ["admin", "principal", "deputy_principal", "academic_master", "registrar", "class_teacher"], title: "Student Management" },
  "/parents": { view: () => import("../views/parents.js"), roles: ["admin", "deputy_principal", "principal", "class_teacher", "registrar"], title: "Parent Module" },
  "/teachers": { view: () => import("../views/teachers.js"), roles: ["admin", "principal", "deputy_principal"], title: "Teacher Module" },

  "/academics": { view: () => import("../views/academics.js"), roles: ["admin", "deputy_principal", "principal", "academic_master"], title: "Classes & Streams" },
  "/subjects": { view: () => import("../views/subjects.js"), roles: ["admin", "academic_master", "class_teacher", "subject_teacher", "principal", "deputy_principal"], title: "Subject Management" },

  "/assessments": { view: () => import("../views/assessments.js"), roles: ["admin", "academic_master", "subject_teacher", "class_teacher", "principal", "deputy_principal"], title: "Assessment Management" },
  "/marks": { view: () => import("../views/marks.js"), roles: ["subject_teacher", "class_teacher", "academic_master", "admin"], title: "Marks Entry" },

  "/grading": { view: () => import("../views/grading.js"), roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"], title: "Grading & Positions" },

  "/attendance": { view: () => import("../views/attendance.js"), roles: ["class_teacher", "admin", "deputy_principal", "principal"], title: "Attendance" },
  "/reports": { view: () => import("../views/reports.js"), allRoles: true, title: "Report Cards & Reports" },
  "/release-results": { view: () => import("../views/release-results.js"), roles: ["admin", "academic_master"], title: "Release Results" },
  "/fees": { view: () => import("../views/fees.js"), roles: ["admin", "deputy_principal", "principal", "bursar"], title: "Fee Management" },

  "/timetable": { view: () => import("../views/timetable.js"), allRoles: true, title: "Timetable" },
  "/schools": { view: () => import("../views/schools.js"), roles: ["super_admin"], title: "Schools" },
  "/platform-announcements": { view: () => import("../views/platform-announcements.js"), roles: ["super_admin"], title: "Platform Announcements" },
  "/notifications": { view: () => import("../views/notifications.js"), allRoles: true, title: "Notifications" },
  "/audit": { view: () => import("../views/audit.js"), roles: ["admin"], title: "Audit Trail" },
  "/analytics": { view: () => import("../views/analytics.js"), roles: ["admin", "principal", "deputy_principal", "academic_master"], title: "Analytics & Reports" },
};

// Cache of resolved modules keyed by path, so revisiting a route already
// seen this session reuses the same module object instead of re-running
// the dynamic import() (which itself is cached by the browser/Vite runtime
// too, but skipping straight to the resolved module avoids even that
// microtask overhead on every navigation).
const resolvedViewCache = new Map();

async function loadView(path, route) {
  if (resolvedViewCache.has(path)) return resolvedViewCache.get(path);
  const mod = await route.view();
  resolvedViewCache.set(path, mod);
  return mod;
}

const MAX_PATH_LENGTH = 200;
// Route paths only ever contain letters, digits, dashes and slashes - so
// anything else in the hash (script fragments, encoded junk, stray quotes
// from a broken link, etc.) is treated as invalid rather than looked up.
const SAFE_PATH_RE = /^\/[a-z0-9/-]*$/i;

// Reads location.hash defensively: decodes safely, strips anything that
// isn't a plausible route path, and caps the length, so a malformed or
// malicious link can never reach the route table or the DOM as-is.
function currentPath() {
  let raw = location.hash.replace(/^#/, "") || "/dashboard";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return "__invalid__"; // malformed percent-encoding (e.g. a stray "%")
  }
  raw = raw.split("?")[0].split("#")[0].trim();
  if (!raw) return "/dashboard";
  if (raw.length > MAX_PATH_LENGTH || !SAFE_PATH_RE.test(raw)) return "__invalid__";
  return raw;
}

export function navigate(path) {
  const targetHash = path.startsWith("#") ? path : `#${path}`;
  if (location.hash === targetHash) {
    renderRoute().catch((err) => showFatalError(err, { where: "router.navigate" }));
  } else {
    location.hash = targetHash;
  }
}

function renderNotFound(app, { authed }) {
  const actionPath = authed ? "/dashboard" : "/login";
  const actionLabel = authed ? "Go to dashboard" : "Go to sign in";
  app.innerHTML = "";
  app.append(
    el("div", { class: "not-found-page" }, [
      el("div", { class: "not-found-page__code" }, "404"),
      el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "explore_off"),
      el("h2", {}, "That page doesn't exist"),
      el("p", { class: "text-muted" }, "The link you followed may be broken, out of date, or mistyped. Nothing on your account has been changed."),
      el("button", { class: "btn btn--primary", style: "margin-top:16px;", onClick: () => navigate(actionPath) }, [icon("home"), actionLabel]),
    ])
  );
}

// Bumped on every renderRoute() call. Each call captures its own token and
// checks it against this counter before it touches the DOM after an
// `await`. Without this, hopping between pages quickly (e.g. Analytics ->
// Marks Entry -> back to Analytics before the Marks Entry render actually
// finishes loading its data) could let the slower, now-stale render win
// the final `main.innerHTML =`/`appendChild` and stomp on the page you're
// actually looking at - leaving it blank, half-built, or showing another
// page's content until you poked a control and something happened to
// trigger a fresh render.
let currentRenderToken = 0;

// A view's render() can hang rather than reject when the network drops
// mid-session - Firestore's own offline detection isn't instant (see
// firebase-config.js), and a server-only aggregate read has no cache to
// fall back to at all. Without a ceiling here, main.appendChild(skeletonPage())
// below would just sit on screen indefinitely with no way out. After
// RENDER_TIMEOUT_MS we give up waiting and fall through to the existing
// inline-error/retry path instead, classified as "offline"/"timeout" by
// error-handler.js's classifyError() so the person sees a real message and
// a "Try again" button rather than a frozen skeleton. This doesn't cancel
// the original render() call - if it resolves later in the background,
// its result is simply never used - so a real (just slow) connection that
// comes through after the timeout doesn't leave anything half-applied.
const RENDER_TIMEOUT_MS = 90_000;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("Timed out waiting for the server."), { code: "deadline-exceeded" }));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function renderRoute() {
  const app = document.getElementById("app");
  if (!app) return;

  const renderToken = ++currentRenderToken;
  const isStale = () => renderToken !== currentRenderToken;

  let path;
  try {
    path = currentPath();
  } catch (err) {
    showFatalError(err, { where: "router.currentPath" });
    return;
  }

  let profile;
  try {
    profile = getCurrentProfile();
  } catch (err) {
    showFatalError(err, { where: "router.getCurrentProfile" });
    return;
  }

  if (path === "__invalid__" || !routes[path]) {
    renderNotFound(app, { authed: !!profile });
    return;
  }

  const route = routes[path];

  try {
    if (route.public) {
      if (profile) {
        if (document.querySelector(".approval-wait") || document.querySelector(".twofa-gate")) {
          return;
        }
        return navigate("/dashboard");
      }
      const view = await loadView(path, route);
      if (isStale()) return;
      const content = await view.render();
      if (isStale()) return;
      app.innerHTML = "";
      app.appendChild(content);
      await view.init?.();
      return;
    }

    if (!profile) return navigate("/login");

    // Every account starts life with mustChangePassword: true (set by
    // createUserAccount / createSchool alongside its temp password). Until
    // that's cleared, this gate replaces the entire app - no route, shell,
    // or nav is reachable, so a handed-out temp password can't linger as a
    // standing credential once someone else has read it off a shared link,
    // a chat message, or a sticky note.
    if (profile.mustChangePassword) {
      const content = await changePasswordView.render({ profile, forced: true });
      if (isStale()) return;
      app.innerHTML = "";
      app.appendChild(content);
      await changePasswordView.init?.({ profile, forced: true });
      return;
    }

    // Device-approval / 2FA gate. Re-checked on EVERY protected-route
    // render (not just once at login form submit) - see
    // auth.service.js's getAuthGateStatus() header for why that matters.
    // An unresolved gate replaces the entire app the same way
    // mustChangePassword above does: no route, shell, or nav underneath.
    let gate;
    try {
      gate = await getAuthGateStatus(profile);
    } catch (err) {
      showFatalError(err, { where: "router.getAuthGateStatus" });
      return;
    }
    if (isStale()) return;
    if (gate) {
      const onDone = () => navigate(path);
      if (gate.type === "approval") {
        renderApprovalGate(gate, onDone);
      } else if (gate.type === "2fa") {
        renderTwoFactorGate(gate, onDone);
      }
      return;
    }

    // super_admin has no schoolId and isn't scoped to any single school's
    // data - the only things it can see are the Schools registry and the
    // platform announcements it authors (also not scoped to any school).
    if (profile.role === "super_admin" && path !== "/schools" && path !== "/platform-announcements") {
      return navigate("/schools");
    }

    // Hard lock, layer two (layer one is firestore.rules' isSubscriptionActive()
    // - this just means people see a clear message instead of a wall of
    // failed reads/writes). super_admin is exempt (no schoolId, manages the
    // Schools registry itself, not gated by any single school's subscription).
    // Every other role - including the school's own admin - lands here the
    // instant subscriptionExpiresAt lapses OR the school is suspended by the
    // platform admin (see getSubscriptionState()); the lock screen itself is
    // the one place an admin can still paste a fresh token for the expiry
    // case (see views/subscription-locked.js) - a suspension can only be
    // lifted by the platform admin, not a token.
    if (profile.role !== "super_admin") {
      let school = getCurrentSchool();
      if (!school && profile.schoolId) {
        school = await refreshCurrentSchool();
      }
      const { active } = getSubscriptionState(school || {});
      if (!active) {
        const content = await subscriptionLockedView.render({ profile, school });
        if (isStale()) return;
        app.innerHTML = "";
        app.appendChild(content);
        await subscriptionLockedView.init?.({ profile, school });
        return;
      }
    }

    const allowed = route.allRoles || (route.roles || []).includes(profile.role);
    if (!allowed) {
      toast("You don't have access to that section.", "error");
      return navigate("/dashboard");
    }

    // Authenticated + authorized: render inside the app shell. The shell
    // itself is trusted infrastructure (nav, topbar) - if it throws, that's
    // fatal. The page content inside it is not: if the view's render()/
    // init() throws, we keep the shell/nav and show an inline error card
    // in the content area instead of losing navigation entirely.
    let main;
    try {
      main = renderShell(app, profile, path);
    } catch (err) {
      showFatalError(err, { where: "router.renderShell" });
      return;
    }
    if (isStale()) return;

    main.innerHTML = "";
    main.appendChild(skeletonPage());
    try {
      // The dynamic import() itself is covered by the same timeout as the
      // render call below - a slow/flaky connection fetching a route's
      // chunk for the first time should fail the same way a slow
      // Firestore read does, not hang the skeleton indefinitely.
      // When offline, Firestore reads come straight from persistentLocalCache
      // (disableNetwork() is called in firebase-config.js the moment the
      // browser goes offline) so there's no server round-trip to time out
      // on — skipping the timeout avoids a false "deadline-exceeded" error
      // that would show the scary inline error card for a view that would
      // have rendered just fine from cache a moment later.
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const maybeTimeout = (p) => offline ? p : withTimeout(p, RENDER_TIMEOUT_MS);
      const view = await maybeTimeout(loadView(path, route));
      if (isStale()) return;
      const content = await maybeTimeout(view.render({ profile, title: route.title }));
      if (isStale()) return;
      main.innerHTML = "";
      main.appendChild(content);
      await view.init?.({ profile });
    } catch (viewErr) {
      if (isStale()) return;
      renderInlineError(main, viewErr, {
        context: { where: `view:${path}` },
        onRetry: async () => {
          const retryToken = ++currentRenderToken;
          const retryMain = renderShell(app, profile, path);
          if (retryToken !== currentRenderToken) return;
          retryMain.innerHTML = "";
          retryMain.appendChild(skeletonPage());
          const retryOffline = typeof navigator !== "undefined" && !navigator.onLine;
          const retryMaybeTimeout = (p) => retryOffline ? p : withTimeout(p, RENDER_TIMEOUT_MS);
          const view = await retryMaybeTimeout(loadView(path, route));
          if (retryToken !== currentRenderToken) return;
          const content = await retryMaybeTimeout(view.render({ profile, title: route.title }));
          if (retryToken !== currentRenderToken) return;
          retryMain.innerHTML = "";
          retryMain.appendChild(content);
          await view.init?.({ profile });
        },
      });
    }
  } catch (err) {
    // Catch-all for anything unexpected above (e.g. a role/auth check
    // itself throwing) so renderRoute() can never leave the tab hung on a
    // blank page.
    showFatalError(err, { where: "router.renderRoute" });
  }
}

export function startRouter() {
  window.addEventListener("hashchange", () => {
    renderRoute().catch((err) => showFatalError(err, { where: "router.hashchange" }));
  });
}