import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { listTeachers, getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import {
  DAYS,
  listPeriods,
  seedDefaultPeriodsIfEmpty,
  addPeriod,
  updatePeriod,
  deletePeriod,
  getClassTimetable,
  getTeacherTimetable,
  getMasterTimetable,
  detectTimetableConflicts,
  generateCollisionFreeTimetable,
  clearAllTimetableSlots,
  clearClassTimetableSlots,
  assignSlot,
  clearSlot,
} from "../js/services/timetable.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton, mobileOnlyNotice, escapeHtml } from "../js/utils.js";
import { copyDeepLink, buildDeepLink } from "../js/services/deep-link.service.js";

const CAN_MANAGE = ["admin", "academic_master"];
const CAN_SEE_ALL_TEACHERS = ["admin", "academic_master", "principal", "deputy_principal"];

let classes = [];
let subjects = [];
let teachers = [];
let periods = [];
let schoolSettings = {};

let classSelection = { grade: "", stream: "" };
let classSlots = {};
let teacherSelection = { teacherId: "" };
let teacherSlots = {};
let masterSlots = [];
let masterConflicts = [];
let masterDayFilter = "All"; // "All" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday"
let activeTab = "master"; // "master" | "classes" | "teachers" | "periods"
let masterViewMode = "wall"; // "wall" (Institutional Master Wall Chart - JKUAT Format) | "cards" (Day Cards)

// ---------------------------------------------------------------- Helpers --

export function getClassTeacher(allTeachers, grade, stream) {
  if (!allTeachers || !allTeachers.length) return null;
  const target = stream ? `${grade}|${stream}` : `${grade}|`;
  let t = allTeachers.find((x) => x.homeroom === target);
  if (!t && stream) {
    t = allTeachers.find((x) => x.homeroom === `${grade}|`);
  }
  return t || null;
}

export function getAssignedClassSubjectTeacher(allTeachers, grade, stream, subjectCode) {
  if (!allTeachers || !allTeachers.length || !subjectCode) return null;
  return (
    allTeachers.find((t) =>
      (t.teachingAssignments || []).some(
        (a) =>
          a.subjectCode === subjectCode &&
          a.grade === grade &&
          (!a.stream || a.stream === stream)
      )
    ) ||
    allTeachers.find((t) =>
      (t.teachingAssignments || []).some(
        (a) => a.subjectCode === subjectCode && a.grade === grade
      )
    ) ||
    null
  );
}

export function getSubjectDepartmentClass(subjectCode) {
  if (!subjectCode) return "";
  const sub = subjects.find((s) => s.code === subjectCode);
  const dept = (sub && sub.department ? sub.department : "").toLowerCase();
  if (dept.includes("science")) return "tt-pill--sciences";
  if (dept.includes("language")) return "tt-pill--languages";
  if (dept.includes("humanit")) return "tt-pill--humanities";
  if (dept.includes("tech") || dept.includes("applied")) return "tt-pill--technical";
  if (dept.includes("creat") || dept.includes("art") || dept.includes("sport")) return "tt-pill--creative";

  const code = subjectCode.toUpperCase();
  if (["MATH", "SCI", "AGR", "BIO", "CHEM", "PHY"].includes(code)) return "tt-pill--sciences";
  if (["ENG", "KIS", "FREN", "GER", "ARAB"].includes(code)) return "tt-pill--languages";
  if (["SST", "CRE", "IRE", "HRE", "GEO", "HIST"].includes(code)) return "tt-pill--humanities";
  if (["PTS", "COMP", "HOME", "AV"].includes(code)) return "tt-pill--technical";
  if (["CRA", "PE", "PHE", "MUS"].includes(code)) return "tt-pill--creative";
  return "";
}

function getAllCohorts() {
  const opts = [];
  for (const c of classes) {
    if (!c.streams || c.streams.length === 0) {
      opts.push({ grade: c.grade, stream: "", label: c.grade });
    } else {
      for (const s of c.streams) {
        opts.push({ grade: c.grade, stream: s, label: `${c.grade} ${s}` });
      }
    }
  }
  return opts;
}

import { buildTimetableMascotSvg } from "../js/components/mascot.js";
export { buildTimetableMascotSvg };

/**
 * 6-Step Visual Workflow Guide
 */
function renderWorkflowGuide() {
  return el("div", { class: "timetable-workflow-guide no-print" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("alt_route", "text-sm", "style: color:var(--color-primary-800);"),
        el("b", { style: "color:var(--color-primary-900); font-size:13px;" }, "Complete Timetable Implementation Workflow"),
      ]),
      el("span", { class: "badge badge--outline", style: "font-size:11px;" }, "CBC Scheduling Protocol"),
    ]),
    el("div", { class: "tt-workflow-steps" }, [
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "1"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Classes & Streams"),
          el("div", { class: "tt-step-desc" }, "Configure Grade 7, 8, 9 cohorts and streams under Academics."),
        ]),
      ]),
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "2"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Teacher Allocations"),
          el("div", { class: "tt-step-desc" }, "Assign teachers to subjects they teach in each class under Faculty."),
        ]),
      ]),
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "3"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Class Teachers"),
          el("div", { class: "tt-step-desc" }, "Designate each homeroom class teacher for signature blocks and tracking."),
        ]),
      ]),
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "4"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Collision-Free Master"),
          el("div", { class: "tt-step-desc" }, "Auto-generate or assemble Master Timetable with zero teacher collisions."),
        ]),
      ]),
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "5"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Print Class Schedules"),
          el("div", { class: "tt-step-desc" }, "Print clean weekly schedules per class or batch-print all classroom sheets."),
        ]),
      ]),
      el("div", { class: "tt-workflow-step" }, [
        el("span", { class: "tt-step-num" }, "6"),
        el("div", {}, [
          el("div", { class: "tt-step-title" }, "Print Teacher Schedules"),
          el("div", { class: "tt-step-desc" }, "Print personalized weekly teaching and free/prep periods for staff room."),
        ]),
      ]),
    ]),
  ]);
}

// ------------------------------------------------------------- Main Render --

