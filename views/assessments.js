import {
  listAssessments,
  addAssessment,
  updateAssessment,
  deleteAssessment,
  setAssessmentStatus,
  ASSESSMENT_TYPES,
  DEFAULT_ASSESSMENT_MAX_SCORE,
  CONTRIBUTION_MODES,
} from "../js/services/assessment.service.js";
import { listClasses, listSubjects, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listMarksByAssessment } from "../js/services/marks.service.js";
import { gradeFor } from "../js/services/grading.service.js";
import { openModal } from "../js/components/modal.js";
import { datePickerInput } from "../js/components/datepicker.js";
import { navigate } from "../js/router.js";
import { el, icon, toast, formatDate, busyButton, spinner } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];

// --- module state -----------------------------------------------------
let assessments = [];
let classes = [];
let subjects = [];
let students = [];
let settings = null;

// "Students Sat" / "Mean Score" etc. need the actual marks for an
// assessment, which used to mean pulling the whole school's marks
// collection upfront (listAllMarks()) just so the table could be sorted
// and the KPI strip could show an "Overall Mean". That doesn't scale, so
// this page no longer fetches marks until someone actually opens an
// assessment's Results modal - see getAssessmentStats() below. The one
// thing computable for free (no fetch) is "expected" - who *should* sit
// the assessment - since that only needs students/classes, which are
// already loaded for the rest of the page.
let expectedById = new Map();
// assessmentId -> stats object, filled in lazily by getAssessmentStats().
// Cleared whenever assessments/marks might have changed (refresh()).
let statsCache = new Map();

let filters = { search: "", type: "all", term: "all", year: "all", status: "all", grade: "all", subject: "all" };
let sort = { key: "date", dir: "desc" };

/**
 * Dynamic Academic Scholar Mascot with Exam Test Paper and golden fountain pen.
 */
