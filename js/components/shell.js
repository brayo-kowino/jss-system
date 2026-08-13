import { logout } from "../services/auth.service.js";
import { navigate } from "../router.js";
import { el, icon, setFavicon, toast } from "../utils.js";
import { ROLES } from "../services/auth.service.js";
import { getSchoolSettings } from "../services/settings.service.js";
import { startTour } from "./tour.js";
import { TOUR_STEPS } from "../tour-steps.js";
import { isInstallable, isRunningInstalled, installMethod, promptInstall, onInstallabilityChange } from "../services/install-prompt.js";

// First-time visitors get the tour started for them automatically, once
// per account (per browser). Keyed by uid so switching accounts on a
// shared computer doesn't skip the tour for the next person, or replay it
// unnecessarily for someone who already saw it.
function tourSeenKey(uid) {
  return `jss_tour_seen_${uid}`;
}
function hasSeenTour(uid) {
  try {
    return localStorage.getItem(tourSeenKey(uid)) === "1";
  } catch {
    return true; // no localStorage (private browsing, etc.) - don't force it on every load
  }
}
function markTourSeen(uid) {
  try {
    localStorage.setItem(tourSeenKey(uid), "1");
  } catch {
    // best-effort only
  }
}

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

// Captured once, before any school branding has had a chance to overwrite
// it, so there's a real generic title to fall back to for contexts with no
// resolved school (e.g. super_admin/Platform Admin).
const DEFAULT_TITLE = document.title;

