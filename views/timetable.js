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
  batchUpdatePeriods,
  resetToStandardPeriods,
  timeToMinutes,
  minutesToTime,
  addMinutesToTime,
  calculateDurationMinutes,
  getClassTimetable,
  getMasterTimetable,
  getTimetableRoomMode,
  setTimetableRoomMode,
  detectTimetableConflicts,
  createTimetableDraft,
  defaultTimetablePlan,
  loadTimetableDraftInputs,
  publishTimetableDraft,
  clearAllTimetableSlots,
  clearClassTimetableSlots,
  assignSlot,
  assignDoubleSlot,
  markSlotFree,
  clearSlot,
  clearDoubleSlot,
  createSharedTimetable,
  downloadStandaloneTimetableHtml,
  isDoubleEligibleSubject,
  isBreakPeriod,
} from "../js/services/timetable.service.js";
import { downloadPdfsAsZip, triggerBlobDownload } from "../js/services/pdf.util.js";
import { renderTimetablePdf } from "../js/services/timetable-pdf.js";
import { buildTimetableGrid, getTimetableSubjectCategory, timetableLetterhead } from "../js/services/timetable-layout.js";
import { FREE_PERIOD, areAdjacentTeachingPeriods, canMergeLessons, namedTimetableRoom } from "../js/services/timetable-rules.js";
import { renderTimetableChart } from "../js/components/timetable-grid.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";
import { copyDeepLink } from "../js/services/deep-link.service.js";
import { rememberWorkspaceSelection, restoreWorkspaceSelection, workspaceCohort, workspaceOption } from "../js/services/workspace-selection.js";
import { workspaceResults } from "../js/components/workspace-results.js";

const CAN_MANAGE = ["admin", "academic_master"];
const CAN_SEE_ALL_TEACHERS = ["admin", "academic_master", "principal", "deputy_principal"];

let classes = [];
let subjects = [];
let teachers = [];
let periods = [];
let schoolSettings = {};
let namedRoomsEnabled = false;

let classSelection = { grade: "", stream: "" };
let teacherSelection = { teacherId: "" };
let masterSlots = [];
let masterConflicts = [];
let masterDayFilter = "All"; // "All" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday"
let activeTab = "master"; // "master" | "classes" | "teachers" | "periods"
let masterViewMode = "wall";
let masterPaperSize = "a3";
let globalGoToTab = null;

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
  const assigned = (matchesStream) => allTeachers.find((teacher) =>
    (teacher.teachingAssignments || []).some((assignment) =>
      assignment.subjectCode === subjectCode && assignment.grade === grade && matchesStream(assignment.stream)));
  return (stream && assigned((value) => value === stream)) || assigned((value) => !value) || null;
}

function subjectCategory(code) {
  const subject = subjects.find((item) => item.code === code);
  return getTimetableSubjectCategory(code, subject?.department);
}

export function getSubjectDepartmentClass(code) {
  const category = subjectCategory(code);
  return category ? `tt-pill--${category}` : "";
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

export { buildTimetableMascotSvg } from "../js/components/mascot.js";

/**
 * Complete Timetable Implementation Workflow Guide Modal
 */
export function openWorkflowGuideModal() {
  const body = el("div", { class: "tt-workflow-modal-body" });

  const intro = el("div", {
    class: "callout callout--info",
    style: "margin-bottom:18px; font-size:12.5px; display:flex; align-items:flex-start; gap:10px;"
  }, [
    icon("alt_route", "text-sm", "style: color:var(--color-primary-800); margin-top:2px; flex-shrink:0;"),
    el("div", {}, [
      el("strong", {}, "Timetable Implementation Protocol: "),
      "Follow this sequential 6-step roadmap to establish, balance, and distribute verified collision-free timetables across all cohorts and faculty.",
    ]),
  ]);

  const stepsGrid = el("div", {
    style: "display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-bottom:20px;"
  });

  const steps = [
    {
      num: "1",
      icon: "school",
      title: "Classes & Streams",
      desc: "Configure Grade 7, 8, 9 cohorts and streams under Academics.",
      link: "#/academics",
      linkLabel: "Go to Academics",
    },
    {
      num: "2",
      icon: "person_add",
      title: "Teacher Allocations",
      desc: "Assign teachers to the subjects they teach in each class under Faculty.",
      link: "#/teachers",
      linkLabel: "Go to Faculty",
    },
    {
      num: "3",
      icon: "badge",
      title: "Class Teachers",
      desc: "Designate each homeroom class teacher for signature blocks, tracking, and parent communication.",
      link: "#/teachers",
      linkLabel: "Assign Class Teachers",
    },
    {
      num: "4",
      icon: "table_chart",
      title: "Generate a Master Draft",
      desc: "Review weekly lesson counts, room bookings, and staffing before saving.",
      actionTab: "master",
      linkLabel: "Open Master Timetable",
    },
    {
      num: "5",
      icon: "print",
      title: "Print Class Schedules",
      desc: "Print clean weekly schedules per class cohort or batch-print all classroom sheets.",
      actionTab: "classes",
      linkLabel: "View Class Schedules",
    },
    {
      num: "6",
      icon: "person",
      title: "Print Teacher Schedules",
      desc: "Print personalized weekly teaching and free/prep periods for staff room and lesson monitoring.",
      actionTab: "teachers",
      linkLabel: "View Teacher Schedules",
    },
  ];

  let closeFn = null;

  steps.forEach((s) => {
    const stepCard = el("div", {
      style: "background:var(--color-cream-dim, #f8fafc); border:1px solid var(--color-line); border-radius:var(--radius-md); padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;"
    }, [
      el("div", { style: "display:flex; align-items:flex-start; gap:12px;" }, [
        el("div", {
          style: "width:28px; height:28px; border-radius:50%; background:var(--color-primary-800); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0;"
        }, s.num),
        el("div", {}, [
          el("div", { style: "display:flex; align-items:center; gap:6px; font-weight:700; color:var(--color-primary-900); font-size:13px;" }, [
            icon(s.icon, "text-xs"),
            s.title,
          ]),
          el("p", { style: "margin:4px 0 0; font-size:11.5px; color:var(--color-ink-soft); line-height:1.4;" }, s.desc),
        ]),
      ]),
      el("div", { style: "align-self:flex-end; margin-top:4px;" }, [
        s.link ? el("a", {
          href: s.link,
          class: "btn btn--ghost btn--sm",
          style: "font-size:11px; padding:3px 10px;",
          onClick: () => { if (closeFn) closeFn(); }
        }, [icon("arrow_forward", "text-xs"), s.linkLabel]) : el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          style: "font-size:11px; padding:3px 10px;",
          onClick: () => {
            if (closeFn) closeFn();
            const tabBtn = document.querySelector(`.timetable-tab[data-tab="${s.actionTab}"]`);
            if (tabBtn) tabBtn.click();
            else location.hash = `#/timetable?tab=${s.actionTab}`;
          }
        }, [icon("arrow_forward", "text-xs"), s.linkLabel]),
      ]),
    ]);
    stepsGrid.append(stepCard);
  });

  const safeguardBox = el("div", {
    style: "background:#fff; border:1px solid var(--color-line); border-radius:var(--radius-md); padding:12px 16px; margin-bottom:18px; font-size:11.5px; color:var(--color-ink-soft);"
  }, [
    el("div", { style: "font-weight:700; color:var(--color-primary-900); margin-bottom:4px; display:flex; align-items:center; gap:6px;" }, [
      icon("verified_user", "text-xs"),
      "Scheduling Safeguards & Quality Protocols",
    ]),
    el("ul", { style: "margin:0; padding-left:18px; line-height:1.5;" }, [
      el("li", {}, "Strict Collision Safeguard: Teachers cannot be double-booked across streams or subjects at the same time."),
      el("li", {}, "School-Wide Break Periods: Short Break, Lunch, and Games & Clubs span all classes with zero lesson overlaps."),
      el("li", {}, "The generator uses configured faculty assignments and flags lessons that need staffing."),
    ]),
  ]);

  const footerActions = el("div", {
    style: "display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--color-line); padding-top:12px;"
  }, [
    el("button", {
      type: "button",
      class: "btn btn--primary",
      onClick: () => { if (closeFn) closeFn(); }
    }, "Close Guide"),
  ]);

  body.append(intro, stepsGrid, safeguardBox, footerActions);

  closeFn = openModal("Complete Timetable Implementation Workflow", body, "modal--wide");
  return closeFn;
}

/**
 * Complete Timetable Sharing Modal (No Login Required)
 * Generates an unguessable secure link for recipients to view and save schedules locally.
 */
export function openShareTimetableModal({
  type = "master",
  targetId = "master",
  title = "Timetable",
  subTitle = "",
  slots = [],
  periods = [],
  cohorts = [],
  profile,
  schoolSettings = {},
  teachers = [],
}) {
  const body = el("div", { class: "share-tt-modal-body" });

  const intro = el("div", {
    class: "callout callout--info",
    style: "margin-bottom:16px; font-size:12.5px; display:flex; align-items:flex-start; gap:10px;",
  }, [
    icon("lock_open", "text-sm", "style: color:var(--color-primary-800); margin-top:2px; flex-shrink:0;"),
    el("div", {}, [
      el("strong", {}, "Secure Public Timetable Link: "),
      "Generates a protected, unguessable link that allows recipients (faculty, parents, students) to view and save this timetable on their devices ",
      el("strong", {}, "without needing an account or login password."),
    ]),
  ]);

  const targetBox = el("div", {
    style: "background:var(--color-cream-dim, #f8fafc); border:1px solid var(--color-line); border-radius:var(--radius-md); padding:12px 14px; margin-bottom:16px;",
  }, [
    el("div", { style: "font-size:11px; text-transform:uppercase; font-weight:700; color:var(--color-ink-soft);" }, "Sharing Schedule:"),
    el("div", { style: "font-size:15px; font-weight:800; color:var(--color-primary-900); margin-top:2px;" }, title),
    subTitle ? el("div", { style: "font-size:12px; color:var(--color-ink-soft); margin-top:2px;" }, subTitle) : null,
    el("div", { style: "display:flex; gap:12px; margin-top:8px; font-size:11.5px; color:var(--color-ink-soft);" }, [
      el("span", {}, `${slots.length} Scheduled Lessons`),
      el("span", {}, "·"),
      el("span", {}, `${periods.length} Daily Periods`),
    ]),
  ]);

  // Security & PIN setting
  const pinWrap = el("div", { style: "margin-bottom:16px; border-top:1px dashed var(--color-line); padding-top:12px;" });
  const pinCheck = el("input", { type: "checkbox", id: "share-pin-check", style: "margin-top:2px;" });
  const pinInput = el("input", {
    type: "text",
    placeholder: "e.g. 1234",
    maxlength: "8",
    style: "display:none; width:130px; margin-top:8px; font-size:13px; text-align:center; font-weight:700; letter-spacing:0.1em;",
  });

  pinCheck.addEventListener("change", () => {
    pinInput.style.display = pinCheck.checked ? "inline-block" : "none";
    if (pinCheck.checked) pinInput.focus();
  });

  const pinLabel = el("label", { style: "display:flex; align-items:flex-start; gap:8px; font-size:12px; cursor:pointer;" }, [
    pinCheck,
    el("div", {}, [
      el("strong", {}, "Require a 4-digit PIN code to view (Optional)"),
      el("div", { class: "text-muted text-xs", style: "margin-top:2px;" }, "Recommended if faculty contact numbers or internal teacher notes are displayed."),
    ]),
  ]);
  pinWrap.append(pinLabel, pinInput);

  // Link output mount
  const linkOutputMount = el("div", { style: "margin-bottom:18px;" });

  let currentShareResult = null;
  let closeFn = null;

  async function generateLink(btnElement = null) {
    let restore = null;
    if (btnElement) restore = busyButton(btnElement, "Generating secure link…");

    try {
      const pinValue = pinCheck.checked ? pinInput.value.trim() : null;
      if (pinCheck.checked && (!pinValue || pinValue.length < 3)) {
        toast("Please enter a PIN with at least 3 digits.", "error");
        if (restore) restore();
        return;
      }

      currentShareResult = await createSharedTimetable(profile?.uid || "staff", {
        type,
        targetId,
        title,
        subTitle,
        slots: slots.map((slot) => ({ ...slot, category: subjectCategory(slot.subjectCode) })),
        periods,
        cohorts,
        schoolSettings,
        teachers,
        pin: pinValue,
      });

      renderLinkBox(currentShareResult.shareUrl, pinValue);
      toast("Secure link created successfully!", "success");
    } catch (err) {
      toast(err.message || "Could not generate link.", "error");
    } finally {
      if (restore) restore();
    }
  }

  function renderLinkBox(url, pin) {
    linkOutputMount.innerHTML = "";

    const linkBox = el("div", {
      style: "background:#ffffff; border:1.5px solid var(--color-primary-700); border-radius:var(--radius-md); padding:14px; display:flex; flex-direction:column; gap:10px;",
    }, [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
        el("span", { style: "font-size:11px; font-weight:700; color:var(--color-primary-900); text-transform:uppercase; letter-spacing:0.04em;" }, "Ready-to-Share Link:"),
        pin ? el("span", { class: "badge badge--warning", style: "font-size:10px;" }, `PIN: ${pin}`) : el("span", { class: "badge badge--success", style: "font-size:10px;" }, "Instant Access (No PIN)"),
      ]),
      el("div", { style: "display:flex; gap:8px;" }, [
        el("input", {
          type: "text",
          readonly: "true",
          value: url,
          style: "flex:1; font-size:12px; font-family:monospace; background:var(--color-cream-dim, #f1f5f9); border:1px solid var(--color-line); padding:8px 10px; border-radius:var(--radius-sm);",
          onClick: (e) => e.target.select(),
        }),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          style: "flex-shrink:0;",
          onClick: () => {
            navigator.clipboard.writeText(url).then(() => toast("Link copied to clipboard!", "success"));
          },
        }, [icon("content_copy", "text-xs"), "Copy Link"]),
      ]),
      el("div", { style: "display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;" }, [
        el("a", {
          href: `https://api.whatsapp.com/send?text=${encodeURIComponent(`*${schoolSettings.schoolName || "School"} Timetable*\n${title}\n\nView and save your schedule here:\n${url}`)}`,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "btn btn--ghost btn--sm",
          style: "color:#166534; border-color:#86efac; background:#f0fdf4;",
        }, [icon("share", "text-xs"), "Share on WhatsApp"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Download a single-file HTML timetable that can be opened anywhere offline",
          onClick: () => {
            if (currentShareResult && currentShareResult.payload) {
              downloadStandaloneTimetableHtml(currentShareResult.payload);
              toast("Offline timetable downloaded!", "success");
            }
          },
        }, [icon("download", "text-xs"), "Download Offline HTML"]),

        el("a", {
          href: url,
          target: "_blank",
          rel: "noopener",
          class: "btn btn--ghost btn--sm",
        }, [icon("open_in_new", "text-xs"), "Preview Link"]),
      ]),
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px dashed var(--color-line); font-size:11px; color:var(--color-ink-soft);" }, [
        el("span", {}, "Internal link for logged-in staff only:"),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "Copy link for teachers and staff who have accounts in the system",
          onClick: () => {
            const p = { tab: type === "master" ? "master" : type === "class" ? "classes" : "teachers" };
            if (type === "class" && classSelection.grade) {
              p.grade = classSelection.grade;
              if (classSelection.stream) p.stream = classSelection.stream;
            } else if (type === "teacher" && teacherSelection.teacherId) {
              p.teacherId = teacherSelection.teacherId;
            }
            copyDeepLink("/timetable", p, `${title} internal staff link`);
          },
        }, [icon("lock", "text-xs"), "Copy In-App Link"]),
      ]),
    ]);

    linkOutputMount.append(linkBox);
  }

  const generateBtn = el("button", {
    type: "button",
    class: "btn btn--primary btn--block",
    onClick: (e) => generateLink(e.currentTarget),
  }, [icon("link", "text-xs"), "Generate / Update Link"]);

  body.append(intro, targetBox, pinWrap, linkOutputMount, generateBtn);

  closeFn = openModal("Share Timetable Securely (No Login Required)", body);
  generateLink();
  return closeFn;
}

