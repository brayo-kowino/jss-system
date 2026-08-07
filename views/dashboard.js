import { collection, getCountFromServer, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, formatKES, getFeeSummary } from "../js/services/fee.service.js";
import { fetchRecentLogs, describeLog } from "../js/services/audit.service.js";
import { listAssessments } from "../js/services/assessment.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getCurrentSchoolId } from "../js/services/auth.service.js";
import { navigate } from "../js/router.js";
import { el, formatDate } from "../js/utils.js";

import { Chart, registerables } from "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm";
Chart.register(...registerables);

async function safeCount(collectionName) {
  try {
    const snap = await getCountFromServer(query(collection(db, collectionName), where("schoolId", "==", getCurrentSchoolId())));
    return snap.data().count;
  } catch {
    return 0; 
  }
}

// Global cache so init() can grab the real data after render
let chartDataCache = {
  gradeLabels: [],
  gradeCounts: [],
  revenueLabels: [],
  revenueData: []
};

export async function render({ profile }) {
  const settings = await getSchoolSettings();
  
  const [teachers, attendanceToday, feesCollected, recentLogs, assessments, allStudents, paymentsSnap] = await Promise.all([
    safeCount("teachers"),
    getTodayAttendanceStat(),
    getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
    fetchRecentLogs(7), 
    listAssessments(),
    listStudents(),
    // Fetch all fee payments for the current term!
    getDocs(query(collection(db, "fee_payments"), where("schoolId", "==", getCurrentSchoolId()), where("academicYear", "==", settings.currentAcademicYear), where("term", "==", settings.currentTerm)))
  ]);

  const activeStudents = allStudents.filter(s => s.status === 'active');
  const studentsCount = activeStudents.length;

  // 1. Calculate Real Fee Balances
  let studentsWithBalancesCount = 0;
  await Promise.all(activeStudents.map(async (student) => {
    if (!student.grade) return; 
    let summary;
    try {
      summary = await getFeeSummary({
        studentId: student.id,
        grade: student.grade,
        academicYear: settings.currentAcademicYear || "",
        term: settings.currentTerm || ""
      });
    } catch {
      return; // no fee structure set for this student's grade/term yet - skip rather than fail the whole dashboard
    }
    if (summary.balance > 0) {
      studentsWithBalancesCount++;
    }
  }));

  // 2. Calculate Real Revenue Trend (Group by Month, sorted chronologically)
  const monthlyRevenueByKey = {};
  paymentsSnap.docs.forEach(doc => {
    const data = doc.data();
    if (!data.date) return;
    const d = new Date(data.date);
    if (isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
    if (!monthlyRevenueByKey[key]) monthlyRevenueByKey[key] = { label, total: 0 };
    monthlyRevenueByKey[key].total += Number(data.amount) || 0;
  });
  const sortedMonthKeys = Object.keys(monthlyRevenueByKey).sort();

  chartDataCache.revenueLabels = sortedMonthKeys.map((k) => monthlyRevenueByKey[k].label);
  chartDataCache.revenueData = sortedMonthKeys.map((k) => monthlyRevenueByKey[k].total);

  // Fallback if no payments exist yet
  if (chartDataCache.revenueLabels.length === 0) {
    chartDataCache.revenueLabels = ['No Data Yet'];
    chartDataCache.revenueData = [0];
  }

  // 3. Calculate Demographics Data
  const gradeDistribution = {};
  activeStudents.forEach(s => {
    const g = s.grade || "Unassigned";
    gradeDistribution[g] = (gradeDistribution[g] || 0) + 1;
  });
  chartDataCache.gradeLabels = Object.keys(gradeDistribution);
  chartDataCache.gradeCounts = Object.values(gradeDistribution);

  // 4. Gender split (real headcount, not a guess)
  const boysCount = activeStudents.filter((s) => s.gender === "Male").length;
  const girlsCount = activeStudents.filter((s) => s.gender === "Female").length;

  // 5. New admissions in the last 30 days
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const newAdmissionsCount = activeStudents.filter((s) => {
    if (!s.admissionDate) return false;
    const admitted = new Date(s.admissionDate).getTime();
    return !isNaN(admitted) && Date.now() - admitted <= THIRTY_DAYS_MS;
  }).length;

  // 6. Assessment pipeline: what's open (needs marks) vs locked
  const openAssessmentsCount = assessments.filter((a) => a.status === "open").length;
  const lockedAssessmentsCount = assessments.filter((a) => a.status === "locked").length;

  // 7. Which grade carries the largest headcount
  let topGrade = null;
  for (const [grade, count] of Object.entries(gradeDistribution)) {
    if (!topGrade || count > topGrade.count) topGrade = { grade, count };
  }

  // 8. Month-over-month revenue trend (needs at least two months of payments)
  let revenueTrend = null;
  if (sortedMonthKeys.length >= 2) {
    const lastKey = sortedMonthKeys[sortedMonthKeys.length - 1];
    const prevKey = sortedMonthKeys[sortedMonthKeys.length - 2];
    const last = monthlyRevenueByKey[lastKey];
    const prev = monthlyRevenueByKey[prevKey];
    if (prev.total > 0) {
      revenueTrend = {
        label: last.label,
        prevLabel: prev.label,
        pct: Math.round(((last.total - prev.total) / prev.total) * 100),
      };
    }
  }

  const wrap = el("div", { class: "dashboard-container" });

// Hero Section
  const header = el("div", { class: "md3-hero" }, [
    el("div", { class: "md3-hero__text" }, [
      el("h1", { style: "margin: 0;" }, `Welcome back, ${profile.fullName || profile.email}`)
    ]),
    el("div", { class: "md3-hero__actions" }, [
      el("button", { class: "btn btn--primary", onClick: () => navigate("/students") }, [
        el("span", { class: "material-symbols-rounded" }, "person_add"), "New Admission"
      ]),
      el("button", { class: "btn btn--tonal", onClick: () => navigate("/fees") }, [
        el("span", { class: "material-symbols-rounded" }, "payments"), "Record Fee"
      ]),
      el("button", { class: "btn btn--tonal", onClick: () => navigate("/attendance") }, [
        el("span", { class: "material-symbols-rounded" }, "fact_check"), "Roll Call"
      ])
    ])
  ]);
  wrap.append(header);

  // Interactive KPI Chips
  const kpiGrid = el("div", { class: "md3-kpi-grid" });
  const kpis = [
    { label: "Active Students", value: studentsCount, icon: "school", color: "blue" },
    { label: "Active Staff", value: teachers, icon: "badge", color: "purple" },
    { label: "Attendance Today", value: attendanceToday || "0%", icon: "how_to_reg", color: "green" },
    { label: "Term Revenue", value: formatKES(feesCollected), icon: "account_balance_wallet", color: "gold" }
  ];

  for (const kpi of kpis) {
    kpiGrid.append(
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${kpi.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [
          el("span", { class: "material-symbols-rounded" }, kpi.icon)
        ]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, kpi.label),
          el("div", { class: "md3-kpi-chip__value numeric" }, String(kpi.value))
        ])
      ])
    );
  }
  wrap.append(kpiGrid);

  const mainGrid = el("div", { class: "md3-main-grid" });

  // --- Left Column ---
  const leftCol = el("div", { class: "md3-col" });

  const attendancePct = attendanceToday && attendanceToday !== "N/A" ? parseInt(attendanceToday, 10) : null;

  // Build the candidate insights from real, computed data only - each item
  // is skipped when the underlying data isn't available, rather than
  // filled in with a placeholder.
  const insightCandidates = [
    studentsWithBalancesCount > 0
      ? { icon: "warning", color: "gold", text: `${studentsWithBalancesCount} of ${studentsCount} student(s) have pending fee balances.` }
      : studentsCount
      ? { icon: "check_circle", color: "green", text: "All enrolled students are up to date on fees." }
      : null,

    attendancePct != null
      ? attendancePct >= 90
        ? { icon: "how_to_reg", color: "green", text: `Attendance today is strong at ${attendanceToday}.` }
        : attendancePct >= 75
        ? { icon: "how_to_reg", color: "gold", text: `Attendance today is ${attendanceToday} - a bit below usual.` }
        : { icon: "how_to_reg", color: "red", text: `Attendance today is low at ${attendanceToday}.` }
      : { icon: "fact_check", color: "blue", text: "Attendance hasn't been marked yet today." },

    settings.openingDate
      ? { icon: "event_available", color: "blue", text: `Next term begins on ${formatDate(settings.openingDate)}.` }
      : null,

    boysCount + girlsCount > 0
      ? { icon: "groups", color: "blue", text: `${boysCount} boys and ${girlsCount} girls enrolled (${Math.round((girlsCount / (boysCount + girlsCount)) * 100)}% girls).` }
      : null,

    revenueTrend
      ? {
          icon: revenueTrend.pct >= 0 ? "trending_up" : "trending_down",
          color: revenueTrend.pct >= 0 ? "green" : "red",
          text: `Revenue in ${revenueTrend.label} is ${revenueTrend.pct >= 0 ? "up" : "down"} ${Math.abs(revenueTrend.pct)}% vs ${revenueTrend.prevLabel}.`,
        }
      : null,

    newAdmissionsCount > 0
      ? { icon: "person_add", color: "green", text: `${newAdmissionsCount} new student(s) admitted in the last 30 days.` }
      : null,

    openAssessmentsCount > 0
      ? { icon: "assignment", color: "gold", text: `${openAssessmentsCount} assessment(s) open and awaiting marks entry.` }
      : lockedAssessmentsCount > 0
      ? { icon: "lock", color: "blue", text: `${lockedAssessmentsCount} assessment(s) are locked.` }
      : null,

    topGrade
      ? { icon: "school", color: "blue", text: `${topGrade.grade} has the largest enrollment (${topGrade.count} students).` }
      : null,
  ].filter(Boolean).slice(0, 6);

  const alertsCard = el("div", { class: "md3-card md3-alerts-card" }, [
    el("h3", { class: "md3-card__title" }, "Quick Insights"),
    insightCandidates.length
      ? el("ul", { class: "md3-alerts-list" }, insightCandidates.map((item) =>
          el("li", {}, [el("span", { class: `material-symbols-rounded text-${item.color}` }, item.icon), item.text])
        ))
      : el("p", { class: "text-muted" }, "Not enough data yet to generate insights."),
  ]);
  leftCol.append(alertsCard);

  const chartCard = el("div", { class: "md3-card" }, [
    el("h3", { class: "md3-card__title" }, "Revenue Trend"),
    el("div", { class: "md3-chart-container" }, [
      el("canvas", { id: "revenueChart" })
    ])
  ]);
  leftCol.append(chartCard);

  // --- Center Column ---
  const centerCol = el("div", { class: "md3-col" });

  const demoCard = el("div", { class: "md3-card" }, [
    el("h3", { class: "md3-card__title" }, "Students by Grade"),
    el("div", { class: "md3-chart-container" }, [
      el("canvas", { id: "demographicsChart" })
    ])
  ]);
  centerCol.append(demoCard);

  const upcomingCard = el("div", { class: "md3-card" }, [
    el("h3", { class: "md3-card__title" }, "Upcoming Assessments")
  ]);
  const upcoming = assessments.filter(a => a.status === "open").slice(0, 3);
  if (upcoming.length) {
    const eventList = el("div", { class: "md3-event-list" });
    for (const event of upcoming) {
      eventList.append(el("div", { class: "md3-event-item" }, [
        el("div", { class: "md3-event-date" }, [
          el("span", { class: "day" }, event.date ? event.date.split("-")[2] : "--"),
          el("span", { class: "month" }, event.date ? new Date(event.date).toLocaleString('default', { month: 'short' }) : "--")
        ]),
        el("div", { class: "md3-event-details" }, [
          el("div", { class: "title" }, event.name),
          el("div", { class: "meta" }, `${event.type} • Wgt: ${event.weight}%`)
        ])
      ]));
    }
    upcomingCard.append(eventList);
  } else {
    upcomingCard.append(el("p", { class: "text-muted" }, "No open assessments scheduled."));
  }
  centerCol.append(upcomingCard);

  // --- Right Column ---
  const rightCol = el("div", { class: "md3-col" });
  const activityCard = el("div", { class: "md3-card" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center;" }, [
      el("h3", { class: "md3-card__title", style: "margin:0;" }, "Live Activity"),
      profile.role === "admin"
        ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => navigate("/audit") }, "View all")
        : "",
    ]),
  ]);

  if (recentLogs.length) {
    const timeline = el("div", { class: "md3-timeline" });
    for (const log of recentLogs) {
      const actionData = describeLog(log);
      timeline.append(el("div", { class: "md3-timeline-item" }, [
        el("div", { class: "md3-timeline-icon" }, [
          el("span", { class: `material-symbols-rounded text-${actionData.color}` }, actionData.icon)
        ]),
        el("div", { class: "md3-timeline-content" }, [
          el("div", { class: "text" }, actionData.label),
          el("div", { class: "time text-xs text-muted" }, log.timestamp ? formatDate(log.timestamp) : "Just now")
        ])
      ]));
    }
    activityCard.append(timeline);
  } else {
    activityCard.append(el("p", { class: "text-muted" }, "No recent activity found."));
  }
  rightCol.append(activityCard);

  mainGrid.append(leftCol, centerCol, rightCol);
  wrap.append(mainGrid);

  if (!studentsCount) {
    wrap.append(
      el("div", { class: "card empty-state", style: "margin-top: 24px;" }, [
        el("span", { class: "material-symbols-rounded empty-state__icon" }, "school"),
        el("h3", {}, "No students yet"),
        el("p", {}, "Head over to Student Management to admit your first batch of students."),
      ])
    );
  }

  return wrap;
}

export function init() {
  // 1. Initialize Real Revenue Line Chart
  const revCtx = document.getElementById('revenueChart');
  if (revCtx) {
    new Chart(revCtx, {
      type: 'line',
      data: {
        labels: chartDataCache.revenueLabels,
        datasets: [{
          label: 'Fees (KES)',
          data: chartDataCache.revenueData, 
          borderColor: '#14538A',
          backgroundColor: 'rgba(20, 83, 138, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#C9A227',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // 2. Initialize Real Demographics Doughnut Chart
  const demoCtx = document.getElementById('demographicsChart');
  if (demoCtx && chartDataCache.gradeLabels.length > 0) {
    new Chart(demoCtx, {
      type: 'doughnut',
      data: {
        labels: chartDataCache.gradeLabels,
        datasets: [{
          data: chartDataCache.gradeCounts,
          backgroundColor: [
            '#14538A', '#1E6FB5', '#C9A227', '#E9D9A0', '#2E7D46', '#1565C0'
          ],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } }
        }
      }
    });
  }
}