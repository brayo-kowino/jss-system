// Promotion Engine view — 3-step wizard for end-of-year class progression.
//
// Step 1: Configure — choose Auto or Manual mode.
// Step 2: Review   — inspect every planned move, edit overrides, exclude.
// Step 3: Commit   — confirm summary, academic year bump, and commit.
//
// Follows the project's standard view contract: render({profile}) returns
// a DOM node, init({profile}) attaches live behavior after mount.

import {
  buildGradeProgression,
  generatePromotionPlan,
  commitPromotionPlan,
  streamsForGrade,
  isPromotionSeason,
} from "../js/services/promotion.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { el, icon, toast, busyButton, mobileOnlyNotice } from "../js/utils.js";

let classes = [];
let students = [];
let settings = null;
let plan = [];
let currentStep = 1; // 1=Configure, 2=Review, 3=Commit
let mode = "auto"; // "auto" | "manual"
let activeProfile = null;
let wrapRef = null;

export async function render({ profile }) {
  activeProfile = profile;
  [classes, students, settings] = await Promise.all([
    listClasses(),
    listStudents(),
    getSchoolSettings(),
  ]);

  currentStep = 1;
  mode = "auto";
  plan = [];

  const wrap = el("div", { class: "page-container promotion-page" });
  wrapRef = wrap;

  wrap.append(mobileOnlyNotice("The promotion engine works best on a larger screen where you can review the full table."));
  renderStep(wrap);

  return wrap;
}

export function init() {}

// ---------------------------------------------------------- Step Routing --

function renderStep(wrap) {
  // Clear content area but keep the mobile notice if present
  const notice = wrap.querySelector(".mobile-only-notice, .alert--info.mobile-only-notice");
  wrap.innerHTML = "";
  if (notice) wrap.append(notice);

  wrap.append(buildStepIndicator());

  switch (currentStep) {
    case 1: wrap.append(buildConfigureStep()); break;
    case 2: wrap.append(buildReviewStep()); break;
    case 3: wrap.append(buildCommitStep()); break;
  }
}

function buildStepIndicator() {
  const steps = [
    { num: 1, label: "Configure" },
    { num: 2, label: "Review" },
    { num: 3, label: "Commit" },
  ];

  return el("div", { class: "promotion-steps" }, steps.map((s) => {
    let cls = "promotion-step";
    if (s.num === currentStep) cls += " promotion-step--active";
    else if (s.num < currentStep) cls += " promotion-step--done";

    return el("div", { class: cls }, [
      el("div", { class: "promotion-step__number" }, s.num < currentStep ? icon("check") : String(s.num)),
      el("span", { class: "promotion-step__label" }, s.label),
    ]);
  }));
}

// --------------------------------------------------- Step 1: Configure --

