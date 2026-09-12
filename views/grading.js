import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import {
  computeClassResults,
  saveResults,
  getPreviousResult,
  listSavedModesForPeriod,
  reportModeLabel,
  positionScopeLabel,
} from "../js/services/grading.service.js";
import { openModal } from "../js/components/modal.js";
import { savedModesPanel } from "../js/components/saved-modes-panel.js";
import { el, icon, toast, spinner } from "../js/utils.js";

const CAN_SAVE = ["admin", "academic_master"];

let classes = [];
let settings = null;
let selection = { grade: "", academicYear: "", term: "", reportMode: "average" };
let lastResult = null; // { students, subjectsUsed, meta }
let lastSavedModes = []; // listSavedModesForPeriod() result
let studentSearchQuery = "";
let selectedStreamFilter = "All";

/**
 * Contextual help tooltip using dark-slate bubble styling.
 */
function infoTooltip(title, text, align = "center") {
  const alignClass = align === "right" ? " tooltip-bubble--right" : (align === "left" ? " tooltip-bubble--left" : "");
  return el("span", {
    class: "tooltip-wrap tooltip-wrap--inline",
    tabindex: "0",
    role: "button",
    "aria-label": title,
  }, [
    el("span", { class: "tooltip-trigger-icon material-symbols-rounded" }, "help"),
    el("span", { class: `tooltip-bubble tooltip-bubble--wide${alignClass}`, role: "tooltip" }, [
      el("span", { class: "tooltip-bubble__title" }, [
        icon("info"),
        title,
      ]),
      el("span", { class: "tooltip-bubble__text" }, text),
    ]),
  ]);
}

/**
 * Dynamic Academic Scholar mascot with golden ranking trophy and merit scroll.
 */
export function buildGradingMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="grading-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Grading Assistant">
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

        <!-- Left Arm Holding Academic Merit Scroll -->
        <g class="grading-mascot__scroll">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Rolled Scroll -->
          <rect x="56" y="126" width="28" height="26" rx="3" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" transform="rotate(-8 70 139)" />
          <line x1="60" y1="133" x2="78" y2="130.5" stroke="#14538A" stroke-width="1.4" />
          <line x1="60" y1="139" x2="78" y2="136.5" stroke="#14538A" stroke-width="1.4" />
          <line x1="60" y1="145" x2="74" y2="143" stroke="#C9A227" stroke-width="1.2" />
          <!-- Wax Seal -->
          <circle cx="70" cy="148" r="4.5" fill="#DC2626" />
          <circle cx="70" cy="148" r="2.5" fill="#B91C1C" />
          <!-- Hand Holding Scroll -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Golden Trophy (Animated) -->
        <g class="grading-mascot__trophy">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Trophy Cup Base & Stem -->
          <rect x="156" y="106" width="10" height="3" rx="1" fill="#8C6F12" />
          <rect x="159" y="98" width="4" height="8" fill="#C9A227" />
          <!-- Trophy Bowl -->
          <path d="M152,86 C152,98 170,98 170,86 Z" fill="#F59E0B" stroke="#B45309" stroke-width="1" />
          <ellipse cx="161" cy="86" rx="9" ry="2.5" fill="#FDE68A" />
          <!-- Trophy Handles -->
          <path d="M152,88 C147,88 147,94 152,94" stroke="#D97706" stroke-width="1.4" fill="none" stroke-linecap="round" />
          <path d="M170,88 C175,88 175,94 170,94" stroke="#D97706" stroke-width="1.4" fill="none" stroke-linecap="round" />
          <!-- Star on Trophy -->
          <polygon points="161,89 162,91 164,91 162.5,92.5 163,94.5 161,93.5 159,94.5 159.5,92.5 158,91 160,91" fill="#FFFFFF" />
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

// ------------------------------------------------------------------ Render --

