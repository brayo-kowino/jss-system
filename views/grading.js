import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from '../js/services/settings.service.js';
import { getCurrentSchool } from '../js/services/auth.service.js';
import {
  computeClassResults,
  saveResults,
  getPreviousResult,
  listSavedModesForPeriod,
  listResultsByPeriod,
  summarizeSavedModes,
  REPORT_MODES,
  reportModeLabel,
  positionScopeLabel,
} from "../js/services/grading.service.js";
import { openModal } from "../js/components/modal.js";
import { savedModesPanel } from "../js/components/saved-modes-panel.js";
import { workspaceResults } from "../js/components/workspace-results.js";
import { rememberWorkspaceSelection, restoreWorkspaceSelection, workspaceOption, workspacePeriod } from "../js/services/workspace-selection.js";
import { el, icon, toast, spinner, busyButton } from "../js/utils.js";

const CAN_SAVE = ["admin", "academic_master"];

let classes = [];
let settings = null;
let selection = { grade: "", academicYear: "", term: "", reportMode: "average" };
let lastResult = null; // { students, subjectsUsed, meta }
let lastSavedModes = []; // listSavedModesForPeriod() result
let studentSearchQuery = "";
let selectedStreamFilter = "All";
let resultsRequest = 0;

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

export { buildGradingMascotSvg } from "../js/components/mascot.js";

// ------------------------------------------------------------------ Render --

export async function render({ profile, params = {} }) {
  resultsRequest++;
  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  const remembered = restoreWorkspaceSelection(profile, "grading");
  const linkedGrade = params.grade ?? params.class;
  const { academicYear, term, terms } = workspacePeriod(settings, params);
  selection = {
    grade: workspaceOption(gradeOptions(), linkedGrade ?? remembered.grade, linkedGrade == null && remembered.grade !== ""),
    academicYear,
    term,
    reportMode: workspaceOption(REPORT_MODES, params.reportMode ?? remembered.reportMode) || "average",
  };
  lastResult = null;

  const wrap = el("div", { class: "grading-view-wrap" });

  const pickerCard = el("div", { class: "card module-picker" });
  wrap.append(pickerCard);

  // Computed results
  const resultMount = el("div", { id: "grading-result-mount" });
  wrap.append(resultMount);

  renderPicker(pickerCard, profile, resultMount, terms);

  return wrap;
}

function gradeOptions() {
  return classes.map((c) => c.grade);
}

