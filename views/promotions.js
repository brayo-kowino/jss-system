import {
  assignPromotionDestination, buildGradeProgression, changesPlacement, commitPromotionPlan,
  generatePromotionPlan, isPromotionSeason, loadPromotionWorkspace, promotionGrades, promotionRollover,
  streamsForGrade,
} from "../js/services/promotion.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, busyButton, toast } from "../js/utils.js";

const GRADUATE = "__graduate__";
const STEPS = ["Configure", "Review", "Confirm"];
const REVIEW_PAGE_SIZE = 60;

function actionButton(label, onClick, variant = "ghost", symbol) {
  return el("button", { type: "button", class: "btn btn--" + variant, onClick },
    [symbol ? icon(symbol) : null, label]);
}

function notice(title, message, tone = "info") {
  return el("div", { class: "promotion-notice promotion-notice--" + tone }, [
    el("span", { "aria-hidden": "true" }, icon(tone === "warning" ? "warning" : "info")),
    el("div", {}, [el("strong", {}, title), el("p", {}, message)]),
  ]);
}

function field(label, input) {
  return el("div", { class: "field" }, [el("label", { for: input.id }, label), input]);
}

function footer(...buttons) {
  return el("div", { class: "promotion-footer" }, buttons);
}

function card(title, description, symbol, ...content) {
  return el("section", { class: "card promotion-card" }, [
    el("div", { class: "promotion-card-header" }, [
      el("div", { class: "promotion-card-header__left" }, [
        el("div", { class: "promotion-header-icon-wrap", "aria-hidden": "true" }, icon(symbol)),
        el("div", {}, [
          el("h2", { class: "promotion-card-title", tabindex: "-1" }, title),
          el("p", { class: "promotion-card-subtitle" }, description),
        ]),
      ]),
    ]),
    ...content,
  ]);
}

function stepper(current) {
  const list = el("ol", { class: "promotion-stepper", "aria-label": "Promotion progress" });
  STEPS.forEach((label, index) => {
    const state = index === current ? "active" : index < current ? "done" : "";
    list.append(el("li", {
      class: "promotion-step-node" + (state ? " promotion-step-node--" + state : ""),
      "aria-current": index === current ? "step" : null,
    }, [
      el("span", { class: "promotion-step-badge", "aria-hidden": "true" }, index < current ? icon("check") : String(index + 1)),
      el("span", { class: "promotion-step-meta__label" }, label),
    ]));
  });
  return list;
}

function reviewSummary(plan) {
  let moves = 0;
  let graduates = 0;
  let retained = 0;
  let warnings = 0;
  let unassigned = 0;
  for (const entry of plan) {
    if (entry.excluded) {
      retained++;
      continue;
    }
    if (entry.warning) warnings++;
    if (entry.action === "unassigned") unassigned++;
    else if (entry.action === "graduate") graduates++;
    else if (changesPlacement(entry)) moves++;
    else retained++;
  }
  return { moves, graduates, retained, warnings, unassigned };
}

function summaries({ moves, graduates, retained, warnings = 0 }) {
  return [
    el("span", { class: "promotion-chip promotion-chip--success" }, moves + " moving"),
    el("span", { class: "promotion-chip promotion-chip--primary" }, graduates + " graduating"),
    el("span", { class: "promotion-chip promotion-chip--muted" }, retained + " staying"),
    warnings ? el("span", { class: "promotion-chip promotion-chip--warning" }, warnings + " to review") : null,
  ];
}

function progressionPreview(classes) {
  const progression = buildGradeProgression(classes);
  const incoming = new Set(Object.values(progression).filter(Boolean));
  const roots = Object.keys(progression).filter((grade) => !incoming.has(grade));
  if (!roots.length) return null;
  return el("div", { class: "promotion-progression" }, [
    el("h3", {}, "Automatic grade paths"),
    ...roots.map((grade) => {
      const path = [];
      let next = grade;
      while (next) {
        path.push(el("span", { class: "promotion-progression-badge" }, next), icon("arrow_forward", "promotion-progression-arrow"));
        next = progression[next];
      }
      path.push(el("span", { class: "promotion-progression-badge promotion-progression-badge--grad" },
        next === null ? "Alumni" : "Choose destination in review"));
      return el("div", { class: "promotion-progression-flow" }, path);
    }),
  ]);
}