function buildConfigureStep() {
  const section = el("div", { class: "card" });
  const currentYear = settings.currentAcademicYear || new Date().getFullYear().toString();
  const isSeason = isPromotionSeason(settings);

  // Header
  section.append(
    el("div", { class: "card__header" }, [
      el("div", { class: "card__header-text" }, [
        el("h2", { class: "card__title" }, [icon("trending_up"), " Promotion Engine"]),
        el("p", { class: "card__subtitle" }, `${currentYear} Academic Year · ${settings.currentTerm || "Term 3"}`),
      ]),
    ])
  );

  // Season banner
  if (isSeason) {
    section.append(
      el("div", { class: "promotion-banner promotion-banner--ready" }, [
        icon("celebration"),
        el("div", {}, [
          el("strong", {}, "It's promotion season!"),
          el("p", { style: "margin:4px 0 0;" }, `${settings.currentTerm} is the final term. When results are finalized, promote students to the next academic year.`),
        ]),
      ])
    );
  }

  if (classes.length === 0) {
    section.append(
      el("div", { class: "empty-state" }, [
        icon("warning"),
        el("p", {}, "No classes found. Set up your classes in Classes & Streams first."),
      ])
    );
    return section;
  }

  const activeStudents = students.filter((s) => s.status === "active");
  if (activeStudents.length === 0) {
    section.append(
      el("div", { class: "empty-state" }, [
        icon("info"),
        el("p", {}, "No active students to promote."),
      ])
    );
    return section;
  }

  // Mode selection
  const autoRadio = el("input", { type: "radio", name: "promo-mode", id: "mode-auto", value: "auto", checked: "true" });
  const manualRadio = el("input", { type: "radio", name: "promo-mode", id: "mode-manual", value: "manual" });
  const manualFields = el("div", { class: "promotion-manual-fields", style: "display:none;" });

  autoRadio.addEventListener("change", () => { mode = "auto"; manualFields.style.display = "none"; });
  manualRadio.addEventListener("change", () => { mode = "manual"; manualFields.style.display = ""; });

  // Grade progression preview
  const progression = buildGradeProgression(classes);
  const progressionPreview = el("div", { class: "promotion-progression" },
    Object.entries(progression).map(([from, to]) =>
      el("span", { class: "badge badge--outline" }, to ? `${from} → ${to}` : `${from} → Graduate`)
    )
  );

  section.append(
    el("div", { class: "card__body" }, [
      el("div", { class: "promotion-mode-group" }, [
        el("div", { class: "promotion-mode-option" }, [
          autoRadio,
          el("label", { for: "mode-auto" }, [
            el("strong", {}, "Auto-Promote All"),
            el("p", { class: "text-muted" }, "Moves every active student up one grade. Final-grade students graduate and are added to alumni."),
          ]),
        ]),
        el("div", { class: "promotion-mode-option" }, [
          manualRadio,
          el("label", { for: "mode-manual" }, [
            el("strong", {}, "Manual Selection"),
            el("p", { class: "text-muted" }, "Pick a source grade and destination grade, then select which students to include."),
          ]),
        ]),
      ]),

      // Grade progression map
      el("div", { style: "margin-top:var(--sp-4);" }, [
        el("label", { class: "field__label", style: "margin-bottom:var(--sp-2); display:block;" }, "Grade Progression Map"),
        progressionPreview,
      ]),

      // Manual mode fields
      buildManualFields(manualFields),
    ])
  );

  // Generate button
  const generateBtn = el("button", { class: "btn btn--primary", style: "margin-top:var(--sp-4);", onClick: () => {
    generatePlan();
  }}, [icon("playlist_add_check"), "Generate Plan"]);

  section.append(
    el("div", { class: "card__footer", style: "display:flex; justify-content:flex-end; padding:var(--sp-4);" }, [generateBtn])
  );

  return section;
}

function buildManualFields(container) {
  const sourceSelect = el("select", { id: "manual-source" },
    classes.map((c) => el("option", { value: c.grade }, c.grade))
  );
  const destSelect = el("select", { id: "manual-dest" },
    [
      ...classes.map((c) => el("option", { value: c.grade }, c.grade)),
      el("option", { value: "__graduate__" }, "Graduate (Alumni)"),
    ]
  );

  // Default destination to next grade
  if (classes.length > 1) {
    destSelect.value = classes[1]?.grade || classes[0]?.grade;
  }

  sourceSelect.addEventListener("change", () => {
    const idx = classes.findIndex((c) => c.grade === sourceSelect.value);
    if (idx >= 0 && idx < classes.length - 1) {
      destSelect.value = classes[idx + 1].grade;
    }
  });

  container.append(
    el("div", { style: "display:flex; gap:var(--sp-4); flex-wrap:wrap; margin-top:var(--sp-3);" }, [
      el("div", { class: "field", style: "flex:1; min-width:180px;" }, [
        el("label", { class: "field__label" }, "Source Grade"),
        sourceSelect,
      ]),
      el("div", { style: "display:flex; align-items:center; padding-top:20px;" }, [icon("arrow_forward")]),
      el("div", { class: "field", style: "flex:1; min-width:180px;" }, [
        el("label", { class: "field__label" }, "Destination"),
        destSelect,
      ]),
    ])
  );

  return container;
}

