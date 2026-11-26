import { listClasses } from "../js/services/academic.service.js";
import { collection, getCountFromServer, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, getMonthlyRevenueTrend, getStudentsWithBalancesCount, formatKES } from "../js/services/fee.service.js";
import { listAssessments } from "../js/services/assessment.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getCurrentSchoolId } from "../js/services/auth.service.js";
import { cachedWithFallback } from "../js/services/query-cache.js";
import { navigate } from "../js/router.js";
import { el, formatDate, getBrandColors, hexToRgba, animateNumber } from "../js/utils.js";
import { navigateDeepLink, internalLink } from "../js/services/deep-link.service.js";
import { buildMascotSvg } from "../js/components/mascot.js";
import { animateGreetingMascot, GREETING_DURATION_MS } from "../js/components/greeting-mascot-3d.js";

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
  gradeColors: [],
  revenueLabels: [],
  revenueData: [],
  hasRevenueData: false
};
let currentSettings = null;
let activeProfile = null;
let greetedSession = null;

function playDashboardGreeting(profile) {
  const slot = document.querySelector(".dashboard-greeting-mascot-slot");
  if (!profile?.uid || !slot?.getClientRects().length || slot.firstElementChild) return;

  // Keep playback state in this document so a reload plays the greeting again.
  const session = `${profile.uid}:${auth.currentUser?.metadata.lastSignInTime || ""}`;
  if (greetedSession === session) return;

  let stopMascot;
  const canvas = el("canvas");
  const mascot = el("div", {
    class: "dashboard-greeting-mascot",
    style: `--dashboard-greeting-duration: ${GREETING_DURATION_MS}ms;`,
    onAnimationEnd: (event) => {
      if (event.target !== mascot) return;
      greetedSession = session;
      stopMascot?.();
      mascot.remove();
    },
    onAnimationCancel: (event) => {
      if (event.target !== mascot) return;
      stopMascot?.();
      mascot.remove();
    },
  }, canvas);
  slot.append(mascot);

  const showFallback = () => {
    if (mascot.isConnected) mascot.innerHTML = buildMascotSvg({ type: "greeting", width: 110, height: 100 });
  };
  stopMascot = animateGreetingMascot(canvas, {
    ...getBrandColors(),
    period: slot.dataset.greetingPeriod,
    onContextLost: showFallback,
  });
  if (!stopMascot) showFallback();
}

function getGradePalette() {
  const isDark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    return [
      "#38BDF8", // Luminous Sky Blue (high contrast against dark cards)
      "#FBBF24", // Radiant Warm Amber/Gold (vivid, non-muddy)
      "#34D399", // Emerald Green
      "#FB923C", // Coral Orange
      "#A78BFA", // Luminous Violet
      "#F472B6", // Rose Pink
      "#2DD4BF", // Bright Teal
      "#FDE047"  // Soft Radiant Gold
    ];
  }
  const { primary, accent } = getBrandColors();
  return [
    primary,
    "#D97706", // Rich Amber with strong contrast
    "#0284C7", // Sky blue
    "#CA8A04", // Deep Gold
    "#16A34A", // Emerald green
    "#8B5CF6", // Purple
    "#EC4899", // Pink
    "#EA580C"  // Orange
  ];
}