export async function render({ profile, params = {} }) {
  const canManage = CAN_MANAGE.includes(profile.role);
  if (canManage) {
    await seedDefaultPeriodsIfEmpty();
  }

  [classes, subjects, teachers, periods, schoolSettings] = await Promise.all([
    listClasses(),
    listSubjects(),
    CAN_SEE_ALL_TEACHERS.includes(profile.role) ? listTeachers() : Promise.resolve([]),
    listPeriods(),
    getSchoolSettings(),
  ]);

  // Set default selection
  if (classes.length && !classSelection.grade) {
    classSelection = { grade: classes[0].grade, stream: classes[0].streams?.[0] || "" };
  }

  // Non-admins default to classes or their own teacher tab
  if (!canManage) {
    activeTab = "classes";
  }

  // Resolve dynamic deep link parameters
  if (params.tab && ["master", "classes", "teachers", "periods"].includes(params.tab)) {
    activeTab = params.tab;
  }
  if (params.day && ["All", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].includes(params.day)) {
    masterDayFilter = params.day;
  }
  if (params.view && ["wall", "cards"].includes(params.view)) {
    masterViewMode = params.view;
  }
  if (params.grade || params.class) {
    classSelection = {
      grade: params.grade || params.class,
      stream: params.stream || "",
    };
  }
  if (params.teacherId) {
    teacherSelection = { teacherId: params.teacherId };
  }

  const wrap = el("div", { class: "timetable-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildTimetableMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "timetable-hero no-print" }, [
    el("div", { class: "timetable-hero__content" }, [
      el("div", { class: "timetable-hero__status-row" }, [
        el("h1", { class: "timetable-hero__title" }, "School Timetable & Master Scheduling"),
        el("p", { class: "timetable-hero__desc" }, "Collision-free master scheduling, class allocations, teacher workloads, and printable official timetables"),
        el("div", { class: "timetable-hero__pills" }, [
          el("div", { class: "timetable-pill" }, [icon("schedule"), `${periods.length} Daily Periods`]),
          el("div", { class: "timetable-pill" }, [icon("school"), `${classes.length} Grade Cohorts`]),
          teachers.length ? el("div", { class: "timetable-pill" }, [icon("person"), `${teachers.length} Faculty Members`]) : null,
        ].filter(Boolean)),
      ]),
    ]),
    el("div", { class: "timetable-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Build a collision-free master schedule, print classroom timetables, and organize faculty workloads."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Workflow Guide banner
  wrap.append(renderWorkflowGuide());

  // Mobile scroll note
  wrap.append(mobileOnlyNotice("The weekly schedule is easier to read and edit on a tablet or laptop - on a phone you'll need to scroll sideways through the days."));

  // Navigation Tabs
  const tabNav = el("div", { class: "timetable-tabs no-print" });
  const tabContentMount = el("div", { id: "timetable-tab-content" });

  const tabsConfig = [
    ...(canManage ? [{ id: "master", label: "Master Timetable", iconName: "table_chart" }] : []),
    { id: "classes", label: "Class Schedules", iconName: "school" },
    { id: "teachers", label: "Teacher Schedules", iconName: "person" },
    ...(canManage ? [{ id: "periods", label: "Period Configuration", iconName: "schedule" }] : []),
  ];

  function renderTabs() {
    tabNav.innerHTML = "";
    tabsConfig.forEach((tab) => {
      const btn = el(
        "button",
        {
          type: "button",
          class: `timetable-tab ${activeTab === tab.id ? "timetable-tab--active" : ""}`,
          onClick: () => {
            activeTab = tab.id;
            renderTabs();
            switchTab(activeTab);
          },
        },
        [icon(tab.iconName, "text-xs"), tab.label]
      );
      tabNav.append(btn);
    });
  }

  async function switchTab(tabId) {
    tabContentMount.innerHTML = "";

    if (tabId === "master") {
      await renderMasterTab(tabContentMount, profile);
    } else if (tabId === "classes") {
      await renderClassTab(tabContentMount, profile);
    } else if (tabId === "teachers") {
      await renderTeacherTab(tabContentMount, profile);
    } else if (tabId === "periods") {
      const periodsCard = el("div", { class: "card" });
      tabContentMount.append(periodsCard);
      renderPeriods(periodsCard, profile);
    }
  }

  renderTabs();
  wrap.append(tabNav);
  wrap.append(tabContentMount);

  // Print Mount Container (rendered only during print)
  const printMount = el("div", { id: "timetable-print-container", class: "timetable-print-sheet" });
  wrap.append(printMount);

  await switchTab(activeTab);

  return wrap;
}

// -------------------------------------------------------- Master Timetable --

async function renderMasterTab(container, profile) {
  container.innerHTML = "";
  const card = el("div", { class: "card", style: "padding:var(--sp-5);" });
  container.append(card);

  // Loading skeleton
  const mount = el("div", { style: "margin-top:16px;" }, [
    skeleton("", "95%"),
    skeleton("", "95%"),
    skeleton("", "95%"),
  ]);
  card.append(mount);

  masterSlots = await getMasterTimetable();
  masterConflicts = detectTimetableConflicts(masterSlots);

  function refreshMaster() {
    mount.innerHTML = "";

    // 1. Conflict Status Banner
    if (masterConflicts.length > 0) {
      const alertBox = el("div", { class: "tt-conflict-alert" }, [
        el("div", { class: "tt-conflict-alert__header" }, [
          icon("error", "text-sm"),
          `Scheduling Collisions Detected (${masterConflicts.length})`,
        ]),
        el("div", { style: "margin-bottom:6px;" }, "The following teachers or rooms are assigned to multiple classes at the exact same time:"),
        el("ul", { class: "tt-conflict-alert__list" }, masterConflicts.map((c) => el("li", {}, c.message))),
      ]);
      mount.append(alertBox);
    } else if (masterSlots.length > 0) {
      const cleanBox = el("div", { style: "margin-bottom:16px; display:flex; align-items:center; gap:8px;" }, [
        el("div", { class: "tt-clean-badge" }, [
          icon("check_circle", "text-xs"),
          "0 Collisions Detected · All class & faculty schedules are conflict-free",
        ]),
      ]);
      mount.append(cleanBox);
    }

    // 2. Controls Toolbar
    const controls = el("div", { class: "master-tt-controls no-print" }, [
      // View Mode Toggle (JKUAT Institutional Wall Chart vs Cards)
      el("div", { class: "tt-view-mode-toggle" }, [
        el("button", {
          type: "button",
          class: `tt-view-mode-btn ${masterViewMode === "wall" ? "tt-view-mode-btn--active" : ""}`,
          title: "Institutional Master Wall Chart (JKUAT Format)",
          onClick: () => { masterViewMode = "wall"; refreshMaster(); }
        }, [icon("view_quilt", "text-xs"), "Master Wall Chart"]),
        el("button", {
          type: "button",
          class: `tt-view-mode-btn ${masterViewMode === "cards" ? "tt-view-mode-btn--active" : ""}`,
          title: "Daily Class Cards View",
          onClick: () => { masterViewMode = "cards"; refreshMaster(); }
        }, [icon("calendar_view_day", "text-xs"), "Daily Cards"]),
      ]),

      // Day filter pills
      el("div", { class: "master-tt-day-tabs" }, [
        el("button", {
          type: "button",
          class: `master-tt-day-btn ${masterDayFilter === "All" ? "master-tt-day-btn--active" : ""}`,
          onClick: () => { masterDayFilter = "All"; refreshMaster(); }
        }, "All Days"),
        ...DAYS.map((d) => el("button", {
          type: "button",
          class: `master-tt-day-btn ${masterDayFilter === d ? "master-tt-day-btn--active" : ""}`,
          onClick: () => { masterDayFilter = d; refreshMaster(); }
        }, d)),
      ]),

      // Actions: Auto-generate, Print, Workload Analytics, Export Excel, Clear
      el("div", { style: "display:flex; gap:8px; flex-wrap:wrap;" }, [
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => openAutoGenerateModal(profile, card, () => renderMasterTab(container, profile)),
        }, [icon("auto_fix_high", "text-xs"), "Auto-Generate Master"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm deep-link-btn",
          title: "Copy direct link to this timetable view",
          onClick: () => {
            const p = { tab: "master" };
            if (masterDayFilter !== "All") p.day = masterDayFilter;
            if (masterViewMode !== "wall") p.view = masterViewMode;
            copyDeepLink("/timetable", p, "Master Timetable link");
          },
        }, [icon("share", "text-xs"), "Share Link"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm hide-on-mobile",
          title: "Print Landscape Institutional Master Wall Chart",
          onClick: () => printMasterSchedule(),
        }, [icon("print", "text-xs"), masterViewMode === "wall" ? "Print Master Wall Chart" : "Print Master Timetable"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: () => openFacultyWorkloadModal(),
        }, [icon("insights", "text-xs"), "Workload Analytics"]),

        masterSlots.length ? el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: (e) => exportMasterToExcel(e),
        }, [icon("download", "text-xs"), "Export Excel (.xlsx)"]) : null,

        masterSlots.length ? el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          style: "color:var(--color-red);",
          onClick: async (e) => {
            if (!confirm("Are you sure you want to clear ALL timetable slots school-wide? This cannot be undone.")) return;
            const restore = busyButton(e.currentTarget, "Clearing…");
            try {
              await clearAllTimetableSlots(profile.uid);
              masterSlots = [];
              masterConflicts = [];
              toast("All timetable slots cleared.", "info");
              refreshMaster();
            } catch (err) {
              toast(err.message || "Could not clear slots.", "error");
            } finally {
              restore();
            }
          },
        }, [icon("delete_sweep", "text-xs"), "Clear All"]) : null,
      ].filter(Boolean)),
    ]);
    mount.append(controls);

    // 3. Grid Table
    const cohorts = getAllCohorts();
    if (!cohorts.length) {
      mount.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("school", "empty-state__icon"),
        el("h4", {}, "No Classes Configured Yet"),
        el("p", { class: "text-muted text-sm" }, "Add classes and streams in Academics before assembling the master timetable."),
      ]));
      return;
    }

    const daysToRender = masterDayFilter === "All" ? DAYS : [masterDayFilter];

    const slotMap = new Map();
    for (const slot of masterSlots) {
      const key = `${slot.grade}_${slot.stream || ""}_${slot.day}_${slot.periodId}`;
      slotMap.set(key, slot);
    }

    const conflictSlotIds = new Set();
    for (const c of masterConflicts) {
      (c.slotIds || []).forEach((id) => conflictSlotIds.add(id));
    }

    if (masterViewMode === "wall") {
      renderInstitutionalWallChart(mount, profile, {
        cohorts,
        daysToRender,
        slotMap,
        conflictSlotIds,
        refreshMaster,
      });
      return;
    }

    for (const day of daysToRender) {
      const daySection = el("div", { style: "margin-bottom:24px;" });
      if (masterDayFilter === "All") {
        daySection.append(el("div", {
          style: "display:flex; align-items:center; gap:8px; margin-bottom:10px; padding-bottom:4px; border-bottom:2px solid var(--color-primary-800);"
        }, [
          icon("calendar_today", "text-sm", "style: color:var(--color-primary-800);"),
          el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900); font-size:16px;" }, day),
        ]));
      }

      const tableWrap = el("div", {
        class: "tt-scroll",
        style: "background:var(--color-white); border:1px solid var(--color-line); border-radius:var(--radius-md); overflow-x:auto;"
      });

      const table = el("table", { class: "timetable" }, [
        el("thead", {}, el("tr", {}, [
          el("th", { style: "width:110px;" }, "Period"),
          ...cohorts.map((c) => {
            const ct = getClassTeacher(teachers, c.grade, c.stream);
            return el("th", { style: "min-width:140px; text-align:center;" }, [
              el("div", { style: "font-weight:700;" }, c.label),
              ct ? el("div", { style: "font-size:10px; font-weight:normal; opacity:0.85; text-transform:none;" }, `CT: ${ct.fullName.split(" ")[0]}`) : null,
            ].filter(Boolean));
          }),
        ])),
      ]);

      const tbody = el("tbody", {});

      for (const period of periods) {
        if (period.isBreak) {
          const row = el("tr", { class: "tt-break" });
          row.append(el("td", { class: "tt-period-col" }, [
            el("b", {}, period.name),
            el("span", { style: "font-family:var(--font-mono, monospace); font-size:10px;" }, `${period.startTime}–${period.endTime}`),
          ]));
          row.append(el("td", {
            colspan: String(cohorts.length),
            style: "text-align:center; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; font-size:11px;"
          }, [
            icon(period.name.toLowerCase().includes("lunch") ? "restaurant" : "coffee", "text-xs", "style: vertical-align:middle; margin-right:4px;"),
            period.name,
          ]));
          tbody.append(row);
          continue;
        }

        const row = el("tr", {});
        row.append(el("td", { class: "tt-period-col" }, [
          el("b", {}, period.name),
          el("span", { style: "font-family:var(--font-mono, monospace); font-size:10px; color:var(--color-ink-soft);" }, `${period.startTime}–${period.endTime}`),
        ]));

        for (const cohort of cohorts) {
          const key = `${cohort.grade}_${cohort.stream}_${day}_${period.id}`;
          const slot = slotMap.get(key);
          const hasConflict = slot && conflictSlotIds.has(slot.id);

          const td = el("td", { class: `tt-cell ${hasConflict ? "tt-conflict-cell" : ""}` });

          if (slot) {
            const deptClass = getSubjectDepartmentClass(slot.subjectCode);
            const pill = el("button", {
              type: "button",
              class: `tt-pill ${deptClass}`.trim(),
              onClick: () => {
                classSelection = { grade: cohort.grade, stream: cohort.stream };
                openAssignModal(profile, day, period, null, async () => {
                  masterSlots = await getMasterTimetable(true);
                  masterConflicts = detectTimetableConflicts(masterSlots);
                  refreshMaster();
                });
              },
            }, [
              el("b", { class: "tt-subject-name" }, slot.subjectName || slot.subjectCode),
              el("span", { class: "tt-teacher-name" }, slot.teacherName || "Unassigned"),
              ...(slot.room ? [el("span", { class: "tt-room-tag" }, slot.room)] : []),
              hasConflict ? el("span", { class: "tt-conflict-tag" }, [icon("warning", "text-xs"), "Collision"]) : null,
            ].filter(Boolean));
            td.append(pill);
          } else {
            td.append(el("button", {
              type: "button",
              class: "tt-cell__empty",
              onClick: () => {
                classSelection = { grade: cohort.grade, stream: cohort.stream };
                openAssignModal(profile, day, period, null, async () => {
                  masterSlots = await getMasterTimetable(true);
                  masterConflicts = detectTimetableConflicts(masterSlots);
                  refreshMaster();
                });
              },
            }, [icon("add", "text-xs"), "+ Assign"]));
          }
          row.append(td);
        }
        tbody.append(row);
      }

      table.append(tbody);
      tableWrap.append(table);
      daySection.append(tableWrap);
      mount.append(daySection);
    }
  }

  refreshMaster();
}

