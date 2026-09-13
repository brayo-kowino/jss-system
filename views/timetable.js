import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { listTeachers, getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import {
  DAYS,
  listPeriods,
  seedDefaultPeriodsIfEmpty,
  addPeriod,
  updatePeriod,
  deletePeriod,
  getClassTimetable,
  getTeacherTimetable,
  assignSlot,
  clearSlot,
} from "../js/services/timetable.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton, mobileOnlyNotice } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];
// Only these roles ever need the *full* teacher roster (assign-slot modal's
// teacher dropdown, or the "pick any teacher" selector below) - everyone
// else only ever looks up their own linked teacher record. firestore.rules
// only lets these roles list the whole `teachers` collection; a class_teacher/
// subject_teacher/bursar/registrar calling listTeachers() gets the entire
// query denied (Firestore can't verify every doc in a multi-doc query
// satisfies an "own record" rule), which used to throw out of render()
// itself and land everyone but these roles on the generic access-denied
// error card just for opening the Timetable page.
const CAN_SEE_ALL_TEACHERS = ["admin", "academic_master", "principal", "deputy_principal"];

let classes = [];
let subjects = [];
let teachers = [];
let periods = [];
let classSelection = { grade: "", stream: "" };
let classSlots = {};
let teacherSelection = { teacherId: "" };
let teacherSlots = {};
let activeTab = "classes"; // "classes" | "teachers" | "periods"

/**
 * Contextual help tooltip using dark-slate bubble styling.
 */
function infoTooltip(title, text, align = "center") {
  const alignClass = align === "right" ? " tooltip-bubble--right" : (align === "left" ? " tooltip-bubble--left" : "");
  return el("span", {
    class: "tooltip-wrap tooltip-wrap--inline",
    tabindex: "0",
    role: "button",
    "aria-label": title,
  }, [
    el("span", { class: "tooltip-trigger-icon material-symbols-rounded" }, "help"),
    el("span", { class: `tooltip-bubble tooltip-bubble--wide${alignClass}`, role: "tooltip" }, [
      el("span", { class: "tooltip-bubble__title" }, [
        icon("info"),
        title,
      ]),
      el("span", { class: "tooltip-bubble__text" }, text),
    ]),
  ]);
}

/**
 * Dynamic Academic Timekeeper mascot with master schedule clipboard and ringing school bell.
 */
export function buildTimetableMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="timetable-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Timetable Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks & Period Schedules Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#0EA5E9" stroke="#0284C7" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#BAE6FD" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Master Weekly Timetable Clipboard -->
        <g class="timetable-mascot__schedule">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Clipboard Board -->
          <rect x="54" y="122" width="32" height="36" rx="3" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" transform="rotate(-6 70 140)" />
          <rect x="62" y="119" width="16" height="5" rx="1.5" fill="#C9A227" transform="rotate(-6 70 140)" />
          <!-- Timetable Grid Slots on Sheet -->
          <rect x="58" y="127" width="11" height="6" rx="1" fill="#0EA5E9" opacity="0.85" />
          <rect x="71" y="127" width="11" height="6" rx="1" fill="#059669" opacity="0.85" />
          <rect x="58" y="135" width="11" height="6" rx="1" fill="#C9A227" opacity="0.85" />
          <rect x="71" y="135" width="11" height="6" rx="1" fill="#14538A" opacity="0.85" />
          <rect x="58" y="143" width="24" height="4" rx="1" fill="#E2E8F0" />
          <rect x="58" y="149" width="11" height="5" rx="1" fill="#8B5CF6" opacity="0.85" />
          <rect x="71" y="149" width="11" height="5" rx="1" fill="#0EA5E9" opacity="0.85" />
          <!-- Hand Holding Clipboard -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Golden School Bell (Animated) -->
        <g class="timetable-mascot__bell">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Bell Wooden Handle -->
          <line x1="150" y1="110" x2="162" y2="92" stroke="#78350F" stroke-width="4" stroke-linecap="round" />
          <!-- Bell Brass Cap -->
          <rect x="159" y="90" width="6" height="4" rx="1" fill="#D97706" />
          <!-- Bell Flare Body -->
          <path d="M155,94 C155,103 147,109 144,115 L178,115 C175,109 167,103 167,94 Z" fill="#F59E0B" stroke="#B45309" stroke-width="1.2" />
          <ellipse cx="161" cy="115" rx="17" ry="4" fill="#FDE68A" stroke="#B45309" stroke-width="1" />
          <!-- Bell Clapper -->
          <circle cx="161" cy="118" r="3" fill="#78350F" />
          <!-- Bell Sound Waves -->
          <path d="M180,98 C185,102 185,108 180,112" stroke="#F59E0B" stroke-width="1.6" fill="none" stroke-linecap="round" />
          <path d="M184,94 C191,100 191,110 184,116" stroke="#D97706" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.75" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

/**
 * Guided welcome card with 4 critical operational disclaimers.
 */
function renderWelcomeDisclaimers(container, mode = "class") {
  container.innerHTML = "";

  const welcomeCard = el("div", { class: "timetable-welcome-card" }, [
    el("div", { class: "timetable-welcome-header" }, [
      icon("schedule", "text-primary", "style: font-size:36px;"),
      el("h3", {}, mode === "teacher" ? "Select a Faculty Member to View Schedule" : "Select a Class to View Schedule"),
      el("p", {}, mode === "teacher"
        ? "Choose a teacher above to inspect their assigned instructional periods, subject rooms, and free slots."
        : "Choose a Grade and Stream above to view or assign weekly lessons, teachers, and break periods."),
    ]),

    // Important Operational Disclaimers Grid
    el("div", { class: "timetable-disclaimers-grid" }, [
      el("div", { class: "timetable-disclaimer-card timetable-disclaimer-card--info" }, [
        el("div", { class: "timetable-disclaimer-title" }, [
          icon("lock", "text-primary"),
          "Automated Conflict Prevention",
        ]),
        el("p", { class: "timetable-disclaimer-body" }, "Timetable actively monitors teacher allocations. If a teacher is already assigned in the same period and day, double-booking is blocked automatically."),
      ]),
      el("div", { class: "timetable-disclaimer-card timetable-disclaimer-card--warning" }, [
        el("div", { class: "timetable-disclaimer-title" }, [
          icon("free_breakfast", "text-amber"),
          "School-Wide Break Periods",
        ]),
        el("p", { class: "timetable-disclaimer-body" }, "Periods configured as 'Break' automatically span all streams and grades school-wide. Instructional subject lessons cannot be booked during break intervals."),
      ]),
      el("div", { class: "timetable-disclaimer-card timetable-disclaimer-card--success" }, [
        el("div", { class: "timetable-disclaimer-title" }, [
          icon("verified", "text-green"),
          "Qualified Subject Teachers",
        ]),
        el("p", { class: "timetable-disclaimer-body" }, "The slot assignment dialog groups and highlights teachers assigned to the chosen subject first, ensuring CBC subject specialization."),
      ]),
      el("div", { class: "timetable-disclaimer-card timetable-disclaimer-card--danger" }, [
        el("div", { class: "timetable-disclaimer-title" }, [
          icon("warning", "text-red"),
          "Period Modifications & Deletion",
        ]),
        el("p", { class: "timetable-disclaimer-body" }, "Altering period start or end times updates all class schedules school-wide. Deleting an active period permanently unlinks all assigned lesson slots."),
      ]),
    ]),
  ]);

  container.append(welcomeCard);
}

export async function render({ profile }) {
  if (CAN_MANAGE.includes(profile.role)) {
    await seedDefaultPeriodsIfEmpty();
  }
  [classes, subjects, teachers, periods] = await Promise.all([
    listClasses(), listSubjects(), CAN_SEE_ALL_TEACHERS.includes(profile.role) ? listTeachers() : Promise.resolve([]), listPeriods(),
  ]);

  const wrap = el("div", { class: "timetable-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildTimetableMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "timetable-hero" }, [
    el("div", { class: "timetable-hero__content" }, [
      el("div", { class: "timetable-hero__status-row" }, [
        el("span", { class: "academics-cycle-badge" }, [
          icon("schedule", "text-xs"),
          "Academic Master Scheduling · Conflict-Free Matrix",
          infoTooltip("Weekly instructional timetable with conflict detection, period bell schedules, and teacher workload distribution."),
        ]),
      ]),
      el("h1", { class: "timetable-hero__title" }, "School Timetable & Scheduling"),
      el("p", { class: "timetable-hero__desc" }, "Manage weekly instructional periods, class timetables, and teacher allocation matrix."),
      el("div", { class: "timetable-hero__pills" }, [
        el("div", { class: "timetable-pill" }, [icon("schedule"), `${periods.length} Daily Periods`]),
        el("div", { class: "timetable-pill" }, [icon("school"), `${classes.length} Grade Cohorts`]),
        teachers.length ? el("div", { class: "timetable-pill" }, [icon("person"), `${teachers.length} Faculty Members`]) : null,
        el("div", { class: "timetable-pill" }, [icon("lock"), "Conflict Detection Active"]),
      ].filter(Boolean)),
    ]),

    // Mascot & Speech Bubble
    el("div", { class: "timetable-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Organize periods, assign subject teachers, and avoid scheduling conflicts."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Mobile horizontal scroll guidance
  wrap.append(mobileOnlyNotice("The weekly schedule is easier to read and edit on a tablet or laptop - on a phone you'll need to scroll sideways through the days."));

  // Segmented Navigation Tabs
  const canManage = CAN_MANAGE.includes(profile.role);
  const tabNav = el("div", { class: "timetable-tabs no-print" });
  const tabContentMount = el("div", { id: "timetable-tab-content" });

  const tabsConfig = [
    { id: "classes", label: "Class Schedules", iconName: "school" },
    { id: "teachers", label: "Teacher Schedules", iconName: "person" },
    ...(canManage ? [{ id: "periods", label: "Period Configuration", iconName: "schedule" }] : []),
  ];

  function renderTabs() {
    tabNav.innerHTML = "";
    tabsConfig.forEach((tab) => {
      const btn = el("button", {
        type: "button",
        class: `timetable-tab ${activeTab === tab.id ? "timetable-tab--active" : ""}`,
        onClick: () => {
          activeTab = tab.id;
          renderTabs();
          switchTab(activeTab);
        },
      }, [
        icon(tab.iconName, "text-xs"),
        tab.label,
      ]);
      tabNav.append(btn);
    });
  }

  async function switchTab(tabId) {
    tabContentMount.innerHTML = "";

    if (tabId === "classes") {
      const classCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
      const classGridMount = el("div", { style: "margin-top:16px;" });
      tabContentMount.append(classCard, classGridMount);
      renderClassPicker(classCard, profile, classGridMount);
      if (classSelection.grade && classSelection.stream) {
        await loadClassGrid(profile, classGridMount);
      } else {
        renderWelcomeDisclaimers(classGridMount, "class");
      }
    } else if (tabId === "teachers") {
      const teacherCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
      const teacherGridMount = el("div", { style: "margin-top:16px;" });
      tabContentMount.append(teacherCard, teacherGridMount);
      await renderTeacherPicker(teacherCard, profile, teacherGridMount);
      if (!teacherSelection.teacherId) {
        renderWelcomeDisclaimers(teacherGridMount, "teacher");
      }
    } else if (tabId === "periods") {
      const periodsCard = el("div", { class: "card" });
      tabContentMount.append(periodsCard);
      renderPeriods(periodsCard, profile);
    }
  }

  renderTabs();
  wrap.append(tabNav);
  wrap.append(tabContentMount);

  // Initial tab render
  await switchTab(activeTab);

  return wrap;
}

// ------------------------------------------------------------------ Periods --

function renderPeriods(container, profile) {
  container.innerHTML = "";
  container.append(
    el("div", {
      style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;"
    }, [
      el("div", {}, [
        el("h3", { style: "margin:0 0 2px; color:var(--color-primary-900); font-family:var(--font-display);" }, "Instructional Periods & Bell Times"),
        el("p", { class: "text-muted text-xs", style: "margin:0;" }, `${periods.length} periods configured school-wide. Changes apply to all grade levels.`),
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => openPeriodModal(profile, null, container)
      }, [icon("add", "text-xs"), "Add Period"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "border:1px solid var(--color-line); border-radius:var(--radius-md); overflow:hidden;" });
  const table = el("table", { class: "reports-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:180px;" }, "Period Name"),
      el("th", { style: "width:140px;" }, "Start Time"),
      el("th", { style: "width:140px;" }, "End Time"),
      el("th", { class: "col-center", style: "width:130px;" }, "Type"),
      el("th", { class: "col-right", style: "width:160px;" }, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const p of periods) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Period Name" }, [
        el("span", { style: "font-weight:600; color:var(--color-ink);" }, p.name),
      ]),
      el("td", { "data-label": "Start Time" }, [
        el("span", { style: "font-family:var(--font-mono, monospace); font-weight:600;" }, p.startTime),
      ]),
      el("td", { "data-label": "End Time" }, [
        el("span", { style: "font-family:var(--font-mono, monospace); font-weight:600;" }, p.endTime),
      ]),
      el("td", { class: "col-center", "data-label": "Type" }, [
        el("span", { class: `badge badge--${p.isBreak ? "gold" : "success"}` }, p.isBreak ? "Break" : "Lesson"),
      ]),
      el("td", { class: "col-right", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
          el("button", { class: "btn btn--ghost btn--xs", onClick: () => openPeriodModal(profile, p, container) }, [icon("edit", "text-xs"), "Edit"]),
          el("button", { class: "btn btn--ghost btn--xs", style: "color:var(--color-red);", onClick: () => handleDeletePeriod(profile, p, container) }, [icon("delete", "text-xs"), "Delete"]),
        ]),
      ]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function openPeriodModal(profile, existing, container) {
  const isEdit = !!existing;
  const body = el("form", {});
  const nameInput = el("input", { type: "text", value: existing?.name || "", placeholder: "e.g. Period 1, Lunch Break" });
  const startInput = el("input", { type: "time", value: existing?.startTime || "" });
  const endInput = el("input", { type: "time", value: existing?.endTime || "" });
  const breakCheck = el("input", { type: "checkbox", ...(existing?.isBreak ? { checked: "true" } : {}) });

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Period Name"), nameInput]),
    el("div", { class: "field" }, [el("label", {}, "Start Time"), startInput]),
    el("div", { class: "field" }, [el("label", {}, "End Time"), endInput]),
    el("div", { class: "field" }, [
      el("label", { class: "checklist-item" }, [breakCheck, "This is a break / lunch period (blocks lesson assignments)"]),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save Changes" : "Add Period"])
  );

  const close = openModal(isEdit ? `Edit ${existing.name}` : "Add Period", body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const payload = { name: nameInput.value, startTime: startInput.value, endTime: endInput.value, isBreak: breakCheck.checked };
      if (isEdit) await updatePeriod(profile.uid, existing.id, payload);
      else await addPeriod(profile.uid, payload);
      periods = await listPeriods();
      renderPeriods(container, profile);
      toast(`Period ${isEdit ? "updated" : "added"}.`, "success");
      close();
    } catch (err) {
      toast(err.message || "Could not save period.", "error");
      restore();
    }
  });
}

async function handleDeletePeriod(profile, period, container) {
  if (!confirm(`Delete "${period.name}"? Active lessons assigned to this period will be unlinked.`)) return;
  try {
    await deletePeriod(profile.uid, period.id);
    periods = await listPeriods();
    renderPeriods(container, profile);
    toast("Period deleted.", "success");
  } catch (err) {
    toast(err.message || "Could not delete period.", "error");
  }
}

// -------------------------------------------------------------- Class grid --

function classOptions() {
  const opts = [];
  for (const c of classes) {
    for (const s of c.streams || []) opts.push({ grade: c.grade, stream: s });
  }
  return opts;
}

function renderClassPicker(container, profile, gridMount) {
  container.innerHTML = "";
  const opts = classOptions();

  const select = el("select", { style: "min-width:220px;" }, [
    el("option", { value: "" }, "Select class cohort"),
    ...opts.map((o) => el("option", {
      value: `${o.grade}|${o.stream}`,
      ...(`${o.grade}|${o.stream}` === `${classSelection.grade}|${classSelection.stream}` ? { selected: "true" } : {})
    }, `${o.grade} ${o.stream}`)),
  ]);

  select.addEventListener("change", async () => {
    const [grade, stream] = select.value.split("|");
    classSelection = { grade: grade || "", stream: stream || "" };
    if (!classSelection.grade || !classSelection.stream) {
      renderWelcomeDisclaimers(gridMount, "class");
    } else {
      await loadClassGrid(profile, gridMount);
    }
  });

  const headerRow = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;"
  }, [
    el("div", { style: "display:flex; align-items:center; gap:12px; flex-wrap:wrap;" }, [
      el("div", { class: "field", style: "margin:0;" }, [
        el("label", { style: "display:flex; align-items:center; gap:4px; font-weight:600; margin-bottom:4px;" }, [
          icon("school", "text-xs"),
          "Class Cohort",
        ]),
        select,
      ]),
    ]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm hide-on-mobile",
        onClick: () => window.print(),
      }, [icon("print", "text-xs"), "Print Timetable"]),
    ]),
  ]);

  container.append(headerRow);
}

