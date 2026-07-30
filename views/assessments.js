import {
  listAssessments,
  addAssessment,
  updateAssessment,
  deleteAssessment,
  setAssessmentStatus,
  ASSESSMENT_TYPES,
} from "../js/services/assessment.service.js";
import { listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { openModal } from "../js/components/modal.js";
import { el, toast, formatDate } from "../js/utils.js";

let assessments = [];
let classes = [];
let settings = null;

const CAN_MANAGE = ["admin", "academic_master"];

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [assessments, classes, settings] = await Promise.all([listAssessments(), listClasses(), getSchoolSettings()]);
  const canManage = CAN_MANAGE.includes(profile.role);

  const wrap = el("div", {});
  const header = el("div", { class: "page-header" }, [
    el("div", {}, [el("h1", {}, "Assessments"), el("p", {}, `${assessments.length} assessment(s) configured`)]),
  ]);
  if (canManage) {
    header.append(el("button", { class: "btn btn--primary", id: "new-assessment-btn" }, "+ Add Assessment"));
  }
  wrap.append(header);

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile, canManage);

  setTimeout(() => {
    document.getElementById("new-assessment-btn")?.addEventListener("click", () => openAssessmentForm(profile));
  });

  return wrap;
}

function renderTable(container, profile, canManage) {
  container.innerHTML = "";
  if (!assessments.length) {
    container.append(
      el("div", { class: "empty-state" }, [
        el("h3", {}, "No assessments yet"),
        el("p", {}, canManage ? "Click '+ Add Assessment' to set up your first CAT, assignment, or exam." : "Nothing has been scheduled yet."),
      ])
    );
    return;
  }

  const headCells = [
    el("th", {}, "Name"), el("th", {}, "Type"), el("th", {}, "Term / Year"),
    el("th", {}, "Date"), el("th", {}, "Weight"), el("th", {}, "Classes"), el("th", {}, "Status"),
  ];
  if (canManage) headCells.push(el("th", {}, "Actions"));

  const table = el("table", {}, [el("thead", {}, el("tr", {}, headCells))]);
  const tbody = el("tbody", {});
  for (const a of assessments) {
    const cells = [
      el("td", {}, a.name),
      el("td", {}, a.type),
      el("td", {}, `${a.term || "—"} · ${a.academicYear || "—"}`),
      el("td", {}, a.date ? formatDate(a.date) : "—"),
      el("td", { class: "numeric" }, a.weight ? `${a.weight}%` : "—"),
      el("td", {}, (a.grades || []).join(", ") || el("span", { class: "text-muted" }, "All")),
      el("td", {}, el("span", { class: `badge badge--${a.status === "locked" ? "danger" : "success"}` }, a.status || "open")),
    ];
    if (canManage) {
      cells.push(el("td", {}, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openAssessmentForm(profile, a) }, "Edit"),
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => toggleLock(profile, a) }, a.status === "locked" ? "Reopen" : "Lock"),
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => confirmDelete(profile, a) }, "Delete"),
      ]));
    }
    tbody.append(el("tr", {}, cells));
  }
  table.append(tbody);
  container.append(table);
}

async function toggleLock(profile, a) {
  const next = a.status === "locked" ? "open" : "locked";
  try {
    await setAssessmentStatus(profile.uid, a.id, next);
    toast(`${a.name} ${next === "locked" ? "locked" : "reopened"}.`, "success");
    await refresh(profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
  }
}

async function refresh(profile) {
  assessments = await listAssessments();
  const tableWrap = document.querySelector(".table-wrap");
  const canManage = CAN_MANAGE.includes(profile.role);
  if (tableWrap) renderTable(tableWrap, profile, canManage);
  const countEl = document.querySelector(".page-header p");
  if (countEl) countEl.textContent = `${assessments.length} assessment(s) configured`;
}

function openAssessmentForm(profile, existing = null) {
  const isEdit = !!existing;
  if (isEdit && existing.status === "locked") {
    return toast("This assessment is locked. Reopen it first to edit.", "error");
  }
  const body = el("form", {});

  const typeSelect = el("select", { id: "a-type" }, ASSESSMENT_TYPES.map((t) =>
    el("option", { value: t, ...(t === existing?.type ? { selected: "true" } : {}) }, t)
  ));

  const termSelect = el("select", { id: "a-term" }, (settings.terms || ["Term 1", "Term 2", "Term 3"]).map((t) =>
    el("option", { value: t, ...(t === (existing?.term || settings.currentTerm) ? { selected: "true" } : {}) }, t)
  ));

  const gradeChecklist = el("div", { style: "max-height:110px; overflow-y:auto; border:1px solid var(--color-line); border-radius:6px; padding:8px;" });
  const selectedGrades = new Set(existing?.grades || []);
  for (const c of classes) {
    const id = `grade-${c.id}`;
    gradeChecklist.append(el("div", {}, [
      el("input", { type: "checkbox", id, value: c.grade, ...(selectedGrades.has(c.grade) ? { checked: "true" } : {}) }),
      el("label", { for: id, style: "margin-left:6px;" }, c.grade),
    ]));
  }

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Assessment Name"), el("input", { id: "a-name", value: existing?.name || "", placeholder: "e.g. CAT 1" })]),
    el("div", { class: "field" }, [el("label", {}, "Type"), typeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Weight (%)"), el("input", { id: "a-weight", type: "number", min: "0", max: "100", step: "0.5", value: existing?.weight ?? "" })]),
    el("div", { class: "field" }, [el("label", {}, "Date"), el("input", { id: "a-date", type: "date", value: existing?.date || "" })]),
    el("div", { class: "field" }, [
      el("label", {}, "Academic Year"),
      el("input", { id: "a-year", value: existing?.academicYear || settings.currentAcademicYear || "" }),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [
      el("label", {}, "Classes (leave all unchecked to apply to every grade)"),
      gradeChecklist,
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, isEdit ? "Save changes" : "Add assessment")
  );

  const close = openModal(isEdit ? `Edit — ${existing.name}` : "Add Assessment", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grades = Array.from(gradeChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const data = {
      name: document.getElementById("a-name").value.trim(),
      type: document.getElementById("a-type").value,
      weight: document.getElementById("a-weight").value,
      date: document.getElementById("a-date").value,
      academicYear: document.getElementById("a-year").value.trim(),
      term: document.getElementById("a-term").value,
      grades,
    };
    if (!data.name) return toast("Assessment name is required.", "error");
    try {
      if (isEdit) {
        await updateAssessment(profile.uid, existing.id, data);
        toast("Assessment updated.", "success");
      } else {
        await addAssessment(profile.uid, data);
        toast("Assessment added.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save assessment.", "error");
    }
  });
}

function confirmDelete(profile, a) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${a.name}"? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", { class: "btn btn--danger", onClick: async () => {
        try {
          await deleteAssessment(profile.uid, a.id);
          toast("Assessment deleted.", "success");
          close();
          await refresh(profile);
        } catch (err) {
          toast(err.message || "Could not delete assessment.", "error");
        }
      } }, "Delete"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, "Cancel"),
    ])
  );
  const close = openModal("Delete Assessment", body);
}

export function init() {}