export async function render({ profile }) {
  const settings = await getSchoolSettings();
  currentSettings = settings;
  activeProfile = profile;
  const roster = listStudents();

  const [teachersResult, attendanceStat, feesCollectedResult, assessments, allStudents, studentsWithBalancesResult, monthlyRevenueResult, classesList] = await Promise.all([
    safeCount("teachers"),
    getTodayAttendanceStat(),
    getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
    listAssessments(),
    roster,
    getStudentsWithBalancesCount(settings.currentAcademicYear, settings.currentTerm, roster),
    // 6 bounded server-side sum aggregates, one per month - no payment docs
    // are downloaded to build the revenue trend chart.
    getMonthlyRevenueTrend(6),
    listClasses().catch(() => []),
  ]);

  // These four use server-only reads with no offline cache
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

  // Report attendance against the active roster and show roll call coverage alongside it.
  const { marked, present, failed: attendanceUnavailable } = attendanceStat;
  const attendanceTotal = studentsCount || marked;
  const attendancePct = marked > 0 ? Math.round((present / attendanceTotal) * 100) : null;
  const rollCallPending = !attendanceUnavailable && marked < studentsCount;
  let attendanceCoverage = "No active students";
  if (attendanceUnavailable) {
    attendanceCoverage = "Attendance unavailable";
  } else if (attendanceTotal > 0) {
    attendanceCoverage = studentsCount > 0 && marked <= studentsCount
      ? `${marked} of ${studentsCount} marked`
      : `${marked} marked`;
  }

  // 1. Revenue Trend (oldest-first months, straight from getMonthlyRevenueTrend)
  const hasRevenueData = monthlyRevenue.some((m) => m.total > 0);
  chartDataCache.hasRevenueData = hasRevenueData;
  chartDataCache.revenueLabels = hasRevenueData ? monthlyRevenue.map((m) => m.label) : [];
  chartDataCache.revenueData = hasRevenueData ? monthlyRevenue.map((m) => m.total) : [];

  // 2. Calculate Demographics Data
  const gradeDistribution = {};
  activeStudents.forEach(s => {
    const g = s.grade || "Unassigned";
    gradeDistribution[g] = (gradeDistribution[g] || 0) + 1;
  });
  chartDataCache.gradeLabels = Object.keys(gradeDistribution);
  chartDataCache.gradeCounts = Object.values(gradeDistribution);
  const palette = getGradePalette();
  chartDataCache.gradeColors = chartDataCache.gradeLabels.map((_, i) => palette[i % palette.length]);

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

  if (settings.pendingTransfer) {
    const pt = settings.pendingTransfer;
    const reqTime = new Date(pt.requestedAt).getTime();
    const coolOffEnd = reqTime + (24 * 60 * 60 * 1000);
    const now = Date.now();
    const isReady = now >= coolOffEnd;
    
    let timeText = "";
    if (isReady) {
      timeText = "Cooling-off period complete. Awaiting Platform Admin approval.";
    } else {
      const remainingHours = Math.floor((coolOffEnd - now) / (1000 * 60 * 60));
      const remainingMinutes = Math.floor(((coolOffEnd - now) % (1000 * 60 * 60)) / (1000 * 60));
      timeText = `Security Cooling-off Period: ${remainingHours}h ${remainingMinutes}m remaining.`;
    }

    const banner = el("div", { class: "notice-banner notice-banner--warning", style: "margin-bottom: var(--sp-6); border: 1px solid var(--color-red); background: rgba(220, 38, 38, 0.05);" }, [
      el("span", { class: "material-symbols-rounded", style: "color: var(--color-red);" }, "warning"),
      el("div", { style: "flex: 1;" }, [
        el("strong", { style: "display: block; color: var(--color-red); margin-bottom: 4px;" }, `Transfer Pending: Ownership transfer to ${pt.newAdmin?.fullName || 'another user'} initiated.`),
        el("span", { style: "font-size: var(--fs-sm); display: block;" }, timeText),
        el("span", { style: "font-size: var(--fs-sm); display: block; margin-top: 2px;" }, "Status: Awaiting Platform Admin approval.")
      ]),
      el("button", { 
        class: "btn btn--danger btn--sm",
        onClick: async (e) => {
          if (!confirm("Are you sure you want to cancel the ownership transfer?")) return;
          const { cancelOwnershipTransfer } = await import("../js/services/settings.service.js");
          const { busyButton, toast } = await import("../js/utils.js");
          const restore = busyButton(e.currentTarget, "Canceling…");
          try {
            await cancelOwnershipTransfer(activeProfile.uid);
            toast("Ownership transfer cancelled.", "success");
            banner.remove();
            settings.pendingTransfer = null;
          } catch (err) {
            toast(err.message || "Could not cancel transfer.", "error");
            restore();
          }
        }
      }, "Cancel Transfer")
    ]);
    wrap.append(banner);
  }

  const hour = new Date().getHours();
  const greetingPeriod = hour < 12 ? "morning" : hour < 16 ? "afternoon" : "evening";

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
       const daysAgo = Math.abs(diffDays);
       termProgress.append(el("span", { style: "font-size: var(--fs-xs); color: var(--color-ink-soft);" }, `Ended ${daysAgo} ${daysAgo === 1 ? "day" : "days"} ago`));
    } else {
       const daysText = diffDays === 1 ? "1 Day Left" : (diffDays === 0 ? "Ends Today" : `${diffDays} Days Left`);
       termProgress.append(el("strong", { style: "font-size: 24px; line-height: 1; color: var(--color-ink); margin-bottom: 4px;" }, daysText));
       termProgress.append(el("div", { class: "hero-progress-track" }, [
         el("div", { style: `height: 100%; width: ${pct}%; background: var(--color-primary-700); border-radius: 4px;` })
       ]));
    }
  } else {
    termProgress.style.cursor = "pointer";
    termProgress.title = "Click to configure Academic Calendar in Settings";
    termProgress.addEventListener("click", () => navigate("/settings?tab=calendar"));
    termProgress.append(
      el("strong", { style: "font-size: 20px; line-height: 1; color: var(--color-primary-700); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;" }, [
        "Not Set",
        el("span", { class: "material-symbols-rounded", style: "font-size: 18px;" }, "arrow_forward")
      ])
    );
    termProgress.append(el("span", { style: "font-size: var(--fs-xs); color: var(--color-primary-700); text-decoration: underline;" }, "Configure in Settings"));
  }

  const divider = el("div", { class: "hero-divider", style: "display: flex; gap: 4px; margin: 0 var(--sp-4); padding: 4px 0;" }, [
    el("div", { style: "width: 3px; background: var(--color-primary-700); border-radius: 2px; height: 100%; opacity: 0.8;" }),
    el("div", { style: "width: 3px; background: var(--color-primary-700); border-radius: 2px; height: 100%; opacity: 0.3;" })
  ]);

  // Hero Section
  const header = el("div", { class: "md3-hero dashboard-hero" }, [
    el("div", { class: "hero-left-content" }, [
      el("div", { class: "dashboard-greeting-copy" }, [
        el("h1", {}, `Good ${greetingPeriod}, ${profile.fullName || profile.email}`),
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
      el("div", {
        class: "dashboard-greeting-mascot-slot",
        "data-greeting-period": greetingPeriod,
        "aria-hidden": "true",
      }),
    ]),
    divider,
    termProgress
  ]);
  wrap.append(header);

  // Promotion season banner — shown when the school is in its final term AND
  // the term is nearing completion (≥75% elapsed) or has already ended. This
  // avoids the banner appearing on day 1 of Term 3 when promotions are still
  // weeks away. Falls back to a simple "is last term" check when the school
  // hasn't configured calendar dates (termBegins / closingDate).
  const promoRoles = ["admin", "principal", "deputy_principal", "academic_master"];
  const terms = settings.terms || ["Term 1", "Term 2", "Term 3"];
  const isLastTerm = terms.length > 0 && (settings.currentTerm || "") === terms[terms.length - 1];
  const promoDismissKey = `jss_promo_banner_dismissed_${getCurrentSchoolId()}_${settings.currentAcademicYear || ""}`;
  const promoDismissed = (() => { try { return localStorage.getItem(promoDismissKey) === "1"; } catch { return false; } })();

  // Compute whether the term is far enough along to warrant the nudge
  let promoTimingReady = false;
  if (isLastTerm && settings.closingDate) {
    const closes = new Date(settings.closingDate);
    const today = new Date();
    closes.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const diffDays = Math.ceil((closes - today) / msPerDay);
    let tLen = 90;
    if (settings.termBegins) {
      const begins = new Date(settings.termBegins);
      begins.setHours(0,0,0,0);
      const diffTotal = Math.ceil((closes - begins) / msPerDay);
      if (diffTotal > 0) tLen = diffTotal;
    }
    const daysPassed = tLen - diffDays;
    const termPct = Math.max(0, Math.round((daysPassed / tLen) * 100));
    // Show when ≥75% done or the term has already closed
    promoTimingReady = termPct >= 75 || diffDays < 0;
  } else if (isLastTerm) {
    // No calendar dates configured — show for the entire last term (legacy)
    promoTimingReady = true;
  }

  if (promoTimingReady && promoRoles.includes(profile.role) && !promoDismissed) {
    const promoBanner = el("div", { class: "promotion-banner promotion-banner--dashboard" }, [
      el("div", { class: "promotion-banner__icon-wrap" }, [
        el("span", { class: "material-symbols-rounded" }, "school"),
      ]),
      el("div", { class: "promotion-banner__body" }, [
        el("div", { class: "promotion-banner__title" }, "End-of-Year Promotions"),
        el("p", { class: "promotion-banner__desc" },
          `${settings.currentTerm} is winding down. Once results are finalized, use the Promotion Engine to advance students to the next academic year.`
        ),
      ]),
      el("div", { class: "promotion-banner__actions" }, [
        el("button", { class: "btn btn--primary btn--sm", onClick: () => navigate("/promotions") }, [
          el("span", { class: "material-symbols-rounded" }, "trending_up"), "Go to Promotions"
        ]),
        el("button", { class: "btn btn--ghost btn--sm promotion-banner__dismiss", title: "Dismiss for this year", onClick: () => {
          try { localStorage.setItem(promoDismissKey, "1"); } catch {}
          promoBanner.style.opacity = "0";
          promoBanner.style.transform = "translateY(-8px)";
          setTimeout(() => promoBanner.remove(), 250);
        }}, [el("span", { class: "material-symbols-rounded" }, "close")]),
      ]),
    ]);
    wrap.append(promoBanner);
  }

  if (showingStaleData) {
    wrap.append(
      el("div", { class: "notice-banner" }, [
        el("span", { class: "material-symbols-rounded" }, "wifi_off"),
        "Some figures below (staff count, revenue, fee balances) couldn't refresh just now and are showing the last data we had - they may not reflect today's changes.",
      ])
    );
  }

  // Interactive KPI Chips
  // A brand-new school has zero students, staff, and revenue recorded.
  // Instead of defeatist "No ... yet" text and dashes, show confident numeric values
  // with quick-action badges so administrators immediately have clear paths to take action.
  const isNewSchool = !studentsCount && !teachers && !feesCollected;

  const kpiGrid = el("div", { class: "md3-kpi-grid" });
  const kpis = [
    {
      label: "Active Students",
      rawNumber: studentsCount || 0,
      displayValue: String(studentsCount),
      icon: "school",
      color: "blue",
    },
    {
      label: "Active Staff",
      rawNumber: teachers || 0,
      displayValue: String(teachers || 0),
      icon: "badge",
      color: "gold",
    },
    {
      label: "Attendance Today",
      displayValue: attendancePct === null ? "—" : `${attendancePct}%`,
      note: attendanceCoverage,
      icon: "how_to_reg",
      color: "green",
    },
    {
      label: "Term Revenue",
      currency: "KES",
      rawNumber: Number(feesCollected || 0),
      decimals: 2,
      displayValue: Number(feesCollected || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      icon: "account_balance_wallet",
      color: "gold",
    },
  ];

  for (const kpi of kpis) {
    const valueSpan = el("span", { class: "md3-kpi-chip__value numeric" }, kpi.displayValue);
    if (kpi.rawNumber !== undefined) {
      animateNumber(valueSpan, kpi.rawNumber, { decimals: kpi.decimals || 0 });
    }

    const valContent = kpi.currency
      ? el("div", { class: "md3-kpi-chip__val-wrap" }, [
          el("span", { class: "md3-kpi-chip__currency" }, kpi.currency),
          valueSpan,
        ])
      : valueSpan;

    kpiGrid.append(
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${kpi.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [
          el("span", { class: "material-symbols-rounded" }, kpi.icon)
        ]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, kpi.label),
          valContent,
          kpi.note ? el("span", { class: "md3-kpi-chip__note" }, kpi.note) : null,
        ])
      ])
    );
  }
  wrap.append(kpiGrid);

  if (isNewSchool) {
    // School Launchpad for Brand-New Schools
    const classesCount = classesList ? classesList.length : 0;
    const hasClasses = classesCount > 0;
    const hasCalendarConfig = Boolean(settings?.closingDate && settings?.openingDate && settings?.principalName);
    const steps = [
      {
        step: "Step 1",
        title: "School Calendar & Identity",
        desc: "Set current term, milestone dates, and Principal signature for official report cards.",
        icon: "calendar_month",
        color: "gold",
        route: "/settings?tab=calendar",
        btnLabel: hasCalendarConfig ? "View Calendar" : "Configure Dates",
        completed: hasCalendarConfig,
        statusText: hasCalendarConfig ? "Term & Signatories set" : "Dates required",
      },
      {
        step: "Step 2",
        title: "Academic Classes & Streams",
        desc: "Configure grade cohorts (Grade 7, 8, 9), stream divisions, and core CBC learning areas.",
        icon: "account_tree",
        color: "blue",
        route: "/academics",
        btnLabel: hasClasses ? "Manage Classes" : "Configure Classes",
        completed: hasClasses,
        statusText: hasClasses ? `${classesCount} class(es) configured` : "Setup required",
      },
      {
        step: "Step 3",
        title: "Learner Admissions",
        desc: "Admit students individually or in bulk via Excel/CSV, assign admission numbers, and link parents.",
        icon: "person_add",
        color: "green",
        route: "/students",
        btnLabel: hasStudents ? "View Students" : "Admit Learners",
        completed: hasStudents,
        statusText: hasStudents ? `${studentsCount} learners admitted` : "Awaiting learners",
      },
    ];

    const completedCount = steps.filter((s) => s.completed).length;
    const progressPct = Math.round((completedCount / steps.length) * 100);

    const launchpad = el("div", { class: "dashboard-launchpad" }, [
      el("div", { class: "launchpad-hero" }, [
        el("div", { class: "launchpad-hero__info" }, [
          el("h2", { class: "launchpad-hero__title" }, `Welcome to ${settings.schoolName || "Your School"}!`),
          el("p", { class: "launchpad-hero__subtitle" },
            `Your school management portal is initialized for ${settings.currentTerm || "Term 1"} ${settings.currentAcademicYear || new Date().getFullYear()}. Complete these foundational setup steps to activate your academic dashboard and live analytics.`
          ),
        ]),
        el("div", { class: "launchpad-hero__progress-box" }, [
          el("div", { class: "launchpad-hero__progress-header" }, [
            el("span", { class: "launchpad-hero__progress-title" }, "Onboarding Progress"),
            el("span", { class: "launchpad-hero__progress-pct" }, `${completedCount} of ${steps.length} Complete`),
          ]),
          el("div", { class: "launchpad-hero__progress-track" }, [
            el("div", { class: "launchpad-hero__progress-bar", style: `width: ${progressPct}%;` })
          ]),
        ]),
      ]),
      el("div", { class: "launchpad-grid" }, steps.map((step) =>
        el("div", { class: `launchpad-card ${step.completed ? "launchpad-card--completed" : ""}` }, [
          el("div", { class: "launchpad-card__header" }, [
            el("div", { class: `launchpad-card__icon launchpad-card__icon--${step.color}` }, [
              el("span", { class: "material-symbols-rounded" }, step.icon)
            ]),
            el("span", { class: "launchpad-card__step-badge" }, step.completed ? "✓ Done" : step.step)
          ]),
          el("div", { class: "launchpad-card__body" }, [
            el("h4", { class: "launchpad-card__title" }, step.title),
            el("p", { class: "launchpad-card__desc" }, step.desc),
          ]),
          el("div", { class: "launchpad-card__footer" }, [
            el("span", { class: "launchpad-card__status" }, [
              step.completed
                ? el("span", { class: "material-symbols-rounded", style: "color: var(--color-green);" }, "check_circle")
                : el("span", { class: "material-symbols-rounded" }, "pending"),
              step.statusText
            ]),
            el("button", {
              class: `btn ${step.completed ? "btn--outline" : "btn--primary"} btn--xs`,
              onClick: () => navigate(step.route)
            }, [
              step.btnLabel,
              el("span", { class: "material-symbols-rounded" }, "arrow_forward")
            ])
          ])
        ])
      ))
    ]);

    wrap.append(launchpad);
  } else {
    // Active School: Modern 3-column layout with actionable empty states
    const mainGrid = el("div", { class: "md3-main-grid" });

    // --- Left Column ---
    const leftCol = el("div", { class: "md3-col" });

    let attendanceInsight = null;
    if (rollCallPending) {
      attendanceInsight = {
        icon: "how_to_reg",
        color: "gold",
        text: marked > 0 ? "Finish today’s roll call" : "Start today’s roll call",
        targetRoute: "/attendance",
      };
    } else if (attendancePct !== null && attendancePct < 90) {
      attendanceInsight = {
        icon: "how_to_reg",
        color: attendancePct < 75 ? "red" : "gold",
        text: attendancePct < 75 ? "Low attendance today" : "Attendance below 90%",
        targetRoute: "/attendance",
      };
    }

    const insightCandidates = [
      attendanceInsight,

      studentsWithBalancesCount > 0
        ? {
            icon: "warning",
            color: "gold",
            text: `${studentsWithBalancesCount} ${studentsWithBalancesCount === 1 ? "student" : "students"} with fee balances`,
            targetRoute: "/fees",
            targetParams: { status: "pending" },
          }
        : null,

      openAssessmentsCount > 0
        ? {
            icon: "assignment",
            color: "gold",
            text: `${openAssessmentsCount} ${openAssessmentsCount === 1 ? "assessment" : "assessments"} awaiting marks`,
            targetRoute: "/marks",
            targetParams: { tab: "entry" },
          }
        : null,

      settings.openingDate
        ? { icon: "event_available", color: "blue", text: `Next term starts ${formatDate(settings.openingDate)}` }
        : null,

      !studentsWithBalancesCount && studentsCount
        ? {
            icon: "check_circle",
            color: "green",
            text: "All student fees up to date",
            targetRoute: "/fees",
            targetParams: { status: "cleared" },
          }
        : null,

      revenueTrend
        ? {
            icon: revenueTrend.pct >= 0 ? "trending_up" : "trending_down",
            color: revenueTrend.pct >= 0 ? "green" : "red",
            text: `${revenueTrend.label} revenue ${revenueTrend.pct >= 0 ? "up" : "down"} ${Math.abs(revenueTrend.pct)}% vs ${revenueTrend.prevLabel}`,
            targetRoute: "/fees",
          }
        : null,

      newAdmissionsCount > 0
        ? {
            icon: "person_add",
            color: "green",
            text: `${newAdmissionsCount} ${newAdmissionsCount === 1 ? "admission" : "admissions"} in the last 30 days`,
            targetRoute: "/students",
            targetParams: { status: "active" },
          }
        : null,

      boysCount + girlsCount > 0
        ? {
            icon: "groups",
            color: "blue",
            text: `${boysCount} ${boysCount === 1 ? "boy" : "boys"} and ${girlsCount} ${girlsCount === 1 ? "girl" : "girls"} enrolled`,
            targetRoute: "/students",
          }
        : null,

      !openAssessmentsCount && lockedAssessmentsCount > 0
        ? {
            icon: "lock",
            color: "blue",
            text: `${lockedAssessmentsCount} locked ${lockedAssessmentsCount === 1 ? "assessment" : "assessments"}`,
            targetRoute: "/assessments",
          }
        : null,

      topGrade
        ? {
            icon: "school",
            color: "blue",
            text: `Largest cohort · ${topGrade.grade} (${topGrade.count})`,
            targetRoute: "/students",
            targetParams: { grade: topGrade.grade },
          }
        : null,
    ].filter(Boolean).slice(0, 6);

    let insightsBody;
    if (insightCandidates.length) {
      insightsBody = el("ul", { class: "md3-alerts-list" }, insightCandidates.map((item) => {
        const content = [
          el("span", { class: `material-symbols-rounded text-${item.color}`, "aria-hidden": "true" }, item.icon),
          el("span", { class: "md3-insight-text" }, item.text),
        ];
        const row = item.targetRoute
          ? el("button", {
              class: "md3-insight-row md3-insight-item--clickable",
              type: "button",
              onClick: () => navigateDeepLink(item.targetRoute, item.targetParams),
            }, [...content, el("span", { class: "md3-insight-arrow", "aria-hidden": "true" }, "↗")])
          : el("div", { class: "md3-insight-row" }, content);
        return el("li", {}, row);
      }));
    } else {
      insightsBody = el("div", { class: "card-empty-state" }, [
        el("div", { class: "card-empty-state__halo card-empty-state__halo--blue" }, [
          el("span", { class: "material-symbols-rounded" }, "insights")
        ]),
        el("p", { class: "card-empty-state__title" }, "No insights yet"),
        el("p", { class: "card-empty-state__sub" }, "Updates appear as you record attendance, fees, and marks."),
        el("button", {
          class: "btn btn--outline btn--xs card-empty-state__btn",
          onClick: () => navigate("/school-analytics")
        }, [
          el("span", { class: "material-symbols-rounded" }, "query_stats"), "School Analytics"
        ]),
      ]);
    }

    const alertsCard = el("div", { class: "md3-card md3-alerts-card" }, [
      el("div", { class: "md3-card__header" }, [
        el("h3", { class: "md3-card__title" }, "Quick Insights"),
      ]),
      el("div", { class: "md3-card__body", style: "flex: 1;" }, insightsBody),
    ]);
    leftCol.append(alertsCard);

    // --- Center Column ---
    const centerCol = el("div", { class: "md3-col" });

    // "Students by Grade" — clean actionable empty state when no students admitted yet
    const hasGradeData = chartDataCache.gradeLabels.length > 0;
    let demoCardContent;

    if (hasGradeData) {
      // Sort grades by headcount descending for clean hierarchy
      const sortedGrades = chartDataCache.gradeLabels.map((grade, idx) => ({
        grade,
        count: chartDataCache.gradeCounts[idx] || 0,
        color: chartDataCache.gradeColors[idx] || "#14538A"
      })).sort((a, b) => b.count - a.count);

      const breakdownRows = sortedGrades.map(({ grade, count, color }) => {
        const pct = studentsCount > 0 ? Math.round((count / studentsCount) * 100) : 0;
        return el("div", { class: "md3-grade-row" }, [
          el("div", { class: "md3-grade-row__label" }, [
            el("span", { class: "md3-grade-row__dot", style: `background: ${color};` }),
            el("span", {}, grade)
          ]),
          el("div", { class: "md3-grade-row__bar-wrap" }, [
            el("div", { class: "md3-grade-row__track" }, [
              el("div", { class: "md3-grade-row__bar", style: `width: ${pct}%; background: ${color};` })
            ]),
            el("span", { class: "md3-grade-row__count" }, `${count} (${pct}%)`)
          ])
        ]);
      });

      demoCardContent = [
        el("div", { class: "md3-card__header" }, [
          el("h3", { class: "md3-card__title" }, "Students by Grade"),
        ]),
        el("div", { class: "md3-card__body", style: "flex: 1;" }, [
          el("div", { class: "md3-chart-container--donut" }, [
            el("canvas", { id: "demographicsChart" }),
            el("div", { class: "md3-donut-center" }, [
              el("span", { class: "md3-donut-center__count" }, String(studentsCount)),
              el("span", { class: "md3-donut-center__label" }, "Total"),
            ])
          ]),
          el("div", { class: "md3-grade-breakdown" }, breakdownRows)
        ]),
        el("div", { class: "md3-card__footer" }, [
          el("span", {}, boysCount + girlsCount > 0 ? `${boysCount} Boys • ${girlsCount} Girls` : "Cohort Split"),
          el("a", {
            href: "#/students",
            onClick: (e) => {
              e.preventDefault();
              navigate("/students");
            }
          }, ["View Roster", el("span", { class: "material-symbols-rounded", style: "font-size: 14px;" }, "arrow_forward")])
        ])
      ];
    } else {
      demoCardContent = [
        el("div", { class: "md3-card__header" }, [
          el("h3", { class: "md3-card__title" }, "Students by Grade")
        ]),
        el("div", { class: "card-empty-state", style: "flex: 1;" }, [
          el("div", { class: "card-empty-state__halo card-empty-state__halo--green" }, [
            el("span", { class: "material-symbols-rounded" }, "group_add")
          ]),
          el("p", { class: "card-empty-state__title" }, "Awaiting Student Enrollment"),
          el("p", { class: "card-empty-state__sub" }, "Enroll learners into grade cohorts to visualize demographic distributions and class sizes."),
          el("button", {
            class: "btn btn--primary btn--xs card-empty-state__btn",
            onClick: () => navigate("/students")
          }, [
            el("span", { class: "material-symbols-rounded" }, "person_add"), "Admit Student"
          ]),
        ])
      ];
    }

    const demoCard = el("div", { class: "md3-card" }, demoCardContent);
    centerCol.append(demoCard);

    // --- Right Column ---
    const rightCol = el("div", { class: "md3-col" });

    // "Revenue Trend" — clean actionable empty state when no fee payments recorded yet
    let chartCardContent;
    if (hasRevenueData) {
      const clearedCount = Math.max(0, studentsCount - studentsWithBalancesCount);
      const formattedTotal = formatKES(feesCollected || 0);

      chartCardContent = [
        el("div", { class: "md3-card__header" }, [
          el("h3", { class: "md3-card__title" }, "Revenue Trend"),
        ]),
        el("div", { class: "md3-card__body", style: "flex: 1;" }, [
          el("div", { class: "md3-chart-container--revenue" }, [
            el("canvas", { id: "revenueChart" })
          ]),
          el("div", { class: "md3-revenue-kpi-grid" }, [
            el("div", { class: "md3-revenue-kpi-box" }, [
              el("span", { class: "md3-revenue-kpi-box__label" }, "Collections"),
              el("span", { class: "md3-revenue-kpi-box__val", style: "color: var(--color-green);" }, formattedTotal),
              el("span", { class: "md3-revenue-kpi-box__sub" }, `${clearedCount} student(s) cleared`),
            ]),
            el("div", {
              class: "md3-revenue-kpi-box md3-revenue-kpi-box--accent",
              style: studentsWithBalancesCount > 0 ? "cursor: pointer;" : "",
              title: studentsWithBalancesCount > 0 ? "Click to view learners with pending balances" : "",
              onClick: () => {
                if (studentsWithBalancesCount > 0) {
                  navigateDeepLink("/fees", { status: "pending" });
                }
              }
            }, [
              el("span", { class: "md3-revenue-kpi-box__label" }, "Pending Balance"),
              el("span", { class: "md3-revenue-kpi-box__val" }, `${studentsWithBalancesCount} Student(s)`),
              el("span", { class: "md3-revenue-kpi-box__sub" }, studentsWithBalancesCount > 0 ? "Awaiting clearance ↗" : "All up to date"),
            ])
          ])
        ]),
        el("div", { class: "md3-card__footer" }, [
          el("span", {}, `${settings.currentTerm || "Term"} ${settings.currentAcademicYear || ""}`),
          el("a", {
            href: "#/fees",
            onClick: (e) => {
              e.preventDefault();
              navigate("/fees");
            }
          }, ["Fee Records", el("span", { class: "material-symbols-rounded", style: "font-size: 14px;" }, "arrow_forward")])
        ])
      ];
    } else {
      chartCardContent = [
        el("div", { class: "md3-card__header" }, [
          el("h3", { class: "md3-card__title" }, "Revenue Trend")
        ]),
        el("div", { class: "card-empty-state", style: "flex: 1;" }, [
          el("div", { class: "card-empty-state__halo card-empty-state__halo--gold" }, [
            el("span", { class: "material-symbols-rounded" }, "account_balance_wallet")
          ]),
          el("p", { class: "card-empty-state__title" }, "Ready for Fee Collections"),
          el("p", { class: "card-empty-state__sub" }, "Fee payments recorded via M-Pesa, bank slip, or cash will automatically generate revenue analytics here."),
          el("button", {
            class: "btn btn--tonal btn--xs card-empty-state__btn",
            onClick: () => navigate("/fees")
          }, [
            el("span", { class: "material-symbols-rounded" }, "payments"), "Record Payment"
          ]),
        ])
      ];
    }

    const chartCard = el("div", { class: "md3-card" }, chartCardContent);
    rightCol.append(chartCard);

    mainGrid.append(leftCol, centerCol, rightCol);
    wrap.append(mainGrid);
  }

  return wrap;
}

