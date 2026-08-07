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
import { getCurrentProfile } from "./services/auth.service.js";
import { renderShell } from "./components/shell.js";
import { toast, skeletonPage, el, icon } from "./utils.js";
import { renderInlineError, showFatalError } from "./error-handler.js";

import * as analyticsView from "../views/analytics.js";
import * as loginView from "../views/login.js";
import * as changePasswordView from "../views/change-password.js";
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

export async function renderRoute() {
  const app = document.getElementById("app");
  if (!app) return;

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
      app.innerHTML = "";
      app.appendChild(await route.view.render());
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
      app.innerHTML = "";
      app.appendChild(await changePasswordView.render({ profile }));
      await changePasswordView.init?.({ profile });
      return;
    }

    // super_admin has no schoolId and isn't scoped to any single school's
    // data - the only thing it can see is the Schools registry.
    if (profile.role === "super_admin" && path !== "/schools") {
      return navigate("/schools");
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

    main.innerHTML = "";
    main.appendChild(skeletonPage());
    try {
      const content = await route.view.render({ profile, title: route.title });
      main.innerHTML = "";
      main.appendChild(content);
      await route.view.init?.({ profile });
    } catch (viewErr) {
      renderInlineError(main, viewErr, {
        context: { where: `view:${path}` },
        onRetry: async () => {
          const retryMain = renderShell(app, profile, path);
          retryMain.innerHTML = "";
          retryMain.appendChild(skeletonPage());
          const content = await route.view.render({ profile, title: route.title });
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
