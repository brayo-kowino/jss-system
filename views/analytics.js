import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listTeachers } from "../js/services/teacher.service.js";
import { listParents } from "../js/services/parent.service.js";
import { listResultsByPeriod } from "../js/services/grading.service.js";
import { listFeeStatusesForPeriod, backfillAllFeeStatuses, formatKES } from "../js/services/fee.service.js";
import {
  el,
  icon,
  toast,
  spinner,
  escapeHtml,
  mobileOnlyNotice,
  busyButton,
  getBrandColors,
  hexToRgba,
} from "../js/utils.js";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

let classes = [];
let subjects = [];
let settings = null;
let students = [];
let teachers = [];
let parents = [];
let currentReportType = "top-students";
let selection = { grade: "", academicYear: "", term: "" };
let activeChart = null;

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ST";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function cleanPhoneForWhatsApp(phone = "") {
  let cleaned = String(phone).replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("0")) cleaned = "254" + cleaned.slice(1);
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  return cleaned;
}

/**
 * Dynamic Academic Data Analyst & Intelligence Mascot with analytical tablet and rising histogram.
 */
export function buildAnalyticsMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="analytics-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia School Analytics Intelligence Mascot">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Academic Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Digital Analytics Tablet with Trend Line -->
        <g class="analytics-mascot__tablet">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Tablet screen -->
          <rect x="52" y="122" width="30" height="38" rx="3.5" fill="#0B2545" stroke="#14538A" stroke-width="1.6" transform="rotate(-6 67 141)" />
          <rect x="55" y="126" width="24" height="28" rx="2" fill="#1E293B" transform="rotate(-6 67 141)" />
          <!-- Grid lines -->
          <line x1="57" y1="134" x2="77" y2="134" stroke="#334155" stroke-width="1" transform="rotate(-6 67 141)" />
          <line x1="57" y1="142" x2="77" y2="142" stroke="#334155" stroke-width="1" transform="rotate(-6 67 141)" />
          <line x1="57" y1="150" x2="77" y2="150" stroke="#334155" stroke-width="1" transform="rotate(-6 67 141)" />
          <!-- Neon Green Rising Trend Line -->
          <polyline points="57,149 63,143 69,146 76,132" fill="none" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-6 67 141)" />
          <!-- Hand Holding Tablet -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Rising 3-Column Histogram with Animated Gleam -->
        <g class="analytics-mascot__chart">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- 3-Bar Analytical Histogram -->
          <g class="analytics-mascot__bars" transform="translate(142, 82)">
            <!-- Bar 1 -->
            <rect x="0" y="16" width="7" height="14" rx="1.5" fill="#3B82F6" />
            <!-- Bar 2 -->
            <rect x="9" y="8" width="7" height="22" rx="1.5" fill="#F59E0B" />
            <!-- Bar 3 -->
            <rect x="18" y="0" width="7" height="30" rx="1.5" fill="#10B981" />
            <!-- Apex Star Sparkle -->
            <polygon points="21.5,-8 23,-5 26,-3.5 23,-2 21.5,1 20,-2 17,-3.5 20,-5" fill="#FEF08A" />
          </g>
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Analytical Eyebrows -->
        <path d="M89,75 Q97,70 103,74" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,75 Q123,70 117,74" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

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

        <!-- Focused Smile -->
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

const RESULT_MODE_PRIORITY = ["average", "endterm", "midterm"];

function pickBestPerStudent(docs) {
  const byStudent = new Map();
  for (const r of docs) {
    const key = r.studentId || r.id;
    const existing = byStudent.get(key);
    if (!existing) {
      byStudent.set(key, r);
      continue;
    }
    const existingRank = RESULT_MODE_PRIORITY.indexOf(existing.reportMode || "average");
    const candidateRank = RESULT_MODE_PRIORITY.indexOf(r.reportMode || "average");
    if (candidateRank !== -1 && (existingRank === -1 || candidateRank < existingRank)) {
      byStudent.set(key, r);
    }
  }
  return [...byStudent.values()];
}

async function fetchTargetedResults() {
  if (selection.grade) {
    const docs = await listResultsByPeriod({
      grade: selection.grade,
      stream: "",
      academicYear: selection.academicYear,
      term: selection.term,
    });
    return pickBestPerStudent(docs);
  }

  const perGrade = await Promise.all(
    classes.map((c) =>
      listResultsByPeriod({
        grade: c.grade,
        stream: "",
        academicYear: selection.academicYear,
        term: selection.term,
      })
    )
  );
  return perGrade.flatMap((docs) => pickBestPerStudent(docs));
}

