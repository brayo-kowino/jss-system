import { listClasses, listSubjects } from "../js/services/academic.service.js";
import { listTeachers, getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import {
  DAYS,
  listPeriods,
  seedDefaultPeriodsIfEmpty,
  addPeriod,
  updatePeriod,
  deletePeriod,
  getClassTimetable,
  getTeacherTimetable,
  assignSlot,
  clearSlot,
} from "../js/services/timetable.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];
// Only these roles ever need the *full* teacher roster (assign-slot modal's
// teacher dropdown, or the "pick any teacher" selector below) - everyone
// else only ever looks up their own linked teacher record. firestore.rules
// only lets these roles list the whole `teachers` collection; a class_teacher/
// subject_teacher/bursar/registrar calling listTeachers() gets the entire
// query denied (Firestore can't verify every doc in a multi-doc query
// satisfies an "own record" rule), which used to throw out of render()
// itself and land everyone but these roles on the generic access-denied
// error card just for opening the Timetable page.
const CAN_SEE_ALL_TEACHERS = ["admin", "academic_master", "principal", "deputy_principal"];

let classes = [];
let subjects = [];
let teachers = [];
let periods = [];
let classSelection = { grade: "", stream: "" };
let classSlots = {};
let teacherSelection = { teacherId: "" };
let teacherSlots = {};

export async function render({ profile }) {
  // Seeding writes new `periods` docs, which firestore.rules restrict to
  // canManageAcademicStructure() (admin/academic_master) - CAN_MANAGE here
  // matches that exactly. Any other role opening this page for a school
  // that hasn't been seeded yet used to hit a permission-denied write
  // before the page ever got past its first line, regardless of the
  // listTeachers() fix below. Everyone else just reads whatever periods
  // already exist (possibly none yet) instead of trying to create them.
  if (CAN_MANAGE.includes(profile.role)) {
    await seedDefaultPeriodsIfEmpty();
  }
  [classes, subjects, teachers, periods] = await Promise.all([
    listClasses(), listSubjects(), CAN_SEE_ALL_TEACHERS.includes(profile.role) ? listTeachers() : Promise.resolve([]), listPeriods(),
  ]);

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
    ])
  );

  if (CAN_MANAGE.includes(profile.role)) {
    const periodsCard = el("div", { class: "card", style: "margin-bottom:16px;" });
    wrap.append(periodsCard);
    renderPeriods(periodsCard, profile);
  }

  const classCard = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(classCard);
  const classGridMount = el("div", { style: "margin-top:16px;" });
  wrap.append(classGridMount);
  renderClassPicker(classCard, profile, classGridMount);

  const teacherCard = el("div", { class: "card" });
  wrap.append(teacherCard);
  const teacherGridMount = el("div", { style: "margin-top:16px;" });
  wrap.append(teacherGridMount);
  await renderTeacherPicker(teacherCard, profile, teacherGridMount);

  return wrap;
}

// ------------------------------------------------------------------ Periods --