async function loadClassGrid(profile, gridMount) {
  if (!classSelection.grade || !classSelection.stream) {
    renderWelcomeDisclaimers(gridMount, "class");
    return;
  }
  gridMount.innerHTML = "";
  gridMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "70%"),
  ]));
  classSlots = await getClassTimetable(classSelection.grade, classSelection.stream);
  renderGrid(gridMount, {
    canManage: CAN_MANAGE.includes(profile.role),
    getSlot: (day, periodId) => classSlots[`${day}_${periodId}`],
    onCellClick: (day, period) => openAssignModal(profile, day, period, gridMount),
    emptyLabel: "+ Assign",
    pillRenderer: (slot) => [
      el("b", { style: "color:var(--color-primary-900); font-weight:700;" }, slot.subjectName || slot.subjectCode),
      el("span", { style: "color:var(--color-ink-soft); font-size:11px;" }, slot.teacherName || "Unassigned"),
      ...(slot.room ? [el("span", { style: "font-family:var(--font-mono, monospace); font-size:10px; background:var(--color-cream-dim, #f8fafc); padding:1px 4px; border-radius:3px; border:1px solid var(--color-line); display:inline-block; margin-top:2px;" }, slot.room)] : []),
    ],
  });
}

async function openAssignModal(profile, day, period, gridMount) {
  if (!CAN_MANAGE.includes(profile.role)) return;
  if (CAN_SEE_ALL_TEACHERS.includes(profile.role)) {
    try {
      teachers = await listTeachers();
    } catch {}
  }
  const existing = classSlots[`${day}_${period.id}`];
  const body = el("form", {});
  const subjectSelect = el("select", {}, [
    el("option", { value: "" }, "Select subject"),
    ...subjects.map((s) => el("option", { value: s.code, ...(s.code === existing?.subjectCode ? { selected: "true" } : {}) }, s.name)),
  ]);
  const teacherSelect = el("select", {}, [el("option", { value: "" }, "Select teacher (optional)")]);
  const roomInput = el("input", { type: "text", value: existing?.room || "", placeholder: "e.g. Room 12, Science Lab, Field" });

  function refreshTeachers() {
    const code = subjectSelect.value;
    const currentVal = teacherSelect.value || existing?.teacherId || "";
    teacherSelect.innerHTML = "";
    teacherSelect.append(el("option", { value: "" }, "Select teacher (optional)"));

    const qualified = teachers.filter((t) => code && (t.subjectCodes || []).includes(code));
    const others = teachers.filter((t) => !code || !(t.subjectCodes || []).includes(code));

    if (code && qualified.length > 0) {
      const groupQ = el("optgroup", { label: "Subject Teachers" });
      for (const t of qualified) {
        groupQ.append(el("option", { value: t.id, ...(t.id === currentVal ? { selected: "true" } : {}) }, t.fullName));
      }
      teacherSelect.append(groupQ);
      if (others.length > 0) {
        const groupO = el("optgroup", { label: "Other Faculty" });
        for (const t of others) {
          groupO.append(el("option", { value: t.id, ...(t.id === currentVal ? { selected: "true" } : {}) }, t.fullName));
        }
        teacherSelect.append(groupO);
      }
    } else {
      for (const t of teachers) {
        teacherSelect.append(el("option", { value: t.id, ...(t.id === currentVal ? { selected: "true" } : {}) }, t.fullName));
      }
    }
    if (currentVal) {
      teacherSelect.value = currentVal;
    }
  }
  refreshTeachers();
  subjectSelect.addEventListener("change", refreshTeachers);

  body.append(
    el("div", { class: "callout callout--info", style: "margin-bottom:12px; padding:8px 12px; font-size:12px;" }, [
      icon("schedule", "text-xs"),
      `${classSelection.grade} ${classSelection.stream} · ${day} · ${period.name} (${period.startTime}–${period.endTime})`,
    ]),
    el("div", { class: "field" }, [el("label", {}, "Subject"), subjectSelect]),
    el("div", { class: "field" }, [el("label", {}, "Teacher"), teacherSelect]),
    el("div", { class: "field" }, [el("label", {}, "Room / Location (optional)"), roomInput]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(existing ? "save" : "add_task"), existing ? "Save Changes" : "Assign Slot"])
  );

  const close = openModal("Assign Timetable Slot", body);

  if (existing) {
    body.append(el("button", {
      type: "button", class: "btn btn--ghost btn--block", style: "margin-top:8px; color:var(--color-red);",
      onClick: async (e) => {
        const restore = busyButton(e.currentTarget, "Clearing…");
        try {
          await clearSlot(profile.uid, classSelection.grade, classSelection.stream, day, period.id);
          toast("Slot cleared.", "success");
          close();
          await loadClassGrid(profile, gridMount);
        } catch (err) {
          toast(err.message || "Could not clear slot.", "error");
          restore();
        }
      },
    }, [icon("backspace", "text-xs"), "Clear this slot"]));
  }

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const subject = subjects.find((s) => s.code === subjectSelect.value);
    const teacher = teachers.find((t) => t.id === teacherSelect.value);
    if (!subject) { restore(); return toast("Select a subject.", "error"); }
    try {
      await assignSlot(profile.uid, {
        grade: classSelection.grade,
        stream: classSelection.stream,
        day,
        periodId: period.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        teacherId: teacher?.id || "",
        teacherName: teacher?.fullName || "",
        room: roomInput.value,
      });
      toast("Timetable slot saved.", "success");
      close();
      await loadClassGrid(profile, gridMount);
    } catch (err) {
      toast(err.message || "Could not save slot - check for a conflict.", "error");
      restore();
    }
  });
}

