import { listClasses, listSubjects, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { listAssessments, setAssessmentStatus, getAssessmentMaxScore } from "../js/services/assessment.service.js";
import { getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listMarks, upsertMark, bulkUpsertMarks } from "../js/services/marks.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];

let classes = [];
let allSubjects = [];
let allAssessments = [];
let allowedSubjectCodes = null; // null = unrestricted (admin/academic_master)
let selection = { classKey: "", subjectCode: "", assessmentId: "" };
let roster = []; // students in the selected class
let marksByStudent = {}; // studentId -> mark doc
let dirty = new Set();

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [classes, allSubjects, allAssessments] = await Promise.all([listClasses(), listSubjects(), listAssessments()]);

  allowedSubjectCodes = null;
  if (!CAN_MANAGE.includes(profile.role)) {
    const teacher = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    allowedSubjectCodes = new Set(teacher?.subjectCodes || []);
  }

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
    ])
  );

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const bodyMount = el("div", { style: "margin-top:16px;" });
  wrap.append(bodyMount);

  renderPicker(pickerCard, profile, bodyMount);
  return wrap;
}

function classOptions() {
  const opts = [];
  for (const c of classes) {
    for (const s of c.streams || []) {
      opts.push({ value: `${c.grade}|${s}`, label: `${c.grade} ${s}` });
    }
  }
  return opts;
}

function renderPicker(container, profile, bodyMount) {
  container.innerHTML = "";
  const row = el("div", { style: "display:grid; grid-template-columns: repeat(3, 1fr); gap:16px;" });

  const classSelect = el("select", { id: "m-class" }, [
    el("option", { value: "" }, "Select class"),
    ...classOptions().map((o) => el("option", { value: o.value, ...(o.value === selection.classKey ? { selected: "true" } : {}) }, o.label)),
  ]);

  const subjectChoices = allSubjects.filter((s) => !allowedSubjectCodes || allowedSubjectCodes.has(s.code));
  const subjectSelect = el("select", { id: "m-subject" }, [
    el("option", { value: "" }, "Select subject"),
    ...subjectChoices.map((s) => el("option", { value: s.code, ...(s.code === selection.subjectCode ? { selected: "true" } : {}) }, s.name)),
  ]);

  const assessmentSelect = el("select", { id: "m-assessment" }, [el("option", { value: "" }, "Select assessment")]);

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Class"), classSelect]),
    el("div", { class: "field" }, [el("label", {}, "Subject"), subjectSelect]),
    el("div", { class: "field" }, [el("label", {}, "Assessment"), assessmentSelect])
  );
  container.append(row);

  if (!subjectChoices.length) {
    container.append(el("p", { class: "text-muted" }, "You have no subjects assigned. Contact the administrator."));
  }

  function refreshAssessmentOptions() {
    const grade = classSelect.value.split("|")[0] || "";
    const subjectCode = subjectSelect.value || "";
    assessmentSelect.innerHTML = "";
    assessmentSelect.append(el("option", { value: "" }, "Select assessment"));
    const relevant = allAssessments.filter(
      (a) =>
        (!grade || !a.grades?.length || a.grades.includes(grade)) &&
        (!subjectCode || !a.subjects?.length || a.subjects.includes(subjectCode))
    );
    if (selection.assessmentId && !relevant.some((a) => a.id === selection.assessmentId)) {
      selection.assessmentId = "";
    }
    for (const a of relevant) {
      assessmentSelect.append(
        el("option", { value: a.id, ...(a.id === selection.assessmentId ? { selected: "true" } : {}) },
          `${a.name} (${a.term || "N/A"} ${a.academicYear || ""})${a.status === "locked" ? ": locked" : ""}`)
      );
    }
  }
  refreshAssessmentOptions();

  // If a class/subject/assessment was already selected from a previous
  // visit to this page (selection is retained in module state, and the
  // selects above are pre-populated with `selected` from it), the initial
  // mount used to sit there with an empty bodyMount until the person
  // touched a dropdown - because maybeLoad() below only ever ran inside a
  // `change` listener, which never fires just from setting the `selected`
  // attribute at render time. Re-picking the exact same value doesn't fire
  // `change` either, so the roster never loaded until a genuinely
  // different value was chosen. Explicitly load once here for a selection
  // that's already complete.
  if (selection.classKey && selection.subjectCode && selection.assessmentId) {
    maybeLoad(profile, bodyMount);
  }

  classSelect.addEventListener("change", () => { selection.classKey = classSelect.value; refreshAssessmentOptions(); maybeLoad(profile, bodyMount); });
  subjectSelect.addEventListener("change", () => { selection.subjectCode = subjectSelect.value; refreshAssessmentOptions(); maybeLoad(profile, bodyMount); });
  assessmentSelect.addEventListener("change", () => { selection.assessmentId = assessmentSelect.value; maybeLoad(profile, bodyMount); });
}