function renderPeriods(container, profile) {
  container.innerHTML = "";
  container.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;" }, [
      el("h3", { style: "margin:0;" }, "Periods"),
      el("button", { class: "btn btn--primary btn--sm", onClick: () => openPeriodModal(profile, null, container) }, [icon("add"), "Add Period"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Name"), el("th", {}, "Start"), el("th", {}, "End"), el("th", {}, "Type"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const p of periods) {
    tbody.append(el("tr", {}, [
      el("td", {}, p.name),
      el("td", {}, p.startTime),
      el("td", {}, p.endTime),
      el("td", {}, el("span", { class: `badge badge--${p.isBreak ? "gold" : "muted"}` }, p.isBreak ? "Break" : "Lesson")),
      el("td", {}, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openPeriodModal(profile, p, container) }, [icon("edit"), "Edit"]),
        " ",
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => handleDeletePeriod(profile, p, container) }, [icon("delete"), "Delete"]),
      ]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function openPeriodModal(profile, existing, container) {
  const isEdit = !!existing;
  const body = el("form", {});
  const nameInput = el("input", { type: "text", value: existing?.name || "", placeholder: "e.g. Period 1" });
  const startInput = el("input", { type: "time", value: existing?.startTime || "" });
  const endInput = el("input", { type: "time", value: existing?.endTime || "" });
  const breakCheck = el("input", { type: "checkbox", ...(existing?.isBreak ? { checked: "true" } : {}) });

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Name"), nameInput]),
    el("div", { class: "field" }, [el("label", {}, "Start Time"), startInput]),
    el("div", { class: "field" }, [el("label", {}, "End Time"), endInput]),
    el("div", { class: "field" }, [
      el("label", { class: "checklist-item" }, [breakCheck, "This is a break / lunch (not a lesson)"]),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save Changes" : "Add Period"])
  );

  const close = openModal(isEdit ? `Edit ${existing.name}` : "Add Period", body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const payload = { name: nameInput.value, startTime: startInput.value, endTime: endInput.value, isBreak: breakCheck.checked };
      if (isEdit) await updatePeriod(profile.uid, existing.id, payload);
      else await addPeriod(profile.uid, payload);
      periods = await listPeriods();
      renderPeriods(container, profile);
      toast(`Period ${isEdit ? "updated" : "added"}.`, "success");
      close();
    } catch (err) {
      toast(err.message || "Could not save period.", "error");
      restore();
    }
  });
}

async function handleDeletePeriod(profile, period, container) {
  if (!confirm(`Delete "${period.name}"?`)) return;
  try {
    await deletePeriod(profile.uid, period.id);
    periods = await listPeriods();
    renderPeriods(container, profile);
    toast("Period deleted.", "success");
  } catch (err) {
    toast(err.message || "Could not delete period.", "error");
  }
}

// -------------------------------------------------------------- Class grid --

function classOptions() {
  const opts = [];
  for (const c of classes) {
    for (const s of c.streams || []) opts.push({ grade: c.grade, stream: s });
  }
  return opts;
}

function renderClassPicker(container, profile, gridMount) {
  container.innerHTML = "";
  container.append(el("h3", { style: "margin:0 0 16px;" }, "Class Timetable"));
  const opts = classOptions();
  const select = el("select", {}, [
    el("option", { value: "" }, "Select class"),
    ...opts.map((o) => el("option", { value: `${o.grade}|${o.stream}`, ...(`${o.grade}|${o.stream}` === `${classSelection.grade}|${classSelection.stream}` ? { selected: "true" } : {}) }, `${o.grade} ${o.stream}`)),
  ]);
  container.append(el("div", { class: "field", style: "max-width:320px;" }, [el("label", {}, "Class"), select]));

  select.addEventListener("change", async () => {
    const [grade, stream] = select.value.split("|");
    classSelection = { grade: grade || "", stream: stream || "" };
    await loadClassGrid(profile, gridMount);
  });
}

async function loadClassGrid(profile, gridMount) {
  if (!classSelection.grade || !classSelection.stream) {
    gridMount.innerHTML = "";
    return;
  }
  gridMount.innerHTML = "";
  gridMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "70%"),
  ]));
  classSlots = await getClassTimetable(classSelection.grade, classSelection.stream);
  renderGrid(gridMount, {
    canManage: CAN_MANAGE.includes(profile.role),
    getSlot: (day, periodId) => classSlots[`${day}_${periodId}`],
    onCellClick: (day, period) => openAssignModal(profile, day, period, gridMount),
    emptyLabel: "+ Assign",
    pillRenderer: (slot) => [el("b", {}, slot.subjectName || slot.subjectCode), el("span", {}, slot.teacherName || "Unassigned"), ...(slot.room ? [el("span", {}, `Room: ${slot.room}`)] : [])],
  });
}

function openAssignModal(profile, day, period, gridMount) {
  if (!CAN_MANAGE.includes(profile.role)) return;
  const existing = classSlots[`${day}_${period.id}`];
  const body = el("form", {});
  const subjectSelect = el("select", {}, [
    el("option", { value: "" }, "Select subject"),
    ...subjects.map((s) => el("option", { value: s.code, ...(s.code === existing?.subjectCode ? { selected: "true" } : {}) }, s.name)),
  ]);
  const teacherSelect = el("select", {}, [el("option", { value: "" }, "Select teacher")]);
  const roomInput = el("input", { type: "text", value: existing?.room || "", placeholder: "e.g. Room 12, Lab 1" });

  function refreshTeachers() {
    const code = subjectSelect.value;
    teacherSelect.innerHTML = "";
    teacherSelect.append(el("option", { value: "" }, "Select teacher"));
    for (const t of teachers.filter((t) => !code || (t.subjectCodes || []).includes(code))) {
      teacherSelect.append(el("option", { value: t.id, ...(t.id === existing?.teacherId ? { selected: "true" } : {}) }, t.fullName));
    }
  }
  refreshTeachers();
  subjectSelect.addEventListener("change", refreshTeachers);

  body.append(
    el("p", { class: "text-muted" }, `${classSelection.grade} ${classSelection.stream} · ${day} · ${period.name} (${period.startTime}–${period.endTime})`),
    el("div", { class: "field" }, [el("label", {}, "Subject"), subjectSelect]),
    el("div", { class: "field" }, [el("label", {}, "Teacher"), teacherSelect]),
    el("div", { class: "field" }, [el("label", {}, "Room (optional)"), roomInput]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(existing ? "save" : "add_task"), existing ? "Save Changes" : "Assign"])
  );

  const close = openModal("Assign Timetable Slot", body);

  if (existing) {
    body.append(el("button", {
      type: "button", class: "btn btn--ghost btn--block", style: "margin-top:8px;",
      onClick: async (e) => {
        const restore = busyButton(e.currentTarget, "Clearing…");
        try {
          await clearSlot(profile.uid, classSelection.grade, classSelection.stream, day, period.id);
          toast("Slot cleared.", "success");
          close();
          await loadClassGrid(profile, gridMount);
        } catch (err) {
          toast(err.message || "Could not clear slot.", "error");
          restore();
        }
      },
    }, [icon("backspace"), "Clear this slot"]));
  }

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const subject = subjects.find((s) => s.code === subjectSelect.value);
    const teacher = teachers.find((t) => t.id === teacherSelect.value);
    if (!subject) { restore(); return toast("Select a subject.", "error"); }
    try {
      await assignSlot(profile.uid, {
        grade: classSelection.grade,
        stream: classSelection.stream,
        day,
        periodId: period.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        teacherId: teacher?.id || "",
        teacherName: teacher?.fullName || "",
        room: roomInput.value,
      });
      toast("Timetable slot saved.", "success");
      close();
      await loadClassGrid(profile, gridMount);
    } catch (err) {
      toast(err.message || "Could not save slot - check for a conflict.", "error");
      restore();
    }
  });
}

