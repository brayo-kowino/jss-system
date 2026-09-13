import {
  listStudents,
  registerStudent,
  updateStudent,
  transferStudent,
  setStudentStatus,
} from "../js/services/student.service.js";
import { listParents } from "../js/services/parent.service.js";
import { listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import {
  listFeeStructures,
  listPaymentsForStudent,
  recordPayment,
  getFeeSummary,
  formatKES,
  PAYMENT_METHODS,
} from "../js/services/fee.service.js";
import { listResultsForStudent, reportModeLabel, positionScopeTag, pickHeadlineResult } from "../js/services/grading.service.js";
import { listAttendanceForClassPeriod, summarizeForRoster } from "../js/services/attendance.service.js";
import { listLogsForEntity } from "../js/services/audit.service.js";
import {
  ISSUE_CATEGORIES,
  issueCategoryLabel,
  raiseIssue,
  listIssuesForStudent,
  listOpenIssues,
  resolveIssue,
} from "../js/services/student-issue.service.js";
import {
  buildTemplateCsv,
  downloadTemplateXlsx,
  parseStudentsFile,
  parseStudentsCsv,
  validateStudentRows,
  commitStudentRows,
  buildErrorReportCsv,
  downloadCsv,
} from "../js/services/student-import.service.js";
import { openModal } from "../js/components/modal.js";
import { datePickerInput, datePickerField } from "../js/components/datepicker.js";
import { el, icon, toast, formatDate, busyButton, spinner } from "../js/utils.js";
import { getCurrentSchool } from "../js/services/auth.service.js";
import { isStarterPlan } from "../js/services/subscription.service.js";

let students = [];
let parents = [];
let classes = [];
let settings = null;
let openIssueCounts = new Map(); // studentId -> count of open issues
let filterText = "";
let filterGrade = "";
let filterStatus = "";
let currentPage = 1;
const PAGE_SIZE = 50;

const STATUS_ACTION_LABEL = { active: "Reinstate", suspended: "Suspend", archived: "Archive", transferred: "Mark Transferred" };

/**
 * Dynamic Academic Registrar mascot with student folio and graduation diploma.
 */
export function buildStudentsMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="students-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Student Registrar Assistant">
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

        <!-- Left Arm Holding Student Portfolio Folio -->
        <g class="students-mascot__folio">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Blue Student Folio Binder -->
          <rect x="52" y="124" width="32" height="26" rx="3" fill="#0B2545" stroke="#14538A" stroke-width="1.2" transform="rotate(-6 68 137)" />
          <rect x="56" y="128" width="18" height="3" rx="1" fill="#C9A227" transform="rotate(-6 68 137)" />
          <rect x="56" y="133" width="22" height="2" rx="1" fill="#93C5FD" opacity="0.8" transform="rotate(-6 68 137)" />
          <rect x="56" y="137" width="15" height="2" rx="1" fill="#93C5FD" opacity="0.8" transform="rotate(-6 68 137)" />
          <!-- Golden Star Seal -->
          <polygon points="76,140 77.5,143 81,143.5 78.5,146 79,149.5 76,148 73,149.5 73.5,146 71,143.5 74.5,143" fill="#F59E0B" transform="rotate(-6 68 137)" />
          <!-- Hand Holding Folio -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Rolled Diploma with Animated Tilt -->
        <g class="students-mascot__diploma">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Rolled Diploma Parchment -->
          <rect x="144" y="94" width="26" height="11" rx="2" fill="#FAF6F0" stroke="#8C6F12" stroke-width="1.2" transform="rotate(-25 157 100)" />
          <!-- Red Ribbon Tied Around Diploma -->
          <rect x="154" y="93" width="5" height="13" rx="1" fill="#DC2626" transform="rotate(-25 157 100)" />
          <!-- Ribbon Streamers -->
          <path d="M157,105 Q161,114 158,121" stroke="#DC2626" stroke-width="2" fill="none" />
          <path d="M156,105 Q152,113 155,120" stroke="#DC2626" stroke-width="2" fill="none" />
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

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  const [studentsRes, parentsRes, classesRes, settingsRes, openIssuesRes] = await Promise.all([
    listStudents(),
    listParents(),
    listClasses(),
    getSchoolSettings(),
    listOpenIssues().catch(() => []),
  ]);
  students = studentsRes;
  parents = parentsRes;
  classes = classesRes;
  settings = settingsRes;
  openIssueCounts = new Map();
  for (const issue of openIssuesRes) {
    openIssueCounts.set(issue.studentId, (openIssueCounts.get(issue.studentId) || 0) + 1);
  }

  const activeCount = students.filter((s) => s.status === "active").length;
  const boysCount = students.filter((s) => (s.gender || "").toLowerCase() === "male").length;
  const girlsCount = students.filter((s) => (s.gender || "").toLowerCase() === "female").length;
  let totalOpenIssues = 0;
  for (const count of openIssueCounts.values()) totalOpenIssues += count;

  const wrap = el("div", { class: "students-view-wrap" });

  if (!classes.length) {
    wrap.append(
      el("div", {
        class: "callout callout--danger",
        style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding:16px 20px; background:#FDF2F2; border:1px solid #F8B4B4; border-radius:8px; flex-wrap:wrap; gap:12px;",
      }, [
        el("div", { style: "display:flex; align-items:center; gap:12px;" }, [
          icon("warning", "text-danger", { style: "font-size:28px;" }),
          el("div", {}, [
            el("h4", { style: "margin:0 0 4px; color:#9B1C1C; font-weight:600;" }, "Classes & Streams Setup Required"),
            el("p", { style: "margin:0; color:#771D1D; font-size:14px;" }, "You must create your school's classes and streams under Academics before you can enroll or import any students."),
          ]),
        ]),
        el("a", {
          href: "#/academics",
          class: "btn btn--primary btn--sm",
          style: "text-decoration:none; display:inline-flex; align-items:center; gap:6px;",
        }, [icon("school"), "Set Up Classes & Streams"]),
      ])
    );
  }

  // 1. Executive Hero Banner
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildStudentsMascotSvg({ width: 125, height: 110 });

  const heroBanner = el("div", { class: "students-hero" }, [
    el("div", { class: "students-hero__content" }, [
      el("h1", { class: "students-hero__title" }, "Student Directory & Admissions"),
      el("p", { class: "students-hero__desc" }, "Manage learner profiles, track academic cohorts, record transfers, and log student affairs."),
      el("div", { class: "students-hero__pills" }, [
        totalOpenIssues > 0
          ? el("div", { class: "students-pill", style: "border-color:rgba(220,38,38,0.3); color:#DC2626;" }, [icon("report"), `${totalOpenIssues} Open Alerts`])
          : el("div", { class: "students-pill" }, [icon("verified"), "Records In Order"]),
      ]),
    ]),

    el("div", { class: "students-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Learner profiles & admissions."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 2. Executive KPI Metrics Strip (using .md3-kpi-grid & .md3-kpi-chip)
  const kpis = [
    { label: "Total Registered", value: students.length, icon: "groups", color: "blue" },
    { label: "Active Learners", value: activeCount, icon: "how_to_reg", color: "green" },
    { label: "Boys / Girls", value: `${boysCount}B / ${girlsCount}G`, icon: "wc", color: "gold" },
    { label: "Welfare Alerts", value: totalOpenIssues, icon: "report", color: totalOpenIssues > 0 ? "red" : "green" },
  ];
  const kpiGrid = el("div", { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" });
  for (const k of kpis) {
    const chip = el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, k.label),
        el("div", { class: "md3-kpi-chip__value numeric" }, String(k.value)),
      ]),
    ]);
    kpiGrid.append(chip);
  }
  wrap.append(kpiGrid);

  // 3. Filter Toolbar & Action Buttons (Consolidated Card)
  const searchInput = el("input", {
    placeholder: "Search by name, adm no., phone, or parent…",
    style: "width:100%; padding:8px 12px 8px 34px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); outline:none;",
  });
  const gradeSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Grades"),
    ...classes.map((c) => el("option", { value: c.grade }, c.grade)),
  ]);
  const statusSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Statuses"),
    el("option", { value: "active" }, "Active"),
    el("option", { value: "transferred" }, "Transferred"),
    el("option", { value: "suspended" }, "Suspended"),
    el("option", { value: "archived" }, "Archived"),
  ]);

  const filterToolbar = el("div", {
    class: "card",
    style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);",
  }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
      // Left side: Search & Dropdowns
      el("div", { style: "display:flex; align-items:center; gap:10px; flex:1; min-width:min(100%, 300px); flex-wrap:wrap;" }, [
        el("div", { style: "position:relative; flex:1; min-width:220px;" }, [
          el("span", {
            class: "material-symbols-rounded",
            style: "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--color-ink-soft); pointer-events:none;",
          }, "search"),
          searchInput,
        ]),
        gradeSelect,
        statusSelect,
      ]),
      // Right side: Admission & Import actions
      el("div", { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          id: "import-students-btn",
          ...(classes.length ? {} : { title: "Set up classes and streams first" }),
        }, [icon("upload_file"), "Import Students"]),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          id: "new-admission-btn",
          ...(classes.length ? {} : { title: "Set up classes and streams first" }),
        }, [icon("person_add"), "New Admission"]),
      ]),
    ]),
  ]);
  wrap.append(filterToolbar);

  // 4. Modern Table Card
  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const tableHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("badge", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "Learner Directory"),
      el("span", { class: "badge badge--neutral", id: "students-count-badge", style: "font-size:11px;" }, `${students.length} Learners`),
    ]),
  ]);
  tableCard.append(tableHeader);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  tableCard.append(tableWrap);
  renderTable(tableWrap, profile);
  wrap.append(tableCard);

  searchInput.addEventListener("input", (e) => {
    filterText = e.target.value.toLowerCase();
    currentPage = 1;
    renderTable(tableWrap, profile);
  });
  gradeSelect.addEventListener("change", (e) => {
    filterGrade = e.target.value;
    currentPage = 1;
    renderTable(tableWrap, profile);
  });
  statusSelect.addEventListener("change", (e) => {
    filterStatus = e.target.value;
    currentPage = 1;
    renderTable(tableWrap, profile);
  });

  setTimeout(() => {
    document.getElementById("new-admission-btn")?.addEventListener("click", () => {
      if (!classes.length) {
        toast("Please set up classes and streams under Academics before adding students.", "error");
        location.hash = "#/academics";
        return;
      }
      openStudentForm(profile);
    });
    document.getElementById("import-students-btn")?.addEventListener("click", () => {
      if (!classes.length) {
        toast("Please set up classes and streams under Academics before importing students.", "error");
        location.hash = "#/academics";
        return;
      }
      openImportModal(profile);
    });
  });

  return wrap;
}

