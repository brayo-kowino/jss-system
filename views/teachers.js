import { listTeachers, createTeacher, updateTeacher, assignSubjects, assignClasses, setTeacherStatus } from "../js/services/teacher.service.js";
import { listSubjects, listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { createUserAccount } from "../js/services/auth.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

let teachers = [];
let subjects = [];
let classes = [];

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [teachers, subjects, classes] = await Promise.all([listTeachers(), listSubjects(), listClasses()]);

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("p", {}, `${teachers.length} on staff`)]),
      el("button", { class: "btn btn--primary", id: "new-teacher-btn" }, [icon("person_add"), "Add Teacher"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile);

  setTimeout(() => {
    document.getElementById("new-teacher-btn")?.addEventListener("click", () => openTeacherForm(profile));
  });

  return wrap;
}

function renderTable(container, profile) {
  if (!teachers.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      icon("person", "empty-state__icon"),
      el("h3", {}, "No teachers yet"),
      el("p", {}, "Click '+ Add Teacher' to register your first staff member."),
    ]));
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Name"), el("th", {}, "TSC No."), el("th", {}, "Subjects"),
      el("th", {}, "Classes"), el("th", {}, "Status"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const t of teachers) {
    const subjNames = (t.subjectCodes || []).map((c) => subjects.find((s) => s.code === c)?.name).filter(Boolean).join(", ");
    const classNames = (t.classAssignments || []).map((a) => `${a.grade} ${a.stream}`).join(", ");
    tbody.append(el("tr", {}, [
      el("td", {}, t.fullName),
      el("td", { class: "numeric" }, t.tscNumber || "N/A"),
      el("td", {}, subjNames || el("span", { class: "text-muted" }, "None")),
      el("td", {}, classNames || el("span", { class: "text-muted" }, "None")),
      el("td", {}, el("span", { class: `badge badge--${t.status === "active" ? "success" : "muted"}` }, t.status || "active")),
      el("td", {}, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openTeacherForm(profile, t) }, [icon("edit"), "Edit"]),
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => toggleStatus(profile, t) }, [icon(t.status === "active" ? "pause_circle" : "restart_alt"), t.status === "active" ? "Suspend" : "Reinstate"]),
      ]),
    ]));
  }
  table.append(tbody);
  container.innerHTML = "";
  container.append(table);
}

async function toggleStatus(profile, teacher) {
  const next = teacher.status === "active" ? "suspended" : "active";
  await setTeacherStatus(profile.uid, teacher.id, next);
  toast(`${teacher.fullName} marked ${next}.`, "success");
  await refresh(profile);
}

async function refresh(profile) {
  teachers = await listTeachers();
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile);
}

function openTeacherForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});

  const subjectChecklist = el("div", { class: "checklist" });
  const selectedSubjects = new Set(existing?.subjectCodes || []);
  for (const s of subjects) {
    const checkbox = el("input", { type: "checkbox", value: s.code, ...(selectedSubjects.has(s.code) ? { checked: "true" } : {}) });
    subjectChecklist.append(el("label", { class: "checklist-item" }, [checkbox, s.name]));
  }

  const classChecklist = el("div", { class: "checklist" });
  const selectedClasses = new Set((existing?.classAssignments || []).map((a) => `${a.grade}|${a.stream}`));
  for (const c of classes) {
    for (const stream of c.streams || []) {
      const key = `${c.grade}|${stream}`;
      const checkbox = el("input", { type: "checkbox", value: key, ...(selectedClasses.has(key) ? { checked: "true" } : {}) });
      classChecklist.append(el("label", { class: "checklist-item" }, [checkbox, `${c.grade} ${stream}`]));
    }
  }

  body.append(
    field("t-fullName", "Full Name", existing?.fullName),
    field("t-teacherNumber", "Teacher Number", existing?.teacherNumber),
    field("t-tscNumber", "TSC Number", existing?.tscNumber),
    field("t-phone", "Phone", existing?.phone),
    field("t-email", "Email", existing?.email, "email"),
    el("div", { class: "field" }, [el("label", {}, "Subjects Taught"), subjectChecklist]),
    el("div", { class: "field" }, [el("label", {}, "Classes Assigned"), classChecklist]),
  );

  if (!isEdit) {
    body.append(
      el("div", { class: "field" }, [
        el("label", {}, "Temporary Login Password"),
        el("input", { id: "t-temppass", type: "text", placeholder: "Leave blank to skip creating a login for now" }),
      ])
    );
  }

  body.append(el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "person_add"), isEdit ? "Save changes" : "Add teacher"]));

  const close = openModal(isEdit ? `Edit: ${existing.fullName}` : "Add Teacher", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    const subjectCodes = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const classAssignments = Array.from(classChecklist.querySelectorAll("input:checked")).map((c) => {
      const [grade, stream] = c.value.split("|");
      return { grade, stream };
    });
    const data = {
      fullName: val("t-fullName"),
      teacherNumber: val("t-teacherNumber"),
      tscNumber: val("t-tscNumber"),
      phone: val("t-phone"),
      email: val("t-email"),
      subjectCodes,
      classAssignments,
    };
    try {
      if (isEdit) {
        await updateTeacher(profile.uid, existing.id, data);
        toast("Teacher updated.", "success");
      } else {
        const teacherId = await createTeacher(profile.uid, data);
        const tempPass = document.getElementById("t-temppass")?.value.trim();
        if (tempPass && data.email) {
          const role = classAssignments.length ? "class_teacher" : "subject_teacher";
          const uid = await createUserAccount({ fullName: data.fullName, email: data.email, role, tempPassword: tempPass });
          await updateTeacher(profile.uid, teacherId, { userId: uid });
          toast("Teacher added and login created.", "success");
        } else {
          toast("Teacher added.", "success");
        }
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save teacher.", "error");
      restore();
    }
  });
}

function field(id, label, value = "", type = "text") {
  return el("div", { class: "field" }, [el("label", { for: id }, label), el("input", { id, type, value: value || "" })]);
}
function val(id) {
  return document.getElementById(id).value.trim();
}

export function init() {}