// ==========================================================================
// Eeskia Global Command Palette (Ctrl+K / Cmd+K)
// Fast keyboard-first search & action overlay for navigation, actions & records
// ==========================================================================

import { el, icon, toast } from "../utils.js";
import { navigate } from "../router.js";
import { toggleTheme, getEffectiveTheme } from "../theme.js";
import { listStudents } from "../services/student.service.js";
import { listClasses } from "../services/academic.service.js";
import { listTeachers } from "../services/teacher.service.js";
import { startTour } from "./tour.js";
import { TOUR_STEPS } from "../tour-steps.js";
import { logout } from "../services/auth.service.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");
export const MODIFIER_LABEL = isMac ? "⌘" : "Ctrl";

let paletteBackdrop = null;
let currentProfile = null;
let cachedStudents = null;
let cachedClasses = null;
let cachedTeachers = null;
let selectedIndex = 0;
let currentItems = [];

// Base Navigation Catalog with role permissions and predefined shortcut letters
export const NAV_CATALOG = [
  { id: "nav-dash", title: "Dashboard", subtitle: "Executive overview & school statistics", icon: "dashboard", category: "Navigation", path: "/dashboard", letter: "D", roles: ["admin", "principal", "deputy_principal", "academic_master", "bursar", "registrar"] },
  { id: "nav-att", title: "Daily Attendance", subtitle: "Roll-call & class attendance register", icon: "fact_check", category: "Navigation", path: "/attendance", letter: "A", roles: ["class_teacher", "admin", "deputy_principal", "principal"] },
  { id: "nav-marks", title: "Marks Entry", subtitle: "Record assessment scores & CBC rubrics", icon: "edit_note", category: "Navigation", path: "/marks", letter: "M", roles: ["subject_teacher", "class_teacher", "academic_master", "admin"] },
  { id: "nav-assess", title: "Assessments", subtitle: "Formative & summative assessment setup", icon: "quiz", category: "Navigation", path: "/assessments", letter: "Q", roles: ["admin", "academic_master", "subject_teacher", "class_teacher", "principal", "deputy_principal"] },
  { id: "nav-students", title: "Students Directory", subtitle: "Learner rosters, admissions & profiles", icon: "school", category: "Navigation", path: "/students", letter: "S", roles: ["admin", "principal", "deputy_principal", "academic_master", "registrar", "class_teacher"] },
  { id: "nav-teachers", title: "Staff & Logins", subtitle: "Faculty directory, subject allocations & security", icon: "person", category: "Navigation", path: "/teachers", letter: "E", roles: ["admin", "principal", "deputy_principal"] },
  { id: "nav-parents", title: "Parents & Guardians", subtitle: "Family contacts, links & SMS broadcast", icon: "groups", category: "Navigation", path: "/parents", letter: "G", roles: ["admin", "deputy_principal", "principal", "class_teacher", "registrar"] },
  { id: "nav-grading", title: "Grading & Positions", subtitle: "CBC level aggregation & merit analysis", icon: "analytics", category: "Navigation", path: "/grading", letter: "J", roles: ["admin", "academic_master", "principal", "deputy_principal", "class_teacher"] },
  { id: "nav-reports", title: "Report Cards", subtitle: "Termly progress reports & printable PDF cards", icon: "description", category: "Navigation", path: "/reports", letter: "P", roles: ["admin", "principal", "deputy_principal", "academic_master", "class_teacher"] },
  { id: "nav-release", title: "Release Results", subtitle: "Publish term results for parent access", icon: "visibility", category: "Navigation", path: "/release-results", letter: "V", roles: ["admin", "academic_master"] },
  { id: "nav-analytics", title: "School Analytics", subtitle: "Deep cohort performance trends & equity graphs", icon: "insert_chart", category: "Navigation", path: "/analytics", letter: "Y", roles: ["admin", "principal", "deputy_principal", "academic_master"] },
  { id: "nav-promotions", title: "Promotions & Rollover", subtitle: "End-of-year cohort advancement", icon: "trending_up", category: "Navigation", path: "/promotions", letter: "X", roles: ["admin", "principal", "deputy_principal", "academic_master"] },
  { id: "nav-classes", title: "Classes & Streams", subtitle: "Configure grade cohorts & streams", icon: "meeting_room", category: "Navigation", path: "/academics", letter: "O", roles: ["admin", "deputy_principal", "principal", "academic_master"] },
  { id: "nav-subjects", title: "Subjects & Curriculum", subtitle: "CBC learning areas & department matrix", icon: "menu_book", category: "Navigation", path: "/subjects", letter: "U", roles: ["admin", "academic_master", "class_teacher", "subject_teacher", "principal", "deputy_principal"] },
  { id: "nav-timetable", title: "Timetable Schedule", subtitle: "Master lessons schedule & teacher clash solver", icon: "calendar_month", category: "Navigation", path: "/timetable", letter: "T", allRoles: true },
  { id: "nav-fees", title: "Fees & Ledger", subtitle: "Student fee balances, invoicing & receipts", icon: "payments", category: "Navigation", path: "/fees", letter: "F", roles: ["admin", "deputy_principal", "principal", "bursar"] },
  { id: "nav-issues", title: "Student Issues & Care", subtitle: "Discrepancies, attendance flags & discipline notes", icon: "assignment_late", category: "Navigation", path: "/student-issues", letter: "I", roles: ["admin", "principal", "deputy_principal", "registrar", "class_teacher"] },
  { id: "nav-notifs", title: "Notifications & Newsletters", subtitle: "Broadcast circulars, notices & parent SMS", icon: "notifications", category: "Navigation", path: "/notifications", letter: "N", roles: ["admin", "principal", "deputy_principal", "academic_master", "class_teacher", "bursar", "registrar"] },
  { id: "nav-settings", title: "School Settings", subtitle: "School logo, motto, branding colors & grading scale", icon: "settings", category: "Navigation", path: "/settings", letter: "L", roles: ["admin"] },
  { id: "nav-audit", title: "Audit Trail", subtitle: "Security logs, fee modifications & score change logs", icon: "policy", category: "Navigation", path: "/audit", letter: "B", roles: ["admin"] },
  { id: "nav-support", title: "Contact Support Desk", subtitle: "Submit engineering tickets & feature requests", icon: "support_agent", category: "Navigation", path: "/support", letter: "H", roles: ["admin", "principal", "deputy_principal", "registrar", "bursar", "academic_master", "class_teacher"] },
  // Super admin routes
  { id: "nav-schools", title: "Schools Directory", subtitle: "Manage registered school tenants & subscriptions", icon: "corporate_fare", category: "Platform", path: "/schools", letter: "1", roles: ["super_admin"] },
  { id: "nav-plat-ann", title: "Platform Announcements", subtitle: "Broadcast global system banners", icon: "campaign", category: "Platform", path: "/platform-announcements", letter: "2", roles: ["super_admin"] },
  { id: "nav-plat-tick", title: "Support Tickets Desk", subtitle: "Manage incoming school tickets", icon: "confirmation_number", category: "Platform", path: "/platform-tickets", letter: "3", roles: ["super_admin"] },
  { id: "nav-plat-err", title: "System Error Logs", subtitle: "Review client & edge runtime logs", icon: "bug_report", category: "Platform", path: "/platform-error-logs", letter: "4", roles: ["super_admin"] },
  { id: "nav-plat-set", title: "Platform Settings", subtitle: "System-wide security & configuration", icon: "settings", category: "Platform", path: "/platform-settings", letter: "5", roles: ["super_admin"] },
];

