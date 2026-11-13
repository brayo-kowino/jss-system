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
let searchQuery = "";
let selectedDept = "All";

const DEPT_CONFIG = {
  Sciences: { icon: "science", bg: "color-mix(in srgb, var(--color-green) 12%, transparent)", color: "var(--color-green)" },
  Languages: { icon: "translate", bg: "var(--color-primary-100)", color: "var(--color-primary-700)" },
  Humanities: { icon: "public", bg: "color-mix(in srgb, var(--color-gold) 15%, transparent)", color: "var(--color-gold)" },
  "Technical & Applied": { icon: "build", bg: "color-mix(in srgb, var(--color-red) 10%, transparent)", color: "var(--color-red)" },
  "Creative Arts": { icon: "palette", bg: "color-mix(in srgb, var(--color-primary-900) 8%, transparent)", color: "var(--color-primary-900)" },
};

const PATHWAY_CONFIG = {
  STEM: { icon: "biotech", bg: "var(--color-primary-100)", color: "var(--color-primary-700)" },
  "Social Sciences": { icon: "diversity_3", bg: "color-mix(in srgb, var(--color-green) 12%, transparent)", color: "var(--color-green)" },
  "Arts & Sports Science": { icon: "palette", bg: "color-mix(in srgb, var(--color-gold) 15%, transparent)", color: "var(--color-gold)" },
};

const CBC_PRESETS = [
  { code: "MATH", name: "Mathematics", department: "Sciences", pathway: "STEM" },
  { code: "ENG", name: "English", department: "Languages", pathway: "Social Sciences" },
  { code: "KIS", name: "Kiswahili", department: "Languages", pathway: "Social Sciences" },
  { code: "SCI", name: "Integrated Science", department: "Sciences", pathway: "STEM" },
  { code: "AGR", name: "Agriculture", department: "Sciences", pathway: "STEM" },
  { code: "SST", name: "Social Studies", department: "Humanities", pathway: "Social Sciences" },
  { code: "CRA", name: "Creative Arts", department: "Creative Arts", pathway: "Arts & Sports Science" },
  { code: "CRE", name: "CRE", department: "Humanities", pathway: "Social Sciences" },
  { code: "PTS", name: "Pre-Technical Studies", department: "Technical & Applied", pathway: "STEM" },
];

import { buildSubjectsMascotSvg } from "../js/components/mascot.js";
export { buildSubjectsMascotSvg };

// ------------------------------------------------------------------ Render --

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  subjects = await listSubjects();

  const wrap = el("div", { class: "subjects-view-wrap" });

  const deptsCount = new Set(subjects.map((s) => s.department).filter(Boolean)).size || DEPARTMENTS.length;
  const pathwaysCount = new Set(subjects.map((s) => s.pathway).filter(Boolean)).size || PATHWAYS.length;

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildSubjectsMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner (Concise Copy)
  const heroBanner = el("div", { class: "subjects-hero" }, [
    el("div", { class: "subjects-hero__content" }, [
      
      el("h1", { class: "subjects-hero__title" }, "Learning Areas & Subjects"),
      el("p", { class: "subjects-hero__desc" }, "CBC learning areas, departments, and pathways."),
      el("div", { class: "subjects-hero__pills" }, [
        el("div", { class: "subjects-pill" }, [icon("book"), `${subjects.length} Subjects`]),
        el("div", { class: "subjects-pill" }, [icon("corporate_fare"), `${deptsCount} Departments`]),
        el("div", { class: "subjects-pill" }, [icon("alt_route"), `${pathwaysCount} Pathways`]),
      ]),
      el("div", { class: "subjects-hero__actions" }, [
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          id: "new-subject-btn",
          onClick: () => openSubjectForm(profile),
        }, [icon("add"), "Add Subject"]),
      ]),
    ]),

    // Mascot & Speech Bubble (Concise)
    el("div", { class: "subjects-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Manage learning areas & pathways."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Search & Filter Toolbar
  const searchInput = el("input", {
    type: "search",
    class: "subjects-search-input",
    placeholder: "Search code or name...",
    value: searchQuery,
  });

  const deptFiltersContainer = el("div", { class: "subjects-dept-filters" });

  function renderDeptFilters() {
    deptFiltersContainer.innerHTML = "";
    const options = ["All", ...DEPARTMENTS];
    options.forEach((dept) => {
      const btn = el("button", {
        type: "button",
        class: `subjects-dept-btn ${selectedDept === dept ? "subjects-dept-btn--active" : ""}`,
        onClick: () => {
          selectedDept = dept;
          renderDeptFilters();
          renderTable(tableWrap, profile);
        },
      }, dept);
      deptFiltersContainer.append(btn);
    });
  }
  renderDeptFilters();

  const toolbar = el("div", { class: "subjects-toolbar" }, [
    el("div", { class: "subjects-search-wrap" }, [
      icon("search"),
      searchInput,
    ]),
    deptFiltersContainer,
  ]);
  wrap.append(toolbar);

  // Table Card Container
  const tableWrap = el("div", { class: "subjects-card table-wrap table-wrap--responsive" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile);

  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderTable(tableWrap, profile);
  });

  return wrap;
}