function resetChart() {
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }
}

export async function render({ profile }) {
  [classes, subjects, settings, students, teachers, parents] = await Promise.all([
    listClasses(),
    listSubjects(),
    getSchoolSettings(),
    listStudents(),
    listTeachers(),
    listParents().catch(() => []),
  ]);

  selection.academicYear = settings.currentAcademicYear || new Date().getFullYear();
  selection.term = settings.currentTerm || (settings.terms || [])[0] || "Term 1";

  const wrap = el("div", { class: "analytics-page" });

  // 1. Executive Hero Banner with Dynamic Analytics Mascot
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildAnalyticsMascotSvg({ width: 125, height: 110 });

  // 2. Numeric KPI Metric Chips
  const kpiRow = el("div", { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" }, [
    el("div", { class: "md3-kpi-chip md3-kpi-chip--blue" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon("school")]),
      el("div", { class: "md3-kpi-chip__content" }, [
        el("div", { class: "md3-kpi-chip__value" }, String(students.length)),
        el("div", { class: "md3-kpi-chip__label" }, "Enrolled Students"),
      ]),
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--blue" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon("badge")]),
      el("div", { class: "md3-kpi-chip__content" }, [
        el("div", { class: "md3-kpi-chip__value" }, String(teachers.length)),
        el("div", { class: "md3-kpi-chip__label" }, "Teaching Faculty"),
      ]),
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--green" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon("menu_book")]),
      el("div", { class: "md3-kpi-chip__content" }, [
        el("div", { class: "md3-kpi-chip__value" }, String(subjects.length)),
        el("div", { class: "md3-kpi-chip__label" }, "Curriculum Subjects"),
      ]),
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--gold" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon("groups")]),
      el("div", { class: "md3-kpi-chip__content" }, [
        el("div", { class: "md3-kpi-chip__value" }, String(classes.length)),
        el("div", { class: "md3-kpi-chip__label" }, "Class Cohorts"),
      ]),
    ]),
  ]);
  wrap.append(kpiRow);

  // 3. Consolidated Modern Navigation & Filter Toolbar
  const reportMount = el("div", { style: "margin-top:var(--sp-4);" });

  const REPORT_MODES = [
    { id: "top-students", label: "Exam & Merit Rankings", icon: "military_tech" },
    { id: "fee-report", label: "Fee Revenue & Balances", icon: "payments" },
    { id: "class-analysis", label: "Subject & CBC Trends", icon: "trending_up" },
    { id: "teacher-workload", label: "Faculty & Workloads", icon: "badge" },
  ];

  const tabsGroup = el("div", { class: "btn-group", style: "display:inline-flex; flex-wrap:wrap;" });

  REPORT_MODES.forEach((m) => {
    const btn = el(
      "button",
      {
        type: "button",
        class: `btn btn--sm ${currentReportType === m.id ? "btn--primary" : "btn--ghost"}`,
        onClick: () => {
          currentReportType = m.id;
          for (const b of tabsGroup.querySelectorAll("button")) {
            b.className = "btn btn--sm btn--ghost";
          }
          btn.className = "btn btn--sm btn--primary";
          runReport(reportMount);
        },
      },
      [icon(m.icon), m.label]
    );
    tabsGroup.append(btn);
  });

  const gradeSelect = el(
    "select",
    {
      style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
      onChange: (e) => {
        selection.grade = e.target.value;
        runReport(reportMount);
      },
    },
    [
      el("option", { value: "" }, "All Grades"),
      ...classes.map((c) => el("option", { value: c.grade, selected: c.grade === selection.grade ? "true" : undefined }, c.grade)),
    ]
  );

  const yearInput = el("input", {
    type: "number",
    value: String(selection.academicYear),
    placeholder: String(selection.academicYear),
    style: "height:36px; width:90px; padding:0 8px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm);",
    onChange: (e) => {
      selection.academicYear = e.target.value.trim();
      runReport(reportMount);
    },
  });

  const termSelect = el(
    "select",
    {
      style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
      onChange: (e) => {
        selection.term = e.target.value;
        runReport(reportMount);
      },
    },
    (settings.terms || ["Term 1", "Term 2", "Term 3"]).map((t) =>
      el("option", { value: t, selected: t === selection.term ? "true" : undefined }, t)
    )
  );

  const refreshBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost btn--sm",
      title: "Re-compile report data",
      onClick: () => runReport(reportMount),
    },
    [icon("refresh"), "Refresh"]
  );

  const printBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost btn--sm no-print",
      title: "Print current analytical report",
      onClick: () => window.print(),
    },
    [icon("print"), "Print Report"]
  );

  const toolbarCard = el(
    "div",
    { class: "card", style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);" },
    [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
        // Left side: Mode buttons
        tabsGroup,
        // Right side: Scope filters
        el("div", { style: "display:flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
          gradeSelect,
          yearInput,
          termSelect,
          refreshBtn,
          printBtn,
        ]),
      ]),
    ]
  );
  wrap.append(toolbarCard);

  wrap.append(reportMount);

  // Auto-run report immediately upon initial load
  setTimeout(() => {
    runReport(reportMount);
  }, 10);

  return wrap;
}