// ------------------------------------ Institutional Master Wall Chart Engine --

function renderInstitutionalWallChart(container, profile, { cohorts, daysToRender, slotMap, conflictSlotIds, refreshMaster }) {
  const canManage = CAN_MANAGE.includes(profile.role);
  const wrap = el("div", { class: "tt-wall-chart-wrap" });

  const table = el("table", { class: "tt-wall-chart" });

  // 1. thead
  const thead = el("thead", {});
  const headRow = el("tr", {});
  headRow.append(
    el("th", { class: "tt-wall-th-day" }, "DAY"),
    el("th", { class: "tt-wall-th-class" }, "CLASS / STREAM")
  );

  for (const p of periods) {
    if (p.isBreak) {
      headRow.append(
        el("th", { class: "tt-wall-th-break" }, [
          el("div", { class: "tt-wall-p-name" }, p.name),
          el("div", { class: "tt-wall-p-time" }, `${p.startTime}–${p.endTime}`),
        ])
      );
    } else {
      headRow.append(
        el("th", { class: "tt-wall-th-period" }, [
          el("div", { class: "tt-wall-p-name" }, p.name),
          el("div", { class: "tt-wall-p-time" }, `${p.startTime}–${p.endTime}`),
        ])
      );
    }
  }
  thead.append(headRow);
  table.append(thead);

  // 2. tbody
  const tbody = el("tbody", {});

  for (const day of daysToRender) {
    for (let cIdx = 0; cIdx < cohorts.length; cIdx++) {
      const cohort = cohorts[cIdx];
      const isFirstCohortOfDay = cIdx === 0;
      const isLastCohortOfDay = cIdx === cohorts.length - 1;

      const row = el("tr", {
        class: `tt-wall-row ${isLastCohortOfDay ? "tt-wall-row--last-in-day" : ""}`,
      });

      // Day Column (rowspan across all cohorts of that day)
      if (isFirstCohortOfDay) {
        const dayCell = el("td", {
          rowspan: String(cohorts.length),
          class: "tt-wall-day-cell",
        }, [
          el("div", { class: "tt-wall-day-label" }, [
            el("span", {}, day.substring(0, 4).toUpperCase()),
          ]),
        ]);
        row.append(dayCell);
      }

      // Class / Stream Column
      const ct = getClassTeacher(teachers, cohort.grade, cohort.stream);
      const classCell = el("td", { class: "tt-wall-class-cell" }, [
        el("span", { class: "tt-wall-class-name" }, cohort.label),
        ct ? el("span", { class: "tt-wall-class-ct" }, `C.A: ${ct.fullName ? ct.fullName.split(" ")[0] : ct.name || "Teacher"}`) : null,
      ].filter(Boolean));
      row.append(classCell);

      // Period Columns (handle breaks and double lesson merging)
      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        const period = periods[pIdx];

        if (period.isBreak) {
          if (isFirstCohortOfDay) {
            const breakCell = el("td", {
              rowspan: String(cohorts.length),
              class: "tt-wall-break-cell",
            }, [
              el("div", { class: "tt-wall-break-text" }, [
                icon("coffee", "text-xs"),
                `${period.name} (${period.startTime}–${period.endTime})`,
              ]),
            ]);
            row.append(breakCell);
          }
          // Subsequent cohorts are covered by rowspan
          continue;
        }

        // Instructional Period
        const slotKey = `${cohort.grade}_${cohort.stream || ""}_${day}_${period.id}`;
        const slot = slotMap.get(slotKey);

        // Check for consecutive double lesson with identical subject & teacher
        let isMergedDouble = false;
        if (slot && pIdx + 1 < periods.length) {
          const nextPeriod = periods[pIdx + 1];
          if (!nextPeriod.isBreak) {
            const nextKey = `${cohort.grade}_${cohort.stream || ""}_${day}_${nextPeriod.id}`;
            const nextSlot = slotMap.get(nextKey);
            if (nextSlot && nextSlot.subjectCode === slot.subjectCode && nextSlot.teacherId === slot.teacherId) {
              isMergedDouble = true;
            }
          }
        }

        if (isMergedDouble) {
          const hasConflict = conflictSlotIds.has(slot.id);
          const td = el("td", {
            colspan: "2",
            class: `tt-wall-slot-cell tt-wall-slot-cell--merged ${hasConflict ? "tt-wall-slot-cell--conflict" : ""}`,
          });

          const teacherName = slot.teacherName ? slot.teacherName.split(" ")[0] : "—";
          const slotBtn = el("button", {
            type: "button",
            class: "tt-wall-slot-btn",
            title: `${slot.subjectName || slot.subjectCode} (Double Lesson) · ${slot.teacherName || "Unassigned"} · ${slot.room || "Room"}`,
            onClick: () => {
              if (canManage) {
                classSelection = { grade: cohort.grade, stream: cohort.stream };
                openAssignModal(profile, day, period, slot, async () => {
                  masterSlots = await getMasterTimetable(true);
                  masterConflicts = detectTimetableConflicts(masterSlots);
                  refreshMaster();
                });
              }
            },
          }, [
            el("div", { class: "tt-wall-subj-line" }, [
              el("span", { class: "tt-wall-subj" }, slot.subjectCode),
              el("span", { class: "tt-wall-tag-double" }, "Double"),
              hasConflict ? el("span", { class: "tt-wall-tag-conflict" }, [icon("warning", "text-xs"), "Collision"]) : null,
            ].filter(Boolean)),
            el("div", { class: "tt-wall-teacher" }, teacherName),
            el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
          ]);

          td.append(slotBtn);
          row.append(td);

          pIdx++; // Skip next period
          continue;
        }

        // Single Lesson or Empty
        const hasConflict = slot && conflictSlotIds.has(slot.id);
        const td = el("td", {
          class: `tt-wall-slot-cell ${hasConflict ? "tt-wall-slot-cell--conflict" : ""}`,
        });

        if (slot) {
          const teacherName = slot.teacherName ? slot.teacherName.split(" ")[0] : "—";
          const slotBtn = el("button", {
            type: "button",
            class: "tt-wall-slot-btn",
            title: `${slot.subjectName || slot.subjectCode} · ${slot.teacherName || "Unassigned"} · ${slot.room || "Room"}`,
            onClick: () => {
              if (canManage) {
                classSelection = { grade: cohort.grade, stream: cohort.stream };
                openAssignModal(profile, day, period, slot, async () => {
                  masterSlots = await getMasterTimetable(true);
                  masterConflicts = detectTimetableConflicts(masterSlots);
                  refreshMaster();
                });
              }
            },
          }, [
            el("div", { class: "tt-wall-subj-line" }, [
              el("span", { class: "tt-wall-subj" }, slot.subjectCode),
              hasConflict ? el("span", { class: "tt-wall-tag-conflict" }, [icon("warning", "text-xs"), "Collision"]) : null,
            ].filter(Boolean)),
            el("div", { class: "tt-wall-teacher" }, teacherName),
            el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
          ]);
          td.append(slotBtn);
        } else if (canManage) {
          const emptyBtn = el("button", {
            type: "button",
            class: "tt-wall-empty-btn",
            title: `Assign ${cohort.label} ${day} ${period.name}`,
            onClick: () => {
              classSelection = { grade: cohort.grade, stream: cohort.stream };
              openAssignModal(profile, day, period, null, async () => {
                masterSlots = await getMasterTimetable(true);
                masterConflicts = detectTimetableConflicts(masterSlots);
                refreshMaster();
              });
            },
          }, [icon("add", "text-xs")]);
          td.append(emptyBtn);
        } else {
          td.append(el("span", { class: "text-muted text-xs", style: "display:block; text-align:center; padding:12px 0;" }, "—"));
        }

        row.append(td);
      }

      tbody.append(row);
    }
  }

  table.append(tbody);
  wrap.append(table);
  container.append(wrap);

  // 3. Institutional Footer (Class Teachers & Verification Sign-off)
  renderInstitutionalFooter(container, cohorts);
}

