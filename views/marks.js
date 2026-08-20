import { listClasses, listSubjects, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { listAssessments, setAssessmentStatus, getAssessmentMaxScore } from "../js/services/assessment.service.js";
import { getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listMarks, bulkUpsertMarks } from "../js/services/marks.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];

let classes = [];
let allSubjects = [];
let allAssessments = [];
let allowedSubjectCodes = null; // null = unrestricted (admin/academic_master)
let selection = { classKey: "", subjectCode: "", assessmentId: "" };
// Which class/subject/assessment the currently-loaded roster (and
// whatever is in `dirty`) actually belongs to. Kept separate from
// `selection` above - that one flips to the *next* picked value the
// moment a dropdown changes, before maybeLoad() has swapped the roster
// out, so anything trying to flush leftover dirty scores needs this
// snapshot to attribute them to the right assessment/subject instead of
// whatever was just picked.
let loadedSelection = { classKey: "", subjectCode: "", assessmentId: "" };
let roster = []; // students in the selected class
let marksByStudent = {}; // studentId -> mark doc
let dirty = new Set();
// Latest value typed for each dirty student, captured straight from the
// `input` listener below. The auto-save loop reads from here rather than
// re-querying the DOM, so a pending edit still gets flushed to Firestore
// even if the roster table has since been re-rendered or the person has
// navigated to a different page while the timer keeps ticking in the
// background.
let pendingValues = {};
// The signed-in user, captured on every render() so the background
// auto-save loop (started once, see startAutoSaveLoop below) always has
// a `uid` to attribute writes to without needing its own profile plumbing.
let currentProfile = null;

const AUTO_SAVE_INTERVAL_MS = 7000; // 5-10s per spec
let autoSaveTimer = null;
let autoSaveToastShown = false; // avoid re-toasting the same error every tick

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  currentProfile = profile;
  startAutoSaveLoop();
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
  const row = el("div", { class: "filter-grid" });

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
  // Flush any unsaved edits from whatever was previously loaded before
  // swapping the roster out from under them - otherwise picking a
  // different class/subject/assessment would silently discard scores
  // that hadn't been picked up by the auto-save loop yet.
  await flushDirtyMarks();

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
  pendingValues = {};
  loadedSelection = { classKey, subjectCode, assessmentId };

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
      el("button", { class: "btn btn--primary btn--sm", onClick: (e) => saveAllDirty(profile, e.currentTarget) }, [icon("save"), "Save All"]),
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

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, `Score (out of ${maxScore})`), el("th", {}, isDirect ? "Added" : "%"), el("th", {}, "Status"),
    ])),
  ]);
  const scoreLabel = `Score /${maxScore}`;
  const pctLabel = isDirect ? "Added" : "%";
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
      pendingValues[student.id] = input.value;
      statusCell.className = "badge badge--gold";
      statusCell.textContent = "Unsaved";
      const n = Number(input.value);
      pctCell.textContent = input.value !== "" && !Number.isNaN(n) ? formatHint(n) : "—";
    });

    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Adm No." }, student.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, student.fullName),
      el("td", { "data-label": scoreLabel }, input),
      el("td", { "data-label": pctLabel }, pctCell),
      el("td", { "data-label": "Status" }, statusCell),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

// ---------------------------------------------------------- auto-save --
//
// Replaces the old per-cell `change` listener (one Firestore write per
// blur) with a single background loop that periodically flushes whatever
// is in `dirty` via one bulkUpsertMarks() call. Started once (guarded
// below) and left running for the life of the page/tab rather than
// stopped on navigation, so an edit made just before switching pages
// still gets saved instead of silently lost - the loop is a no-op
// (skips the network entirely) whenever `dirty` is empty, so idling on
// another page costs nothing.
function startAutoSaveLoop() {
  if (autoSaveTimer) return; // already running - render() can be called
                              // again on repeat visits to /marks
  autoSaveTimer = setInterval(() => {
    flushDirtyMarks().catch(() => {}); // flushDirtyMarks handles its own errors
  }, AUTO_SAVE_INTERVAL_MS);
}

async function flushDirtyMarks() {
  if (!dirty.size || !currentProfile) return;
  // Attribute to whatever roster is actually loaded, not `selection` -
  // which may have already moved on to the next dropdown pick (see
  // maybeLoad()'s call to this function before it swaps the roster out).
  const { classKey, subjectCode, assessmentId } = loadedSelection;
  if (!classKey || !subjectCode || !assessmentId) return;

  const assessment = allAssessments.find((a) => a.id === assessmentId);
  if (assessment?.status === "locked") return; // nothing to do until reopened

  const [grade, stream] = classKey.split("|");
  const maxScore = getAssessmentMaxScore(assessment, subjectCode);
  const ids = Array.from(dirty).filter((id) => pendingValues[id] !== undefined);
  if (!ids.length) return;

  for (const id of ids) markBadge(id, "badge--muted", "Saving…");

  try {
    const entries = ids.map((studentId) => ({ studentId, grade, stream, score: pendingValues[studentId], maxScore }));
    const results = await bulkUpsertMarks(currentProfile.uid, assessmentId, subjectCode, entries);
    const failedIds = new Set((results.failed || []).map((f) => f.studentId));
    for (const id of ids) {
      if (failedIds.has(id)) {
        markBadge(id, "badge--danger", "Retry pending");
        continue; // leave in `dirty` - picked up again next tick
      }
      dirty.delete(id);
      delete pendingValues[id];
      markBadge(id, "badge--success", "Saved");
    }
    autoSaveToastShown = false; // a later real failure should toast again
  } catch (err) {
    // Whole-batch failure (e.g. offline, or the assessment got locked
    // mid-flight) - leave everything dirty for the next tick and surface
    // it once rather than spamming a toast every 7 seconds.
    for (const id of ids) markBadge(id, "badge--danger", "Retry pending");
    if (!autoSaveToastShown) {
      autoSaveToastShown = true;
      toast(err.message || "Couldn't save some scores - will retry automatically.", "error");
    }
  }
}

function markBadge(studentId, className, text) {
  const badge = document.getElementById(`status-${studentId}`);
  if (!badge) return; // person has navigated away or re-picked a class -
                       // the save above still happened, just nothing to update
  badge.className = `badge ${className}`;
  badge.textContent = text;
}

// Manual "Save All" button - an explicit user action, so it's fine for
// this one to hit the network immediately rather than waiting for the
// next auto-save tick. Reuses flushDirtyMarks() so there's exactly one
// place that knows how to write marks, instead of two save paths that
// could drift apart.
async function saveAllDirty(profile, button) {
  if (!dirty.size) return toast("Nothing to save - every score is already saved.", "info");
  const restore = button ? busyButton(button, "Saving…") : () => {};
  const before = dirty.size;
  try {
    await flushDirtyMarks();
    const saved = before - dirty.size;
    toast(
      saved === before
        ? `Saved ${saved} score(s).`
        : `Saved ${saved} of ${before} score(s) - ${before - saved} failed, will retry automatically.`,
      saved === before ? "success" : "error"
    );
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