// ------------------------------------------------------------ Teacher grid --

async function renderTeacherPicker(container, profile, gridMount) {
  container.innerHTML = "";
  container.append(el("h3", { style: "margin:0 0 16px;" }, "Teacher Timetable"));

  const canPickAny = CAN_SEE_ALL_TEACHERS.includes(profile.role);
  if (canPickAny) {
    const select = el("select", {}, [
      el("option", { value: "" }, "Select teacher"),
      ...teachers.map((t) => el("option", { value: t.id, ...(t.id === teacherSelection.teacherId ? { selected: "true" } : {}) }, t.fullName)),
    ]);
    select.addEventListener("change", async () => {
      teacherSelection.teacherId = select.value;
      await loadTeacherGrid(gridMount);
    });
    container.append(el("div", { class: "field", style: "max-width:320px;" }, [el("label", {}, "Teacher"), select]));
  } else {
    // Defensive: a permission-denied here (e.g. a teacher record whose
    // email doesn't match the signed-in account's auth-token email, some
    // other edge case the rule above doesn't cover) should degrade to the
    // "not linked" message below, not blank the whole Timetable page the
    // way an uncaught throw from render() used to.
    let own = null;
    try {
      own = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    } catch (err) {
      console.error("Could not resolve own teacher record:", err);
    }
    if (!own) {
      container.append(el("p", { class: "text-muted" }, "No teacher record is linked to your login."));
      return;
    }
    teacherSelection.teacherId = own.id;
    container.append(el("p", { class: "text-muted" }, `Showing your timetable, ${own.fullName}.`));
    await loadTeacherGrid(gridMount);
  }
}

async function loadTeacherGrid(gridMount) {
  if (!teacherSelection.teacherId) {
    gridMount.innerHTML = "";
    return;
  }
  gridMount.innerHTML = "";
  gridMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "70%"),
  ]));
  teacherSlots = await getTeacherTimetable(teacherSelection.teacherId);
  renderGrid(gridMount, {
    canManage: false,
    getSlot: (day, periodId) => teacherSlots[`${day}_${periodId}`],
    onCellClick: () => {},
    emptyLabel: "Free",
    pillRenderer: (slot) => [el("b", {}, slot.subjectName || slot.subjectCode), el("span", {}, `${slot.grade} ${slot.stream}`), ...(slot.room ? [el("span", {}, `Room: ${slot.room}`)] : [])],
  });
}

// ----------------------------------------------------------- Shared grid UI --

function renderGrid(container, { canManage, getSlot, onCellClick, emptyLabel, pillRenderer }) {
  container.innerHTML = "";
  if (!periods.length) {
    container.append(el("div", { class: "empty-state" }, [icon("schedule", "empty-state__icon"), el("p", {}, "No periods set up yet.")]));
    return;
  }

  const tableWrap = el("div", { class: "tt-scroll" });
  const table = el("table", { class: "timetable" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Period"), ...DAYS.map((d) => el("th", {}, d))])),
  ]);
  const tbody = el("tbody", {});

  for (const period of periods) {
    if (period.isBreak) {
      const row = el("tr", { class: "tt-break" });
      row.append(el("td", { class: "tt-period-col" }, [el("b", {}, period.name), `${period.startTime}–${period.endTime}`]));
      row.append(el("td", { colspan: String(DAYS.length) }, period.name));
      tbody.append(row);
      continue;
    }

    const row = el("tr", {});
    row.append(el("td", { class: "tt-period-col" }, [el("b", {}, period.name), `${period.startTime}–${period.endTime}`]));
    for (const day of DAYS) {
      const slot = getSlot(day, period.id);
      const cellWrap = el("td", { class: "tt-cell" });
      if (slot) {
        const pill = el("button", { type: "button", class: `tt-pill${canManage ? "" : " tt-pill--readonly"}` }, pillRenderer(slot));
        if (canManage) pill.addEventListener("click", () => onCellClick(day, period));
        cellWrap.append(pill);
      } else if (canManage) {
        cellWrap.append(el("button", { type: "button", class: "tt-cell__empty", onClick: () => onCellClick(day, period) }, emptyLabel));
      } else {
        cellWrap.append(el("span", { class: "tt-free" }, emptyLabel));
      }
      row.append(cellWrap);
    }
    tbody.append(row);
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

export function init() {}