function generatePlan() {
  const options = {};

  if (mode === "manual") {
    const sourceSelect = wrapRef.querySelector("#manual-source");
    const destSelect = wrapRef.querySelector("#manual-dest");
    if (sourceSelect) options.sourceGrade = sourceSelect.value;
    if (destSelect) {
      options.destinationGrade = destSelect.value === "__graduate__" ? null : destSelect.value;
    }
  }

  plan = generatePromotionPlan(students, classes, options);

  if (plan.length === 0) {
    toast("No students found for the selected criteria.", "error");
    return;
  }

  currentStep = 2;
  renderStep(wrapRef);
}

// ----------------------------------------------------- Step 2: Review --

function buildReviewStep() {
  const section = el("div", { class: "card" });

  const promoting = plan.filter((e) => e.action === "promote");
  const graduating = plan.filter((e) => e.action === "graduate");
  const excluded = plan.filter((e) => e.action === "exclude");
  const warnings = plan.filter((e) => e.warning && e.action !== "exclude");

  // Header
  section.append(
    el("div", { class: "card__header" }, [
      el("div", { class: "card__header-text" }, [
        el("h2", { class: "card__title" }, [icon("checklist"), " Review Promotion Plan"]),
      ]),
    ])
  );

  // Summary bar
  const summaryBar = el("div", { class: "promotion-summary-bar" }, [
    el("span", { class: "badge badge--success" }, [icon("arrow_upward"), ` ${promoting.length} promoting`]),
    el("span", { class: "badge badge--primary" }, [icon("school"), ` ${graduating.length} graduating`]),
    excluded.length > 0
      ? el("span", { class: "badge badge--muted" }, [icon("remove_circle_outline"), ` ${excluded.length} excluded`])
      : "",
    warnings.length > 0
      ? el("span", { class: "badge badge--warning" }, [icon("warning"), ` ${warnings.length} need attention`])
      : "",
  ]);
  section.append(summaryBar);

  // Search
  const searchInput = el("input", { type: "text", class: "field__input", placeholder: "Search by name or admission number...", style: "margin:var(--sp-3) var(--sp-4);" });
  section.append(searchInput);

  // Table
  const tbody = el("tbody", {});
  const table = el("div", { class: "table-wrap", style: "margin:0 var(--sp-4) var(--sp-4);" }, [
    el("table", { class: "table promotion-review-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Student"),
          el("th", {}, "Adm No"),
          el("th", {}, "From"),
          el("th", {}, "To"),
          el("th", { style: "width:100px; text-align:center;" }, "Action"),
        ]),
      ]),
      tbody,
    ]),
  ]);

  function renderRows(filter = "") {
    tbody.innerHTML = "";
    const q = filter.toLowerCase();
    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      const name = entry.student.fullName || "";
      const adm = entry.student.admissionNumber || "";
      if (q && !name.toLowerCase().includes(q) && !adm.toLowerCase().includes(q)) continue;
      tbody.append(buildReviewRow(entry, i, () => {
        renderRows(filter);
        updateSummary();
      }));
    }
  }

  function updateSummary() {
    const p = plan.filter((e) => e.action === "promote").length;
    const g = plan.filter((e) => e.action === "graduate").length;
    const ex = plan.filter((e) => e.action === "exclude").length;
    const w = plan.filter((e) => e.warning && e.action !== "exclude").length;

    summaryBar.innerHTML = "";
    summaryBar.append(
      el("span", { class: "badge badge--success" }, [icon("arrow_upward"), ` ${p} promoting`]),
      el("span", { class: "badge badge--primary" }, [icon("school"), ` ${g} graduating`]),
    );
    if (ex > 0) summaryBar.append(el("span", { class: "badge badge--muted" }, [icon("remove_circle_outline"), ` ${ex} excluded`]));
    if (w > 0) summaryBar.append(el("span", { class: "badge badge--warning" }, [icon("warning"), ` ${w} need attention`]));
  }

  searchInput.addEventListener("input", (e) => renderRows(e.target.value));
  renderRows();

  section.append(table);

  // Unresolved warnings check
  const unresolvedMismatches = plan.filter((e) => e.warning && e.action !== "exclude");
  if (unresolvedMismatches.length > 0) {
    section.append(
      el("div", { class: "alert alert--warning", style: "margin:0 var(--sp-4) var(--sp-4);" }, [
        icon("warning"),
        el("div", {}, [
          el("div", { class: "alert__title" }, "Stream Mismatches"),
          el("div", { class: "alert__body" }, `${unresolvedMismatches.length} student(s) had their stream reassigned because it doesn't exist in the destination grade. Click the edit button to review.`),
        ]),
      ])
    );
  }

  // Footer with navigation
  section.append(
    el("div", { class: "card__footer", style: "display:flex; justify-content:space-between; padding:var(--sp-4);" }, [
      el("button", { class: "btn btn--ghost", onClick: () => {
        currentStep = 1;
        renderStep(wrapRef);
      }}, [icon("arrow_back"), "Back"]),
      el("button", { class: "btn btn--primary", onClick: () => {
        const actionable = plan.filter((e) => e.action === "promote" || e.action === "graduate");
        if (actionable.length === 0) {
          toast("All students have been excluded. Nothing to commit.", "error");
          return;
        }
        currentStep = 3;
        renderStep(wrapRef);
      }}, [icon("arrow_forward"), "Proceed to Commit"]),
    ])
  );

  return section;
}

