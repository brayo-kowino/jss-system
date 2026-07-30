import {
  listStudents,
  registerStudent,
  updateStudent,
  transferStudent,
  promoteStudent,
  setStudentStatus,
} from "../js/services/student.service.js";
import { listParents } from "../js/services/parent.service.js";
import { listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { openModal } from "../js/components/modal.js";
import { el, toast, formatDate } from "../js/utils.js";

let students = [];
let parents = [];
let classes = [];
let filterText = "";
let filterGrade = "";
let filterStatus = "";

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [students, parents, classes] = await Promise.all([listStudents(), listParents(), listClasses()]);

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, "Students"), el("p", {}, `${students.length} registered`)]),
      el("button", { class: "btn btn--primary", id: "new-admission-btn" }, "+ New Admission"),
    ])
  );

  // Filters
  const filters = el("div", { style: "display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;" });
  const searchInput = el("input", { placeholder: "Search by name or admission no.", style: "max-width:260px;padding:10px;border:1px solid var(--color-line);border-radius:6px;" });
  const gradeSelect = el("select", { style: "padding:10px;border:1px solid var(--color-line);border-radius:6px;" }, [
    el("option", { value: "" }, "All grades"),
    ...classes.map((c) => el("option", { value: c.grade }, c.grade)),
  ]);
  const statusSelect = el("select", { style: "padding:10px;border:1px solid var(--color-line);border-radius:6px;" }, [
    el("option", { value: "" }, "All statuses"),
    el("option", { value: "active" }, "Active"),
    el("option", { value: "transferred" }, "Transferred"),
    el("option", { value: "suspended" }, "Suspended"),
    el("option", { value: "archived" }, "Archived"),
  ]);
  filters.append(searchInput, gradeSelect, statusSelect);
  wrap.append(filters);

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile);

  searchInput.addEventListener("input", (e) => {
    filterText = e.target.value.toLowerCase();
    renderTable(tableWrap, profile);
  });
  gradeSelect.addEventListener("change", (e) => {
    filterGrade = e.target.value;
    renderTable(tableWrap, profile);
  });
  statusSelect.addEventListener("change", (e) => {
    filterStatus = e.target.value;
    renderTable(tableWrap, profile);
  });

  setTimeout(() => {
    document.getElementById("new-admission-btn")?.addEventListener("click", () => openStudentForm(profile));
  });

  return wrap;
}

function renderTable(container, profile) {
  const filtered = students.filter((s) => {
    const matchesText = !filterText || `${s.fullName} ${s.admissionNumber}`.toLowerCase().includes(filterText);
    const matchesGrade = !filterGrade || s.grade === filterGrade;
    const matchesStatus = !filterStatus || s.status === filterStatus;
    return matchesText && matchesGrade && matchesStatus;
  });

  if (!filtered.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No students found"),
      el("p", {}, students.length ? "Try adjusting your filters." : "Click '+ New Admission' to register the first student."),
    ]));
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm. No."), el("th", {}, "Name"), el("th", {}, "Class"),
      el("th", {}, "Gender"), el("th", {}, "Status"), el("th", {}, "Admitted"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of filtered) {
    tbody.append(el("tr", {}, [
      el("td", { class: "numeric" }, s.admissionNumber || "—"),
      el("td", {}, s.fullName),
      el("td", {}, `${s.grade || "—"} ${s.stream || ""}`),
      el("td", {}, s.gender || "—"),
      el("td", {}, statusBadge(s.status)),
      el("td", {}, formatDate(s.admissionDate)),
      el("td", {}, rowActions(s, profile)),
    ]));
  }
  table.append(tbody);
  container.innerHTML = "";
  container.append(table);
}

function statusBadge(status) {
  const map = { active: "success", transferred: "gold", suspended: "danger", archived: "muted" };
  return el("span", { class: `badge badge--${map[status] || "muted"}` }, status || "active");
}

function rowActions(student, profile) {
  const box = el("div", { style: "display:flex; gap:6px;" });
  box.append(
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStudentForm(profile, student) }, "Edit"),
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => openTransferForm(profile, student) }, "Transfer/Promote"),
  );
  if (student.status !== "suspended") {
    box.append(el("button", { class: "btn btn--ghost btn--sm", onClick: () => changeStatus(profile, student, "suspended") }, "Suspend"));
  } else {
    box.append(el("button", { class: "btn btn--ghost btn--sm", onClick: () => changeStatus(profile, student, "active") }, "Reinstate"));
  }
  box.append(el("button", { class: "btn btn--ghost btn--sm", onClick: () => changeStatus(profile, student, "archived") }, "Archive"));
  return box;
}

async function changeStatus(profile, student, status) {
  if (!confirm(`Mark ${student.fullName} as ${status}?`)) return;
  await setStudentStatus(profile.uid, student.id, status);
  toast(`${student.fullName} marked ${status}.`, "success");
  await refresh(profile);
}