// Predefined Shortcut Groups for the Key Hints & Instruction Guide
export const SHORTCUT_GROUPS = [
  {
    name: "Core Operations",
    icon: "dashboard_customize",
    letters: ["D", "A", "M", "F", "S"],
  },
  {
    name: "Academics & Curriculum",
    icon: "school",
    letters: ["Q", "P", "V", "O", "U", "T", "J"],
  },
  {
    name: "Administration & Security",
    icon: "admin_panel_settings",
    letters: ["L", "E", "Y", "X", "G", "B"],
  },
  {
    name: "Care & Communications",
    icon: "forum",
    letters: ["I", "N", "H"],
  },
  {
    name: "Platform Management",
    icon: "corporate_fare",
    letters: ["1", "2", "3", "4", "5"],
    superAdminOnly: true,
  },
];

export const SYSTEM_HOTKEYS = [
  {
    title: "Spotlight Command Palette",
    subtitle: "Search learners, classes, quick actions & navigate",
    icon: "search",
    keys: [`${MODIFIER_LABEL}+K`],
    letter: "K",
    actionType: "search",
  },
  {
    title: "Key Hints & Shortcuts Guide",
    subtitle: "Open this interactive hotkey cheatsheet & instructions",
    icon: "keyboard",
    keys: ["?", `${MODIFIER_LABEL}+/`],
    letter: "?",
    actionType: "hints",
  },
  {
    title: "School Settings Direct Alias",
    subtitle: "Standard system settings shortcut alias",
    icon: "settings",
    keys: [`${MODIFIER_LABEL}+,`],
    letter: ",",
    actionType: "settings",
  },
  {
    title: "Dismiss Overlay / Dialog",
    subtitle: "Close active palette, modal or popup menu",
    icon: "close",
    keys: ["ESC"],
    letter: "ESC",
    actionType: "close",
  },
];

function formatRoleSummary(item) {
  if (item.allRoles) return "All Staff";
  const roles = item.roles || [];
  if (roles.length === 1 && roles[0] === "admin") return "Admin Only";
  if (roles.length === 1 && roles[0] === "super_admin") return "Super Admin";
  if (roles.includes("admin") && roles.includes("class_teacher")) return "Teachers & Admin";
  if (roles.includes("bursar")) return "Finance & Admin";
  return roles
    .map((r) => r.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()))
    .join(", ");
}

function hasRolePermission(item, profile) {
  if (item.allRoles) return true;
  if (profile?.role === "super_admin") return true;
  return (item.roles || []).includes(profile?.role);
}

