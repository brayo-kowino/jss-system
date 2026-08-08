import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import {
  STATUSES,
  todayStr,
  getAttendanceForClassDate,
  saveAttendance,
  listAttendanceForClassPeriod,
  summarizeForRoster,
} from "../js/services/attendance.service.js";
import { el, icon, toast, formatDate, skeleton, busyButton } from "../js/utils.js";

const CAN_MARK_ANY_CLASS = ["admin", "principal"];

let classes = [];
let settings = null;
let allowedClassKeys = null; // null = unrestricted
let selection = { classKey: "", date: "" };
let roster = [];
let currentStatuses = {}; // studentId -> status

export async function render({ profile }) {
  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.date = selection.date || todayStr();

  allowedClassKeys = null;
  if (!CAN_MARK_ANY_CLASS.includes(profile.role)) {
    const teacher = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    allowedClassKeys = new Set((teacher?.classAssignments || []).map((a) => `${a.grade}|${a.stream}`));
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
  const summaryMount = el("div", { style: "margin-top:16px;" });
  wrap.append(summaryMount);

  renderPicker(pickerCard, profile, bodyMount, summaryMount);
  return wrap;
}

function classOptions() {
  const opts = [];
  for (const c of classes) {
    for (const s of c.streams || []) {
      const key = `${c.grade}|${s}`;
      if (allowedClassKeys && !allowedClassKeys.has(key)) continue;
      opts.push({ value: key, label: `${c.grade} ${s}` });
    }
  }
  return opts;
}

function renderPicker(container, profile, bodyMount, summaryMount) {
  container.innerHTML = "";
  const opts = classOptions();
  const row = el("div", { style: "display:grid; grid-template-columns: 1fr 1fr; gap:16px;" });

  const classSelect = el("select", { id: "a-class" }, [
    el("option", { value: "" }, "Select class"),
    ...opts.map((o) => el("option", { value: o.value, ...(o.value === selection.classKey ? { selected: "true" } : {}) }, o.label)),
  ]);
  const dateInput = el("input", { type: "date", value: selection.date, max: todayStr() });

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Class"), classSelect]),
    el("div", { class: "field" }, [el("label", {}, "Date"), dateInput])
  );
  container.append(row);

  if (!opts.length) {
    container.append(el("p", { class: "text-muted" }, "You have no class assigned. Contact the administrator."));
  }

  // Same reasoning as Marks Entry: a retained class/date from a previous
  // visit pre-fills the controls above via `selected`/`value`, but that
  // alone never fires a `change` event, so maybeLoad() (only ever called
  // from the listeners below) never ran on return - leaving the roster
  // blank until you picked a genuinely different value. Load once here
  // when the selection is already complete.
  if (selection.classKey && selection.date) {
    maybeLoad(profile, bodyMount, summaryMount);
  }

  classSelect.addEventListener("change", () => { selection.classKey = classSelect.value; maybeLoad(profile, bodyMount, summaryMount); });
  dateInput.addEventListener("change", () => { selection.date = dateInput.value; maybeLoad(profile, bodyMount, summaryMount); });
}

async function maybeLoad(profile, bodyMount, summaryMount) {
  if (!selection.classKey || !selection.date) {
    bodyMount.innerHTML = "";
    summaryMount.innerHTML = "";
    return;
  }
  const [grade, stream] = selection.classKey.split("|");
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
  ]));
  summaryMount.innerHTML = "";

  const [students, existing] = await Promise.all([
    listStudents(),
    getAttendanceForClassDate(grade, stream, selection.date),
  ]);
  roster = students.filter((s) => s.grade === grade && s.stream === stream && s.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  currentStatuses = { ...(existing?.records || {}) };

  renderRoster(bodyMount, profile);
  renderSummary(summaryMount, grade, stream);
}