// ------------------------------------------------------------- Main Render --

export async function render({ profile, params = {} }) {
  const canManage = CAN_MANAGE.includes(profile.role);
  if (canManage) {
    await seedDefaultPeriodsIfEmpty();
  }

  [classes, subjects, teachers, periods, schoolSettings, namedRoomsEnabled] = await Promise.all([
    listClasses(),
    listSubjects(),
    CAN_SEE_ALL_TEACHERS.includes(profile.role) ? listTeachers() : Promise.resolve([]),
    listPeriods(),
    getSchoolSettings(),
    getTimetableRoomMode(),
  ]);

  const remembered = restoreWorkspaceSelection(profile, "timetable");
  const linkedGrade = params.grade ?? params.class;
  const linkedTab = params.tab ?? (params.teacherId ? "teachers" : linkedGrade ? "classes" : (params.day || params.view) && canManage ? "master" : undefined);
  const defaultTab = canManage ? "master" : "classes";
  activeTab = workspaceOption(["classes", "teachers", ...(canManage ? ["master", "periods"] : [])],
    linkedTab ?? remembered.tab ?? defaultTab) || defaultTab;
  masterDayFilter = workspaceOption(["All", ...DAYS], params.day) || "All";
  masterViewMode = workspaceOption(["wall", "cards"], params.view) || "wall";
  const cohortKey = workspaceCohort(getAllCohorts().map(({ grade, stream }) => `${grade}|${stream}`),
    linkedGrade, params.stream);
  const [grade, stream = ""] = cohortKey.split("|");
  classSelection = { grade, stream };
  teacherSelection = {
    teacherId: workspaceOption(teachers.map(({ id }) => id), params.teacherId),
  };

  const wrap = el("div", { class: "timetable-view-wrap" });

  // Navigation Tabs
  const tabNav = el("div", { class: "page-tabs", role: "group", "aria-label": "Timetable views" });
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
          "data-tab": tab.id,
          class: `timetable-tab profile-tab${activeTab === tab.id ? " profile-tab--active" : ""}`,
          "aria-pressed": String(activeTab === tab.id),
          onClick: () => {
            activeTab = tab.id;
            rememberWorkspaceSelection(profile, "timetable", { tab: activeTab });
            renderTabs();
            switchTab(activeTab);
          },
        },
        [icon(tab.iconName, "text-xs"), tab.label]
      );
      tabNav.append(btn);
    });
  }

  globalGoToTab = (tabId) => {
    if (!tabsConfig.some(({ id }) => id === tabId)) return;
    activeTab = tabId;
    rememberWorkspaceSelection(profile, "timetable", { tab: activeTab });
    renderTabs();
    switchTab(activeTab);
  };

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
  wrap.append(el("div", { class: "module-tab-bar no-print" }, [
    tabNav,
    el("button", {
      type: "button",
      class: "btn btn--ghost btn--sm",
      onClick: () => openWorkflowGuideModal(),
    }, [icon("help", "text-xs"), "Guide"]),
  ]));
  wrap.append(tabContentMount);

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
  masterConflicts = detectTimetableConflicts(masterSlots, { useNamedRooms: namedRoomsEnabled });

  function refreshMaster() {
    mount.innerHTML = "";


    if (masterConflicts.length) {
      mount.append(el("details", { class: "tt-conflict-alert" }, [
        el("summary", {}, "Booking conflicts (" + masterConflicts.length + ")"),
        el("ul", { class: "tt-conflict-alert__list" }, masterConflicts.map(({ message }) => el("li", {}, message))),
      ]));
    } else if (!masterSlots.length) {
      mount.append(el("p", { class: "text-muted text-sm" },
        "Generate a draft from your weekly lesson plan, or select a cell to assign a lesson."));
    }

    const controls = el("div", { class: "master-tt-controls no-print" }, [
      el("div", { class: "tt-view-mode-toggle" }, [
        el("button", {
          type: "button",
          class: `tt-view-mode-btn ${masterViewMode === "wall" ? "tt-view-mode-btn--active" : ""}`,
          title: "Weekly timetable with one class row per day",
          onClick: () => { masterViewMode = "wall"; refreshMaster(); }
        }, [icon("view_quilt", "text-xs"), "Wall chart"]),
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
          onClick: () => openAutoGenerateModal(profile, () => renderMasterTab(container, profile)),
        }, [icon("auto_fix_high", "text-xs"), "Generate timetable"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Share the Master Timetable via direct public link, WhatsApp, or offline file (No login needed)",
          onClick: () => {
            openShareTimetableModal({
              type: "master",
              targetId: "master",
              title: "Master timetable",
              subTitle: `Master schedule across all ${getAllCohorts().length} classes`,
              slots: masterSlots,
              periods,
              cohorts: getAllCohorts(),
              profile,
              schoolSettings,
              teachers,
            });
          },
        }, [icon("share", "text-xs"), "Share Link"]),

        el("label", { class: "tt-paper-option" }, [
          "PDF paper",
          el("select", { onChange: (event) => { masterPaperSize = event.currentTarget.value; } }, [
            el("option", { value: "a3", selected: masterPaperSize === "a3" ? "true" : undefined }, "A3"),
            el("option", { value: "a4", selected: masterPaperSize === "a4" ? "true" : undefined }, "A4"),
          ]),
        ]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Download the master wall chart as a landscape PDF",
          onClick: (e) => downloadMasterPdf(e.currentTarget),
        }, [icon("download", "text-xs"), "Download master PDF"]),

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

    const edit = (day, period, cohort) => openAssignModal(profile, day, period, cohort, async () => {
      masterSlots = await getMasterTimetable();
      masterConflicts = detectTimetableConflicts(masterSlots, { useNamedRooms: namedRoomsEnabled });
      refreshMaster();
    });
    if (masterViewMode === "wall") {
      const grid = scheduleGrid("master", masterSlots, { cohorts, days: daysToRender });
      mount.append(renderTimetableChart(grid, scheduleLetterhead("master"), {
        onEdit: (day, period, slot, cohort) => edit(day, period, cohort),
      }));
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
              onClick: () => edit(day, period, cohort),
            }, [
              el("b", { class: "tt-subject-name" }, slot.isFree ? FREE_PERIOD.subjectName : slot.subjectName || slot.subjectCode),
              slot.isFree ? null : el("span", { class: "tt-teacher-name" }, slot.teacherName || "Unassigned"),
              !slot.isFree && namedRoomsEnabled && namedTimetableRoom(slot.room) ?
                el("span", { class: "tt-room-tag" }, namedTimetableRoom(slot.room)) : null,
              hasConflict ? el("span", { class: "tt-conflict-tag" }, [icon("warning", "text-xs"), "Collision"]) : null,
            ].filter(Boolean));
            td.append(pill);
          } else {
            td.append(el("button", {
              type: "button",
              class: "tt-cell__empty",
              onClick: () => edit(day, period, cohort),
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
    renderUnselectedTimetable(classGridMount, "class");
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
      renderUnselectedTimetable(gridMount, "class");
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
        class: "btn btn--ghost btn--sm",
        title: "Share this class timetable via direct public link, WhatsApp, or offline file (No login needed)",
        onClick: async () => {
          if (!classSelection.grade) return toast("Select a class first.", "error");
          const allSlots = await getMasterTimetable();
          const cohortSlots = allSlots.filter((s) => s.grade === classSelection.grade && (s.stream || "") === (classSelection.stream || ""));
          openShareTimetableModal({
            type: "class",
            targetId: `${classSelection.grade}|${classSelection.stream || ""}`,
            title: `Class Schedule · ${classSelection.grade} ${classSelection.stream || ""}`.trim(),
            subTitle: "Weekly class schedule",
            slots: cohortSlots,
            periods,
            profile,
            schoolSettings,
            teachers,
          });
        },
      }, [icon("share", "text-xs"), "Share Link"]),

      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        title: "Download official A4 landscape PDF schedule for this class",
        onClick: (e) => downloadSingleClassPdf(e.currentTarget, classSelection.grade, classSelection.stream),
      }, [icon("download", "text-xs"), "Download Class PDF"]),

      canManage ? el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm hide-on-mobile",
        title: "Download all class cohort schedules in a single ZIP archive",
        onClick: (e) => downloadAllClassesZip(e.currentTarget),
      }, [icon("archive", "text-xs"), "Download All Classes (ZIP)"]) : null,

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
  const target = { ...classSelection };
  if (!target.grade) {
    renderUnselectedTimetable(gridMount, "class");
    return;
  }
  gridMount.replaceChildren(skeleton("", "95%"));
  const slots = await getMasterTimetable();
  if (target.grade !== classSelection.grade || target.stream !== classSelection.stream) return;
  const grid = scheduleGrid("class", slots, { target });
  gridMount.replaceChildren(renderTimetableChart(grid, scheduleLetterhead("class", target), {
    onEdit: CAN_MANAGE.includes(profile.role) ? (day, period) =>
      openAssignModal(profile, day, period, target, () => loadClassGrid(profile, gridMount)) : undefined,
  }));
}


// ------------------------------------------------------- Teacher Schedules --

