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
let currentSearchQuery = "";

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
  currentSearchQuery = "";

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

  // Persistent Hero Header across all steps for unified visual hierarchy
  wrap.append(buildHeroHeader());

  // Connected Stepper Navigation
  wrap.append(buildStepper());

  // Step Content Card
  switch (currentStep) {
    case 1: wrap.append(buildConfigureStep()); break;
    case 2: wrap.append(buildReviewStep()); break;
    case 3: wrap.append(buildCommitStep()); break;
  }
}

function buildHeroHeader() {
  const currentYear = settings?.currentAcademicYear || new Date().getFullYear().toString();
  const currentTerm = settings?.currentTerm || "Term 3";
  const activeCount = students.filter((s) => s.status === "active").length;
  const isSeason = isPromotionSeason(settings);

  return el("div", { class: "promotions-hero" }, [
    el("div", { class: "promotions-hero__content" }, [
      el("div", { class: "promotions-hero__tag" }, [
        icon("calendar_month"),
        `Academic Cycle · ${currentYear} ${currentTerm}`,
      ]),
      el("p", { class: "promotions-hero__desc" }, "Review and advance learners to the next academic year. This process will update each learner's class, stream, and graduation status according to your selections."),
      el("div", { class: "promotions-hero__pills" }, [
        el("span", { class: "promotions-pill" }, [icon("meeting_room"), `${classes.length} Configured Classes`]),
        el("span", { class: "promotions-pill" }, [icon("groups"), `${activeCount} Active Learners`]),
        isSeason
          ? el("span", { class: "promotions-pill promotions-pill--season" }, [icon("verified"), "Promotion Season Active"])
          : "",
      ]),
    ]),
  ]);
}

function buildStepper() {
  const steps = [
    { num: 1, label: "Configure", desc: "Select mode & parameters" },
    { num: 2, label: "Review", desc: "Inspect & edit assignments" },
    { num: 3, label: "Commit", desc: "Confirm & advance year" },
  ];

  const stepper = el("div", { class: "promotion-stepper" });

  steps.forEach((s, idx) => {
    let nodeCls = "promotion-step-node";
    if (s.num === currentStep) nodeCls += " promotion-step-node--active";
    else if (s.num < currentStep) nodeCls += " promotion-step-node--done";

    const badge = el("div", { class: "promotion-step-badge" }, [
      s.num < currentStep ? icon("check") : String(s.num),
    ]);

    const meta = el("div", { class: "promotion-step-meta" }, [
      el("span", { class: "promotion-step-meta__step" }, `Step ${s.num}`),
      el("span", { class: "promotion-step-meta__label" }, s.label),
    ]);

    stepper.append(el("div", { class: nodeCls }, [badge, meta]));

    if (idx < steps.length - 1) {
      let connCls = "promotion-step-connector";
      if (s.num < currentStep) connCls += " promotion-step-connector--done";
      stepper.append(el("div", { class: connCls }));
    }
  });

  return stepper;
}

// --------------------------------------------------- Step 1: Configure --

