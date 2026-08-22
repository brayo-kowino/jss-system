import { listParents, createParent, updateParent, deleteParent } from "../js/services/parent.service.js";
import { listStudents } from "../js/services/student.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

let parents = [];
let students = [];

export async function render({ profile }) {
  [parents, students] = await Promise.all([listParents(), listStudents()]);

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("p", {}, `${parents.length} registered`)]),
      el("button", { class: "btn btn--primary", id: "new-parent-btn" }, [icon("person_add"), "Add Parent"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile);

  setTimeout(() => {
    document.getElementById("new-parent-btn")?.addEventListener("click", () => openParentForm(profile));
  });

  return wrap;
}

function renderTable(container, profile) {
  if (!parents.length) {
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No parents yet"),
      el("p", {}, "Add a parent, then link them to students from either this page or the Students page."),
    ]));
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Name"), el("th", {}, "Phone"), el("th", {}, "Email"),
      el("th", {}, "Relationship"), el("th", {}, "Linked Students"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const p of parents) {
    const linkedNames = (p.linkedStudentIds || [])
      .map((id) => students.find((s) => s.id === id)?.fullName)
      .filter(Boolean);
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Name" }, p.fullName),
      el("td", { "data-label": "Phone" }, p.phone || "N/A"),
      el("td", { "data-label": "Email" }, p.email || "N/A"),
      el("td", { "data-label": "Relationship" }, p.relationship || "N/A"),
      el("td", { "data-label": "Linked Students" }, linkedNames.length ? linkedNames.join(", ") : el("span", { class: "text-muted" }, "None")),
      el("td", { class: "row-actions", "data-label": "Actions" }, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openParentForm(profile, p) }, [icon("edit"), "Edit"]),
        el("button", { class: "btn btn--ghost btn--sm text-danger", style: "color:var(--color-red);", onClick: async (e) => {
          if (!confirm(`Are you sure you want to delete ${p.fullName}?`)) return;
          const restore = busyButton(e.currentTarget, "Deleting...");
          try {
            await deleteParent(profile.uid, p.id);
            toast("Parent deleted.", "success");
            await refresh(profile);
          } catch (err) {
            toast(err.message, "error");
            restore();
          }
        }}, [icon("delete"), "Delete"])
      ]),
    ]));
  }
  table.append(tbody);
  container.innerHTML = "";
  container.append(table);
}

async function refresh(profile) {
  [parents, students] = await Promise.all([listParents(), listStudents()]);
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile);
}

function openParentForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});
  body.append(
    field("p-fullName", "Full Name", existing?.fullName),
    field("p-phone", "Phone", existing?.phone),
    field("p-email", "Email", existing?.email, "email"),
    field("p-occupation", "Occupation", existing?.occupation),
    field("p-relationship", "Relationship to student", existing?.relationship || "Parent"),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "person_add"), isEdit ? "Save changes" : "Add parent"]),
  );

  const close = openModal(isEdit ? `Edit: ${existing.fullName}` : "Add Parent", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, isEdit ? "Saving..." : "Adding...");
    const data = {
      fullName: val("p-fullName"),
      phone: val("p-phone"),
      email: val("p-email"),
      occupation: val("p-occupation"),
      relationship: val("p-relationship"),
    };
    try {
      if (isEdit) {
        await updateParent(profile.uid, existing.id, data);
        toast("Parent updated.", "success");
      } else {
        await createParent(profile.uid, data);
        toast("Parent added.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save parent.", "error");
    } finally {
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