// ===========================================================================
// School Setup Readiness & Pop-up Nudge
// ===========================================================================

function checkSettingsReadiness(settings) {
  const missingItems = [];

  // 1. Academic Calendar
  const hasCalendarDates = Boolean(settings?.closingDate && settings?.openingDate);
  if (!hasCalendarDates) {
    missingItems.push({
      tab: "calendar",
      title: "Academic Calendar & Term Dates",
      desc: "Configure current term, closing date, and reopening date for accurate report cards, fee cycles, and milestone tracking.",
      icon: "event_note",
      badge: "Needed for Reports",
    });
  }

  // 2. Leadership & Signatories
  const hasLeadership = Boolean(settings?.principalName?.trim());
  if (!hasLeadership) {
    missingItems.push({
      tab: "leadership",
      title: "School Leadership & Signatories",
      desc: "Add the Principal's name to appear on official student report card signature lines, certificates, and newsletters.",
      icon: "badge",
      badge: "Printed on Report Cards",
    });
  }

  // 3. School Profile & Contacts
  const hasProfile = Boolean(settings?.schoolName?.trim() && (settings?.phone?.trim() || settings?.email?.trim()));
  if (!hasProfile) {
    missingItems.push({
      tab: "profile",
      title: "School Profile & Contact Details",
      desc: "Confirm legal school name, administrative telephone, and official email for document letterheads and receipts.",
      icon: "account_balance",
      badge: "Official Letterhead",
    });
  }

  // 4. Branding & Crest
  const hasLogo = Boolean(settings?.logoUrl?.trim());
  if (!hasLogo) {
    missingItems.push({
      tab: "branding",
      title: "School Crest / Logo",
      desc: "Upload official school crest to brand report cards, student portal, and payment receipts.",
      icon: "palette",
      badge: "Visual Identity",
    });
  }

  return {
    isComplete: missingItems.length === 0,
    missingItems,
  };
}