// A student's own record plus, for smarter search, their linked parents'
// names/phones - so front desk can find a student by whoever walked in.
function searchHaystack(s) {
  const parentBits = (s.parentIds || [])
    .map((pid) => parents.find((p) => p.id === pid))
    .filter(Boolean)
    .map((p) => `${p.fullName || ""} ${p.phone || ""}`)
    .join(" ");
  return `${s.fullName} ${s.admissionNumber || ""} ${s.kcpeNumber || ""} ${s.phone || ""} ${parentBits}`.toLowerCase();
}

function renderTable(container, profile) {
  const filtered = students.filter((s) => {
    const matchesText = !filterText || searchHaystack(s).includes(filterText);
    const matchesGrade = !filterGrade || s.grade === filterGrade;
    const matchesStatus = !filterStatus || s.status === filterStatus;
    return matchesText && matchesGrade && matchesStatus;
  });

  const countBadge = document.getElementById("students-count-badge");
  if (countBadge) countBadge.textContent = `${filtered.length} Learners`;

  if (!filtered.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("school", "empty-state__icon"),
      el("h3", {}, "No learners found"),
      el("p", {}, students.length ? "Try adjusting your search query or filters." : "Click '+ New Admission' to register your first student."),
    ]));
    return;
  }

  // Filtering runs on the full in-memory list (already fetched via
  // listStudents()), so this is just capping how many rows we build DOM
  // nodes for at once - keeps large rosters from turning the table render
  // into the slow part. Clamp in case a filter change shrank the result
  // set below the page currentPage was pointing at.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const table = el("table", { class: "reports-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:110px;" }, "Adm. No."),
      el("th", { style: "min-width:200px;" }, "Student Name"),
      el("th", { style: "width:140px;" }, "Class / Stream"),
      el("th", { style: "width:90px;" }, "Gender"),
      el("th", { style: "width:110px;" }, "Status"),
      el("th", { style: "width:120px;" }, "Admitted"),
      el("th", { style: "width:80px;" }, "Alerts"),
      el("th", { class: "col-right", style: "width:100px;" }, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of pageItems) {
    const openCount = openIssueCounts.get(s.id) || 0;
    const nameCell = el("td", { "data-label": "Student Name" }, [
      el("a", {
        href: "#",
        style: "font-weight:600; color:var(--color-primary-900); text-decoration:none;",
        onClick: (e) => { e.preventDefault(); openStudentProfile(profile, s, "overview"); },
      }, s.fullName),
    ]);
    tbody.append(el("tr", {}, [
      el("td", { class: "numeric", "data-label": "Adm. No." }, el("span", { style: "font-family:var(--font-mono); font-weight:600; font-size:var(--fs-xs);" }, s.admissionNumber || "—")),
      nameCell,
      el("td", { "data-label": "Class / Stream" }, el("span", { class: "badge badge--muted", style: "font-size:11px;" }, `${s.grade || "N/A"}${s.stream ? " · " + s.stream : ""}`)),
      el("td", { "data-label": "Gender" }, s.gender || "—"),
      el("td", { "data-label": "Status" }, statusBadge(s.status)),
      el("td", { "data-label": "Admitted" }, s.admissionDate ? formatDate(s.admissionDate) : "—"),
      el("td", { "data-label": "Alerts" }, openCount
        ? el("span", { class: "badge badge--danger", title: `${openCount} open issue(s)`, style: "cursor:pointer;", onClick: () => openStudentProfile(profile, s, "activity") }, [icon("report", "text-xs"), ` ${openCount}`])
        : el("span", { class: "text-muted", style: "font-size:var(--fs-xs);" }, "—")),
      el("td", { class: "col-right", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
          el("button", {
            class: "btn btn--ghost btn--sm",
            style: "padding:4px 8px; font-size:12px;",
            title: "View profile",
            onClick: () => openStudentProfile(profile, s, "overview"),
          }, [icon("account_circle"), "Profile"]),
        ]),
      ]),
    ]));
  }
  table.append(tbody);
  container.innerHTML = "";
  container.append(table);
  if (filtered.length > PAGE_SIZE) {
    container.append(renderPagination(filtered.length, totalPages, container, profile));
  }
}

