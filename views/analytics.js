import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listTeachers } from "../js/services/teacher.service.js";
import { listResultsByPeriod } from "../js/services/grading.service.js";
import { getFeeSummary, formatKES } from "../js/services/fee.service.js";
import { el, icon, toast, spinner, escapeHtml } from "../js/utils.js";
import { Chart, registerables } from "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm";

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

  const controlsCard = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(controlsCard);

  const reportMount = el("div", { style: "margin-top:16px;" });
  wrap.append(reportMount);

  renderControls(controlsCard, reportMount, profile);
  return wrap;
}

function renderControls(container, reportMount, profile) {
  container.innerHTML = "";
  
  const row = el("div", { style: "display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; align-items:end;" });
  
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
    el("button", { 
      class: "btn btn--primary", 
      style: "margin-top:16px;",
      onClick: () => runReport(reportMount) 
    }, [icon("insert_chart"), "Generate Report"])
  );
}

// Helper to fetch results for one grade or all grades
async function fetchTargetedResults() {
  if (selection.grade) {
    return await listResultsByPeriod({ grade: selection.grade, stream: "", academicYear: selection.academicYear, term: selection.term });
  }
  
  let allResults = [];
  for (const c of classes) {
    const res = await listResultsByPeriod({ grade: c.grade, stream: "", academicYear: selection.academicYear, term: selection.term });
    allResults.push(...res);
  }
  return allResults;
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

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Rank"), el("th", {}, "Class"), el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Mean %"), el("th", {}, "Grade")
    ]))
  ]);
  
  const tbody = el("tbody", {});
  topList.forEach((r, index) => {
    tbody.append(el("tr", {}, [
      el("td", {}, `#${index + 1}`),
      el("td", {}, r.grade),
      el("td", {}, r.admissionNumber || "N/A"),
      el("td", {}, el("b", {}, r.fullName)),
      el("td", {}, `${r.meanMarks?.toFixed(2) ?? "N/A"}%`),
      el("td", {}, el("span", { class: "badge badge--gold" }, r.meanGrade || "N/A"))
    ]));
  });
  
  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = `<h3>Top Students: ${escapeHtml(selection.grade || "All Grades")} (${escapeHtml(selection.term)} ${escapeHtml(selection.academicYear)})</h3>`;
  container.append(chartCard, tableWrap);

  // Render Chart
  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(gradeCounts),
      datasets: [{
        label: 'Number of Students',
        data: Object.values(gradeCounts),
        backgroundColor: '#14538A',
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// --- 2. Fee Report ---
async function renderFeeReport(container) {
  const students = await listStudents();
  let activeStudents = students.filter(s => s.status === "active");
  if (selection.grade) activeStudents = activeStudents.filter(s => s.grade === selection.grade);

  const balances = [];
  let totalExpected = 0, totalPaid = 0, totalDeficit = 0;

  for (const s of activeStudents) {
    const summary = await getFeeSummary({ studentId: s.id, grade: s.grade, academicYear: selection.academicYear, term: selection.term });
    totalExpected += summary.expected;
    totalPaid += summary.paid;
    if (summary.balance > 0) {
      totalDeficit += summary.balance;
      balances.push({ student: s, ...summary });
    }
  }

  balances.sort((a, b) => b.balance - a.balance);

  const grid = el("div", { class: "md3-main-grid", style: "margin-bottom:16px;" });
  
  const statsCol = el("div", { class: "md3-col" }, [
    el("div", { class: "md3-kpi-chip md3-kpi-chip--blue" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "account_balance")]),
      el("div", {}, [el("div", { class: "md3-kpi-chip__label" }, "Expected Revenue"), el("div", { class: "md3-kpi-chip__value numeric text-sm" }, formatKES(totalExpected))])
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--green" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "payments")]),
      el("div", {}, [el("div", { class: "md3-kpi-chip__label" }, "Total Collected"), el("div", { class: "md3-kpi-chip__value numeric text-sm" }, formatKES(totalPaid))])
    ]),
    el("div", { class: "md3-kpi-chip md3-kpi-chip--purple" }, [
      el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, "money_off")]),
      el("div", {}, [el("div", { class: "md3-kpi-chip__label" }, "Pending Balances"), el("div", { class: "md3-kpi-chip__value numeric text-sm" }, formatKES(totalDeficit))])
    ])
  ]);

  const chartCard = el("div", { class: "card md3-col" }, [
    el("h3", { class: "md3-card__title" }, "Collection Status"),
    el("div", { class: "md3-chart-container", style: "height:200px;" }, [
      el("canvas", { id: "analyticsChart" })
    ])
  ]);

  grid.append(statsCol, chartCard);

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Class"), el("th", {}, "Expected"), el("th", {}, "Paid"), el("th", {}, "Balance")
    ]))
  ]);
  
  const tbody = el("tbody", {});
  for (const row of balances) {
    tbody.append(el("tr", {}, [
      el("td", {}, row.student.admissionNumber || "N/A"),
      el("td", {}, row.student.fullName),
      el("td", {}, `${row.student.grade} ${row.student.stream || ""}`),
      el("td", {}, formatKES(row.expected)),
      el("td", {}, formatKES(row.paid)),
      el("td", {}, el("span", { class: "badge badge--danger" }, formatKES(row.balance)))
    ]));
  }
  
  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = `<h3>Fee Status Report</h3>`;
  container.append(grid, balances.length ? tableWrap : el("p", { class: "text-muted" }, "No pending balances for the selected criteria."));

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

  const tableWrap = el("div", { class: "table-wrap" });
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
      el("td", {}, el("b", {}, t.fullName)),
      el("td", {}, t.tscNumber || "N/A"),
      el("td", {}, `${subjCount} Subject(s)`),
      el("td", {}, `${classCount} Class(es)`),
      el("td", {}, el("span", { class: `badge badge--${t.status === "active" ? "success" : "muted"}` }, t.status || "active"))
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

  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: workloadLabels,
      datasets: [{
        label: 'Classes Assigned',
        data: workloadData,
        backgroundColor: '#C9A227',
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

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject Name"), el("th", {}, "Students Sat"), el("th", {}, "Mean %"), el("th", {}, "Performance")
    ]))
  ]);

  const tbody = el("tbody", {});
  for (const s of analysisArray) {
    tbody.append(el("tr", {}, [
      el("td", {}, el("b", {}, s.name)),
      el("td", {}, String(s.studentsSat)),
      el("td", {}, `${s.mean.toFixed(2)}%`),
      el("td", {}, el("span", { class: `badge ${s.mean >= 50 ? 'badge--success' : 'badge--danger'}` }, s.mean >= 50 ? "Pass" : "Requires Attention"))
    ]));
  }

  table.append(tbody);
  tableWrap.append(table);
  
  container.innerHTML = `<h3>Subject Analysis: ${escapeHtml(selection.grade || "School Wide")}</h3>`;
  container.append(chartCard, tableWrap);

  const ctx = document.getElementById("analyticsChart");
  activeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Average %',
        data: chartData,
        borderColor: '#14538A',
        backgroundColor: 'rgba(20, 83, 138, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#C9A227',
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