function editAssignment(entry, classes, onSave, trigger) {
  const grade = el("select", { id: "promotion-edit-grade" }, [
    el("option", { value: "" }, "Choose grade"),
    ...promotionGrades(classes).map((name) => el("option", { value: name }, name)),
    el("option", { value: GRADUATE }, "Graduate to Alumni"),
  ]);
  grade.value = entry.action === "graduate" ? GRADUATE : entry.toGrade || "";
  const stream = el("select", { id: "promotion-edit-stream" });
  const save = actionButton("Save Destination", () => {
    const revised = assignPromotionDestination(entry, classes, grade.value === GRADUATE ? null : grade.value);
    onSave({ ...revised, toStream: stream.value, warning: "" });
    close();
  }, "primary");

  function updateStreams() {
    const streams = streamsForGrade(classes, grade.value);
    stream.replaceChildren(...(streams.length
      ? streams.map((name) => el("option", { value: name }, name))
      : [el("option", { value: "" }, "No stream")]));
    if (streams.includes(entry.toStream)) stream.value = entry.toStream;
    else if (streams.includes(entry.fromStream)) stream.value = entry.fromStream;
    stream.disabled = !streams.length;
    save.disabled = !grade.value;
  }
  grade.addEventListener("change", updateStreams);
  updateStreams();
  const close = openModal({
    title: "Edit destination for " + (entry.student.fullName || "learner"),
    body: el("div", {}, [
      field("Destination grade", grade), field("Destination stream", stream),
      footer(actionButton("Cancel", () => close()), save),
    ]),
    onClose: () => (trigger.isConnected ? trigger : document.querySelector(".promotion-review-controls input"))?.focus(),
  });
  grade.focus();
}