function renderPagination(totalItems, totalPages, tableWrap, profile) {
  const rangeStart = (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalItems);

  const goTo = (page) => {
    currentPage = Math.min(Math.max(page, 1), totalPages);
    renderTable(tableWrap, profile);
  };

  const bar = el("div", {
    style: "display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 4px; flex-wrap:wrap;",
  }, [
    el("span", { style: "color:var(--color-muted, #666); font-size:0.9em;" },
      `Showing ${rangeStart}–${rangeEnd} of ${totalItems}`),
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      el("button", {
        class: "btn btn--ghost btn--sm",
        disabled: currentPage === 1 ? "true" : undefined,
        onClick: () => goTo(currentPage - 1),
      }, [icon("chevron_left"), "Prev"]),
      el("span", { style: "font-size:0.9em;" }, `Page ${currentPage} of ${totalPages}`),
      el("button", {
        class: "btn btn--ghost btn--sm",
        disabled: currentPage === totalPages ? "true" : undefined,
        onClick: () => goTo(currentPage + 1),
      }, ["Next", icon("chevron_right")]),
    ]),
  ]);
  return bar;
}

function statusBadge(status) {
  const map = { active: "success", transferred: "gold", suspended: "danger", archived: "muted" };
  return el("span", { class: `badge badge--${map[status] || "muted"}` }, status || "active");
}

function rowActions(student, profile) {
  const box = el("div", { style: "display:flex; gap:6px;" });
  box.append(
    el("button", { class: "btn btn--primary btn--sm", onClick: () => openStudentProfile(profile, student, "overview") }, [icon("account_circle"), "View Profile"])
  );
  return box;
}

async function refresh(profile) {
  // forceRefresh: true - we just admitted/edited/transferred/status-changed
  // a student (or bulk-imported), so skip straight past the cache instead
  // of possibly showing stale data.
  const [studentsRes, openIssuesRes] = await Promise.all([listStudents(true), listOpenIssues().catch(() => [])]);
  students = studentsRes;
  openIssueCounts = new Map();
  for (const issue of openIssuesRes) {
    openIssueCounts.set(issue.studentId, (openIssueCounts.get(issue.studentId) || 0) + 1);
  }
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile);
}

// ===========================================================================
// Student Profile - the "everything about this student" modal.
// ===========================================================================

const PROFILE_TABS = [
  { id: "overview", label: "Overview", icon: "person" },
  { id: "academic", label: "Academic", icon: "school" },
  { id: "fees", label: "Fees", icon: "payments" },
  { id: "attendance", label: "Attendance", icon: "fact_check" },
  { id: "activity", label: "Activity & Issues", icon: "history" },
];

function openStudentProfile(profile, student, initialTab = "overview") {
  const header = el("div", {});
  const tabsNav = el("div", { class: "profile-tabs" });
  const panel = el("div", { class: "profile-tab-panel" });

  let activeTab = initialTab;
  // Cache each tab's rendered fetch so switching back and forth doesn't
  // re-query Firestore every click; a fresh profile open always refetches.
  const loaders = {
    overview: () => renderOverviewTab(panel, profile, student, refreshAll),
    academic: () => renderAcademicTab(panel, profile, student, refreshAll),
    fees: () => renderFeesTab(panel, profile, student),
    attendance: () => renderAttendanceTab(panel, profile, student),
    activity: () => renderActivityTab(panel, profile, student, refreshAll),
  };

  function rerenderHeader() {
    header.innerHTML = "";
    header.append(buildProfileHeader(profile, student, refreshAll));
  }

  function renderTabsNav() {
    tabsNav.innerHTML = "";
    for (const t of PROFILE_TABS) {
      const isActive = t.id === activeTab;
      const count = t.id === "activity" ? (openIssueCounts.get(student.id) || 0) : 0;
      tabsNav.append(
        el("button", {
          type: "button",
          class: `profile-tab${isActive ? " profile-tab--active" : ""}`,
          onClick: () => { activeTab = t.id; renderTabsNav(); panel.innerHTML = ""; panel.append(loadingRow()); loaders[t.id](); },
        }, [icon(t.icon), t.label, count ? el("span", { class: "badge badge--danger" }, String(count)) : ""])
      );
    }
  }

  // Re-renders the header (status/badges) and the tab strip (issue-count
  // badge), then reloads whichever tab is currently open - the single
  // callback every action form (edit, status change, payment, issue) is
  // handed so the whole profile reflects what just happened.
  function refreshAll() {
    rerenderHeader();
    renderTabsNav();
    panel.innerHTML = "";
    panel.append(loadingRow());
    loaders[activeTab]();
  }

  rerenderHeader();
  renderTabsNav();
  panel.append(loadingRow());

  const body = el("div", {}, [header, tabsNav, panel]);
  openModal(`Student Profile: ${student.fullName}`, body, "modal--wide");
  loaders[activeTab]();
}

function loadingRow() {
  return el("div", { class: "loading-row" }, [spinner("sm", "dark"), "Loading…"]);
}

function buildProfileHeader(profile, student, refreshAll) {
  const wrap = el("div", { class: "profile-header" });
  const starterPlan = isStarterPlan(getCurrentSchool());
  wrap.append(
    starterPlan
      ? el("div", { class: "profile-photo profile-photo--placeholder" }, [el("span", { class: "material-symbols-rounded" }, "person")])
      : student.photoUrl ? el("img", { class: "profile-photo", src: student.photoUrl }) : el("div", { class: "profile-photo" }),
    el("div", { class: "profile-identity" }, [
      el("h2", {}, student.fullName),
      el("p", { class: "meta" }, `${student.admissionNumber || "No adm. no."} · ${student.grade || "N/A"} ${student.stream || ""} · ${student.gender || "N/A"}`),
      el("div", { class: "badges" }, [
        statusBadge(student.status),
        student.status === "suspended" && student.suspensionReason
          ? el("span", { class: "badge badge--muted" }, `Reason: ${student.suspensionReason}`)
          : "",
      ]),
    ]),
    el("div", { class: "profile-actions" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStudentForm(profile, student, refreshAll) }, [icon("edit"), "Edit Info"]),
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => openTransferForm(profile, student, refreshAll) }, [icon("swap_horiz"), "Transfer/Promote"]),
      student.status !== "suspended"
        ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStatusChangeModal(profile, student, "suspended", refreshAll) }, [icon("pause_circle"), "Suspend"])
        : el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStatusChangeModal(profile, student, "active", refreshAll) }, [icon("restart_alt"), "Reinstate"]),
      student.status !== "archived"
        ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStatusChangeModal(profile, student, "archived", refreshAll) }, [icon("archive"), "Archive"])
        : "",
      el("button", { class: "btn btn--danger btn--sm", onClick: () => openIssueForm(profile, student, null, refreshAll) }, [icon("report"), "Raise Issue"]),
    ])
  );
  return wrap;
}

function detailItem(label, value) {
  return el("div", { class: "detail-item" }, [el("label", {}, label), el("div", {}, value || "N/A")]);
}