function buildConfigureStep() {
  const section = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const isSeason = isPromotionSeason(settings);

  // Balanced Card Header
  section.append(
    el("div", { class: "promotion-card-header" }, [
      el("div", { class: "promotion-card-header__left" }, [
        el("div", { class: "promotion-header-icon-wrap" }, [icon("tune")]),
        el("div", {}, [
          el("h2", { class: "promotion-card-title" }, "Select Promotion Mode"),
          el("p", { class: "promotion-card-subtitle" }, "Choose whether to promote the entire school cohort automatically or configure a specific grade manually."),
        ]),
      ]),
    ])
  );

  const body = el("div", { class: "card__body", style: "padding:var(--sp-5);" });

  // Season alert banner if in Term 3
  if (isSeason) {
    body.append(
      el("div", { class: "promotion-banner promotion-banner--ready" }, [
        icon("celebration"),
        el("div", {}, [
          el("strong", {}, "Final Academic Term Detected"),
          el("p", { style: "margin:3px 0 0; font-size:var(--fs-xs);" }, `${settings.currentTerm} is currently active. Running promotion will advance all cohorts and bump the academic calendar to the next school year.`),
        ]),
      ])
    );
  }

  if (classes.length === 0) {
    body.append(
      el("div", { class: "empty-state" }, [
        icon("warning"),
        el("p", {}, "No classes found. Set up your classes in Classes & Streams first."),
      ])
    );
    section.append(body);
    return section;
  }

  const activeStudents = students.filter((s) => s.status === "active");
  if (activeStudents.length === 0) {
    body.append(
      el("div", { class: "empty-state" }, [
        icon("info"),
        el("p", {}, "No active students available to promote."),
      ])
    );
    section.append(body);
    return section;
  }

  // Interactive Mode Cards
  const autoRadio = el("input", { type: "radio", name: "promo-mode", id: "mode-auto", value: "auto", checked: mode === "auto" ? "true" : undefined });
  const manualRadio = el("input", { type: "radio", name: "promo-mode", id: "mode-manual", value: "manual", checked: mode === "manual" ? "true" : undefined });
  const manualFields = el("div", { class: "promotion-manual-fields", style: mode === "manual" ? "" : "display:none;" });

  const autoCard = el("div", {
    class: `promotion-mode-card${mode === "auto" ? " promotion-mode-card--active" : ""}`,
    onClick: () => {
      autoRadio.checked = true;
      mode = "auto";
      autoCard.classList.add("promotion-mode-card--active");
      manualCard.classList.remove("promotion-mode-card--active");
      manualFields.style.display = "none";
    },
  }, [
    autoRadio,
    el("div", { class: "promotion-mode-card__icon" }, [icon("trending_up")]),
    el("div", { class: "promotion-mode-card__content" }, [
      el("div", { class: "promotion-mode-card__title" }, "Auto-Promote Entire School (Recommended)"),
      el("p", { class: "promotion-mode-card__desc" }, "Advances all active students to the next grade according to the natural grade progression map. Terminal grade graduates to Alumni."),
    ]),
  ]);

  const manualCard = el("div", {
    class: `promotion-mode-card${mode === "manual" ? " promotion-mode-card--active" : ""}`,
    onClick: () => {
      manualRadio.checked = true;
      mode = "manual";
      manualCard.classList.add("promotion-mode-card--active");
      autoCard.classList.remove("promotion-mode-card--active");
      manualFields.style.display = "";
    },
  }, [
    manualRadio,
    el("div", { class: "promotion-mode-card__icon" }, [icon("tune")]),
    el("div", { class: "promotion-mode-card__content" }, [
      el("div", { class: "promotion-mode-card__title" }, "Manual Grade-to-Grade Selection"),
      el("p", { class: "promotion-mode-card__desc" }, "Target a specific source grade cohort and choose an explicit destination grade or graduation outcome."),
    ]),
  ]);

  const modeGrid = el("div", { class: "promotion-mode-grid" }, [autoCard, manualCard]);
  body.append(modeGrid);

  // Grade progression preview
  const progression = buildGradeProgression(classes);
  const flowContainer = el("div", { class: "promotion-progression-flow" });
  const entries = Object.entries(progression);

  entries.forEach(([from, to], idx) => {
    flowContainer.append(
      el("span", { class: "promotion-progression-badge" }, [icon("school"), from])
    );
    flowContainer.append(
      el("span", { class: "promotion-progression-arrow material-symbols-rounded" }, "arrow_forward")
    );
    if (idx === entries.length - 1) {
      flowContainer.append(
        el("span", { class: "promotion-progression-badge promotion-progression-badge--grad" }, [
          icon("workspace_premium"),
          to ? to : "Alumni (Graduated)",
        ])
      );
    }
  });

  body.append(
    el("div", { style: "margin-top:var(--sp-4);" }, [
      el("label", { class: "field__label", style: "font-weight:600; font-size:var(--fs-xs); color:var(--color-ink-soft); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:8px;" }, "Cohort Progression Mapping"),
      flowContainer,
    ]),
    buildManualFields(manualFields)
  );

  section.append(body);

  // Footer Actions
  const generateBtn = el("button", {
    class: "btn btn--primary",
    onClick: () => generatePlan(),
  }, [icon("checklist"), "Generate & Review Plan"]);

  section.append(
    el("div", {
      class: "card__footer",
      style: "display:flex; justify-content:flex-end; padding:var(--sp-4) var(--sp-5); border-top:1px solid var(--color-line); background:var(--color-white);",
    }, [generateBtn])
  );

  return section;
}