// ------------------------------------------------------------------ Table --

function renderTable(container, profile) {
  container.innerHTML = "";

  if (!subjects.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("menu_book", "text-muted", "style: font-size:44px;"),
        el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No subjects configured"),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          style: "margin-top:var(--sp-3);",
          onClick: () => openSubjectForm(profile),
        }, [icon("add"), "Add First Subject"]),
      ])
    );
    return;
  }

  const filtered = subjects.filter((s) => {
    const matchesSearch = !searchQuery ||
      (s.code || "").toLowerCase().includes(searchQuery) ||
      (s.name || "").toLowerCase().includes(searchQuery);
    const matchesDept = selectedDept === "All" || s.department === selectedDept;
    return matchesSearch && matchesDept;
  });

  if (!filtered.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-5);" }, [
        icon("search_off", "text-muted", "style: font-size:36px;"),
        el("p", { class: "text-muted text-sm", style: "margin:6px 0 0 0;" }, "No matching subjects found."),
      ])
    );
    return;
  }

  const table = el("table", { class: "subjects-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:110px;" }, "Code"),
      el("th", { style: "min-width:180px;" }, "Name"),
      el("th", { style: "width:180px;" }, "Department"),
      el("th", { style: "width:180px;" }, "Pathway"),
      el("th", { class: "col-right", style: "width:140px;" }, "Actions"),
    ])),
  ]);

  const tbody = el("tbody", {});
  for (const s of filtered) {
    const deptConf = DEPT_CONFIG[s.department] || { icon: "corporate_fare", bg: "var(--color-cream-dim)", color: "var(--color-ink-soft)" };
    const pathwayConf = PATHWAY_CONFIG[s.pathway] || { icon: "alt_route" };

    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Code" }, [
        el("span", { class: "subjects-code-badge" }, s.code),
      ]),
      el("td", { "data-label": "Name" }, [
        el("strong", { style: "color:var(--color-primary-900);" }, s.name),
      ]),
      el("td", { "data-label": "Department" }, [
        s.department
          ? el("span", {
              class: "subjects-dept-chip",
              style: `background:${deptConf.bg}; color:${deptConf.color};`,
            }, [
              icon(deptConf.icon, "text-xs"),
              s.department,
            ])
          : el("span", { class: "text-muted text-xs" }, "—"),
      ]),
            el("td", { "data-label": "Pathway" }, [
        s.pathway
          ? el("span", { 
              class: "subjects-pathway-chip",
              style: pathwayConf.bg ? `background:${pathwayConf.bg}; color:${pathwayConf.color}; border-color:color-mix(in srgb, ${pathwayConf.color} 30%, transparent);` : ""
            }, [
              icon(pathwayConf.icon, "text-xs", pathwayConf.color ? `style: font-size:14px; color:currentColor;` : "style: font-size:14px; color:var(--color-primary-600);"),
              s.pathway,
            ])
          : el("span", { class: "text-muted text-xs" }, "—"),
      ]),
      el("td", { class: "col-right", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            title: `Edit ${s.name}`,
            onClick: () => openSubjectForm(profile, s),
          }, [icon("edit", "text-xs"), "Edit"]),
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "color:var(--color-danger);",
            title: `Delete ${s.name}`,
            onClick: () => confirmDelete(profile, s),
          }, [icon("delete", "text-xs"), "Delete"]),
        ]),
      ]),
    ]));
  }

  table.append(tbody);
  container.append(table);
}