function buildReviewRow(entry, index, onUpdate) {
  const isExcluded = entry.action === "exclude";
  const isGraduating = entry.action === "graduate";
  const hasWarning = !!entry.warning && !isExcluded;

  let rowClass = "promotion-review-row";
  if (isExcluded) rowClass += " promotion-row--excluded";
  else if (isGraduating) rowClass += " promotion-row--graduate";
  else if (hasWarning) rowClass += " promotion-row--warning";

  const toText = isExcluded
    ? el("span", { class: "text-muted" }, "— Excluded —")
    : isGraduating
    ? el("span", { class: "badge badge--primary" }, [icon("school"), " Graduate"])
    : `${entry.toGrade} ${entry.toStream}`;

  const actionBtn = isExcluded
    ? el("button", { class: "btn btn--ghost btn--xs", title: "Include back", onClick: () => {
        // Restore to original action
        const progression = buildGradeProgression(classes);
        const toGrade = progression[entry.fromGrade];
        entry.action = toGrade === null || toGrade === undefined ? "graduate" : "promote";
        entry.toGrade = toGrade;
        entry.toStream = entry.fromStream;
        if (toGrade) {
          const avail = streamsForGrade(classes, toGrade);
          if (avail.length > 0 && !avail.includes(entry.fromStream)) {
            entry.toStream = avail[0];
            entry.warning = `Stream "${entry.fromStream}" not found in ${toGrade}. Assigned to "${entry.toStream}".`;
          } else {
            entry.warning = "";
          }
        }
        onUpdate();
      }}, [icon("add_circle"), "Include"])
    : el("button", { class: "btn btn--ghost btn--xs", title: "Edit destination or exclude", onClick: () => {
        openEditRow(entry, index, onUpdate);
      }}, [icon("edit")]);

  const excludeBtn = !isExcluded
    ? el("button", { class: "btn btn--ghost btn--xs text-danger", title: "Exclude from promotion", onClick: () => {
        entry.action = "exclude";
        entry.toGrade = null;
        entry.toStream = "";
        entry.warning = "";
        onUpdate();
      }}, [icon("remove_circle_outline")])
    : "";

  const row = el("tr", { class: rowClass }, [
    el("td", {}, [
      entry.student.fullName || "—",
      hasWarning ? el("div", { class: "text-warning", style: "font-size:var(--fs-xs);" }, [icon("warning"), ` ${entry.warning}`]) : "",
    ]),
    el("td", {}, entry.student.admissionNumber || "—"),
    el("td", {}, `${entry.fromGrade} ${entry.fromStream}`),
    el("td", {}, [toText]),
    el("td", { style: "text-align:center;" }, [
      el("div", { style: "display:flex; gap:4px; justify-content:center;" }, [actionBtn, excludeBtn]),
    ]),
  ]);

  return row;
}