/**
 * Builds list of executable quick actions for the palette
 */
function getQuickActions(profile) {
  const isDark = getEffectiveTheme() === "dark";
  const actions = [
    {
      id: "act-theme",
      title: isDark ? "Switch to Light Theme" : "Switch to Dark Theme",
      subtitle: `Currently using ${isDark ? "Dark" : "Light"} mode`,
      icon: isDark ? "light_mode" : "dark_mode",
      category: "System Actions",
      badge: "Theme",
      action: () => toggleTheme(),
    },
    {
      id: "act-tour",
      title: "Start System Tour",
      subtitle: "Guided walkthrough of modules and shortcuts",
      icon: "smart_toy",
      category: "System Actions",
      badge: "Help",
      action: () => startTour(TOUR_STEPS),
    },
    {
      id: "act-password",
      title: "Change Account Password",
      subtitle: "Update your login credentials",
      icon: "lock_reset",
      category: "Account",
      badge: "Security",
      action: () => navigate("/change-password"),
    },
    {
      id: "act-logout",
      title: "Sign Out of Eeskia",
      subtitle: `Sign out ${profile?.email || "current session"}`,
      icon: "logout",
      category: "Account",
      badge: "Session",
      action: () => logout(),
    },
  ];

  if (["admin", "principal", "deputy_principal", "registrar"].includes(profile?.role)) {
    actions.unshift({
      id: "act-new-student",
      title: "New Student Admission",
      subtitle: "Register learner biodata, NEMIS & admission number",
      icon: "person_add",
      category: "Quick Actions",
      badge: "Admission",
      action: () => navigate("/students?action=new"),
    });
  }

  if (["admin", "deputy_principal", "bursar"].includes(profile?.role)) {
    actions.unshift({
      id: "act-fee-pay",
      title: "Record Fee Payment",
      subtitle: "Post cash, bank slip, or M-Pesa fee receipt",
      icon: "receipt_long",
      category: "Quick Actions",
      badge: "Finance",
      action: () => navigate("/fees"),
    });
  }

  if (["admin", "academic_master", "class_teacher", "subject_teacher"].includes(profile?.role)) {
    actions.unshift({
      id: "act-enter-marks",
      title: "Record Learner Marks",
      subtitle: "Input assessment rubrics & strand scores",
      icon: "score",
      category: "Quick Actions",
      badge: "Academics",
      action: () => navigate("/marks"),
    });
  }

  return actions;
}

/**
 * Preloads cached entities (students, classes, staff) in the background
 */
async function prefetchEntities(profile) {
  if (profile?.role === "super_admin") return;
  try {
    const promises = [];
    if (!cachedStudents) promises.push(listStudents().then((s) => { cachedStudents = s; }).catch(() => {}));
    if (!cachedClasses) promises.push(listClasses().then((c) => { cachedClasses = c; }).catch(() => {}));
    if (!cachedTeachers && ["admin", "principal", "deputy_principal"].includes(profile?.role)) {
      promises.push(listTeachers().then((t) => { cachedTeachers = t; }).catch(() => {}));
    }
    await Promise.allSettled(promises);
  } catch {}
}

/**
 * Filters items based on query string
 */