async function renderTeacherTab(container, profile) {
  container.innerHTML = "";
  const teacherCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  const teacherGridMount = el("div", { style: "margin-top:16px;" });
  container.append(teacherCard, teacherGridMount);
  await renderTeacherPicker(teacherCard, profile, teacherGridMount);
  if (!teacherSelection.teacherId) {
    renderUnselectedTimetable(teacherGridMount, "teacher");
  }
}

async function renderTeacherPicker(container, profile, gridMount) {
  container.innerHTML = "";

  const canPickAny = CAN_SEE_ALL_TEACHERS.includes(profile.role);
  if (canPickAny) {
    if (!teachers.some(({ id }) => id === teacherSelection.teacherId)) teacherSelection.teacherId = "";
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
        renderUnselectedTimetable(gridMount, "teacher");
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
          class: "btn btn--ghost btn--sm",
          title: "Share this teacher's timetable via direct public link, WhatsApp, or offline file (No login needed)",
          onClick: async () => {
            if (!teacherSelection.teacherId) return toast("Select a faculty member first.", "error");
            const t = teachers.find((x) => x.id === teacherSelection.teacherId);
            const allSlots = await getMasterTimetable();
            const tSlots = allSlots.filter((s) => s.teacherId === teacherSelection.teacherId);
            openShareTimetableModal({
              type: "teacher",
              targetId: teacherSelection.teacherId,
              title: `Faculty Schedule · ${t?.fullName || "Teacher"}`,
              subTitle: `Teaching Load: ${tSlots.length} Lessons/Wk · TSC: ${t?.tscNumber || "N/A"}`,
              slots: tSlots,
              periods,
              profile,
              schoolSettings,
              teachers,
            });
          },
        }, [icon("share", "text-xs"), "Share Link"]),

        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          title: "Download official A4 landscape PDF schedule for this teacher",
          onClick: (e) => downloadSingleTeacherPdf(e.currentTarget, teacherSelection.teacherId),
        }, [icon("download", "text-xs"), "Download Teacher PDF"]),

        CAN_MANAGE.includes(profile.role) ? el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm hide-on-mobile",
          title: "Download all faculty schedules in a single ZIP archive",
          onClick: (e) => downloadAllTeachersZip(e.currentTarget),
        }, [icon("archive", "text-xs"), "Download All Teachers (ZIP)"]) : null,
      ].filter(Boolean)),
    ]);

    updateTeacherMeta();
    container.append(headerRow, teacherMetaMount);
    if (teacherSelection.teacherId) await loadTeacherGrid(gridMount);
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
    teachers = [own];
    teacherSelection.teacherId = own.id;
    container.append(el("div", {
      style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"
    }, [
      el("div", {}, [
        el("h3", { style: "margin:0 0 2px; color:var(--color-primary-900); font-family:var(--font-display);" }, `Teaching Schedule · ${own.fullName}`),
        el("p", { class: "text-muted text-xs", style: "margin:0;" }, "Weekly lessons and free periods."),
      ]),
      el("div", { style: "display:flex; gap:8px;" }, [
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          title: "Download your personalized A4 landscape PDF schedule",
          onClick: (e) => downloadSingleTeacherPdf(e.currentTarget, own.id),
        }, [icon("download", "text-xs"), "Download My Timetable PDF"]),

        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Get your personal secure timetable link to save on your phone (No login needed)",
          onClick: async () => {
            const allSlots = await getMasterTimetable();
            const tSlots = allSlots.filter((s) => s.teacherId === own.id);
            openShareTimetableModal({
              type: "teacher",
              targetId: own.id,
              title: `My Teaching Schedule · ${own.fullName}`,
              subTitle: `Personal weekly instructional schedule (${tSlots.length} Lessons/Wk)`,
              slots: tSlots,
              periods,
              profile,
              schoolSettings,
              teachers,
            });
          },
        }, [icon("smartphone", "text-xs"), "Save to Phone / Share Link"]),
      ]),
    ]));
    await loadTeacherGrid(gridMount);
  }
}

async function loadTeacherGrid(gridMount) {
  const teacherId = teacherSelection.teacherId;
  if (!teacherId) {
    renderUnselectedTimetable(gridMount, "teacher");
    return;
  }
  gridMount.replaceChildren(skeleton("", "95%"));
  const slots = await getMasterTimetable();
  if (teacherId !== teacherSelection.teacherId) return;
  const target = teachers.find(({ id }) => id === teacherId) || { id: teacherId };
  const grid = scheduleGrid("teacher", slots, { target });
  gridMount.replaceChildren(renderTimetableChart(grid, scheduleLetterhead("teacher", target)));
}


// ----------------------------------------------------------- Slot Assignment --

export const STANDARD_ACTIVITIES = [
  { code: "PE", name: "Physical Education & Sports", icon: "sports_soccer" },
  { code: "PPI", name: "Pastoral Programme of Instruction (PPI)", icon: "church" },
  { code: "CLUBS", name: "Clubs & Societies", icon: "groups" },
  { code: "GAMES", name: "Games & Outdoor Activities", icon: "sports_volleyball" },
  { code: "LIFESKILLS", name: "Guidance & Counselling / Life Skills", icon: "psychology" },
  { code: "LIB", name: "Library & Quiet Reading", icon: "local_library" },
  { code: "ASSM", name: "School Assembly & Devotion", icon: "flag" },
  { code: "CUSTOM", name: "Other Custom Activity...", icon: "edit_note" },
];

