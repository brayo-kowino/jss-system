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
let lastSavedModes = []; // listSavedModesForPeriod() result for the current selection

export async function render({ profile }) {
  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";
  // Reset every fresh visit to the page back to "Final (Average)" - a
  // Midterm-only or Endterm-only compute is a deliberate, one-off action,
  // not something that should silently carry over into the next session
  // and risk a partial result being computed/saved without anyone noticing.
  selection.reportMode = "average";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", {}, "Pick a class and term to auto-grade every subject average, then rank students within it."),
      ]),
    ])
  );

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const resultMount = el("div", { style: "margin-top:16px;" });
  wrap.append(resultMount);

  renderPicker(pickerCard, profile, resultMount);
  return wrap;
}

function gradeOptions() {
  return classes.map((c) => c.grade);
}

function renderPicker(container, profile, resultMount) {
  container.innerHTML = "";
  const row = el("div", { style: "display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; align-items:end;" });

  const gradeSelect = el("select", {}, [
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
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [el("label", {}, "Report Mode"), reportModeSelect])
  );
  container.append(row);
  container.append(
    el("p", { class: "text-muted text-sm", style: "margin:12px 0 0;" }, "Computes and saves every stream in this grade at once - there's no per-stream step. Pick a stream to view on the Report Cards page afterwards."),
  );
  container.append(
    el("div", { class: "filter-actions" }, [
      el("button", {
        class: "btn btn--primary",
        onClick: () => runCompute(profile, resultMount),
      }, [icon("analytics"), "Compute Results"]),
    ])
  );
}

async function runCompute(profile, resultMount) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  resultMount.innerHTML = "";
  resultMount.append(el("div", { class: "spinner-overlay" }, [
    spinner("lg", "dark"),
    el("div", {}, "Computing averages, grades, and positions…"),
  ]));
  try {
    const [result, savedModes] = await Promise.all([
      computeClassResults({ grade: selection.grade, academicYear: selection.academicYear, term: selection.term, reportMode: selection.reportMode, gradingScale: settings.gradingScale }),
      listSavedModesForPeriod(selection),
    ]);
    lastResult = result;
    lastSavedModes = savedModes;
    renderResult(resultMount, profile);
  } catch (err) {
    resultMount.innerHTML = "";
    toast(err.message || "Could not compute results.", "error");
  }
}