export async function render({ profile }) {
  const wrap = el("div", { class: "page-container promotion-page" });
  let workspace = null;
  let currentStep = 0;
  let mode = "manual";
  let manualSource = "";
  let manualDestination = "";
  let plan = [];
  let filter = "all";
  let search = "";
  let savedProgress = null;
  let runId = null;
  let initialLoad = true;

  async function load() {
    const pending = el("p", { role: "status", class: "text-muted" }, "Loading the latest roster and school calendar…");
    wrap.replaceChildren(pending);
    try {
      workspace = await loadPromotionWorkspace();
    } catch (error) {
      const message = error.code === "permission-denied"
        ? "Your account couldn’t read the required records. Ask your school administrator to check Promotions access."
        : "Check your connection and try again.";
      wrap.replaceChildren(card("Couldn’t open Promotions", message, "sync_problem",
        el("div", { class: "promotion-body" }, actionButton("Try Again", load, "primary"))));
      return;
    }
    savedProgress = workspace.pendingRun;
    currentStep = savedProgress ? 2 : 0;
    const { settings } = workspace;
    const finishedThisYear = settings.lastCompletedPromotionYear === String(settings.currentAcademicYear).trim();
    mode = savedProgress?.mode || (promotionRollover(settings) && !finishedThisYear ? "auto" : "manual");
    manualSource = "";
    manualDestination = "";
    plan = [];
    search = "";
    filter = "all";
    runId = savedProgress?.id || null;
    showStep(!initialLoad);
  }

  function showStep(focus = true) {
    const contents = currentStep === 0 ? configure() : currentStep === 1 ? review() : confirm();
    wrap.replaceChildren(stepper(currentStep), contents);
    if (focus) contents.querySelector("h2")?.focus({ preventScroll: true });
  }

  function configure() {
    const { classes, students, settings, canSave } = workspace;
    const finishedThisYear = settings.lastCompletedPromotionYear === String(settings.currentAcademicYear).trim();
    const rollover = finishedThisYear ? null : promotionRollover(settings);
    const activeStudents = students.filter((student) => student.status === "active");
    const body = el("div", { class: "promotion-body" });
    if (!canSave) body.append(notice("Preview access", "A school administrator can save promotions."));
    if (!classes.length || !activeStudents.length) {
      body.append(notice(classes.length ? "No active learners" : "No classes configured", classes.length
        ? "Add or activate learners in Students before starting a promotion."
        : "Set up your grades in Classes & Streams first."));
      return card("Set up promotions", "Review how learners will move before saving.", "tune", body);
    }

    if (!rollover) {
      const reason = finishedThisYear ? "School-wide promotion has already been saved for this academic year."
        : isPromotionSeason(settings) ? "Set a valid academic year and first term in School Settings."
          : "School-wide promotion is available in the final term. You can move or graduate learners from one grade now.";
      body.append(notice("School-wide promotion is unavailable", reason));
    }
    const modes = [
      { key: "auto", title: "School-wide year-end promotion", description: rollover
        ? "Move eligible learners, graduate final grades, and start " + rollover.term + " " + rollover.year + "."
        : "Move eligible learners and start the next academic year.", symbol: "trending_up", disabled: !rollover },
      { key: "manual", title: "Move or graduate one grade", description: "Choose a source grade and destination. The school calendar stays the same.", symbol: "tune" },
    ];

    const grades = promotionGrades(classes);
    const activeGrades = new Set(activeStudents.map(({ grade }) => grade));
    const source = el("select", { id: "promotion-source" }, grades.filter((grade) => activeGrades.has(grade))
      .map((grade) => el("option", { value: grade }, grade)));
    const destination = el("select", { id: "promotion-destination" }, [
      el("option", { value: "" }, "Choose grade"),
      ...grades.map((grade) => el("option", { value: grade }, grade)),
      el("option", { value: GRADUATE }, "Graduate to Alumni"),
    ]);
    const manualFields = el("div", { class: "promotion-manual-fields field-row" }, [
      field("Source grade", source), field("Destination", destination),
    ]);
    const automaticPaths = progressionPreview(classes);

    const generate = actionButton("Review Plan", () => {
      try {
        plan = generatePromotionPlan(students, classes, mode === "manual"
          ? { sourceGrade: source.value, destinationGrade: destination.value === GRADUATE ? null : destination.value }
          : {});
        if (!plan.length) {
          toast("No active learners match this selection.", "info");
          return;
        }
        filter = plan.some(({ warning }) => warning) ? "attention" : "all";
        search = "";
        currentStep = 1;
        showStep();
      } catch (error) {
        toast(error.message, "error");
      }
    }, "primary", "arrow_forward");

    const modeGrid = el("fieldset", { class: "promotion-mode-grid" }, [
      el("legend", { class: "sr-only" }, "Promotion mode"),
      ...modes.map(({ key, title, description, symbol, disabled }) => el("label", {
        class: "promotion-mode-card", "data-mode": key,
      }, [
        el("input", {
          type: "radio", name: "promotion-mode", value: key, checked: key === mode ? "" : null,
          disabled: disabled ? "" : null,
          onChange: () => { mode = key; updateMode(); },
        }),
        el("div", { class: "promotion-mode-card__icon", "aria-hidden": "true" }, icon(symbol)),
        el("div", { class: "promotion-mode-card__content" }, [
          el("strong", { class: "promotion-mode-card__title" }, title),
          el("p", { class: "promotion-mode-card__desc" }, description),
        ]),
      ])),
    ]);
    manualSource = activeGrades.has(manualSource) ? manualSource : source.options[0]?.value || "";
    source.value = manualSource;
    const progression = buildGradeProgression(classes);
    function setSuggestedDestination() {
      const suggested = Object.hasOwn(progression, source.value) ? progression[source.value] : undefined;
      // Graduation must be chosen explicitly in manual mode.
      manualDestination = suggested || "";
    }
    if (!manualDestination) setSuggestedDestination();
    destination.value = manualDestination;
    source.addEventListener("change", () => {
      manualSource = source.value;
      setSuggestedDestination();
      destination.value = manualDestination;
      updateMode();
    });
    destination.addEventListener("change", () => {
      manualDestination = destination.value;
      updateMode();
    });

    function updateMode() {
      modeGrid.querySelectorAll("[data-mode]").forEach((item) =>
        item.classList.toggle("promotion-mode-card--active", item.dataset.mode === mode));
      manualFields.hidden = mode !== "manual";
      if (automaticPaths) automaticPaths.hidden = mode !== "auto";
      generate.disabled = mode === "manual" && (!source.value || !destination.value);
    }

    body.append(modeGrid, manualFields);
    if (!source.options.length) {
      manualFields.append(el("p", { class: "text-muted text-sm" }, "Active learners need a configured source grade before a manual move."));
    }
    if (automaticPaths) body.append(automaticPaths);
    updateMode();
    return card("Set up promotions", "Choose which learners to move and how their destinations will be assigned.", "tune",
      body, footer(generate));
  }

  function review() {
    const body = el("div", { class: "promotion-body" });
    const summary = el("div", { class: "promotion-summary-chips", role: "status" });
    const searchBox = el("input", {
      id: "promotion-search", class: "promotion-search-input", type: "search",
      placeholder: "Name or admission number", value: search, "aria-label": "Search learners",
    });
    const filterBox = el("select", { id: "promotion-filter", "aria-label": "Filter learners" }, [
      ["all", "All learners"], ["attention", "Needs review"], ["move", "Moving"],
      ["graduate", "Graduating"], ["stay", "Staying"],
    ].map(([value, label]) => el("option", { value }, label)));
    filterBox.value = filter;
    const controls = el("div", { class: "promotion-review-controls" }, [searchBox, filterBox]);
    const tbody = el("tbody");
    const columns = ["Learner", "Admission number", "Current class", "Destination", "Actions"];
    const table = el("div", { class: "table-wrap table-wrap--responsive promotion-table-wrap", role: "region", "aria-label": "Learner destinations", tabindex: "0" },
      el("table", { class: "promotion-review-table" }, [
        el("thead", {}, el("tr", {}, columns.map((title) => el("th", { scope: "col" }, title)))),
        tbody,
      ]));
    const status = el("p", { class: "text-sm text-muted", role: "status" });
    let page = 0;
    const previous = actionButton("Previous", () => { page--; renderRows(); });
    const following = actionButton("Next", () => { page++; renderRows(); });
    const pagination = el("div", { class: "promotion-pagination", "aria-label": "Learner pages" }, [previous, following]);
    const next = actionButton("Continue to Confirmation", () => {
      currentStep = 2;
      showStep();
    }, "primary", "arrow_forward");

    function renderRows() {
      const counts = reviewSummary(plan);
      const q = search.trim().toLowerCase();
      summary.replaceChildren(...summaries(counts).filter(Boolean));
      const shown = plan.filter((entry) => {
        const matchesSearch = !q || [entry.student.fullName, entry.student.admissionNumber].some((value) =>
          String(value ?? "").toLowerCase().includes(q));
        const category = entry.excluded || (!changesPlacement(entry) && entry.action !== "unassigned") ? "stay"
          : entry.action === "promote" ? "move" : entry.action;
        return matchesSearch && (filter === "all" || (filter === "attention"
          ? Boolean(entry.warning && !entry.excluded) : filter === category));
      });
      const lastPage = Math.max(0, Math.ceil(shown.length / REVIEW_PAGE_SIZE) - 1);
      page = Math.min(page, lastPage);
      const offset = page * REVIEW_PAGE_SIZE;
      const visible = shown.slice(offset, offset + REVIEW_PAGE_SIZE);
      tbody.replaceChildren(...visible.map((entry) => {
        const name = entry.student.fullName || "Learner";
        const key = entry.student.id;
        const excluded = entry.excluded;
        const edit = actionButton("Edit", (event) => editAssignment(entry, workspace.classes, (revised) => {
          Object.assign(entry, revised);
          renderRows();
        }, event.currentTarget));
        edit.setAttribute("aria-label", "Edit destination for " + name);
        const keep = actionButton(excluded ? "Restore" : "Keep", () => {
          entry.excluded = !entry.excluded;
          renderRows();
          const newButton = [...tbody.querySelectorAll("[data-keep-for]")].find((node) => node.dataset.keepFor === key);
          (newButton || filterBox).focus();
        });
        keep.dataset.keepFor = key;
        keep.setAttribute("aria-label", (excluded ? "Restore destination for " : "Keep in current class: ") + name);
        const values = [
          el("strong", {}, name), entry.student.admissionNumber || "—",
          [entry.fromGrade || "Unassigned", entry.fromStream].filter(Boolean).join(" · "),
          el("div", {}, [
            el("strong", {}, excluded || (!changesPlacement(entry) && entry.action !== "unassigned") ? "Stay in current class"
              : entry.action === "graduate" ? "Graduate to Alumni"
                : entry.action === "unassigned" ? "Choose a destination" : [entry.toGrade, entry.toStream].filter(Boolean).join(" · ")),
            !excluded && entry.warning ? el("p", { class: "promotion-warning-tag" }, entry.warning) : null,
          ]),
          el("div", { class: "promotion-row-actions" }, [excluded ? null : edit, keep]),
        ];
        return el("tr", { class: "promotion-review-row" },
          values.map((value, index) => el("td", { "data-label": columns[index] }, value)));
      }));
      table.hidden = shown.length === 0;
      const shownRange = visible.length === 1 ? String(offset + 1) : (offset + 1) + "–" + (offset + visible.length);
      const range = shown.length ? "Showing " + shownRange + " of " + shown.length + "." : "No learners match these filters.";
      status.textContent = counts.unassigned ? range + " Resolve " + counts.unassigned + " learner(s) without a destination before continuing." : range;
      if (!counts.unassigned && !counts.moves && !counts.graduates) status.textContent += " Choose at least one learner to move or graduate.";
      pagination.hidden = lastPage === 0;
      previous.disabled = page === 0;
      following.disabled = page === lastPage;
      next.disabled = counts.unassigned > 0 || counts.moves + counts.graduates === 0;
    }

    searchBox.addEventListener("input", () => { search = searchBox.value; page = 0; renderRows(); });
    filterBox.addEventListener("change", () => { filter = filterBox.value; page = 0; renderRows(); });
    body.append(summary, controls, status, table, pagination);
    renderRows();
    return card("Review destinations", "Check each move. Use Keep for learners staying in class and Restore to bring back their reviewed destination.", "checklist", body,
      footer(actionButton("Back to Setup", () => { currentStep = 0; showStep(); }), next));
  }

  function confirm() {
    const isResume = Boolean(workspace.pendingRun);
    const rollover = savedProgress ? savedProgress.rollover : mode === "auto" ? promotionRollover(workspace.settings) : null;
    const counts = reviewSummary(plan);
    const currentPeriod = (savedProgress?.term || workspace.settings.currentTerm) + " " +
      (savedProgress?.year || workspace.settings.currentAcademicYear);
    const body = el("div", { class: "promotion-body" });
    const progressBar = el("progress", { max: savedProgress?.total || counts.moves + counts.graduates, value: savedProgress?.done || 0 });
    const progressText = el("p", { class: "text-sm", role: "status" });
    const progress = el("div", { class: "promotion-save-progress", hidden: savedProgress ? null : "" }, [progressText, progressBar]);
    const errorArea = el("div", { class: "promotion-error-area" });
    const confirmation = el("input", { type: "checkbox", id: "promotion-confirm" });
    const acknowledgement = el("label", { class: "promotion-confirm-check", for: confirmation.id }, [
      confirmation,
      rollover ? "I’ve reviewed the destinations and saved the final results for " + currentPeriod + "."
        : "I’ve reviewed the destinations and confirmed which learners will move or graduate.",
    ]);
    const back = actionButton("Back to Review", () => { currentStep = 1; showStep(); });
    const submit = actionButton(isResume ? "Resume Saving" : rollover ? "Save Promotions and Start New Year" : "Save Learner Changes", save,
      "primary", "check");
    let saving = false;
    submit.disabled = !isResume;
    confirmation.addEventListener("change", () => { submit.disabled = !confirmation.checked; });
    const actions = footer(isResume ? null : back, workspace.canSave ? submit : null);

    if (!isResume) body.append(el("div", { class: "promotion-summary-chips" }, summaries({ ...counts, warnings: 0 })));
    if (rollover) {
      body.append(notice("Academic calendar", currentPeriod + " → " + rollover.term + " " + rollover.year +
        ". Review the new term’s dates in School Settings after saving."));
    } else {
      body.append(notice("Academic calendar", currentPeriod + " stays active."));
    }
    if (!workspace.canSave) body.append(notice("Preview access", "A school administrator can save this plan."));
    else if (!isResume) body.append(acknowledgement);
    else body.append(notice("Saved progress", "Resume the previously reviewed plan. Learners already saved will stay in their new placement."));
    body.append(progress, errorArea);
    if (savedProgress) showProgress(savedProgress);

    function showProgress(result) {
      savedProgress = result;
      progress.hidden = false;
      progressBar.max = result.total;
      progressBar.value = result.done;
      progressText.textContent = result.promoted + result.graduated + " of " + result.total + " learner changes saved." +
        (result.skipped ? " " + result.skipped + " kept after review." : "");
    }

    async function save(event, approvedSkips = []) {
      if (saving) return;
      saving = true;
      const restore = busyButton(event.currentTarget, "Saving…");
      back.disabled = true;
      submit.disabled = true;
      confirmation.disabled = true;
      errorArea.replaceChildren();
      if (!runId) runId = crypto.randomUUID();
      progress.hidden = false;
      progressText.textContent = "Checking the latest learner records…";
      try {
        const result = await commitPromotionPlan(profile.uid, isResume ? null : plan, {
          runId, schoolId: workspace.schoolId, mode, settings: workspace.settings, classes: workspace.classes,
          onProgress: showProgress, approvedSkips,
        });
        wrap.replaceChildren(stepper(3), card("Promotions saved", result.rollover
          ? "The active school period is now " + result.rollover.term + " " + result.rollover.year + "."
          : "The academic calendar stayed the same.", "task_alt",
        el("div", { class: "promotion-body promotion-summary-chips" }, summaries({
          moves: result.promoted, graduates: result.graduated, retained: result.retained + result.skipped,
        })),
        footer(actionButton("View Students", () => import("../js/router.js").then(({ navigate }) => navigate("/students")), "primary"),
          actionButton("Return to Dashboard", () => import("../js/router.js").then(({ navigate }) => navigate("/dashboard"))))));
        wrap.querySelector("h2")?.focus({ preventScroll: true });
      } catch (error) {
        saving = false;
        restore();
        progressText.textContent = savedProgress
          ? savedProgress.done + " of " + savedProgress.total + " learner records processed. Your progress is saved."
          : "Check the error below before continuing.";
        const retry = actionButton("Refresh Promotions", load);
        const details = notice("Saving paused", error.message || "Try again when your connection is available.", "warning");
        details.setAttribute("role", "alert");
        if (error.conflicts?.length) {
          submit.disabled = true;
          const conflictIds = [...new Set([...approvedSkips, ...error.conflicts.map(({ id }) => id)])];
          const names = el("details", { open: "" }, [
            el("summary", {}, error.conflicts.length + " changed learner record(s)"),
            el("ul", {}, error.conflicts.map(({ name }) => el("li", {}, name))),
          ]);
          const skip = actionButton("Keep These Learners and Continue", (nextEvent) => save(nextEvent, conflictIds), "primary");
          errorArea.append(details, names, footer(retry, skip));
        } else {
          submit.disabled = false;
          errorArea.append(details, footer(retry));
        }
      }
    }

    return card(isResume ? "Resume promotions" : "Confirm changes", isResume
      ? "Continue from the last saved group of learners."
      : "Review what will be saved before applying this plan.", "verified", body, actions);
  }

  await load();
  initialLoad = false;
  return wrap;
}

export function init() {}