async function openAssignModal(profile, day, period, cohort, onSaved) {
  if (!CAN_MANAGE.includes(profile.role)) return;
  const { grade: cohortGrade, stream: cohortStream = "" } = cohort;
  let slots;
  try {
    [slots, teachers] = await Promise.all([getClassTimetable(cohortGrade, cohortStream), listTeachers()]);
  } catch (error) {
    toast(error.message || "Could not open the selected period.", "error");
    return;
  }
  const getCohortSlot = (periodId) => slots[day + "_" + periodId];
  const existing = getCohortSlot(period.id);
  const currentIndex = periods.findIndex((item) => item.id === period.id);
  const prevPeriod = periods[currentIndex - 1];
  const nextPeriod = periods[currentIndex + 1];
  const prevSlot = prevPeriod && getCohortSlot(prevPeriod.id);
  const nextSlot = nextPeriod && getCohortSlot(nextPeriod.id);
  const roomOptions = { useNamedRooms: namedRoomsEnabled };
  const isSecondHalfOfDouble = canMergeLessons(prevSlot, existing, prevPeriod, period, roomOptions);
  const isFirstHalfOfDouble = canMergeLessons(existing, nextSlot, period, nextPeriod, roomOptions);
  const canDoubleForward = areAdjacentTeachingPeriods(period, nextPeriod) && !nextSlot?.isFree;

  // Determine Initial Mode (Subject vs Activity)
  let currentMode = existing?.isFree ? "free" : "subject";
  let initialActivityPreset = "PE";
  let initialCustomActivity = "";

  if (existing && !existing.isFree) {
    const isPreset = STANDARD_ACTIVITIES.some((a) => a.code === existing.subjectCode);
    const isSubject = subjects.some((s) => s.code === existing.subjectCode);
    if (existing.isActivity || isPreset || (!isSubject && existing.subjectCode)) {
      currentMode = "activity";
      if (isPreset) {
        initialActivityPreset = existing.subjectCode;
      } else {
        initialActivityPreset = "CUSTOM";
        initialCustomActivity = existing.subjectName || existing.subjectCode || "";
      }
    }
  }

  const body = el("form", {});

  // Callout header
  body.append(
    el("div", { class: "callout callout--info", style: "margin-bottom:12px; padding:10px 14px; font-size:12.5px; display:flex; align-items:center; justify-content:space-between; gap:10px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("schedule", "text-sm", "style: color:var(--color-primary-800);"),
        el("div", {}, [
          el("strong", {}, `${cohortGrade}${cohortStream ? " " + cohortStream : ""}`),
          el("span", { style: "color:var(--color-ink-soft); margin-left:6px;" }, `· ${day} · ${period.name} (${period.startTime}–${period.endTime})`),
        ]),
      ]),
      existing ? el("span", { class: "badge badge--outline", style: "font-size:10.5px;" }, "Active Slot") : null,
    ])
  );

  // If this slot is the second half of an active double lesson
  if (isSecondHalfOfDouble) {
    body.append(
      el("div", {
        class: "callout callout--warning",
        style: "margin-bottom:12px; padding:8px 12px; font-size:11.5px; display:flex; align-items:flex-start; gap:8px;"
      }, [
        icon("link", "text-xs", "style: margin-top:2px; flex-shrink:0;"),
        el("div", {}, [
          `This slot is currently the second period of a `,
          el("strong", {}, `Double Lesson with ${prevPeriod.name} (${prevPeriod.startTime}–${prevPeriod.endTime})`),
          `. Editing or clearing this slot will unlink or update it.`,
        ]),
      ])
    );
  }

  // Segmented Mode Switcher
  const modes = [
    ["subject", "Lesson", "school"],
    ["activity", "Activity", "sports_soccer"],
    ["free", FREE_PERIOD.subjectName, "event_available"],
  ];
  const modeButtons = new Map(modes.map(([mode, label, symbol]) => [mode, el("button", {
    type: "button",
    onClick: () => setMode(mode),
  }, [icon(symbol, "text-xs"), label])]));
  body.append(el("div", { class: "tt-slot-modes", role: "group", "aria-label": "Slot type" }, [...modeButtons.values()]));

  // --- Subject Mode Fields ---
  const subjectContainer = el("div");

  const subjectSelect = el("select", {}, [
    el("option", { value: "" }, "Select academic subject"),
    ...subjects.map((s) => el("option", { value: s.code, ...(s.code === existing?.subjectCode ? { selected: "true" } : {}) }, s.name)),
  ]);

  const teacherSelect = el("select", {}, [el("option", { value: "" }, "Select teacher (optional)")]);
  const roomInput = namedRoomsEnabled ? el("input", {
    id: "tt-lesson-room", type: "text", value: namedTimetableRoom(currentMode === "subject" ? existing?.room : ""),
    placeholder: "Leave blank for the usual classroom",
  }) : null;

  function refreshTeachers(event) {
    const code = subjectSelect.value;
    const currentVal = !event && currentMode === "subject" ? existing?.teacherId : "";
    teacherSelect.innerHTML = "";
    teacherSelect.append(el("option", { value: "" }, "Select teacher (optional)"));

    const classAssigned = getAssignedClassSubjectTeacher(teachers, cohortGrade, cohortStream, code);
    const qualified = teachers.filter((t) => code && (t.teachingAssignments || []).some(a => a.subjectCode === code));
    const others = teachers.filter((t) => !code || !(t.teachingAssignments || []).some(a => a.subjectCode === code));

    if (classAssigned) {
      const groupClass = el("optgroup", { label: `★ Assigned for ${cohortGrade}${cohortStream ? " " + cohortStream : ""}` });
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

    if (currentVal && [...teacherSelect.options].some(({ value }) => value === currentVal)) teacherSelect.value = currentVal;
  }

  refreshTeachers();
  subjectSelect.addEventListener("change", refreshTeachers);

  subjectContainer.append(
    el("div", { class: "field" }, [el("label", {}, "Subject"), subjectSelect]),
    el("div", { class: "field" }, [el("label", {}, "Teacher"), teacherSelect])
  );
  if (roomInput) subjectContainer.append(el("div", { class: "field" }, [
    el("label", { for: roomInput.id }, "Named room (optional)"), roomInput,
  ]));
  body.append(subjectContainer);

  // --- Activity Mode Fields ---
  const activityContainer = el("div");

  const activityPresetSelect = el("select", {}, [
    ...STANDARD_ACTIVITIES.map((act) => el("option", {
      value: act.code,
      ...(act.code === initialActivityPreset ? { selected: "true" } : {})
    }, `${act.name} (${act.code})`)),
  ]);

  const customActivityInput = el("input", {
    type: "text",
    value: initialCustomActivity,
    placeholder: "e.g. Choir Practice, Scouts, Debate Club...",
    style: "font-size:13px;"
  });
  const customActivityWrap = el("div", {
    class: "field",
    style: initialActivityPreset === "CUSTOM" ? "display:block;" : "display:none;"
  }, [
    el("label", {}, "Custom Activity Name"),
    customActivityInput
  ]);

  const activityTeacherSelect = el("select", {}, [
    el("option", { value: "" }, "No specific supervisor / Shared supervision"),
    ...teachers.map((t) => el("option", {
      value: t.id,
      ...(t.id === (currentMode === "activity" ? existing?.teacherId : "") ? { selected: "true" } : {})
    }, `${t.fullName} (Patron / Facilitator)`))
  ]);

  const activityRoomInput = namedRoomsEnabled ? el("input", {
    id: "tt-activity-venue", type: "text",
    value: namedTimetableRoom(currentMode === "activity" ? existing?.room : ""),
    placeholder: "e.g. Sports Field or School Library",
  }) : null;

  activityPresetSelect.addEventListener("change", () => {
    const val = activityPresetSelect.value;
    if (val === "CUSTOM") {
      customActivityWrap.style.display = "block";
      customActivityInput.focus();
    } else {
      customActivityWrap.style.display = "none";
    }
  });

  activityContainer.append(
    el("div", { class: "field" }, [el("label", {}, "Activity / Co-Curricular Program"), activityPresetSelect]),
    customActivityWrap,
    el("div", { class: "field" }, [el("label", {}, "Patron / Supervising Teacher (optional)"), activityTeacherSelect])
  );
  if (activityRoomInput) {
    activityContainer.append(el("div", { class: "field" }, [
      el("label", { for: activityRoomInput.id }, "Venue (optional)"), activityRoomInput,
    ]));
  }
  const freeDescription = el("p", { class: "text-muted text-sm" },
    "This class has no lesson during this period. The generator keeps it free.");
  const doubleControls = el("div");
  body.append(activityContainer, freeDescription, doubleControls);

  // --- Double Lesson Toggle Container ---
  let doubleCheckbox = null;
  if (canDoubleForward) {
    doubleCheckbox = el("input", {
      type: "checkbox",
      id: "tt-double-lesson-check",
      ...(isFirstHalfOfDouble ? { checked: "true" } : {}),
      style: "width:16px; height:16px; margin-top:2px; cursor:pointer;"
    });

    const doubleBox = el("div", {
      class: "tt-double-box",
      style: "background:var(--color-cream-dim, #f8fafc); border:1px solid var(--color-line); border-radius:var(--radius-md); padding:10px 14px; margin:14px 0;"
    }, [
      el("label", {
        style: "display:flex; align-items:flex-start; gap:10px; cursor:pointer; margin:0;"
      }, [
        doubleCheckbox,
        el("div", {}, [
          el("div", { style: "font-weight:700; color:var(--color-primary-900); font-size:12.5px; display:flex; align-items:center; gap:6px;" }, [
            icon("view_column", "text-xs"),
            `Assign as Double Lesson (${period.name} & ${nextPeriod.name})`,
          ]),
          el("div", { style: "font-size:11.5px; color:var(--color-ink-soft); margin-top:2px; line-height:1.4;" },
            `Combines both periods into one block (${period.startTime}–${nextPeriod.endTime}). ` +
              `Checks teacher${namedRoomsEnabled ? " and room" : ""} availability across both periods.`
          ),
          el("div", { style: "font-size:11px; color:var(--color-ink-soft); margin-top:3px;" },
            "💡 Kenya CBC standard: Double lessons are reserved for practical sciences & arts (Integrated Science, Agriculture, Pre-Technical, Creative Arts). Theory subjects (Maths, English, Kiswahili) are standard single sessions."
          ),
          nextSlot && !isFirstHalfOfDouble ? el("div", {
            style: "color:var(--color-amber-800, #b45309); font-size:11px; margin-top:4px; font-weight:600;"
          }, `⚠️ Note: ${nextPeriod.name} currently has "${nextSlot.subjectName || nextSlot.subjectCode}" assigned, which will be overwritten.`) : null,
        ].filter(Boolean)),
      ]),
    ]);
    doubleControls.append(doubleBox);
  } else if (nextSlot?.isFree) {
    doubleControls.append(el("p", { class: "text-muted text-sm" }, "The next period is marked free."));
  } else if (nextPeriod) {
    doubleControls.append(el("div", {
      style: "background:var(--color-cream-dim, #f8fafc); border:1px solid var(--color-line); border-radius:var(--radius-md); padding:8px 12px; margin:12px 0; font-size:11.5px; color:var(--color-ink-soft); display:flex; align-items:center; gap:8px;"
    }, [
      icon("coffee", "text-xs"),
      el("span", {}, `Next period: ${nextPeriod.name} (${nextPeriod.startTime}–${nextPeriod.endTime}). Double lessons require consecutive teaching periods.`),
    ]));
  } else {
    doubleControls.append(el("div", {
      style: "background:var(--color-cream-dim, #f8fafc); border:1px solid var(--color-line); border-radius:var(--radius-md); padding:8px 12px; margin:12px 0; font-size:11.5px; color:var(--color-ink-soft); display:flex; align-items:center; gap:8px;"
    }, [
      icon("info", "text-xs"),
      el("span", {}, "Final period of the day · Single lesson slot."),
    ]));
  }

  const submitLabel = el("span");
  body.append(
    el("button", {
      type: "submit",
      class: "btn btn--primary btn--block",
      style: "margin-top:6px;"
    }, [
      icon(existing ? "save" : "add_task"),
      submitLabel,
    ])
  );
  function setMode(mode) {
    currentMode = mode;
    for (const [value, button] of modeButtons) {
      button.className = `btn btn--sm ${value === mode ? "btn--primary" : "btn--ghost"}`;
      button.setAttribute("aria-pressed", String(value === mode));
    }
    subjectContainer.hidden = mode !== "subject";
    activityContainer.hidden = mode !== "activity";
    freeDescription.hidden = mode !== "free";
    doubleControls.hidden = mode === "free";
    submitLabel.textContent = mode === "free" ? "Mark as free" : existing ? "Save Changes" : "Assign Slot";
  }
  setMode(currentMode);

  const close = openModal(existing ? "Edit Timetable Slot" : "Assign Timetable Slot", body);

  // Clear Slot Actions
  if (existing) {
    const clearActionsWrap = el("div", { style: "margin-top:12px; display:flex; flex-direction:column; gap:6px;" });

    if (isFirstHalfOfDouble) {
      clearActionsWrap.append(
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--block",
          style: "color:var(--color-red); font-size:12px;",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Clearing double lesson…");
            try {
              await clearDoubleSlot(profile.uid, cohortGrade, cohortStream, day, period.id, nextPeriod.id);
              toast(`Double lesson cleared (${period.name} & ${nextPeriod.name}).`, "success");
              close();
              await onSaved();
            } catch (err) {
              toast(err.message || "Could not clear double lesson.", "error");
              restore();
            }
          },
        }, [icon("delete_sweep", "text-xs"), `Clear Double Lesson (${period.name} & ${nextPeriod.name})`]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--block",
          style: "color:var(--color-ink-soft); font-size:11.5px;",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Clearing…");
            try {
              await clearSlot(profile.uid, cohortGrade, cohortStream, day, period.id);
              toast(`Cleared ${period.name} only.`, "success");
              close();
              await onSaved();
            } catch (err) {
              toast(err.message || "Could not clear slot.", "error");
              restore();
            }
          },
        }, [icon("backspace", "text-xs"), `Clear ${period.name} only`])
      );
    } else if (isSecondHalfOfDouble) {
      clearActionsWrap.append(
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--block",
          style: "color:var(--color-red); font-size:12px;",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Clearing…");
            try {
              await clearSlot(profile.uid, cohortGrade, cohortStream, day, period.id);
              toast(`Cleared ${period.name}.`, "success");
              close();
              await onSaved();
            } catch (err) {
              toast(err.message || "Could not clear slot.", "error");
              restore();
            }
          },
        }, [icon("backspace", "text-xs"), `Clear this slot (${period.name})`]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--block",
          style: "color:var(--color-red); font-size:11.5px;",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Clearing full double lesson…");
            try {
              await clearDoubleSlot(profile.uid, cohortGrade, cohortStream, day, prevPeriod.id, period.id);
              toast(`Double lesson cleared (${prevPeriod.name} & ${period.name}).`, "success");
              close();
              await onSaved();
            } catch (err) {
              toast(err.message || "Could not clear double lesson.", "error");
              restore();
            }
          },
        }, [icon("delete_sweep", "text-xs"), `Clear Full Double Lesson (${prevPeriod.name} & ${period.name})`])
      );
    } else {
      clearActionsWrap.append(
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--block",
          style: "color:var(--color-red); font-size:12px;",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Clearing…");
            try {
              await clearSlot(profile.uid, cohortGrade, cohortStream, day, period.id);
              toast("Slot cleared.", "success");
              close();
              await onSaved();
            } catch (err) {
              toast(err.message || "Could not clear slot.", "error");
              restore();
            }
          },
        }, [icon("backspace", "text-xs"), "Clear this slot"])
      );
    }

    body.append(clearActionsWrap);
  }

  // Form submission handler
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");

    let subjectCode = "";
    let subjectName = "";
    let teacherId = "";
    let teacherName = "";
    let room = "";
    let isActivity = false;
    let activityType = "";

    if (currentMode === "subject") {
      const subj = subjects.find((s) => s.code === subjectSelect.value);
      if (!subj) {
        restore();
        return toast("Please select an academic subject.", "error");
      }
      subjectCode = subj.code;
      subjectName = subj.name;
      const t = teachers.find((x) => x.id === teacherSelect.value);
      teacherId = t?.id || "";
      teacherName = t?.fullName || "";
      room = roomInput?.value.trim() || "";
      isActivity = false;
      activityType = "";
    } else if (currentMode === "activity") {
      const presetCode = activityPresetSelect.value;
      if (presetCode === "CUSTOM") {
        const customName = customActivityInput.value.trim();
        if (!customName) {
          restore();
          return toast("Please enter a custom activity name.", "error");
        }
        subjectCode = customName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ACT";
        subjectName = customName;
        activityType = "custom";
      } else {
        const preset = STANDARD_ACTIVITIES.find((a) => a.code === presetCode);
        subjectCode = preset.code;
        subjectName = preset.name;
        activityType = preset.code.toLowerCase();
      }
      const t = teachers.find((x) => x.id === activityTeacherSelect.value);
      teacherId = t?.id || "";
      teacherName = t?.fullName || "";
      room = activityRoomInput?.value.trim() || "";
      isActivity = true;
    }

    const isDoubleChecked = canDoubleForward && doubleCheckbox && doubleCheckbox.checked;

    try {
      if (currentMode === "free") {
        await markSlotFree(profile.uid, { grade: cohortGrade, stream: cohortStream, day, periodId: period.id });
        toast("Period marked free.", "success");
      } else if (isDoubleChecked) {
        await assignDoubleSlot(profile.uid, {
          grade: cohortGrade,
          stream: cohortStream,
          day,
          period1Id: period.id,
          period2Id: nextPeriod.id,
          subjectCode,
          subjectName,
          teacherId,
          teacherName,
          room,
          isActivity,
          activityType,
        });
        toast(`Double lesson saved (${period.name} & ${nextPeriod.name}).`, "success");
      } else {
        await assignSlot(profile.uid, {
          grade: cohortGrade,
          stream: cohortStream,
          day,
          periodId: period.id,
          subjectCode,
          subjectName,
          teacherId,
          teacherName,
          room,
          isActivity,
          activityType,
        }, { removePeriodIds: isFirstHalfOfDouble ? [nextPeriod.id] : [] });
        toast("Timetable slot saved.", "success");
      }

      close();
      await onSaved();
    } catch (err) {
      toast(err.message || "Could not save slot - check for a conflict.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------- Auto-Generate Modal --

async function openAutoGenerateModal(profile, onComplete) {
  const cohorts = getAllCohorts();
  let bell = periods;
  let teaching = bell.filter((period) => !isBreakPeriod(period));
  if (!cohorts.length || !subjects.length || !teaching.length) {
    return toast("Add classes, subjects, and teaching periods before generating a timetable.", "error");
  }

  const body = el("div", { class: "tt-plan-content" }, el("p", { role: "status" }, "Loading lesson plan…"));
  const close = openModal("Generate master timetable", body, "tt-plan-modal");
  body.parentElement.setAttribute("role", "dialog");
  body.parentElement.setAttribute("aria-modal", "true");
  body.parentElement.setAttribute("aria-label", "Generate master timetable");
  let base;
  try {
    [base, bell] = await Promise.all([loadTimetableDraftInputs(), listPeriods(true)]);
    teaching = bell.filter((period) => !isBreakPeriod(period));
  } catch (error) {
    body.replaceChildren(el("p", { role: "alert" }, error.message || "Could not load timetable inputs."));
    return;
  }

  const useNamedRooms = base.useNamedRooms === true;
  const capacity = teaching.length * DAYS.length;
  const canDouble = bell.some((period, index) => areAdjacentTeachingPeriods(period, bell[index + 1]));
  const teachingIds = new Set(teaching.map(({ id }) => id));
  const savedReservations = base.slots.filter((slot) => (slot.isFree || slot.isActivity) && DAYS.includes(slot.day) &&
    teachingIds.has(slot.periodId) && cohorts.some(({ grade, stream }) =>
      slot.grade === grade && (slot.stream || "") === stream));
  const freeSlots = savedReservations.filter((slot) => slot.isFree);
  const activities = savedReservations.filter((slot) => !slot.isFree);
  const reservations = cohorts.map(({ grade, stream }) => {
    const slots = savedReservations.filter((slot) => slot.grade === grade && (slot.stream || "") === stream);
    const free = slots.filter((slot) => slot.isFree).length;
    return { free, activity: slots.length - free };
  });
  const preserve = el("input", { type: "checkbox", checked: activities.length ? "true" : undefined });
  const overrides = new Map();
  let scope = "";
  const countReserved = ({ free, activity }) => free + (preserve.checked ? activity : 0);
  const reserved = () => scope ? countReserved(reservations[Number(scope)]) :
    Math.max(0, ...reservations.filter((_, index) => !overrides.has(String(index))).map(countReserved));
  const maxLessons = () => Math.max(0, capacity - reserved());
  const defaultPlan = () => defaultTimetablePlan(subjects, DAYS.length, maxLessons());
  const mergePlan = (entries, fallback) => {
    const bySubject = new Map((entries || []).map((item) => [item.code, item]));
    return fallback.map((item) => bySubject.get(item.code) || item);
  };
  let schoolPlan = mergePlan(base.plan, defaultPlan());
  for (const [index, { grade, stream }] of cohorts.entries()) {
    const saved = base.cohortPlans?.find((item) => item.grade === grade && (item.stream || "") === stream);
    if (saved) overrides.set(String(index), mergePlan(saved.plan, schoolPlan));
  }
  const allocationTotal = el("strong");
  const allocationHint = el("small");
  const allocationStatus = el("div", { class: "tt-plan-allocation", role: "status" }, [allocationTotal, allocationHint]);
  const scopeHint = el("p", { class: "tt-plan-scope-hint", id: "tt-plan-scope-hint" });
  const error = el("p", { class: "tt-plan-error", role: "alert" });
  const rows = subjects.map((subject, index) => {
    const initial = schoolPlan[index];
    const allowed = isDoubleEligibleSubject(subject.code) && canDouble;
    const count = el("input", {
      type: "number", min: "0", max: String(DAYS.length + Number(allowed)), step: "1",
      required: "true", value: initial.count, "aria-label": `Weekly periods for ${subject.name}`,
      inputmode: "numeric",
    });
    const pair = el("input", {
      type: "checkbox", "aria-label": `Double lesson for ${subject.name}`,
      disabled: allowed ? undefined : "true", checked: allowed && initial.double ? "true" : undefined,
    });
    const room = el("input", {
      type: "text", value: namedTimetableRoom(initial.room), "aria-label": `Room for ${subject.name}`,
      placeholder: "Optional", title: "Leave blank for the usual classroom",
    });
    return { subject, count, pair, room, allowed };
  });
  const readPlan = () => rows.map(({ subject, count, pair, room }) =>
    ({ code: subject.code, count: Number(count.value), double: pair.checked && !pair.disabled, room: room.value.trim() }));
  const differsFromSchoolPlan = (plan) => JSON.stringify(plan) !== JSON.stringify(schoolPlan);
  function writePlan(plan) {
    rows.forEach(({ count, pair, room, allowed }, index) => {
      count.value = String(plan[index].count);
      pair.checked = allowed && plan[index].double;
      room.value = namedTimetableRoom(plan[index].room);
    });
    updateAllocationStatus();
  }
  function rememberPlan() {
    const plan = readPlan();
    if (!scope) schoolPlan = plan;
    else if (differsFromSchoolPlan(plan)) overrides.set(scope, plan);
    else overrides.delete(scope);
  }
  const useSchoolPlan = el("button", {
    type: "button", class: "btn btn--ghost btn--sm", hidden: "true", onClick: () => {
      overrides.delete(scope);
      writePlan(schoolPlan);
    },
  }, "Reset to school-wide plan");
  const scopeSelect = el("select", {
    id: "tt-plan-scope", "aria-describedby": scopeHint.id,
    onChange: (event) => {
      rememberPlan();
      scope = event.currentTarget.value;
      writePlan(overrides.get(scope) || schoolPlan);
    },
  }, [
    el("option", { value: "" }, "All classes (default)"),
    ...cohorts.map((cohort, index) => el("option", { value: index }, cohort.label)),
  ]);
  function updateAllocationStatus() {
    for (const { allowed, pair, count } of rows) {
      pair.disabled = !allowed || Number(count.value) < 2;
      count.max = String(DAYS.length + Number(!pair.disabled && pair.checked));
    }
    const plan = readPlan();
    const requested = plan.reduce((sum, { count }) => sum + count, 0);
    const available = maxLessons();
    const remaining = available - requested;
    const hasOverride = !!scope && differsFromSchoolPlan(plan);
    useSchoolPlan.hidden = !hasOverride;
    scopeHint.textContent = scope
      ? (hasOverride ? "This class has its own plan." : "Change a value to set a plan for this class.")
      : "This plan applies to classes without their own plan.";
    allocationTotal.textContent = `${requested} of ${available} weekly periods planned${scope ? "" : " per class"}`;
    allocationHint.textContent = remaining < 0
      ? `Reduce the plan by ${-remaining} ${remaining === -1 ? "period" : "periods"}.`
      : remaining > 0
        ? `${remaining} ${remaining === 1 ? "period remains" : "periods remain"} open.`
        : (reserved() ? "Available periods exclude reserved slots." : "");
    allocationStatus.toggleAttribute("data-over-capacity", remaining < 0);
  }

  const previewButton = el("button", { type: "submit", class: "btn btn--primary" }, ["Preview timetable", icon("arrow_forward", "text-sm")]);
  const form = el("form", { class: "tt-plan-form", onInput: updateAllocationStatus }, [
    el("div", { class: "tt-plan-controls" }, [
      el("div", { class: "tt-plan-scope" }, [
        el("label", { for: scopeSelect.id }, "Apply plan to"),
        scopeSelect,
        scopeHint,
      ]),
      el("div", { class: "tt-plan-tools" }, [
        useSchoolPlan,
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => {
          const suggested = defaultPlan();
          rows.forEach(({ count, pair, allowed }, index) => {
            count.value = String(suggested[index].count);
            pair.checked = allowed && suggested[index].double;
          });
          updateAllocationStatus();
        } }, "Use suggested counts"),
      ]),
    ]),
    el("p", { class: "tt-plan-help" }, [
      icon("info", "text-sm"),
      el("span", {}, ["A ", el("strong", {}, "double lesson"), " uses two periods back to back. ",
        "Five weekly periods with a double means one pair and three singles. Enter 0 to skip a subject."]),
    ]),
    el("div", { class: "tt-plan-scroll", tabindex: "0", role: "region", "aria-label": "Weekly lesson allocations" },
      el("table", { class: `tt-plan-table${useNamedRooms ? " tt-plan-table--rooms" : ""}` }, [
        el("thead", {}, el("tr", {}, ["Subject", "Periods per week", "Double lesson", ...(useNamedRooms ? ["Room"] : [])].map((name) =>
          el("th", { scope: "col" }, name)))),
        el("tbody", {}, rows.map(({ subject, count, pair, room, allowed }) => el("tr", {}, [
          el("th", { scope: "row" }, subject.name),
          el("td", {}, count),
          el("td", allowed ? {} : {
            class: "tt-plan-single", title: "Single periods only", "aria-label": "Single periods only",
          }, allowed ? pair : "—"),
          useNamedRooms ? el("td", {}, room) : null,
        ]))),
      ])),
    activities.length ? el("label", { class: "tt-plan-preserve" }, [preserve, `Keep ${activities.length} saved activity periods`]) : null,
    freeSlots.length ? el("p", { class: "text-muted text-xs", style: "margin:0;" },
      `The draft keeps ${freeSlots.length} marked free ${freeSlots.length === 1 ? "period" : "periods"}.`) : null,
    error,
    el("div", { class: "tt-plan-footer" }, [allocationStatus, previewButton]),
  ]);
  body.replaceChildren(form);
  updateAllocationStatus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const restore = busyButton(previewButton, "Building draft…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      rememberPlan();
      const cohortPlans = [...overrides].map(([index, plan]) => ({ ...cohorts[Number(index)], plan }));
      const draft = createTimetableDraft({
        cohorts, periods: bell, instructionalPeriods: teaching, subjects, teachers, plan: schoolPlan, cohortPlans,
        lockedSlots: preserve.checked ? savedReservations : freeSlots, useNamedRooms,
      });
      const conflicts = detectTimetableConflicts(draft.slots, { useNamedRooms });
      const previewError = el("p", { class: "tt-plan-error", role: "alert" });
      const back = el("button", { type: "button", class: "btn btn--ghost", onClick: () => {
        body.replaceChildren(form);
        previewButton.focus();
      } }, "Edit lesson plan");
      const save = el("button", { type: "button", class: "btn btn--primary",
        disabled: conflicts.length || !draft.slots.length ? "true" : undefined,
        onClick: async () => {
          const restoreSave = busyButton(save, "Saving timetable…");
          back.disabled = true;
          previewError.textContent = "";
          try {
            const currentBell = await listPeriods(true);
            const signature = (items) => JSON.stringify(items.map(({ id, name, startTime, endTime, isBreak }) =>
              [id, name, startTime, endTime, isBreak]));
            if (signature(currentBell) !== signature(bell)) {
              throw new Error("The bell schedule changed. Reopen the generator to create a new preview.");
            }
            await publishTimetableDraft(profile.uid, draft, base);
          } catch (saveError) {
            previewError.textContent = saveError.message || "Could not save timetable.";
            back.disabled = false;
            restoreSave();
            return;
          }
          periods = bell;
          namedRoomsEnabled = useNamedRooms;
          close();
          toast("Master timetable saved.", "success");
          await onComplete();
        },
      }, base.slots.length ? "Replace saved timetable" : "Save timetable");
      const issues = draft.issues.map((issue) => {
        const detail = [
          issue.unscheduled ? `${issue.unscheduled} unscheduled` : "",
          issue.unscheduled && issue.roomOverCapacity ? `${issue.roomOverCapacity} has more lessons requested than available periods` : "",
          issue.unassigned ? `${issue.unassigned} need a teacher (${issue.hasTeacher ? "assigned staff at capacity or unavailable" : "no faculty assignment"})` : "",
          issue.missingDouble ? "double lesson could not be placed" : "",
        ].filter(Boolean);
        return el("li", {}, `${issue.grade} ${issue.stream || ""} · ${issue.subject} — ${detail.join(", ")}`);
      });
      const grid = scheduleGrid("master", draft.slots, { cohorts, bell, useNamedRooms });
      const letterhead = timetableLetterhead(schoolSettings, { title: "Draft master timetable" });
      const download = el("button", {
        type: "button", class: "btn btn--ghost",
        disabled: draft.slots.length ? undefined : "true",
        onClick: async (event) => {
          const restorePdf = busyButton(event.currentTarget, "Preparing PDF…");
          previewError.textContent = "";
          try {
            const pdf = await renderTimetablePdf(grid, letterhead, { format: masterPaperSize });
            triggerBlobDownload(pdf, "Draft_Master_Timetable.pdf");
          } catch (pdfError) {
            console.error("Draft timetable PDF export failed:", pdfError);
            previewError.textContent = "Could not download the draft PDF.";
          } finally {
            restorePdf();
          }
        },
      }, "Download draft PDF");
      body.replaceChildren(el("div", { class: "tt-plan-review" }, [
        el("div", { class: "tt-plan-review-scroll" }, [
          el("p", {},
            `${draft.scheduled} of ${draft.target} requested lessons placed · ${draft.staffed} staffed · ${draft.doubles} double blocks` +
            (draft.keptActivities ? ` · ${draft.keptActivities} activity periods kept` : "") +
            (draft.keptFreePeriods ? ` · ${draft.keptFreePeriods} free periods kept` : "")),
          conflicts.length ? el("ul", { class: "tt-chart-unstaffed" }, conflicts.map(({ message }) => el("li", {}, message))) : null,
          issues.length ? el("details", {}, [
            el("summary", {}, `Review ${issues.length} class and subject allocations`),
            el("ul", {}, issues),
          ]) : null,
          el("div", { class: "tt-draft-chart" }, renderTimetableChart(grid, letterhead)),
        ]),
        previewError,
        el("div", { class: "tt-plan-footer" }, [back, download, save]),
      ]));
      back.focus();
    } catch (draftError) {
      error.textContent = draftError.message || "Could not build the timetable draft.";
    } finally {
      restore();
    }
  });
}