function renderPicker(container, profile, resultMount, terms) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const gradeSelect = el("select", { id: "g-grade-select" }, [
    el("option", { value: "" }, "Select grade"),
    ...gradeOptions().map((g) => el("option", { value: g, ...(g === selection.grade ? { selected: "true" } : {}) }, g)),
  ]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, [
    el("option", { value: "" }, "Select term"),
    ...terms.map((t) => el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)),
  ]);
  const reportModeSelect = el("select", {}, [
    el("option", { value: "average", ...(selection.reportMode === "average" ? { selected: "true" } : {}) }, "Final (Average All)"),
    el("option", { value: "midterm", ...(selection.reportMode === "midterm" ? { selected: "true" } : {}) }, "Midterm Report Only"),
    el("option", { value: "endterm", ...(selection.reportMode === "endterm" ? { selected: "true" } : {}) }, "Endterm Report Only"),
  ]);

  let computing = false;
  const computeButton = el("button", {
    type: "button",
    class: "btn btn--primary btn--sm",
    onClick: async (e) => {
      computing = true;
      try {
        await runCompute(profile, resultMount, e.currentTarget);
      } finally {
        computing = false;
        updateComputeButton();
      }
    },
  }, [icon("analytics", "text-xs"), "Compute Results"]);

  function updateComputeButton() {
    computeButton.disabled = computing || !gradeSelect.value || !yearInput.value.trim() || !termSelect.value;
  }

  function updateSelection({ remember = false } = {}) {
    selection = {
      grade: gradeSelect.value,
      academicYear: yearInput.value.trim(),
      term: termSelect.value,
      reportMode: reportModeSelect.value,
    };
    if (remember) rememberWorkspaceSelection(profile, "grading", { grade: selection.grade, reportMode: selection.reportMode });
    updateComputeButton();
    showSavedResults(resultMount, reportModeSelect, updateSelection);
  }
  for (const control of [gradeSelect, yearInput, termSelect, reportModeSelect]) {
    control.addEventListener("change", () => updateSelection({ remember: true }));
  }

  row.append(
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("school", "text-xs"), "Grade"]), gradeSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("calendar_today", "text-xs"), "Academic Year"]), yearInput]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("date_range", "text-xs"), "Term"]), termSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("tune", "text-xs"), "Report Mode"]), reportModeSelect])
  );
  container.append(row);

  const canManageSettings = ["admin", "super_admin"].includes(profile.role);
  container.append(el("p", { class: "module-field-note" }, canManageSettings
    ? [
        "Verify your school’s grading scale before computing or saving results. ",
        el("a", { href: "#/settings?tab=grading" }, "Check Grading Scale"),
      ]
    : "Ask your school administrator to verify the grading scale before computing or saving results."
  ));

  container.append(
    el("div", { class: "module-actions module-picker__footer" }, computeButton)
  );
  container.append(el("details", { class: "module-help" }, [
    el("summary", {}, "Grading Guide"),
    el("ul", {}, [
      el("li", {}, "Computing includes all streams in the selected grade and calculates both cohort and stream ranks."),
      el("li", {}, "Each subject needs 100% assessment weight, or a maximum score of 100 in direct mode. Incomplete results are marked Partial."),
      el("li", {}, "Compute Results creates a preview. Save Results makes grades available in Report Cards and Analytics."),
      el("li", {}, "Students with equal totals share a rank. The next rank skips the tied positions."),
    ]),
  ]));
  updateSelection();
}

function renderUnselectedResults(container) {
  const message = !classes.length ? "Add a grade before calculating results."
    : !selection.grade ? "Select a grade to view saved results."
    : "Select the academic year and term to view saved results.";
  container.replaceChildren(workspaceResults("Saved Results", message, {
    action: !classes.length ? el("a", { class: "btn btn--outline btn--sm", href: "#/academics" }, "Classes & Streams") : null,
  }));
}

async function showSavedResults(container, modeSelect, updateSelection) {
  const request = ++resultsRequest;
  if (!selection.grade || !selection.academicYear || !selection.term) {
    renderUnselectedResults(container);
    return;
  }
  const context = { ...selection };
  container.replaceChildren(workspaceResults("Saved Results", "Checking for saved results…"));
  try {
    const results = await listResultsByPeriod({
      grade: context.grade, academicYear: context.academicYear, term: context.term,
    });
    if (request !== resultsRequest) return;
    const saved = results.filter((row) => (row.reportMode || "average") === context.reportMode);
    const period = `${context.grade} · ${context.term} ${context.academicYear}`;
    const modes = summarizeSavedModes(results);
    const columns = ["Position", "Student", "Mean Mark", "Grade", "Points"];
    const panel = saved.length
      ? el("section", { class: "card workspace-results" }, [
          el("h2", { class: "module-section-title" }, "Saved Results"),
          el("p", { class: "module-field-note" }, `${period} · ${reportModeLabel(context.reportMode)}`),
          el("div", { class: "table-wrap table-wrap--responsive" }, [
            el("table", {}, [
              el("thead", {}, el("tr", {}, columns.map((label) => el("th", { scope: "col" }, label)))),
              el("tbody", {}, saved.map((row) => el("tr", {}, [
                row.overallPosition, row.fullName || row.admissionNumber, row.meanMarks, row.meanGrade, row.totalPoints,
              ].map((value, index) => el("td", { "data-label": columns[index] }, String(value ?? "—")))))),
            ]),
          ]),
        ])
      : workspaceResults("Saved Results", `No ${reportModeLabel(context.reportMode)} results saved for ${period}. Select Compute Results to preview them.`);
    container.replaceChildren(panel);
    if (modes.length > 1 || (!saved.length && modes.length)) {
      container.prepend(savedModesPanel(modes, {
        activeMode: context.reportMode,
        onSelect(mode) {
          if (mode !== modeSelect.value) {
            modeSelect.value = mode;
            updateSelection({ remember: true });
          }
        },
      }));
    }
  } catch {
    if (request !== resultsRequest) return;
    container.replaceChildren(workspaceResults("Saved Results", "Could not load saved results.", {
      action: el("button", { type: "button", class: "btn btn--outline btn--sm", onClick: () => showSavedResults(container, modeSelect, updateSelection) }, "Retry"),
    }));
  }
}