export async function render({ profile }) {
  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";
  selection.reportMode = "average";

  const wrap = el("div", { class: "grading-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildGradingMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "grading-hero" }, [
    el("div", { class: "grading-hero__content" }, [
      el("div", { class: "grading-hero__status-row" }, [
        el("div", { class: "academics-cycle-badge" }, [
          icon("workspace_premium", "text-sm"),
          "Merit Ranking & Aggregation",
        ]),
        infoTooltip(
          "Grading & Positions Overview",
          "Computes subject weighted averages and student merit ranks across all streams simultaneously. Saved results are published directly to Report Cards and Analytics.",
          "right"
        ),
      ]),
      el("h1", { class: "grading-hero__title" }, "Class Grading & Positions"),
      el("p", { class: "grading-hero__desc" }, "Aggregate assessment scores, calculate class subject averages, and generate merit rankings for report cards."),
      el("div", { class: "grading-hero__pills" }, [
        el("div", { class: "grading-pill" }, [icon("school"), `${classes.length} Grade Cohorts`]),
        el("div", { class: "grading-pill" }, [icon("calendar_today"), `${selection.academicYear} · ${selection.term}`]),
        el("div", { class: "grading-pill" }, [icon("analytics"), "CBC Merit Ranking"]),
      ]),
    ]),

    // Mascot & Speech Bubble
    el("div", { class: "grading-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Compute subject averages and student class rankings."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Configuration & Picker Card
  const pickerCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  wrap.append(pickerCard);

  // Mount point for computed results or welcome disclaimers
  const resultMount = el("div", { id: "grading-result-mount" });
  wrap.append(resultMount);

  renderPicker(pickerCard, profile, resultMount);
  renderWelcomeDisclaimers(resultMount);

  return wrap;
}

function gradeOptions() {
  return classes.map((c) => c.grade);
}

function renderPicker(container, profile, resultMount) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const gradeSelect = el("select", { id: "g-grade-select" }, [
    el("option", { value: "" }, "Select grade"),
    ...gradeOptions().map((g) => el("option", { value: g, ...(g === selection.grade ? { selected: "true" } : {}) }, g)),
  ]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, (settings.terms || []).map((t) =>
    el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)
  ));
  const reportModeSelect = el("select", {}, [
    el("option", { value: "average", ...(selection.reportMode === "average" ? { selected: "true" } : {}) }, "Final (Average All)"),
    el("option", { value: "midterm", ...(selection.reportMode === "midterm" ? { selected: "true" } : {}) }, "Midterm Report Only"),
    el("option", { value: "endterm", ...(selection.reportMode === "endterm" ? { selected: "true" } : {}) }, "Endterm Report Only"),
  ]);

  gradeSelect.addEventListener("change", () => { selection.grade = gradeSelect.value; });
  yearInput.addEventListener("change", () => { selection.academicYear = yearInput.value.trim(); });
  termSelect.addEventListener("change", () => { selection.term = termSelect.value; });
  reportModeSelect.addEventListener("change", () => { selection.reportMode = reportModeSelect.value; });

  row.append(
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("school", "text-xs"), "Grade"]), gradeSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("calendar_today", "text-xs"), "Academic Year"]), yearInput]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("date_range", "text-xs"), "Term"]), termSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("tune", "text-xs"), "Report Mode"]), reportModeSelect])
  );
  container.append(row);

  container.append(
    el("p", { class: "text-muted text-xs", style: "margin:10px 0 14px; display:flex; align-items:center; gap:6px;" }, [
      icon("info", "text-xs", "style: color:var(--color-primary-600);"),
      "Computes every stream in this grade at once. Individual stream report forms can be viewed on the Report Cards page.",
    ])
  );

  container.append(
    el("div", { class: "filter-actions", style: "display:flex; justify-content:flex-end;" }, [
      el("button", {
        class: "btn btn--primary btn--sm",
        onClick: () => runCompute(profile, resultMount),
      }, [icon("analytics", "text-xs"), "Compute Results"]),
    ])
  );
}

/**
 * Renders guided step instructions and essential disclaimers when no results are computed yet.
 */
