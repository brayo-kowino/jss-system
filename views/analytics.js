import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listTeachers } from "../js/services/teacher.service.js";
import { listResultsByPeriod } from "../js/services/grading.service.js";
import { listFeeStatusesForPeriod, backfillAllFeeStatuses, formatKES } from "../js/services/fee.service.js";
import { el, icon, toast, spinner, escapeHtml, mobileOnlyNotice, busyButton, getBrandColors, hexToRgba } from "../js/utils.js";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

let classes = [];
let subjects = [];
let settings = null;
let currentReportType = "top-students";
let selection = { grade: "", academicYear: "", term: "" };
let activeChart = null; // Keep track of the chart to destroy it when switching views

export async function render({ profile }) {
  [classes, subjects, settings] = await Promise.all([
    listClasses(), 
    listSubjects(), 
    getSchoolSettings()
  ]);
  
  selection.academicYear = settings.currentAcademicYear || "";
  selection.term = settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
      ]),
    ])
  );
  // Filter row + side-by-side charts and stat panels are a dashboard
  // layout, not something that reflows cleanly to a phone width - set
  // expectations rather than hand someone a squeezed chart.
  wrap.append(mobileOnlyNotice("Analytics is a dashboard of filters, charts and side-by-side stats - it's built for a tablet or desktop screen."));

  const controlsCard = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(controlsCard);

  const reportMount = el("div", { style: "margin-top:16px;" });
  wrap.append(reportMount);

  renderControls(controlsCard, reportMount, profile);
  return wrap;
}

function renderControls(container, reportMount, profile) {
  container.innerHTML = "";
  
  const row = el("div", { class: "filter-grid" });
  
  const typeSelect = el("select", {}, [
    el("option", { value: "top-students", selected: currentReportType === "top-students" ? "true" : undefined }, "Top Students (Exam Report)"),
    el("option", { value: "fee-report", selected: currentReportType === "fee-report" ? "true" : undefined }, "Fee Defaulters & Balances"),
    el("option", { value: "teacher-workload", selected: currentReportType === "teacher-workload" ? "true" : undefined }, "Teacher Workload"),
    el("option", { value: "class-analysis", selected: currentReportType === "class-analysis" ? "true" : undefined }, "Subject / Class Analysis")
  ]);

  const gradeSelect = el("select", {}, [
    el("option", { value: "" }, "All Grades"),
    ...classes.map((c) => el("option", { value: c.grade, selected: c.grade === selection.grade ? "true" : undefined }, c.grade)),
  ]);

  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "e.g. 2026" });
  
  const termSelect = el("select", {}, (settings.terms || []).map((t) =>
    el("option", { value: t, selected: t === selection.term ? "true" : undefined }, t)
  ));

  typeSelect.addEventListener("change", () => { currentReportType = typeSelect.value; });
  gradeSelect.addEventListener("change", () => { selection.grade = gradeSelect.value; });
  yearInput.addEventListener("change", () => { selection.academicYear = yearInput.value.trim(); });
  termSelect.addEventListener("change", () => { selection.term = termSelect.value; });

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Report Type"), typeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Grade Filter"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect])
  );

  container.append(row);
  container.append(
    el("div", { class: "filter-actions" }, [
      el("button", {
        class: "btn btn--primary",
        onClick: () => runReport(reportMount)
      }, [icon("insert_chart"), "Generate Report"]),
    ])
  );
}

// Preference order when a student has more than one saved report for the
// same grade/year/term (schools can save a standalone Midterm and/or
// Endterm report in addition to the final Average - see Grading &
// Positions). Average is the most complete/final figure, so it wins when
// present; otherwise fall back to whichever single mode was actually saved.
const RESULT_MODE_PRIORITY = ["average", "endterm", "midterm"];

// Collapses possibly-multiple saved records per student (one per report
// mode) down to a single "best" record each, so charts/tables never
// double- or triple-count a student who has both a Midterm and an Average
// saved for the same period.
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