async function maybeLoad(profile, bodyMount) {
  const { classKey, subjectCode, assessmentId } = selection;
  if (!classKey || !subjectCode || !assessmentId) {
    bodyMount.innerHTML = "";
    return;
  }
  const [grade, stream] = classKey.split("|");
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
  ]));

  const [students, marks] = await Promise.all([listStudents(), listMarks(assessmentId, subjectCode)]);
  roster = students.filter((s) => s.grade === grade && s.stream === stream && s.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  marksByStudent = {};
  for (const m of marks) marksByStudent[m.studentId] = m;
  dirty.clear();

  renderRoster(bodyMount, profile);
}

function renderRoster(container, profile) {
  container.innerHTML = "";
  const assessment = allAssessments.find((a) => a.id === selection.assessmentId);
  const subject = allSubjects.find((s) => s.code === selection.subjectCode);
  const locked = assessment?.status === "locked";
  const canManage = CAN_MANAGE.includes(profile.role);

  const maxScore = getAssessmentMaxScore(assessment, selection.subjectCode);
  const isDirect = (assessment?.contributionMode || "weighted") === "direct";
  const infoCard = el("div", { class: "card", style: "margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" });
  infoCard.append(
    el("div", {}, [
      el("h3", { style: "margin:0 0 4px;" }, `${assessment?.name || ""}: ${subject?.name || ""}`),
      el("p", { class: "text-muted", style: "margin:0;" },
        isDirect
          ? `Added directly · Marked out of ${maxScore} · ${roster.length} student(s)`
          : `Weight ${assessment?.weight ?? "N/A"}% · Marked out of ${maxScore} · ${roster.length} student(s)`),
    ])
  );
  const actions = el("div", { style: "display:flex; gap:8px; align-items:center;" });
  actions.append(el("span", { class: `badge badge--${locked ? "danger" : "success"}` }, locked ? "Locked" : "Open"));
  if (canManage) {
    actions.append(
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => toggleLock(profile, assessment, container) }, [icon(locked ? "lock_open" : "lock"), locked ? "Reopen" : "Lock"]),
    );
  }
  if (!locked) {
    actions.append(
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => openBulkPaste(container) }, [icon("content_paste"), "Paste bulk scores"]),
      el("button", { class: "btn btn--primary btn--sm", onClick: (e) => saveAllDirty(profile, container, e.currentTarget) }, [icon("save"), "Save All"]),
    );
  }
  infoCard.append(actions);
  container.append(infoCard);

  if (!roster.length) {
    container.append(el("div", { class: "empty-state" }, [
      icon("groups", "empty-state__icon"),
      el("h3", {}, "No active students in this class"),
      el("p", {}, "Check the class roster under Students."),
    ]));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, `Score (out of ${maxScore})`), el("th", {}, isDirect ? "Added" : "%"), el("th", {}, "Status"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const student of roster) {
    const existing = marksByStudent[student.id];
    const input = el("input", {
      type: "number", min: "0", max: String(maxScore), step: "0.5",
      "data-student-id": student.id,
      value: existing?.score ?? "",
      class: "input-native input-native--score",
      ...(locked ? { disabled: "true" } : {}),
    });
    const formatHint = (score) => (isDirect ? `+${Number(score).toFixed(1)}` : `${((Number(score) / maxScore) * 100).toFixed(1)}%`);
    const pctCell = el("span", { class: "text-muted", id: `pct-${student.id}` }, existing != null ? formatHint(existing.score) : "—");
    const statusCell = el("span", { class: `badge badge--${existing ? "success" : "muted"}`, id: `status-${student.id}` }, existing ? "Saved" : "Not entered");

    input.addEventListener("input", () => {
      dirty.add(student.id);
      statusCell.className = "badge badge--gold";
      statusCell.textContent = "Unsaved";
      const n = Number(input.value);
      pctCell.textContent = input.value !== "" && !Number.isNaN(n) ? formatHint(n) : "—";
    });
    input.addEventListener("change", async () => {
      await saveOne(profile, student, input, statusCell, maxScore);
    });

    tbody.append(el("tr", {}, [
      el("td", {}, student.admissionNumber || "N/A"),
      el("td", {}, student.fullName),
      el("td", {}, input),
      el("td", {}, pctCell),
      el("td", {}, statusCell),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

async function saveOne(profile, student, input, statusCell, maxScore) {
  const [grade, stream] = selection.classKey.split("|");
  try {
    await upsertMark(profile.uid, {
      assessmentId: selection.assessmentId,
      subjectCode: selection.subjectCode,
      studentId: student.id,
      grade, stream,
      score: input.value,
      maxScore,
    });
    dirty.delete(student.id);
    statusCell.className = "badge badge--success";
    statusCell.textContent = "Saved";
  } catch (err) {
    statusCell.className = "badge badge--danger";
    statusCell.textContent = "Error";
    toast(`${student.fullName}: ${err.message}`, "error");
  }
}

async function saveAllDirty(profile, container, button) {
  if (!dirty.size) return toast("Nothing to save - every score is already saved.", "info");
  const restore = button ? busyButton(button, "Saving…") : () => {};
  const [grade, stream] = selection.classKey.split("|");
  const assessment = allAssessments.find((a) => a.id === selection.assessmentId);
  const maxScore = getAssessmentMaxScore(assessment, selection.subjectCode);
  const entries = [];
  for (const studentId of dirty) {
    const input = container.querySelector(`input[data-student-id="${studentId}"]`);
    if (input) entries.push({ studentId, grade, stream, score: input.value, maxScore });
  }
  try {
    const results = await bulkUpsertMarks(profile.uid, selection.assessmentId, selection.subjectCode, entries);
    toast(`Saved ${results.saved} score(s).${results.failed.length ? ` ${results.failed.length} failed - check highlighted rows.` : ""}`, results.failed.length ? "error" : "success");
    await maybeLoad(profile, container);
  } finally {
    restore();
  }
}

function openBulkPaste(container) {
  const assessment = allAssessments.find((a) => a.id === selection.assessmentId);
  const maxScore = getAssessmentMaxScore(assessment, selection.subjectCode);
  const isDirect = (assessment?.contributionMode || "weighted") === "direct";
  const body = el("form", {});
  body.append(
    el("p", { class: "text-muted" },
      isDirect
        ? `One student per line: admission number, then raw score out of ${maxScore} (comma or space separated). This assessment adds its score straight onto the subject total. Values fill the table below - review, then click Save All.`
        : `One student per line: admission number, then raw score out of ${maxScore} (comma or space separated). Values fill the table below and convert to % automatically - review, then click Save All.`),
    el("textarea", { id: "bulk-text", rows: "10", style: "width:100%; padding:8px; border:1px solid var(--color-line); border-radius:6px; font-family:monospace;", placeholder: "ADM001, 87\nADM002, 92" }),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("table_chart"), "Fill table"])
  );
  const close = openModal("Paste Bulk Scores", body);
  body.addEventListener("submit", (e) => {
    e.preventDefault();
    const lines = document.getElementById("bulk-text").value.split("\n").map((l) => l.trim()).filter(Boolean);
    let filled = 0;
    for (const line of lines) {
      const parts = line.split(/[, \t]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const [admNo, score] = parts;
      const student = roster.find((s) => (s.admissionNumber || "").toLowerCase() === admNo.toLowerCase());
      if (!student) continue;
      const input = container.querySelector(`input[data-student-id="${student.id}"]`);
      if (input) {
        input.value = score;
        input.dispatchEvent(new Event("input"));
        filled += 1;
      }
    }
    toast(`Filled ${filled} of ${lines.length} row(s). Review and click Save All to store them.`, filled ? "success" : "error");
    close();
  });
}

async function toggleLock(profile, assessment, container) {
  const next = assessment.status === "locked" ? "open" : "locked";
  try {
    await setAssessmentStatus(profile.uid, assessment.id, next);
    assessment.status = next;
    toast(`${assessment.name} ${next === "locked" ? "locked" : "reopened"}.`, "success");
    allAssessments = await listAssessments();
    renderRoster(container, profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
  }
}

export function init() {}