function buildManualFields(container) {
  const sourceSelect = el("select", {
    id: "manual-source",
    style: "height:38px; padding:0 12px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); width:100%;",
  }, classes.map((c) => el("option", { value: c.grade }, c.grade)));

  const destSelect = el("select", {
    id: "manual-dest",
    style: "height:38px; padding:0 12px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); width:100%;",
  }, [
    ...classes.map((c) => el("option", { value: c.grade }, c.grade)),
    el("option", { value: "__graduate__" }, "Graduate to Alumni"),
  ]);

  if (classes.length > 1) {
    destSelect.value = classes[1]?.grade || classes[0]?.grade;
  }

  sourceSelect.addEventListener("change", () => {
    const idx = classes.findIndex((c) => c.grade === sourceSelect.value);
    if (idx >= 0 && idx < classes.length - 1) {
      destSelect.value = classes[idx + 1].grade;
    }
  });

  container.innerHTML = "";
  container.append(
    el("div", { style: "display:flex; gap:var(--sp-4); align-items:flex-end; flex-wrap:wrap; margin-top:var(--sp-4); padding:var(--sp-4); background:#f8fafc; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
      el("div", { class: "field", style: "flex:1; min-width:200px; margin:0;" }, [
        el("label", { class: "field__label", style: "font-weight:600; margin-bottom:4px;" }, "Source Grade"),
        sourceSelect,
      ]),
      el("div", { style: "display:flex; align-items:center; justify-content:center; height:38px; color:var(--color-ink-soft);" }, [
        icon("arrow_forward"),
      ]),
      el("div", { class: "field", style: "flex:1; min-width:200px; margin:0;" }, [
        el("label", { class: "field__label", style: "font-weight:600; margin-bottom:4px;" }, "Target Destination"),
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
    toast("No students found matching the selected criteria.", "error");
    return;
  }

  currentStep = 2;
  currentSearchQuery = "";
  renderStep(wrapRef);
}

// ----------------------------------------------------- Step 2: Review --

function buildReviewStep() {
  const section = el("div", { class: "card", style: "padding:0; overflow:hidden;" });

  const promoting = plan.filter((e) => e.action === "promote");
  const graduating = plan.filter((e) => e.action === "graduate");
  const excluded = plan.filter((e) => e.action === "exclude");
  const warnings = plan.filter((e) => e.warning && e.action !== "exclude");

  // Balanced, Clean Header
  section.append(
    el("div", { class: "promotion-card-header" }, [
      el("div", { class: "promotion-card-header__left" }, [
        el("div", { class: "promotion-header-icon-wrap" }, [icon("checklist")]),
        el("div", {}, [
          el("h2", { class: "promotion-card-title" }, "Review Promotion Plan"),
          el("p", { class: "promotion-card-subtitle" }, "Verify each learner's planned destination before committing changes to the database."),
        ]),
      ]),
    ])
  );

  // Native Search & Metric Toolbar
  const searchInput = el("input", {
    type: "search",
    class: "promotion-search-input",
    placeholder: "Search by student name or admission number…",
    value: currentSearchQuery,
  });

  const clearBtn = el("button", {
    type: "button",
    class: "promotion-search-clear",
    style: currentSearchQuery ? "display:flex;" : "display:none;",
    title: "Clear search",
    onClick: () => {
      searchInput.value = "";
      currentSearchQuery = "";
      clearBtn.style.display = "none";
      renderRows("");
      searchInput.focus();
    },
  }, [icon("close")]);

  const searchWrap = el("div", { class: "promotion-search-wrap" }, [
    icon("search", "promotion-search-icon"),
    searchInput,
    clearBtn,
  ]);

  const summaryChips = el("div", { class: "promotion-summary-chips" }, [
    el("span", { class: "promotion-chip promotion-chip--success" }, [
      icon("arrow_upward"),
      `${promoting.length} Promoting`,
    ]),
    el("span", { class: "promotion-chip promotion-chip--primary" }, [
      icon("school"),
      `${graduating.length} Graduating`,
    ]),
    warnings.length > 0
      ? el("span", { class: "promotion-chip promotion-chip--warning" }, [
          icon("warning"),
          `${warnings.length} Need Attention`,
        ])
      : "",
    excluded.length > 0
      ? el("span", { class: "promotion-chip promotion-chip--muted" }, [
          icon("remove_circle_outline"),
          `${excluded.length} Excluded`,
        ])
      : "",
  ]);

  const toolbar = el("div", { class: "promotion-toolbar" }, [searchWrap, summaryChips]);
  section.append(toolbar);

  // Review Table
  const tbody = el("tbody", {});
  const tableWrap = el("div", { class: "promotion-table-wrap" }, [
    el("table", { class: "promotion-review-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { style: "width:34%;" }, "Student"),
          el("th", { style: "width:18%;" }, "Admission No"),
          el("th", { style: "width:20%;" }, "Current Class"),
          el("th", { style: "width:20%;" }, "Promoted To"),
          el("th", { style: "width:8%; text-align:center;" }, "Actions"),
        ]),
      ]),
      tbody,
    ]),
  ]);

  function renderRows(filter = "") {
    tbody.innerHTML = "";
    const q = filter.trim().toLowerCase();
    let matchCount = 0;

    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      const name = entry.student.fullName || "";
      const adm = entry.student.admissionNumber || "";
      if (q && !name.toLowerCase().includes(q) && !adm.toLowerCase().includes(q)) continue;

      matchCount++;
      tbody.append(buildReviewRow(entry, i, () => {
        renderRows(currentSearchQuery);
        updateSummary();
      }));
    }

    if (matchCount === 0) {
      tbody.append(
        el("tr", {}, [
          el("td", { colspan: "5", style: "padding:0;" }, [
            el("div", { class: "promotion-empty-search" }, [
              icon("search_off"),
              el("div", { style: "font-weight:600; font-size:var(--fs-sm); color:var(--color-ink);" }, `No learners matching "${filter}"`),
              el("div", { style: "font-size:var(--fs-xs); color:var(--color-ink-soft); margin-top:2px;" }, "Check spelling or search by admission number."),
            ]),
          ]),
        ])
      );
    }
  }

  function updateSummary() {
    const p = plan.filter((e) => e.action === "promote").length;
    const g = plan.filter((e) => e.action === "graduate").length;
    const ex = plan.filter((e) => e.action === "exclude").length;
    const w = plan.filter((e) => e.warning && e.action !== "exclude").length;

    summaryChips.innerHTML = "";
    summaryChips.append(
      el("span", { class: "promotion-chip promotion-chip--success" }, [
        icon("arrow_upward"),
        `${p} Promoting`,
      ]),
      el("span", { class: "promotion-chip promotion-chip--primary" }, [
        icon("school"),
        `${g} Graduating`,
      ])
    );
    if (w > 0) {
      summaryChips.append(
        el("span", { class: "promotion-chip promotion-chip--warning" }, [
          icon("warning"),
          `${w} Need Attention`,
        ])
      );
    }
    if (ex > 0) {
      summaryChips.append(
        el("span", { class: "promotion-chip promotion-chip--muted" }, [
          icon("remove_circle_outline"),
          `${ex} Excluded`,
        ])
      );
    }
  }

  searchInput.addEventListener("input", (e) => {
    currentSearchQuery = e.target.value;
    clearBtn.style.display = currentSearchQuery ? "flex" : "none";
    renderRows(currentSearchQuery);
  });

  renderRows(currentSearchQuery);
  section.append(tableWrap);

  // Unresolved warnings hint
  if (warnings.length > 0) {
    section.append(
      el("div", {
        style: "display:flex; align-items:center; gap:8px; padding:10px 16px; background:rgba(245, 158, 11, 0.08); border-top:1px solid rgba(245, 158, 11, 0.2); font-size:var(--fs-xs); color:#B45309;",
      }, [
        icon("info"),
        el("span", {}, `${warnings.length} learner(s) had their stream auto-assigned because their previous stream is not offered in the destination grade. Click the edit icon (✎) on any row to change it.`),
      ])
    );
  }

  // Footer Navigation
  section.append(
    el("div", {
      class: "card__footer",
      style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-4) var(--sp-5); border-top:1px solid var(--color-line); background:var(--color-white); flex-wrap:wrap; gap:12px;",
    }, [
      el("button", { class: "btn btn--ghost", onClick: () => {
        currentStep = 1;
        renderStep(wrapRef);
      }}, [icon("arrow_back"), "Back"]),
      el("button", { class: "btn btn--primary", onClick: () => {
        const actionable = plan.filter((e) => e.action === "promote" || e.action === "graduate");
        if (actionable.length === 0) {
          toast("All learners have been excluded. Nothing to commit.", "error");
          return;
        }
        currentStep = 3;
        renderStep(wrapRef);
      }}, [icon("arrow_forward"), "Proceed to Final Step"]),
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

  let toContent;
  if (isExcluded) {
    toContent = el("span", { class: "badge badge--muted" }, "Excluded (Retained)");
  } else if (isGraduating) {
    toContent = el("span", { class: "badge badge--primary" }, [icon("school"), " Graduate (Alumni)"]);
  } else {
    toContent = el("span", { style: "font-weight:600; color:var(--color-primary-900);" }, [
      entry.toGrade,
      entry.toStream ? el("span", { style: "color:var(--color-ink-soft); font-weight:400;" }, ` · ${entry.toStream}`) : "",
    ]);
  }

  const actionBtn = isExcluded
    ? el("button", {
        type: "button",
        class: "promotion-action-btn",
        title: "Re-include in promotion",
        onClick: () => {
          const progression = buildGradeProgression(classes);
          const toGrade = progression[entry.fromGrade];
          entry.action = toGrade === null || toGrade === undefined ? "graduate" : "promote";
          entry.toGrade = toGrade;
          entry.toStream = entry.fromStream;
          if (toGrade) {
            const avail = streamsForGrade(classes, toGrade);
            if (avail.length > 0 && !avail.includes(entry.fromStream)) {
              entry.toStream = avail[0];
              entry.warning = entry.fromStream
                ? `Stream "${entry.fromStream}" not in ${toGrade} · Assigned to "${entry.toStream}"`
                : `No stream previously assigned · Assigned to "${entry.toStream}"`;
            } else {
              entry.warning = "";
            }
          }
          onUpdate();
        },
      }, [icon("add_circle")])
    : el("button", {
        type: "button",
        class: "promotion-action-btn",
        title: "Edit destination grade or stream",
        onClick: () => {
          openEditRow(entry, index, onUpdate);
        },
      }, [icon("edit")]);

  const excludeBtn = !isExcluded
    ? el("button", {
        type: "button",
        class: "promotion-action-btn promotion-action-btn--danger",
        title: "Exclude learner from promotion (retain)",
        onClick: () => {
          entry.action = "exclude";
          entry.toGrade = null;
          entry.toStream = "";
          entry.warning = "";
          onUpdate();
        },
      }, [icon("do_not_disturb_on")])
    : "";

  const fromDisplay = entry.fromStream
    ? `${entry.fromGrade} · ${entry.fromStream}`
    : entry.fromGrade;

  return el("tr", { class: rowClass }, [
    el("td", {}, [
      el("div", { style: "font-weight:600; color:var(--color-ink);" }, entry.student.fullName || "—"),
      hasWarning ? el("div", { class: "promotion-warning-tag" }, [icon("warning"), entry.warning]) : "",
    ]),
    el("td", { style: "font-family:var(--font-mono); font-size:12px; color:var(--color-ink-soft);" }, entry.student.admissionNumber || "—"),
    el("td", { style: "color:var(--color-ink-soft);" }, fromDisplay),
    el("td", {}, [toContent]),
    el("td", { style: "text-align:center;" }, [
      el("div", { style: "display:inline-flex; gap:6px; justify-content:center; align-items:center;" }, [actionBtn, excludeBtn]),
    ]),
  ]);
}

async function openEditRow(entry, index, onUpdate) {
  const { openModal } = await import("../js/components/modal.js");

  const gradeSelect = el("select", {
    class: "field__input",
    style: "height:38px; border-radius:var(--radius-md); font-size:var(--fs-sm);",
  }, [
    ...classes.map((c) => el("option", { value: c.grade, ...(c.grade === entry.toGrade ? { selected: "true" } : {}) }, c.grade)),
    el("option", { value: "__graduate__", ...(entry.action === "graduate" ? { selected: "true" } : {}) }, "Graduate to Alumni"),
  ]);

  const streamSelect = el("select", {
    class: "field__input",
    style: "height:38px; border-radius:var(--radius-md); font-size:var(--fs-sm);",
  });

  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    if (grade === "__graduate__") {
      streamSelect.append(el("option", { value: "" }, "Not applicable (Graduating)"));
      streamSelect.disabled = true;
      return;
    }
    streamSelect.disabled = false;
    const avail = streamsForGrade(classes, grade);
    avail.forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === entry.toStream ? { selected: "true" } : {}) }, s))
    );
    if (avail.length === 0) streamSelect.append(el("option", { value: "" }, "No streams configured"));
  }

  fillStreams(entry.action === "graduate" ? "__graduate__" : entry.toGrade);
  gradeSelect.addEventListener("change", () => fillStreams(gradeSelect.value));

  let close;

  const saveBtn = el("button", {
    class: "btn btn--primary btn--sm",
    onClick: () => {
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
    },
  }, [icon("check"), "Save Changes"]);

  const cancelBtn = el("button", {
    class: "btn btn--ghost btn--sm",
    onClick: () => close?.(),
  }, "Cancel");

  const body = el("div", { style: "display:flex; flex-direction:column; gap:var(--sp-3);" }, [
    el("div", { class: "field" }, [el("label", { class: "field__label" }, "Destination Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", { class: "field__label" }, "Destination Stream"), streamSelect]),
    el("div", { style: "display:flex; gap:8px; justify-content:flex-end; margin-top:var(--sp-2);" }, [cancelBtn, saveBtn]),
  ]);

  close = openModal(`Override Assignment: ${entry.student.fullName}`, body);
}