function scheduleGrid(kind, slots, { cohorts, target, days = DAYS, bell = periods, useNamedRooms = namedRoomsEnabled } = {}) {
  const matchesTarget = (slot) => {
    if (kind === "teacher") return slot.teacherId === target.id;
    if (kind === "class") return slot.grade === target.grade && (slot.stream || "") === (target.stream || "");
    return true;
  };
  const keyFor = (day, periodId, { grade, stream }) => JSON.stringify([day, periodId, grade, stream || ""]);
  const filtered = slots.filter(matchesTarget);
  const lookup = new Map(filtered.map((slot) => [
    kind === "master" ? keyFor(slot.day, slot.periodId, slot) : keyFor(slot.day, slot.periodId, {}), slot,
  ]));
  const conflictIds = new Set(detectTimetableConflicts(slots, { useNamedRooms }).flatMap(({ slotIds }) => slotIds));
  return buildTimetableGrid({
    kind, periods: bell, days, cohorts, conflictIds,
    getSlot: (day, periodId, cohort) => lookup.get(keyFor(day, periodId, kind === "master" ? cohort : {})),
    subjectCategory, useNamedRooms,
  });
}

function scheduleLetterhead(kind, target) {
  if (kind === "master") return timetableLetterhead(schoolSettings, { title: "Master timetable" });
  if (kind === "class") {
    const teacher = getClassTeacher(teachers, target.grade, target.stream);
    const className = [target.grade, target.stream].filter(Boolean).join(" ");
    return timetableLetterhead(schoolSettings, {
      title: `${className} class timetable`,
      subtitle: teacher ? `Class teacher · ${teacher.fullName || teacher.name}` : "",
    });
  }
  return timetableLetterhead(schoolSettings, {
    title: "Teacher timetable", subtitle: target.fullName || target.name || "Teacher",
  });
}