// ---------------------------------------------------------------- Compute --


function renderArrearsNotice(amountOwed) {
  const formattedAmount = amountOwed ? `KES ${amountOwed.toLocaleString()}` : "Contact Support";
  
  return el("div", { 
    class: "card", 
    style: "max-width: 540px; margin: 40px auto; padding: 48px 32px; text-align: center; border: 1px solid var(--color-danger-200); border-radius: 16px; box-shadow: 0 12px 32px rgba(239, 68, 68, 0.05); background: var(--color-surface);" 
  }, [
    
    // Icon Container
    el("div", { 
      style: "width: 72px; height: 72px; margin: 0 auto 24px; background: rgba(239,68,68,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--color-danger-600);" 
    }, [
      icon("lock_clock", "", "style: font-size: 36px;")
    ]),

    // Heading
    el("h2", { 
      style: "color: var(--color-ink-hard); margin: 0 0 12px; font-size: 1.5rem; font-weight: 700; font-family: system-ui, -apple-system, sans-serif; letter-spacing: -0.02em;" 
    }, "Computation of Results Temporarily Disabled for Your School"),

    // Amount Pill
    ...(amountOwed ? [
      el("div", { 
        style: "display: inline-flex; align-items: center; gap: 6px; background: var(--color-danger-50); color: var(--color-danger-700); padding: 6px 16px; border-radius: 100px; font-weight: 600; font-size: 0.95rem; margin-bottom: 24px; border: 1px solid var(--color-danger-200);" 
      }, [
        icon("payments", "", "style: font-size: 18px;"),
        `Balance Due: ${formattedAmount}`
      ])
    ] : []),

    // Description text
    el("p", { 
      style: "color: var(--color-ink-soft); font-size: 1.05rem; line-height: 1.6; margin: 0 auto 12px; font-family: system-ui, -apple-system, sans-serif;" 
    }, "Your marks and assessments are securely saved. However, computing results and exporting reports requires an active subscription."),
    
    el("p", { 
      style: "color: var(--color-ink-soft); font-size: 0.95rem; line-height: 1.6; margin: 0 auto 32px; max-width: 400px; font-family: system-ui, -apple-system, sans-serif;" 
    }, "Please settle the outstanding balance to immediately restore these features."),

    // Support Box
    el("div", { 
      style: "background: var(--color-surface-soft); padding: 16px 20px; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; text-align: left; border: 1px solid var(--color-surface-hover);" 
    }, [
      el("div", {}, [
        el("h4", { 
          style: "margin: 0 0 4px; font-size: 0.9rem; color: var(--color-ink-hard); font-weight: 600; font-family: system-ui, -apple-system, sans-serif;" 
        }, "Ready to unlock?"),
        el("p", { 
          style: "margin: 0; font-size: 0.85rem; color: var(--color-ink-soft); font-family: system-ui, -apple-system, sans-serif;" 
        }, "Contact billing to restore access.")
      ]),
      el("a", { 
        href: "mailto:iskify360.tech@gmail.com", 
        class: "btn btn--sm",
        style: "background: var(--color-surface-soft, var(--color-cream-dim)); border: 1px solid var(--color-surface-hover); color: var(--color-ink-hard); text-decoration: none; font-weight: 600;" 
      }, [
        icon("mail", "", "style: font-size: 16px;"), "Email Us"
      ])
    ])
  ]);
}


