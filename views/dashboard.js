import { collection, getCountFromServer, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, getMonthlyRevenueTrend, getStudentsWithBalancesCount, formatKES } from "../js/services/fee.service.js";
import { listAssessments } from "../js/services/assessment.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getCurrentSchoolId } from "../js/services/auth.service.js";
import { cachedWithFallback } from "../js/services/query-cache.js";
import { navigate } from "../js/router.js";
import { el, formatDate, getBrandColors, hexToRgba } from "../js/utils.js";

import { Chart, registerables } from "chart.js";
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

  const [teachersResult, attendanceStat, feesCollectedResult, assessments, allStudents, studentsWithBalancesResult, monthlyRevenueResult] = await Promise.all([
    safeCount("teachers"),
    getTodayAttendanceStat(),
    getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
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

  const hour = new Date().getHours();
  let greeting = "Good evening";
  if (hour < 12) greeting = "Good morning";
  else if (hour < 18) greeting = "Good afternoon";

  const waveStyle = el("style", {}, `
    @keyframes waveAnimation {
      0% { transform: rotate(0deg); }
      15% { transform: rotate(14deg); }
      30% { transform: rotate(-8deg); }
      45% { transform: rotate(14deg); }
      60% { transform: rotate(-4deg); }
      75% { transform: rotate(10deg); }
      90% { transform: rotate(0deg); }
      100% { transform: rotate(0deg); }
    }
    @keyframes slideHide {
      0% { width: 1.2em; opacity: 1; transform: translateX(0) scale(1); margin-right: 8px; }
      100% { width: 0; opacity: 0; transform: translateX(-10px) scale(0); margin-right: 0; }
    }
    .waving-hand {
      display: inline-block;
      transform-origin: 70% 70%;
      animation: waveAnimation 2s ease-in-out, slideHide 0.5s ease-in-out 2.5s forwards;
      white-space: nowrap;
      overflow: hidden;
    }
    
    .dashboard-hero {
      align-items: stretch !important;
      justify-content: flex-start !important;
    }
    .hero-left-content {
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      flex: 1;
      justify-content: center;
      min-width: 0;
    }
    .hero-term-progress {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      text-align: left;
      min-width: 180px;
    }
    .hero-progress-track {
      width: 140px; 
      height: 6px; 
      background: var(--color-line); 
      border-radius: 4px; 
      overflow: hidden; 
      margin-top: 4px;
    }
    
    @media (max-width: 768px) {
      .hero-divider { display: none !important; }
      .dashboard-hero { 
         flex-direction: column !important; 
         align-items: stretch !important; 
         gap: var(--sp-6) !important;
      }
      .hero-left-content { width: 100%; }
      .hero-term-progress { width: 100%; min-width: auto; align-items: stretch; }
      .hero-progress-track { width: 100%; }
      .dashboard-hero .md3-hero__actions { width: 100%; }
      .dashboard-hero .md3-hero__actions .btn { flex: 1 1 100%; justify-content: center; }
    }
  `);

  let termProgress = el("div", { class: "hero-term-progress" }, [
    el("span", { style: "font-size: var(--fs-sm); color: var(--color-ink-soft); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;" }, "Term Progress")
  ]);

  if (settings.closingDate) {
    const closes = new Date(settings.closingDate);
    const today = new Date();
    closes.setHours(0,0,0,0);
    today.setHours(0,0,0,0);

    const msPerDay = 1000 * 60 * 60 * 24;
    const diffDays = Math.ceil((closes - today) / msPerDay);
    
    let termLength = 90;
    if (settings.termBegins) {
      const begins = new Date(settings.termBegins);
      begins.setHours(0,0,0,0);
      const diffTotal = Math.ceil((closes - begins) / msPerDay);
      if (diffTotal > 0) termLength = diffTotal;
    }

    const daysPassed = termLength - diffDays;
    let pct = Math.max(0, Math.min(100, Math.round((daysPassed / termLength) * 100)));

    if (diffDays < 0) {
       termProgress.append(el("strong", { style: "font-size: 24px; line-height: 1; color: var(--color-red); margin-bottom: 4px;" }, "Closed"));
       termProgress.append(el("span", { style: "font-size: var(--fs-xs); color: var(--color-ink-soft);" }, `Ended ${Math.abs(diffDays)} days ago`));
    } else {
       termProgress.append(el("strong", { style: "font-size: 24px; line-height: 1; color: var(--color-ink); margin-bottom: 4px;" }, `${diffDays} Days Left`));
       termProgress.append(el("div", { class: "hero-progress-track" }, [
         el("div", { style: `height: 100%; width: ${pct}%; background: var(--color-primary-700); border-radius: 4px;` })
       ]));
    }
  } else {
    termProgress.append(el("strong", { style: "font-size: 20px; line-height: 1; color: var(--color-ink); margin-bottom: 4px;" }, "Not Set"));
    termProgress.append(el("span", { style: "font-size: var(--fs-xs); color: var(--color-ink-soft);" }, "Configure in Settings"));
  }

  const divider = el("div", { class: "hero-divider", style: "display: flex; gap: 4px; margin: 0 var(--sp-4); padding: 4px 0;" }, [
    el("div", { style: "width: 3px; background: var(--color-primary-700); border-radius: 2px; height: 100%; opacity: 0.8;" }),
    el("div", { style: "width: 3px; background: var(--color-primary-700); border-radius: 2px; height: 100%; opacity: 0.3;" })
  ]);

// Hero Section
  const header = el("div", { class: "md3-hero dashboard-hero" }, [
    waveStyle,
    el("div", { class: "hero-left-content" }, [
      el("div", { class: "md3-hero__text" }, [
        el("h1", { style: "margin: 0; display: flex; align-items: center;" }, [
          el("span", { class: "material-symbols-rounded waving-hand", style: "font-size: 1.1em; color: var(--color-primary-700);" }, "waving_hand"),
          el("span", {}, `${greeting}, ${profile.fullName || profile.email}`)
        ])
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
    ]),
    divider,
    termProgress
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
  // For a brand-new school every counter is 0 / N/A.  Show a dash with a
  // muted hint so the chip doesn't look broken instead of empty.
  const isNewSchool = !studentsCount && !teachers && !feesCollected;

  const kpiGrid = el("div", { class: "md3-kpi-grid" });
  const kpis = [
    {
      label: "Active Students",
      value: studentsCount || null,
      hint: "No admissions yet",
      icon: "school",
      color: "blue",
    },
    {
      label: "Active Staff",
      value: teachers || null,
      hint: "No staff added yet",
      icon: "badge",
      color: "gold",
    },
    {
      label: "Attendance Today",
      value: attendanceToday && attendanceToday !== "N/A" ? attendanceToday : null,
      hint: "Not marked yet",
      icon: "how_to_reg",
      color: "green",
    },
    {
      label: "Term Revenue",
      currency: feesCollected ? "KES" : null,
      value: feesCollected
        ? Number(feesCollected).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : null,
      hint: "No fees recorded yet",
      icon: "account_balance_wallet",
      color: "gold",
    },
  ];

  for (const kpi of kpis) {
    const hasValue = kpi.value !== null && kpi.value !== undefined;
    kpiGrid.append(
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${kpi.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [
          el("span", { class: "material-symbols-rounded" }, kpi.icon)
        ]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, kpi.label),
          hasValue
            ? (kpi.currency
                ? el("div", { class: "md3-kpi-chip__val-wrap" }, [
                    el("span", { class: "md3-kpi-chip__currency" }, kpi.currency),
                    el("span", { class: "md3-kpi-chip__value numeric" }, String(kpi.value)),
                  ])
                : el("div", { class: "md3-kpi-chip__value numeric" }, String(kpi.value)))
            : el("div", { class: "md3-kpi-chip__empty" }, [
                el("span", { class: "md3-kpi-chip__dash" }, "—"),
                kpi.hint ? el("span", { class: "md3-kpi-chip__hint" }, kpi.hint) : null,
              ].filter(Boolean)),
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
      : null,

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

  // Quick Insights card — full empty state when the school is brand-new
  let insightsBody;
  if (insightCandidates.length) {
    insightsBody = el("ul", { class: "md3-alerts-list" }, insightCandidates.map((item) =>
      el("li", {}, [el("span", { class: `material-symbols-rounded text-${item.color}` }, item.icon), item.text])
    ));
  } else {
    insightsBody = el("div", { class: "card-empty-state" }, [
      el("span", { class: "material-symbols-rounded card-empty-state__icon" }, "auto_awesome"),
      el("p", { class: "card-empty-state__title" }, "No insights yet"),
      el("p", { class: "card-empty-state__sub" }, "Insights will appear here once students, fees, and attendance data are added."),
    ]);
  }

  const alertsCard = el("div", { class: "md3-card md3-alerts-card" }, [
    el("h3", { class: "md3-card__title" }, "Quick Insights"),
    insightsBody,
  ]);
  leftCol.append(alertsCard);

  // Removed Live Activity as it belongs in the Audit Trail section.

  // --- Center Column ---
  const centerCol = el("div", { class: "md3-col" });

  // "Students by Grade" — show empty state when there are no students yet
  const hasGradeData = chartDataCache.gradeLabels.length > 0;
  const demoCard = el("div", { class: "md3-card" }, [
    el("h3", { class: "md3-card__title" }, "Students by Grade"),
    hasGradeData
      ? el("div", { class: "md3-chart-container" }, [
          el("canvas", { id: "demographicsChart" })
        ])
      : el("div", { class: "card-empty-state" }, [
          el("span", { class: "material-symbols-rounded card-empty-state__icon" }, "bar_chart"),
          el("p", { class: "card-empty-state__title" }, "No enrollment data"),
          el("p", { class: "card-empty-state__sub" }, "Grade distribution will appear once students are admitted."),
        ]),
  ]);
  centerCol.append(demoCard);

  // --- Right Column ---
  const rightCol = el("div", { class: "md3-col" });

  // "Revenue Trend" — show empty state when there is no fee revenue yet
  const chartCard = el("div", { class: "md3-card" }, [
    el("h3", { class: "md3-card__title" }, "Revenue Trend"),
    hasRevenueData
      ? el("div", { class: "md3-chart-container" }, [
          el("canvas", { id: "revenueChart" })
        ])
      : el("div", { class: "card-empty-state" }, [
          el("span", { class: "material-symbols-rounded card-empty-state__icon" }, "show_chart"),
          el("p", { class: "card-empty-state__title" }, "No revenue recorded"),
          el("p", { class: "card-empty-state__sub" }, "The fee trend chart will populate as payments are recorded."),
        ]),
  ]);
  rightCol.append(chartCard);

  // Removed Upcoming Assessments as it has a dedicated section.

  mainGrid.append(leftCol, centerCol, rightCol);
  wrap.append(mainGrid);

  // Welcome call-to-action for brand-new schools — shown below the grid
  // instead of the charts so the page never looks like a wall of empty boxes.
  if (isNewSchool) {
    wrap.append(
      el("div", { class: "md3-card dashboard-welcome-card", style: "margin-top: var(--sp-2);" }, [
        el("div", { class: "dashboard-welcome-inner" }, [
          el("div", { class: "dashboard-welcome-icon" }, [
            el("span", { class: "material-symbols-rounded" }, "rocket_launch"),
          ]),
          el("div", { class: "dashboard-welcome-text" }, [
            el("h3", { style: "margin: 0 0 var(--sp-1);" }, "Welcome to your school dashboard!"),
            el("p", { style: "margin: 0; color: var(--color-ink-soft); font-size: var(--fs-sm);" },
              "Get started by admitting students, adding staff, and configuring your school settings. Your dashboard will come to life as data flows in."),
          ]),
          el("div", { class: "dashboard-welcome-actions" }, [
            el("button", { class: "btn btn--primary btn--sm", onClick: () => navigate("/students") }, [
              el("span", { class: "material-symbols-rounded" }, "person_add"), "Admit Students"
            ]),
            el("button", { class: "btn btn--outline btn--sm", onClick: () => navigate("/school-settings") }, [
              el("span", { class: "material-symbols-rounded" }, "settings"), "School Settings"
            ]),
          ]),
        ]),
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