async function openEditRow(entry, index, onUpdate) {
  const { openModal } = await import("../js/components/modal.js");

  // Build inline edit controls
  const gradeSelect = el("select", { class: "field__input field__input--sm" }, [
    ...classes.map((c) => el("option", { value: c.grade, ...(c.grade === entry.toGrade ? { selected: "true" } : {}) }, c.grade)),
    el("option", { value: "__graduate__", ...(entry.action === "graduate" ? { selected: "true" } : {}) }, "Graduate"),
  ]);

  const streamSelect = el("select", { class: "field__input field__input--sm" });

  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    if (grade === "__graduate__") {
      streamSelect.append(el("option", { value: "" }, "N/A"));
      streamSelect.disabled = true;
      return;
    }
    streamSelect.disabled = false;
    const avail = streamsForGrade(classes, grade);
    avail.forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === entry.toStream ? { selected: "true" } : {}) }, s))
    );
    if (avail.length === 0) streamSelect.append(el("option", { value: "" }, "No streams"));
  }

  fillStreams(entry.action === "graduate" ? "__graduate__" : entry.toGrade);
  gradeSelect.addEventListener("change", () => fillStreams(gradeSelect.value));

  let close;

  const saveBtn = el("button", { class: "btn btn--primary btn--xs", onClick: () => {
    const val = gradeSelect.value;
    if (val === "__graduate__") {
      entry.action = "graduate";
      entry.toGrade = null;
      entry.toStream = "";
    } else {
      entry.action = "promote";
      entry.toGrade = val;
      entry.toStream = streamSelect.value;
    }
    entry.warning = "";
    close?.();
    onUpdate();
  }}, [icon("check"), "Save"]);

  const cancelBtn = el("button", { class: "btn btn--ghost btn--xs", onClick: () => close?.() }, "Cancel");

  const body = el("div", { style: "display:flex; flex-direction:column; gap:var(--sp-3);" }, [
    el("div", { class: "field" }, [el("label", { class: "field__label" }, "Destination Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", { class: "field__label" }, "Stream"), streamSelect]),
    el("div", { style: "display:flex; gap:8px; justify-content:flex-end;" }, [cancelBtn, saveBtn]),
  ]);

  close = openModal(`Edit: ${entry.student.fullName}`, body);
}

// ----------------------------------------------------- Step 3: Commit --