async function runCompute(profile, resultMount, computeBtn = null) {
  const request = ++resultsRequest;
  const context = { ...selection };
  const school = getCurrentSchool();
  if (school && school.canComputeOrGenerate === false) {
    resultMount.innerHTML = "";
    const notice = renderArrearsNotice(school.amountOwed);
    resultMount.append(notice);
    notice.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  const restoreComputeBtn = busyButton(computeBtn, "Computing…");
  resultMount.innerHTML = "";
  resultMount.append(el("div", { class: "spinner-overlay", style: "padding:var(--sp-6);" }, [
    spinner("lg", "dark"),
    el("div", { style: "margin-top:12px; font-weight:600; color:var(--color-primary-900);" }, "Computing averages, grades, and merit positions…"),
  ]));
  try {
    const [result, savedModes] = await Promise.all([
      computeClassResults({
        ...context,
        gradingScale: settings.gradingScale,
      }),
      listSavedModesForPeriod(context),
    ]);
    if (request !== resultsRequest) return;
    lastResult = result;
    lastSavedModes = savedModes;
    studentSearchQuery = "";
    selectedStreamFilter = "All";
    renderResult(resultMount, profile);
  } catch (err) {
    if (request !== resultsRequest) return;
    resultMount.innerHTML = "";
    toast(err.message || "Could not compute results.", "error");
    renderUnselectedResults(resultMount);
  } finally {
    restoreComputeBtn();
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
        onClick: (e) => handleSave(profile, container, e.currentTarget),
      }, [icon("save", "text-xs"), "Save Results"])
    );
  }
  container.append(headerCard);

  // Reminder to check grading scale in settings
  const scaleReminder = el("div", {
    class: "text-muted text-xs",
    style: "margin-bottom:var(--sp-3); display:flex; align-items:center; gap:8px; background:var(--color-surface-soft); padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--color-line);"
  }, [
    icon("tune", "text-xs", "style: color:var(--color-primary-600);"),
    el("span", {}, [
      "Grades & points are calculated using your school's ",
      el("a", { href: "#/settings?tab=grading", style: "font-weight:600; text-decoration:underline; color:var(--color-primary-700);" }, "Grading Scale in Settings"),
      ". Please ensure the grading scale is verified before saving or releasing report cards."
    ]),
  ]);
  container.append(scaleReminder);

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

async function handleSave(profile, resultMount, saveBtn = null) {
  const request = resultsRequest;
  const context = { ...selection };
  const students = lastResult.students;
  const incompleteCount = lastResult.students.filter((s) => s.hasIncompleteSubject).length;
  if (incompleteCount > 0) {
    const proceed = confirm(
      `Notice: ${incompleteCount} student(s) have incomplete assessment weights for at least one subject. Results will be marked as partial. Save anyway?`
    );
    if (!proceed) return;
  }
  const restore = busyButton(saveBtn, "Saving…");
  try {
    await saveResults(profile.uid, context, students);
    toast(`${reportModeLabel(context.reportMode)} results saved. They are now published for Report Cards.`, "success");
    const modes = await listSavedModesForPeriod(context);
    if (request !== resultsRequest) return;
    lastSavedModes = modes;
    renderResult(resultMount, profile);
  } catch (err) {
    toast(err.message || "Could not save results.", "error");
    restore();
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
      el("div", { class: "text-muted text-xs" }, `Adm No: ${student.admissionNumber || "—"} · ${student.grade || selection.grade || "—"} ${student.stream || ""}`.trim()),
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
