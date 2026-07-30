import { logout } from "../services/auth.service.js";
import { navigate } from "../router.js";
import { el } from "../utils.js";
import { ROLES } from "../services/auth.service.js";

const NAV = [
  {
    label: "Overview",
    links: [{ path: "/dashboard", icon: "dashboard", text: "Dashboard", allRoles: true }],
  },
  {
    label: "People",
    links: [
      { path: "/students", icon: "school", text: "Students", roles: ["admin", "principal", "deputy_principal", "registrar", "class_teacher"] },
      { path: "/parents", icon: "groups", text: "Parents", roles: ["admin", "registrar"] },
      { path: "/teachers", icon: "person", text: "Teachers", roles: ["admin", "principal"] },
    ],
  },
  {
    label: "Academics",
    links: [
      { path: "/academics", icon: "meeting_room", text: "Classes & Streams", roles: ["admin", "academic_master"] },
      { path: "/subjects", icon: "menu_book", text: "Subjects", roles: ["admin", "academic_master"] },
      { path: "/assessments", icon: "quiz", text: "Assessments", roles: ["admin", "academic_master", "subject_teacher"] },
      { path: "/marks", icon: "edit_note", text: "Marks Entry", roles: ["subject_teacher", "class_teacher", "academic_master", "admin"] },
      { path: "/grading", icon: "analytics", text: "Grading & Positions", roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"] },
      { path: "/reports", icon: "description", text: "Report Cards", allRoles: true },
      { path: "/attendance", icon: "fact_check", text: "Attendance", roles: ["class_teacher", "admin", "principal"] },
    ],
  },
  {
    label: "Operations",
    links: [
      { path: "/fees", icon: "payments", text: "Fees", roles: ["admin", "bursar"] },
      { path: "/timetable", icon: "calendar_month", text: "Timetable", allRoles: true },
      { path: "/notifications", icon: "notifications", text: "Notifications", allRoles: true },
    ],
  },
  {
    label: "Administration",
    links: [
      { path: "/settings", icon: "settings", text: "School Settings", roles: ["admin"] },
      { path: "/audit", icon: "policy", text: "Audit Trail", roles: ["admin"] },
    ],
  },
];

function roleLabel(roleValue) {
  return ROLES.find((r) => r.value === roleValue)?.label || roleValue;
}

export function renderShell(app, profile, activePath) {
  app.innerHTML = "";
  const shell = el("div", { class: "shell" });

  // Sidebar
  const sidebar = el("aside", { class: "sidebar" });
  sidebar.append(
    el("div", { class: "sidebar__brand" }, [
      el("div", { class: "seal" }, "JS"),
      el("div", {}, [
        el("div", { class: "sidebar__brand-name" }, "JSS Manager"),
        el("div", { class: "sidebar__brand-tag" }, "CBC Edition"),
      ]),
    ])
  );

  for (const group of NAV) {
    const visibleLinks = group.links.filter(
      (l) => l.allRoles || (l.roles || []).includes(profile.role)
    );
    if (!visibleLinks.length) continue;
    const groupEl = el("div", { class: "nav-group" });
    groupEl.append(el("div", { class: "nav-group__label" }, group.label));
    for (const link of visibleLinks) {
      const isActive = activePath === link.path;
      const linkEl = el(
        "div",
        {
          class: `nav-link${isActive ? " active" : ""}`,
          onClick: () => navigate(link.path),
        },
        [el("span", { class: "material-symbols-rounded icon" }, link.icon), el("span", {}, link.text)]
      );
      groupEl.append(linkEl);
    }
    sidebar.append(groupEl);
  }
  shell.append(sidebar);

  // Topbar
  const topbar = el("header", { class: "topbar" });
  topbar.append(el("div", { class: "topbar__title" }, currentTitle(activePath)));
  const userBox = el("div", { class: "topbar__user" }, [
    el("div", {}, [
      el("div", {}, profile.fullName || profile.email),
      el("div", { class: "topbar__user-role" }, roleLabel(profile.role)),
    ]),
    el("button", { class: "btn btn--ghost btn--sm", onClick: handleLogout }, "Sign out"),
  ]);
  topbar.append(userBox);
  shell.append(topbar);

  // Main content mount point
  const main = el("main", { class: "main" });
  shell.append(main);

  app.append(shell);
  return main;
}

function currentTitle(path) {
  for (const group of NAV) {
    const match = group.links.find((l) => l.path === path);
    if (match) return match.text;
  }
  return "";
}

async function handleLogout() {
  await logout();
  navigate("/login");
}