function renderWelcomeDisclaimers(container) {
  container.innerHTML = "";

  const welcomeCard = el("div", { class: "grading-welcome-card" }, [
    el("div", { class: "grading-welcome-header" }, [
      icon("workspace_premium", "text-gold", "style: font-size:36px;"),
      el("h3", {}, "Ready to Compute Class Rankings?"),
      el("p", {}, "Select a Grade, Academic Year, Term, and Report Mode above, then click 'Compute Results' to aggregate subject averages and student positions."),
    ]),

    // Important Operational Disclaimers Grid
    el("div", { class: "grading-disclaimers-grid" }, [
      el("div", { class: "grading-disclaimer-card grading-disclaimer-card--info" }, [
        el("div", { class: "grading-disclaimer-title" }, [
          icon("account_tree", "text-primary"),
          "Grade-Wide Multi-Stream Scope",
        ]),
        el("p", { class: "grading-disclaimer-body" }, "Computation evaluates every stream in the selected grade cohort simultaneously. Students receive both an Overall Cohort Rank (1/N) and a Stream Rank (1/n)."),
      ]),
      el("div", { class: "grading-disclaimer-card grading-disclaimer-card--warning" }, [
        el("div", { class: "grading-disclaimer-title" }, [
          icon("balance", "style: color:#d97706;"),
          "100% Subject Weight Requirement",
        ]),
        el("p", { class: "grading-disclaimer-body" }, "Assessments for each subject must add up to 100% (or 100 max score for direct mode). Incomplete assessment weights will flag results as 'Partial'."),
      ]),
      el("div", { class: "grading-disclaimer-card grading-disclaimer-card--danger" }, [
        el("div", { class: "grading-disclaimer-title" }, [
          icon("save", "style: color:#dc2626;"),
          "In-Memory Computation & Saving",
        ]),
        el("p", { class: "grading-disclaimer-body" }, "Clicking 'Compute Results' calculates rankings in memory for review. You must click 'Save Results' to publish grades to Report Cards and Analytics."),
      ]),
      el("div", { class: "grading-disclaimer-card grading-disclaimer-card--success" }, [
        el("div", { class: "grading-disclaimer-title" }, [
          icon("military_tech", "style: color:#059669;"),
          "Standard CBC Ties & Ranking Rules",
        ]),
        el("p", { class: "grading-disclaimer-body" }, "Learners with identical total marks share the same rank (e.g. Tied for 1st). The subsequent rank skips accordingly according to CBC evaluation standards."),
      ]),
    ]),
  ]);

  container.append(welcomeCard);
}

// ---------------------------------------------------------------- Compute --

async function runCompute(profile, resultMount) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  resultMount.innerHTML = "";
  resultMount.append(el("div", { class: "spinner-overlay", style: "padding:var(--sp-6);" }, [
    spinner("lg", "dark"),
    el("div", { style: "margin-top:12px; font-weight:600; color:var(--color-primary-900);" }, "Computing averages, grades, and merit positions…"),
  ]));
  try {
    const [result, savedModes] = await Promise.all([
      computeClassResults({
        grade: selection.grade,
        academicYear: selection.academicYear,
        term: selection.term,
        reportMode: selection.reportMode,
        gradingScale: settings.gradingScale,
      }),
      listSavedModesForPeriod(selection),
    ]);
    lastResult = result;
    lastSavedModes = savedModes;
    studentSearchQuery = "";
    selectedStreamFilter = "All";
    renderResult(resultMount, profile);
  } catch (err) {
    resultMount.innerHTML = "";
    toast(err.message || "Could not compute results.", "error");
    renderWelcomeDisclaimers(resultMount);
  }
}

// ----------------------------------------------------------------- Result --