// ------------------------------------------------------------ Teacher grid --

async function renderTeacherPicker(container, profile, gridMount) {
  container.innerHTML = "";

  const canPickAny = CAN_SEE_ALL_TEACHERS.includes(profile.role);
  if (canPickAny) {
    const select = el("select", { style: "min-width:220px;" }, [
      el("option", { value: "" }, "Select faculty member"),
      ...teachers.map((t) => el("option", {
        value: t.id,
        ...(t.id === teacherSelection.teacherId ? { selected: "true" } : {})
      }, t.fullName)),
    ]);

    select.addEventListener("change", async () => {
      teacherSelection.teacherId = select.value;
      if (!teacherSelection.teacherId) {
        renderWelcomeDisclaimers(gridMount, "teacher");
      } else {
        await loadTeacherGrid(gridMount);
      }
    });

    const headerRow = el("div", {
      style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;"
    }, [
      el("div", { style: "display:flex; align-items:center; gap:12px; flex-wrap:wrap;" }, [
        el("div", { class: "field", style: "margin:0;" }, [
          el("label", { style: "display:flex; align-items:center; gap:4px; font-weight:600; margin-bottom:4px;" }, [
            icon("person", "text-xs"),
            "Faculty Member",
          ]),
          select,
        ]),
      ]),
      el("div", { style: "display:flex; gap:8px;" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm hide-on-mobile",
          onClick: () => window.print(),
        }, [icon("print", "text-xs"), "Print Timetable"]),
      ]),
    ]);

    container.append(headerRow);
  } else {
    let own = null;
    try {
      own = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    } catch (err) {
      console.error("Could not resolve own teacher record:", err);
    }
    if (!own) {
      container.append(el("div", { class: "callout callout--warning" }, [
        icon("warning"),
        el("p", {}, "No teacher record is currently linked to your login account. Please contact an administrator."),
      ]));
      return;
    }
    teacherSelection.teacherId = own.id;
    container.append(el("div", {
      style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"
    }, [
      el("div", {}, [
        el("h3", { style: "margin:0 0 2px; color:var(--color-primary-900); font-family:var(--font-display);" }, `Teaching Schedule · ${own.fullName}`),
        el("p", { class: "text-muted text-xs", style: "margin:0;" }, "Showing your personalized weekly instructional lessons and assigned classrooms."),
      ]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm hide-on-mobile",
        onClick: () => window.print(),
      }, [icon("print", "text-xs"), "Print Timetable"]),
    ]));
    await loadTeacherGrid(gridMount);
  }
}