function isSetupNudgeDismissed(schoolId) {
  try {
    return sessionStorage.getItem(`jss_setup_nudge_dismissed_${schoolId}`) === "1";
  } catch {
    return false;
  }
}

function dismissSetupNudge(schoolId) {
  try {
    sessionStorage.setItem(`jss_setup_nudge_dismissed_${schoolId}`, "1");
  } catch {
    // ignore
  }
}

function showSetupNudgeModal({ profile, settings, missingItems, schoolId }) {
  if (document.querySelector(".setup-nudge-modal")) return;

  const backdrop = el("div", { class: "modal-backdrop", style: "z-index: 105;" });
  const modal = el("div", { class: "modal setup-nudge-modal", role: "dialog", "aria-modal": "true" });

  function close(dismiss = true) {
    if (dismiss) dismissSetupNudge(schoolId);
    document.removeEventListener("keydown", handleKeyDown);
    backdrop.remove();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") close(true);
  }
  document.addEventListener("keydown", handleKeyDown);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close(true);
  });

  // Header
  const header = el("div", { class: "setup-nudge__header" }, [
    el("div", { class: "setup-nudge__icon-wrap" }, [
      el("span", { class: "material-symbols-rounded" }, "settings_suggest"),
    ]),
    el("h2", { class: "setup-nudge__title" }, "Complete Your School Setup"),
    el("p", { class: "setup-nudge__subtitle" },
      "A quick setup ensures terminal report cards, fee invoices, and marks entries use your accurate term dates and official letterhead."
    ),
    el("button", {
      type: "button",
      class: "setup-nudge__close",
      "aria-label": "Close",
      onClick: () => close(true),
    }, [el("span", { class: "material-symbols-rounded" }, "close")]),
  ]);

  // Body: itemized checklist
  const body = el("div", { class: "setup-nudge__body" });

  for (const item of missingItems) {
    const itemCard = el("div", {
      class: "setup-nudge__item",
      role: "button",
      tabindex: "0",
      title: `Go to ${item.title}`,
      onClick: () => {
        close(true);
        navigate(`/settings?tab=${item.tab}`);
      },
    }, [
      el("div", { class: "setup-nudge__item-icon" }, [
        el("span", { class: "material-symbols-rounded" }, item.icon),
      ]),
      el("div", { class: "setup-nudge__item-content" }, [
        el("div", { class: "setup-nudge__item-header" }, [
          el("span", { class: "setup-nudge__item-title" }, item.title),
          el("span", { class: "setup-nudge__item-badge" }, item.badge),
        ]),
        el("p", { class: "setup-nudge__item-desc" }, item.desc),
      ]),
      el("span", { class: "material-symbols-rounded setup-nudge__item-arrow" }, "arrow_forward"),
    ]);
    body.append(itemCard);
  }

  // Footer
  const primaryTab = missingItems[0]?.tab || "calendar";
  const footer = el("div", { class: "setup-nudge__footer" }, [
    el("button", {
      type: "button",
      class: "btn btn--ghost btn--sm",
      onClick: () => close(true),
    }, "Remind Me Later"),
    el("button", {
      type: "button",
      class: "btn btn--primary btn--sm",
      onClick: () => {
        close(true);
        navigate(`/settings?tab=${primaryTab}`);
      },
    }, [
      "Configure Settings Now",
      el("span", { class: "material-symbols-rounded" }, "arrow_forward"),
    ]),
  ]);

  modal.append(header, body, footer);
  backdrop.append(modal);
  document.body.append(backdrop);
}