// ----------------------------------------------------------------- Refresh --

async function refresh(profile) {
  subjects = await listSubjects(true);
  const tableWrap = document.querySelector(".subjects-card");
  if (tableWrap) renderTable(tableWrap, profile);
}

// ------------------------------------------------------------------ Modals --

function openSubjectForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});

  const codeInput = el("input", {
    id: "sub-code",
    value: existing?.code || "",
    placeholder: "e.g. MATH",
    style: "text-transform:uppercase;",
    ...(isEdit ? { disabled: "true" } : {}),
  });
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  const nameInput = el("input", {
    id: "sub-name",
    value: existing?.name || "",
    placeholder: "e.g. Mathematics",
  });

  const deptSelect = el("select", { id: "sub-department" }, [
    el("option", { value: "" }, "Select Department"),
    ...DEPARTMENTS.map((d) => el("option", { value: d, ...(d === existing?.department ? { selected: "true" } : {}) }, d)),
  ]);

  const pathwaySelect = el("select", { id: "sub-pathway" }, [
    el("option", { value: "" }, "Select Pathway"),
    ...PATHWAYS.map((p) => el("option", { value: p, ...(p === existing?.pathway ? { selected: "true" } : {}) }, p)),
  ]);

  // Quick CBC Presets (only for new subjects)
  let presetsContainer = null;
  if (!isEdit) {
    const unusedPresets = CBC_PRESETS.filter((cp) => !subjects.some((s) => s.code.toUpperCase() === cp.code.toUpperCase()));
    if (unusedPresets.length) {
      presetsContainer = el("div", { class: "preset-tag-picker" }, [
        el("span", { class: "text-muted text-xs", style: "align-self:center; margin-right:4px;" }, "Quick CBC Presets:"),
        ...unusedPresets.map((cp) =>
          el("button", {
            type: "button",
            class: "preset-tag-pill",
            onClick: () => {
              codeInput.value = cp.code;
              nameInput.value = cp.name;
              deptSelect.value = cp.department;
              pathwaySelect.value = cp.pathway;
            },
          }, `${cp.code} - ${cp.name}`)
        ),
      ]);
    }
  }

  body.append(
    ...(presetsContainer ? [presetsContainer] : []),
    el("div", { class: "field" }, [el("label", { for: "sub-code" }, "Subject Code"), codeInput]),
    el("div", { class: "field" }, [el("label", { for: "sub-name" }, "Subject Name"), nameInput]),
    el("div", { class: "field" }, [el("label", { for: "sub-department" }, "Department"), deptSelect]),
    el("div", { class: "field" }, [el("label", { for: "sub-pathway" }, "Pathway"), pathwaySelect]),
    el("button", {
      type: "submit",
      class: "btn btn--primary btn--block",
      style: "margin-top:var(--sp-2);",
    }, [icon(isEdit ? "save" : "add_circle"), isEdit ? "Save Changes" : "Create Subject"])
  );

  const close = openModal(isEdit ? `Edit: ${existing.name}` : "Add Subject", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      code: codeInput.value.trim().toUpperCase(),
      name: nameInput.value.trim(),
      department: deptSelect.value,
      pathway: pathwaySelect.value,
    };
    if (!data.code || !data.name) return toast("Code and name are required.", "error");

    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    try {
      if (isEdit) {
        await updateSubject(profile.uid, existing.id, data);
        toast(`Subject ${data.name} updated.`, "success");
      } else {
        await addSubject(profile.uid, data);
        toast(`Subject ${data.name} added.`, "success");
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
    el("p", { class: "text-sm", style: "margin-bottom:var(--sp-4);" }, `Delete ${subject.name} (${subject.code})? This action cannot be undone.`),
    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => close() }, "Cancel"),
      el("button", {
        class: "btn btn--danger btn--sm",
        onClick: async (ev) => {
          const restore = busyButton(ev.currentTarget, "Deleting…");
          try {
            await deleteSubject(profile.uid, subject.id);
            toast(`${subject.name} deleted.`, "success");
            close();
            await refresh(profile);
          } catch (err) {
            toast(err.message || "Could not delete subject.", "error");
            restore();
          }
        },
      }, [icon("delete"), "Delete Subject"]),
    ])
  );
  const close = openModal(`Delete Subject: ${subject.code}`, body);
}

export function init() {}