// Helper to fetch results for one grade or all grades. Previously this
// locked the query to reportMode: "average" only, which meant a school
// that had only saved a Midterm or Endterm-only report (and never
// computed/saved the final Average) got "No Results Found" here even
// though results genuinely existed in Grading & Positions. Now it fetches
// every saved mode for the period and dedupes per student via
// pickBestPerStudent, so any saved mode is picked up without double-
// counting a student who has more than one mode saved.
async function fetchTargetedResults() {
  if (selection.grade) {
    const docs = await listResultsByPeriod({ grade: selection.grade, stream: "", academicYear: selection.academicYear, term: selection.term });
    return pickBestPerStudent(docs);
  }

  // Fire the per-grade queries in parallel instead of blocking one grade on
  // the next - independent reads with nothing for a sequential await to buy us.
  const perGrade = await Promise.all(
    classes.map((c) =>
      listResultsByPeriod({ grade: c.grade, stream: "", academicYear: selection.academicYear, term: selection.term })
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

async function runReport(mountNode) {
  mountNode.innerHTML = "";
  mountNode.append(el("div", { class: "spinner-overlay" }, [spinner("lg", "dark"), el("div", {}, "Compiling data…")]));
  resetChart();
  try {
    if (currentReportType === "top-students") await renderTopStudents(mountNode);
    else if (currentReportType === "fee-report") await renderFeeReport(mountNode);
    else if (currentReportType === "teacher-workload") await renderTeacherWorkload(mountNode);
    else if (currentReportType === "class-analysis") await renderClassAnalysis(mountNode);
  } catch (err) {
    mountNode.innerHTML = "";
    toast(err.message || "Failed to generate report.", "error");
  }
}

// --- 1. Top Students (Exam Report) ---
async function renderTopStudents(container) {
  const results = await fetchTargetedResults();
  
  if (!results.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      icon("search_off", "empty-state__icon"),
      el("h3", {}, "No Results Found"),
      el("p", {}, "Ensure results are computed in Grading & Positions first."),
    ]));
    return;
  }

  // Sort overall by mean marks globally
  const topList = results.sort((a, b) => (b.meanMarks || 0) - (a.meanMarks || 0)).slice(0, 15);
  
  // Prepare Grade Distribution Data for Chart
  const gradeCounts = {};
  results.forEach(r => {
    const g = r.meanGrade || "Unclassified";
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });

  const chartCard = el("div", { class: "card", style: "margin-bottom:16px;" }, [
    el("h3", {}, "Overall Grade Distribution"),
    el("div", { class: "md3-chart-container", style: "height:250px;" }, [
      el("canvas", { id: "analyticsChart" })
    ])
  ]);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Rank"), el("th", {}, "Class"), el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Mean %"), el("th", {}, "Grade")
    ]))
  ]);
  
  const tbody = el("tbody", {});
  topList.forEach((r, index) => {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Rank" }, `#${index + 1}`),
      el("td", { "data-label": "Class" }, r.grade),
      el("td", { "data-label": "Adm No." }, r.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, el("b", {}, r.fullName)),
      el("td", { "data-label": "Mean %" }, `${r.meanMarks?.toFixed(2) ?? "N/A"}%`),
      el("td", { "data-label": "Grade" }, el("span", { class: "badge badge--gold" }, r.meanGrade || "N/A"))
    ]));
  });
  
  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = `<h3>Top Students: ${escapeHtml(selection.grade || "All Grades")} (${escapeHtml(selection.term)} ${escapeHtml(selection.academicYear)})</h3>`;
  container.append(chartCard, tableWrap);

  // Render Chart
  const { primary, accent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(gradeCounts),
      datasets: [{
        label: 'Number of Students',
        data: Object.values(gradeCounts),
        backgroundColor: primary,
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// --- 2. Fee Report ---
async function renderFeeReport(container) {
  // Single query against student_fee_status instead of looping
  // getFeeSummary() per active student - same pattern as the dashboard's
  // getStudentsWithBalancesCount(). listStudents() is still needed for
  // name/admission number/status, but no per-student fee reads happen here.
  const [students, feeStatuses] = await Promise.all([
    listStudents(),
    listFeeStatusesForPeriod({ grade: selection.grade, academicYear: selection.academicYear, term: selection.term }),
  ]);
  const studentsById = new Map(students.map((s) => [s.id, s]));

  const balances = [];
  let totalExpected = 0, totalPaid = 0, totalDeficit = 0;

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

  const grid = el("div", { class: "md3-main-grid", style: "margin-bottom:16px;" });
  
  const statsCol = el("div", { class: "md3-col" }, [
    el("div", { class: "md3-kpi-chip md3-kpi-chip--blue" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "account_balance")]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, "Expected Revenue"),
        el("div", { class: "md3-kpi-chip__val-wrap" }, [
          el("span", { class: "md3-kpi-chip__currency" }, "KES"),
          el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalExpected || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        ]),
      ]),
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--green" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "payments")]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, "Total Collected"),
        el("div", { class: "md3-kpi-chip__val-wrap" }, [
          el("span", { class: "md3-kpi-chip__currency" }, "KES"),
          el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalPaid || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        ]),
      ]),
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--red" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "money_off")]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, "Pending Balances"),
        el("div", { class: "md3-kpi-chip__val-wrap" }, [
          el("span", { class: "md3-kpi-chip__currency" }, "KES"),
          el("span", { class: "md3-kpi-chip__value numeric" }, Number(totalDeficit || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        ]),
      ]),
    ]),
  ]);

  const chartCard = el("div", { class: "card md3-col" }, [
    el("h3", { class: "md3-card__title" }, "Collection Status"),
    el("div", { class: "md3-chart-container", style: "height:200px;" }, [
      el("canvas", { id: "analyticsChart" })
    ])
  ]);

  grid.append(statsCol, chartCard);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Class"), el("th", {}, "Expected"), el("th", {}, "Paid"), el("th", {}, "Balance")
    ]))
  ]);
  
  const tbody = el("tbody", {});
  for (const row of balances) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Adm No." }, row.student.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, row.student.fullName),
      el("td", { "data-label": "Class" }, `${row.student.grade} ${row.student.stream || ""}`),
      el("td", { "data-label": "Expected" }, formatKES(row.expected)),
      el("td", { "data-label": "Paid" }, formatKES(row.paid)),
      el("td", { "data-label": "Balance" }, el("span", { class: "badge badge--danger" }, formatKES(row.balance)))
    ]));
  }
  
  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = "";
  const headerRow = el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;" }, [
    el("h3", { style: "margin:0;" }, `Fee Status Report: ${escapeHtml(selection.grade || "All Grades")} (${escapeHtml(selection.term)} ${escapeHtml(selection.academicYear)})`),
    el("button", {
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
    }, [icon("sync"), "Sync Balances"]),
  ]);
  container.append(headerRow, grid, balances.length ? tableWrap : el("p", { class: "text-muted" }, "No pending balances for the selected criteria."));

  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Collected', 'Pending Deficit'],
      datasets: [{
        data: [totalPaid, totalDeficit],
        backgroundColor: ['#2E7D46', '#B3261E'],
        borderWidth: 0
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%' }
  });
}