async function renderOverviewTab(panel, profile, student, refreshAll) {
  panel.innerHTML = "";
  panel.append(loadingRow());

  const [feeSummary, results] = await Promise.all([
    settings.currentAcademicYear && settings.currentTerm
      ? getFeeSummary({ studentId: student.id, grade: student.grade, academicYear: settings.currentAcademicYear, term: settings.currentTerm }).catch(() => null)
      : Promise.resolve(null),
    listResultsForStudent(student.id).catch(() => []),
  ]);
  const latestResult = pickHeadlineResult(results);
  const openCount = openIssueCounts.get(student.id) || 0;

  panel.innerHTML = "";

  const stats = el("div", { class: "profile-stats" }, [
    statChip("Fee Balance (this term)", feeSummary ? formatKES(feeSummary.balance) : "N/A", feeSummary && feeSummary.balance > 0 ? "warn" : "good"),
    statChip("Latest Mean Grade", latestResult ? `${latestResult.meanGrade || "N/A"} (${latestResult.meanMarks?.toFixed(1) ?? "N/A"}%)` : "No results yet"),
    statChip("Latest Position", latestResult?.overallPosition ? `${latestResult.overallPosition} / ${latestResult.classSize} (${positionScopeTag(false)})` : "N/A"),
    statChip("Open Issues", String(openCount), openCount ? "warn" : "good"),
  ]);
  panel.append(stats);

  panel.append(
    el("div", { class: "detail-grid" }, [
      detailItem("Date of Birth", formatDate(student.dob)),
      detailItem("Admission Date", formatDate(student.admissionDate)),
      detailItem("Phone", student.phone),
      detailItem("Address", student.address),
      detailItem("Previous School", student.previousSchool),
      detailItem("KCPE/Assessment No.", student.kcpeNumber),
    ])
  );

  if (student.medicalInfo) {
    panel.append(
      el("h3", { class: "section-title" }, "Medical Information"),
      el("p", { class: "text-sm", style: "margin-bottom:20px;" }, student.medicalInfo)
    );
  }

  panel.append(el("h3", { class: "section-title" }, "Parents / Guardians"));
  const parentIds = student.parentIds || [];
  if (!parentIds.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No parents/guardians linked. Edit this student to link one."));
  } else {
    for (const pid of parentIds) {
      const p = parents.find((x) => x.id === pid);
      if (!p) continue;
      panel.append(
        el("div", { class: "parent-card" }, [
          el("div", {}, [
            el("div", { class: "name" }, p.fullName),
            el("div", { class: "meta" }, p.relationship || "Parent/Guardian"),
          ]),
          el("div", { class: "meta" }, [p.phone || "No phone", p.email ? ` · ${p.email}` : ""].join("")),
        ])
      );
    }
  }

  if ((student.statusHistory || []).length) {
    panel.append(el("h3", { class: "section-title" }, "Status History"));
    const timeline = el("div", { class: "md3-timeline" });
    for (const h of [...student.statusHistory].reverse()) {
      timeline.append(
        el("div", { class: "md3-timeline-item" }, [
          el("div", { class: "md3-timeline-icon" }, [icon("history")]),
          el("div", { class: "md3-timeline-content" }, [
            el("div", { class: "text" }, `Marked ${h.status}${h.reason ? ` — ${h.reason}` : ""}`),
            el("div", { class: "time text-xs text-muted" }, h.at ? formatDate(h.at) : ""),
          ]),
        ])
      );
    }
    panel.append(timeline);
  }
}

function statChip(label, value, tone = "") {
  return el("div", { class: `profile-stat${tone ? ` profile-stat--${tone}` : ""}` }, [
    el("div", { class: "profile-stat__label" }, label),
    el("div", { class: "profile-stat__value" }, value),
  ]);
}