async function runReport(mountNode) {
  mountNode.innerHTML = "";
  mountNode.append(
    el("div", { class: "spinner-overlay", style: "padding:40px; text-align:center;" }, [
      spinner("lg", "dark"),
      el("div", { style: "margin-top:12px; font-weight:600; color:var(--color-primary-900);" }, "Compiling institutional analytics…"),
    ])
  );
  resetChart();
  try {
    if (currentReportType === "top-students") await renderTopStudents(mountNode);
    else if (currentReportType === "fee-report") await renderFeeReport(mountNode);
    else if (currentReportType === "class-analysis") await renderClassAnalysis(mountNode);
    else if (currentReportType === "teacher-workload") await renderTeacherWorkload(mountNode);
  } catch (err) {
    mountNode.innerHTML = "";
    toast(err.message || "Failed to generate report.", "error");
  }
}

// --- 1. Top Students (Exam & Merit Report) ---
async function renderTopStudents(container) {
  const results = await fetchTargetedResults();

  if (!results.length) {
    container.innerHTML = "";
    container.append(
      el("div", { class: "card", style: "padding:var(--sp-6) var(--sp-4); text-align:center;" }, [
        el("div", { class: "empty-state" }, [
          icon("search_off", "empty-state__icon"),
          el("h3", { style: "margin-top:12px;" }, "No Exam Results Found"),
          el(
            "p",
            { class: "text-muted", style: "max-width:440px; margin:6px auto 14px auto;" },
            `No terminal or midterm grading records found for ${selection.grade || "All Grades"} (${selection.term} ${selection.academicYear}). Ensure results have been calculated in Grading & Positions.`
          ),
          el(
            "a",
            { href: "#/grading", class: "btn btn--primary btn--sm" },
            [icon("calculate"), "Go to Grading & Positions"]
          ),
        ]),
      ])
    );
    return;
  }

  // Sort overall by mean marks globally
  const topList = results.sort((a, b) => (b.meanMarks || 0) - (a.meanMarks || 0)).slice(0, 20);

  // Grade Counts distribution
  const gradeCounts = {};
  results.forEach((r) => {
    const g = r.meanGrade || "Unclassified";
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });

  const chartCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4); padding:var(--sp-4);" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;" }, [
      el("h3", { style: "font-size:var(--fs-md); margin:0;" }, "Overall CBC Performance Distribution"),
      el("span", { class: "badge badge--info" }, `${results.length} Candidates Assessed`),
    ]),
    el("div", { class: "md3-chart-container", style: "height:240px;" }, [
      el("canvas", { id: "analyticsChart" }),
    ]),
  ]);

  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" }, [
    el(
      "div",
      {
        style:
          "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "Academic Merit Leaderboard"),
          el("span", { class: "badge badge--gold" }, `Top ${topList.length} Performers`),
        ]),
        el(
          "span",
          { style: "font-size:var(--fs-xs); color:var(--color-ink-soft);" },
          `${selection.grade || "School-Wide"} · ${selection.term} ${selection.academicYear}`
        ),
      ]
    ),
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", { class: "reports-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { style: "width:60px;" }, "Rank"),
            el("th", {}, "Student"),
            el("th", { style: "width:130px;" }, "Class / Stream"),
            el("th", { class: "col-right", style: "width:110px;" }, "Mean Score"),
            el("th", { style: "width:130px;" }, "Performance Band"),
            el("th", { class: "col-right", style: "width:100px;" }, "Profile"),
          ]),
        ]),
        el(
          "tbody",
          {},
          topList.map((r, index) => {
            const rank = index + 1;
            let rankBadgeClass = "rank-badge rank-badge--other";
            if (rank === 1) rankBadgeClass = "rank-badge rank-badge--1";
            else if (rank === 2) rankBadgeClass = "rank-badge rank-badge--2";
            else if (rank === 3) rankBadgeClass = "rank-badge rank-badge--3";

            return el("tr", {}, [
              el("td", { "data-label": "Rank" }, [el("span", { class: rankBadgeClass }, `#${rank}`)]),
              el("td", { "data-label": "Student" }, [
                el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                  el("div", { class: "student-avatar-chip" }, getInitials(r.fullName)),
                  el("div", {}, [
                    el("strong", { style: "color:var(--color-primary-900);" }, r.fullName || "Student"),
                    el(
                      "div",
                      { style: "font-size:11px; color:var(--color-ink-soft);" },
                      `Adm: ${r.admissionNumber || "N/A"}`
                    ),
                  ]),
                ]),
              ]),
              el("td", { "data-label": "Class" }, `${r.grade || ""} ${r.stream || ""}`),
              el(
                "td",
                { "data-label": "Mean Score", class: "col-right", style: "font-weight:700; font-family:var(--font-mono, monospace);" },
                `${r.meanMarks !== undefined ? Number(r.meanMarks).toFixed(2) : "N/A"}%`
              ),
              el(
                "td",
                { "data-label": "Performance Band" },
                [
                  el(
                    "span",
                    {
                      class: `badge ${
                        r.meanMarks >= 80
                          ? "badge--success"
                          : r.meanMarks >= 60
                          ? "badge--info"
                          : r.meanMarks >= 40
                          ? "badge--warning"
                          : "badge--danger"
                      }`,
                    },
                    r.meanGrade || "N/A"
                  ),
                ]
              ),
              el("td", { class: "col-right", "data-label": "Profile" }, [
                el(
                  "a",
                  {
                    href: `#/students?q=${encodeURIComponent(r.admissionNumber || r.fullName || "")}`,
                    class: "btn btn--ghost btn--xs",
                    title: "View full student file",
                  },
                  [icon("visibility"), "View"]
                ),
              ]),
            ]);
          })
        ),
      ]),
    ]),
  ]);

  container.innerHTML = "";
  container.append(chartCard, tableCard);

  // Render Chart
  const { primary, accent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(gradeCounts),
      datasets: [
        {
          label: "Assessed Students",
          data: Object.values(gradeCounts),
          backgroundColor: primary,
          borderRadius: 4,
          hoverBackgroundColor: accent,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
        x: {
          grid: { display: false },
        },
      },
    },
  });
}