function createSchedulePdf(kind, slots, target) {
  const options = kind === "master"
    ? { cohorts: getAllCohorts(), days: masterDayFilter === "All" ? DAYS : [masterDayFilter] }
    : { target };
  const format = kind === "master" ? masterPaperSize : "a4";
  return renderTimetablePdf(scheduleGrid(kind, slots, options), scheduleLetterhead(kind, target), { format });
}

async function downloadTimetablePdf(button, kind, target) {
  if (kind === "master" && !getAllCohorts().length) return toast("Add classes before exporting the master timetable.", "error");
  if (kind === "class" && !target?.grade) return toast("Select a class first.", "error");
  if (kind === "teacher" && !target) return toast("Select a teacher first.", "error");
  const restore = busyButton(button, "Preparing PDF…");
  try {
    const slots = await getMasterTimetable();
    const name = timetableFilename(kind, target);
    triggerBlobDownload(await createSchedulePdf(kind, slots, target), `${name}.pdf`);
    toast("Timetable PDF downloaded.", "success");
  } catch (error) {
    console.error("Timetable PDF export failed:", error);
    toast("Could not generate the timetable PDF.", "error");
  } finally {
    restore();
  }
}

function timetableFilename(kind, target) {
  const year = schoolSettings.currentAcademicYear || new Date().getFullYear();
  if (kind === "master") {
    return ["Master_Timetable", masterDayFilter === "All" ? "" : masterDayFilter, year].filter(Boolean).join("_");
  }
  const label = kind === "class" ? [target.grade, target.stream].filter(Boolean).join(" ") :
    target.fullName || target.name || "Teacher";
  return `${label.replace(/\s+/g, "_")}_Timetable_${year}`;
}

function downloadMasterPdf(button) {
  return downloadTimetablePdf(button, "master");
}

function downloadSingleClassPdf(button, grade, stream) {
  return downloadTimetablePdf(button, "class", { grade, stream });
}

function downloadSingleTeacherPdf(button, teacherId) {
  return downloadTimetablePdf(button, "teacher", teachers.find(({ id }) => id === teacherId));
}

async function downloadTimetableZip(button, kind, targets, filename) {
  if (!targets.length) return toast("There are no timetables to export.", "error");
  const restore = busyButton(button, "Preparing PDFs…");
  try {
    const slots = await getMasterTimetable();
    await downloadPdfsAsZip(targets.map((target) => ({
      filename: `${timetableFilename(kind, target)}.pdf`,
      buildBlob: () => createSchedulePdf(kind, slots, target),
    })), filename, { onProgress: (done, total) => { button.textContent = `Preparing ${done}/${total}…`; } });
    toast(`Downloaded ${targets.length} timetables.`, "success");
  } catch (error) {
    console.error("Timetable ZIP export failed:", error);
    toast("Could not generate the timetable ZIP.", "error");
  } finally {
    restore();
  }
}

function downloadAllClassesZip(button) {
  return downloadTimetableZip(button, "class", getAllCohorts(), "Class_Timetables.zip");
}

function downloadAllTeachersZip(button) {
  return downloadTimetableZip(button, "teacher", teachers, "Teacher_Timetables.zip");
}


// --------------------------------------------------- Workload & Excel Export --

function openFacultyWorkloadModal() {
  const instructionalIds = new Set(periods.filter((period) => !isBreakPeriod(period)).map(({ id }) => id));
  const subjectNamesByCode = new Map(subjects.map(({ code, name }) => [code, name]));
  const assignments = new Map(teachers.map(({ id }) => [id, []]));
  const lightLoadThreshold = 18;
  const heavyLoadThreshold = 27;
  let needsTeacher = 0;
  let assignedPeriods = 0;
  for (const slot of masterSlots) {
    if (slot.isFree || !instructionalIds.has(slot.periodId) || !DAYS.includes(slot.day)) continue;
    const teacherSlots = assignments.get(slot.teacherId);
    if (teacherSlots) {
      teacherSlots.push(slot);
      assignedPeriods++;
    } else if (!slot.isActivity && slot.subjectCode !== "STUDY") {
      needsTeacher++;
    }
  }

  const classLabel = ({ grade, stream }) => [grade, stream].filter(Boolean).join(" ");
  const faculty = teachers.map((teacher) => {
    const slots = assignments.get(teacher.id);
    const name = teacher.fullName || teacher.name || "Unknown teacher";
    const homeroom = (teacher.homeroom || "").replace("|", " ").trim();
    const classes = [...new Set(slots.map(classLabel))];
    const subjectNames = [...new Set(slots.map(({ subjectName, subjectCode }) =>
      subjectName || subjectNamesByCode.get(subjectCode) || subjectCode).filter(Boolean))];
    const roster = (teacher.teachingAssignments || []).flatMap((assignment) => [
      classLabel(assignment), assignment.subjectCode,
      subjectNamesByCode.get(assignment.subjectCode),
    ]);
    const searchable = [name, teacher.tscNumber, homeroom, ...classes, ...subjectNames, ...roster].join(" ").toLowerCase();
    return { teacher, name, homeroom, classes, subjectNames, slots, searchable };
  });
  const activeCount = faculty.filter(({ slots }) => slots.length > 0).length;
  const avg = activeCount ? (assignedPeriods / activeCount).toFixed(1) : "0.0";
  const metrics = el("dl", { class: "tt-workload-metrics" }, [
    ["Assigned periods", assignedPeriods],
    ["Need a teacher", needsTeacher],
    ["Teachers assigned", `${activeCount} / ${teachers.length}`],
    ["Avg per assigned teacher", avg],
  ].map(([label, value]) => el("div", {}, [el("dt", {}, label), el("dd", {}, value)])));

  const search = el("input", {
    id: "tt-workload-search", type: "search",
    placeholder: "Name, subject, class or TSC number", onInput: () => renderList(),
  });
  const resultCount = el("span", { class: "tt-workload-result", role: "status" });
  const list = el("ul", { class: "tt-workload-list" });
  const message = el("p", { class: "tt-workload-empty", hidden: "" });
  const scroll = el("div", { class: "tt-workload-scroll", tabindex: "0", role: "region", "aria-label": "Faculty workloads" }, [
    list, message,
  ]);

  function tagGroup(label, items) {
    return items.length ? el("div", { class: "tt-workload-tags" }, [
      el("strong", {}, label),
      ...items.map((item) => el("span", {}, item)),
    ]) : null;
  }

  function renderList() {
    const query = search.value.toLowerCase().trim();
    const words = query.split(/\s+/);
    const matches = faculty.filter(({ searchable }) => words.every((word) => searchable.includes(word)));
    resultCount.textContent = query ? `${matches.length} of ${faculty.length} teachers` : "";
    message.hidden = matches.length > 0;
    message.textContent = faculty.length ? "No teachers match your search." : "No faculty members have been added.";
    list.replaceChildren(...matches.map(({ teacher, name, homeroom, classes, subjectNames, slots }) => {
      const count = slots.length;
      const [status, level] = count === 0 ? ["Unassigned", "none"] : count < lightLoadThreshold ? ["Light load", "light"] :
        count <= heavyLoadThreshold ? ["Within range", "in-range"] : ["Heavy load", "heavy"];
      const details = [teacher.tscNumber && `TSC ${teacher.tscNumber}`, homeroom && `Class teacher · ${homeroom}`].filter(Boolean);
      return el("li", { class: "tt-workload-card" }, [
        el("div", { class: "tt-workload-card-head" }, [
          el("div", {}, [
            el("h4", {}, name),
            details.length ? el("small", {}, details.join(" · ")) : null,
          ]),
          el("div", { class: "tt-workload-count" }, [
            el("strong", {}, `${count} ${count === 1 ? "period" : "periods"}`),
            el("span", { class: "tt-workload-status", "data-level": level }, status),
          ]),
        ]),
        el("dl", { class: "tt-workload-days", "aria-label": "Periods by day" }, DAYS.map((day) =>
          el("div", {}, [
            el("dt", { title: day }, day.slice(0, 3)),
            el("dd", {}, slots.filter((slot) => slot.day === day).length),
          ]))),
        tagGroup("Subjects", subjectNames),
        tagGroup("Classes", classes),
      ]);
    }));
    scroll.scrollTop = 0;
  }

  const modalBody = el("div", { class: "tt-workload-body" }, [
    metrics,
    el("div", { class: "tt-workload-search" }, [
      el("div", { class: "tt-workload-search-label" }, [
        el("label", { for: search.id }, "Find a teacher"),
        resultCount,
      ]),
      el("div", { class: "tt-workload-search-field" }, [icon("search", "text-sm", { "aria-hidden": "true" }), search]),
    ]),
    scroll,
    el("div", { class: "tt-workload-footer" }, [
      el("small", {}, `Workload reference · ${lightLoadThreshold}–${heavyLoadThreshold} periods per week`),
      el("button", {
        type: "button", class: "btn btn--outline btn--sm", onClick: exportMasterToExcel,
      }, [icon("download", "text-xs"), "Export Excel"]),
    ]),
  ]);
  renderList();
  openModal("Faculty workload", modalBody, "tt-workload-modal");
  modalBody.parentElement.setAttribute("role", "dialog");
  modalBody.parentElement.setAttribute("aria-modal", "true");
  modalBody.parentElement.setAttribute("aria-label", "Faculty workload");
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
          if (slot?.isFree) {
            row.push(FREE_PERIOD.subjectName);
          } else if (slot) {
            const teacherInit = slot.teacherName ? slot.teacherName.split(" ")[0] : "Unassigned";
            const room = namedRoomsEnabled ? namedTimetableRoom(slot.room) : "";
            row.push(`${slot.subjectCode} (${teacherInit})${room ? " [" + room + "]" : ""}`);
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
      ["Day", "Period", "Start Time", "End Time", "Grade", "Stream", "Class Cohort", "Subject Code", "Subject Name", "Teacher Name",
        ...(namedRoomsEnabled ? ["Room"] : [])]
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
        ...(namedRoomsEnabled ? [namedTimetableRoom(s.room)] : []),
      ]);
    }
    const wsFlat = XLSX.utils.aoa_to_sheet(flatRows);
    wsFlat["!cols"] = [
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 24 },
      ...(namedRoomsEnabled ? [{ wch: 14 }] : [])
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

// ------------------------------------------------------------------ Periods --

function getPeriodIcon(name, isBreak) {
  if (!isBreak) return "school";
  const lower = (name || "").toLowerCase();
  if (lower.includes("lunch")) return "restaurant";
  if (lower.includes("game") || lower.includes("club") || lower.includes("sport") || lower.includes("pe")) return "sports_soccer";
  if (lower.includes("devotion") || lower.includes("assembly")) return "groups";
  return "coffee";
}