async function renderAcademicTab(panel, profile, student, refreshAll) {
  panel.innerHTML = "";
  panel.append(loadingRow());
  const results = await listResultsForStudent(student.id).catch(() => []);
  const sorted = [...results].sort((a, b) => (b.academicYear + b.term).localeCompare(a.academicYear + a.term));

  panel.innerHTML = "";
  if (!sorted.length) {
    panel.append(el("div", { class: "empty-state" }, [
      icon("school", "empty-state__icon"),
      el("h3", {}, "No computed results yet"),
      el("p", {}, "Results appear here once a term's marks are computed and saved under Grading & Positions."),
    ]));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Year"), el("th", {}, "Term"), el("th", {}, "Class"), el("th", {}, "Mean %"),
      el("th", {}, "Grade"), el("th", {}, "Points"), el("th", {}, "Class Pos"), el("th", {}, "Overall Pos"), el("th", {}, "Mode"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const r of sorted) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Year" }, String(r.academicYear || "N/A")),
      el("td", { "data-label": "Term" }, r.term || "N/A"),
      el("td", { "data-label": "Class" }, `${r.grade || "N/A"} ${r.stream || ""}`),
      el("td", { "data-label": "Mean %" }, `${r.meanMarks?.toFixed(2) ?? "N/A"}%`),
      el("td", { "data-label": "Grade" }, el("span", { class: "badge badge--gold" }, r.meanGrade || "N/A")),
      el("td", { "data-label": "Points" }, String(r.totalPoints ?? "N/A")),
      el("td", { "data-label": "Class Pos" }, r.classPosition ? `${r.classPosition}/${r.streamClassSize}` : "N/A"),
      el("td", { "data-label": "Overall Pos" }, r.overallPosition ? `${r.overallPosition}/${r.classSize}` : "N/A"),
      el("td", { "data-label": "Mode" }, reportModeLabel(r.reportMode)),

    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  panel.append(tableWrap);
}

async function renderFeesTab(panel, profile, student) {
  panel.innerHTML = "";
  panel.append(loadingRow());
  const [structures, payments] = await Promise.all([
    listFeeStructures().catch(() => []),
    listPaymentsForStudent(student.id).catch(() => []),
  ]);

  const periods = new Map(); // "grade|year|term" -> { grade, academicYear, term, expected, paid }
  for (const p of payments) {
    const key = `${p.grade}|${p.academicYear}|${p.term}`;
    if (!periods.has(key)) periods.set(key, { grade: p.grade, academicYear: p.academicYear, term: p.term, expected: 0, paid: 0 });
    periods.get(key).paid += Number(p.amount) || 0;
  }
  for (const s of structures.filter((s) => s.grade === student.grade)) {
    const key = `${s.grade}|${s.academicYear}|${s.term}`;
    if (!periods.has(key)) periods.set(key, { grade: s.grade, academicYear: s.academicYear, term: s.term, expected: 0, paid: 0 });
  }
  for (const period of periods.values()) {
    const match = structures.find((s) => s.grade === period.grade && s.academicYear === period.academicYear && s.term === period.term);
    period.expected = match ? Number(match.amount) || 0 : 0;
    period.balance = period.expected - period.paid;
  }
  const ledgerRows = [...periods.values()].sort((a, b) => (b.academicYear + b.term).localeCompare(a.academicYear + a.term));
  const totalBalance = ledgerRows.reduce((sum, r) => sum + Math.max(r.balance, 0), 0);

  panel.innerHTML = "";

  panel.append(
    el("div", { class: "profile-stats" }, [
      statChip("Total Outstanding", formatKES(totalBalance), totalBalance > 0 ? "warn" : "good"),
      statChip("Payments Recorded", String(payments.length)),
    ]),
    el("div", { style: "display:flex; justify-content:flex-end; margin-bottom:12px;" }, [
      el("button", { class: "btn btn--primary btn--sm", onClick: () => openPaymentForm(profile, student, () => renderFeesTab(panel, profile, student)) }, [icon("add_card"), "Record Payment"]),
    ])
  );

  panel.append(el("h3", { class: "section-title" }, "Fee Ledger by Term"));
  if (!ledgerRows.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No fee structure or payments found for this student's grade yet."));
  } else {
    const ledgerWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "margin-bottom:20px;" });
    const ledgerTable = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Year"), el("th", {}, "Term"), el("th", {}, "Class"), el("th", {}, "Expected"), el("th", {}, "Paid"), el("th", {}, "Balance"), el("th", {}, "Status"),
      ])),
    ]);
    const ledgerBody = el("tbody", {});
    for (const r of ledgerRows) {
      const statusTone = r.balance <= 0 ? "success" : (r.paid > 0 ? "gold" : "danger");
      const statusLabel = r.balance <= 0 ? "Paid" : (r.paid > 0 ? "Partial" : "Owing");
      ledgerBody.append(el("tr", {}, [
        el("td", { "data-label": "Year" }, String(r.academicYear || "N/A")),
        el("td", { "data-label": "Term" }, r.term || "N/A"),
        el("td", { "data-label": "Class" }, r.grade || "N/A"),
        el("td", { "data-label": "Expected" }, formatKES(r.expected)),
        el("td", { "data-label": "Paid" }, formatKES(r.paid)),
        el("td", { "data-label": "Balance" }, formatKES(Math.max(r.balance, 0))),
        el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${statusTone}` }, statusLabel)),
      ]));
    }
    ledgerTable.append(ledgerBody);
    ledgerWrap.append(ledgerTable);
    panel.append(ledgerWrap);
  }

  panel.append(el("h3", { class: "section-title" }, "Payment History"));
  if (!payments.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No payments recorded yet."));
  } else {
    const payWrap = el("div", { class: "table-wrap table-wrap--responsive" });
    const payTable = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Date"), el("th", {}, "Year"), el("th", {}, "Term"), el("th", {}, "Amount"), el("th", {}, "Method"), el("th", {}, "Reference"),
      ])),
    ]);
    const payBody = el("tbody", {});
    for (const p of payments) {
      payBody.append(el("tr", {}, [
        el("td", { "data-label": "Date" }, formatDate(p.date)),
        el("td", { "data-label": "Year" }, String(p.academicYear || "N/A")),
        el("td", { "data-label": "Term" }, p.term || "N/A"),
        el("td", { "data-label": "Amount" }, formatKES(p.amount)),
        el("td", { "data-label": "Method" }, p.method || "N/A"),
        el("td", { "data-label": "Reference" }, p.reference || "—"),
      ]));
    }
    payTable.append(payBody);
    payWrap.append(payTable);
    panel.append(payWrap);
  }
}

async function renderAttendanceTab(panel, profile, student) {
  panel.innerHTML = "";
  panel.append(loadingRow());
  const year = settings.currentAcademicYear || "";
  const term = settings.currentTerm || "";
  const dayDocs = year && term ? await listAttendanceForClassPeriod(student.grade, student.stream, year, term).catch(() => []) : [];
  const summary = summarizeForRoster(dayDocs, [student.id]);
  const s = summary.perStudent[student.id] || { present: 0, absent: 0, late: 0, excused: 0, marked: 0, percentage: null };

  panel.innerHTML = "";
  panel.append(
    el("p", { class: "text-sm text-muted", style: "margin-bottom:16px;" }, `Showing ${term || "current term"} ${year || ""} (${student.grade || "N/A"} ${student.stream || ""}).`),
    el("div", { class: "profile-stats" }, [
      statChip("Attendance Rate", s.percentage === null ? "N/A" : `${s.percentage}%`, s.percentage !== null && s.percentage < 75 ? "warn" : "good"),
      statChip("Days Marked", String(s.marked)),
      statChip("Present", String(s.present), "good"),
      statChip("Absent", String(s.absent), s.absent ? "warn" : ""),
      statChip("Late", String(s.late)),
      statChip("Excused", String(s.excused)),
    ])
  );

  panel.append(el("h3", { class: "section-title" }, "Recent Days"));
  const recent = [...dayDocs].slice(-15).reverse();
  if (!recent.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No attendance has been marked for this class yet this term."));
    return;
  }
  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [el("thead", {}, el("tr", {}, [el("th", {}, "Date"), el("th", {}, "Status")]))]);
  const tbody = el("tbody", {});
  for (const day of recent) {
    const status = day.records?.[student.id] || "not marked";
    const tone = { present: "success", late: "gold", excused: "muted", absent: "danger" }[status] || "muted";
    tbody.append(el("tr", {}, [el("td", { "data-label": "Date" }, formatDate(day.date)), el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${tone}` }, status))]));
  }
  table.append(tbody);
  tableWrap.append(table);
  panel.append(tableWrap);
}

async function renderActivityTab(panel, profile, student, refreshAll) {
  panel.innerHTML = "";
  panel.append(loadingRow());
  const [logs, issues] = await Promise.all([
    listLogsForEntity("students", student.id, 30).catch(() => []),
    listIssuesForStudent(student.id).catch(() => []),
  ]);

  panel.innerHTML = "";

  panel.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;" }, [
      el("h3", { class: "section-title", style: "margin:0;" }, "Issues Raised"),
      el("button", { class: "btn btn--danger btn--sm", onClick: () => openIssueForm(profile, student, null, refreshAll) }, [icon("report"), "Raise Issue"]),
    ])
  );
  if (!issues.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No issues raised for this student. Good record!"));
  } else {
    for (const issue of issues) {
      const isOpen = issue.status === "open";
      panel.append(
        el("div", { class: `issue-item issue-item--${issue.status}` }, [
          el("div", { class: "issue-item__head" }, [
            el("div", {}, [
              el("span", { class: `badge badge--${isOpen ? "danger" : "success"}` }, isOpen ? "Open" : "Resolved"),
              el("span", { class: "badge badge--muted", style: "margin-left:6px;" }, issueCategoryLabel(issue.category)),
            ]),
            isOpen
              ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => openResolveIssueForm(profile, issue, refreshAll) }, [icon("check_circle"), "Resolve"])
              : "",
          ]),
          el("p", { class: "issue-item__desc" }, issue.description),
          issue.context ? el("p", { class: "issue-item__meta" }, `Regarding: ${issue.context.term || ""} ${issue.context.academicYear || ""}`.trim()) : "",
          el("p", { class: "issue-item__meta" }, `Raised ${issue.raisedAt ? formatDate(issue.raisedAt) : "recently"}`),
          issue.status === "resolved" && issue.resolutionNote
            ? el("p", { class: "issue-item__meta" }, `Resolution: ${issue.resolutionNote}`)
            : "",
        ])
      );
    }
  }

  panel.append(el("h3", { class: "section-title", style: "margin-top:24px;" }, "Activity Log"));
  const ACTION_LABELS = {
    admit_student: { icon: "person_add", text: "Student admitted" },
    edit_student: { icon: "edit", text: "Student details edited" },
    transfer_student: { icon: "swap_horiz", text: "Transferred / promoted" },
    active_student: { icon: "restart_alt", text: "Reinstated" },
    suspended_student: { icon: "pause_circle", text: "Suspended" },
    archived_student: { icon: "archive", text: "Archived" },
    raise_student_issue: { icon: "report", text: "Issue raised" },
    resolve_student_issue: { icon: "check_circle", text: "Issue resolved" },
  };
  if (!logs.length) {
    panel.append(el("p", { class: "text-sm text-muted" }, "No recorded activity yet."));
    return;
  }
  const timeline = el("div", { class: "md3-timeline" });
  for (const log of logs) {
    const meta = ACTION_LABELS[log.action] || { icon: "history", text: log.action.replace(/_/g, " ") };
    timeline.append(
      el("div", { class: "md3-timeline-item" }, [
        el("div", { class: "md3-timeline-icon" }, [icon(meta.icon)]),
        el("div", { class: "md3-timeline-content" }, [
          el("div", { class: "text" }, meta.text),
          el("div", { class: "time text-xs text-muted" }, log.timestamp ? formatDate(log.timestamp) : "Just now"),
        ]),
      ])
    );
  }
  panel.append(timeline);
}