// --- 2. Fee Report ---
async function renderFeeReport(container) {
  const feeStatuses = await listFeeStatusesForPeriod({
    grade: selection.grade,
    academicYear: selection.academicYear,
    term: selection.term,
  });

  const studentsById = new Map(students.map((s) => [s.id, s]));

  const balances = [];
  let totalExpected = 0,
    totalPaid = 0,
    totalDeficit = 0;

  for (const status of feeStatuses) {
    const s = studentsById.get(status.studentId);
    if (!s || s.status !== "active") continue;
    totalExpected += status.expected || 0;
    totalPaid += status.paid || 0;
    if (status.balance > 0) {
      totalDeficit += status.balance;
      balances.push({ student: s, expected: status.expected || 0, paid: status.paid || 0, balance: status.balance });
    }
  }

  balances.sort((a, b) => b.balance - a.balance);

  const collectionRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : 0;

  const summaryGrid = el("div", { class: "md3-main-grid", style: "margin-bottom:var(--sp-4);" }, [
    // Left: Financial Stats Column
    el("div", { class: "md3-col", style: "display:flex; flex-direction:column; gap:12px;" }, [
      el("div", { class: "md3-kpi-chip md3-kpi-chip--blue" }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon("account_balance")]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, "Expected Revenue"),
          el("div", { class: "md3-kpi-chip__val-wrap" }, [
            el("span", { class: "md3-kpi-chip__currency" }, "KES"),
            el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalExpected || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })),
          ]),
        ]),
      ]),
      el("div", { class: "md3-kpi-chip md3-kpi-chip--green" }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon("payments")]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, "Total Tuition Collected"),
          el("div", { class: "md3-kpi-chip__val-wrap" }, [
            el("span", { class: "md3-kpi-chip__currency" }, "KES"),
            el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalPaid || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })),
          ]),
        ]),
      ]),
      el("div", { class: "md3-kpi-chip md3-kpi-chip--red" }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon("money_off")]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, "Outstanding Balances"),
          el("div", { class: "md3-kpi-chip__val-wrap" }, [
            el("span", { class: "md3-kpi-chip__currency" }, "KES"),
            el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalDeficit || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })),
          ]),
        ]),
      ]),
    ]),
    // Right: Doughnut Chart Card
    el("div", { class: "card md3-col", style: "padding:var(--sp-4); display:flex; flex-direction:column;" }, [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;" }, [
        el("h3", { style: "font-size:var(--fs-md); margin:0;" }, "Collection Efficiency"),
        el("span", { class: "badge badge--success" }, `${collectionRate}% Collected`),
      ]),
      el("div", { class: "md3-chart-container", style: "height:210px;" }, [
        el("canvas", { id: "analyticsChart" }),
      ]),
    ]),
  ]);

  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" }, [
    el(
      "div",
      {
        style:
          "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line); flex-wrap:wrap; gap:10px;",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "Outstanding Defaulters Register"),
          el("span", { class: "badge badge--danger" }, `${balances.length} Learners with Balance`),
        ]),
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el(
            "button",
            {
              type: "button",
              class: "btn btn--ghost btn--sm",
              onClick: async (e) => {
                const restore = busyButton(e.currentTarget, "Syncing…");
                try {
                  const count = await backfillAllFeeStatuses(selection.academicYear, selection.term);
                  toast(`Synced fee balances for ${count} student(s).`, "success");
                  await renderFeeReport(container);
                } catch (err) {
                  toast(err.message || "Could not sync balances.", "error");
                  restore();
                }
              },
            },
            [icon("sync"), "Sync Balances"]
          ),
        ]),
      ]
    ),
    balances.length
      ? el("div", { class: "table-wrap table-wrap--responsive" }, [
          el("table", { class: "reports-table" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { style: "width:220px;" }, "Student"),
                el("th", { style: "width:130px;" }, "Class / Stream"),
                el("th", { class: "col-right", style: "width:120px;" }, "Expected (KES)"),
                el("th", { class: "col-right", style: "width:120px;" }, "Paid (KES)"),
                el("th", { class: "col-right", style: "width:130px;" }, "Balance (KES)"),
                el("th", { class: "col-right", style: "width:110px;" }, "Actions"),
              ]),
            ]),
            el(
              "tbody",
              {},
              balances.map((row) => {
                const linkedParents = (row.student.parentIds || [])
                  .map((pid) => parents.find((p) => p.id === pid))
                  .filter(Boolean);

                const primaryParent = linkedParents[0];
                const waPhone = primaryParent?.phone ? cleanPhoneForWhatsApp(primaryParent.phone) : null;

                return el("tr", {}, [
                  el("td", { "data-label": "Student" }, [
                    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                      el("div", { class: "student-avatar-chip" }, getInitials(row.student.fullName)),
                      el("div", {}, [
                        el("strong", { style: "color:var(--color-primary-900);" }, row.student.fullName),
                        el(
                          "div",
                          { style: "font-size:11px; color:var(--color-ink-soft);" },
                          `Adm: ${row.student.admissionNumber || "N/A"}`
                        ),
                      ]),
                    ]),
                  ]),
                  el("td", { "data-label": "Class" }, `${row.student.grade} ${row.student.stream || ""}`),
                  el("td", { class: "col-right", "data-label": "Expected" }, formatKES(row.expected)),
                  el("td", { class: "col-right", "data-label": "Paid", style: "color:var(--color-emerald-700, #047857);" }, formatKES(row.paid)),
                  el(
                    "td",
                    { class: "col-right", "data-label": "Balance" },
                    [el("span", { class: "badge badge--danger", style: "font-weight:700;" }, formatKES(row.balance))]
                  ),
                  el("td", { class: "col-right", "data-label": "Actions" }, [
                    el("div", { style: "display:flex; align-items:center; gap:6px; justify-content:flex-end;" }, [
                      waPhone
                        ? el(
                            "a",
                            {
                              href: `https://wa.me/${waPhone}?text=${encodeURIComponent(
                                `Dear Guardian, regarding student ${row.student.fullName} (Adm: ${row.student.admissionNumber || "N/A"}), the outstanding school fee balance for ${selection.term} ${selection.academicYear} is KES ${row.balance.toLocaleString()}. Please arrange payment.`
                              )}`,
                              target: "_blank",
                              rel: "noopener noreferrer",
                              class: "btn btn--ghost btn--xs",
                              style: "color:#16a34a;",
                              title: `Send WhatsApp fee reminder to ${primaryParent.fullName || "guardian"}`,
                            },
                            [icon("chat"), "WhatsApp"]
                          )
                        : "",
                      el(
                        "a",
                        {
                          href: `#/fees`,
                          class: "btn btn--ghost btn--xs",
                          title: "View in Fee Management",
                        },
                        [icon("payments")]
                      ),
                    ]),
                  ]),
                ]);
              })
            ),
          ]),
        ])
      : el("div", { style: "padding:32px; text-align:center; color:var(--color-ink-soft);" }, [
          icon("check_circle", "style=font-size:36px; color:#16a34a;"),
          el("p", { style: "margin-top:8px;" }, "All active learners have cleared their fee balances for this cycle!"),
        ]),
  ]);

  container.innerHTML = "";
  container.append(summaryGrid, tableCard);

  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Collected Tuition", "Outstanding Deficit"],
      datasets: [
        {
          data: [totalPaid, totalDeficit],
          backgroundColor: ["#16A34A", "#DC2626"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

// --- 3. Class / Subject Analysis ---
async function renderClassAnalysis(container) {
  const results = await fetchTargetedResults();

  if (!results.length) {
    container.innerHTML = "";
    container.append(
      el("div", { class: "card", style: "padding:var(--sp-6) var(--sp-4); text-align:center;" }, [
        el("div", { class: "empty-state" }, [
          icon("search_off", "empty-state__icon"),
          el("h3", { style: "margin-top:12px;" }, "No Subject Data Recorded"),
          el(
            "p",
            { class: "text-muted", style: "max-width:440px; margin:6px auto 14px auto;" },
            `No subject score records found for ${selection.grade || "All Grades"} (${selection.term} ${selection.academicYear}).`
          ),
        ]),
      ])
    );
    return;
  }

  const subjData = {};
  for (const res of results) {
    for (const sub of res.subjects || []) {
      if (!subjData[sub.code]) subjData[sub.code] = { name: sub.name, total: 0, count: 0 };
      subjData[sub.code].total += sub.average || 0;
      subjData[sub.code].count += 1;
    }
  }

  const analysisArray = Object.values(subjData)
    .map((s) => ({
      name: s.name,
      mean: s.count > 0 ? s.total / s.count : 0,
      studentsSat: s.count,
    }))
    .sort((a, b) => b.mean - a.mean);

  const chartLabels = analysisArray.map((a) => a.name);
  const chartData = analysisArray.map((a) => a.mean.toFixed(1));

  const chartCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4); padding:var(--sp-4);" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;" }, [
      el("h3", { style: "font-size:var(--fs-md); margin:0;" }, "Subject Performance Mean Benchmark (%)"),
      el("span", { class: "badge badge--info" }, `${analysisArray.length} Curriculum Subjects`),
    ]),
    el("div", { class: "md3-chart-container", style: "height:260px;" }, [
      el("canvas", { id: "analyticsChart" }),
    ]),
  ]);

  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" }, [
    el(
      "div",
      {
        style:
          "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "CBC Subject Mastery Ranking"),
          el("span", { class: "badge badge--neutral" }, `${selection.grade || "School-Wide"}`),
        ]),
        el(
          "span",
          { style: "font-size:var(--fs-xs); color:var(--color-ink-soft);" },
          `${selection.term} ${selection.academicYear}`
        ),
      ]
    ),
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", { class: "reports-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { style: "width:60px;" }, "Rank"),
            el("th", {}, "Subject Name"),
            el("th", { style: "width:140px;" }, "Candidates Sat"),
            el("th", { class: "col-right", style: "width:130px;" }, "Mean Average"),
            el("th", { class: "col-right", style: "width:160px;" }, "CBC Evaluation"),
          ]),
        ]),
        el(
          "tbody",
          {},
          analysisArray.map((s, idx) =>
            el("tr", {}, [
              el("td", { "data-label": "Rank" }, [el("span", { class: `rank-badge ${idx < 3 ? `rank-badge--${idx + 1}` : "rank-badge--other"}` }, `#${idx + 1}`)]),
              el("td", { "data-label": "Subject" }, [
                el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                  icon("menu_book", "style=color:var(--color-primary-600); font-size:16px;"),
                  el("strong", {}, s.name),
                ]),
              ]),
              el("td", { "data-label": "Candidates Sat" }, String(s.studentsSat)),
              el(
                "td",
                { class: "col-right", "data-label": "Mean %", style: "font-weight:700; font-family:var(--font-mono, monospace);" },
                `${s.mean.toFixed(2)}%`
              ),
              el(
                "td",
                { class: "col-right", "data-label": "CBC Evaluation" },
                [
                  el(
                    "span",
                    { class: `badge ${s.mean >= 60 ? "badge--success" : s.mean >= 50 ? "badge--info" : "badge--danger"}` },
                    s.mean >= 80 ? "Exceeding (EE)" : s.mean >= 60 ? "Meeting (ME)" : s.mean >= 50 ? "Approaching (AE)" : "Below (BE)"
                  ),
                ]
              ),
            ])
          )
        ),
      ]),
    ]),
  ]);

  container.innerHTML = "";
  container.append(chartCard, tableCard);

  const { primary: linePrimary, accent: lineAccent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: "Average Mean %",
          data: chartData,
          borderColor: linePrimary,
          backgroundColor: hexToRgba(linePrimary, 0.15),
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: lineAccent,
          pointRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20 },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

