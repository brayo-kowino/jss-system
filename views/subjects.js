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
  Sciences: { icon: "science", bg: "rgba(5, 150, 105, 0.1)", color: "#047857" },
  Languages: { icon: "translate", bg: "rgba(20, 83, 138, 0.1)", color: "#14538a" },
  Humanities: { icon: "public", bg: "rgba(201, 162, 39, 0.15)", color: "#8c6f12" },
  "Technical & Applied": { icon: "build", bg: "rgba(234, 88, 12, 0.1)", color: "#c2410c" },
  "Creative Arts": { icon: "palette", bg: "rgba(147, 51, 234, 0.1)", color: "#7e22ce" },
};

const PATHWAY_CONFIG = {
  STEM: { icon: "biotech" },
  "Social Sciences": { icon: "diversity_3" },
  "Arts & Sports Science": { icon: "palette" },
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

/**
 * Animated Scholar Mascot holding an open textbook and a writing feather quill.
 */
export function buildSubjectsMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="subjects-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Subjects Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Open Textbook -->
        <g class="subjects-mascot__book">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Open Book Spreads -->
          <polygon points="56,132 72,130 72,154 56,156" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" />
          <polygon points="72,130 88,132 88,156 72,154" fill="#FFFFFF" stroke="#0D3559" stroke-width="1.2" />
          <line x1="60" y1="137" x2="68" y2="136" stroke="#94A3B8" stroke-width="1" />
          <line x1="60" y1="142" x2="68" y2="141" stroke="#94A3B8" stroke-width="1" />
          <line x1="60" y1="147" x2="68" y2="146" stroke="#94A3B8" stroke-width="1" />
          <line x1="76" y1="136" x2="84" y2="137" stroke="#94A3B8" stroke-width="1" />
          <line x1="76" y1="141" x2="84" y2="142" stroke="#94A3B8" stroke-width="1" />
          <line x1="76" y1="146" x2="84" y2="147" stroke="#94A3B8" stroke-width="1" />
          <!-- Hand Holding Book -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Holding Writing Feather Quill (Animated) -->
        <g class="subjects-mascot__quill">
          <path d="M136,128 C146,132 152,122 148,112" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="148" cy="112" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Feather Quill -->
          <path d="M148,112 Q158,96 166,80 Q160,94 152,108 Z" fill="#F59E0B" stroke="#D97706" stroke-width="1" />
          <line x1="148" y1="112" x2="164" y2="82" stroke="#B45309" stroke-width="0.8" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

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
          ? el("span", { class: "subjects-pathway-chip" }, [
              icon(pathwayConf.icon, "text-xs", "style: font-size:14px; color:var(--color-primary-600);"),
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