// ---------------------------------------------------------------------
// Status change (suspend/reinstate/archive) with a captured reason
// ---------------------------------------------------------------------

function openStatusChangeModal(profile, student, status, onDone) {
  const label = STATUS_ACTION_LABEL[status] || status;
  const reasonRequired = status === "suspended";
  const body = el("form", {});
  body.append(
    el("p", { class: "text-sm" }, `Mark ${student.fullName} as ${status}.`),
    el("div", { class: "field" }, [
      el("label", {}, reasonRequired ? "Reason for suspension (required)" : "Note (optional)"),
      el("textarea", { id: "status-reason", rows: "3" }, ""),
    ]),
    el("button", { type: "submit", class: `btn ${status === "active" ? "btn--primary" : "btn--danger"} btn--block` }, [icon("check"), `Confirm: ${label}`])
  );
  const close = openModal(`${label}: ${student.fullName}`, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = document.getElementById("status-reason").value.trim();
    if (reasonRequired && !reason) return toast("Please provide a reason for the suspension.", "error");
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await setStudentStatus(profile.uid, student.id, status, reason);
      toast(`${student.fullName} marked ${status}.`, "success");
      close();
      student.status = status;
      student.suspensionReason = status === "suspended" ? reason : "";
      student.statusHistory = [...(student.statusHistory || []), { status, reason, by: profile.uid, at: new Date().toISOString() }];
      await refresh(profile);
      onDone?.();
    } catch (err) {
      toast(err.message || "Could not update status.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------------------------
// Raise / resolve an issue
// ---------------------------------------------------------------------

function openIssueForm(profile, student, context, onDone) {
  const body = el("form", {});
  const categorySelect = el("select", { id: "issue-category" }, ISSUE_CATEGORIES.map((c) => el("option", { value: c.value }, c.label)));
  body.append(
    context ? el("p", { class: "text-sm text-muted" }, `Regarding: ${context.term || ""} ${context.academicYear || ""}`.trim()) : "",
    el("div", { class: "field" }, [el("label", {}, "Category"), categorySelect]),
    el("div", { class: "field" }, [el("label", {}, "Describe the issue"), el("textarea", { id: "issue-description", rows: "4", placeholder: "e.g. Parent says Math CAT 2 score of 45 should be 54 please recheck the marked script." }, "")]),
    el("button", { type: "submit", class: "btn btn--danger btn--block" }, [icon("report"), "Raise Issue"])
  );
  const close = openModal(`Raise Issue: ${student.fullName}`, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await raiseIssue(profile.uid, {
        studentId: student.id,
        studentName: student.fullName,
        admissionNumber: student.admissionNumber,
        category: categorySelect.value,
        description: document.getElementById("issue-description").value,
        context,
      });
      openIssueCounts.set(student.id, (openIssueCounts.get(student.id) || 0) + 1);
      toast("Issue raised. It's now tracked against this student.", "success");
      close();
      await refresh(profile);
      onDone?.();
    } catch (err) {
      toast(err.message || "Could not raise this issue.", "error");
      restore();
    }
  });
}

function openResolveIssueForm(profile, issue, onDone) {
  const body = el("form", {});
  body.append(
    el("p", { class: "text-sm" }, issue.description),
    el("div", { class: "field" }, [el("label", {}, "Resolution note"), el("textarea", { id: "resolve-note", rows: "3", placeholder: "What was done to fix this?" }, "")]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("check_circle"), "Mark Resolved"])
  );
  const close = openModal("Resolve Issue", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await resolveIssue(profile.uid, issue.id, document.getElementById("resolve-note").value);
      const remaining = (openIssueCounts.get(issue.studentId) || 1) - 1;
      if (remaining > 0) openIssueCounts.set(issue.studentId, remaining);
      else openIssueCounts.delete(issue.studentId);
      toast("Issue marked resolved.", "success");
      close();
      await refresh(profile);
      onDone?.();
    } catch (err) {
      toast(err.message || "Could not resolve this issue.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------------------------
// Record a fee payment from within the profile
// ---------------------------------------------------------------------

function openPaymentForm(profile, student, onDone) {
  const body = el("form", {});
  const yearInput = el("input", { id: "pay-year", type: "text", value: settings?.currentAcademicYear || "" });
  const termSelect = el("select", { id: "pay-term" }, (settings?.terms || []).map((t) =>
    el("option", { value: t, ...(t === settings?.currentTerm ? { selected: "true" } : {}) }, t)
  ));
  const methodSelect = el("select", { id: "pay-method" }, PAYMENT_METHODS.map((m) => el("option", { value: m }, m)));

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [el("label", {}, "Amount (KES)"), el("input", { id: "pay-amount", type: "number", min: "1", step: "0.01" })]),
    el("div", { class: "field" }, [el("label", {}, "Method"), methodSelect]),
    el("div", { class: "field" }, [el("label", {}, "Reference (optional)"), el("input", { id: "pay-reference", type: "text" })]),
    el("div", { class: "field" }, [el("label", {}, "Date"), datePickerInput({ id: "pay-date", value: new Date().toISOString().slice(0, 10) })]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("add_card"), "Record Payment"])
  );
  const close = openModal(`Record Payment: ${student.fullName}`, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await recordPayment(profile.uid, {
        studentId: student.id,
        studentName: student.fullName,
        grade: student.grade,
        stream: student.stream,
        academicYear: yearInput.value.trim(),
        term: termSelect.value,
        amount: document.getElementById("pay-amount").value,
        method: methodSelect.value,
        reference: document.getElementById("pay-reference").value.trim(),
        date: document.getElementById("pay-date").value,
      });
      toast("Payment recorded.", "success");
      close();
      onDone?.();
    } catch (err) {
      toast(err.message || "Could not record payment.", "error");
      restore();
    }
  });
}

// ---------------------------------------------------------------------
// Transfer / promote
// ---------------------------------------------------------------------