async function refresh(profile) {
  students = await listStudents();
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile);
}

function openTransferForm(profile, student) {
  const body = el("div", {});
  const gradeSelect = el("select", { id: "t-grade" }, classes.map((c) =>
    el("option", { value: c.grade, ...(c.grade === student.grade ? { selected: "true" } : {}) }, c.grade)
  ));
  const streamSelect = el("select", { id: "t-stream" });
  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    const cls = classes.find((c) => c.grade === grade);
    (cls?.streams || []).forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === student.stream ? { selected: "true" } : {}) }, s))
    );
  }
  fillStreams(student.grade);
  gradeSelect.addEventListener("change", (e) => fillStreams(e.target.value));

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--primary", onClick: async () => {
        await transferStudent(profile.uid, student.id, gradeSelect.value, streamSelect.value);
        toast("Student moved.", "success");
        close();
        await refresh(profile);
      }}, "Move student"),
    ])
  );
  const close = openModal(`Transfer / Promote — ${student.fullName}`, body);
}

function openStudentForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});

  const gradeSelect = el("select", { id: "s-grade" }, classes.map((c) =>
    el("option", { value: c.grade, ...(c.grade === existing?.grade ? { selected: "true" } : {}) }, c.grade)
  ));
  const streamSelect = el("select", { id: "s-stream" });
  function fillStreams(grade) {
    streamSelect.innerHTML = "";
    const cls = classes.find((c) => c.grade === grade);
    (cls?.streams || []).forEach((s) =>
      streamSelect.append(el("option", { value: s, ...(s === existing?.stream ? { selected: "true" } : {}) }, s))
    );
  }
  fillStreams(existing?.grade || classes[0]?.grade);
  gradeSelect.addEventListener("change", (e) => fillStreams(e.target.value));

  const genderSelect = el("select", { id: "s-gender" }, [
    el("option", { value: "Male", ...(existing?.gender === "Male" ? { selected: "true" } : {}) }, "Male"),
    el("option", { value: "Female", ...(existing?.gender === "Female" ? { selected: "true" } : {}) }, "Female"),
  ]);

  const parentChecklist = el("div", { style: "max-height:120px; overflow-y:auto; border:1px solid var(--color-line); border-radius:6px; padding:8px;" });
  const selectedParentIds = new Set(existing?.parentIds || []);
  if (!parents.length) {
    parentChecklist.append(el("p", { class: "text-sm text-muted" }, "No parents yet — add one from the Parents page, then link them here."));
  }
  for (const p of parents) {
    const id = `parent-${p.id}`;
    const checkbox = el("input", { type: "checkbox", id, value: p.id, ...(selectedParentIds.has(p.id) ? { checked: "true" } : {}) });
    parentChecklist.append(el("div", {}, [checkbox, el("label", { for: id, style: "margin-left:6px;" }, `${p.fullName} (${p.relationship || "parent"})`)]));
  }

  body.append(
    field("s-admissionNumber", "Admission Number", existing?.admissionNumber),
    field("s-fullName", "Full Name", existing?.fullName),
    el("div", { class: "field" }, [el("label", {}, "Gender"), genderSelect]),
    field("s-dob", "Date of Birth", existing?.dob, "date"),
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    field("s-address", "Address", existing?.address),
    field("s-phone", "Phone", existing?.phone),
    field("s-previousSchool", "Previous School", existing?.previousSchool),
    field("s-kcpeNumber", "KCPE/Assessment Number", existing?.kcpeNumber),
    el("div", { class: "field" }, [el("label", {}, "Medical Information"), el("textarea", { id: "s-medicalInfo", rows: "2" }, existing?.medicalInfo || "")]),
    el("div", { class: "field" }, [el("label", {}, "Photo"), el("input", { type: "file", id: "s-photo", accept: "image/*" })]),
    el("div", { class: "field" }, [el("label", {}, "Linked Parents/Guardians"), parentChecklist]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, isEdit ? "Save changes" : "Register student"),
  );

  const close = openModal(isEdit ? `Edit — ${existing.fullName}` : "New Admission", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const photoFile = document.getElementById("s-photo").files[0];
    const parentIds = Array.from(parentChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const data = {
      admissionNumber: val("s-admissionNumber"),
      fullName: val("s-fullName"),
      gender: genderSelect.value,
      dob: val("s-dob"),
      grade: gradeSelect.value,
      stream: streamSelect.value,
      address: val("s-address"),
      phone: val("s-phone"),
      previousSchool: val("s-previousSchool"),
      kcpeNumber: val("s-kcpeNumber"),
      medicalInfo: document.getElementById("s-medicalInfo").value.trim(),
      parentIds,
    };
    try {
      if (isEdit) {
        await updateStudent(profile.uid, existing.id, data, photoFile, existing.parentIds || []);
        toast("Student updated.", "success");
      } else {
        await registerStudent(profile.uid, data, photoFile);
        toast("Student registered.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save student.", "error");
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