function renderResult(container, profile) {
  container.innerHTML = "";
  const { students, subjectsUsed, meta } = lastResult;

  // Saved modes panel at the top
  container.append(savedModesPanel(lastSavedModes, { activeMode: selection.reportMode }));

  if (meta.noAssessments) {
    container.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("assignment_late", "text-muted", "style: font-size:42px;"),
      el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No assessments found"),
      el("p", { class: "text-muted text-sm", style: "max-width:380px; margin:0 auto var(--sp-4);" }, `No assessments are set up for ${meta.grade} in ${meta.term} ${meta.academicYear}. Add assessments under Academics first.`),
    ]));
    return;
  }
  if (meta.noStudents) {
    container.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("groups", "text-muted", "style: font-size:42px;"),
      el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No active students"),
      el("p", { class: "text-muted text-sm" }, `No active students found in ${meta.grade}. Check class rosters under Students.`),
    ]));
    return;
  }
  if (!subjectsUsed.length || !students.some((s) => s.subjects.length)) {
    container.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("edit_off", "text-muted", "style: font-size:42px;"),
      el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No marks recorded yet"),
      el("p", { class: "text-muted text-sm", style: "max-width:380px; margin:0 auto;" }, "Once teachers enter marks for at least one subject assessment, calculated positions will appear here."),
    ]));
    return;
  }

  // Executive Results Summary Card
  const headerCard = el("div", {
    class: "card",
    style: "margin-bottom:var(--sp-4); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;",
  });
  headerCard.append(
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("workspace_premium", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, `${meta.grade}: ${meta.term} ${meta.academicYear}`),
        el("span", { class: `badge ${meta.reportMode === "average" ? "badge--success" : "badge--gold"}`, style: "font-size:11px;" }, reportModeLabel(meta.reportMode)),
      ]),
      el("p", { class: "text-muted text-xs", style: "margin:4px 0 0 0;" }, `${meta.classSize} students across all streams · ${subjectsUsed.length} subject(s) with marks · ${meta.assessmentsUsed} assessment(s) aggregated`),
    ])
  );
  if (CAN_SAVE.includes(profile.role)) {
    headerCard.append(
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => handleSave(profile, container),
      }, [icon("save", "text-xs"), "Save Results"])
    );
  }
  container.append(headerCard);

  // Mismatched Assessment Weights Warning
  const mismatchedSubjects = (meta.subjectWeightTotals || []).filter((s) => s.mismatched);
  if (mismatchedSubjects.length) {
    container.append(el("div", { class: "callout callout--warning", style: "margin-bottom:var(--sp-3); padding:12px 16px;" }, [
      icon("warning", "text-amber", "style: font-size:20px;"),
      el("div", {}, [
        el("strong", { style: "display:block; margin-bottom:2px;" }, `${mismatchedSubjects.length} subject(s) have assessment weights not totaling 100%`),
        el("p", { class: "text-xs", style: "margin:0 0 6px 0;" }, "Each subject's assessments should total 100% so that calculated averages reflect true final scores. Current totals:"),
        el("ul", { style: "margin:0; padding-left:18px; font-size:11px;" }, mismatchedSubjects.map((s) => {
          const breakdown = s.assessments.map((a) => a.contributionMode === "direct" ? `${a.name} (${a.maxScore} direct)` : `${a.name} (${a.weight}%)`).join(", ");
          return el("li", {}, `${s.name}: ${s.expectedCapacityTotal} total (${breakdown || "no assessments set up"})`);
        })),
      ]),
    ]));
  }

  // Missing Marks Warning
  if (meta.subjectsIncomplete?.length) {
    container.append(el("div", { class: "callout callout--warning", style: "margin-bottom:var(--sp-3); padding:12px 16px;" }, [
      icon("hourglass_top", "text-amber", "style: font-size:20px;"),
      el("div", {}, [
        el("strong", { style: "display:block; margin-bottom:2px;" }, "Some subjects are missing marks for configured assessments"),
        el("ul", { style: "margin:0; padding-left:18px; font-size:11px;" }, meta.subjectsIncomplete.map((s) =>
          el("li", {}, `${s.name}: no marks recorded yet for ${s.missingAssessments.join(", ")} (${s.weightMissing}% of subject weight missing)`)
        )),
      ]),
    ]));
  }

  // Table Card with Toolbar
  const resultsCard = el("div", { class: "grading-results-card table-wrap table-wrap--responsive" });

  // Stream options for quick filtering
  const streamsSet = new Set(students.map((s) => s.stream).filter(Boolean));
  const streamOptionsList = ["All", ...Array.from(streamsSet)];

  const searchInput = el("input", {
    type: "search",
    class: "subjects-search-input",
    placeholder: "Filter by student name or admission number...",
    value: studentSearchQuery,
    style: "max-width:320px;",
  });

  const streamFilterButtons = el("div", { style: "display:flex; gap:6px; flex-wrap:wrap; align-items:center;" });
  function renderStreamPills() {
    streamFilterButtons.innerHTML = "";
    streamOptionsList.forEach((stream) => {
      const btn = el("button", {
        type: "button",
        class: `subjects-dept-btn ${selectedStreamFilter === stream ? "subjects-dept-btn--active" : ""}`,
        onClick: () => {
          selectedStreamFilter = stream;
          renderStreamPills();
          renderFilteredRoster(tableBody);
        },
      }, stream === "All" ? "All Streams" : stream);
      streamFilterButtons.append(btn);
    });
  }
  renderStreamPills();

  const toolbar = el("div", { class: "grading-toolbar" }, [
    el("div", { class: "subjects-search-wrap" }, [
      icon("search"),
      searchInput,
    ]),
    streamFilterButtons,
  ]);
  resultsCard.append(toolbar);

  const table = el("table", { class: "grading-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:90px;" }, "Pos"),
      el("th", { style: "width:120px;" }, "Adm No."),
      el("th", { style: "min-width:180px;" }, "Student Name"),
      el("th", { class: "col-num", style: "width:120px;" }, "Total Marks"),
      el("th", { class: "col-num", style: "width:110px;" }, "Mean %"),
      el("th", { class: "col-center", style: "width:130px;" }, "Mean Grade"),
      el("th", { class: "col-num", style: "width:90px;" }, "Points"),
      el("th", { class: "col-right", style: "width:110px;" }, "Breakdown"),
    ])),
  ]);

  const tableBody = el("tbody", {});

  function renderFilteredRoster(targetTbody) {
    targetTbody.innerHTML = "";

    const sorted = [...students].sort((a, b) => {
      if (a.overallPosition === null) return 1;
      if (b.overallPosition === null) return -1;
      return a.overallPosition - b.overallPosition;
    });

    const filteredStudents = sorted.filter((s) => {
      const matchesSearch = !studentSearchQuery ||
        (s.fullName || "").toLowerCase().includes(studentSearchQuery) ||
        (s.admissionNumber || "").toLowerCase().includes(studentSearchQuery);
      const matchesStream = selectedStreamFilter === "All" || s.stream === selectedStreamFilter;
      return matchesSearch && matchesStream;
    });

    if (!filteredStudents.length) {
      targetTbody.append(el("tr", {}, [
        el("td", { colspan: "8", style: "text-align:center; padding:var(--sp-5); color:var(--color-ink-soft);" }, "No students match the current search or stream filter."),
      ]));
      return;
    }

    for (const s of filteredStudents) {
      const hasScores = s.subjects.length > 0;
      const isTop3 = s.overallPosition && s.overallPosition <= 3;

      targetTbody.append(el("tr", {}, [
        el("td", { "data-label": "Pos" }, hasScores
          ? el("span", { class: `grading-pos-badge ${isTop3 ? "grading-pos-badge--top" : ""}` }, [
              isTop3 ? icon("military_tech", "text-xs", "style: color:#d97706;") : "",
              `${s.overallPosition}/${s.classSize}`,
            ])
          : el("span", { class: "text-muted" }, "—")),
        el("td", { "data-label": "Adm No." }, [
          el("span", {
            style: "font-family:var(--font-mono, monospace); font-weight:600; font-size:var(--fs-xs); color:var(--color-ink-soft);",
          }, s.admissionNumber || "—"),
        ]),
        el("td", { "data-label": "Student Name" }, [
          el("strong", { style: "color:var(--color-primary-900);" }, s.fullName),
          s.stream ? el("span", { class: "badge badge--muted", style: "margin-left:6px; font-size:10px;" }, s.stream) : "",
        ]),
        el("td", { class: "col-num", "data-label": "Total Marks", style: "font-family:var(--font-mono, monospace); font-weight:600;" },
          hasScores ? `${s.totalMarks.toFixed(1)} / ${s.totalOutOf}` : "—"),
        el("td", { class: "col-num", "data-label": "Mean %", style: "font-family:var(--font-mono, monospace); font-weight:700; color:var(--color-primary-900);" },
          hasScores ? `${s.meanMarks.toFixed(2)}%` : "—"),
        el("td", { class: "col-center", "data-label": "Mean Grade" }, hasScores
          ? el("span", {}, [
              el("span", { class: "badge badge--gold", style: "font-weight:700;" }, s.meanGrade),
              s.hasIncompleteSubject ? el("span", { class: "badge badge--warning", style: "margin-left:4px; font-size:10px;", title: "Partial result: not all assessment weights recorded" }, "Partial") : "",
            ])
          : el("span", { class: "text-muted" }, "—")),
        el("td", { class: "col-num", "data-label": "Points", style: "font-family:var(--font-mono, monospace); font-weight:600;" },
          hasScores ? s.totalPoints : "—"),
        el("td", { class: "col-right", "data-label": "Breakdown" }, [
          hasScores
            ? el("button", {
                type: "button",
                class: "btn btn--ghost btn--xs",
                onClick: () => showDetail(s, profile),
              }, [icon("visibility", "text-xs"), "View"])
            : el("span", { class: "text-muted text-xs" }, "No marks"),
        ]),
      ]));
    }
  }

  renderFilteredRoster(tableBody);
  table.append(tableBody);
  resultsCard.append(table);
  container.append(resultsCard);

  searchInput.addEventListener("input", (e) => {
    studentSearchQuery = e.target.value.trim().toLowerCase();
    renderFilteredRoster(tableBody);
  });
}

