import { collection, getCountFromServer, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, getMonthlyRevenueTrend, getStudentsWithBalancesCount, formatKES } from "../js/services/fee.service.js";
import { fetchRecentLogs, describeLog } from "../js/services/audit.service.js";
import { listAssessments } from "../js/services/assessment.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getCurrentSchoolId } from "../js/services/auth.service.js";
import { cachedWithFallback } from "../js/services/query-cache.js";
import { navigate } from "../js/router.js";
import { el, formatDate, getBrandColors, hexToRgba } from "../js/utils.js";

import { Chart, registerables } from "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm";
Chart.register(...registerables);

// getCountFromServer is server-only - no offline cache of its own - so a
// failed fetch falls back to the last count that *did* load this session
// (tagged stale) instead of reporting 0 active staff, same reasoning as
// the fee aggregates in fee.service.js.
async function safeCount(collectionName) {
  const schoolId = getCurrentSchoolId();
  return cachedWithFallback(`dashboard:count:${collectionName}:${schoolId}`, async () => {
    const snap = await getCountFromServer(query(collection(db, collectionName), where("schoolId", "==", schoolId)));
    return snap.data().count;
  }, 0);
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

  const [teachersResult, attendanceStat, feesCollectedResult, recentLogs, assessments, allStudents, studentsWithBalancesResult, monthlyRevenueResult] = await Promise.all([
    safeCount("teachers"),
    getTodayAttendanceStat(),
    getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
    fetchRecentLogs(7),
    listAssessments(),
    listStudents(),
    // Single count aggregate against student_fee_status (kept in sync by
    // fee.service.js on every payment/fee-structure change) instead of a
    // per-student getFeeSummary() loop over the whole active roster.
    getStudentsWithBalancesCount(settings.currentAcademicYear, settings.currentTerm),
    // 6 bounded server-side sum aggregates, one per month - no payment docs
    // are downloaded to build the revenue trend chart.
    getMonthlyRevenueTrend(6),
  ]);

  // These four are all server-only aggregate reads with no offline cache
  // fallback of their own (see fee.service.js/safeCount above) - each one
  // that couldn't refresh comes back as its last known value, tagged
  // stale, rather than a misleading 0. showingStaleData drives the banner
  // below so an offline admin sees "last known" figures, not a dashboard
  // that quietly looks like the school suddenly has no revenue or staff.
  const teachers = teachersResult.value;
  const feesCollected = feesCollectedResult.value;
  const studentsWithBalancesCount = studentsWithBalancesResult.value;
  const monthlyRevenue = monthlyRevenueResult.months;
  const showingStaleData = teachersResult.stale || feesCollectedResult.stale || studentsWithBalancesResult.stale || monthlyRevenueResult.stale;

  const activeStudents = allStudents.filter(s => s.status === 'active');
  const studentsCount = activeStudents.length;

  // Turn the raw marked/present counts into a percentage of the WHOLE
  // active roster, not just the students whose class happened to be
  // marked already. A percentage of only who's-marked-so-far reads as
  // final-for-the-day attendance and is easy to misread (mark one small
  // class all-present early in the morning and it claimed "100%" for the
  // whole school). "N/A" only when literally nothing has been marked yet.
  let attendanceToday = "N/A";
  let attendanceCoverageNote = null;
  if (attendanceStat.marked > 0) {
    const denominator = studentsCount > 0 ? studentsCount : attendanceStat.marked;
    attendanceToday = `${Math.round((attendanceStat.present / denominator) * 100)}%`;
    if (studentsCount > 0 && attendanceStat.marked < studentsCount) {
      attendanceCoverageNote = `Only ${attendanceStat.marked} of ${studentsCount} student(s) marked so far today.`;
    }
  }

  // 1. Revenue Trend (oldest-first months, straight from getMonthlyRevenueTrend)
  const hasRevenueData = monthlyRevenue.some((m) => m.total > 0);
  chartDataCache.revenueLabels = hasRevenueData ? monthlyRevenue.map((m) => m.label) : ['No Data Yet'];
  chartDataCache.revenueData = hasRevenueData ? monthlyRevenue.map((m) => m.total) : [0];

  // 2. Calculate Demographics Data
  const gradeDistribution = {};
  activeStudents.forEach(s => {
    const g = s.grade || "Unassigned";
    gradeDistribution[g] = (gradeDistribution[g] || 0) + 1;
  });
  chartDataCache.gradeLabels = Object.keys(gradeDistribution);
  chartDataCache.gradeCounts = Object.values(gradeDistribution);

  // 3. Gender split (real headcount, not a guess)
  const boysCount = activeStudents.filter((s) => s.gender === "Male").length;
  const girlsCount = activeStudents.filter((s) => s.gender === "Female").length;

  // 4. New admissions in the last 30 days
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const newAdmissionsCount = activeStudents.filter((s) => {
    if (!s.admissionDate) return false;
    const admitted = new Date(s.admissionDate).getTime();
    return !isNaN(admitted) && Date.now() - admitted <= THIRTY_DAYS_MS;
  }).length;

  // 5. Assessment pipeline: what's open (needs marks) vs locked
  const openAssessmentsCount = assessments.filter((a) => a.status === "open").length;
  const lockedAssessmentsCount = assessments.filter((a) => a.status === "locked").length;

  // 6. Which grade carries the largest headcount
  let topGrade = null;
  for (const [grade, count] of Object.entries(gradeDistribution)) {
    if (!topGrade || count > topGrade.count) topGrade = { grade, count };
  }

  // 7. Month-over-month revenue trend (last two months of the bounded window)
  let revenueTrend = null;
  if (monthlyRevenue.length >= 2) {
    const last = monthlyRevenue[monthlyRevenue.length - 1];
    const prev = monthlyRevenue[monthlyRevenue.length - 2];
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

  if (showingStaleData) {
    wrap.append(
      el("div", { class: "notice-banner" }, [
        el("span", { class: "material-symbols-rounded" }, "wifi_off"),
        "Some figures below (staff count, revenue, fee balances) couldn't refresh just now and are showing the last data we had - they may not reflect today's changes.",
      ])
    );
  }

  // Interactive KPI Chips
  const kpiGrid = el("div", { class: "md3-kpi-grid" });
  const kpis = [
    { label: "Active Students", value: studentsCount, icon: "school", color: "blue" },
    { label: "Active Staff", value: teachers, icon: "badge", color: "gold" },
    { label: "Attendance Today", value: attendanceToday || "0%", icon: "how_to_reg", color: "green" },
    {
      label: "Term Revenue",
      currency: "KES",
      value: Number(feesCollected || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      icon: "account_balance_wallet",
      color: "gold",
    },
  ];

  for (const kpi of kpis) {
    kpiGrid.append(
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${kpi.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [
          el("span", { class: "material-symbols-rounded" }, kpi.icon)
        ]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, kpi.label),
          kpi.currency
            ? el("div", { class: "md3-kpi-chip__val-wrap" }, [
                el("span", { class: "md3-kpi-chip__currency" }, kpi.currency),
                el("span", { class: "md3-kpi-chip__value numeric" }, kpi.value),
              ])
            : el("div", { class: "md3-kpi-chip__value numeric" }, String(kpi.value)),
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
        ? { icon: "how_to_reg", color: "green", text: `Attendance today is strong at ${attendanceToday}${attendanceCoverageNote ? ` - but ${attendanceCoverageNote.toLowerCase()}` : "."}` }
        : attendancePct >= 75
        ? { icon: "how_to_reg", color: "gold", text: `Attendance today is ${attendanceToday} - a bit below usual.${attendanceCoverageNote ? ` ${attendanceCoverageNote}` : ""}` }
        : { icon: "how_to_reg", color: "red", text: `Attendance today is low at ${attendanceToday}.${attendanceCoverageNote ? ` ${attendanceCoverageNote}` : ""}` }
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
  const { primary, accent } = getBrandColors();

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
          borderColor: primary,
          backgroundColor: hexToRgba(primary, 0.15),
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: accent,
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
            primary,
            hexToRgba(primary, 0.75),
            accent,
            hexToRgba(accent, 0.65),
            hexToRgba(primary, 0.45),
            '#2E7D46',
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