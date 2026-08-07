import { logout } from "../services/auth.service.js";
import { navigate } from "../router.js";
import { el, icon } from "../utils.js";
import { ROLES } from "../services/auth.service.js";
import { getSchoolSettings } from "../services/settings.service.js";

// Lightens/darkens a hex color by `amt` (-255..255), used to derive a darker
// sidebar shade from the school's single primary brand color.
function shade(hex, amt) {
  const n = parseInt((hex || "#14538A").replace("#", ""), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Re-themes the whole app (sidebar, buttons, letterhead accents) to a
// school's chosen brand colors by overriding the CSS custom properties
// every stylesheet already keys off of.
export function applyBranding(settings) {
  const root = document.documentElement.style;
  const primary = settings?.themeColor || "#14538A";
  const accent = settings?.secondaryColor || "#C9A227";
  root.setProperty("--color-primary-700", primary);
  root.setProperty("--color-primary-900", shade(primary, -30));
  root.setProperty("--color-primary-600", shade(primary, 25));
  root.setProperty("--color-gold", accent);
  root.setProperty("--color-gold-soft", shade(accent, 60));
}

const NAV = [
  {
    label: "Overview",
    links: [{ path: "/dashboard", icon: "dashboard", text: "Dashboard", allRoles: true }],
  },
  {
    // High-frequency, done daily/weekly by most staff - kept right under
    // the dashboard so the most-used actions are never more than one
    // click/scroll away.
    label: "Daily Tasks",
    links: [
      { path: "/attendance", icon: "fact_check", text: "Attendance", roles: ["class_teacher", "admin", "deputy_principal", "principal"] },
      { path: "/marks", icon: "edit_note", text: "Marks Entry", roles: ["subject_teacher", "class_teacher", "academic_master", "admin"] },
      { path: "/timetable", icon: "calendar_month", text: "Timetable", allRoles: true },
      { path: "/notifications", icon: "notifications", text: "Notifications", allRoles: true },
    ],
  },
  {
    label: "People",
    links: [
      { path: "/students", icon: "school", text: "Students", roles: ["admin", "principal", "deputy_principal", "academic_master", "registrar", "class_teacher"] },
      { path: "/teachers", icon: "person", text: "Teachers", roles: ["admin", "principal", "deputy_principal"] },
      { path: "/parents", icon: "groups", text: "Parents", roles: ["admin", "deputy_principal", "principal", "class_teacher", "registrar"] },
    ],
  },
  {
    label: "Academics",
    links: [
      { path: "/assessments", icon: "quiz", text: "Assessments", roles: ["admin", "academic_master", "subject_teacher", "class_teacher", "principal", "deputy_principal"] },
      { path: "/grading", icon: "analytics", text: "Grading & Positions", roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"] },
      { path: "/reports", icon: "description", text: "Report Cards", allRoles: true },
      { path: "/analytics", icon: "insert_chart", text: "School Analytics", roles: ["admin", "principal", "deputy_principal", "academic_master"] },
      { path: "/academics", icon: "meeting_room", text: "Classes & Streams", roles: ["admin", "deputy_principal", "principal", "academic_master"] },
      { path: "/subjects", icon: "menu_book", text: "Subjects", roles: ["admin", "academic_master", "class_teacher", "subject_teacher", "principal", "deputy_principal"] },
    ],
  },
  {
    label: "Operations",
    links: [
      { path: "/fees", icon: "payments", text: "Fees", roles: ["admin", "deputy_principal", "principal", "bursar"] },
    ],
  },
  {
    label: "Administration",
    links: [
      { path: "/settings", icon: "settings", text: "School Settings", roles: ["admin"] },
      { path: "/audit", icon: "policy", text: "Audit Trail", roles: ["admin"] },
    ],
  },
  {
    label: "Platform",
    links: [{ path: "/schools", icon: "corporate_fare", text: "Schools", roles: ["super_admin"] }],
  },
];

function roleLabel(roleValue) {
  return ROLES.find((r) => r.value === roleValue)?.label || roleValue;
}

// Which nav groups the user has manually collapsed, persisted across
// sessions. A group holding the currently active link is always forced
// open regardless of this, so navigating never hides the page you're on.
const NAV_COLLAPSE_KEY = "jss_nav_collapsed_groups";
function getCollapsedGroups() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NAV_COLLAPSE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveCollapsedGroups(set) {
  try {
    localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable (private browsing, etc.) - collapse state
    // just won't persist across reloads, which is harmless.
  }
}

// Cached across renderShell calls: the shell re-renders on every navigation,
// but the school's name/logo/branding don't change mid-session, so we only
// fetch them once and reuse the result (avoids a "School Portal" flash on
// every route change).
let cachedSettings = null;
let settingsPromise = null;
function loadSchoolSettingsOnce() {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (!settingsPromise) {
    settingsPromise = getSchoolSettings().then((settings) => {
      cachedSettings = settings;
      return settings;
    });
  }
  return settingsPromise;
}
// Called after School Settings saves changes, so the cached name/logo/
// branding shown in the shell picks up the edit on the next navigation
// instead of staying stale for the rest of the session.
export function invalidateSchoolSettingsCache() {
  cachedSettings = null;
  settingsPromise = null;
}

export function renderShell(app, profile, activePath) {
  // The whole shell rebuilds on every navigation, which would otherwise
  // reset the sidebar's scroll position back to the top each time.
  const previousSidebar = app.querySelector(".sidebar");
  const savedScrollTop = previousSidebar ? previousSidebar.scrollTop : 0;

  app.innerHTML = "";
  const shell = el("div", { class: "shell" });

  // Sidebar
  const sidebar = el("aside", { class: "sidebar" });

  // Logo only in the sidebar, centered above the nav.
  const logoMount = el("div", { class: "sidebar__seal-mount" }, [
    el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: "assets/logo.png", alt: "JSS Manager logo" })])
  ]);

  // The school name now lives in the topbar, above the page title.
  const schoolNameEl = el("div", { class: "topbar__school-name" }, cachedSettings?.schoolName || "School Portal");

  // Fetch the real school settings in the background (super_admin has
  // no schoolId - they get the platform default look instead). Cached
  // after the first load, so it won't flash back to the placeholder
  // every time the shell re-renders on navigation.
  if (profile.role === "super_admin") {
    schoolNameEl.textContent = "Platform Admin";
  } else if (cachedSettings) {
    if (cachedSettings.schoolName) schoolNameEl.textContent = cachedSettings.schoolName;
    if (cachedSettings.logoUrl) {
      logoMount.innerHTML = "";
      logoMount.append(el("img", { src: cachedSettings.logoUrl, alt: "School Logo", class: "sidebar__logo-img" }));
    }
    applyBranding(cachedSettings);
  } else {
    loadSchoolSettingsOnce().then(settings => {
      // Update name
      if (settings.schoolName) {
        schoolNameEl.textContent = settings.schoolName;
      }
      // Update logo if one exists
      if (settings.logoUrl) {
        logoMount.innerHTML = ""; // Clear the default "SP" seal
        logoMount.append(
          el("img", {
            src: settings.logoUrl,
            alt: "School Logo",
            class: "sidebar__logo-img"
          })
        );
      }
      applyBranding(settings);
    }).catch(() => {});
  }

  sidebar.append(logoMount);

  // Sidebar search: filters nav links by label as the user types. Matching
  // groups stay expanded for the duration of the search; clearing the box
  // restores each group's normal collapsed/expanded state.
  const searchInput = el("input", {
    class: "sidebar__search-input",
    type: "text",
    placeholder: "Search menu",
    autocomplete: "off",
  });
  sidebar.append(
    el("div", { class: "sidebar__search" }, [
      el("span", { class: "material-symbols-rounded icon sidebar__search-icon" }, "search"),
      searchInput,
    ])
  );

  const collapsedGroups = getCollapsedGroups();
  // Collected while building the groups below, then used by the search
  // handler to filter/restore without re-rendering the whole sidebar.
  const groupRefs = [];

  for (const group of NAV) {
    const visibleLinks = group.links.filter((l) =>
      profile.role === "super_admin"
        ? (l.roles || []).includes("super_admin")
        : l.allRoles || (l.roles || []).includes(profile.role)
    );
    if (!visibleLinks.length) continue;

    const hasActiveLink = visibleLinks.some((l) => l.path === activePath);
    const groupEl = el("div", { class: "nav-group" });
    const chevron = el("span", { class: "material-symbols-rounded icon nav-group__chevron" }, "expand_more");
    const labelRow = el(
      "div",
      { class: "nav-group__label", onClick: () => toggleGroupCollapsed(group.label, groupEl, chevron) },
      [el("span", {}, group.label), chevron]
    );
    groupEl.append(labelRow);

    const linksWrap = el("div", { class: "nav-group__links" });
    const linkRefs = [];
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
      linksWrap.append(linkEl);
      linkRefs.push({ linkEl, text: link.text.toLowerCase() });
    }
    groupEl.append(linksWrap);

    // Respect the saved collapse state, but never collapse the group the
    // user is currently on.
    if (collapsedGroups.has(group.label) && !hasActiveLink) {
      groupEl.classList.add("nav-group--collapsed");
      chevron.classList.add("nav-group__chevron--collapsed");
    }

    sidebar.append(groupEl);
    groupRefs.push({ label: group.label, groupEl, chevron, hasActiveLink, linkRefs });
  }

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      // Restore each group to its persisted collapsed/expanded state.
      for (const ref of groupRefs) {
        ref.groupEl.style.display = "";
        for (const linkRef of ref.linkRefs) linkRef.linkEl.style.display = "";
        const shouldCollapse = collapsedGroups.has(ref.label) && !ref.hasActiveLink;
        ref.groupEl.classList.toggle("nav-group--collapsed", shouldCollapse);
        ref.chevron.classList.toggle("nav-group__chevron--collapsed", shouldCollapse);
      }
      return;
    }
    // While searching, force every group open and show only matching links;
    // hide a group entirely if nothing in it matches.
    for (const ref of groupRefs) {
      let anyMatch = false;
      for (const linkRef of ref.linkRefs) {
        const matches = linkRef.text.includes(query);
        linkRef.linkEl.style.display = matches ? "" : "none";
        if (matches) anyMatch = true;
      }
      ref.groupEl.style.display = anyMatch ? "" : "none";
      ref.groupEl.classList.remove("nav-group--collapsed");
      ref.chevron.classList.remove("nav-group__chevron--collapsed");
    }
  });

  sidebar.append(
    el("div", { class: "sidebar__footer" }, [
      `© ${new Date().getFullYear()} `,
      el("b", {}, "ISKIFY360 ERP Softwares"),
    ])
  );

  shell.append(sidebar);

  // Topbar
  const topbar = el("header", { class: "topbar" });
  topbar.append(el("div", { class: "topbar__titles" }, [
    schoolNameEl,
    el("div", { class: "topbar__title" }, currentTitle(activePath)),
  ]));
  const userBox = el("div", { class: "topbar__user" }, [
    el("div", {}, [
      el("div", {}, profile.fullName || profile.email),
      el("div", { class: "topbar__user-role" }, roleLabel(profile.role)),
    ]),
    el("button", { class: "btn btn--ghost btn--sm", onClick: handleLogout }, [icon("logout"), "Sign out"]),
  ]);
  topbar.append(userBox);
  shell.append(topbar);

  // Main content mount point
  const main = el("main", { class: "main" });
  shell.append(main);

  app.append(shell);
  sidebar.scrollTop = savedScrollTop;
  return main;
}

function toggleGroupCollapsed(label, groupEl, chevron) {
  const collapsed = getCollapsedGroups();
  const willCollapse = !groupEl.classList.contains("nav-group--collapsed");
  groupEl.classList.toggle("nav-group--collapsed", willCollapse);
  chevron.classList.toggle("nav-group__chevron--collapsed", willCollapse);
  if (willCollapse) collapsed.add(label);
  else collapsed.delete(label);
  saveCollapsedGroups(collapsed);
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