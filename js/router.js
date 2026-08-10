// ==========================================================================
// Minimal hash router.
// Each route declares which roles may view it. `allRoles: true` = any
// authenticated user. Unbuilt modules point at the `comingSoon` stub so the
// full nav is navigable from day one; swap in real views as they're built.
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
import { getCurrentProfile, getCurrentSchool } from "./services/auth.service.js";
import { getSubscriptionState } from "./services/subscription.service.js";
import { renderShell } from "./components/shell.js";
import { toast, skeletonPage, el, icon } from "./utils.js";
import { renderInlineError, showFatalError } from "./error-handler.js";

import * as analyticsView from "../views/analytics.js";
import * as loginView from "../views/login.js";
import * as changePasswordView from "../views/change-password.js";
import * as subscriptionLockedView from "../views/subscription-locked.js";
import * as dashboardView from "../views/dashboard.js";
import * as settingsView from "../views/school-settings.js";
import * as studentsView from "../views/students.js";
import * as parentsView from "../views/parents.js";
import * as teachersView from "../views/teachers.js";
import * as academicsView from "../views/academics.js";
import * as subjectsView from "../views/subjects.js";
import * as assessmentsView from "../views/assessments.js";
import * as marksView from "../views/marks.js";
import * as gradingView from "../views/grading.js";
import * as reportsView from "../views/reports.js";
import * as releaseResultsView from "../views/release-results.js";
import * as attendanceView from "../views/attendance.js";
import * as feesView from "../views/fees.js";
import * as timetableView from "../views/timetable.js";
import * as schoolsView from "../views/schools.js";
import * as auditView from "../views/audit.js";
import * as notificationsView from "../views/notifications.js";
import * as comingSoon from "../views/coming-soon.js";

export const routes = {
  "/login": { view: loginView, public: true },
  "/dashboard": { view: dashboardView, allRoles: true },
  "/settings": { view: settingsView, roles: ["admin"] },

  "/students": { view: studentsView, roles: ["admin", "principal", "deputy_principal", "academic_master", "registrar", "class_teacher"], title: "Student Management" },
  "/parents": { view: parentsView, roles: ["admin", "deputy_principal", "principal", "class_teacher", "registrar"], title: "Parent Module" },
  "/teachers": { view: teachersView, roles: ["admin", "principal", "deputy_principal"], title: "Teacher Module" },

  "/academics": { view: academicsView, roles: ["admin", "deputy_principal", "principal", "academic_master"], title: "Classes & Streams" },
  "/subjects": { view: subjectsView, roles: ["admin", "academic_master", "class_teacher", "subject_teacher", "principal", "deputy_principal"], title: "Subject Management" },

  "/assessments": { view: assessmentsView, roles: ["admin", "academic_master", "subject_teacher", "class_teacher", "principal", "deputy_principal"], title: "Assessment Management" },
  "/marks": { view: marksView, roles: ["subject_teacher", "class_teacher", "academic_master", "admin"], title: "Marks Entry" },

  "/grading": { view: gradingView, roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"], title: "Grading & Positions" },

  "/attendance": { view: attendanceView, roles: ["class_teacher", "admin", "deputy_principal", "principal"], title: "Attendance" },
  "/reports": { view: reportsView, allRoles: true, title: "Report Cards & Reports" },
  "/release-results": { view: releaseResultsView, roles: ["admin", "academic_master"], title: "Release Results" },
  "/fees": { view: feesView, roles: ["admin", "deputy_principal", "principal", "bursar"], title: "Fee Management" },

  "/timetable": { view: timetableView, allRoles: true, title: "Timetable" },
  "/schools": { view: schoolsView, roles: ["super_admin"], title: "Schools" },
  "/notifications": { view: notificationsView, allRoles: true, title: "Notifications" },
  "/audit": { view: auditView, roles: ["admin"], title: "Audit Trail" },
  "/analytics": { view: analyticsView, roles: ["admin", "principal", "deputy_principal", "academic_master"], title: "Analytics & Reports" },
};

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
  location.hash = path;
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
const RENDER_TIMEOUT_MS = 12_000;
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
      if (profile) return navigate("/dashboard");
      const content = await route.view.render();
      if (isStale()) return;
      app.innerHTML = "";
      app.appendChild(content);
      await route.view.init?.();
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
      const content = await changePasswordView.render({ profile });
      if (isStale()) return;
      app.innerHTML = "";
      app.appendChild(content);
      await changePasswordView.init?.({ profile });
      return;
    }

    // super_admin has no schoolId and isn't scoped to any single school's
    // data - the only thing it can see is the Schools registry.
    if (profile.role === "super_admin" && path !== "/schools") {
      return navigate("/schools");
    }

    // Hard lock, layer two (layer one is firestore.rules' isSubscriptionActive()
    // - this just means people see a clear message instead of a wall of
    // failed reads/writes). super_admin is exempt (no schoolId, manages the
    // Schools registry itself, not gated by any single school's subscription).
    // Every other role - including the school's own admin - lands here the
    // instant subscriptionExpiresAt lapses; the lock screen itself is the
    // one place an admin can still paste a fresh token (see
    // views/subscription-locked.js), so this never fully strands a school.
    if (profile.role !== "super_admin") {
      const school = getCurrentSchool();
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
      const content = await withTimeout(route.view.render({ profile, title: route.title }), RENDER_TIMEOUT_MS);
      if (isStale()) return;
      main.innerHTML = "";
      main.appendChild(content);
      await route.view.init?.({ profile });
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
          const content = await withTimeout(route.view.render({ profile, title: route.title }), RENDER_TIMEOUT_MS);
          if (retryToken !== currentRenderToken) return;
          retryMain.innerHTML = "";
          retryMain.appendChild(content);
          await route.view.init?.({ profile });
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