function renderPeriods(container, profile) {
  container.innerHTML = "";

  const roomSwitch = el("input", {
    type: "checkbox",
    role: "switch",
    checked: namedRoomsEnabled ? "true" : undefined,
    "aria-describedby": "tt-room-mode-help",
    onChange: async (event) => {
      const input = event.currentTarget;
      input.disabled = true;
      try {
        await setTimetableRoomMode(profile.uid, input.checked);
        namedRoomsEnabled = input.checked;
        toast(namedRoomsEnabled ? "Named rooms enabled." : "Using usual classrooms.", "success");
      } catch (error) {
        input.checked = namedRoomsEnabled;
        toast(error.message || "Could not update room settings.", "error");
      } finally {
        input.disabled = false;
      }
    },
  });
  container.append(el("div", { class: "field" }, [
    el("label", { class: "checklist-item" }, [roomSwitch, "Use named rooms"]),
    el("p", { id: "tt-room-mode-help", class: "text-muted text-xs" },
      "Lessons use the class’s usual classroom by default. Enable this to name specific rooms or venues and check their bookings."),
  ]));

  const breakCount = periods.filter((p) => isBreakPeriod(p)).length;
  const lessonCount = periods.length - breakCount;

  let lessonTotalMins = 0;
  let breakTotalMins = 0;
  for (const p of periods) {
    const dur = calculateDurationMinutes(p.startTime, p.endTime);
    if (isBreakPeriod(p)) breakTotalMins += dur;
    else lessonTotalMins += dur;
  }
  const totalDayMins = lessonTotalMins + breakTotalMins;
  const totalDayHours = `${Math.floor(totalDayMins / 60)}h ${totalDayMins % 60}m`;
  const daySpan = periods.length ? `${periods[0].startTime} to ${periods[periods.length - 1].endTime} (${totalDayHours})` : "None";

  container.append(
    el("div", {
      style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;"
    }, [
      el("div", {}, [
        el("h3", { style: "margin:0 0 2px; color:var(--color-primary-900); font-family:var(--font-display);" }, "Instructional Periods & Bell Times"),
        el("p", { class: "text-muted text-xs", style: "margin:0;" },
          `${lessonCount} Lessons (${lessonTotalMins} min) · ${breakCount} Breaks (${breakTotalMins} min) · School Day: ${daySpan}`
        ),
      ]),
      el("div", { style: "display:flex; gap:8px; flex-wrap:wrap; align-items:center;" }, [
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => openPeriodModal(profile, null, container)
        }, [icon("add", "text-xs"), "Add Period"]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Automatically renumber all instructional periods in chronological order as Period 1, Period 2, Period 3... (breaks keep their custom names)",
          onClick: () => handleRenumberPeriods(profile, container)
        }, [icon("format_list_numbered", "text-xs"), "Re-number Lessons"]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          title: "Reset all periods to the official standard Kenya CBC JSS schedule (8 lessons, Short Break, Lunch, Games & Clubs)",
          onClick: () => handleResetStandardSchedule(profile, container)
        }, [icon("restore", "text-xs"), "Reset to CBC Standard"]),
      ]),
    ]),
    el("div", {
      class: "callout callout--info",
      style: "margin-bottom:16px; font-size:12px; display:flex; align-items:flex-start; gap:10px;",
    }, [
      icon("info", "text-sm", "style: flex-shrink:0; margin-top:2px;"),
      el("div", {}, [
        el("b", {}, "How Bell Times & Breaks Work in the Scheduler: "),
        "The automated scheduler assigns lessons exclusively into 'Lesson' periods. Mark your Short Break, Second Break, and Lunch as 'Break' so the scheduler protects those slots and leaves them completely free. Use the ▲ / ▼ arrows to move periods, or '+ Insert Before' to add lessons before any break.",
      ]),
    ])
  );

  if (!periods.length) {
    container.append(
      el("div", { class: "card", style: "text-align:center; padding:36px 20px; max-width:540px; margin:20px auto;" }, [
        icon("schedule", "text-lg", "style: font-size:40px; color:var(--color-ink-soft); margin-bottom:12px;"),
        el("h4", { style: "margin:0 0 8px; color:var(--color-primary-900);" }, "No Periods Configured"),
        el("p", { class: "text-muted text-xs", style: "margin-bottom:18px;" }, "Configure your school's daily lesson periods and break times, or load the official Kenya CBC 8-period template in one click."),
        el("div", { style: "display:flex; justify-content:center; gap:8px;" }, [
          el("button", { type: "button", class: "btn btn--primary btn--sm", onClick: () => handleResetStandardSchedule(profile, container) }, [icon("restore", "text-xs"), "Load Standard Kenya CBC Schedule"]),
          el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => openPeriodModal(profile, null, container) }, [icon("add", "text-xs"), "Add Custom Period"]),
        ]),
      ])
    );
    return;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "border:1px solid var(--color-line); border-radius:var(--radius-md); overflow:hidden;" });
  const table = el("table", { class: "reports-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:85px; text-align:center;" }, "Order"),
      el("th", { style: "width:210px;" }, "Period Name"),
      el("th", { style: "width:110px;" }, "Start Time"),
      el("th", { style: "width:110px;" }, "End Time"),
      el("th", { style: "width:110px; text-align:center;" }, "Duration"),
      el("th", { class: "col-center", style: "width:110px;" }, "Type"),
      el("th", { class: "col-right", style: "width:220px;" }, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});

  for (let idx = 0; idx < periods.length; idx++) {
    const p = periods[idx];
    const isFirst = idx === 0;
    const isLast = idx === periods.length - 1;
    const duration = calculateDurationMinutes(p.startTime, p.endTime);
    const isBreak = isBreakPeriod(p);
    const pIcon = getPeriodIcon(p.name, isBreak);

    // Check gap with previous period
    if (idx > 0) {
      const prevP = periods[idx - 1];
      const prevEndMins = timeToMinutes(prevP.endTime);
      const currStartMins = timeToMinutes(p.startTime);
      const gapMins = currStartMins - prevEndMins;

      if (gapMins > 0) {
        tbody.append(el("tr", { style: "background:#fffbeb; font-size:11px; color:#92400e;" }, [
          el("td", { colspan: "7", style: "padding:5px 14px;" }, [
            el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
              el("span", {}, [
                icon("coffee", "text-xs", "style: vertical-align:middle; margin-right:4px;"),
                `Unassigned Gap: ${gapMins} minutes (${prevP.endTime} to ${p.startTime})`,
              ]),
              el("button", {
                type: "button",
                class: "btn btn--ghost btn--xs",
                style: "color:#92400e; font-size:10.5px; padding:2px 8px; border:1px solid #fde68a; background:#fff;",
                onClick: () => openPeriodModal(profile, null, container, {
                  mode: "before",
                  targetPeriod: p,
                  targetIndex: idx,
                  customStart: prevP.endTime,
                  customEnd: p.startTime,
                  defaultType: "break",
                }),
              }, [icon("add", "text-xs"), `Fill with Break (${gapMins} min)`]),
            ]),
          ]),
        ]));
      } else if (gapMins < 0) {
        tbody.append(el("tr", { style: "background:#fef2f2; font-size:11px; color:#b91c1c;" }, [
          el("td", { colspan: "7", style: "padding:5px 14px;" }, [
            icon("warning", "text-xs", "style: vertical-align:middle; margin-right:4px;"),
            `Time Overlap (${Math.abs(gapMins)} min collision): "${prevP.name}" ends at ${prevP.endTime} but "${p.name}" starts at ${p.startTime}.`,
          ]),
        ]));
      }
    }

    tbody.append(el("tr", {}, [
      // 1. Move Controls (Up / Down)
      el("td", { "data-label": "Order", style: "text-align:center;" }, [
        el("div", { style: "display:inline-flex; gap:2px;" }, [
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "padding:3px 5px;",
            title: isFirst ? "Already the earliest period" : `Move "${p.name}" earlier`,
            disabled: isFirst,
            onClick: () => handleMovePeriod(profile, idx, "up", container),
          }, [icon("arrow_upward", "text-xs")]),
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "padding:3px 5px;",
            title: isLast ? "Already the latest period" : `Move "${p.name}" later`,
            disabled: isLast,
            onClick: () => handleMovePeriod(profile, idx, "down", container),
          }, [icon("arrow_downward", "text-xs")]),
        ]),
      ]),

      // 2. Period Name + Icon
      el("td", { "data-label": "Period Name" }, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", {
            style: `width:26px; height:26px; border-radius:6px; background:${isBreak ? "#fef3c7" : "var(--color-primary-50, #f0f7ff)"}; color:${isBreak ? "#92400e" : "var(--color-primary-800)"}; display:flex; align-items:center; justify-content:center; flex-shrink:0;`,
          }, [icon(pIcon, "text-xs")]),
          el("span", { style: "font-weight:700; color:var(--color-ink);" }, p.name),
        ]),
      ]),

      // 3. Start Time
      el("td", { "data-label": "Start Time" }, [
        el("span", { style: "font-family:var(--font-mono, monospace); font-weight:600; font-size:12.5px;" }, p.startTime),
      ]),

      // 4. End Time
      el("td", { "data-label": "End Time" }, [
        el("span", { style: "font-family:var(--font-mono, monospace); font-weight:600; font-size:12.5px;" }, p.endTime),
      ]),

      // 5. Duration
      el("td", { "data-label": "Duration", style: "text-align:center;" }, [
        el("span", {
          class: "badge",
          style: `font-size:11px; padding:2px 8px; font-weight:600; background:${isBreak ? "#fffbeb" : "#f1f5f9"}; color:${isBreak ? "#b45309" : "#334155"}; border:1px solid ${isBreak ? "#fde68a" : "#cbd5e1"};`,
        }, `${duration} min`),
      ]),

      // 6. Type Badge
      el("td", { class: "col-center", "data-label": "Type" }, [
        el("span", { class: `badge badge--${isBreak ? "gold" : "success"}` }, isBreak ? "Break" : "Lesson"),
      ]),

      // 7. Actions: Insert Before, Edit, Delete
      el("td", { class: "col-right", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end; align-items:center;" }, [
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "color:var(--color-primary-800); font-weight:600; border:1px solid var(--color-line);",
            title: `Insert a new period or break immediately before "${p.name}"`,
            onClick: () => openPeriodModal(profile, null, container, { mode: "before", targetPeriod: p, targetIndex: idx }),
          }, [icon("add", "text-xs"), "Insert Before"]),

          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            title: `Edit "${p.name}" details or timings`,
            onClick: () => openPeriodModal(profile, p, container),
          }, [icon("edit", "text-xs"), "Edit"]),

          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "color:var(--color-red);",
            title: `Delete "${p.name}"`,
            onClick: () => handleDeletePeriod(profile, p, container),
          }, [icon("delete", "text-xs"), "Delete"]),
        ]),
      ]),
    ]));
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

// ------------------------------------------------ Moving & Retiming Periods --

async function handleMovePeriod(profile, index, direction, container) {
  if (direction === "up" && index <= 0) return;
  if (direction === "down" && index >= periods.length - 1) return;

  const targetIdx = direction === "up" ? index - 1 : index + 1;
  const p1 = direction === "up" ? periods[targetIdx] : periods[index];
  const p2 = direction === "up" ? periods[index] : periods[targetIdx];

  const d1 = calculateDurationMinutes(p1.startTime, p1.endTime);
  const d2 = calculateDurationMinutes(p2.startTime, p2.endTime);

  // Swap positions while maintaining contiguous time flow:
  // p2 now takes p1's original start time
  const updatedP2 = {
    ...p2,
    startTime: p1.startTime,
    endTime: addMinutesToTime(p1.startTime, d2),
  };
  // p1 now comes after p2
  const updatedP1 = {
    ...p1,
    startTime: updatedP2.endTime,
    endTime: addMinutesToTime(updatedP2.endTime, d1),
  };

  try {
    await batchUpdatePeriods(profile.uid, [updatedP1, updatedP2]);
    periods = await listPeriods(true);
    renderPeriods(container, profile);
    toast(`"${periods[targetIdx].name}" moved ${direction === "up" ? "earlier" : "later"} and timings updated.`, "success");
  } catch (err) {
    console.error("Move period error:", err);
    toast("Could not move period: " + (err.message || err), "error");
  }
}

async function handleRenumberPeriods(profile, container) {
  const lessonPeriods = periods.filter((p) => !isBreakPeriod(p));
  if (!lessonPeriods.length) return toast("No lesson periods to renumber.", "error");

  if (!confirm(`Renumber ${lessonPeriods.length} instructional periods sequentially as "Period 1", "Period 2"... in chronological order? (Breaks will keep their custom names).`)) {
    return;
  }

  let counter = 1;
  const updated = [];
  for (const p of periods) {
    if (!isBreakPeriod(p)) {
      updated.push({
        ...p,
        name: `Period ${counter}`,
      });
      counter++;
    }
  }

  try {
    await batchUpdatePeriods(profile.uid, updated);
    periods = await listPeriods(true);
    renderPeriods(container, profile);
    toast(`Lessons successfully renumbered Period 1 through Period ${counter - 1}!`, "success");
  } catch (err) {
    toast("Could not renumber periods: " + (err.message || err), "error");
  }
}