// --- 4. Teacher Workload ---
async function renderTeacherWorkload(container) {
  const workloadLabels = [];
  const workloadData = [];

  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden; margin-top:var(--sp-4);" }, [
    el(
      "div",
      {
        style:
          "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "Faculty Workload Ledger"),
          el("span", { class: "badge badge--info" }, `${teachers.length} Instructors`),
        ]),
        el(
          "span",
          { style: "font-size:var(--fs-xs); color:var(--color-ink-soft);" },
          "Curriculum Teaching Allocations"
        ),
      ]
    ),
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", { class: "reports-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Teacher / Instructor"),
            el("th", { style: "width:130px;" }, "TSC No."),
            el("th", { style: "width:160px;" }, "Subjects Taught"),
            el("th", { style: "width:160px;" }, "Classes Assigned"),
            el("th", { class: "col-right", style: "width:110px;" }, "Status"),
          ]),
        ]),
        el(
          "tbody",
          {},
          teachers.map((t) => {
            const assignments = t.teachingAssignments || [];
            const subjCount = new Set(assignments.map(a => a.subjectCode)).size;
            const classCount = new Set(assignments.map(a => `${a.grade}|${a.stream}`)).size;

            workloadLabels.push(t.fullName);
            workloadData.push(classCount);

            return el("tr", {}, [
              el("td", { "data-label": "Teacher" }, [
                el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                  el("div", { class: "parent-avatar-chip" }, getInitials(t.fullName)),
                  el("div", {}, [
                    el("strong", { style: "color:var(--color-primary-900);" }, t.fullName),
                    el(
                      "div",
                      { style: "font-size:11px; color:var(--color-ink-soft);" },
                      t.email || t.phone || "Faculty"
                    ),
                  ]),
                ]),
              ]),
              el("td", { "data-label": "TSC No." }, t.tscNumber || el("span", { class: "text-muted" }, "N/A")),
              el("td", { "data-label": "Subjects Taught" }, `${subjCount} Subject(s)`),
              el("td", { "data-label": "Classes Assigned" }, `${classCount} Class(es)`),
              el(
                "td",
                { class: "col-right", "data-label": "Status" },
                [el("span", { class: `badge badge--${t.status === "active" ? "success" : "neutral"}` }, t.status || "active")]
              ),
            ]);
          })
        ),
      ]),
    ]),
  ]);

  const chartCard = el("div", { class: "card", style: "padding:var(--sp-4);" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;" }, [
      el("h3", { style: "font-size:var(--fs-md); margin:0;" }, "Assigned Teaching Classes per Faculty Member"),
      el("span", { class: "badge badge--neutral" }, "Staff Allocation"),
    ]),
    el("div", { class: "md3-chart-container", style: "height:240px;" }, [
      el("canvas", { id: "analyticsChart" }),
    ]),
  ]);

  container.innerHTML = "";
  container.append(chartCard, tableCard);

  const { accent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: workloadLabels,
      datasets: [
        {
          label: "Classes Assigned",
          data: workloadData,
          backgroundColor: accent,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

export function init() {}