function openTransferForm(profile, student, onDone) {
  const body = el("div", {});
  const gradeSelect = el("select", { id: "t-grade" }, classes.map((c) =>
    el("option", { value: c.grade, ...(c.grade === student.grade ? { selected: "true" } : {}) }, c.grade)
  ));
  const streamSelect = el("select", { id: "t-stream" });
  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    const cls = classes.find((c) => c.grade === grade);
    (cls?.streams || []).forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === student.stream ? { selected: "true" } : {}) }, s))
    );
  }
  fillStreams(student.grade);
  gradeSelect.addEventListener("change", (e) => fillStreams(e.target.value));

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--primary", onClick: async (e) => {
        const restore = busyButton(e.currentTarget, "Moving…");
        try {
          await transferStudent(profile.uid, student.id, gradeSelect.value, streamSelect.value);
          toast("Student moved.", "success");
          close();
          student.grade = gradeSelect.value;
          student.stream = streamSelect.value;
          await refresh(profile);
          onDone?.();
        } catch (err) {
          toast(err.message || "Could not move student.", "error");
          restore();
        }
      }}, [icon("swap_horiz"), "Move student"]),
    ])
  );
  const close = openModal(`Transfer / Promote: ${student.fullName}`, body);
}

// ---------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------

const STATUS_LABEL = { ready: "Ready", warning: "Needs review", blocked: "Blocked" };
const STATUS_BADGE = { ready: "success", warning: "gold", blocked: "danger" };