function searchItems(query, profile) {
  const cleanQ = (query || "").trim().toLowerCase();
  const results = [];

  // Filter Navigation items
  const allowedNav = NAV_CATALOG.filter((item) => {
    if (profile?.role === "super_admin") return (item.roles || []).includes("super_admin");
    return item.allRoles || (item.roles || []).includes(profile?.role);
  });

  const quickActions = getQuickActions(profile);

  if (!cleanQ) {
    // Show Top Suggested Items when query is empty
    return [
      ...allowedNav.slice(0, 6).map((n) => ({
        ...n,
        action: () => navigate(n.path),
        badge: n.letter ? `${MODIFIER_LABEL}+${n.letter}` : "Jump",
      })),
      ...quickActions.slice(0, 3),
    ];
  }

  // 1. Match Navigation Items (by title, subtitle, category, or predefined shortcut letter)
  for (const item of allowedNav) {
    const itemLetter = (item.letter || "").toLowerCase();
    const haystack = `${item.title} ${item.subtitle} ${item.category} ${itemLetter} ctrl+${itemLetter} cmd+${itemLetter}`.toLowerCase();
    if (haystack.includes(cleanQ)) {
      const isExactLetter = cleanQ === itemLetter || cleanQ === `ctrl+${itemLetter}` || cleanQ === `cmd+${itemLetter}`;
      results.push({
        ...item,
        badge: item.letter ? `${MODIFIER_LABEL}+${item.letter}` : "Navigation",
        action: () => navigate(item.path),
        score: isExactLetter
          ? 120
          : item.title.toLowerCase().startsWith(cleanQ)
            ? 100
            : item.title.toLowerCase().includes(cleanQ)
              ? 80
              : 50,
      });
    }
  }

  // 2. Match Quick Actions
  for (const item of quickActions) {
    const haystack = `${item.title} ${item.subtitle} ${item.category}`.toLowerCase();
    if (haystack.includes(cleanQ)) {
      results.push({
        ...item,
        score: item.title.toLowerCase().startsWith(cleanQ) ? 95 : (item.title.toLowerCase().includes(cleanQ) ? 75 : 45),
      });
    }
  }

  // 3. Match Classes
  if (cachedClasses && cachedClasses.length) {
    for (const c of cachedClasses) {
      const classText = `${c.grade || ""} ${c.stream || ""} Class`.toLowerCase();
      if (classText.includes(cleanQ)) {
        results.push({
          id: `class-${c.id}`,
          title: `${c.grade || "Grade"} ${c.stream ? `• ${c.stream}` : ""}`,
          subtitle: `Class Cohort • ${c.room || "Room"}`,
          icon: "meeting_room",
          category: "Classes & Streams",
          badge: "Class",
          action: () => navigate(`/academics`),
          score: 85,
        });
      }
    }
  }

  // 4. Match Students (Live Search)
  if (cachedStudents && cachedStudents.length) {
    let studentMatches = 0;
    for (const s of cachedStudents) {
      if (studentMatches >= 8) break; // Limit student matches to keep list snappy
      const name = (s.fullName || "").toLowerCase();
      const adm = (s.admissionNumber || "").toLowerCase();
      const upi = (s.upi || "").toLowerCase();
      const grade = `${s.grade || ""} ${s.stream || ""}`.toLowerCase();

      if (name.includes(cleanQ) || adm.includes(cleanQ) || upi.includes(cleanQ) || grade.includes(cleanQ)) {
        studentMatches++;
        results.push({
          id: `student-${s.id}`,
          title: s.fullName || "Unnamed Student",
          subtitle: `${s.admissionNumber ? `Adm: ${s.admissionNumber} • ` : ""}${s.grade || ""} ${s.stream || ""} • Status: ${s.status || "active"}`,
          icon: "school",
          category: "Learners",
          badge: s.admissionNumber ? `#${s.admissionNumber}` : "Student",
          action: () => navigate(`/students?q=${encodeURIComponent(s.admissionNumber || s.fullName)}`),
          score: adm === cleanQ ? 150 : (name.startsWith(cleanQ) ? 90 : 60),
        });
      }
    }
  }

  // 5. Match Staff (if available)
  if (cachedTeachers && cachedTeachers.length) {
    let staffMatches = 0;
    for (const t of cachedTeachers) {
      if (staffMatches >= 5) break;
      const tName = (t.fullName || "").toLowerCase();
      const tEmail = (t.email || "").toLowerCase();
      const tsc = (t.tscNumber || "").toLowerCase();

      if (tName.includes(cleanQ) || tEmail.includes(cleanQ) || tsc.includes(cleanQ)) {
        staffMatches++;
        results.push({
          id: `teacher-${t.id}`,
          title: t.fullName || t.email || "Faculty Member",
          subtitle: `${t.role || "Teacher"} • ${t.email || ""} ${t.tscNumber ? `• TSC: ${t.tscNumber}` : ""}`,
          icon: "person",
          category: "Staff",
          badge: "Staff",
          action: () => navigate(`/teachers?q=${encodeURIComponent(t.fullName || t.email)}`),
          score: 70,
        });
      }
    }
  }

  return results.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 16);
}

let currentSwitchTab = null;

/**
 * Opens and renders the command palette
 * @param {Object} options
 * @param {Object} options.profile Current user profile
 * @param {'search'|'hints'} [options.defaultTab='search'] Initial active tab
 */