function renderInstitutionalFooter(container, cohorts) {
  const footerWrap = el("div", { class: "tt-wall-footer no-print" });

  const grid = el("div", { class: "tt-wall-footer__grid" });

  // Left: Class Homeroom Advisors (C.A.) Table
  const leftCol = el("div", {}, [
    el("div", { class: "tt-wall-section-heading" }, [
      icon("badge", "text-xs"),
      "Class Teachers & Homeroom Advisors (C.A.) Directory",
    ]),
    el("table", { class: "tt-wall-advisors-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Cohort / Class"),
        el("th", {}, "Homeroom Advisor"),
        el("th", {}, "TSC No. / Phone"),
      ])),
      el("tbody", {}, cohorts.map((c) => {
        const ct = getClassTeacher(teachers, c.grade, c.stream);
        return el("tr", {}, [
          el("td", {}, el("strong", {}, c.label)),
          el("td", {}, ct ? ct.fullName : el("span", { class: "text-muted" }, "Unassigned")),
          el("td", {}, ct ? `${ct.tscNumber ? "TSC: " + ct.tscNumber : (ct.phone || "—")}` : "—"),
        ]);
      })),
    ]),
  ]);

  // Right: Executive Sign-off & Quality Assurance Blocks
  const schoolName = schoolSettings.schoolName || "BM JUNIOR AND SENIOR SCHOOL";
  const currentYear = schoolSettings.academicYear || new Date().getFullYear();
  const currentTerm = schoolSettings.term || "Term 1";

  const rightCol = el("div", {}, [
    el("div", { class: "tt-wall-section-heading" }, [
      icon("verified_user", "text-xs"),
      "Executive Sign-off & Academic Quality Compliance",
    ]),
    el("div", { class: "tt-wall-signoff-card" }, [
      el("div", { style: "display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px;" }, [
        el("div", {}, [
          el("div", { style: "font-weight:700; font-size:11px; text-transform:uppercase; color:var(--color-primary-900);" }, "Prepared By:"),
          el("div", { style: "font-size:12px; margin-top:2px;" }, "Academic Master / Timetable Coordinator"),
          el("div", { style: "margin-top:24px; border-bottom:1px solid #94a3b8; width:80%;" }),
          el("div", { style: "font-size:10px; color:var(--color-ink-soft); margin-top:3px;" }, "Signature & Date"),
        ]),
        el("div", {}, [
          el("div", { style: "font-weight:700; font-size:11px; text-transform:uppercase; color:var(--color-primary-900);" }, "Approved By:"),
          el("div", { style: "font-size:12px; margin-top:2px;" }, "Principal / Headteacher"),
          el("div", { style: "margin-top:24px; border-bottom:1px solid #94a3b8; width:80%;" }),
          el("div", { style: "font-size:10px; color:var(--color-ink-soft); margin-top:3px;" }, "Official Stamp & Date"),
        ]),
      ]),
      el("div", { style: "font-size:10.5px; color:var(--color-ink-soft); border-top:1px dashed var(--color-line); padding-top:8px;" }, [
        el("strong", {}, `${schoolName} · ${currentYear} ${currentTerm} Master Schedule. `),
        "Compiled in accordance with Kenya MOE guidelines and TSC workload distribution standards.",
      ]),
    ]),
  ]);

  grid.append(leftCol, rightCol);
  footerWrap.append(grid);
  container.append(footerWrap);
}

// --------------------------------------------------------- Class Schedules --

async function renderClassTab(container, profile) {
  container.innerHTML = "";

  const classCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  const classGridMount = el("div", { style: "margin-top:16px;" });
  container.append(classCard, classGridMount);

  renderClassPicker(classCard, profile, classGridMount);

  if (classSelection.grade) {
    await loadClassGrid(profile, classGridMount);
  } else {
    renderWelcomeDisclaimers(classGridMount, "class");
  }
}

function renderClassPicker(container, profile, gridMount) {
  container.innerHTML = "";
  const opts = getAllCohorts();

  const select = el("select", { style: "min-width:220px;" }, [
    el("option", { value: "" }, "Select class cohort"),
    ...opts.map((o) => el("option", {
      value: `${o.grade}|${o.stream}`,
      ...(`${o.grade}|${o.stream}` === `${classSelection.grade}|${classSelection.stream}` ? { selected: "true" } : {})
    }, o.label)),
  ]);

  const classTeacherMount = el("div", {});

  function updateClassTeacherBanner() {
    classTeacherMount.innerHTML = "";
    if (!classSelection.grade) return;
    const ct = getClassTeacher(teachers, classSelection.grade, classSelection.stream);
    if (ct) {
      classTeacherMount.append(el("div", { class: "class-teacher-banner" }, [
        icon("badge", "text-xs"),
        el("span", {}, [
          el("strong", {}, "Class Teacher: "),
          `${ct.fullName}${ct.tscNumber ? ` (TSC No: ${ct.tscNumber})` : ""}${ct.phone ? ` · Phone: ${ct.phone}` : ""}`,
        ]),
      ]));
    } else {
      classTeacherMount.append(el("div", { class: "class-teacher-banner class-teacher-banner--empty" }, [
        icon("warning", "text-xs"),
        el("span", {}, [
          el("strong", {}, "Class Teacher: "),
          "Not assigned yet · ",
          el("a", { href: "#/teachers", style: "color:inherit; font-weight:700; text-decoration:underline;" }, "Assign in Faculty"),
        ]),
      ]));
    }
  }

  select.addEventListener("change", async () => {
    const [grade, stream] = select.value.split("|");
    classSelection = { grade: grade || "", stream: stream || "" };
    updateClassTeacherBanner();
    if (!classSelection.grade) {
      renderWelcomeDisclaimers(gridMount, "class");
    } else {
      await loadClassGrid(profile, gridMount);
    }
  });

  const canManage = CAN_MANAGE.includes(profile.role);

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
    el("div", { style: "display:flex; gap:8px; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm deep-link-btn",
        title: "Copy direct link to this class timetable",
        onClick: () => {
          const p = { tab: "classes" };
          if (classSelection.grade) p.grade = classSelection.grade;
          if (classSelection.stream) p.stream = classSelection.stream;
          copyDeepLink("/timetable", p, `${classSelection.grade} ${classSelection.stream || ""} timetable link`);
        },
      }, [icon("share", "text-xs"), "Share Link"]),

      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm hide-on-mobile",
        onClick: () => printSingleClassSchedule(classSelection.grade, classSelection.stream),
      }, [icon("print", "text-xs"), "Print This Class"]),

      canManage ? el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm hide-on-mobile",
        onClick: () => printAllClassesBatch(),
      }, [icon("print_connect", "text-xs"), "Print All Classes (Batch)"]) : null,

      canManage && classSelection.grade ? el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        style: "color:var(--color-red);",
        onClick: async (e) => {
          if (!confirm(`Clear all lessons for ${classSelection.grade} ${classSelection.stream}?`)) return;
          const restore = busyButton(e.currentTarget, "Clearing…");
          try {
            await clearClassTimetableSlots(profile.uid, classSelection.grade, classSelection.stream);
            toast("Class timetable cleared.", "info");
            await loadClassGrid(profile, gridMount);
          } catch (err) {
            toast(err.message || "Could not clear.", "error");
          } finally {
            restore();
          }
        },
      }, [icon("delete", "text-xs"), "Clear Class"]) : null,
    ].filter(Boolean)),
  ]);

  updateClassTeacherBanner();
  container.append(headerRow, classTeacherMount);
}

async function loadClassGrid(profile, gridMount) {
  if (!classSelection.grade) {
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
      el("b", { class: "tt-subject-name" }, slot.subjectName || slot.subjectCode),
      el("span", { class: "tt-teacher-name" }, slot.teacherName || "Unassigned"),
      ...(slot.room ? [el("span", { class: "tt-room-tag" }, slot.room)] : []),
    ],
  });
}

// ------------------------------------------------------- Teacher Schedules --

async function renderTeacherTab(container, profile) {
  container.innerHTML = "";
  const teacherCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  const teacherGridMount = el("div", { style: "margin-top:16px;" });
  container.append(teacherCard, teacherGridMount);
  await renderTeacherPicker(teacherCard, profile, teacherGridMount);
  if (!teacherSelection.teacherId) {
    renderWelcomeDisclaimers(teacherGridMount, "teacher");
  }
}

async function renderTeacherPicker(container, profile, gridMount) {
  container.innerHTML = "";

  const canPickAny = CAN_SEE_ALL_TEACHERS.includes(profile.role);
  if (canPickAny) {
    const select = el("select", { style: "min-width:220px;" }, [
      el("option", { value: "" }, "Select faculty member"),
      ...teachers.map((t) => el("option", {
        value: t.id,
        ...(t.id === teacherSelection.teacherId ? { selected: "true" } : {})
      }, `${t.fullName}${t.tscNumber ? ` (${t.tscNumber})` : ""}`)),
    ]);

    const teacherMetaMount = el("div", {});

    function updateTeacherMeta() {
      teacherMetaMount.innerHTML = "";
      if (!teacherSelection.teacherId) return;
      const t = teachers.find((x) => x.id === teacherSelection.teacherId);
      if (!t) return;
      const homeroom = t.homeroom ? t.homeroom.replace("|", " ").trim() : "None";
      teacherMetaMount.append(el("div", { class: "class-teacher-banner class-teacher-banner--info" }, [
        icon("person", "text-xs"),
        el("span", {}, [
          el("strong", {}, `${t.fullName}: `),
          `TSC: ${t.tscNumber || "N/A"} · Homeroom / Class Teacher: ${homeroom} · Phone: ${t.phone || "N/A"}`,
        ]),
      ]));
    }

    select.addEventListener("change", async () => {
      teacherSelection.teacherId = select.value;
      updateTeacherMeta();
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
      el("div", { style: "display:flex; gap:8px; flex-wrap:wrap;" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm deep-link-btn",
          title: "Copy direct link to this teacher's schedule",
          onClick: () => {
            const p = { tab: "teachers" };
            if (teacherSelection.teacherId) p.teacherId = teacherSelection.teacherId;
            copyDeepLink("/timetable", p, "Faculty timetable link");
          },
        }, [icon("share", "text-xs"), "Share Link"]),

        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm hide-on-mobile",
          onClick: () => printSingleTeacherSchedule(teacherSelection.teacherId),
        }, [icon("print", "text-xs"), "Print This Teacher"]),

        CAN_MANAGE.includes(profile.role) ? el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm hide-on-mobile",
          onClick: () => printAllTeachersBatch(),
        }, [icon("print_connect", "text-xs"), "Print All Teachers (Batch)"]) : null,
      ].filter(Boolean)),
    ]);

    updateTeacherMeta();
    container.append(headerRow, teacherMetaMount);
  } else {
    let own = null;
    try {
      own = await getTeacherByUserId(profile.uid);
    } catch {}
    if (!own && profile.email) {
      try {
        own = await getTeacherByEmail(profile.email);
      } catch {}
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
        class: "btn btn--primary btn--sm hide-on-mobile",
        onClick: () => printSingleTeacherSchedule(own.id),
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
    emptyLabel: "Free / Prep",
    pillRenderer: (slot) => [
      el("b", { class: "tt-subject-name" }, slot.subjectName || slot.subjectCode),
      el("span", { class: "tt-teacher-name" }, `${slot.grade} ${slot.stream}`),
      ...(slot.room ? [el("span", { class: "tt-room-tag" }, slot.room)] : []),
    ],
  });
}