function renderResult(container, profile) {
  container.innerHTML = "";
  const { students, subjectsUsed, meta } = lastResult;

  // Shown even on empty/no-marks states below so it's clear this Save
  // Results click won't be the first one for this class/term if something
  // was already saved earlier (by this person or someone else).
  container.append(savedModesPanel(lastSavedModes, { activeMode: selection.reportMode }));

  if (meta.noAssessments) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No assessments found"),
      el("p", {}, `No assessments are set up for ${meta.grade} in ${meta.term} ${meta.academicYear}. Add one under Assessments first.`),
    ]));
    return;
  }
  if (meta.noStudents) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No active students"),
      el("p", {}, `No active students found in ${meta.grade}.`),
    ]));
    return;
  }
  if (!subjectsUsed.length || !students.some((s) => s.subjects.length)) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No marks entered yet"),
      el("p", {}, "Once marks are entered for at least one assessment, results will appear here."),
    ]));
    return;
  }

  const header = el("div", { class: "card", style: "margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" });
  header.append(
    el("div", {}, [
      el("h3", { style: "margin:0 0 4px;" }, [
        `${meta.grade}: ${meta.term} ${meta.academicYear}`,
        " ",
        el("span", { class: `badge ${meta.reportMode === "average" ? "badge--success" : "badge--gold"}` }, reportModeLabel(meta.reportMode)),
      ]),
      el("p", { class: "text-muted", style: "margin:0;" }, `${meta.classSize} student(s), every stream · ${subjectsUsed.length} subject(s) with marks · ${meta.assessmentsUsed} assessment(s) counted · Overall Position shown below`),
    ])
  );
  if (CAN_SAVE.includes(profile.role)) {
    header.append(
      el("button", { class: "btn btn--primary btn--sm", onClick: () => handleSave(profile, container) }, [icon("save"), "Save Results"])
    );
  }
  container.append(header);

  const mismatchedSubjects = (meta.subjectWeightTotals || []).filter((s) => s.mismatched);
  if (mismatchedSubjects.length) {
    container.append(el("div", { class: "alert alert--warning" }, [
      el("span", { class: "material-symbols-rounded" }, "warning"),
      el("div", {}, [
        el("div", { class: "alert__title" }, `${mismatchedSubjects.length} subject(s) don't add up to 100 yet`),
        el("div", { class: "alert__body" }, [
          `Each subject's weighted assessment weights plus any "Add directly" assessments' max scores should total 100 so results reflect a true final mark. Right now:`,
          el("ul", { style: "margin:6px 0 0; padding-left:20px;" }, mismatchedSubjects.map((s) => {
            const breakdown = s.assessments
              .map((a) => a.contributionMode === "direct" ? `${a.name} (${a.maxScore} direct)` : `${a.name} (${a.weight}%)`)
              .join(", ");
            return el("li", {}, `${s.name}: ${s.expectedCapacityTotal} total — ${breakdown || "no assessments set up"}.`);
          })),
          `Add assessments or fix weights/max scores under `,
          el("a", { href: "#/assessments" }, "Assessments"),
          ` so results here are complete.`,
        ]),
      ]),
    ]));
  }

  if (meta.subjectsIncomplete?.length) {
    container.append(el("div", { class: "alert alert--warning" }, [
      el("span", { class: "material-symbols-rounded" }, "hourglass_top"),
      el("div", {}, [
        el("div", { class: "alert__title" }, "Some subjects are missing marks for assessments already set up"),
        el("div", { class: "alert__body" }, meta.subjectsIncomplete.map((s) =>
          el("div", {}, `${s.name}: no marks yet for ${s.missingAssessments.join(", ")} (${s.weightMissing}% of this subject's weight)`)
        )),
      ]),
    ]));
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Pos"), el("th", {}, "Adm No."), el("th", {}, "Name"),
      el("th", {}, "Total"), el("th", {}, "Mean"), el("th", {}, "Mean Grade"),
      el("th", {}, "Total Pts"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody", {});
  const sorted = [...students].sort((a, b) => {
    if (a.overallPosition === null) return 1;
    if (b.overallPosition === null) return -1;
    return a.overallPosition - b.overallPosition;
  });
  for (const s of sorted) {
    const hasScores = s.subjects.length > 0;
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Pos" }, hasScores ? `${s.overallPosition}/${s.classSize}` : "N/A"),
      el("td", { "data-label": "Adm No." }, s.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, `${s.fullName}${s.stream ? ` (${s.stream})` : ""}`),
      el("td", { "data-label": "Total" }, hasScores ? `${s.totalMarks.toFixed(1)}/${s.totalOutOf}` : "N/A"),
      el("td", { "data-label": "Mean" }, hasScores ? `${s.meanMarks.toFixed(2)}%` : "N/A"),
      el("td", { "data-label": "Mean Grade" }, hasScores
        ? el("span", {}, [
            el("span", { class: "badge badge--gold" }, s.meanGrade),
            s.hasIncompleteSubject ? el("span", { class: "badge badge--warning", style: "margin-left:4px;", title: "Based on incomplete assessment weight for at least one subject" }, "Partial") : "",
          ])
        : "N/A"),
      el("td", { "data-label": "Total Pts" }, hasScores ? s.totalPoints : "N/A"),
      el("td", { class: "row-actions", "data-label": "Details" }, hasScores
        ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => showDetail(s, profile) }, [icon("visibility"), "View"])
        : el("span", { class: "text-muted" }, "No marks")),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

async function handleSave(profile, resultMount) {
  const incompleteCount = lastResult.students.filter((s) => s.hasIncompleteSubject).length;
  if (incompleteCount > 0) {
    const proceed = confirm(
      `${incompleteCount} student(s) have at least one subject where not all assessment weight has been marked yet, so their result is partial, not final. Save anyway?`
    );
    if (!proceed) return;
  }
  try {
    await saveResults(profile.uid, selection, lastResult.students);
    toast(`${reportModeLabel(selection.reportMode)} results saved. They're now available for report cards.`, "success");
    // Refresh the saved-so-far panel immediately so this save shows up
    // right away, instead of only after leaving and re-entering the page.
    lastSavedModes = await listSavedModesForPeriod(selection);
    renderResult(resultMount, profile);
  } catch (err) {
    toast(err.message || "Could not save results.", "error");
  }
}

async function showDetail(student, profile, isStreamPreview) {
  const body = el("div", {});
  body.append(el("div", { style: "display:flex; justify-content:space-between; margin-bottom:12px;" }, [
    el("div", {}, [
      el("div", { style: "font-weight:600;" }, student.fullName),
      el("div", { class: "text-muted text-sm" }, `Adm No. ${student.admissionNumber || "N/A"}`),
    ]),
    el("div", { style: "text-align:right;" }, [
      el("div", {}, [el("span", { class: "badge badge--success" }, `${positionScopeLabel(isStreamPreview)} ${isStreamPreview ? student.classPosition : student.overallPosition}/${isStreamPreview ? student.streamClassSize : student.classSize}`)]),
      el("div", { class: "text-muted text-sm", style: "margin-top:4px;" }, `Mean ${student.meanMarks.toFixed(2)}% · Grade ${student.meanGrade} · ${student.totalPoints} pts`),
    ]),
  ]));

  const subjTableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const showBothColumns = (selection.reportMode || "average") === "average";
  const subjTable = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject"),
      ...(showBothColumns ? [el("th", {}, "Midt"), el("th", {}, "End")] : []),
      el("th", {}, "Score"), el("th", {}, "Grade"), el("th", {}, "Pts"), el("th", {}, "Position"), el("th", {}, "Weight Marked"),
    ])),
  ]);
  const subjBody = el("tbody", {});
  for (const s of [...student.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    subjBody.append(el("tr", {}, [
      el("td", { "data-label": "Subject" }, s.name),
      ...(showBothColumns ? [
        el("td", { "data-label": "Midt" }, s.midtScore == null ? el("span", { class: "text-muted" }, "—") : s.midtScore.toFixed(1)),
        el("td", { "data-label": "End" }, s.endScore == null ? el("span", { class: "text-muted" }, "—") : s.endScore.toFixed(1)),
      ] : []),
      el("td", { "data-label": "Score" }, s.average.toFixed(1)),
      el("td", { "data-label": "Grade" }, s.grade),
      el("td", { "data-label": "Pts" }, String(s.points)),
      el("td", { "data-label": "Position" }, isStreamPreview ? `${s.classPosition}/${student.streamClassSize}` : `${s.position}/${student.classSize}`),
      el("td", { "data-label": "Weight Marked" }, s.incomplete
        ? el("span", { class: "badge badge--warning", title: "Not all assessments for this subject have marks yet" }, `${s.weightUsed}% of ${s.weightExpected}%`)
        : el("span", { class: "badge badge--success" }, "Complete")),
    ]));
  }
  subjTable.append(subjBody);
  subjTableWrap.append(subjTable);
  body.append(subjTableWrap);

  body.append(el("h3", { style: "margin:20px 0 8px;" }, "Pathway Performance"));
  const pathWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const pathTable = el("table", {}, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Pathway"), el("th", {}, "Points"), el("th", {}, "Percentage")])),
  ]);
  const pathBody = el("tbody", {});
  for (const p of student.pathwayBreakdown) {
    pathBody.append(el("tr", {}, [
      el("td", { "data-label": "Pathway" }, p.pathway),
      el("td", { "data-label": "Points" }, String(p.points)),
      el("td", { "data-label": "Percentage" }, `${p.percentage.toFixed(1)}%`),
    ]));
  }
  pathTable.append(pathBody);
  pathWrap.append(pathTable);
  body.append(pathWrap);

  const devMount = el("div", { style: "margin-top:16px;" }, el("p", { class: "text-muted text-sm" }, "Checking previous term for comparison…"));
  body.append(devMount);

  openModal(`Results: ${student.fullName}`, body);

  try {
    const prev = await getPreviousResult(student.studentId, selection.grade, selection.academicYear, selection.term, settings.terms, selection.reportMode);
    devMount.innerHTML = "";
    if (!prev) {
      devMount.append(el("p", { class: "text-muted text-sm" }, "No saved result from a prior term to compare against yet."));
      return;
    }
    const devMarks = student.meanMarks - prev.meanMarks;
    const devPoints = student.totalPoints - prev.totalPoints;
    const prevPos = isStreamPreview ? prev.classPosition : prev.overallPosition;
    const prevSize = isStreamPreview ? prev.streamClassSize : prev.classSize;
    devMount.append(
      el("h3", { style: "margin:0 0 8px;" }, "Compared to Last Term"),
      el("p", { class: "text-sm" }, [
        `${prev.term} ${prev.academicYear}: mean ${prev.meanMarks.toFixed(2)}% (${prev.meanGrade}), ${prev.totalPoints} pts, ${positionScopeLabel(isStreamPreview).toLowerCase()} ${prevPos}/${prevSize}. `,
        el("span", { class: `badge ${devMarks >= 0 ? "badge--success" : "badge--danger"}` }, `${devMarks >= 0 ? "▲" : "▼"} ${Math.abs(devMarks).toFixed(2)} marks`),
        " ",
        el("span", { class: `badge ${devPoints >= 0 ? "badge--success" : "badge--danger"}` }, `${devPoints >= 0 ? "▲" : "▼"} ${Math.abs(devPoints)} pts`),
      ])
    );
  } catch {
    devMount.innerHTML = "";
  }
}

export function init() {}