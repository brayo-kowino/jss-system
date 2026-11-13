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

/**
 * Opens and renders the command palette
 */
export function openCommandPalette({ profile }) {
  if (paletteBackdrop) return; // already open
  currentProfile = profile;
  selectedIndex = 0;

  prefetchEntities(profile);

  paletteBackdrop = el("div", {
    class: "cmd-palette-backdrop",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Global Command Palette",
  });

  const dialog = el("div", { class: "cmd-palette-dialog" });

  // Search input header
  const input = el("input", {
    type: "text",
    class: "cmd-palette-input",
    placeholder: "Search commands, students, classes, or pages…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-autocomplete": "list",
  });

  const header = el("div", { class: "cmd-palette-header" }, [
    icon("search", "cmd-palette-search-icon"),
    input,
    el("kbd", { class: "cmd-palette-esc-badge" }, "ESC"),
  ]);

  const body = el("div", { class: "cmd-palette-body", role: "listbox", id: "cmd-results" });
  const footer = el("div", { class: "cmd-palette-footer" }, [
    el("div", { class: "cmd-palette-hints" }, [
      el("span", {}, [el("kbd", {}, "↑"), el("kbd", {}, "↓"), " Navigate"]),
      el("span", {}, [el("kbd", {}, "↵"), " Select"]),
      el("span", {}, [el("kbd", {}, MODIFIER_LABEL), " + Letter Jump"]),
      el("span", {}, [el("kbd", {}, "ESC"), " Close"]),
    ]),
    el("span", { class: "cmd-palette-brand" }, "Eeskia Spotlight"),
  ]);

  dialog.append(header, body, footer);
  paletteBackdrop.append(dialog);
  document.body.appendChild(paletteBackdrop);

  // Render items helper
  function renderResults(query) {
    body.innerHTML = "";
    currentItems = searchItems(query, currentProfile);

    if (!currentItems.length) {
      body.append(
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
        body.append(el("div", { class: "cmd-palette-group-title" }, lastCategory));
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

      body.append(itemEl);
    });

    scrollSelectedIntoView();
  }

  function updateSelection() {
    const elements = body.querySelectorAll(".cmd-palette-item");
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
    const selectedEl = body.querySelector(".cmd-palette-item--selected");
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

  // Keyboard Navigation inside input
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
    }
  });

  input.addEventListener("input", (e) => {
    selectedIndex = 0;
    renderResults(e.target.value);
  });

  // Close on backdrop click outside dialog
  paletteBackdrop.addEventListener("click", (e) => {
    if (!dialog.contains(e.target)) {
      closeCommandPalette();
    }
  });

  // Initial render & focus
  renderResults("");
  setTimeout(() => input.focus(), 20);
}

/**
 * Closes the command palette dialog
 */
export function closeCommandPalette() {
  if (!paletteBackdrop) return;
  paletteBackdrop.remove();
  paletteBackdrop = null;
  currentItems = [];
}

/**
 * Toggles palette state
 */
export function toggleCommandPalette({ profile }) {
  if (paletteBackdrop) {
    closeCommandPalette();
  } else {
    openCommandPalette({ profile });
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
 * Global Keyboard Shortcut Listener for Ctrl+K and Ctrl/Alt+Letter Module Jumps
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
      toggleCommandPalette({ profile: currentProfile });
      return;
    }

    // 2. Escape closes palette if open
    if (e.key === "Escape" && paletteBackdrop) {
      e.preventDefault();
      closeCommandPalette();
      return;
    }

    // 3. Predefined Module Jump Shortcuts (Ctrl + Letter or Alt + Letter)
    // Example: Ctrl + L jumps directly to School Settings!
    if ((isCmdOrCtrl || isAlt) && !e.shiftKey) {
      const rawKey = e.key || "";
      const upper = rawKey.toUpperCase();
      const isSettingsComma = isCmdOrCtrl && rawKey === ",";
      const targetLetter = isSettingsComma ? "L" : upper;

      const hit = NAV_CATALOG.find((m) => m.letter === targetLetter);
      if (!hit) return;

      const activeEl = document.activeElement;
      const isInsidePalette = paletteBackdrop && paletteBackdrop.contains(activeEl);
      const isTextInput =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);

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
