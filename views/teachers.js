import { listTeachers, createTeacher, updateTeacher, setTeacherStatus } from "../js/services/teacher.service.js";
import { listSubjects, listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { createUserAccount, listSchoolUsers, setUserStatus, ROLES } from "../js/services/auth.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

// Roles that can hold a system login at all, in the order they're offered.
// Anyone not in this list (parent/student/admin/super_admin) isn't managed
// from this page - admin accounts are created once, at school setup, by
// the platform super_admin (see createSchool in school.service.js).
const STAFF_LOGIN_ROLES = ["class_teacher", "subject_teacher", "academic_master", "principal", "deputy_principal", "bursar", "registrar"];

// Which of those roles actually teach and so carry a linked `teachers` doc
// (subjects/classes/TSC number). The rest (principal, deputy_principal,
// bursar, registrar) are logins only - no teaching-record fields at all.
const TEACHING_ROLES = ["class_teacher", "subject_teacher", "academic_master"];

// Mirrors firestore.rules' users/{uid} create clause: admin can create a
// login for any staff role, principal only for class_teacher/subject_teacher.
// Kept here (rather than just letting a denied write happen) so the Role
// dropdown never offers an option that would fail on save.
const CREATABLE_ROLES_BY_CREATOR = {
  admin: STAFF_LOGIN_ROLES,
  principal: ["class_teacher", "subject_teacher"],
};

function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role;
}

let activeTab = "logins"; // "logins" | "roster"
let teachers = [];
let subjects = [];
let classes = [];
let staffUsers = [];

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  const [t, s, c, u] = await Promise.all([listTeachers(), listSubjects(), listClasses(), listSchoolUsers()]);
  teachers = t; subjects = s; classes = c; staffUsers = u;

  const wrap = el("div", {});
  buildShell(wrap, profile);
  return wrap;
}

export function init() {}

function buildShell(wrap, profile) {
  wrap.innerHTML = "";
  wrap.append(
    el("div", { class: "page-tabs" }, [
      tabButton("logins", "badge", "System Logins", wrap, profile),
      tabButton("roster", "groups", "Teaching Staff", wrap, profile),
    ])
  );
  const panel = el("div", {});
  wrap.append(panel);
  renderPanel(panel, profile);
}

function tabButton(id, iconName, label, wrap, profile) {
  const btn = el(
    "button",
    { class: `profile-tab${activeTab === id ? " profile-tab--active" : ""}` },
    [el("span", { class: "material-symbols-rounded" }, iconName), label]
  );
  btn.addEventListener("click", () => {
    if (activeTab === id) return;
    activeTab = id;
    buildShell(wrap, profile);
  });
  return btn;
}

function renderPanel(panel, profile) {
  panel.innerHTML = "";
  if (activeTab === "logins") renderLoginsTab(panel, profile);
  else renderRosterTab(panel, profile);
}

function refreshPanel(profile) {
  const panel = document.querySelector(".page-tabs")?.parentElement?.children?.[1];
  if (panel) renderPanel(panel, profile);
}

async function refreshAll(profile) {
  const [t, u] = await Promise.all([listTeachers(), listSchoolUsers()]);
  teachers = t; staffUsers = u;
  refreshPanel(profile);
}

// ============================================================ Logins tab ==