export function init({ profile } = {}) {
  const p = profile || activeProfile;
  playDashboardGreeting(p);
  const isAdmin = p?.role === "admin" || p?.role === "super_admin";
  const schoolId = getCurrentSchoolId();

  if (isAdmin && currentSettings && schoolId && !isSetupNudgeDismissed(schoolId)) {
    const { isComplete, missingItems } = checkSettingsReadiness(currentSettings);
    if (!isComplete && missingItems.length > 0) {
      setTimeout(() => {
        showSetupNudgeModal({ profile: p, settings: currentSettings, missingItems, schoolId });
      }, 600);
    }
  }

  const isDark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  const { primary, accent } = getBrandColors();
  const lineStroke = isDark ? "#38BDF8" : primary;
  const lineFill = isDark ? "rgba(56, 189, 248, 0.18)" : hexToRgba(primary, 0.15);
  const pointBg = isDark ? "#FBBF24" : accent;
  const gridLineColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = isDark ? "#94A3B8" : undefined;

  // 1. Initialize Real Revenue Line Chart
  const revCtx = document.getElementById('revenueChart');
  if (revCtx && chartDataCache.hasRevenueData) {
    const existingRev = Chart.getChart(revCtx);
    if (existingRev) existingRev.destroy();

    new Chart(revCtx, {
      type: 'line',
      data: {
        labels: chartDataCache.revenueLabels,
        datasets: [{
          label: 'Fees (KES)',
          data: chartDataCache.revenueData, 
          borderColor: lineStroke,
          backgroundColor: lineFill,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: pointBg,
          pointBorderColor: isDark ? "#111827" : "#FFFFFF",
          pointBorderWidth: 1.5,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `KES ${Number(ctx.raw || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: gridLineColor },
            ticks: {
              color: tickColor,
              maxTicksLimit: 5,
              callback: (val) => {
                if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                if (val >= 1000) return `${Math.round(val / 1000)}k`;
                return val;
              }
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: tickColor }
          }
        }
      }
    });
  }

  // 2. Initialize Real Demographics Doughnut Chart
  const demoCtx = document.getElementById('demographicsChart');
  if (demoCtx && chartDataCache.gradeLabels.length > 0) {
    const existingDemo = Chart.getChart(demoCtx);
    if (existingDemo) existingDemo.destroy();

    const palette = getGradePalette();

    new Chart(demoCtx, {
      type: 'doughnut',
      data: {
        labels: chartDataCache.gradeLabels,
        datasets: [{
          data: chartDataCache.gradeCounts,
          backgroundColor: chartDataCache.gradeLabels.map((_, i) => palette[i % palette.length]),
          borderWidth: isDark ? 2 : 0,
          borderColor: isDark ? "#111827" : "transparent",
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}