// ----------------------------------------------------- Step 3: Commit --

function buildCommitStep() {
  const section = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const currentYear = settings.currentAcademicYear || new Date().getFullYear().toString();
  const newYear = String(parseInt(currentYear, 10) + 1);
  const firstTerm = (settings.terms || ["Term 1"])[0];

  const promoting = plan.filter((e) => e.action === "promote");
  const graduating = plan.filter((e) => e.action === "graduate");
  const excluded = plan.filter((e) => e.action === "exclude");

  // Balanced Card Header
  section.append(
    el("div", { class: "promotion-card-header" }, [
      el("div", { class: "promotion-card-header__left" }, [
        el("div", { class: "promotion-header-icon-wrap" }, [icon("task_alt")]),
        el("div", {}, [
          el("h2", { class: "promotion-card-title" }, "Confirm & Commit Promotions"),
          el("p", { class: "promotion-card-subtitle" }, "Review final movement figures and academic calendar updates before saving."),
        ]),
      ]),
    ])
  );

  const body = el("div", { class: "card__body", style: "padding:var(--sp-5);" });

  // 2-Column Summary Grid
  const commitGrid = el("div", { class: "promotion-commit-grid" }, [
    // Panel 1: Learner Movements
    el("div", { class: "promotion-commit-panel" }, [
      el("div", { class: "promotion-commit-panel__title" }, [icon("groups"), "Learner Cohort Updates"]),
      el("div", { class: "promotion-commit-item" }, [
        icon("arrow_upward"),
        el("span", {}, [
          el("strong", { style: "color:var(--color-primary-900);" }, String(promoting.length)),
          ` learner${promoting.length !== 1 ? "s" : ""} will advance to the next grade`,
        ]),
      ]),
      el("div", { class: "promotion-commit-item promotion-commit-item--grad" }, [
        icon("school"),
        el("span", {}, [
          el("strong", { style: "color:var(--color-green);" }, String(graduating.length)),
          ` learner${graduating.length !== 1 ? "s" : ""} will graduate → Alumni Collection`,
        ]),
      ]),
      excluded.length > 0
        ? el("div", { class: "promotion-commit-item promotion-commit-item--muted" }, [
            icon("remove_circle_outline"),
            el("span", {}, [
              el("strong", {}, String(excluded.length)),
              ` learner${excluded.length !== 1 ? "s" : ""} will remain in current grade (retained)`,
            ]),
          ])
        : "",
    ]),

    // Panel 2: Academic Calendar Bump
    el("div", { class: "promotion-commit-panel" }, [
      el("div", { class: "promotion-commit-panel__title" }, [icon("calendar_month"), "Academic Calendar Progression"]),
      el("div", { class: "promotion-commit-item" }, [
        icon("update"),
        el("span", {}, [
          "Academic Year advances: ",
          el("strong", { style: "color:var(--color-primary-900);" }, `${currentYear} → ${newYear}`),
        ]),
      ]),
      el("div", { class: "promotion-commit-item" }, [
        icon("replay"),
        el("span", {}, [
          "Term resets to: ",
          el("strong", { style: "color:var(--color-primary-900);" }, firstTerm),
        ]),
      ]),
      el("div", { class: "promotion-commit-item promotion-commit-item--muted" }, [
        icon("policy"),
        el("span", { style: "font-size:var(--fs-xs);" }, "Bulk promotion recorded in immutable Audit Trail"),
      ]),
    ]),
  ]);

  body.append(commitGrid);

  // Warning Callout
  const warningAlert = el("div", {
    class: "alert alert--warning",
    style: "display:flex; align-items:flex-start; gap:12px; margin-bottom:var(--sp-4);",
  }, [
    icon("warning"),
    el("div", {}, [
      el("div", { class: "alert__title", style: "font-weight:700;" }, "Irreversible Academic Progression"),
      el("div", { class: "alert__body", style: "font-size:var(--fs-xs); margin-top:2px;" }, "Committing will update learner grade records in the database and permanently add graduating cohorts to the alumni register. Confirm that all term marks and reports have been concluded."),
    ]),
  ]);
  body.append(warningAlert);

  // Progress Bar (hidden until commit)
  const progressWrap = el("div", { class: "promotion-progress-wrap", style: "display:none;" });
  const progressBar = el("div", { class: "promotion-progress-fill" });
  const progressText = el("span", { class: "promotion-progress-text" }, "Preparing atomic writes...");
  progressWrap.append(
    el("div", { class: "promotion-progress-track" }, [progressBar]),
    progressText
  );
  body.append(progressWrap);

  // Result Area
  const resultWrap = el("div", { class: "promotion-result", style: "display:none;" });
  body.append(resultWrap);

  section.append(body);

  // Footer Navigation & Commit Action
  const backBtn = el("button", {
    class: "btn btn--ghost",
    onClick: () => {
      currentStep = 2;
      renderStep(wrapRef);
    },
  }, [icon("arrow_back"), "Back to Review"]);

  const commitBtn = el("button", {
    class: "btn btn--primary btn--lg",
    onClick: async (e) => {
      const restore = busyButton(e.currentTarget, "Committing…");
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
            progressText.textContent = `Processing batch write: ${done} of ${total} records completed (${pct}%)…`;
          },
        });

        progressWrap.style.display = "none";
        commitBtn.style.display = "none";
        backBtn.style.display = "none";
        resultWrap.style.display = "";
        resultWrap.innerHTML = "";
        resultWrap.append(
          el("div", { class: "promotion-result-success" }, [
            icon("check_circle"),
            el("div", {}, [
              el("h3", { style: "margin:0 0 var(--sp-1); font-size:1.15rem; color:var(--color-green);" }, "Academic Promotion Successfully Committed"),
              el("p", { style: "margin:0 0 6px; font-size:var(--fs-sm); color:var(--color-ink);" }, `${result.promoted} learners promoted to their next classes, and ${result.graduated} graduates archived to Alumni.`),
              el("p", { style: "margin:0 0 6px; font-size:var(--fs-sm); font-weight:600; color:var(--color-primary-900);" }, `The active school year is now ${newYear}, ${firstTerm}.`),
              el("p", { class: "text-muted", style: "font-size:11px; margin:0;" }, `Completed in ${result.batches} database batch${result.batches !== 1 ? "es" : ""}.`),
            ]),
          ]),
          el("div", { style: "display:flex; gap:var(--sp-3); margin-top:var(--sp-4);" }, [
            el("button", { class: "btn btn--primary", onClick: () => {
              import("../js/router.js").then(({ navigate }) => navigate("/dashboard"));
            }}, [icon("dashboard"), "Go to Dashboard"]),
            el("button", { class: "btn btn--ghost", onClick: () => {
              import("../js/router.js").then(({ navigate }) => navigate("/students"));
            }}, [icon("school"), "View Student Directory"]),
          ])
        );

        toast("Promotion successfully finalized!", "success");
      } catch (err) {
        progressWrap.style.display = "none";
        toast(err.message || "Failed to commit promotion plan. Please try again.", "error");
        restore();
        backBtn.disabled = false;
      }
    },
  }, [icon("check_circle"), "Promote Now"]);

  section.append(
    el("div", {
      class: "card__footer",
      style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-4) var(--sp-5); border-top:1px solid var(--color-line); background:var(--color-white); flex-wrap:wrap; gap:12px;",
    }, [backBtn, commitBtn])
  );

  return section;
}