export function openCommandPalette({ profile, defaultTab = "search" } = {}) {
  currentProfile = profile;

  if (paletteBackdrop) {
    if (typeof currentSwitchTab === "function" && defaultTab) {
      currentSwitchTab(defaultTab);
    }
    return;
  }

  selectedIndex = 0;
  prefetchEntities(profile);

  paletteBackdrop = el("div", {
    class: "cmd-palette-backdrop",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Global Command Palette & Shortcuts Guide",
  });

  const dialog = el("div", { class: "cmd-palette-dialog" });

  let activeTab = defaultTab === "hints" ? "hints" : "search";

  // Tab switch buttons
  const searchTabBtn = el(
    "button",
    {
      type: "button",
      class: `cmd-palette-tab${activeTab === "search" ? " cmd-palette-tab--active" : ""}`,
      role: "tab",
      "aria-selected": activeTab === "search" ? "true" : "false",
      onClick: () => switchTab("search"),
    },
    [
      icon("search", "cmd-palette-tab-icon"),
      el("span", {}, "Spotlight Search"),
      el("kbd", { class: "cmd-palette-tab-kbd" }, `${MODIFIER_LABEL} K`),
    ]
  );

  const hintsTabBtn = el(
    "button",
    {
      type: "button",
      class: `cmd-palette-tab${activeTab === "hints" ? " cmd-palette-tab--active" : ""}`,
      role: "tab",
      "aria-selected": activeTab === "hints" ? "true" : "false",
      onClick: () => switchTab("hints"),
    },
    [
      icon("keyboard", "cmd-palette-tab-icon"),
      el("span", {}, "Key Hints & Shortcuts"),
      el("kbd", { class: "cmd-palette-tab-kbd" }, "?"),
    ]
  );

  const tabsRow = el("div", { class: "cmd-palette-tabs", role: "tablist" }, [searchTabBtn, hintsTabBtn]);

  // --------------------------------------------------------------------------
  // SEARCH VIEW
  // --------------------------------------------------------------------------
  const searchView = el("div", {
    class: "cmd-palette-view cmd-palette-view--search",
    style: activeTab === "search" ? "" : "display:none;",
  });

  const input = el("input", {
    type: "text",
    class: "cmd-palette-input",
    placeholder: "Search commands, students, classes, or pages…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-autocomplete": "list",
  });

  const searchHeader = el("div", { class: "cmd-palette-header" }, [
    icon("search", "cmd-palette-search-icon"),
    input,
    el("kbd", { class: "cmd-palette-esc-badge" }, "ESC"),
  ]);

  const searchBody = el("div", { class: "cmd-palette-body", role: "listbox", id: "cmd-results" });

  const footerHintsLink = el(
    "button",
    {
      type: "button",
      class: "cmd-palette-footer-link",
      title: "View full keyboard instruction hints and shortcut letters",
      onClick: () => switchTab("hints"),
    },
    [
      el("kbd", {}, MODIFIER_LABEL),
      " + Letter Jump",
      el("span", { class: "cmd-palette-badge-pill" }, "View All Key Hints"),
    ]
  );

  const searchFooter = el("div", { class: "cmd-palette-footer" }, [
    el("div", { class: "cmd-palette-hints" }, [
      el("span", {}, [el("kbd", {}, "↑"), el("kbd", {}, "↓"), " Navigate"]),
      el("span", {}, [el("kbd", {}, "↵"), " Select"]),
      footerHintsLink,
      el("span", {}, [el("kbd", {}, "ESC"), " Close"]),
    ]),
    el("span", { class: "cmd-palette-brand" }, "Eeskia Spotlight"),
  ]);

  searchView.append(searchHeader, searchBody, searchFooter);

  // --------------------------------------------------------------------------
  // KEY HINTS & INSTRUCTION GUIDE VIEW
  // --------------------------------------------------------------------------
  const hintsView = el("div", {
    class: "cmd-palette-view cmd-palette-view--hints",
    style: activeTab === "hints" ? "" : "display:none;",
  });

  const hintsFilterInput = el("input", {
    type: "text",
    class: "cmd-palette-hints-filter",
    placeholder: "Filter key hints by letter, module or role (e.g. L, Fees, Attendance)…",
    autocomplete: "off",
    spellcheck: "false",
  });

  const hintsCountBadge = el("span", { class: "cmd-palette-hints-count badge badge--gold" }, "20 Shortcuts");

  const hintsHeader = el("div", { class: "cmd-palette-hints-header" }, [
    icon("tune", "cmd-palette-search-icon"),
    hintsFilterInput,
    hintsCountBadge,
    el("kbd", { class: "cmd-palette-esc-badge" }, "ESC"),
  ]);

  const instructionBanner = el("div", { class: "cmd-palette-instruction-banner" }, [
    el("div", { class: "cmd-palette-instruction-lead" }, [
      icon("bolt", "cmd-palette-banner-icon"),
      el("div", {}, [
        el("strong", {}, "Predefined Jump Letters: "),
        "Press ",
        el("kbd", {}, MODIFIER_LABEL),
        " + ",
        el("kbd", {}, "<Letter>"),
        " (or ",
        el("kbd", {}, "Alt"),
        " + ",
        el("kbd", {}, "<Letter>"),
        ") anywhere in the app to jump directly to any screen.",
      ]),
    ]),
    el("div", { class: "cmd-palette-instruction-safe" }, [
      icon("verified_user", "cmd-palette-banner-icon-safe"),
      el("div", {}, [
        el("strong", {}, "Input Protection: "),
        "Native text editing (",
        el("kbd", {}, "Ctrl+A"),
        " select-all, ",
        el("kbd", {}, "Ctrl+C"),
        ", ",
        el("kbd", {}, "Ctrl+V"),
        ", ",
        el("kbd", {}, "Ctrl+Z"),
        ") is preserved while typing inside form fields.",
      ]),
    ]),
  ]);

  const hintsBody = el("div", { class: "cmd-palette-hints-body" });

  const hintsFooter = el("div", { class: "cmd-palette-footer" }, [
    el("div", { class: "cmd-palette-hints" }, [
      icon("touch_app", "cmd-palette-footer-icon"),
      el("span", {}, "Click any shortcut card to jump directly"),
      el("span", {}, [el("kbd", {}, "ESC"), " Close"]),
    ]),
    el(
      "button",
      {
        type: "button",
        class: "cmd-palette-switch-search-btn",
        onClick: () => switchTab("search"),
      },
      [icon("search", "btn-icon-xs"), "Switch to Spotlight Search"]
    ),
  ]);

  hintsView.append(hintsHeader, instructionBanner, hintsBody, hintsFooter);

  dialog.append(tabsRow, searchView, hintsView);
  paletteBackdrop.append(dialog);
  document.body.appendChild(paletteBackdrop);

  function switchTab(tab) {
    activeTab = tab;
    if (tab === "search") {
      searchTabBtn.classList.add("cmd-palette-tab--active");
      searchTabBtn.setAttribute("aria-selected", "true");
      hintsTabBtn.classList.remove("cmd-palette-tab--active");
      hintsTabBtn.setAttribute("aria-selected", "false");
      searchView.style.display = "";
      hintsView.style.display = "none";
      setTimeout(() => input.focus(), 20);
      renderResults(input.value);
    } else {
      hintsTabBtn.classList.add("cmd-palette-tab--active");
      hintsTabBtn.setAttribute("aria-selected", "true");
      searchTabBtn.classList.remove("cmd-palette-tab--active");
      searchTabBtn.setAttribute("aria-selected", "false");
      searchView.style.display = "none";
      hintsView.style.display = "";
      setTimeout(() => hintsFilterInput.focus(), 20);
      renderHints(hintsFilterInput.value);
    }
  }

  currentSwitchTab = switchTab;

  // Render items helper for Search View
  function renderResults(query) {
    searchBody.innerHTML = "";
    currentItems = searchItems(query, currentProfile);

    if (!currentItems.length) {
      searchBody.append(
        el("div", { class: "cmd-palette-empty" }, [
          icon("search_off", "cmd-palette-empty-icon"),
          el("p", { class: "cmd-palette-empty-title" }, `No results found for "${query}"`),
          el("p", { class: "cmd-palette-empty-sub" }, "Try searching for a student name, admission number, class, or module."),
        ])
      );
      return;
    }

    if (selectedIndex >= currentItems.length) selectedIndex = 0;

    let lastCategory = null;
    currentItems.forEach((item, index) => {
      // Group header
      if (item.category && item.category !== lastCategory) {
        lastCategory = item.category;
        searchBody.append(el("div", { class: "cmd-palette-group-title" }, lastCategory));
      }

      const isSelected = index === selectedIndex;
      const shortcutText = item.letter ? `${MODIFIER_LABEL}+${item.letter}` : null;

      const itemEl = el(
        "div",
        {
          class: `cmd-palette-item${isSelected ? " cmd-palette-item--selected" : ""}`,
          role: "option",
          "aria-selected": isSelected ? "true" : "false",
          "data-index": String(index),
          onClick: () => executeItem(item),
          onMouseEnter: () => {
            selectedIndex = index;
            updateSelection();
          },
        },
        [
          el("div", { class: "cmd-palette-item-left" }, [
            el("div", { class: "cmd-palette-item-icon" }, [icon(item.icon || "arrow_forward")]),
            el("div", { class: "cmd-palette-item-texts" }, [
              el("div", { class: "cmd-palette-item-title" }, item.title),
              item.subtitle ? el("div", { class: "cmd-palette-item-sub" }, item.subtitle) : "",
            ]),
          ]),
          shortcutText
            ? el("span", { class: "cmd-palette-item-shortcut", title: `Press ${shortcutText} to jump directly` }, [
                el("kbd", {}, MODIFIER_LABEL),
                "+",
                el("kbd", {}, item.letter),
              ])
            : (item.badge ? el("span", { class: "cmd-palette-item-badge" }, item.badge) : ""),
        ]
      );

      searchBody.append(itemEl);
    });

    scrollSelectedIntoView();
  }

  function renderHints(filterQuery) {
    hintsBody.innerHTML = "";
    const cleanFilter = (filterQuery || "").trim().toLowerCase();
    const isSuperAdmin = currentProfile?.role === "super_admin";
    let visibleCount = 0;

    for (const group of SHORTCUT_GROUPS) {
      if (group.superAdminOnly && !isSuperAdmin) continue;

      const groupItems = group.letters
        .map((letter) => NAV_CATALOG.find((n) => n.letter === letter))
        .filter(Boolean);

      const matchedItems = groupItems.filter((item) => {
        if (!cleanFilter) return true;
        const letter = (item.letter || "").toLowerCase();
        const roleText = formatRoleSummary(item).toLowerCase();
        const haystack = `${item.title} ${item.subtitle} ${letter} ctrl+${letter} cmd+${letter} ${roleText}`.toLowerCase();
        return haystack.includes(cleanFilter);
      });

      if (!matchedItems.length) continue;
      visibleCount += matchedItems.length;

      const groupHeader = el("div", { class: "cmd-palette-hint-group-title" }, [
        icon(group.icon || "folder", "cmd-palette-group-icon"),
        el("span", {}, group.name),
      ]);
      hintsBody.append(groupHeader);

      matchedItems.forEach((item) => {
        const hasAccess = hasRolePermission(item, currentProfile);
        const roleLabel = formatRoleSummary(item);

        const card = el(
          "div",
          {
            class: `cmd-palette-hint-row${hasAccess ? "" : " cmd-palette-hint-row--restricted"}`,
            role: "button",
            tabindex: "0",
            title: hasAccess
              ? `Jump to ${item.title} (${MODIFIER_LABEL}+${item.letter})`
              : `Access restricted: Requires ${roleLabel}`,
            onClick: () => {
              if (hasAccess) {
                closeCommandPalette();
                navigate(item.path);
              } else {
                executeShortcutLetter(item.letter, currentProfile);
              }
            },
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (hasAccess) {
                  closeCommandPalette();
                  navigate(item.path);
                } else {
                  executeShortcutLetter(item.letter, currentProfile);
                }
              }
            },
          },
          [
            el("div", { class: "cmd-palette-hint-left" }, [
              el("div", { class: "cmd-palette-hint-icon" }, [icon(item.icon || "arrow_forward")]),
              el("div", { class: "cmd-palette-hint-info" }, [
                el("div", { class: "cmd-palette-hint-title" }, item.title),
                el("div", { class: "cmd-palette-hint-sub" }, item.subtitle || ""),
              ]),
            ]),
            el("div", { class: "cmd-palette-hint-right" }, [
              hasAccess
                ? el("span", { class: "badge badge--outline cmd-palette-hint-role-badge" }, roleLabel)
                : el("span", { class: "badge badge--danger cmd-palette-hint-role-badge" }, [
                    icon("lock", "badge-icon-xs"),
                    roleLabel,
                  ]),
              el("span", { class: "cmd-palette-hint-key" }, [
                el("kbd", {}, MODIFIER_LABEL),
                "+",
                el("kbd", {}, item.letter),
              ]),
            ]),
          ]
        );

        hintsBody.append(card);
      });
    }

    // System Hotkeys section
    const matchedSystem = SYSTEM_HOTKEYS.filter((sys) => {
      if (!cleanFilter) return true;
      const haystack = `${sys.title} ${sys.subtitle} ${sys.keys.join(" ")}`.toLowerCase();
      return haystack.includes(cleanFilter);
    });

    if (matchedSystem.length) {
      const sysHeader = el("div", { class: "cmd-palette-hint-group-title" }, [
        icon("tune", "cmd-palette-group-icon"),
        el("span", {}, "System Hotkeys & Controls"),
      ]);
      hintsBody.append(sysHeader);

      matchedSystem.forEach((sys) => {
        const card = el(
          "div",
          {
            class: "cmd-palette-hint-row",
            role: "button",
            tabindex: "0",
            onClick: () => {
              if (sys.actionType === "search") switchTab("search");
              else if (sys.actionType === "close") closeCommandPalette();
              else if (sys.actionType === "settings") executeShortcutLetter("L", currentProfile);
            },
          },
          [
            el("div", { class: "cmd-palette-hint-left" }, [
              el("div", { class: "cmd-palette-hint-icon" }, [icon(sys.icon)]),
              el("div", { class: "cmd-palette-hint-info" }, [
                el("div", { class: "cmd-palette-hint-title" }, sys.title),
                el("div", { class: "cmd-palette-hint-sub" }, sys.subtitle),
              ]),
            ]),
            el("div", { class: "cmd-palette-hint-right" }, [
              el("span", { class: "cmd-palette-hint-key" }, sys.keys.map((k) => el("kbd", {}, k))),
            ]),
          ]
        );
        hintsBody.append(card);
      });
    }

    hintsCountBadge.textContent = `${visibleCount} Module Shortcuts`;

    if (visibleCount === 0 && !matchedSystem.length) {
      hintsBody.append(
        el("div", { class: "cmd-palette-empty" }, [
          icon("search_off", "cmd-palette-empty-icon"),
          el("p", { class: "cmd-palette-empty-title" }, `No shortcut hints matching "${filterQuery}"`),
          el("p", { class: "cmd-palette-empty-sub" }, "Try typing a single shortcut letter like 'L', 'A', 'F', or clear your search."),
        ])
      );
    }
  }

  function updateSelection() {
    const elements = searchBody.querySelectorAll(".cmd-palette-item");
    elements.forEach((elNode, idx) => {
      if (idx === selectedIndex) {
        elNode.classList.add("cmd-palette-item--selected");
        elNode.setAttribute("aria-selected", "true");
      } else {
        elNode.classList.remove("cmd-palette-item--selected");
        elNode.setAttribute("aria-selected", "false");
      }
    });
    scrollSelectedIntoView();
  }

  function scrollSelectedIntoView() {
    const selectedEl = searchBody.querySelector(".cmd-palette-item--selected");
    if (selectedEl && typeof selectedEl.scrollIntoView === "function") {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  function executeItem(item) {
    if (!item) return;
    closeCommandPalette();
    try {
      if (typeof item.action === "function") {
        item.action();
      }
    } catch (err) {
      console.error("[CommandPalette] execution error:", err);
    }
  }

  // Keyboard Navigation inside search input
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIndex = (selectedIndex + 1) % currentItems.length;
        updateSelection();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
        updateSelection();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentItems[selectedIndex]) {
        executeItem(currentItems[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "Tab") {
      e.preventDefault();
      switchTab("hints");
    } else if (e.key === "?" && !input.value) {
      e.preventDefault();
      switchTab("hints");
    }
  });

  input.addEventListener("input", (e) => {
    selectedIndex = 0;
    renderResults(e.target.value);
  });

  hintsFilterInput.addEventListener("input", (e) => {
    renderHints(e.target.value);
  });

  hintsFilterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "Tab") {
      e.preventDefault();
      switchTab("search");
    }
  });

  // Close on backdrop click outside dialog
  paletteBackdrop.addEventListener("click", (e) => {
    if (!dialog.contains(e.target)) {
      closeCommandPalette();
    }
  });

  // Initial render & focus based on active tab
  if (activeTab === "hints") {
    renderHints("");
    setTimeout(() => hintsFilterInput.focus(), 25);
  } else {
    renderResults("");
    setTimeout(() => input.focus(), 25);
  }
}

