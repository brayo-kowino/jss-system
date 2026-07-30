// ==========================================================================
// Minimal hash router.
// Each route declares which roles may view it. `allRoles: true` = any
// authenticated user. Unbuilt modules point at the `comingSoon` stub so the
// full nav is navigable from day one; swap in real views as they're built.
// ==========================================================================
import { getCurrentProfile } from "./services/auth.service.js";
import { renderShell } from "./components/shell.js";
import { toast } from "./utils.js";

import * as loginView from "../views/login.js";
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
import * as comingSoon from "../views/coming-soon.js";

export const routes = {
  "/login": { view: loginView, public: true },
  "/dashboard": { view: dashboardView, allRoles: true },
  "/settings": { view: settingsView, roles: ["admin"] },

  "/students": { view: studentsView, roles: ["admin", "principal", "deputy_principal", "registrar", "class_teacher"], title: "Student Management" },
  "/parents": { view: parentsView, roles: ["admin", "registrar"], title: "Parent Module" },
  "/teachers": { view: teachersView, roles: ["admin", "principal"], title: "Teacher Module" },

  "/academics": { view: academicsView, roles: ["admin", "academic_master"], title: "Classes & Streams" },
  "/subjects": { view: subjectsView, roles: ["admin", "academic_master"], title: "Subject Management" },

  // Still to build, in order.
  "/assessments": { view: assessmentsView, roles: ["admin", "academic_master", "subject_teacher"], title: "Assessment Management" },

  // Still to build, in order.
  "/marks": { view: marksView, roles: ["subject_teacher", "class_teacher", "academic_master", "admin"], title: "Marks Entry" },

  "/grading": { view: gradingView, roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"], title: "Grading & Positions" },

  "/attendance": { view: attendanceView, roles: ["class_teacher", "admin", "principal"], title: "Attendance" },
  "/reports": { view: reportsView, allRoles: true, title: "Report Cards & Reports" },
  "/fees": { view: feesView, roles: ["admin", "bursar"], title: "Fee Management" },

  "/timetable": { view: timetableView, allRoles: true, title: "Timetable" },
  "/notifications": { view: comingSoon, allRoles: true, title: "Notifications" },
  "/audit": { view: comingSoon, roles: ["admin"], title: "Audit Trail" },
};

function currentPath() {
  return location.hash.replace(/^#/, "") || "/dashboard";
}

export function navigate(path) {
  location.hash = path;
}

export async function renderRoute() {
  const path = currentPath();
  const route = routes[path];
  const app = document.getElementById("app");
  const profile = getCurrentProfile();

  if (!route) {
    app.innerHTML = `<div class="empty-state"><h2>Page not found</h2></div>`;
    return;
  }

  if (route.public) {
    if (profile) return navigate("/dashboard"); // already signed in
    app.innerHTML = "";
    app.appendChild(await route.view.render());
    route.view.init?.();
    return;
  }

  if (!profile) return navigate("/login");

  const allowed = route.allRoles || (route.roles || []).includes(profile.role);
  if (!allowed) {
    toast("You don't have access to that section.", "error");
    return navigate("/dashboard");
  }

  // Authenticated + authorized: render inside the app shell.
  const main = renderShell(app, profile, path);
  main.innerHTML = `<div class="empty-state">Loading…</div>`;
  const content = await route.view.render({ profile, title: route.title });
  main.innerHTML = "";
  main.appendChild(content);
  route.view.init?.({ profile });
}

export function startRouter() {
  window.addEventListener("hashchange", renderRoute);
}