function renderRoster(container, profile) {
  container.innerHTML = "";
  const [grade, stream] = selection.classKey.split("|");

  const infoCard = el("div", { class: "card", style: "margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" });
  infoCard.append(
    el("div", {}, [
      el("h3", { style: "margin:0 0 4px;" }, `${grade} ${stream}`),
      el("p", { class: "text-muted", style: "margin:0;" }, `${formatDate(selection.date)} · ${roster.length} student(s)`),
    ]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => markAll(container, "present") }, [icon("done_all"), "Mark all present"]),
      el("button", { class: "btn btn--primary btn--sm", onClick: (ev) => handleSave(profile, container, ev.currentTarget) }, [icon("save"), "Save Attendance"]),
    ])
  );
  container.append(infoCard);

  if (!roster.length) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No active students in this class"),
      el("p", {}, "Check the class roster under Students."),
    ]));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Status")])),
  ]);
  const tbody = el("tbody", {});
  for (const student of roster) {
    tbody.append(el("tr", { "data-row-for": student.id }, [
      el("td", {}, student.admissionNumber || "N/A"),
      el("td", {}, student.fullName),
      el("td", { class: "status-cell" }, buildStatusRadios(student.id)),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function buildStatusRadios(studentId) {
  const wrap = el("div", { class: "status-options", role: "radiogroup", "data-status-for": studentId });
  for (const s of STATUSES) {
    const input = el("input", {
      type: "radio",
      name: `status-${studentId}`,
      value: s.value,
      ...(currentStatuses[studentId] === s.value ? { checked: "true" } : {}),
    });
    input.addEventListener("change", () => {
      currentStatuses[studentId] = s.value;
    });
    const label = el("label", { class: `status-option status-option--${s.value}` }, [input, s.label]);
    wrap.append(label);
  }
  return wrap;
}

function markAll(container, status) {
  for (const student of roster) currentStatuses[student.id] = status;
  const rows = container.querySelectorAll("[data-status-for]");
  for (const wrap of rows) {
    for (const input of wrap.querySelectorAll("input[type=radio]")) {
      input.checked = input.value === status;
    }
  }
  toast(`Marked all ${roster.length} student(s) present. Click Save to store it.`, "info");
}

async function handleSave(profile, container, button) {
  const [grade, stream] = selection.classKey.split("|");
  const missing = roster.filter((s) => !currentStatuses[s.id]);
  if (missing.length) {
    return toast(`${missing.length} student(s) still have no status selected.`, "error");
  }
  const restore = busyButton(button, "Saving…");
  try {
    await saveAttendance(profile.uid, {
      grade,
      stream,
      date: selection.date,
      academicYear: settings.currentAcademicYear || "",
      term: settings.currentTerm || "",
      records: currentStatuses,
    });
    toast("Attendance saved.", "success");
  } catch (err) {
    toast(err.message || "Could not save attendance.", "error");
  } finally {
    restore();
  }
}

async function renderSummary(container, grade, stream) {
  container.innerHTML = "";
  const academicYear = settings.currentAcademicYear || "";
  const term = settings.currentTerm || "";
  const days = await listAttendanceForClassPeriod(grade, stream, academicYear, term);
  if (!days.length) return;

  const studentIds = roster.map((s) => s.id);
  const { daysMarked, perStudent, classAveragePercentage } = summarizeForRoster(days, studentIds);

  const card = el("div", { class: "card" });
  card.append(
    el("h3", { style: "margin:0 0 4px;" }, `${term} ${academicYear} Attendance Summary`),
    el("p", { class: "text-muted", style: "margin:0 0 16px;" },
      `${daysMarked} day(s) marked so far · class average ${classAveragePercentage ?? "N/A"}%`)
  );

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Name"), el("th", {}, "Present"), el("th", {}, "Late"), el("th", {}, "Absent"), el("th", {}, "Excused"), el("th", {}, "%"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const student of roster) {
    const s = perStudent[student.id] || {};
    tbody.append(el("tr", {}, [
      el("td", {}, student.fullName),
      el("td", {}, String(s.present ?? 0)),
      el("td", {}, String(s.late ?? 0)),
      el("td", {}, String(s.absent ?? 0)),
      el("td", {}, String(s.excused ?? 0)),
      el("td", {}, s.percentage === null || s.percentage === undefined ? "N/A" : `${s.percentage}%`),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  container.append(card);
}

export function init() {}