/**
 * Closes the command palette dialog
 */
export function closeCommandPalette() {
  if (!paletteBackdrop) return;
  paletteBackdrop.remove();
  paletteBackdrop = null;
  currentSwitchTab = null;
  currentItems = [];
}

/**
 * Toggles palette state
 * @param {Object} [options]
 * @param {Object} [options.profile]
 * @param {'search'|'hints'} [options.defaultTab='search']
 */
export function toggleCommandPalette({ profile, defaultTab = "search" } = {}) {
  if (paletteBackdrop) {
    closeCommandPalette();
  } else {
    openCommandPalette({ profile, defaultTab });
  }
}

/**
 * Direct shortcut executor for module jump letters (e.g. 'L' for Settings)
 * @param {string} letter
 * @param {Object} profile
 * @returns {boolean} whether jump was handled
 */
export function executeShortcutLetter(letter, profile = currentProfile) {
  if (!letter) return false;
  const upper = String(letter).toUpperCase();
  const hit = NAV_CATALOG.find((m) => m.letter === upper || (upper === "," && m.id === "nav-settings"));
  if (!hit) return false;

  const allowed =
    hit.allRoles ||
    (hit.roles && profile?.role && hit.roles.includes(profile.role)) ||
    profile?.role === "super_admin";

  if (!allowed) {
    toast(`${hit.title} is restricted for your role`, "warning", 2500);
    return false;
  }

  navigate(hit.path);
  return true;
}