// ----------------------------------------------------------- Slot Assignment --

async function openAssignModal(profile, day, period, gridMount, onSaved = null) {
  if (!CAN_MANAGE.includes(profile.role)) return;
  if (CAN_SEE_ALL_TEACHERS.includes(profile.role)) {
    try {
      teachers = await listTeachers();
    } catch {}
  }
  const existing = classSlots[`${day}_${period.id}`] || (masterSlots ? masterSlots.find(s => s.grade === classSelection.grade && (s.stream || "") === (classSelection.stream || "") && s.day === day && s.periodId === period.id) : null);
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

    // Check specific class-subject assigned teacher first
    const classAssigned = getAssignedClassSubjectTeacher(teachers, classSelection.grade, classSelection.stream, code);
    const qualified = teachers.filter((t) => code && (t.teachingAssignments || []).some(a => a.subjectCode === code));
    const others = teachers.filter((t) => !code || !(t.teachingAssignments || []).some(a => a.subjectCode === code));

    if (classAssigned) {
      const groupClass = el("optgroup", { label: `★ Assigned for ${classSelection.grade} ${classSelection.stream}` });
      groupClass.append(el("option", { value: classAssigned.id, selected: "true" }, `★ ${classAssigned.fullName} (Class Subject Teacher)`));
      teacherSelect.append(groupClass);
    }

    if (code && qualified.length > 0) {
      const groupQ = el("optgroup", { label: "Other Qualified Subject Teachers" });
      for (const t of qualified) {
        if (classAssigned && t.id === classAssigned.id) continue;
        groupQ.append(el("option", { value: t.id, ...(t.id === currentVal ? { selected: "true" } : {}) }, t.fullName));
      }
      teacherSelect.append(groupQ);
    }

    if (others.length > 0) {
      const groupO = el("optgroup", { label: "Other Faculty" });
      for (const t of others) {
        if (classAssigned && t.id === classAssigned.id) continue;
        groupO.append(el("option", { value: t.id, ...(t.id === currentVal ? { selected: "true" } : {}) }, t.fullName));
      }
      teacherSelect.append(groupO);
    }

    if (currentVal && !classAssigned) {
      teacherSelect.value = currentVal;
    }
  }

  refreshTeachers();
  subjectSelect.addEventListener("change", refreshTeachers);

  body.append(
    el("div", { class: "callout callout--info", style: "margin-bottom:12px; padding:8px 12px; font-size:12px;" }, [
      icon("schedule", "text-xs"),
      `${classSelection.grade}${classSelection.stream ? " " + classSelection.stream : ""} · ${day} · ${period.name} (${period.startTime}–${period.endTime})`,
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
          if (gridMount) await loadClassGrid(profile, gridMount);
          if (onSaved) await onSaved();
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
      if (gridMount) await loadClassGrid(profile, gridMount);
      if (onSaved) await onSaved();
    } catch (err) {
      toast(err.message || "Could not save slot - check for a conflict.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------- Auto-Generate Modal --

function openAutoGenerateModal(profile, container, onComplete) {
  const cohorts = getAllCohorts();
  const instructionalPeriods = periods.filter((p) => !p.isBreak);

  const body = el("form", {});
  body.append(
    el("div", { class: "callout callout--info", style: "margin-bottom:14px; font-size:12px;" }, [
      icon("auto_awesome"),
      el("p", {}, "The automated scheduler calculates an optimized weekly timetable using your configured classes, instructional periods, and teacher subject assignments guaranteeing ZERO teacher double-bookings."),
    ]),
    el("div", { class: "table-wrap", style: "margin-bottom:14px; border:1px solid var(--color-line); border-radius:var(--radius-md); padding:10px;" }, [
      el("div", { style: "display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px;" }, [
        el("div", {}, [el("b", {}, "Classes: "), `${cohorts.length} cohorts`]),
        el("div", {}, [el("b", {}, "Daily Periods: "), `${instructionalPeriods.length} instructional`]),
        el("div", {}, [el("b", {}, "Subjects: "), `${subjects.length} active`]),
        el("div", {}, [el("b", {}, "Faculty: "), `${teachers.length} members`]),
      ]),
    ]),
    el("p", { class: "text-muted text-xs", style: "margin-bottom:16px;" }, "Existing slots will be overwritten with the fresh collision-free timetable. You can manually adjust any slot afterwards."),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("play_arrow"), "Generate Collision-Free Master Timetable"])
  );

  const close = openModal("Automated Master Timetable Generator", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Generating…");
    try {
      const res = await generateCollisionFreeTimetable(profile.uid, {
        classes,
        subjects,
        teachers,
        periods,
        days: DAYS,
      });
      toast(`Fresh master timetable generated (${res.totalSlots} slots) with 0 collisions!`, "success");
      close();
      if (onComplete) await onComplete();
    } catch (err) {
      toast(err.message || "Could not generate timetable.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------------- Print Engine --

function printTimetableDocument(htmlContent) {
  const mount = document.getElementById("timetable-print-container");
  if (!mount) return;
  mount.innerHTML = htmlContent;
  window.print();
}

function buildOfficialHeader(docTitle, metaSubtitle) {
  const name = escapeHtml(schoolSettings.schoolName || "Eeskia Academy");
  const motto = escapeHtml(schoolSettings.motto || "Excellence in Competency-Based Education");
  const address = escapeHtml(schoolSettings.address || "");
  const phone = escapeHtml(schoolSettings.phone || "");
  const email = escapeHtml(schoolSettings.email || "");
  const rawLogo = schoolSettings.logoUrl || "";
  const logo = /^https?:\/\//i.test(rawLogo) ? escapeHtml(rawLogo) : "";
  const year = escapeHtml(String(schoolSettings.currentAcademicYear || new Date().getFullYear()));
  const term = escapeHtml(schoolSettings.currentTerm || "Term 1");
  const safeTitle = escapeHtml(docTitle || "");
  const safeSubtitle = escapeHtml(metaSubtitle || "");

  return `
    <div class="timetable-print-header">
      ${logo ? `<img class="timetable-print-logo" src="${logo}" alt="School Logo" />` : ""}
      <h1 class="timetable-print-school">${name}</h1>
      <div class="timetable-print-motto">"${motto}"</div>
      <div class="timetable-print-contacts">
        ${address ? `${address} · ` : ""}${phone ? `Tel: ${phone} · ` : ""}${email ? `Email: ${email}` : ""}
      </div>
      <div class="timetable-print-title-box">
        <div class="timetable-print-title">${safeTitle}</div>
        <div class="timetable-print-meta">${term} · Academic Year ${year} · ${safeSubtitle}</div>
      </div>
    </div>
  `;
}

function buildClassTimetablePage(grade, stream, slotsMap) {
  const ct = getClassTeacher(teachers, grade, stream);
  const classLabel = `${grade}${stream ? " " + stream : ""}`;
  const ctText = ct ? `Class Teacher: ${ct.fullName}${ct.tscNumber ? ` (TSC No: ${ct.tscNumber})` : ""}` : "Class Teacher: Unassigned";

  // Build subject summary legend
  const classSlotsList = [];
  for (const day of DAYS) {
    for (const p of periods) {
      const slot = slotsMap[`${grade}_${stream}_${day}_${p.id}`];
      if (slot) classSlotsList.push(slot);
    }
  }

  const subjectCounts = new Map();
  for (const s of classSlotsList) {
    if (!subjectCounts.has(s.subjectCode)) {
      subjectCounts.set(s.subjectCode, { code: s.subjectCode, name: s.subjectName, teacher: s.teacherName, count: 0 });
    }
    subjectCounts.get(s.subjectCode).count++;
  }

  let tableHtml = `
    <table class="timetable-print-table">
      <thead>
        <tr>
          <th style="width:80px;">Period</th>
          ${DAYS.map((d) => `<th>${d}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
  `;

  for (const p of periods) {
    if (p.isBreak) {
      tableHtml += `
        <tr class="print-break-row">
          <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
          <td colspan="${DAYS.length}">${p.name}</td>
        </tr>
      `;
      continue;
    }
    tableHtml += `
      <tr>
        <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
        ${DAYS.map((day) => {
          const slot = slotsMap[`${grade}_${stream}_${day}_${p.id}`];
          if (slot) {
            return `
              <td>
                <div class="timetable-print-cell-subj">${slot.subjectName || slot.subjectCode}</div>
                <div class="timetable-print-cell-teacher">${slot.teacherName || "—"}</div>
                ${slot.room ? `<div class="timetable-print-cell-room">${slot.room}</div>` : ""}
              </td>
            `;
          }
          return `<td><span style="color:#94a3b8; font-size:7pt;">—</span></td>`;
        }).join("")}
      </tr>
    `;
  }

  tableHtml += `</tbody></table>`;

  const legendHtml = `
    <div class="timetable-print-legend">
      <div class="timetable-print-legend-title">Subject & Teacher Allocations</div>
      <div class="timetable-print-legend-grid">
        ${Array.from(subjectCounts.values()).map((s) => `
          <div><b>${s.code}</b>: ${s.name} (${s.count} lsns) · <i>${s.teacher || "Unassigned"}</i></div>
        `).join("")}
      </div>
    </div>
  `;

  const signaturesHtml = `
    <div class="timetable-print-signatures">
      <div class="timetable-print-sig-col">
        <div class="timetable-print-sig-title">Class Teacher Signature:</div>
        <div style="margin-top:20px; font-size:8pt; color:#64748b;">${ct ? ct.fullName : "Class Teacher"} · Date: _______________</div>
      </div>
      <div class="timetable-print-sig-col">
        <div class="timetable-print-sig-title">Principal / Academic Master:</div>
        <div style="margin-top:20px; font-size:8pt; color:#64748b;">Official Stamp & Signature · Date: _______________</div>
      </div>
    </div>
  `;

  return `
    <div class="timetable-print-page">
      <div>
        ${buildOfficialHeader(`Official Class Timetable · ${classLabel}`, ctText)}
        ${tableHtml}
        ${legendHtml}
      </div>
      ${signaturesHtml}
    </div>
  `;
}

function buildTeacherTimetablePage(teacher, slotsMap) {
  const homeroom = teacher.homeroom ? teacher.homeroom.replace("|", " ").trim() : "None";
  const teacherSlotsList = [];
  for (const day of DAYS) {
    for (const p of periods) {
      if (p.isBreak) continue;
      for (const c of getAllCohorts()) {
        const slot = slotsMap[`${c.grade}_${c.stream}_${day}_${p.id}`];
        if (slot && slot.teacherId === teacher.id) {
          teacherSlotsList.push(slot);
        }
      }
    }
  }

  const instructionalPeriodsCount = periods.filter((p) => !p.isBreak).length * DAYS.length;
  const teachingLessons = teacherSlotsList.length;
  const freePeriods = instructionalPeriodsCount - teachingLessons;

  const subTitle = `TSC No: ${teacher.tscNumber || "N/A"} · Homeroom: ${homeroom} · Teaching Load: ${teachingLessons} Lessons/Wk (Free: ${freePeriods} Periods)`;

  let tableHtml = `
    <table class="timetable-print-table">
      <thead>
        <tr>
          <th style="width:80px;">Period</th>
          ${DAYS.map((d) => `<th>${d}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
  `;

  for (const p of periods) {
    if (p.isBreak) {
      tableHtml += `
        <tr class="print-break-row">
          <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
          <td colspan="${DAYS.length}">${p.name}</td>
        </tr>
      `;
      continue;
    }
    tableHtml += `
      <tr>
        <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
        ${DAYS.map((day) => {
          let found = null;
          for (const c of getAllCohorts()) {
            const slot = slotsMap[`${c.grade}_${c.stream}_${day}_${p.id}`];
            if (slot && slot.teacherId === teacher.id) {
              found = slot;
              break;
            }
          }
          if (found) {
            return `
              <td style="background:#f0fdf4;">
                <div class="timetable-print-cell-subj">${found.grade} ${found.stream}</div>
                <div class="timetable-print-cell-teacher">${found.subjectName || found.subjectCode}</div>
                ${found.room ? `<div class="timetable-print-cell-room">${found.room}</div>` : ""}
              </td>
            `;
          }
          return `<td><span style="color:#94a3b8; font-size:7.5pt; font-style:italic;">FREE / PREP</span></td>`;
        }).join("")}
      </tr>
    `;
  }

  tableHtml += `</tbody></table>`;

  const signaturesHtml = `
    <div class="timetable-print-signatures">
      <div class="timetable-print-sig-col">
        <div class="timetable-print-sig-title">Teacher Signature:</div>
        <div style="margin-top:20px; font-size:8pt; color:#64748b;">${teacher.fullName} · Date: _______________</div>
      </div>
      <div class="timetable-print-sig-col">
        <div class="timetable-print-sig-title">Dean of Studies / Academic Master:</div>
        <div style="margin-top:20px; font-size:8pt; color:#64748b;">Official Approval & Stamp · Date: _______________</div>
      </div>
    </div>
  `;

  return `
    <div class="timetable-print-page">
      <div>
        ${buildOfficialHeader(`Teacher's Instructional Schedule · ${teacher.fullName}`, subTitle)}
        ${tableHtml}
      </div>
      ${signaturesHtml}
    </div>
  `;
}

async function printSingleClassSchedule(grade, stream) {
  if (!grade) return toast("Select a class first.", "error");
  const slots = await getMasterTimetable();
  const slotsMap = {};
  for (const s of slots) {
    slotsMap[`${s.grade}_${s.stream || ""}_${s.day}_${s.periodId}`] = s;
  }
  const pageHtml = buildClassTimetablePage(grade, stream, slotsMap);
  printTimetableDocument(pageHtml);
}

async function printAllClassesBatch() {
  const cohorts = getAllCohorts();
  if (!cohorts.length) return toast("No classes to print.", "error");
  const slots = await getMasterTimetable();
  const slotsMap = {};
  for (const s of slots) {
    slotsMap[`${s.grade}_${s.stream || ""}_${s.day}_${s.periodId}`] = s;
  }
  const fullHtml = cohorts.map((c) => buildClassTimetablePage(c.grade, c.stream, slotsMap)).join("");
  printTimetableDocument(fullHtml);
}

async function printSingleTeacherSchedule(teacherId) {
  if (!teacherId) return toast("Select a faculty member first.", "error");
  const teacher = teachers.find((t) => t.id === teacherId);
  if (!teacher) return toast("Teacher record not found.", "error");
  const slots = await getMasterTimetable();
  const slotsMap = {};
  for (const s of slots) {
    slotsMap[`${s.grade}_${s.stream || ""}_${s.day}_${s.periodId}`] = s;
  }
  const pageHtml = buildTeacherTimetablePage(teacher, slotsMap);
  printTimetableDocument(pageHtml);
}

async function printAllTeachersBatch() {
  if (!teachers.length) return toast("No teachers found.", "error");
  const slots = await getMasterTimetable();
  const slotsMap = {};
  for (const s of slots) {
    slotsMap[`${s.grade}_${s.stream || ""}_${s.day}_${s.periodId}`] = s;
  }
  const fullHtml = teachers.map((t) => buildTeacherTimetablePage(t, slotsMap)).join("");
  printTimetableDocument(fullHtml);
}

async function printMasterSchedule() {
  const cohorts = getAllCohorts();
  const slots = await getMasterTimetable();
  const slotsMap = {};
  for (const s of slots) {
    slotsMap[`${s.grade}_${s.stream || ""}_${s.day}_${s.periodId}`] = s;
  }

  const daysToPrint = masterDayFilter === "All" ? DAYS : [masterDayFilter];

  if (masterViewMode === "wall") {
    // Generate Landscape Institutional Master Wall Chart (JKUAT Format)
    let theadHtml = `
      <thead>
        <tr>
          <th style="width:45px;">DAY</th>
          <th style="width:105px;">CLASS</th>
          ${periods.map((p) => {
            if (p.isBreak) {
              return `<th class="print-wall-th-break" style="width:34px;">${escapeHtml(p.name)}<br/><span style="font-size:5.5pt; font-family:monospace;">${p.startTime}–${p.endTime}</span></th>`;
            }
            return `<th>${escapeHtml(p.name)}<br/><span style="font-size:5.5pt; font-family:monospace;">${p.startTime}–${p.endTime}</span></th>`;
          }).join("")}
        </tr>
      </thead>
    `;

    let tbodyHtml = "<tbody>";
    for (const day of daysToPrint) {
      for (let cIdx = 0; cIdx < cohorts.length; cIdx++) {
        const c = cohorts[cIdx];
        const isFirst = cIdx === 0;
        const isLast = cIdx === cohorts.length - 1;
        const ct = getClassTeacher(teachers, c.grade, c.stream);

        tbodyHtml += `<tr style="${isLast ? 'border-bottom: 2pt solid #0f172a;' : ''}">`;

        if (isFirst) {
          tbodyHtml += `
            <td rowspan="${cohorts.length}" class="print-wall-day-cell">
              <div style="font-weight:900; letter-spacing:0.06em;">${day.substring(0, 4).toUpperCase()}</div>
            </td>
          `;
        }

        tbodyHtml += `
          <td class="print-wall-class-cell">
            <div><b>${escapeHtml(c.label)}</b></div>
            ${ct ? `<div style="font-size:5.8pt; color:#475569;">C.A: ${escapeHtml(ct.fullName ? ct.fullName.split(" ")[0] : ct.name || "")}</div>` : ""}
          </td>
        `;

        for (let pIdx = 0; pIdx < periods.length; pIdx++) {
          const p = periods[pIdx];

          if (p.isBreak) {
            if (isFirst) {
              tbodyHtml += `
                <td rowspan="${cohorts.length}" class="print-wall-break-cell">
                  <div class="print-vertical-label">${escapeHtml(p.name)} (${p.startTime}–${p.endTime})</div>
                </td>
              `;
            }
            continue;
          }

          const slot = slotsMap[`${c.grade}_${c.stream}_${day}_${p.id}`];

          // Check for consecutive double lesson
          let isMerged = false;
          if (slot && pIdx + 1 < periods.length) {
            const nextP = periods[pIdx + 1];
            if (!nextP.isBreak) {
              const nextSlot = slotsMap[`${c.grade}_${c.stream}_${day}_${nextP.id}`];
              if (nextSlot && nextSlot.subjectCode === slot.subjectCode && nextSlot.teacherId === slot.teacherId) {
                isMerged = true;
              }
            }
          }

          if (isMerged) {
            tbodyHtml += `
              <td colspan="2" class="print-wall-slot-cell print-wall-slot-cell--merged">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="print-wall-subj">${escapeHtml(slot.subjectCode)}</span>
                  <span class="print-wall-tag-double">Double</span>
                </div>
                <div class="print-wall-meta">${escapeHtml(slot.teacherName ? slot.teacherName.split(" ")[0] : "—")} · ${escapeHtml(slot.room || "Room")}</div>
              </td>
            `;
            pIdx++;
            continue;
          }

          if (slot) {
            tbodyHtml += `
              <td class="print-wall-slot-cell">
                <div class="print-wall-subj">${escapeHtml(slot.subjectCode)}</div>
                <div class="print-wall-meta">${escapeHtml(slot.teacherName ? slot.teacherName.split(" ")[0] : "—")} · ${escapeHtml(slot.room || "Room")}</div>
              </td>
            `;
          } else {
            tbodyHtml += `<td class="print-wall-slot-cell" style="text-align:center; color:#cbd5e1;">—</td>`;
          }
        }

        tbodyHtml += "</tr>";
      }
    }
    tbodyHtml += "</tbody>";

    // Build Advisors Directory Table HTML for print
    const advisorsHtml = `
      <div class="print-wall-advisors-wrap">
        <div class="print-wall-footer-title">Class Homeroom Advisors (C.A.) Directory</div>
        <table class="print-wall-advisors-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Class Teacher (Homeroom)</th>
              <th>TSC No. / Contact</th>
            </tr>
          </thead>
          <tbody>
            ${cohorts.map((c) => {
              const ct = getClassTeacher(teachers, c.grade, c.stream);
              return `
                <tr>
                  <td><b>${escapeHtml(c.label)}</b></td>
                  <td>${escapeHtml(ct ? ct.fullName : "Unassigned")}</td>
                  <td>${escapeHtml(ct ? (ct.tscNumber ? `TSC: ${ct.tscNumber}` : (ct.phone || "—")) : "—")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Build Signatures HTML for print
    const signaturesHtml = `
      <div class="print-wall-signatures-wrap">
        <div class="print-wall-footer-title">Institutional Approval & Certification</div>
        <div class="print-wall-sig-box">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <div>
              <div style="font-weight:700;">Dean of Studies / Timetable Coordinator:</div>
              <div style="margin-top:16px; border-bottom:0.5pt solid #0f172a; width:130px;"></div>
              <div style="font-size:5.5pt; color:#64748b; margin-top:2px;">Signature & Date</div>
            </div>
            <div>
              <div style="font-weight:700;">Principal / Headteacher:</div>
              <div style="margin-top:16px; border-bottom:0.5pt solid #0f172a; width:130px;"></div>
              <div style="font-size:5.5pt; color:#64748b; margin-top:2px;">Official Stamp & Date</div>
            </div>
          </div>
          <div class="print-wall-motto-statement">
            "${escapeHtml(schoolSettings.motto || "Excellence in Quality Competency-Based Education")}" · Kenya Junior School Compliance
          </div>
        </div>
      </div>
    `;

    const pageHtml = `
      <div class="timetable-print-page timetable-print-page--landscape">
        <div>
          ${buildOfficialHeader("INSTITUTIONAL MASTER TIMETABLE · WALL CHART", `Master Distribution Across All ${cohorts.length} Classes`)}
          <table class="timetable-print-wall-chart">
            ${theadHtml}
            ${tbodyHtml}
          </table>
        </div>
        <div class="print-wall-footer-grid">
          ${advisorsHtml}
          ${signaturesHtml}
        </div>
      </div>
    `;

    printTimetableDocument(pageHtml);
    return;
  }

  let pagesHtml = "";
  for (const day of daysToPrint) {
    let tableHtml = `
      <table class="timetable-print-table">
        <thead>
          <tr>
            <th style="width:85px;">Period</th>
            ${cohorts.map((c) => `<th>${c.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
    `;

    for (const p of periods) {
      if (p.isBreak) {
        tableHtml += `
          <tr class="print-break-row">
            <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
            <td colspan="${cohorts.length}">${p.name}</td>
          </tr>
        `;
        continue;
      }
      tableHtml += `
        <tr>
          <td class="print-period-col"><b>${p.name}</b><span>${p.startTime}–${p.endTime}</span></td>
          ${cohorts.map((c) => {
            const slot = slotsMap[`${c.grade}_${c.stream}_${day}_${p.id}`];
            if (slot) {
              return `
                <td>
                  <div class="timetable-print-cell-subj">${slot.subjectCode}</div>
                  <div class="timetable-print-cell-teacher">${slot.teacherName ? slot.teacherName.split(" ")[0] : "—"}</div>
                </td>
              `;
            }
            return `<td><span style="color:#94a3b8; font-size:7pt;">—</span></td>`;
          }).join("")}
        </tr>
      `;
    }
    tableHtml += `</tbody></table>`;

    pagesHtml += `
      <div class="timetable-print-page">
        <div>
          ${buildOfficialHeader(`School Master Timetable · ${day}`, `Master Overview across all ${cohorts.length} classes`)}
          ${tableHtml}
        </div>
        <div class="timetable-print-signatures">
          <div class="timetable-print-sig-col">
            <div class="timetable-print-sig-title">Dean of Studies / Academic Master:</div>
            <div style="margin-top:20px; font-size:8pt; color:#64748b;">Master Timetable Certified · Date: _______________</div>
          </div>
          <div class="timetable-print-sig-col">
            <div class="timetable-print-sig-title">Principal's Office:</div>
            <div style="margin-top:20px; font-size:8pt; color:#64748b;">Approved & Stamped · Date: _______________</div>
          </div>
        </div>
      </div>
    `;
  }

  printTimetableDocument(pagesHtml);
}

// --------------------------------------------------- Workload & Excel Export --

function openFacultyWorkloadModal() {
  const allMasterSlots = masterSlots.length ? masterSlots : [];
  const instructionalTotal = periods.filter((p) => !p.isBreak).length * DAYS.length;
  const totalScheduled = allMasterSlots.length;
  const activeTeachers = teachers.filter((t) => allMasterSlots.some((s) => s.teacherId === t.id));
  const avgLoad = activeTeachers.length ? (totalScheduled / activeTeachers.length).toFixed(1) : "0.0";

  let searchQuery = "";

  const modalBody = el("div", { class: "workload-modal-body" });

  function renderList(targetMount) {
    targetMount.innerHTML = "";

    const query = searchQuery.trim().toLowerCase();
    const filteredTeachers = teachers.filter((t) => {
      if (!query) return true;
      const name = (t.fullName || t.name || "").toLowerCase();
      const tsc = (t.tscNumber || "").toLowerCase();
      const homeroom = (t.homeroom || "").toLowerCase();
      const subs = (t.teachingAssignments || []).map((a) => a.subjectCode.toLowerCase()).join(" ");
      return name.includes(query) || tsc.includes(query) || homeroom.includes(query) || subs.includes(query);
    });

    if (!filteredTeachers.length) {
      targetMount.append(el("div", { class: "empty-state", style: "padding:var(--sp-4);" }, [
        icon("search_off", "empty-state__icon"),
        el("p", { class: "text-muted text-sm" }, "No faculty members match your search criteria."),
      ]));
      return;
    }

    const list = el("div", { style: "display:flex; flex-direction:column; gap:10px;" });

    for (const t of filteredTeachers) {
      const assigned = allMasterSlots.filter((s) => s.teacherId === t.id);
      const count = assigned.length;

      let statusBadge = null;
      if (count === 0) {
        statusBadge = el("span", { class: "badge badge--muted" }, "0 Lessons · Unassigned");
      } else if (count < 18) {
        statusBadge = el("span", { class: "badge badge--info" }, `${count} Lessons · Light Load`);
      } else if (count <= 27) {
        statusBadge = el("span", { class: "badge badge--success" }, `${count} Lessons · Optimal TSC Load`);
      } else {
        statusBadge = el("span", { class: "badge badge--danger" }, `${count} Lessons · Heavy Load`);
      }

      const dayDistribution = DAYS.map((d) => {
        const c = assigned.filter((s) => s.day === d).length;
        return `${d.slice(0, 3)}: ${c}`;
      }).join(" · ");

      const homeroom = t.homeroom ? t.homeroom.replace("|", " ").trim() : null;
      const distinctClasses = [...new Set(assigned.map((s) => `${s.grade} ${s.stream || ""}`.trim()))];
      const distinctSubjects = [...new Set(assigned.map((s) => s.subjectName || s.subjectCode))];

      const card = el("div", {
        style: "border:1px solid var(--color-line); border-radius:var(--radius-md); padding:12px 14px; background:var(--color-surface); transition:all 0.15s ease;"
      }, [
        el("div", { style: "display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;" }, [
          el("div", {}, [
            el("div", { style: "display:flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
              el("b", { style: "font-size:14px; color:var(--color-primary-900);" }, t.fullName || t.name),
              t.tscNumber ? el("span", { style: "font-family:var(--font-mono, monospace); font-size:11px; color:var(--color-ink-soft);" }, `TSC: ${t.tscNumber}`) : null,
              homeroom ? el("span", { class: "badge badge--warning", style: "font-size:10px;" }, `Class Teacher: ${homeroom}`) : null,
            ].filter(Boolean)),
            el("div", { style: "font-size:11px; color:var(--color-ink-soft); margin-top:4px;" }, [
              `Daily Breakdown: ${dayDistribution}`,
            ]),
          ]),
          statusBadge,
        ]),
        distinctSubjects.length ? el("div", { style: "margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;" }, [
          el("span", { style: "font-size:10px; font-weight:600; color:var(--color-ink-soft); text-transform:uppercase;" }, "Subjects:"),
          ...distinctSubjects.map((sub) => el("span", { style: "font-size:11px; background:var(--color-primary-100); color:var(--color-primary-900); padding:1px 6px; border-radius:4px; border:1px solid var(--color-line);" }, sub)),
        ]) : null,
        distinctClasses.length ? el("div", { style: "margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;" }, [
          el("span", { style: "font-size:10px; font-weight:600; color:var(--color-ink-soft); text-transform:uppercase;" }, "Classes:"),
          ...distinctClasses.map((cls) => el("span", { style: "font-size:11px; background:var(--color-cream-dim, #f8fafc); color:var(--color-ink); padding:1px 6px; border-radius:4px; border:1px solid var(--color-line);" }, cls)),
        ]) : null,
      ].filter(Boolean));

      list.append(card);
    }

    targetMount.append(list);
  }

  // Summary Metrics Banner
  const summaryHeader = el("div", {
    style: "display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:14px;"
  }, [
    el("div", { style: "background:var(--color-primary-100); border:1px solid var(--color-line); border-radius:var(--radius-sm); padding:10px; text-align:center;" }, [
      el("div", { style: "font-size:20px; font-weight:800; color:var(--color-primary-900);" }, String(totalScheduled)),
      el("div", { style: "font-size:10px; color:var(--color-ink-soft); text-transform:uppercase; font-weight:600;" }, "Total Lessons"),
    ]),
    el("div", { style: "background:var(--color-primary-100); border:1px solid var(--color-line); border-radius:var(--radius-sm); padding:10px; text-align:center;" }, [
      el("div", { style: "font-size:20px; font-weight:800; color:var(--color-primary-900);" }, `${activeTeachers.length} / ${teachers.length}`),
      el("div", { style: "font-size:10px; color:var(--color-ink-soft); text-transform:uppercase; font-weight:600;" }, "Active Faculty"),
    ]),
    el("div", { style: "background:var(--color-primary-100); border:1px solid var(--color-line); border-radius:var(--radius-sm); padding:10px; text-align:center;" }, [
      el("div", { style: "font-size:20px; font-weight:800; color:var(--color-primary-900);" }, `${avgLoad}`),
      el("div", { style: "font-size:10px; color:var(--color-ink-soft); text-transform:uppercase; font-weight:600;" }, "Avg Lessons/Wk"),
    ]),
    el("div", { class: "timetable-metric-box timetable-metric-box--tsc" }, [
      el("div", { class: "timetable-metric-val" }, "20–27"),
      el("div", { class: "timetable-metric-label" }, "TSC Standard"),
    ]),
  ]);

  // Search input
  const searchInput = el("input", {
    type: "text",
    placeholder: "Search faculty by name, TSC number, subject, or class…",
    class: "input input--sm",
    style: "width:100%; margin-bottom:12px;",
    onInput: (e) => {
      searchQuery = e.target.value;
      renderList(listMount);
    },
  });

  const listMount = el("div", { style: "max-height:420px; overflow-y:auto; padding-right:4px;" });

  modalBody.append(summaryHeader, searchInput, listMount);
  renderList(listMount);

  openModal({
    title: "Faculty Workload & Lesson Distribution",
    content: modalBody,
    actions: [
      {
        label: "Export Excel (.xlsx)",
        variant: "ghost",
        onClick: (e) => exportMasterToExcel(e),
      },
      {
        label: "Close",
        variant: "secondary",
        onClick: () => true,
      },
    ],
  });
}

async function exportMasterToExcel(e) {
  const restore = busyButton(e?.currentTarget || null, "Exporting…");
  try {
    const XLSX = await import("xlsx/xlsx.mjs").then((m) => m.default || m);
    const wb = XLSX.utils.book_new();

    const cohorts = getAllCohorts();

    // Sheet 1: Master Schedule Grid
    const gridRows = [];
    const headers = ["Day", "Period", "Time", ...cohorts.map((c) => c.label)];
    gridRows.push(headers);

    const slotMap = new Map();
    for (const slot of masterSlots) {
      slotMap.set(`${slot.grade}_${slot.stream || ""}_${slot.day}_${slot.periodId}`, slot);
    }

    for (const day of DAYS) {
      for (const p of periods) {
        if (p.isBreak) {
          const breakRow = [day, p.name, `${p.startTime}–${p.endTime}`];
          for (let i = 0; i < cohorts.length; i++) breakRow.push(`— ${p.name} —`);
          gridRows.push(breakRow);
          continue;
        }
        const row = [day, p.name, `${p.startTime}–${p.endTime}`];
        for (const c of cohorts) {
          const slot = slotMap.get(`${c.grade}_${c.stream}_${day}_${p.id}`);
          if (slot) {
            const teacherInit = slot.teacherName ? slot.teacherName.split(" ")[0] : "Unassigned";
            row.push(`${slot.subjectCode} (${teacherInit})${slot.room ? " [" + slot.room + "]" : ""}`);
          } else {
            row.push("—");
          }
        }
        gridRows.push(row);
      }
    }

    const wsMaster = XLSX.utils.aoa_to_sheet(gridRows);
    wsMaster["!cols"] = [
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      ...cohorts.map(() => ({ wch: 20 })),
    ];
    XLSX.utils.book_append_sheet(wb, wsMaster, "Master Schedule");

    // Sheet 2: Faculty Workloads
    const workloadRows = [
      ["Teacher Name", "TSC Number", "Homeroom / Class Teacher", "Total Weekly Lessons", "TSC Workload Status", "Mon", "Tue", "Wed", "Thu", "Fri", "Assigned Classes", "Assigned Subjects"]
    ];

    for (const t of teachers) {
      const assigned = masterSlots.filter((s) => s.teacherId === t.id);
      const count = assigned.length;
      let status = "Light (< 18 lessons)";
      if (count >= 18 && count <= 27) status = "Optimal (18–27 lessons)";
      else if (count > 27) status = "Heavy (> 27 lessons)";
      else if (count === 0) status = "Unassigned (0 lessons)";

      const dayCounts = DAYS.map((d) => assigned.filter((s) => s.day === d).length);
      const classesList = [...new Set(assigned.map((s) => `${s.grade} ${s.stream || ""}`.trim()))].join(", ");
      const subsList = [...new Set(assigned.map((s) => s.subjectName || s.subjectCode))].join(", ");
      const homeroom = t.homeroom ? t.homeroom.replace("|", " ").trim() : "None";

      workloadRows.push([
        t.fullName || t.name || "Unknown",
        t.tscNumber || "N/A",
        homeroom,
        count,
        status,
        ...dayCounts,
        classesList || "—",
        subsList || "—",
      ]);
    }

    const wsWorkload = XLSX.utils.aoa_to_sheet(workloadRows);
    wsWorkload["!cols"] = [
      { wch: 24 },
      { wch: 14 },
      { wch: 22 },
      { wch: 20 },
      { wch: 24 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 28 },
      { wch: 32 },
    ];
    XLSX.utils.book_append_sheet(wb, wsWorkload, "Faculty Workloads");

    // Sheet 3: Flat Schedule List
    const flatRows = [
      ["Day", "Period", "Start Time", "End Time", "Grade", "Stream", "Class Cohort", "Subject Code", "Subject Name", "Teacher Name", "Room"]
    ];
    for (const s of masterSlots) {
      const p = periods.find((x) => x.id === s.periodId);
      flatRows.push([
        s.day,
        s.periodName || (p ? p.name : ""),
        p ? p.startTime : "",
        p ? p.endTime : "",
        s.grade,
        s.stream || "",
        `${s.grade} ${s.stream || ""}`.trim(),
        s.subjectCode,
        s.subjectName || "",
        s.teacherName || "",
        s.room || "",
      ]);
    }
    const wsFlat = XLSX.utils.aoa_to_sheet(flatRows);
    wsFlat["!cols"] = [
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, wsFlat, "All Lessons Flat");

    const schoolSlug = (schoolSettings.name || "School").replace(/[^a-zA-Z0-9_-]/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${schoolSlug}_Master_Timetable_${dateStr}.xlsx`;

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);

    toast("Master timetable exported to Excel successfully!", "success");
  } catch (err) {
    console.error("Failed to export Excel timetable:", err);
    toast("Could not export Excel: " + (err.message || err), "error");
  } finally {
    if (typeof restore === "function") restore();
  }
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

// ----------------------------------------------------------- Shared Grid UI --

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
        const deptClass = getSubjectDepartmentClass(slot.subjectCode);
        const pill = el("button", {
          type: "button",
          class: `tt-pill ${deptClass}${canManage ? "" : " tt-pill--readonly"}`.trim()
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

function renderWelcomeDisclaimers(container, mode = "class") {
  container.innerHTML = "";
  const welcomeCard = el("div", { class: "timetable-welcome-card" }, [
    el("div", { class: "timetable-welcome-header" }, [
      el("div", { class: "marks-welcome-icon-halo" }, [icon("schedule")]),
      el("h3", {}, mode === "teacher" ? "Select a Faculty Member to View Schedule" : "Select a Class to View Schedule"),
      el("p", {}, mode === "teacher"
        ? "Choose a teacher above to inspect their assigned instructional periods, subject rooms, and free slots."
        : "Choose a Grade and Stream above to view or assign weekly lessons, teachers, and break periods."),
    ]),
    el("div", { class: "guidance-section-header" }, [
      icon("verified_user"),
      el("span", {}, "Scheduling Protocols & Conflict Safeguards"),
    ]),
    el("div", { class: "guidance-grid" }, [
      el("div", { class: "guidance-card" }, [
        el("div", { class: "guidance-card__header" }, [
          el("div", { class: "guidance-card__icon guidance-card__icon--blue" }, [icon("lock")]),
          el("span", { class: "guidance-card__tag guidance-card__tag--blue" }, "Intelligence"),
        ]),
        el("div", { class: "guidance-card__content" }, [
          el("h4", { class: "guidance-card__title" }, "Automated Conflict Prevention"),
          el("p", { class: "guidance-card__body" }, "Timetable actively monitors teacher allocations. If a teacher is already assigned in the same period and day, double-booking is blocked automatically."),
        ]),
      ]),
      el("div", { class: "guidance-card" }, [
        el("div", { class: "guidance-card__header" }, [
          el("div", { class: "guidance-card__icon guidance-card__icon--amber" }, [icon("free_breakfast")]),
          el("span", { class: "guidance-card__tag guidance-card__tag--amber" }, "Schedule"),
        ]),
        el("div", { class: "guidance-card__content" }, [
          el("h4", { class: "guidance-card__title" }, "School-Wide Break Periods"),
          el("p", { class: "guidance-card__body" }, "Periods configured as 'Break' automatically span all streams and grades school-wide. Instructional subject lessons cannot be booked during break intervals."),
        ]),
      ]),
      el("div", { class: "guidance-card" }, [
        el("div", { class: "guidance-card__header" }, [
          el("div", { class: "guidance-card__icon guidance-card__icon--green" }, [icon("verified")]),
          el("span", { class: "guidance-card__tag guidance-card__tag--green" }, "CBC Staff"),
        ]),
        el("div", { class: "guidance-card__content" }, [
          el("h4", { class: "guidance-card__title" }, "Qualified Subject Teachers"),
          el("p", { class: "guidance-card__body" }, "The slot assignment dialog groups and highlights teachers assigned to the chosen subject first, ensuring CBC subject specialization."),
        ]),
      ]),
      el("div", { class: "guidance-card" }, [
        el("div", { class: "guidance-card__header" }, [
          el("div", { class: "guidance-card__icon guidance-card__icon--purple" }, [icon("warning")]),
          el("span", { class: "guidance-card__tag guidance-card__tag--purple" }, "Integrity"),
        ]),
        el("div", { class: "guidance-card__content" }, [
          el("h4", { class: "guidance-card__title" }, "Period Modifications & Deletion"),
          el("p", { class: "guidance-card__body" }, "Altering period start or end times updates all class schedules school-wide. Deleting an active period permanently unlinks all assigned lesson slots."),
        ]),
      ]),
    ]),
  ]);
  container.append(welcomeCard);
}

export function init() {}