// Re-themes the whole app (sidebar, buttons, letterhead accents, browser
// tab title) to a school's chosen brand - colors from CSS custom properties
// every stylesheet already keys off of, plus the tab title so a user with
// several schools open in different tabs can tell them apart at a glance.
export function applyBranding(settings) {
  const root = document.documentElement.style;
  const primary = settings?.themeColor || "#14538A";
  const accent = settings?.secondaryColor || "#C9A227";
  root.setProperty("--color-primary-700", primary);
  root.setProperty("--color-primary-900", shade(primary, -30));
  root.setProperty("--color-primary-600", shade(primary, 25));
  root.setProperty("--color-gold", accent);
  root.setProperty("--color-gold-soft", shade(accent, 60));
  document.title = settings?.schoolName ? `${settings.schoolName} | Eeskia` : DEFAULT_TITLE;
  setFavicon(settings?.logoUrl || "/assets/logo.png");
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
      { path: "/teachers", icon: "person", text: "Staff & Logins", roles: ["admin", "principal", "deputy_principal"] },
      { path: "/parents", icon: "groups", text: "Parents", roles: ["admin", "deputy_principal", "principal", "class_teacher", "registrar"] },
    ],
  },
  {
    label: "Academics",
    links: [
      { path: "/assessments", icon: "quiz", text: "Assessments", roles: ["admin", "academic_master", "subject_teacher", "class_teacher", "principal", "deputy_principal"] },
      { path: "/grading", icon: "analytics", text: "Grading & Positions", roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"] },
      { path: "/reports", icon: "description", text: "Report Cards", allRoles: true },
      { path: "/release-results", icon: "visibility", text: "Release Results", roles: ["admin", "academic_master"] },
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

// ---------------------------------------------------------------------------
// Install button - shown in the topbar whenever the browser has something
// useful to offer (a real one-tap Chrome/Edge/Android prompt, or iOS's
// manual "Add to Home Screen" steps), hidden the moment the app is already
// running installed. renderShell() rebuilds the whole topbar on every
// navigation, so the previous button's live-update subscription is torn
// down first (see installUnsubscribe below) rather than piling up a new
// listener on every route change for the life of the session.
// ---------------------------------------------------------------------------
let installUnsubscribe = null;

function installButton() {
  const wrap = el("span", {});

  function render() {
    wrap.innerHTML = "";
    if (!isInstallable() || isRunningInstalled()) return;
    const method = installMethod();
    const btn = el(
      "button",
      {
        class: "btn btn--ghost btn--sm",
        title: "Install Eeskia as an app on this device",
        onClick: () => (method === "prompt" ? handleNativeInstall() : showIosInstallHint()),
      },
      [icon("install_desktop"), "Install app"]
    );
    wrap.append(btn);
  }

  if (installUnsubscribe) installUnsubscribe();
  installUnsubscribe = onInstallabilityChange(render);
  render();
  return wrap;
}

async function handleNativeInstall() {
  try {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast("Eeskia is installing…", "success");
  } catch {
    // Prompt was already consumed or unavailable - nothing to show; the
    // button itself will disappear on the next installability change.
  }
}

function showIosInstallHint() {
  import("./modal.js").then(({ openModal }) => {
    const body = el("div", { style: "display:flex;flex-direction:column;gap:var(--sp-3);" }, [
      el("p", {}, "Safari doesn't allow installing apps automatically - a couple of taps does it:"),
      el("ol", { style: "margin:0;padding-left:20px;line-height:1.7;" }, [
        el("li", {}, ['Tap the Share icon ', icon("ios_share"), ' in Safari\'s toolbar']),
        el("li", {}, 'Scroll down and tap "Add to Home Screen"'),
        el("li", {}, 'Tap "Add" - Eeskia will open from your Home Screen from then on, just like a normal app'),
      ]),
    ]);
    openModal("Install Eeskia on iPhone/iPad", body);
  });
}

// ---------------------------------------------------------------------------
// Offline status pill - a persistent (not auto-dismissing) indicator so
// someone marking attendance or entering marks with no signal for an
// extended stretch can see, at a glance, that they're still safely in
// "will sync later" territory rather than wondering if anything is being
// saved at all. error-handler.js's toasts cover the *moment* connectivity
// changes; this covers the whole time in between.
// ---------------------------------------------------------------------------
let offlinePillCleanup = null;

function offlineStatusPill() {
  const pill = el("span", { class: "badge badge--warning topbar__offline-pill", style: "display:none;" }, [
    icon("wifi_off"),
    "Offline - will sync",
  ]);
  const sync = () => {
    pill.style.display = navigator.onLine ? "none" : "inline-flex";
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();

  if (offlinePillCleanup) offlinePillCleanup();
  offlinePillCleanup = () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
  };
  return pill;
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

// Whether the whole sidebar is collapsed to an icon-only strip, persisted
// across sessions/tabs the same way the per-group collapse state is.
const SIDEBAR_COLLAPSE_KEY = "jss_sidebar_collapsed";
function isSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // Non-fatal - just won't be remembered next load.
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

// References to the currently-mounted topbar/sidebar chrome, kept live so
// refreshSchoolChrome() can patch them in place. Set on every renderShell()
// call; null before the shell has ever been rendered.
let schoolNameElRef = null;
let logoMountRef = null;

// Re-fetches settings and patches the *already-rendered* shell (topbar
// name, sidebar logo, theme colors) immediately - without this, School
// Settings saves would invalidate the cache but the visible chrome would
// stay stale until the user happened to navigate to another route (the
// shell only rebuilds on route change), which looked like "nothing
// updates until I refresh the page".
export async function refreshSchoolChrome() {
  invalidateSchoolSettingsCache();
  const settings = await loadSchoolSettingsOnce();
  if (schoolNameElRef && settings.schoolName) {
    schoolNameElRef.textContent = settings.schoolName;
  }
  if (logoMountRef && settings.logoUrl) {
    logoMountRef.innerHTML = "";
    logoMountRef.append(el("img", { src: settings.logoUrl, alt: "School Logo", class: "sidebar__logo-img" }));
  }
  applyBranding(settings);
  return settings;
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
  const logoMount = el("div", { class: "sidebar__seal-mount", "data-tour": "sidebar-logo" }, [
    el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: "/assets/logo.png", alt: "Eeskia logo" })])
  ]);

  // The school name now lives in the topbar, above the page title.
  const schoolNameEl = el("div", { class: "topbar__school-name" }, cachedSettings?.schoolName || "School Portal");

  // Fetch the real school settings in the background (super_admin has
  // no schoolId - they get the platform default look instead). Cached
  // after the first load, so it won't flash back to the placeholder
  // every time the shell re-renders on navigation.
  if (profile.role === "super_admin") {
    schoolNameEl.textContent = "Platform Admin";
    document.title = "Platform Admin | Eeskia";
    setFavicon();
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

  schoolNameElRef = schoolNameEl;
  logoMountRef = logoMount;

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
    el("div", { class: "sidebar__search", "data-tour": "sidebar-search" }, [
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
          "data-tour": `nav-${link.path.slice(1)}`,
          title: link.text,
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

  // Collapse-to-icons toggle now lives at the top of the topbar, before the
  // school name, so it's always reachable without scrolling and doesn't
  // shift position as nav groups expand/collapse.
  const collapseBtn = el(
    "button",
    { type: "button", class: "topbar__collapse-btn" },
    [el("span", { class: "material-symbols-rounded icon" }, "left_panel_close")]
  );
  const applyCollapsedState = (collapsed) => {
    shell.classList.toggle("shell--collapsed", collapsed);
    sidebar.classList.toggle("sidebar--collapsed", collapsed);
    collapseBtn.querySelector(".icon").textContent = collapsed ? "left_panel_open" : "left_panel_close";
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseBtn.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
  };
  collapseBtn.addEventListener("click", () => {
    const collapsed = !sidebar.classList.contains("sidebar--collapsed");
    saveSidebarCollapsed(collapsed);
    applyCollapsedState(collapsed);
  });

  // Mobile nav toggle: below the 860px breakpoint the sidebar is an
  // off-canvas panel (see layout.css), so it needs its own open/close
  // control plus a backdrop - `collapseBtn` above only handles the
  // desktop icon-only mode and is hidden on mobile via CSS.
  const backdrop = el("div", { class: "sidebar-backdrop", onClick: () => closeMobileNav() });
  const mobileMenuBtn = el(
    "button",
    { type: "button", class: "topbar__mobile-menu-btn", "aria-label": "Open menu", title: "Open menu" },
    [el("span", { class: "material-symbols-rounded icon" }, "menu")]
  );
  function openMobileNav() {
    sidebar.classList.add("open");
    backdrop.classList.add("open");
  }
  function closeMobileNav() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
  }
  mobileMenuBtn.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeMobileNav() : openMobileNav();
  });
  // Tapping a nav link should close the panel too, not just navigate
  // behind it - relevant when a route re-renders content in place rather
  // than rebuilding the whole shell.
  sidebar.addEventListener("click", (ev) => {
    if (ev.target.closest(".nav-link")) closeMobileNav();
  });

  sidebar.append(
    el("div", { class: "sidebar__footer" }, [
      `© ${new Date().getFullYear()} `,
      el("b", {}, "ISKIFY360 ERP Softwares"),
    ])
  );

  applyCollapsedState(isSidebarCollapsed());

  shell.append(sidebar);
  shell.append(backdrop);

  // Topbar
  const topbar = el("header", { class: "topbar" });
  topbar.append(el("div", { class: "topbar__left" }, [
    mobileMenuBtn,
    collapseBtn,
    el("div", { class: "topbar__titles" }, [
      schoolNameEl,
      el("div", { class: "topbar__title" }, currentTitle(activePath)),
    ]),
  ]));
  const tourButton = el(
    "button",
    {
      class: "btn btn--ghost btn--sm btn--icon-only",
      "data-tour": "tour-trigger",
      title: "Take a tour of this system",
      "aria-label": "Take a tour of this system",
      onClick: () => {
        // The tour points at sidebar text/search that only exist in
        // expanded mode, so make sure it's expanded before it starts.
        if (sidebar.classList.contains("sidebar--collapsed")) {
          saveSidebarCollapsed(false);
          applyCollapsedState(false);
        }
        startTour(TOUR_STEPS);
      },
    },
    [icon("help")]
  );
  const userBox = el("div", { class: "topbar__user", "data-tour": "topbar-user" }, [
    offlineStatusPill(),
    el("div", {}, [
      el("div", {}, profile.fullName || profile.email),
      el("div", { class: "topbar__user-role" }, roleLabel(profile.role)),
    ]),
    installButton(),
    tourButton,
    el("button", { class: "btn btn--ghost btn--sm", onClick: handleLogout }, [icon("logout"), "Sign out"]),
  ]);
  topbar.append(userBox);
  shell.append(topbar);

  // Main content mount point
  const main = el("main", { class: "main" });
  shell.append(main);

  app.append(shell);
  sidebar.scrollTop = savedScrollTop;

  // Auto-launch the tour once per account, the first time it lands on the
  // dashboard after login. Deferred a tick so the route's own content has
  // painted underneath it, and skipped entirely for super_admin's minimal
  // Schools-only shell where most of the tour's targets don't apply.
  // Also skipped on phone-width screens - same reason the tour trigger
  // button is hidden there (see [data-tour="tour-trigger"] in layout.css):
  // the tour points at sidebar text/search that's off-canvas and awkward
  // to reach on a phone. Left unmarked-as-seen so it still auto-plays the
  // first time this account opens the dashboard on a larger screen.
  const isPhoneWidth = window.matchMedia("(max-width: 860px)").matches;
  if (activePath === "/dashboard" && profile.role !== "super_admin" && !isPhoneWidth && !hasSeenTour(profile.uid)) {
    markTourSeen(profile.uid);
    if (sidebar.classList.contains("sidebar--collapsed")) {
      saveSidebarCollapsed(false);
      applyCollapsedState(false);
    }
    setTimeout(() => startTour(TOUR_STEPS), 400);
  }

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