/**
 * Global Keyboard Shortcut Listener for Ctrl+K, '?' Hints, and Ctrl/Alt+Letter Module Jumps
 */
let isListenerAttached = false;
export function initCommandPalette(profile) {
  currentProfile = profile;
  prefetchEntities(profile);

  if (isListenerAttached || typeof window === "undefined") return;
  isListenerAttached = true;

  window.addEventListener("keydown", (e) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    const isAlt = e.altKey;
    const isK = e.key === "k" || e.key === "K";

    // 1. Toggle Palette on Ctrl+K / Cmd+K
    if (isCmdOrCtrl && isK) {
      e.preventDefault();
      toggleCommandPalette({ profile: currentProfile, defaultTab: "search" });
      return;
    }

    // 2. Escape closes palette if open
    if (e.key === "Escape" && paletteBackdrop) {
      e.preventDefault();
      closeCommandPalette();
      return;
    }

    // 3. Open Key Hints Guide on '?' or 'Ctrl+/' (outside input fields)
    const activeEl = document.activeElement;
    const isInsidePalette = paletteBackdrop && paletteBackdrop.contains(activeEl);
    const isTextInput =
      activeEl &&
      (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);

    if (!isTextInput && (e.key === "?" || (isCmdOrCtrl && e.key === "/"))) {
      e.preventDefault();
      if (paletteBackdrop) {
        if (typeof currentSwitchTab === "function") {
          currentSwitchTab("hints");
        }
      } else {
        openCommandPalette({ profile: currentProfile, defaultTab: "hints" });
      }
      return;
    }

    // 4. Predefined Module Jump Shortcuts (Ctrl + Letter or Alt + Letter)
    // Example: Ctrl + L jumps directly to School Settings!
    if ((isCmdOrCtrl || isAlt) && !e.shiftKey) {
      const rawKey = e.key || "";
      const upper = rawKey.toUpperCase();
      const isSettingsComma = isCmdOrCtrl && rawKey === ",";
      const targetLetter = isSettingsComma ? "L" : upper;

      const hit = NAV_CATALOG.find((m) => m.letter === targetLetter);
      if (!hit) return;

      // Preserve native editing shortcuts in form inputs (like Ctrl+A select all) outside the palette
      if (isTextInput && !isInsidePalette) {
        if (["A", "Z", "Y", "C", "V", "X"].includes(upper) && isCmdOrCtrl) {
          return;
        }
      }

      e.preventDefault();
      if (paletteBackdrop) {
        closeCommandPalette();
      }

      executeShortcutLetter(targetLetter, currentProfile);
    }
  });
}