export function buildAssessmentsMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="assessments-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Assessments Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Exam / CAT Assessment Paper -->
        <g class="assessments-mascot__paper">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Exam Booklet -->
          <rect x="50" y="122" width="30" height="38" rx="2.5" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.4" transform="rotate(-6 65 141)" />
          <!-- Folded Corner -->
          <polygon points="73,122 80,129 73,129" fill="#E2E8F0" stroke="#0D3559" stroke-width="0.8" transform="rotate(-6 65 141)" />
          <!-- Header Bar -->
          <rect x="54" y="127" width="16" height="4" rx="1" fill="#14538A" transform="rotate(-6 65 141)" />
          <!-- Test check lines -->
          <line x1="54" y1="135" x2="68" y2="135" stroke="#0B2545" stroke-width="1.2" stroke-linecap="round" transform="rotate(-6 65 141)" />
          <line x1="54" y1="140" x2="72" y2="140" stroke="#64748B" stroke-width="1" stroke-linecap="round" transform="rotate(-6 65 141)" />
          <line x1="54" y1="145" x2="66" y2="145" stroke="#64748B" stroke-width="1" stroke-linecap="round" transform="rotate(-6 65 141)" />
          <!-- Green 100% Score Tag -->
          <rect x="54" y="149" width="18" height="6" rx="1.5" fill="#059669" transform="rotate(-6 65 141)" />
          <line x1="57" y1="152" x2="69" y2="152" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" transform="rotate(-6 65 141)" />
          <!-- Hand Holding Exam -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Golden Grading Pen with Gleam Animation -->
        <g class="assessments-mascot__pen">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Pen Body -->
          <path d="M152,112 L168,88 L173,91 L157,115 Z" fill="#C9A227" stroke="#8C6F12" stroke-width="1" />
          <!-- Golden Nib -->
          <polygon points="168,88 174,78 173,91" fill="#F59E0B" stroke="#D97706" stroke-width="1" />
          <line x1="171" y1="89" x2="173" y2="80" stroke="#78350F" stroke-width="0.8" />
          <!-- Sparkle star at nib tip -->
          <polygon points="174,73 175.5,76 179,77.5 175.5,79 174,82 172.5,79 169,77.5 172.5,76" fill="#FDE68A" />
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
          <g class="support-mascot__tassel">
            <path d="M110,48.5 Q135,46 142,66" stroke="#FAF6F0" stroke-width="2.2" fill="none" />
            <polygon points="139,66 145,66 143,77 141,77" fill="#FAF6F0" />
          </g>
        </g>
      </g>
    </svg>
  `;
}

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [assessments, classes, subjects, students, settings] = await Promise.all([
    listAssessments(),
    listClasses(),
    listSubjects(),
    listStudents(),
    getSchoolSettings(),
  ]);
  expectedById = buildExpectedIndex();
  statsCache = new Map();
  const canManage = CAN_MANAGE.includes(profile.role);

  const wrap = el("div", {});

  // 1. Executive Hero Banner
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildAssessmentsMascotSvg({ width: 125, height: 110 });

  const heroBanner = el("div", { class: "assessments-hero" }, [
    el("div", { class: "assessments-hero__content" }, [
      el("h1", { class: "assessments-hero__title" }, "Assessments & Examinations"),
      el("p", { class: "assessments-hero__desc" }, "Configure CATs, assignments, exams, custom subject maximums, and evaluation schedules."),
      el("div", { class: "assessments-hero__pills" }, [
        el("div", { class: "assessments-pill" }, [icon("domain"), `${classes.length} Grade Cohorts`]),
        el("div", { class: "assessments-pill" }, [icon("school"), `${subjects.length} Subjects`]),
        el("div", { class: "assessments-pill" }, [icon("calendar_month"), `${settings?.currentAcademicYear || new Date().getFullYear()} · ${settings?.currentTerm || "Term 1"}`]),
      ]),
    ]),

    el("div", { class: "assessments-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Schedule CATs & exams."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 2. Executive KPI Metrics Strip
  const kpiMount = el("div", { style: "margin-bottom:var(--sp-4);" });
  wrap.append(kpiMount);
  renderKpis(kpiMount);

  // 3. Consolidated Filter Toolbar Card
  const filterMount = el("div", { class: "card", style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);" });
  wrap.append(filterMount);
  renderFilters(filterMount, profile);

  // 4. Configured Assessments Table Card
  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const countBadge = el("span", { class: "badge badge--neutral", id: "assessments-count-badge", style: "font-size:11px;" }, `${assessments.length} Assessments`);
  const tableHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("assignment", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "Configured Assessments"),
      countBadge,
    ]),
  ]);
  tableCard.append(tableHeader);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  tableCard.append(tableWrap);
  wrap.append(tableCard);

  renderTable(tableWrap, profile, canManage);

  return wrap;
}

// ------------------------------------------------------------ analytics --

// Cheap ("expected" only) index computed entirely client-side from
// students/classes already loaded for the page - no marks fetch involved.
function buildExpectedIndex() {
  const map = new Map();
  const activeStudents = students.filter((s) => s.status === "active");
  for (const a of assessments) {
    const eligible = activeStudents.filter((s) => !a.grades?.length || a.grades.includes(s.grade));
    map.set(a.id, eligible.length);
  }
  return map;
}

// The real "students sat" / mean-score stats need this assessment's marks,
// fetched lazily (only when Results is opened or CSV export is clicked) and
// cached both here and in marks.service.js's own query cache, so re-opening
// an assessment's Results or re-exporting doesn't refetch.
async function getAssessmentStats(a) {
  if (statsCache.has(a.id)) return statsCache.get(a.id);
  const marksForA = await listMarksByAssessment(a.id);
  const studentIds = new Set(marksForA.map((m) => m.studentId));

  const bySubject = new Map();
  let sumPct = 0;
  for (const m of marksForA) {
    const pct = m.maxScore ? (Number(m.score) / Number(m.maxScore)) * 100 : 0;
    sumPct += pct;
    const rec = bySubject.get(m.subjectCode) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
    rec.count += 1;
    rec.sum += pct;
    rec.min = Math.min(rec.min, pct);
    rec.max = Math.max(rec.max, pct);
    bySubject.set(m.subjectCode, rec);
  }

  const stats = {
    sat: studentIds.size,
    expected: expectedById.get(a.id) || 0,
    meanPercent: marksForA.length ? sumPct / marksForA.length : null,
    subjectsCovered: bySubject.size,
    bySubject,
    entries: marksForA.length,
  };
  statsCache.set(a.id, stats);
  return stats;
}

function uniqueYears() {
  return Array.from(new Set(assessments.map((a) => a.academicYear).filter(Boolean))).sort().reverse();
}

function getFilteredSorted() {
  let list = assessments.filter((a) => {
    if (filters.search && !a.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.type !== "all" && a.type !== filters.type) return false;
    if (filters.term !== "all" && a.term !== filters.term) return false;
    if (filters.year !== "all" && a.academicYear !== filters.year) return false;
    if (filters.status !== "all" && (a.status || "open") !== filters.status) return false;
    if (filters.grade !== "all" && a.grades?.length && !a.grades.includes(filters.grade)) return false;
    if (filters.subject !== "all" && a.subjects?.length && !a.subjects.includes(filters.subject)) return false;
    return true;
  });

  const dir = sort.dir === "asc" ? 1 : -1;
  list = list.slice().sort((a, b) => {
    const sa = statsCache.get(a.id) || {};
    const sb = statsCache.get(b.id) || {};
    switch (sort.key) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "type":
        return (a.type || "").localeCompare(b.type || "") * dir;
      case "sat":
        return ((sa.sat || 0) - (sb.sat || 0)) * dir;
      case "mean":
        return ((sa.meanPercent ?? -1) - (sb.meanPercent ?? -1)) * dir;
      case "date":
      default:
        return (a.date || "").localeCompare(b.date || "") * dir;
    }
  });
  return list;
}

// ------------------------------------------------------------------ KPIs --

function renderKpis(container) {
  container.innerHTML = "";
  const today = new Date().toISOString().slice(0, 10);
  const open = assessments.filter((a) => (a.status || "open") === "open").length;
  const locked = assessments.filter((a) => a.status === "locked").length;
  const upcoming = assessments.filter((a) => a.date && a.date >= today).length;

  const kpis = [
    { label: "Total Assessments", value: assessments.length, icon: "assignment", color: "blue" },
    { label: "Open for Entry", value: open, icon: "edit_note", color: "green" },
    { label: "Locked", value: locked, icon: "lock", color: "red" },
    { label: "Upcoming", value: upcoming, icon: "event_upcoming", color: "gold" },
  ];

  const grid = el(
    "div",
    { class: "md3-kpi-grid" },
    kpis.map((k) =>
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, k.label),
          el("div", { class: "md3-kpi-chip__value numeric" }, String(k.value)),
        ]),
      ])
    )
  );
  container.append(grid);
}

// --------------------------------------------------------------- filters --

function renderFilters(container, profile) {
  container.innerHTML = "";
  const canManage = CAN_MANAGE.includes(profile.role);

  const searchInput = el("input", {
    id: "f-search",
    placeholder: "Search assessments by name…",
    value: filters.search,
    style: "width:100%; padding:8px 12px 8px 34px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); outline:none;",
  });

  const typeSelect = el("select", {
    id: "f-type",
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "all" }, "All Types"),
    ...ASSESSMENT_TYPES.map((t) => el("option", { value: t, ...(t === filters.type ? { selected: "true" } : {}) }, t)),
  ]);

  const termSelect = el("select", {
    id: "f-term",
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "all" }, "All Terms"),
    ...(settings.terms || ["Term 1", "Term 2", "Term 3"]).map((t) => el("option", { value: t, ...(t === filters.term ? { selected: "true" } : {}) }, t)),
  ]);

  const yearSelect = el("select", {
    id: "f-year",
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "all" }, "All Years"),
    ...uniqueYears().map((y) => el("option", { value: y, ...(y === filters.year ? { selected: "true" } : {}) }, y)),
  ]);

  const gradeSelect = el("select", {
    id: "f-grade",
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "all" }, "All Grades"),
    ...classes.map((c) => el("option", { value: c.grade, ...(c.grade === filters.grade ? { selected: "true" } : {}) }, c.grade)),
  ]);

  const statusSelect = el("select", {
    id: "f-status",
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "all" }, "All Statuses"),
    el("option", { value: "open", ...(filters.status === "open" ? { selected: "true" } : {}) }, "Open"),
    el("option", { value: "locked", ...(filters.status === "locked" ? { selected: "true" } : {}) }, "Locked"),
  ]);

  const toolbar = el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
    el("div", { style: "display:flex; align-items:center; gap:8px; flex:1; min-width:min(100%, 320px); flex-wrap:wrap;" }, [
      el("div", { style: "position:relative; flex:1; min-width:200px;" }, [
        el("span", {
          class: "material-symbols-rounded",
          style: "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--color-ink-soft); pointer-events:none;",
        }, "search"),
        searchInput,
      ]),
      typeSelect,
      termSelect,
      yearSelect,
      gradeSelect,
      statusSelect,
    ]),
    el("div", { style: "display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        id: "clear-filters",
        title: "Clear all filters",
      }, [icon("filter_alt_off"), "Clear"]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        id: "export-csv",
        title: "Export assessments to CSV",
      }, [icon("download"), "Export CSV"]),
      canManage ? el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        id: "new-assessment-btn",
        onClick: () => openAssessmentForm(profile),
      }, [icon("add"), "Add Assessment"]) : null,
    ].filter(Boolean)),
  ]);

  container.append(toolbar);

  setTimeout(() => {
    document.getElementById("f-search")?.addEventListener("input", (e) => {
      filters.search = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-type")?.addEventListener("change", (e) => {
      filters.type = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-term")?.addEventListener("change", (e) => {
      filters.term = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-year")?.addEventListener("change", (e) => {
      filters.year = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-status")?.addEventListener("change", (e) => {
      filters.status = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-grade")?.addEventListener("change", (e) => {
      filters.grade = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-subject")?.addEventListener("change", (e) => {
      filters.subject = e.target.value;
      rerender(profile);
    });
    document.getElementById("clear-filters")?.addEventListener("click", () => {
      filters = { search: "", type: "all", term: "all", year: "all", status: "all", grade: "all", subject: "all" };
      renderFilters(container, profile);
      rerender(profile);
    });
    document.getElementById("export-csv")?.addEventListener("click", async (e) => {
      const restore = busyButton(e.currentTarget, "Exporting…");
      try {
        await exportCsv();
      } finally {
        restore();
      }
    });
  });
}

function rerender(profile) {
  const canManage = CAN_MANAGE.includes(profile.role);
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile, canManage);
  const countBadge = document.getElementById("assessments-count-badge");
  if (countBadge) {
    const filteredCount = getFilteredSorted().length;
    countBadge.textContent = `${filteredCount} Assessments`;
  }
}

async function refresh(profile) {
  assessments = await listAssessments();
  expectedById = buildExpectedIndex();
  statsCache = new Map();
  const kpiMount = document.querySelector(".md3-kpi-grid")?.parentElement;
  if (kpiMount) renderKpis(kpiMount);
  rerender(profile);
}

async function exportCsv() {
  const list = getFilteredSorted();
  if (!list.length) return toast("Nothing to export with current filters.", "error");
  const statsList = await Promise.all(list.map((a) => getAssessmentStats(a)));
  const header = ["Name", "Type", "Term", "Academic Year", "Date", "Out Of", "Out Of Overrides", "Mode", "Classes", "Subjects", "Students Sat", "Expected", "Mean %", "Status"];
  const rows = list.map((a, i) => {
    const s = statsList[i] || {};
    return [
      a.name,
      a.type,
      a.term || "",
      a.academicYear || "",
      a.date || "",
      a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE,
      Object.keys(a.subjectMaxScores || {}).length
        ? Object.entries(a.subjectMaxScores).map(([code, v]) => `${subjectName(code)}: ${v}`).join(" / ")
        : "",
      (a.contributionMode || "weighted") === "direct" ? "Direct add" : "Weighted",
      (a.grades || []).join(" / ") || "All",
      (a.subjects || []).map(subjectName).join(" / ") || "All",
      s.sat ?? 0,
      s.expected ?? 0,
      s.meanPercent != null ? s.meanPercent.toFixed(1) : "",
      a.status || "open",
    ];
  });
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `assessments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} assessment(s).`, "success");
}

// -------------------------------------------------------------- table ui --

function emptyState(title, message) {
  return el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
    icon("assignment", "empty-state__icon"),
    el("h3", {}, title),
    el("p", {}, message),
  ]);
}

function sortableTh(label, key, profile) {
  const active = sort.key === key;
  const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  return el(
    "th",
    {
      style: "cursor:pointer; user-select:none;",
      onClick: () => {
        sort.dir = active && sort.dir === "asc" ? "desc" : "asc";
        if (!active) sort.dir = "desc";
        sort.key = key;
        rerender(profile);
      },
    },
    `${label}${arrow}`
  );
}

function renderTable(container, profile, canManage) {
  container.innerHTML = "";

  if (!assessments.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("assignment", "empty-state__icon"),
        el("h3", {}, "No assessments configured yet"),
        el("p", {}, canManage ? "Click '+ Add Assessment' to set up your first CAT, assignment, or exam." : "Nothing has been scheduled yet for this term."),
        canManage ? el("button", {
          class: "btn btn--primary btn--sm",
          style: "margin-top:12px;",
          onClick: () => openAssessmentForm(profile),
        }, [icon("add"), "Add First Assessment"]) : null,
      ].filter(Boolean))
    );
    return;
  }

  const list = getFilteredSorted();
  const countBadge = document.getElementById("assessments-count-badge");
  if (countBadge) countBadge.textContent = `${list.length} Assessments`;

  if (!list.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("search_off", "empty-state__icon"),
        el("h3", {}, "No matching assessments"),
        el("p", {}, "Try adjusting or clearing your active filters to see other assessments."),
      ])
    );
    return;
  }

  const headCells = [
    sortableTh("Assessment", "name", profile),
    sortableTh("Type", "type", profile),
    sortableTh("Date", "date", profile),
    el("th", { style: "width:110px;" }, "Out Of"),
    el("th", { style: "width:110px;" }, "Mode"),
    el("th", { style: "min-width:140px;" }, "Classes"),
    el("th", { style: "min-width:140px;" }, "Subjects"),
    el("th", { style: "width:100px;" }, "Status"),
    el("th", { class: "col-right", style: "width:160px;" }, "Actions"),
  ];

  const table = el("table", { class: "reports-table" }, [el("thead", {}, el("tr", {}, headCells))]);
  const tbody = el("tbody", {});

  for (const a of list) {
    const nameCell = el("td", { "data-label": "Assessment" }, [
      el("div", { style: "display:flex; align-items:center; gap:10px;" }, [
        el("div", {
          style: "background:rgba(20,83,138,0.1); color:var(--color-primary-700); border-radius:8px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; flex-shrink:0;",
        }, [icon("assignment", "text-sm")]),
        el("div", {}, [
          el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, a.name),
          el("div", { class: "text-xs text-muted" }, `${a.term || "N/A"} · ${a.academicYear || ""}`),
        ]),
      ]),
    ]);

    const cells = [
      nameCell,
      el("td", { "data-label": "Type" }, el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, a.type)),
      el("td", { "data-label": "Date" }, a.date ? formatDate(a.date) : "—"),
      el("td", { class: "numeric", "data-label": "Out Of" }, [
        el("span", {
          style: "font-family:var(--font-mono); font-size:var(--fs-xs); font-weight:600; color:var(--color-ink);",
          title: Object.keys(a.subjectMaxScores || {}).length ? Object.entries(a.subjectMaxScores).map(([code, v]) => `${subjectName(code)}: ${v}`).join(", ") : "",
        }, Object.keys(a.subjectMaxScores || {}).length ? `${a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE} (varies)` : `${a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE}`),
      ]),
      el("td", { "data-label": "Mode" }, el("span", {
        class: `badge badge--${(a.contributionMode || "weighted") === "direct" ? "gold" : "muted"}`,
        style: "font-size:11px;",
      }, (a.contributionMode || "weighted") === "direct" ? "Direct add" : "Weighted")),
      el("td", { "data-label": "Classes" }, (a.grades || []).length
        ? el("div", { style: "display:flex; flex-wrap:wrap; gap:4px;" }, a.grades.map((g) => el("span", { class: "badge badge--muted", style: "font-size:11px; padding:2px 6px;" }, g)))
        : el("span", { class: "text-muted", style: "font-size:var(--fs-xs);" }, "All grades")
      ),
      el("td", { "data-label": "Subjects" }, (a.subjects || []).length
        ? el("div", { style: "display:flex; flex-wrap:wrap; gap:4px;" }, a.subjects.map((code) => el("span", { class: "badge badge--neutral", style: "font-size:11px; padding:2px 6px;" }, subjectName(code))))
        : el("span", { class: "text-muted", style: "font-size:var(--fs-xs);" }, "All subjects")
      ),
      el("td", { "data-label": "Status" }, el("span", {
        class: `badge badge--${a.status === "locked" ? "danger" : "success"}`,
        style: "font-size:11px;",
      }, a.status === "locked" ? "Locked" : "Open")),
    ];

    const actionsCell = el("td", { class: "col-right", "data-label": "Actions" }, [
      el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
        el("button", {
          class: "btn btn--tonal btn--sm",
          style: "padding:4px 8px; font-size:12px;",
          title: "View Results Breakdown",
          onClick: () => openResultsModal(a),
        }, [icon("analytics", "text-xs"), " Results"]),
        canManage ? el("button", {
          class: "btn btn--ghost btn--sm",
          style: "padding:4px 8px; font-size:12px;",
          title: "More options",
          onClick: () => openActionsMenu(profile, a),
        }, [icon("more_vert")]) : null,
      ].filter(Boolean)),
    ]);

    cells.push(actionsCell);
    tbody.append(el("tr", {}, cells));
  }
  table.append(tbody);
  container.append(table);
}

// ------------------------------------------------------------- more menu --

function openActionsMenu(profile, a) {
  let close;
  const isLocked = a.status === "locked";
  const body = el("div", { style: "display:flex; flex-direction:column; gap:10px;" });

  body.append(
    el("button", {
      class: "btn btn--ghost btn--block",
      style: "justify-content:flex-start; gap:10px; padding:10px 14px; font-size:var(--fs-sm);",
      onClick: () => {
        if (close) close();
        openAssessmentForm(profile, a);
      },
    }, [icon("edit"), "Edit Assessment Configuration"]),
    el("button", {
      class: "btn btn--ghost btn--block",
      style: "justify-content:flex-start; gap:10px; padding:10px 14px; font-size:var(--fs-sm);",
      onClick: () => {
        if (close) close();
        duplicateAssessment(profile, a);
      },
    }, [icon("content_copy"), "Duplicate Assessment"]),
    el("button", {
      class: "btn btn--ghost btn--block",
      style: `justify-content:flex-start; gap:10px; padding:10px 14px; font-size:var(--fs-sm); ${!isLocked ? "color:var(--color-red);" : ""}`,
      onClick: (ev) => {
        if (close) close();
        toggleLock(profile, a, ev.currentTarget);
      },
    }, [icon(isLocked ? "lock_open" : "lock"), isLocked ? "Reopen Assessment" : "Lock Assessment"]),
    el("button", {
      class: "btn btn--ghost btn--block",
      style: "justify-content:flex-start; gap:10px; padding:10px 14px; font-size:var(--fs-sm); color:var(--color-red);",
      onClick: () => {
        if (close) close();
        confirmDelete(profile, a);
      },
    }, [icon("delete"), "Delete Assessment"])
  );

  close = openModal(`Assessment: ${a.name}`, body);
}

// ------------------------------------------------------------ lock/unlock --

async function toggleLock(profile, a, button) {
  const next = a.status === "locked" ? "open" : "locked";
  const restore = busyButton(button, next === "locked" ? "Locking…" : "Reopening…");
  try {
    await setAssessmentStatus(profile.uid, a.id, next);
    toast(`${a.name} ${next === "locked" ? "locked" : "reopened"}.`, "success");
    await refresh(profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
    restore();
  }
}

// ------------------------------------------------------------- duplicate --

async function duplicateAssessment(profile, a) {
  const body = el("div", {});
  body.append(
    el("p", { style: "margin-bottom:var(--sp-3);" }, `Create a duplicate copy of "${a.name}"? You can adjust its name and date immediately afterwards.`),
    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
      el(
        "button",
        {
          class: "btn btn--primary",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Duplicating…");
            try {
              await addAssessment(profile.uid, {
                name: `${a.name} (Copy)`,
                type: a.type,
                contributionMode: a.contributionMode || "weighted",
                maxScore: a.maxScore,
                date: a.date,
                academicYear: a.academicYear,
                term: a.term,
                grades: a.grades || [],
                subjects: a.subjects || [],
                subjectMaxScores: a.subjectMaxScores || {},
              });
              toast("Assessment duplicated.", "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not duplicate assessment.", "error");
              restore();
            }
          },
        },
        [icon("content_copy"), "Duplicate"]
      ),
    ])
  );
  const close = openModal("Duplicate Assessment", body);
}

// -------------------------------------------------------------- results --

function subjectName(code) {
  return subjects.find((s) => s.code === code)?.name || code;
}

async function openResultsModal(a) {
  const body = el("div", { style: "display:grid; place-items:center; padding:32px;" }, [spinner("md", "dark")]);
  const close = openModal(`Results Breakdown: ${a.name}`, body);

  let s;
  try {
    s = await getAssessmentStats(a);
  } catch {
    body.innerHTML = "";
    body.append(emptyState("Couldn't load results", "Something went wrong fetching marks for this assessment. Try again."));
    return;
  }

  body.setAttribute("style", "");
  body.innerHTML = "";
  renderResultsBody(body, s, a, close);
}

function renderResultsBody(body, s, a, close) {
  const meanGrade = s.meanPercent != null ? gradeFor(s.meanPercent, settings.gradingScale) : null;
  const completionPct = s.expected ? Math.round((s.sat / s.expected) * 100) : (s.sat ? 100 : 0);

  const kpis = [
    { label: "Students Sat", value: s.expected ? `${s.sat} / ${s.expected}` : String(s.sat), icon: "groups", color: "blue" },
    { label: "Completion", value: `${completionPct}%`, icon: "done_all", color: completionPct >= 80 ? "green" : "gold" },
    { label: "Subjects Entered", value: `${s.subjectsCovered} / ${subjects.length}`, icon: "menu_book", color: "blue" },
    { label: "Mean Score", value: s.meanPercent != null ? `${s.meanPercent.toFixed(1)}%` : "N/A", icon: "analytics", color: "green" },
    { label: "Mean Grade", value: meanGrade?.grade || "N/A", icon: "school", color: "gold" },
  ];

  const grid = el(
    "div",
    { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" },
    kpis.map((k) =>
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, k.label),
          el("div", { class: "md3-kpi-chip__value numeric" }, k.value),
        ]),
      ])
    )
  );
  body.append(grid);

  if (!s.bySubject.size) {
    body.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-5);" }, [
        icon("assignment_late", "empty-state__icon"),
        el("h3", {}, "No marks entered yet"),
        el("p", {}, "Once marks are captured for this assessment, per-subject breakdown will appear here."),
      ])
    );
  } else {
    const rows = Array.from(s.bySubject.entries())
      .map(([code, rec]) => ({
        code,
        name: subjectName(code),
        count: rec.count,
        mean: rec.sum / rec.count,
        min: rec.min,
        max: rec.max,
      }))
      .sort((x, y) => y.mean - x.mean);

    const table = el("table", { class: "reports-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Subject"),
        el("th", { class: "numeric", style: "width:80px;" }, "Entries"),
        el("th", { class: "numeric", style: "width:90px;" }, "Mean %"),
        el("th", { class: "numeric", style: "width:90px;" }, "Highest"),
        el("th", { class: "numeric", style: "width:90px;" }, "Lowest"),
        el("th", { style: "width:80px;" }, "Grade"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const r of rows) {
      const g = gradeFor(r.mean, settings.gradingScale);
      tbody.append(
        el("tr", {}, [
          el("td", { "data-label": "Subject" }, [
            el("span", { style: "font-weight:600; color:var(--color-primary-900);" }, r.name),
          ]),
          el("td", { class: "numeric", "data-label": "Entries" }, String(r.count)),
          el("td", { class: "numeric", "data-label": "Mean %" }, [
            el("span", { style: "font-family:var(--font-mono); font-weight:600;" }, `${r.mean.toFixed(1)}%`),
          ]),
          el("td", { class: "numeric", "data-label": "Highest" }, [
            el("span", { style: "font-family:var(--font-mono); color:var(--color-green-700);" }, `${r.max.toFixed(1)}%`),
          ]),
          el("td", { class: "numeric", "data-label": "Lowest" }, [
            el("span", { style: "font-family:var(--font-mono); color:var(--color-ink-soft);" }, `${r.min.toFixed(1)}%`),
          ]),
          el("td", { "data-label": "Grade" }, el("span", { class: "badge badge--muted", style: "font-size:11px;" }, g?.grade || "N/A")),
        ])
      );
    }
    table.append(tbody);
    body.append(el("div", { class: "table-wrap table-wrap--responsive", style: "margin-bottom:16px;" }, table));
  }

  body.append(
    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
      el(
        "button",
        {
          class: "btn btn--primary btn--sm",
          onClick: () => {
            if (close) close();
            navigate("/marks");
          },
        },
        [icon("edit_note"), "Go to Marks Entry"]
      ),
    ])
  );
}

// --------------------------------------------------------------- editing --

function openAssessmentForm(profile, existing = null) {
  const isEdit = !!existing;
  if (isEdit && existing.status === "locked") {
    return toast("This assessment is locked. Reopen it first to edit.", "error");
  }
  const body = el("form", {});

  const typeSelect = el(
    "select",
    { id: "a-type" },
    ASSESSMENT_TYPES.map((t) => el("option", { value: t, ...(t === existing?.type ? { selected: "true" } : {}) }, t))
  );

  const termSelect = el(
    "select",
    { id: "a-term" },
    (settings.terms || ["Term 1", "Term 2", "Term 3"]).map((t) =>
      el("option", { value: t, ...(t === (existing?.term || settings.currentTerm) ? { selected: "true" } : {}) }, t)
    )
  );

  const gradeChecklist = el("div", { class: "checklist" });
  const selectedGrades = new Set(existing?.grades || []);
  for (const c of classes) {
    const checkbox = el("input", { type: "checkbox", value: c.grade, ...(selectedGrades.has(c.grade) ? { checked: "true" } : {}) });
    gradeChecklist.append(el("label", { class: "checklist-item" }, [checkbox, c.grade]));
  }

  // Leave unchecked = every subject gets this assessment. Check specific
  // subjects when only some of them sit it (e.g. no Assignment for CRE, no
  // Practical outside the sciences) - Marks Entry and Compute Results will
  // then only expect it for the subjects checked here.
  const subjectChecklist = el("div", { class: "checklist" });
  const selectedSubjects = new Set(existing?.subjects || []);
  for (const s of subjects) {
    const checkbox = el("input", { type: "checkbox", value: s.code, ...(selectedSubjects.has(s.code) ? { checked: "true" } : {}) });
    subjectChecklist.append(el("label", { class: "checklist-item" }, [checkbox, s.name]));
  }

  // Same occasion (name/date), different Marks Out Of per subject - e.g.
  // Agriculture out of 60, Maths out of 50, all languages out of 70. Blank
  // = use the default Marks Out Of above. Only offered for subjects this
  // assessment actually applies to (all of them, if none are checked above).
  // Rows can be bulk-set: check a group of subjects (or use a department
  // quick-select chip) then type one value and apply it to all of them at
  // once, instead of typing the same number into every subject separately.
  const existingOverrides = existing?.subjectMaxScores || {};
  const overrideRows = el("div", { class: "field-list" });
  const bulkToolbar = el("div", { style: "margin-bottom:10px;" });
  const bulkValueInput = el("input", { type: "number", min: "1", step: "0.5", placeholder: "value", style: "width:90px;" });

  function checkedOverrideCodes() {
    return Array.from(overrideRows.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.dataset.subjectCode);
  }

  function refreshOverrideRows() {
    const checkedSubjectAssessment = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const applicable = checkedSubjectAssessment.length ? subjects.filter((s) => checkedSubjectAssessment.includes(s.code)) : subjects;

    // Department quick-select chips - only shown for departments that
    // actually appear among the applicable subjects, and only when more
    // than one subject shares a department (a chip for a lone subject
    // wouldn't save any typing over just checking it directly).
    const deptCounts = {};
    for (const s of applicable) {
      if (!s.department) continue;
      deptCounts[s.department] = (deptCounts[s.department] || 0) + 1;
    }
    const chips = Object.keys(deptCounts).filter((d) => deptCounts[d] > 1);

    bulkToolbar.innerHTML = "";
    bulkToolbar.append(
      el("div", { style: "display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:8px;" }, [
        el("span", { class: "text-muted", style: "font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:0.04em;" }, "Quick select:"),
        ...chips.map((dept) =>
          el("button", {
            type: "button", class: "btn btn--ghost btn--sm",
            onClick: () => {
              const codesInDept = new Set(applicable.filter((s) => s.department === dept).map((s) => s.code));
              for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) {
                cb.checked = codesInDept.has(cb.dataset.subjectCode);
              }
            },
          }, dept)
        ),
        el("button", {
          type: "button", class: "btn btn--ghost btn--sm",
          onClick: () => { for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) cb.checked = true; },
        }, "All"),
        el("button", {
          type: "button", class: "btn btn--ghost btn--sm",
          onClick: () => { for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) cb.checked = false; },
        }, "None"),
      ]),
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        el("span", { class: "text-muted", style: "font-size:var(--fs-sm);" }, "Set checked subjects to"),
        bulkValueInput,
        el("button", {
          type: "button", class: "btn btn--tonal btn--sm",
          onClick: () => {
            const v = bulkValueInput.value.trim();
            if (v === "" || Number(v) <= 0) return toast("Enter a value to apply first.", "error");
            const codes = checkedOverrideCodes();
            if (!codes.length) return toast("Check at least one subject (or use a Quick select chip) first.", "error");
            for (const code of codes) {
              const input = overrideRows.querySelector(`input[type=number][data-subject-code="${code}"]`);
              if (input) input.value = v;
            }
            toast(`Applied ${v} to ${codes.length} subject(s).`, "success");
          },
        }, "Apply"),
      ])
    );

    overrideRows.innerHTML = "";
    for (const s of applicable) {
      const checkbox = el("input", { type: "checkbox", "data-subject-code": s.code });
      const input = el("input", {
        type: "number", min: "1", step: "0.5", "data-subject-code": s.code,
        placeholder: "default",
        value: existingOverrides[s.code] != null ? existingOverrides[s.code] : "",
        style: "width:100px;",
      });
      overrideRows.append(
        el("div", { style: "display:flex; align-items:center; gap:8px; margin-bottom:6px;" }, [
          checkbox,
          el("span", { style: "flex:1;" }, s.name),
          input,
        ])
      );
    }
  }
  refreshOverrideRows();
  subjectChecklist.addEventListener("change", refreshOverrideRows);
  const overridesDetails = el("details", {}, [
    el("summary", { style: "cursor:pointer; color:var(--color-primary-700); font-weight:600; font-size:var(--fs-sm); margin-bottom:8px;" },
      "Different Marks Out Of for some subjects? (optional)"),
    el("p", { class: "text-muted", style: "margin:0 0 8px; font-size:var(--fs-sm);" },
      "Leave a subject blank to use the default Marks Out Of above. Check subjects below (or use a department chip) and apply one value to all of them at once."),
    bulkToolbar,
    overrideRows,
  ]);

  const modeSelect = el(
    "select",
    { id: "a-mode" },
    CONTRIBUTION_MODES.map((m) => el("option", { value: m.value, ...(m.value === (existing?.contributionMode || "weighted") ? { selected: "true" } : {}) }, m.label))
  );

  const modeHint = el("p", { id: "a-mode-hint", class: "text-muted", style: "margin:-8px 0 4px; font-size:var(--fs-sm);" });

  function refreshModeHint() {
    if (modeSelect.value === "direct") {
      modeHint.textContent = "The raw score (bounded by Marks Out Of) is added straight onto the subject total - no % conversion, and it always counts, regardless of Report Mode. If it's meant to be part of the /100 total (e.g. an Exam marked out of 70), leave enough room for the weighted assessments' share, set via Report Mode in Grading & Positions. If it's a true bonus on top, that's fine too.";
    } else {
      modeHint.textContent = "Teachers enter raw scores against \"Marks Out Of\"; the system converts to a percentage automatically. How much this exam counts toward the final mark - e.g. Midterm 50% + Endterm 50%, or either one alone - is chosen once per compute using the Report Mode dropdown on the Grading & Positions page, not set per assessment here.";
    }
  }

  body.append(
    el("div", { class: "field" }, [
      el("label", {}, "Assessment Name"),
      el("input", { id: "a-name", value: existing?.name || "", placeholder: "e.g. CAT 1" }),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Type"), typeSelect]),
    el("div", { class: "field" }, [el("label", {}, "How should this count towards the final mark?"), modeSelect]),
    el("div", { class: "field" }, [
      el("label", {}, "Marks Out Of"),
      el("input", { id: "a-maxscore", type: "number", min: "1", step: "0.5", value: existing?.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE, placeholder: "e.g. 30" }),
    ]),
    modeHint,
    el("div", { class: "field" }, [el("label", {}, "Date"), datePickerInput({ id: "a-date", value: existing?.date || "" })]),
    el("div", { class: "field" }, [
      el("label", {}, "Academic Year"),
      el("input", { id: "a-year", value: existing?.academicYear || settings.currentAcademicYear || "" }),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [el("label", {}, "Classes (leave all unchecked to apply to every grade)"), gradeChecklist]),
    el("div", { class: "field" }, [el("label", {}, "Subjects (leave all unchecked to apply to every subject)"), subjectChecklist]),
    overridesDetails,
    el("button", { type: "submit", class: "btn btn--primary btn--block", style: "margin-top:14px;" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save changes" : "Add assessment"])
  );
  refreshModeHint();
  modeSelect.addEventListener("change", refreshModeHint);

  const close = openModal(isEdit ? `Edit: ${existing.name}` : "Add Assessment", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grades = Array.from(gradeChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const subjectCodes = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const subjectMaxScores = {};
    for (const input of overrideRows.querySelectorAll("input[type=number][data-subject-code]")) {
      const v = input.value.trim();
      if (v !== "" && Number(v) > 0) subjectMaxScores[input.dataset.subjectCode] = Number(v);
    }
    const data = {
      name: document.getElementById("a-name").value.trim(),
      type: document.getElementById("a-type").value,
      contributionMode: modeSelect.value,
      maxScore: document.getElementById("a-maxscore").value,
      date: document.getElementById("a-date").value,
      academicYear: document.getElementById("a-year").value.trim(),
      term: document.getElementById("a-term").value,
      grades,
      subjects: subjectCodes,
      subjectMaxScores,
    };
    if (!data.name) return toast("Assessment name is required.", "error");
    if (!data.maxScore || Number(data.maxScore) <= 0) return toast("Marks Out Of must be a positive number.", "error");
    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    try {
      if (isEdit) {
        await updateAssessment(profile.uid, existing.id, data);
        toast("Assessment updated.", "success");
      } else {
        await addAssessment(profile.uid, data);
        toast("Assessment added.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save assessment.", "error");
      restore();
    }
  });
}

function confirmDelete(profile, a) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${a.name}"? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el(
        "button",
        {
          class: "btn btn--danger",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Deleting…");
            try {
              await deleteAssessment(profile.uid, a.id);
              toast("Assessment deleted.", "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not delete assessment.", "error");
              restore();
            }
          },
        },
        "Delete"
      ),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Delete Assessment", body);
}

export function init() {}