function buildCommitStep() {
  const section = el("div", { class: "card" });
  const currentYear = settings.currentAcademicYear || new Date().getFullYear().toString();
  const newYear = String(parseInt(currentYear, 10) + 1);
  const firstTerm = (settings.terms || ["Term 1"])[0];

  const promoting = plan.filter((e) => e.action === "promote");
  const graduating = plan.filter((e) => e.action === "graduate");
  const excluded = plan.filter((e) => e.action === "exclude");

  // Header
  section.append(
    el("div", { class: "card__header" }, [
      el("div", { class: "card__header-text" }, [
        el("h2", { class: "card__title" }, [icon("task_alt"), " Confirm Promotion"]),
      ]),
    ])
  );

  // Summary
  const summaryCard = el("div", { class: "promotion-commit-summary" }, [
    el("div", { class: "promotion-commit-row" }, [
      icon("arrow_upward"),
      el("span", {}, [
        el("strong", {}, String(promoting.length)),
        ` student${promoting.length !== 1 ? "s" : ""} will be promoted to the next grade`,
      ]),
    ]),
    el("div", { class: "promotion-commit-row" }, [
      icon("school"),
      el("span", {}, [
        el("strong", {}, String(graduating.length)),
        ` student${graduating.length !== 1 ? "s" : ""} will graduate → Alumni`,
      ]),
    ]),
    excluded.length > 0
      ? el("div", { class: "promotion-commit-row promotion-commit-row--muted" }, [
          icon("remove_circle_outline"),
          el("span", {}, [
            el("strong", {}, String(excluded.length)),
            ` student${excluded.length !== 1 ? "s" : ""} excluded (no change)`,
          ]),
        ])
      : "",
  ]);

  // Academic year bump
  const yearCard = el("div", { class: "promotion-commit-summary", style: "margin-top:var(--sp-3);" }, [
    el("div", { class: "promotion-commit-row" }, [
      icon("calendar_month"),
      el("span", {}, [
        "Academic year will advance: ",
        el("strong", {}, `${currentYear} → ${newYear}`),
      ]),
    ]),
    el("div", { class: "promotion-commit-row" }, [
      icon("replay"),
      el("span", {}, [
        "Term will reset to: ",
        el("strong", {}, firstTerm),
      ]),
    ]),
  ]);

  // Warning
  const warningAlert = el("div", { class: "alert alert--warning", style: "margin-top:var(--sp-3);" }, [
    icon("warning"),
    el("div", {}, [
      el("div", { class: "alert__title" }, "This action cannot be undone"),
      el("div", { class: "alert__body" }, "Student records will be permanently updated. Graduated students will be marked and added to the alumni register. Please review carefully before proceeding."),
    ]),
  ]);

  // Progress area (hidden initially)
  const progressWrap = el("div", { class: "promotion-progress-wrap", style: "display:none;" });
  const progressBar = el("div", { class: "promotion-progress-fill" });
  const progressText = el("span", { class: "promotion-progress-text" }, "Preparing...");
  progressWrap.append(
    el("div", { class: "promotion-progress-track" }, [progressBar]),
    progressText
  );

  // Result area (hidden initially)
  const resultWrap = el("div", { class: "promotion-result", style: "display:none;" });

  section.append(
    el("div", { class: "card__body" }, [summaryCard, yearCard, warningAlert, progressWrap, resultWrap])
  );

  // Footer
  const backBtn = el("button", { class: "btn btn--ghost", onClick: () => {
    currentStep = 2;
    renderStep(wrapRef);
  }}, [icon("arrow_back"), "Back to Review"]);

  const commitBtn = el("button", { class: "btn btn--primary btn--lg", onClick: async (e) => {
    const restore = busyButton(e.currentTarget, "Promoting...");
    backBtn.disabled = true;
    progressWrap.style.display = "";

    try {
      const result = await commitPromotionPlan(activeProfile.uid, plan, {
        newAcademicYear: newYear,
        currentAcademicYear: currentYear,
        firstTerm,
        onProgress: (done, total) => {
          const pct = Math.round((done / total) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `Processing ${done} of ${total}...`;
        },
      });

      // Show success
      progressWrap.style.display = "none";
      resultWrap.style.display = "";
      resultWrap.innerHTML = "";
      resultWrap.append(
        el("div", { class: "promotion-result-success" }, [
          icon("check_circle"),
          el("div", {}, [
            el("h3", { style: "margin:0 0 var(--sp-2);" }, "Promotion Complete!"),
            el("p", {}, `${result.promoted} promoted, ${result.graduated} graduated.`),
            el("p", {}, `Academic year is now ${newYear}, ${firstTerm}.`),
            el("p", { class: "text-muted", style: "font-size:var(--fs-xs);" }, `Committed in ${result.batches} batch${result.batches !== 1 ? "es" : ""}.`),
          ]),
        ]),
        el("div", { style: "display:flex; gap:var(--sp-3); margin-top:var(--sp-4);" }, [
          el("button", { class: "btn btn--primary", onClick: () => {
            import("../js/router.js").then(({ navigate }) => navigate("/dashboard"));
          }}, [icon("dashboard"), "Go to Dashboard"]),
          el("button", { class: "btn btn--ghost", onClick: () => {
            import("../js/router.js").then(({ navigate }) => navigate("/students"));
          }}, [icon("school"), "View Students"]),
        ])
      );

      toast("Promotion completed successfully!", "success");
    } catch (err) {
      progressWrap.style.display = "none";
      toast(err.message || "Promotion failed. Please try again.", "error");
      restore();
      backBtn.disabled = false;
    }
  }}, [icon("check_circle"), "Promote Now"]);

  section.append(
    el("div", { class: "card__footer", style: "display:flex; justify-content:space-between; padding:var(--sp-4);" }, [backBtn, commitBtn])
  );

  return section;
}