function openImportModal(profile) {
  if (!classes.length) {
    toast("Please set up classes and streams under Academics before importing students.", "error");
    location.hash = "#/academics";
    return;
  }
  const body = el("div", {});
  const fileInput = el("input", {
    type: "file",
    accept: ".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv",
  });
  const previewArea = el("div", {});
  const instructions = el("p", { class: "text-sm text-muted" },
    "Upload an Excel (.xlsx) or CSV file with the essential details (Name, Class, Stream, Gender, Adm No, Assessment No). Additional details like medical info, address, and parent contacts can be added later from each student's profile."
  );
  body.append(
    instructions,
    el("div", { style: "display:flex; gap:8px; align-items:center; margin-bottom:16px; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: async (e) => {
          const restore = busyButton(e.currentTarget, "Preparing…");
          try {
            await downloadTemplateXlsx("students-import-template.xlsx", classes);
          } catch (err) {
            toast(err.message || "Failed to download Excel template.", "error");
          } finally {
            restore();
          }
        },
      }, [icon("download"), "Download Excel Template (.xlsx)"]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => downloadCsv("students-import-template.csv", buildTemplateCsv(classes)),
      }, [icon("download"), "Download CSV Template"]),
      fileInput,
    ]),
    previewArea
  );
  const close = openModal("Import Students", body, "modal--wide");

  // rowNumber -> action override ("create" | "update" | "skip"), so a
  // user's choice survives re-validation after they fix a field.
  const actionOverrides = new Map();
  let rawRows = [];

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    previewArea.innerHTML = "";
    previewArea.append(el("div", { class: "loading-row" }, [spinner("sm", "dark"), " Reading spreadsheet…"]));

    let result;
    try {
      result = await parseStudentsFile(file);
    } catch {
      toast("Could not read that file.", "error");
      previewArea.innerHTML = "";
      return;
    }
    const { rows, error } = result;
    if (error) {
      previewArea.innerHTML = "";
      previewArea.append(el("div", { class: "empty-state" }, [icon("error", "empty-state__icon"), el("p", {}, error)]));
      return;
    }
    if (!rows.length) {
      previewArea.innerHTML = "";
      toast("No data rows found in that file.", "error");
      return;
    }
    rawRows = rows;
    actionOverrides.clear();
    renderPreview();
  });

  function annotate() {
    const annotated = validateStudentRows(rawRows, { classes, existingStudents: students });
    for (const row of annotated) {
      if (row.status === "blocked") { row.action = "skip"; continue; }
      const override = actionOverrides.get(row.rowNumber);
      if (override) row.action = override;
    }
    return annotated;
  }

  function renderPreview() {
    previewArea.innerHTML = "";
    const annotated = annotate();
    const counts = { ready: 0, warning: 0, blocked: 0 };
    for (const r of annotated) counts[r.status]++;
    const importable = annotated.filter((r) => r.action !== "skip");

    previewArea.append(
      el("div", { style: "display:flex; gap:16px; align-items:center; margin-bottom:12px; flex-wrap:wrap;" }, [
        el("span", { class: "badge badge--success" }, `${counts.ready} ready`),
        el("span", { class: "badge badge--gold" }, `${counts.warning} need review`),
        el("span", { class: "badge badge--danger" }, `${counts.blocked} blocked`),
        counts.warning || counts.blocked
          ? el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => downloadCsv("import-issues.csv", buildErrorReportCsv(annotated.filter((r) => r.status !== "ready"))) }, [icon("download"), "Download issues report"])
          : "",
      ])
    );

    const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "margin-bottom:16px; max-height:420px; overflow:auto;" });
    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, ""), el("th", {}, "Status"), el("th", {}, "Full Name"), el("th", {}, "Adm. No."),
        el("th", {}, "Gender"), el("th", {}, "Grade"), el("th", {}, "Stream"), el("th", {}, "DOB"), el("th", {}, "Assessment No."), el("th", {}, "Issues"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const row of annotated) tbody.append(renderPreviewRow(row));
    table.append(tbody);
    tableWrap.append(table);
    previewArea.append(tableWrap);

    previewArea.append(
      el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
        el("button", {
          type: "button",
          class: "btn btn--primary",
          ...(importable.length ? {} : { disabled: "true" }),
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Importing…");
            try {
              const result = await commitStudentRows(profile.uid, importable);
              toast(`Imported ${result.created} new and updated ${result.updated} existing student(s).`, "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Import failed - nothing was changed for rows that didn't complete.", "error");
              restore();
            }
          },
        }, [icon("upload_file"), `Import ${importable.length} row${importable.length === 1 ? "" : "s"}`]),
      ])
    );

    // rowNumber -> raw field edit, then re-validate and redraw. `change`
    // fires on blur for text inputs (so it doesn't fight the user mid-
    // keystroke) and immediately for selects.
    function renderPreviewRow(row) {
      const tr = el("tr", {});
      const setRaw = (field, value) => { row.raw[field] = value; renderPreview(); };

      const nameInput = el("input", { value: row.raw.fullName, style: "min-width:140px;" });
      nameInput.addEventListener("change", () => setRaw("fullName", nameInput.value));

      const admInput = el("input", { value: row.data.admissionNumber, style: "min-width:110px;" });
      admInput.addEventListener("change", () => setRaw("admissionNumber", admInput.value));

      const genderSelect = el("select", {}, ["", "Male", "Female"].map((g) =>
        el("option", { value: g, ...(row.data.gender === g ? { selected: "true" } : {}) }, g || "—")
      ));
      genderSelect.addEventListener("change", () => setRaw("gender", genderSelect.value));

      const gradeSelect = el("select", {}, [
        el("option", { value: "" }, "—"),
        ...classes.map((c) => el("option", { value: c.grade, ...(row.data.grade === c.grade ? { selected: "true" } : {}) }, c.grade)),
      ]);
      gradeSelect.addEventListener("change", () => { row.raw.stream = ""; setRaw("grade", gradeSelect.value); });

      const cls = classes.find((c) => c.grade === row.data.grade);
      const streamSelect = el("select", {}, [
        el("option", { value: "" }, "—"),
        ...(cls?.streams || []).map((s) => el("option", { value: s, ...(row.data.stream === s ? { selected: "true" } : {}) }, s)),
      ]);
      streamSelect.addEventListener("change", () => setRaw("stream", streamSelect.value));

      const dobInput = el("input", { type: "text", value: row.raw.dob, placeholder: "YYYY-MM-DD", style: "min-width:100px;" });
      dobInput.addEventListener("change", () => setRaw("dob", dobInput.value));

      const assessInput = el("input", { value: row.raw.kcpeNumber || "", placeholder: "Optional", style: "min-width:110px;" });
      assessInput.addEventListener("change", () => setRaw("kcpeNumber", assessInput.value));

      const issuesCell = el("div", { style: "font-size:var(--fs-xs);" }, row.issues.map((i) => el("div", { class: i.level === "blocked" ? "text-red" : "text-muted" }, i.message)));

      let actionControl;
      if (row.status === "blocked") {
        actionControl = el("span", { class: "text-xs text-muted" }, "Fix required");
      } else if (row.duplicateOf) {
        actionControl = el("select", {}, [
          el("option", { value: "skip", ...(row.action === "skip" ? { selected: "true" } : {}) }, "Skip (duplicate)"),
          el("option", { value: "update", ...(row.action === "update" ? { selected: "true" } : {}) }, "Update existing"),
          el("option", { value: "create", ...(row.action === "create" ? { selected: "true" } : {}) }, "Add as new anyway"),
        ]);
        actionControl.addEventListener("change", () => { actionOverrides.set(row.rowNumber, actionControl.value); renderPreview(); });
      } else {
        const checkbox = el("input", { type: "checkbox", ...(row.action !== "skip" ? { checked: "true" } : {}) });
        checkbox.addEventListener("change", () => { actionOverrides.set(row.rowNumber, checkbox.checked ? "create" : "skip"); renderPreview(); });
        actionControl = checkbox;
      }

      tr.append(
        el("td", { "data-label": "Include" }, actionControl),
        el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${STATUS_BADGE[row.status]}` }, STATUS_LABEL[row.status])),
        el("td", { "data-label": "Full Name" }, nameInput),
        el("td", { "data-label": "Adm. No." }, admInput),
        el("td", { "data-label": "Gender" }, genderSelect),
        el("td", { "data-label": "Grade" }, gradeSelect),
        el("td", { "data-label": "Stream" }, streamSelect),
        el("td", { "data-label": "DOB" }, dobInput),
        el("td", { "data-label": "Assessment No." }, assessInput),
        el("td", { "data-label": "Issues" }, issuesCell),
      );
      return tr;
    }
  }
}

function openStudentForm(profile, existing = null, onDone) {
  if (!classes.length && !existing) {
    toast("Please set up classes and streams under Academics before adding students.", "error");
    location.hash = "#/academics";
    return;
  }
  const isEdit = !!existing;
  const body = el("form", {});

  const gradeSelect = el("select", { id: "s-grade" }, classes.map((c) =>
    el("option", { value: c.grade, ...(c.grade === existing?.grade ? { selected: "true" } : {}) }, c.grade)
  ));
  const streamSelect = el("select", { id: "s-stream" });
  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    const cls = classes.find((c) => c.grade === grade);
    (cls?.streams || []).forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === existing?.stream ? { selected: "true" } : {}) }, s))
    );
  }
  fillStreams(existing?.grade || classes[0]?.grade);
  gradeSelect.addEventListener("change", (e) => fillStreams(e.target.value));

  const genderSelect = el("select", { id: "s-gender" }, [
    el("option", { value: "Male", ...(existing?.gender === "Male" ? { selected: "true" } : {}) }, "Male"),
    el("option", { value: "Female", ...(existing?.gender === "Female" ? { selected: "true" } : {}) }, "Female"),
  ]);

  const parentChecklist = el("div", { class: "checklist" });
  const selectedParentIds = new Set(existing?.parentIds || []);
  if (!parents.length) {
    parentChecklist.append(el("p", { class: "text-sm text-muted" }, "No parents yet - add one from the Parents page, then link them here."));
  }
  for (const p of parents) {
    const checkbox = el("input", { type: "checkbox", value: p.id, ...(selectedParentIds.has(p.id) ? { checked: "true" } : {}) });
    parentChecklist.append(el("label", { class: "checklist-item" }, [checkbox, `${p.fullName} (${p.relationship || "parent"})`]));
  }

  body.append(
    field("s-admissionNumber", "Admission Number", existing?.admissionNumber),
    field("s-fullName", "Full Name", existing?.fullName),
    el("div", { class: "field" }, [el("label", {}, "Gender"), genderSelect]),
    field("s-dob", "Date of Birth", existing?.dob, "date"),
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    field("s-address", "Address", existing?.address),
    field("s-phone", "Phone", existing?.phone),
    field("s-previousSchool", "Previous School", existing?.previousSchool),
    field("s-kcpeNumber", "KCPE/Assessment Number", existing?.kcpeNumber),
    el("div", { class: "field" }, [el("label", {}, "Medical Information"), el("textarea", { id: "s-medicalInfo", rows: "2" }, existing?.medicalInfo || "")]),
    isStarterPlan(getCurrentSchool())
      ? el("div", { class: "field" }, [el("label", {}, "Photo"), el("p", { class: "text-sm text-muted", style: "margin:0" }, "Upgrade to Growth to add student photos.")])
      : el("div", { class: "field" }, [el("label", {}, "Photo"), el("input", { type: "file", id: "s-photo", accept: "image/*" })]),
    el("div", { class: "field" }, [el("label", {}, "Linked Parents/Guardians"), parentChecklist]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "person_add"), isEdit ? "Save changes" : "Register student"]),
  );

  const close = openModal(isEdit ? `Edit: ${existing.fullName}` : "New Admission", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = val("s-fullName");
    const grade = gradeSelect.value;
    const stream = streamSelect.value;

    if (!fullName) return toast("Full Name is required.", "error");
    if (!grade) return toast("Please select a Grade.", "error");
    const cls = classes.find((c) => c.grade === grade);
    if (cls?.streams?.length && !stream) {
      return toast(`Stream is required for ${cls.grade}. Please choose a stream.`, "error");
    }

    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Registering…");
    const photoFile = document.getElementById("s-photo")?.files[0];
    const parentIds = Array.from(parentChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const data = {
      admissionNumber: val("s-admissionNumber"),
      fullName,
      gender: genderSelect.value,
      dob: val("s-dob"),
      grade: gradeSelect.value,
      stream: streamSelect.value,
      address: val("s-address"),
      phone: val("s-phone"),
      previousSchool: val("s-previousSchool"),
      kcpeNumber: val("s-kcpeNumber"),
      medicalInfo: document.getElementById("s-medicalInfo").value.trim(),
      parentIds,
    };
    try {
      if (isEdit) {
        await updateStudent(profile.uid, existing.id, data, photoFile, existing.parentIds || []);
        toast("Student updated.", "success");
        Object.assign(existing, data);
      } else {
        await registerStudent(profile.uid, data, photoFile);
        toast("Student registered.", "success");
      }
      close();
      await refresh(profile);
      onDone?.();
    } catch (err) {
      toast(err.message || "Could not save student.", "error");
      restore();
    }
  });
}

function field(id, label, value = "", type = "text") {
  if (type === "date") {
    return datePickerField(id, label, value, { maxDate: id === "s-dob" ? "today" : undefined });
  }
  return el("div", { class: "field" }, [el("label", { for: id }, label), el("input", { id, type, value: value || "" })]);
}
function val(id) {
  return document.getElementById(id).value.trim();
}

export function init() {}