async function handleResetStandardSchedule(profile, container) {
  if (!confirm("Reset this school's periods to the official standard Kenya CBC JSS schedule (8 lessons: Periods 1-8, Short Break, Lunch, and Games & Clubs)? Existing period records will be replaced.")) {
    return;
  }
  try {
    await resetToStandardPeriods(profile.uid);
    periods = await listPeriods(true);
    renderPeriods(container, profile);
    toast("Reset to standard Kenya CBC JSS bell schedule.", "success");
  } catch (err) {
    toast("Could not reset periods: " + (err.message || err), "error");
  }
}

// ---------------------------------------------------- Add/Insert/Edit Modal --

function openPeriodModal(profile, existing, container, insertContext = null) {
  const isEdit = !!existing;
  const body = el("form", {});

  // Determine initial state based on context
  let initialName = existing?.name || "";
  let initialType = existing ? (isBreakPeriod(existing) ? "break" : "lesson") : (insertContext?.defaultType || "lesson");
  let initialStart = "";
  let initialEnd = "";
  let initialDuration = 40;

  if (isEdit) {
    initialStart = existing.startTime || "";
    initialEnd = existing.endTime || "";
    initialDuration = calculateDurationMinutes(initialStart, initialEnd);
  } else if (insertContext?.customStart && insertContext?.customEnd) {
    initialStart = insertContext.customStart;
    initialEnd = insertContext.customEnd;
    initialDuration = calculateDurationMinutes(initialStart, initialEnd);
    initialName = insertContext.defaultType === "break" ? "Break" : "Period";
  } else if (insertContext?.mode === "before") {
    const targetIdx = insertContext.targetIndex;
    const prevP = targetIdx > 0 ? periods[targetIdx - 1] : null;
    initialStart = prevP ? prevP.endTime : insertContext.targetPeriod.startTime;
    initialDuration = 40;
    initialEnd = addMinutesToTime(initialStart, initialDuration);
    // Suggest next lesson number if adding a lesson before a break
    const lessonsBefore = periods.slice(0, targetIdx).filter((p) => !isBreakPeriod(p)).length;
    initialName = `Period ${lessonsBefore + 1}`;
  } else {
    // Add at end of day
    initialStart = periods.length ? periods[periods.length - 1].endTime : "08:00";
    initialDuration = 40;
    initialEnd = addMinutesToTime(initialStart, initialDuration);
    const existingLessons = periods.filter((p) => !isBreakPeriod(p)).length;
    initialName = `Period ${existingLessons + 1}`;
  }

  // Type Selector (Lesson vs Break)
  let currentType = initialType;

  const typeLessonBtn = el("button", {
    type: "button",
    class: `btn ${currentType === "lesson" ? "btn--primary" : "btn--ghost"} btn--sm`,
    style: "flex:1; gap:6px; font-weight:700;",
  }, [icon("school", "text-xs"), "Teaching Lesson"]);

  const typeBreakBtn = el("button", {
    type: "button",
    class: `btn ${currentType === "break" ? "btn--primary" : "btn--ghost"} btn--sm`,
    style: "flex:1; gap:6px; font-weight:700;",
  }, [icon("coffee", "text-xs"), "Break / Lunch"]);

  const typeToggleWrap = el("div", {
    style: "display:flex; gap:8px; margin-bottom:14px; background:var(--color-cream-dim, #f8fafc); padding:6px; border-radius:var(--radius-md); border:1px solid var(--color-line);",
  }, [typeLessonBtn, typeBreakBtn]);

  const nameInput = el("input", {
    type: "text",
    value: initialName,
    placeholder: "e.g. Period 3, Short Break, Lunch",
    style: "font-weight:600;",
  });

  const startInput = el("input", {
    type: "time",
    value: initialStart,
    style: "font-family:var(--font-mono, monospace); font-weight:600;",
  });

  const endInput = el("input", {
    type: "time",
    value: initialEnd,
    style: "font-family:var(--font-mono, monospace); font-weight:600;",
  });

  const breakCheck = el("input", {
    type: "checkbox",
    ...(currentType === "break" ? { checked: "true" } : {}),
  });

  // Duration Presets Chips
  const lessonPresets = [35, 40, 45];
  const breakPresets = [10, 15, 20, 30, 50, 60];
  const durationMount = el("div", { style: "display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;" });

  function renderDurationPresets() {
    durationMount.innerHTML = "";
    const activePresets = currentType === "lesson" ? lessonPresets : breakPresets;
    activePresets.forEach((mins) => {
      const isCur = calculateDurationMinutes(startInput.value, endInput.value) === mins;
      const chip = el("button", {
        type: "button",
        class: `btn btn--xs ${isCur ? "btn--primary" : "btn--ghost"}`,
        style: "padding:2px 8px; font-size:11px; border-radius:12px;",
        onClick: () => {
          if (startInput.value) {
            endInput.value = addMinutesToTime(startInput.value, mins);
            renderDurationPresets();
          }
        },
      }, `${mins} min`);
      durationMount.append(chip);
    });
  }

  // Name suggestions for breaks
  const breakSuggestions = ["Short Break", "Second Break", "Lunch", "Tea Break", "Games & Clubs"];
  const nameSuggestionsMount = el("div", { style: "display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;" });

  function renderNameSuggestions() {
    nameSuggestionsMount.innerHTML = "";
    if (currentType === "break") {
      breakSuggestions.forEach((sugg) => {
        const chip = el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs",
          style: "padding:2px 8px; font-size:11px; border:1px solid var(--color-line);",
          onClick: () => {
            nameInput.value = sugg;
            if (sugg.toLowerCase().includes("lunch")) {
              endInput.value = addMinutesToTime(startInput.value, 50);
            } else if (sugg.toLowerCase().includes("short")) {
              endInput.value = addMinutesToTime(startInput.value, 15);
            }
            renderDurationPresets();
          },
        }, sugg);
        nameSuggestionsMount.append(chip);
      });
    }
  }

  function setType(newType) {
    currentType = newType;
    typeLessonBtn.className = `btn ${currentType === "lesson" ? "btn--primary" : "btn--ghost"} btn--sm`;
    typeBreakBtn.className = `btn ${currentType === "break" ? "btn--primary" : "btn--ghost"} btn--sm`;
    breakCheck.checked = currentType === "break";

    if (currentType === "lesson") {
      if (!isEdit && isBreakPeriod({ name: nameInput.value })) {
        const lessonsCount = periods.filter((p) => !isBreakPeriod(p)).length;
        nameInput.value = `Period ${lessonsCount + 1}`;
      }
      if (startInput.value) endInput.value = addMinutesToTime(startInput.value, 40);
    } else {
      if (!isEdit && !isBreakPeriod({ name: nameInput.value })) {
        nameInput.value = "Short Break";
      }
      if (startInput.value) endInput.value = addMinutesToTime(startInput.value, 20);
    }
    renderDurationPresets();
    renderNameSuggestions();
  }

  typeLessonBtn.onclick = () => setType("lesson");
  typeBreakBtn.onclick = () => setType("break");

  nameInput.addEventListener("input", () => {
    if (isBreakPeriod({ name: nameInput.value }) && currentType !== "break") {
      setType("break");
    }
  });

  startInput.addEventListener("change", () => {
    if (startInput.value && initialDuration > 0) {
      endInput.value = addMinutesToTime(startInput.value, initialDuration);
      renderDurationPresets();
    }
  });

  endInput.addEventListener("change", () => {
    renderDurationPresets();
  });

  renderDurationPresets();
  renderNameSuggestions();

  // Auto-shift checkbox (automatically enabled when inserting before existing periods)
  const canShift = !isEdit && periods.length > 0;
  const shiftCheck = el("input", {
    type: "checkbox",
    ...(canShift ? { checked: "true" } : {}),
  });

  const modalTitle = isEdit
    ? `Edit "${existing.name}"`
    : insertContext?.mode === "before"
    ? `Insert Period Before "${insertContext.targetPeriod.name}"`
    : "Add New Period";

  body.append(
    typeToggleWrap,
    el("div", { class: "field" }, [
      el("label", {}, "Period Name"),
      nameInput,
      nameSuggestionsMount,
    ]),
    el("div", { style: "display:grid; grid-template-columns:1fr 1fr; gap:12px;" }, [
      el("div", { class: "field" }, [
        el("label", {}, "Start Time"),
        startInput,
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "End Time"),
        endInput,
      ]),
    ]),
    el("div", { class: "field", style: "margin-top:-4px;" }, [
      el("label", { style: "font-size:11px; color:var(--color-ink-soft);" }, "Quick Duration Presets:"),
      durationMount,
    ]),
    el("div", { class: "field", style: "margin-top:12px;" }, [
      el("label", { class: "checklist-item", style: "font-size:12px;" }, [
        breakCheck,
        "This is a non-instructional break / lunch period (protected from lessons)",
      ]),
    ]),
    canShift ? el("div", {
      class: "field",
      style: "background:#f0fdf4; border:1px solid #bbf7d0; padding:10px 12px; border-radius:var(--radius-md); margin-top:8px;",
    }, [
      el("label", { class: "checklist-item", style: "font-size:12px; font-weight:600; color:#166534;" }, [
        shiftCheck,
        "Automatically shift subsequent periods forward to prevent time collisions",
      ]),
      el("p", { style: "margin:4px 0 0 22px; font-size:11px; color:#15803d; line-height:1.4;" },
        "When checked, all periods starting after this time will shift forward by the new period's duration, keeping the school schedule contiguous."
      ),
    ]) : null,
    el("div", { style: "margin-top:16px;" }, [
      el("button", {
        type: "submit",
        class: "btn btn--primary btn--block",
      }, [icon(isEdit ? "save" : "add"), isEdit ? "Save Changes" : (insertContext ? "Insert Period & Shift Schedule" : "Add Period")]),
    ])
  );

  const close = openModal(modalTitle, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!nameInput.value.trim()) return toast("Please enter a period name.", "error");
    if (!startInput.value || !endInput.value) return toast("Start and end time are required.", "error");

    const newStart = startInput.value;
    const newEnd = endInput.value;
    const newDur = calculateDurationMinutes(newStart, newEnd);
    if (newDur <= 0) return toast("End time must be after start time.", "error");

    const restore = busyButton(e.submitter, "Saving…");

    try {
      // 1. Shift subsequent periods forward if enabled
      if (canShift && shiftCheck.checked) {
        const startMins = timeToMinutes(newStart);
        const periodsToShift = periods.filter((p) => {
          if (existing && p.id === existing.id) return false;
          return timeToMinutes(p.startTime) >= startMins;
        });

        if (periodsToShift.length > 0) {
          const shiftedPeriods = periodsToShift.map((p) => ({
            ...p,
            startTime: addMinutesToTime(p.startTime, newDur),
            endTime: addMinutesToTime(p.endTime, newDur),
          }));
          await batchUpdatePeriods(profile.uid, shiftedPeriods);
        }
      }

      // 2. Add or update target period
      const payload = {
        name: nameInput.value.trim(),
        startTime: newStart,
        endTime: newEnd,
        isBreak: breakCheck.checked || isBreakPeriod({ name: nameInput.value }),
      };

      if (isEdit) {
        await updatePeriod(profile.uid, existing.id, payload);
      } else {
        await addPeriod(profile.uid, payload);
      }

      periods = await listPeriods(true);
      renderPeriods(container, profile);
      toast(`Period "${payload.name}" saved successfully!`, "success");
      close();
    } catch (err) {
      console.error("Save period error:", err);
      toast(err.message || "Could not save period.", "error");
      restore();
    }
  });
}

async function handleDeletePeriod(profile, period, container) {
  if (!confirm(`Delete "${period.name}" (${period.startTime}–${period.endTime})? Active lessons assigned to this period will be unlinked.`)) return;
  try {
    await deletePeriod(profile.uid, period.id);
    periods = await listPeriods(true);
    renderPeriods(container, profile);
    toast(`Period "${period.name}" deleted.`, "success");
  } catch (err) {
    toast(err.message || "Could not delete period.", "error");
  }
}

// ----------------------------------------------------------- Shared Grid UI --

function renderUnselectedTimetable(container, mode = "class") {
  container.replaceChildren(workspaceResults(mode === "teacher" ? "Teacher Schedule" : "Class Schedule", mode === "teacher"
    ? "Select a teacher to view their classes and free periods."
    : "Select a class and stream to view its lessons and breaks.", { symbol: "calendar_month" }
  ));
}
