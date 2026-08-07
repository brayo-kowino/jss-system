import {
  listSubjects,
  addSubject,
  updateSubject,
  deleteSubject,
  seedDefaultsIfEmpty,
  PATHWAYS,
  DEPARTMENTS,
} from "../js/services/academic.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

let subjects = [];

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  subjects = await listSubjects();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("p", {}, `${subjects.length} subject(s) configured`)]),
      el("button", { class: "btn btn--primary", id: "new-subject-btn" }, [icon("add"), "Add Subject"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile);

  setTimeout(() => {
    document.getElementById("new-subject-btn")?.addEventListener("click", () => openSubjectForm(profile));
  });

  return wrap;
}

function renderTable(container, profile) {
  container.innerHTML = "";
  if (!subjects.length) {
    container.append(
      el("div", { class: "empty-state" }, [
        el("h3", {}, "No subjects yet"),
        el("p", {}, "Click '+ Add Subject' to set up your first subject."),
      ])
    );
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Code"), el("th", {}, "Name"), el("th", {}, "Department"),
      el("th", {}, "Pathway"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of subjects) {
    tbody.append(el("tr", {}, [
      el("td", {}, el("span", { class: "badge badge--muted" }, s.code)),
      el("td", {}, s.name),
      el("td", {}, s.department || el("span", { class: "text-muted" }, "N/A")),
      el("td", {}, s.pathway || el("span", { class: "text-muted" }, "N/A")),
      el("td", {}, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openSubjectForm(profile, s) }, [icon("edit"), "Edit"]),
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => confirmDelete(profile, s) }, [icon("delete"), "Delete"]),
      ]),
    ]));
  }
  table.append(tbody);
  container.append(table);
}

async function refresh(profile) {
  subjects = await listSubjects();
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile);
}

function selectField(id, label, options, selected) {
  const select = el("select", { id }, [
    el("option", { value: "" }, "Select"),
    ...options.map((o) => el("option", { value: o, ...(o === selected ? { selected: "true" } : {}) }, o)),
  ]);
  return el("div", { class: "field" }, [el("label", { for: id }, label), select]);
}

function openSubjectForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});
  body.append(
    el("div", { class: "field" }, [
      el("label", { for: "sub-code" }, "Subject Code"),
      el("input", { id: "sub-code", value: existing?.code || "", placeholder: "e.g. MATH", ...(isEdit ? { disabled: "true" } : {}) }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "sub-name" }, "Subject Name"),
      el("input", { id: "sub-name", value: existing?.name || "", placeholder: "e.g. Mathematics" }),
    ]),
    selectField("sub-department", "Department", DEPARTMENTS, existing?.department),
    selectField("sub-pathway", "Pathway", PATHWAYS, existing?.pathway),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save changes" : "Add subject"])
  );

  const close = openModal(isEdit ? `Edit: ${existing.name}` : "Add Subject", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      code: document.getElementById("sub-code").value.trim(),
      name: document.getElementById("sub-name").value.trim(),
      department: document.getElementById("sub-department").value,
      pathway: document.getElementById("sub-pathway").value,
    };
    if (!data.code || !data.name) return toast("Code and name are required.", "error");
    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    try {
      if (isEdit) {
        await updateSubject(profile.uid, existing.id, data);
        toast("Subject updated.", "success");
      } else {
        await addSubject(profile.uid, data);
        toast("Subject added.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save subject.", "error");
      restore();
    }
  });
}

function confirmDelete(profile, subject) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${subject.name}"? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", { class: "btn btn--danger", onClick: async (ev) => {
        const restore = busyButton(ev.currentTarget, "Deleting…");
        try {
          await deleteSubject(profile.uid, subject.id);
          toast("Subject deleted.", "success");
          close();
          await refresh(profile);
        } catch (err) {
          toast(err.message || "Could not delete subject.", "error");
          restore();
        }
      } }, "Delete"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Delete Subject", body);
}

export function init() {}