function renderLoginsTab(container, profile) {
  const logins = staffUsers.filter((u) => STAFF_LOGIN_ROLES.includes(u.role));

  container.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("p", {}, `${logins.length} staff with a system login`)]),
      el("button", { class: "btn btn--primary", id: "new-login-btn" }, [icon("person_add"), "Create Login"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap" });
  container.append(tableWrap);

  if (!logins.length) {
    tableWrap.append(el("div", { class: "empty-state" }, [
      icon("badge", "empty-state__icon"),
      el("h3", {}, "No staff logins yet"),
      el("p", {}, "Create a login for a class teacher, principal, bursar, or any other staff role that needs to sign in."),
    ]));
  } else {
    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Name"), el("th", {}, "Email"), el("th", {}, "Role"),
        el("th", {}, "Teaching Record"), el("th", {}, "Status"), el("th", {}, "Actions"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const u of logins) {
      const linkedTeacher = TEACHING_ROLES.includes(u.role) ? teachers.find((t) => t.userId === u.uid) : null;
      const actions = [];
      if (TEACHING_ROLES.includes(u.role) && linkedTeacher) {
        actions.push(el("button", { class: "btn btn--ghost btn--sm", onClick: () => openAssignmentModal(profile, linkedTeacher) }, [icon("edit"), "Edit assignment"]));
      }
      // Only admin can write to another user's login doc (firestore.rules
      // restricts users/{uid} update to admin, not principal) - hiding this
      // for principal avoids an action that would just fail on click.
      if (profile.role === "admin") {
        actions.push(el("button", {
          class: "btn btn--ghost btn--sm",
          onClick: () => toggleLoginStatus(profile, u),
        }, [icon(u.status === "suspended" ? "restart_alt" : "pause_circle"), u.status === "suspended" ? "Reinstate" : "Suspend"]));
      }
      tbody.append(el("tr", {}, [
        el("td", {}, u.fullName || "—"),
        el("td", {}, u.email || "—"),
        el("td", {}, roleLabel(u.role)),
        el("td", {}, linkedTeacher ? linkedTeacher.fullName : (TEACHING_ROLES.includes(u.role) ? el("span", { class: "text-muted" }, "Not linked") : el("span", { class: "text-muted" }, "—"))),
        el("td", {}, el("span", { class: `badge badge--${u.status === "suspended" ? "muted" : "success"}` }, u.status === "suspended" ? "Suspended" : "Active")),
        el("td", {}, actions),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  setTimeout(() => {
    document.getElementById("new-login-btn")?.addEventListener("click", () => openCreateLoginModal(profile));
  });
}

async function toggleLoginStatus(profile, user) {
  const next = user.status === "suspended" ? "active" : "suspended";
  try {
    await setUserStatus(profile.uid, user.uid, next);
    toast(`${user.fullName || "Login"} marked ${next}.`, "success");
    await refreshAll(profile);
  } catch (err) {
    toast(err.message || "Could not update login status.", "error");
  }
}

function openCreateLoginModal(profile, presetTeacher = null) {
  const allowedRoles = CREATABLE_ROLES_BY_CREATOR[profile.role] || [];
  if (!allowedRoles.length) {
    toast("Your account isn't permitted to create staff logins.", "error");
    return;
  }

  const unlinkedTeachers = teachers.filter((t) => !t.userId);
  const body = el("form", {});
  const fieldsMount = el("div", {});
  body.append(fieldsMount);
  body.append(el("button", { type: "submit", class: "btn btn--primary btn--block", style: "margin-top:8px;" }, [icon("person_add"), "Create Login"]));

  const close = openModal(presetTeacher ? `Create Login: ${presetTeacher.fullName}` : "Create Staff Login", body);

  // state for the dynamic middle section of the form
  let selectedRole = presetTeacher
    ? (presetTeacher.classAssignments?.length ? "class_teacher" : "subject_teacher")
    : allowedRoles[0];
  let mode = presetTeacher ? "link" : "new"; // "link" | "new" - only meaningful for teaching roles
  let linkTeacherId = presetTeacher?.id || "";

  drawFields();

  function drawFields() {
    fieldsMount.innerHTML = "";
    const roleSelect = el("select", { id: "cl-role" }, allowedRoles.map((r) => el("option", { value: r, ...(r === selectedRole ? { selected: "true" } : {}) }, roleLabel(r))));
    roleSelect.disabled = !!presetTeacher; // preset already implies class_teacher/subject_teacher
    roleSelect.addEventListener("change", () => { selectedRole = roleSelect.value; drawFields(); });
    fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Role"), roleSelect]));

    const isTeaching = TEACHING_ROLES.includes(selectedRole);

    if (isTeaching && !presetTeacher) {
      const modeSelect = el("select", { id: "cl-mode" }, [
        el("option", { value: "new", ...(mode === "new" ? { selected: "true" } : {}) }, "Create a new teacher record"),
        el("option", { value: "link", ...(mode === "link" ? { selected: "true" } : {}) }, "Link an existing teacher record (no login yet)"),
      ]);
      modeSelect.addEventListener("change", () => { mode = modeSelect.value; drawFields(); });
      fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Teacher Record"), modeSelect]));
    }

    if (isTeaching && (mode === "link" || presetTeacher)) {
      if (presetTeacher) {
        fieldsMount.append(el("p", { class: "text-muted" }, `Linking to existing record: ${presetTeacher.fullName}`));
      } else {
        if (!unlinkedTeachers.length) {
          fieldsMount.append(el("p", { class: "text-muted" }, "No teaching-staff records without a login are available to link. Add one from the Teaching Staff tab first, or create a new record here."));
        }
        const teacherSelect = el("select", { id: "cl-link-teacher" }, [
          el("option", { value: "" }, "Select teacher record"),
          ...unlinkedTeachers.map((t) => el("option", { value: t.id, ...(t.id === linkTeacherId ? { selected: "true" } : {}) }, t.fullName)),
        ]);
        teacherSelect.addEventListener("change", () => { linkTeacherId = teacherSelect.value; });
        fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Existing Teacher"), teacherSelect]));
      }
    }

    if (isTeaching && mode === "new" && !presetTeacher) {
      const subjectChecklist = el("div", { class: "checklist" });
      for (const s of subjects) {
        subjectChecklist.append(el("label", { class: "checklist-item" }, [el("input", { type: "checkbox", value: s.code, id: `cl-subj-${s.code}` }), s.name]));
      }
      const classChecklist = el("div", { class: "checklist" });
      for (const c of classes) {
        for (const stream of c.streams || []) {
          const key = `${c.grade}|${stream}`;
          classChecklist.append(el("label", { class: "checklist-item" }, [el("input", { type: "checkbox", value: key, id: `cl-class-${key}` }), `${c.grade} ${stream}`]));
        }
      }
      fieldsMount.append(
        el("div", { class: "field" }, [el("label", {}, "Full Name"), el("input", { id: "cl-fullName", type: "text" })]),
        el("div", { class: "field" }, [el("label", {}, "TSC Number"), el("input", { id: "cl-tscNumber", type: "text" })]),
        el("div", { class: "field" }, [el("label", {}, "Phone"), el("input", { id: "cl-phone", type: "text" })]),
        el("div", { class: "field" }, [el("label", {}, "Subjects Taught"), subjectChecklist]),
        el("div", { class: "field" }, [el("label", {}, "Classes Assigned"), classChecklist]),
      );
    }

    if (!isTeaching) {
      fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Full Name"), el("input", { id: "cl-fullName", type: "text" })]));
    }

    // Email is editable unless we're linking an existing teacher record,
    // where it's the login identity and should match what's on file for them.
    const presetLinkedTeacher = presetTeacher || (isTeaching && mode === "link" ? unlinkedTeachers.find((t) => t.id === linkTeacherId) : null);
    fieldsMount.append(el("div", { class: "field" }, [
      el("label", {}, "Email (used to sign in)"),
      el("input", { id: "cl-email", type: "email", value: presetLinkedTeacher?.email || "" }),
    ]));
    fieldsMount.append(el("div", { class: "field" }, [
      el("label", {}, "Temporary Password"),
      el("input", { id: "cl-temppass", type: "text", placeholder: "Given to the person to sign in with the first time" }),
    ]));
  }

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Creating…");
    try {
      const email = val("cl-email");
      const tempPass = val("cl-temppass");
      if (!email) throw new Error("Email is required.");
      if (!tempPass) throw new Error("A temporary password is required.");
      const isTeaching = TEACHING_ROLES.includes(selectedRole);

      let teacherId = null;
      if (isTeaching) {
        if (presetTeacher) {
          teacherId = presetTeacher.id;
        } else if (mode === "link") {
          if (!linkTeacherId) throw new Error("Select which teacher record to link.");
          teacherId = linkTeacherId;
        } else {
          const subjectCodes = subjects.filter((s) => document.getElementById(`cl-subj-${s.code}`)?.checked).map((s) => s.code);
          const classAssignments = [];
          for (const c of classes) {
            for (const stream of c.streams || []) {
              const key = `${c.grade}|${stream}`;
              if (document.getElementById(`cl-class-${key}`)?.checked) classAssignments.push({ grade: c.grade, stream });
            }
          }
          teacherId = await createTeacher(profile.uid, {
            fullName: val("cl-fullName"), teacherNumber: "", tscNumber: val("cl-tscNumber"),
            phone: val("cl-phone"), email, subjectCodes, classAssignments,
          });
        }
      }

      const fullName = isTeaching
        ? (presetTeacher?.fullName || (mode === "link" ? teachers.find((t) => t.id === teacherId)?.fullName : val("cl-fullName")))
        : val("cl-fullName");

      const uid = await createUserAccount({ fullName, email, role: selectedRole, tempPassword: tempPass });
      if (teacherId) await updateTeacher(profile.uid, teacherId, { userId: uid, email });

      toast("Login created.", "success");
      close();
      await refreshAll(profile);
    } catch (err) {
      toast(err.message || "Could not create login.", "error");
      restore();
    }
  });
}

function openAssignmentModal(profile, teacher) {
  const body = el("form", {});
  const subjectChecklist = el("div", { class: "checklist" });
  const selectedSubjects = new Set(teacher.subjectCodes || []);
  for (const s of subjects) {
    subjectChecklist.append(el("label", { class: "checklist-item" }, [
      el("input", { type: "checkbox", value: s.code, ...(selectedSubjects.has(s.code) ? { checked: "true" } : {}) }), s.name,
    ]));
  }
  const classChecklist = el("div", { class: "checklist" });
  const selectedClasses = new Set((teacher.classAssignments || []).map((a) => `${a.grade}|${a.stream}`));
  for (const c of classes) {
    for (const stream of c.streams || []) {
      const key = `${c.grade}|${stream}`;
      classChecklist.append(el("label", { class: "checklist-item" }, [
        el("input", { type: "checkbox", value: key, ...(selectedClasses.has(key) ? { checked: "true" } : {}) }), `${c.grade} ${stream}`,
      ]));
    }
  }
  body.append(
    el("div", { class: "field" }, [el("label", {}, "Subjects Taught"), subjectChecklist]),
    el("div", { class: "field" }, [el("label", {}, "Classes Assigned"), classChecklist]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("save"), "Save Changes"]),
  );
  const close = openModal(`Edit Assignment: ${teacher.fullName}`, body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const subjectCodes = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const classAssignments = Array.from(classChecklist.querySelectorAll("input:checked")).map((c) => {
      const [grade, stream] = c.value.split("|");
      return { grade, stream };
    });
    try {
      await updateTeacher(profile.uid, teacher.id, { subjectCodes, classAssignments });
      toast("Assignment updated.", "success");
      close();
      await refreshAll(profile);
    } catch (err) {
      toast(err.message || "Could not save assignment.", "error");
      restore();
    }
  });
}

// ============================================================ Roster tab ==
// Teaching staff who don't (yet) have a system login - a pure roster record.

function renderRosterTab(container, profile) {
  const roster = teachers.filter((t) => !t.userId);

  container.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("p", {}, `${roster.length} teaching staff without a login`)]),
      el("button", { class: "btn btn--primary", id: "new-teacher-btn" }, [icon("person_add"), "Add Teacher"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap" });
  container.append(tableWrap);

  if (!roster.length) {
    tableWrap.append(el("div", { class: "empty-state" }, [
      icon("groups", "empty-state__icon"),
      el("h3", {}, "No unlinked teaching staff"),
      el("p", {}, "Add a teacher who doesn't need to sign in, or check the System Logins tab for staff who already have one."),
    ]));
  } else {
    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Name"), el("th", {}, "TSC No."), el("th", {}, "Subjects"),
        el("th", {}, "Classes"), el("th", {}, "Status"), el("th", {}, "Actions"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const t of roster) {
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
          el("button", { class: "btn btn--ghost btn--sm", onClick: () => toggleTeacherStatus(profile, t) }, [icon(t.status === "active" ? "pause_circle" : "restart_alt"), t.status === "active" ? "Suspend" : "Reinstate"]),
          el("button", { class: "btn btn--ghost btn--sm", onClick: () => openCreateLoginModal(profile, t) }, [icon("badge"), "Create Login"]),
        ]),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  setTimeout(() => {
    document.getElementById("new-teacher-btn")?.addEventListener("click", () => openTeacherForm(profile));
  });
}

async function toggleTeacherStatus(profile, teacher) {
  const next = teacher.status === "active" ? "suspended" : "active";
  await setTeacherStatus(profile.uid, teacher.id, next);
  toast(`${teacher.fullName} marked ${next}.`, "success");
  await refreshAll(profile);
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
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "person_add"), isEdit ? "Save changes" : "Add teacher"]),
  );

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
        await createTeacher(profile.uid, data);
        toast("Teacher added.", "success");
      }
      close();
      await refreshAll(profile);
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