// ------------------------------------------------------------------- Save --

async function handleSave(profile, resultMount) {
  const incompleteCount = lastResult.students.filter((s) => s.hasIncompleteSubject).length;
  if (incompleteCount > 0) {
    const proceed = confirm(
      `Notice: ${incompleteCount} student(s) have incomplete assessment weights for at least one subject. Results will be marked as partial. Save anyway?`
    );
    if (!proceed) return;
  }
  try {
    await saveResults(profile.uid, selection, lastResult.students);
    toast(`${reportModeLabel(selection.reportMode)} results saved. They are now published for Report Cards.`, "success");
    lastSavedModes = await listSavedModesForPeriod(selection);
    renderResult(resultMount, profile);
  } catch (err) {
    toast(err.message || "Could not save results.", "error");
  }
}

// ----------------------------------------------------------------- Detail --

async function showDetail(student, profile, isStreamPreview) {
  const body = el("div", {});

  // Student summary card
  const summaryBox = el("div", {
    class: "card",
    style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:var(--sp-4); background:var(--color-cream-dim);",
  }, [
    el("div", {}, [
      el("h4", { style: "margin:0 0 2px; color:var(--color-primary-900);" }, student.fullName),
      el("div", { class: "text-muted text-xs" }, `Adm No: ${student.admissionNumber || "—"} · ${student.grade} ${student.stream || ""}`),
    ]),
    el("div", { style: "display:flex; gap:8px; align-items:center;" }, [
      el("span", { class: "badge badge--success", style: "font-weight:700; font-size:12px;" }, `${positionScopeLabel(isStreamPreview)} ${isStreamPreview ? student.classPosition : student.overallPosition}/${isStreamPreview ? student.streamClassSize : student.classSize}`),
      el("span", { class: "badge badge--gold", style: "font-weight:700; font-size:12px;" }, `${student.meanMarks.toFixed(2)}% · ${student.meanGrade}`),
      el("span", { class: "badge badge--neutral", style: "font-weight:700; font-size:12px;" }, `${student.totalPoints} pts`),
    ]),
  ]);
  body.append(summaryBox);

  // Subjects breakdown
  body.append(el("h4", { style: "margin:0 0 8px; color:var(--color-primary-900);" }, "Subject Breakdown"));
  const subjTableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "margin-bottom:var(--sp-4);" });
  const showBothColumns = (selection.reportMode || "average") === "average";
  const subjTable = el("table", { class: "grading-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject"),
      ...(showBothColumns ? [el("th", { class: "col-num" }, "Midterm"), el("th", { class: "col-num" }, "Endterm")] : []),
      el("th", { class: "col-num" }, "Average"),
      el("th", { class: "col-center" }, "Grade"),
      el("th", { class: "col-num" }, "Pts"),
      el("th", { class: "col-center" }, "Position"),
      el("th", { class: "col-center" }, "Status"),
    ])),
  ]);

  const subjBody = el("tbody", {});
  for (const s of [...student.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    subjBody.append(el("tr", {}, [
      el("td", { "data-label": "Subject", style: "font-weight:600;" }, s.name),
      ...(showBothColumns ? [
        el("td", { class: "col-num", "data-label": "Midterm", style: "font-family:var(--font-mono, monospace);" }, s.midtScore == null ? el("span", { class: "text-muted" }, "—") : s.midtScore.toFixed(1)),
        el("td", { class: "col-num", "data-label": "Endterm", style: "font-family:var(--font-mono, monospace);" }, s.endScore == null ? el("span", { class: "text-muted" }, "—") : s.endScore.toFixed(1)),
      ] : []),
      el("td", { class: "col-num", "data-label": "Average", style: "font-family:var(--font-mono, monospace); font-weight:700;" }, s.average.toFixed(1)),
      el("td", { class: "col-center", "data-label": "Grade" }, el("span", { class: "badge badge--gold", style: "font-weight:700;" }, s.grade)),
      el("td", { class: "col-num", "data-label": "Pts", style: "font-family:var(--font-mono, monospace);" }, String(s.points)),
      el("td", { class: "col-center", "data-label": "Position" }, [
        el("span", { class: "grading-pos-badge" }, isStreamPreview ? `${s.classPosition}/${student.streamClassSize}` : `${s.position}/${student.classSize}`),
      ]),
      el("td", { class: "col-center", "data-label": "Status" }, s.incomplete
        ? el("span", { class: "badge badge--warning", title: "Partial: assessment weight incomplete" }, `${s.weightUsed}% of ${s.weightExpected}%`)
        : el("span", { class: "badge badge--success" }, "Complete")),
    ]));
  }
  subjTable.append(subjBody);
  subjTableWrap.append(subjTable);
  body.append(subjTableWrap);

  // Pathway performance
  body.append(el("h4", { style: "margin:0 0 8px; color:var(--color-primary-900);" }, "Pathway Performance"));
  const pathWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "margin-bottom:var(--sp-4);" });
  const pathTable = el("table", { class: "grading-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Pathway"),
      el("th", { class: "col-num" }, "Points"),
      el("th", { class: "col-num" }, "Percentage"),
    ])),
  ]);
  const pathBody = el("tbody", {});
  for (const p of student.pathwayBreakdown) {
    pathBody.append(el("tr", {}, [
      el("td", { "data-label": "Pathway", style: "font-weight:600;" }, p.pathway),
      el("td", { class: "col-num", "data-label": "Points", style: "font-family:var(--font-mono, monospace);" }, String(p.points)),
      el("td", { class: "col-num", "data-label": "Percentage", style: "font-family:var(--font-mono, monospace); font-weight:700;" }, `${p.percentage.toFixed(1)}%`),
    ]));
  }
  pathTable.append(pathBody);
  pathWrap.append(pathTable);
  body.append(pathWrap);

  // Comparison to previous term
  const devMount = el("div", {
    class: "callout callout--neutral",
    style: "font-size:var(--fs-xs); padding:10px 14px;",
  }, [
    el("span", { class: "text-muted text-xs" }, "Checking prior term records for trend comparison…"),
  ]);
  body.append(devMount);

  openModal(`Student Results: ${student.fullName}`, body);

  try {
    const prev = await getPreviousResult(student.studentId, selection.grade, selection.academicYear, selection.term, settings.terms, selection.reportMode);
    devMount.innerHTML = "";
    if (!prev) {
      devMount.append(el("span", { class: "text-muted text-xs" }, "No prior term result available for comparison."));
      return;
    }
    const devMarks = student.meanMarks - prev.meanMarks;
    const devPoints = student.totalPoints - prev.totalPoints;
    const prevPos = isStreamPreview ? prev.classPosition : prev.overallPosition;
    const prevSize = isStreamPreview ? prev.streamClassSize : prev.classSize;

    devMount.className = "callout callout--info";
    devMount.append(
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("trending_up", "text-primary"),
        el("div", {}, [
          el("strong", { style: "display:block; margin-bottom:2px;" }, `Prior Term Comparison (${prev.term} ${prev.academicYear})`),
          el("span", { class: "text-xs" }, [
            `Previous: ${prev.meanMarks.toFixed(2)}% (${prev.meanGrade}), ${prev.totalPoints} pts, rank ${prevPos}/${prevSize}. `,
            el("span", { class: `badge badge--${devMarks >= 0 ? "success" : "danger"}`, style: "margin-left:4px;" }, `${devMarks >= 0 ? "▲ +" : "▼ "}${devMarks.toFixed(2)}%`),
            " ",
            el("span", { class: `badge badge--${devPoints >= 0 ? "success" : "danger"}` }, `${devPoints >= 0 ? "▲ +" : "▼ "}${devPoints} pts`),
          ]),
        ]),
      ])
    );
  } catch {
    devMount.style.display = "none";
  }
}

export function init() {}