// --- 3. Teacher Workload ---
async function renderTeacherWorkload(container) {
  const teachers = await listTeachers();
  
  const workloadLabels = [];
  const workloadData = [];

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Teacher"), el("th", {}, "TSC No."), el("th", {}, "Subjects Taught"), el("th", {}, "Classes Assigned"), el("th", {}, "Status")
    ]))
  ]);

  const tbody = el("tbody", {});
  for (const t of teachers) {
    const subjCount = (t.subjectCodes || []).length;
    const classCount = (t.classAssignments || []).length;
    
    // Feed chart data
    workloadLabels.push(t.fullName);
    workloadData.push(classCount);

    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Teacher" }, el("b", {}, t.fullName)),
      el("td", { "data-label": "TSC No." }, t.tscNumber || "N/A"),
      el("td", { "data-label": "Subjects Taught" }, `${subjCount} Subject(s)`),
      el("td", { "data-label": "Classes Assigned" }, `${classCount} Class(es)`),
      el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${t.status === "active" ? "success" : "muted"}` }, t.status || "active"))
    ]));
  }

  table.append(tbody);
  tableWrap.append(table);

  const chartCard = el("div", { class: "card", style: "margin-bottom:16px;" }, [
    el("h3", {}, "Assigned Classes per Teacher"),
    el("div", { class: "md3-chart-container", style: "height:250px;" }, [
      el("canvas", { id: "analyticsChart" })
    ])
  ]);

  container.innerHTML = `<h3>Teacher Workload Distribution</h3>`;
  container.append(chartCard, tableWrap);

  const { primary, accent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: workloadLabels,
      datasets: [{
        label: 'Classes Assigned',
        data: workloadData,
        backgroundColor: accent,
        borderRadius: 4
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

// --- 4. Class / Subject Analysis ---
async function renderClassAnalysis(container) {
  const results = await fetchTargetedResults();
  
  if (!results.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      icon("search_off", "empty-state__icon"),
      el("h3", {}, "No Results Found"),
      el("p", {}, "Ensure results are computed for the selected parameters."),
    ]));
    return;
  }

  const subjData = {};
  for (const res of results) {
    for (const sub of res.subjects || []) {
      if (!subjData[sub.code]) subjData[sub.code] = { name: sub.name, total: 0, count: 0 };
      subjData[sub.code].total += sub.average;
      subjData[sub.code].count += 1;
    }
  }

  const analysisArray = Object.values(subjData).map(s => ({
    name: s.name,
    mean: s.count > 0 ? (s.total / s.count) : 0,
    studentsSat: s.count
  })).sort((a, b) => b.mean - a.mean); // Highest performing subject first

  const chartLabels = analysisArray.map(a => a.name);
  const chartData = analysisArray.map(a => a.mean.toFixed(1));

  const chartCard = el("div", { class: "card", style: "margin-bottom:16px;" }, [
    el("h3", {}, "Subject Performance Mean (%)"),
    el("div", { class: "md3-chart-container", style: "height:300px;" }, [
      el("canvas", { id: "analyticsChart" })
    ])
  ]);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject Name"), el("th", {}, "Students Sat"), el("th", {}, "Mean %"), el("th", {}, "Performance")
    ]))
  ]);

  const tbody = el("tbody", {});
  for (const s of analysisArray) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Subject Name" }, el("b", {}, s.name)),
      el("td", { "data-label": "Students Sat" }, String(s.studentsSat)),
      el("td", { "data-label": "Mean %" }, `${s.mean.toFixed(2)}%`),
      el("td", { "data-label": "Performance" }, el("span", { class: `badge ${s.mean >= 50 ? 'badge--success' : 'badge--danger'}` }, s.mean >= 50 ? "Pass" : "Requires Attention"))
    ]));
  }

  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = `<h3>Subject Analysis: ${escapeHtml(selection.grade || "School Wide")}</h3>`;
  container.append(chartCard, tableWrap);

  const { primary: linePrimary, accent: lineAccent } = getBrandColors();
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Average %',
        data: chartData,
        borderColor: linePrimary,
        backgroundColor: hexToRgba(linePrimary, 0.15),
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: lineAccent,
        pointRadius: 5
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100 } }
    }
  });
}

export function init() {}