async function loadTeacherGrid(gridMount) {
  if (!teacherSelection.teacherId) {
    renderWelcomeDisclaimers(gridMount, "teacher");
    return;
  }
  gridMount.innerHTML = "";
  gridMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "70%"),
  ]));
  teacherSlots = await getTeacherTimetable(teacherSelection.teacherId);
  renderGrid(gridMount, {
    canManage: false,
    getSlot: (day, periodId) => teacherSlots[`${day}_${periodId}`],
    onCellClick: () => {},
    emptyLabel: "Free",
    pillRenderer: (slot) => [
      el("b", { style: "color:var(--color-primary-900); font-weight:700;" }, slot.subjectName || slot.subjectCode),
      el("span", { style: "color:var(--color-ink-soft); font-size:11px;" }, `${slot.grade} ${slot.stream}`),
      ...(slot.room ? [el("span", { style: "font-family:var(--font-mono, monospace); font-size:10px; background:var(--color-cream-dim, #f8fafc); padding:1px 4px; border-radius:3px; border:1px solid var(--color-line); display:inline-block; margin-top:2px;" }, slot.room)] : []),
    ],
  });
}

// ----------------------------------------------------------- Shared grid UI --

function renderGrid(container, { canManage, getSlot, onCellClick, emptyLabel, pillRenderer }) {
  container.innerHTML = "";
  if (!periods.length) {
    container.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("schedule", "empty-state__icon", "style: font-size:44px; color:var(--color-ink-soft);"),
      el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No periods set up yet"),
      el("p", { class: "text-muted text-sm" }, "Add periods under Period Configuration to initialize the weekly timetable matrix."),
    ]));
    return;
  }

  const tableWrap = el("div", {
    class: "tt-scroll",
    style: "background:var(--color-white); border:1px solid var(--color-line); border-radius:var(--radius-lg); overflow-x:auto; box-shadow:var(--shadow-sm);"
  });
  const table = el("table", { class: "timetable" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:130px;" }, "Period"),
      ...DAYS.map((d) => el("th", {}, d))
    ])),
  ]);
  const tbody = el("tbody", {});

  for (const period of periods) {
    if (period.isBreak) {
      const row = el("tr", { class: "tt-break" });
      row.append(el("td", { class: "tt-period-col" }, [
        el("b", {}, period.name),
        el("span", { style: "font-family:var(--font-mono, monospace); font-size:11px;" }, `${period.startTime}–${period.endTime}`),
      ]));
      row.append(el("td", {
        colspan: String(DAYS.length),
        style: "text-align:center; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;"
      }, [
        icon(period.name.toLowerCase().includes("lunch") ? "restaurant" : "coffee", "text-xs", "style: vertical-align:middle; margin-right:4px;"),
        period.name
      ]));
      tbody.append(row);
      continue;
    }

    const row = el("tr", {});
    row.append(el("td", { class: "tt-period-col" }, [
      el("b", {}, period.name),
      el("span", { style: "font-family:var(--font-mono, monospace); font-size:11px; color:var(--color-ink-soft);" }, `${period.startTime}–${period.endTime}`),
    ]));
    for (const day of DAYS) {
      const slot = getSlot(day, period.id);
      const cellWrap = el("td", { class: "tt-cell" });
      if (slot) {
        const pill = el("button", {
          type: "button",
          class: `tt-pill${canManage ? "" : " tt-pill--readonly"}`
        }, pillRenderer(slot));
        if (canManage) pill.addEventListener("click", () => onCellClick(day, period));
        cellWrap.append(pill);
      } else if (canManage) {
        cellWrap.append(el("button", {
          type: "button",
          class: "tt-cell__empty",
          onClick: () => onCellClick(day, period)
        }, [icon("add", "text-xs"), emptyLabel]));
      } else {
        cellWrap.append(el("span", { class: "tt-free" }, emptyLabel));
      }
      row.append(cellWrap);
    }
    tbody.append(row);
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

export function init() {}