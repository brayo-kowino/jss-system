import {
  listParents,
  createParent,
  updateParent,
  deleteParent,
  linkStudentToParent,
  unlinkStudentFromParent,
} from "../js/services/parent.service.js";
import { listStudents } from "../js/services/student.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

let parents = [];
let students = [];
let filterText = "";
let filterRelationship = "";
let filterStatus = "all"; // 'all' | 'linked' | 'unlinked'
let currentProfile = null;
let kpiGridEl = null;
let tableContainerEl = null;

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "PG";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function cleanPhoneForWhatsApp(phone = "") {
  let cleaned = String(phone).replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("0")) cleaned = "254" + cleaned.slice(1);
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  return cleaned;
}

const RELATIONSHIP_META = {
  father: { label: "Father", icon: "man", color: "father" },
  mother: { label: "Mother", icon: "woman", color: "mother" },
  guardian: { label: "Guardian", icon: "shield_person", color: "guardian" },
  sponsor: { label: "Sponsor", icon: "volunteer_activism", color: "sponsor" },
  other: { label: "Other", icon: "person", color: "other" },
};

function getRelationshipMeta(rel = "") {
  const norm = String(rel).trim().toLowerCase();
  if (norm.includes("father") || norm.includes("dad")) return RELATIONSHIP_META.father;
  if (norm.includes("mother") || norm.includes("mum") || norm.includes("mom")) return RELATIONSHIP_META.mother;
  if (norm.includes("guardian")) return RELATIONSHIP_META.guardian;
  if (norm.includes("sponsor")) return RELATIONSHIP_META.sponsor;
  return {
    label: rel || "Guardian",
    icon: "person",
    color: "other",
  };
}

function renderRelationshipBadge(rel) {
  const meta = getRelationshipMeta(rel);
  return el("span", { class: `parent-rel-badge parent-rel-badge--${meta.color}` }, [
    icon(meta.icon),
    meta.label,
  ]);
}

/**
 * Dynamic Family Engagement Liaison Mascot with parent handbook and message notification envelope.
 */
export function buildParentsMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="parents-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Parents & Family Liaison Mascot">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Academic Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Family Handbook with Heart Emblem -->
        <g class="parents-mascot__handbook">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Handbook cover -->
          <rect x="52" y="124" width="28" height="36" rx="2.5" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.4" transform="rotate(-6 66 142)" />
          <rect x="56" y="128" width="16" height="4" rx="1" fill="#14538A" transform="rotate(-6 66 142)" />
          <!-- Heart Emblem -->
          <path d="M63,142 C61,139 57,139 57,143 C57,146 63,150 63,150 C63,150 69,146 69,143 C69,139 65,139 63,142 Z" fill="#EF4444" transform="rotate(-6 66 142)" />
          <line x1="56" y1="152" x2="72" y2="152" stroke="#64748B" stroke-width="1.2" stroke-linecap="round" transform="rotate(-6 66 142)" />
          <!-- Hand Holding Handbook -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Connected Notification Envelope with Gleam -->
        <g class="parents-mascot__envelope">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Communication Envelope -->
          <rect x="146" y="90" width="30" height="20" rx="2.5" fill="#FAF6F0" stroke="#8C6F12" stroke-width="1.4" transform="rotate(8 161 100)" />
          <!-- Envelope Flap -->
          <polyline points="147,91 161,102 175,91" fill="none" stroke="#C9A227" stroke-width="1.6" stroke-linejoin="round" transform="rotate(8 161 100)" />
          <!-- Heart Stamp -->
          <circle cx="161" cy="99" r="3" fill="#EF4444" transform="rotate(8 161 100)" />
          <!-- Golden Sparkle Star -->
          <polygon points="161,78 162.5,81 165.5,82.5 162.5,84 161,87 159.5,84 156.5,82.5 159.5,81" fill="#FEF08A" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Warm Eyebrows -->
        <path d="M89,75 Q97,70 103,74" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,75 Q123,70 117,74" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

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

        <!-- Cheerful Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <g class="support-mascot__tassel">
            <path d="M110,48.5 Q135,46 142,66" stroke="#FAF6F0" stroke-width="2.2" fill="none" />
            <polygon points="139,66 145,66 143,77 141,77" fill="#FAF6F0" />
          </g>
        </g>
      </g>
    </svg>
  `;
}

function getFilteredParents() {
  return parents.filter((p) => {
    const linkedIds = p.linkedStudentIds || [];
    if (filterStatus === "linked" && linkedIds.length === 0) return false;
    if (filterStatus === "unlinked" && linkedIds.length > 0) return false;

    if (filterRelationship) {
      const relMeta = getRelationshipMeta(p.relationship);
      if (relMeta.color !== filterRelationship && !String(p.relationship).toLowerCase().includes(filterRelationship)) {
        return false;
      }
    }

    if (filterText) {
      const q = filterText.toLowerCase();
      const matchName = (p.fullName || "").toLowerCase().includes(q);
      const matchPhone = (p.phone || "").toLowerCase().includes(q);
      const matchEmail = (p.email || "").toLowerCase().includes(q);
      const matchOcc = (p.occupation || "").toLowerCase().includes(q);
      const matchRel = (p.relationship || "").toLowerCase().includes(q);

      // Check linked students names
      const matchStudent = linkedIds.some((id) => {
        const st = students.find((s) => s.id === id);
        return (
          st?.fullName?.toLowerCase().includes(q) ||
          st?.admissionNumber?.toLowerCase().includes(q)
        );
      });

      if (!matchName && !matchPhone && !matchEmail && !matchOcc && !matchRel && !matchStudent) return false;
    }
    return true;
  });
}

function renderRow(p, profile) {
  const initials = getInitials(p.fullName);
  const linkedStudentObjects = (p.linkedStudentIds || [])
    .map((id) => students.find((s) => s.id === id))
    .filter(Boolean);

  const tr = el("tr", {});

  // Parent Name & Occupation
  const nameCell = el("td", { "data-label": "Parent / Guardian" }, [
    el("div", { style: "display:flex; align-items:center; gap:10px;" }, [
      el("div", { class: "parent-avatar-chip" }, initials),
      el("div", {}, [
        el("strong", { style: "font-size:14px; color:var(--color-primary-900); display:block;" }, p.fullName || "Unnamed Guardian"),
        p.occupation
          ? el(
              "span",
              { style: "font-size:11px; color:var(--color-ink-soft); display:inline-block; margin-top:2px;" },
              p.occupation
            )
          : el(
              "span",
              { style: "font-size:11px; color:var(--color-line-dark, #94a3b8); font-style:italic;" },
              "No occupation set"
            ),
      ]),
    ]),
  ]);

  // Relationship
  const relCell = el("td", { "data-label": "Relationship" }, [renderRelationshipBadge(p.relationship)]);

  // Contact Details
  const contactChildren = [];
  if (p.phone) {
    const waNumber = cleanPhoneForWhatsApp(p.phone);
    contactChildren.push(
      el("div", { style: "display:flex; align-items:center; gap:6px; margin-bottom:3px;" }, [
        el(
          "a",
          {
            href: `tel:${p.phone}`,
            class: "contact-link",
            title: `Call ${p.fullName}`,
          },
          [icon("call"), p.phone]
        ),
        waNumber
          ? el(
              "a",
              {
                href: `https://wa.me/${waNumber}`,
                target: "_blank",
                rel: "noopener noreferrer",
                style: "display:inline-flex; align-items:center; color:#16a34a; text-decoration:none; margin-left:2px;",
                title: `Chat with ${p.fullName} on WhatsApp`,
              },
              [icon("chat", "style=font-size:14px;")]
            )
          : "",
      ])
    );
  }
  if (p.email) {
    contactChildren.push(
      el("div", {}, [
        el(
          "a",
          {
            href: `mailto:${p.email}`,
            class: "contact-link",
            title: `Email ${p.fullName}`,
          },
          [icon("mail"), p.email]
        ),
      ])
    );
  }
  if (!p.phone && !p.email) {
    contactChildren.push(el("span", { class: "text-muted", style: "font-size:12px;" }, "No contact details"));
  }
  const contactCell = el("td", { "data-label": "Contact Info" }, contactChildren);

  // Linked Students
  let studentPills;
  if (linkedStudentObjects.length) {
    studentPills = el(
      "div",
      { style: "display:flex; flex-wrap:wrap; gap:6px;" },
      linkedStudentObjects.map((st) =>
        el(
          "a",
          {
            href: `#/students?q=${encodeURIComponent(st.admissionNumber || st.fullName || "")}`,
            class: "linked-student-chip",
            title: `View ${st.fullName} (${st.admissionNumber || "No Adm"})`,
          },
          [
            icon("school"),
            st.fullName,
            st.admissionNumber
              ? el(
                  "span",
                  { style: "opacity:0.75; font-size:10px; margin-left:2px;" },
                  `#${st.admissionNumber}`
                )
              : "",
          ]
        )
      )
    );
  } else {
    studentPills = el("div", { style: "display:flex; align-items:center; gap:6px;" }, [
      el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, "No students linked"),
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--xs",
          style: "padding:1px 6px; font-size:11px;",
          onClick: () => openQuickLinkModal(profile, p),
        },
        [icon("person_add_alt", "style=font-size:12px;"), "Link"]
      ),
    ]);
  }
  const linkedCell = el("td", { "data-label": "Linked Students" }, [studentPills]);

  // Actions
  const actionsCell = el("td", { class: "row-actions", "data-label": "Actions" }, [
    el("div", { style: "display:flex; align-items:center; gap:6px; justify-content:flex-end;" }, [
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "Link or unlink student records",
          onClick: () => openQuickLinkModal(profile, p),
        },
        [icon("link"), "Link"]
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "Edit parent information",
          onClick: () => openParentForm(profile, p),
        },
        [icon("edit"), "Edit"]
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--xs text-danger",
          style: "color:var(--color-red);",
          title: "Delete parent record",
          onClick: async (e) => {
            const hasStudents = (p.linkedStudentIds || []).length;
            const msg = hasStudents
              ? `Are you sure you want to delete ${p.fullName}? This parent is linked to ${hasStudents} student(s) who will be unlinked.`
              : `Are you sure you want to delete ${p.fullName}?`;
            if (!confirm(msg)) return;
            const restore = busyButton(e.currentTarget, "Deleting…");
            try {
              await deleteParent(profile.uid, p.id);
              toast(`Guardian ${p.fullName} deleted.`, "success");
              await refresh(profile);
            } catch (err) {
              console.error(err);
              toast(err.message || "Failed to delete parent.", "error");
              restore();
            }
          },
        },
        [icon("delete")]
      ),
    ]),
  ]);

  tr.append(nameCell, relCell, contactCell, linkedCell, actionsCell);
  return tr;
}

function renderTable(profile) {
  const filtered = getFilteredParents();

  if (!parents.length) {
    return el("div", { class: "card", style: "padding:var(--sp-6) var(--sp-4); text-align:center;" }, [
      el("div", { class: "empty-state" }, [
        el(
          "span",
          {
            class: "material-symbols-rounded icon empty-state__icon",
            style: "font-size:48px; color:var(--color-primary-400);",
          },
          "family_restroom"
        ),
        el("h3", { style: "margin-top:12px; font-size:var(--fs-lg);" }, "No Parents or Guardians Registered"),
        el(
          "p",
          { class: "text-muted", style: "max-width:440px; margin:6px auto 16px auto; font-size:var(--fs-sm);" },
          "Register parents and guardians to maintain verified contact channels, emergency notifications, and student links."
        ),
        el(
          "button",
          {
            type: "button",
            class: "btn btn--primary btn--sm",
            onClick: () => openParentForm(profile),
          },
          [icon("person_add"), "Add First Parent"]
        ),
      ]),
    ]);
  }

  if (!filtered.length) {
    return el("div", { class: "card", style: "padding:var(--sp-6) var(--sp-4); text-align:center;" }, [
      el("div", { class: "empty-state" }, [
        el(
          "span",
          {
            class: "material-symbols-rounded icon empty-state__icon",
            style: "font-size:44px; color:var(--color-ink-soft);",
          },
          "search_off"
        ),
        el("h3", { style: "margin-top:12px; font-size:var(--fs-md);" }, "No Matching Parents Found"),
        el(
          "p",
          { class: "text-muted", style: "max-width:400px; margin:6px auto 14px auto; font-size:var(--fs-sm);" },
          "No parents match your search query or relationship filter. Try clearing your search parameters."
        ),
        el(
          "button",
          {
            type: "button",
            class: "btn btn--ghost btn--sm",
            onClick: () => {
              filterText = "";
              filterRelationship = "";
              filterStatus = "all";
              reRender(profile);
            },
          },
          [icon("restart_alt"), "Reset Filters"]
        ),
      ]),
    ]);
  }

  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" }, [
    el(
      "div",
      {
        style:
          "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line); flex-wrap:wrap; gap:10px;",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "Guardian Directory"),
          el(
            "span",
            { class: "badge badge--info", style: "font-size:11px; padding:2px 7px;" },
            `Showing ${filtered.length} of ${parents.length}`
          ),
        ]),
        
      ]
    ),
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", { class: "reports-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { style: "width:230px;" }, "Parent / Guardian"),
            el("th", { style: "width:130px;" }, "Relationship"),
            el("th", { style: "width:190px;" }, "Contact Info"),
            el("th", {}, "Linked Students"),
            el("th", { class: "col-right", style: "width:170px;" }, "Actions"),
          ]),
        ]),
        el("tbody", {}, filtered.map((p) => renderRow(p, profile))),
      ]),
    ]),
  ]);

  return tableCard;
}

function reRender(profile) {
  if (kpiGridEl) {
    kpiGridEl.innerHTML = "";
    kpiGridEl.append(...renderKpiGrid().childNodes);
  }
  if (tableContainerEl) {
    tableContainerEl.innerHTML = "";
    tableContainerEl.appendChild(renderTable(profile));
  }
}

async function refresh(profile) {
  [parents, students] = await Promise.all([listParents(true), listStudents()]);
  reRender(profile);
}

/**
 * Dedicated Modal for linking / unlinking students to a parent.
 */
function openQuickLinkModal(profile, parent) {
  let linkedIds = [...(parent.linkedStudentIds || [])];

  const body = el("div", { style: "display:flex; flex-direction:column; gap:14px;" });

  // Parent Banner
  body.append(
    el(
      "div",
      {
        style:
          "display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--color-cream); border:1px solid var(--color-line); border-radius:var(--radius-md);",
      },
      [
        el("div", { class: "parent-avatar-chip" }, getInitials(parent.fullName)),
        el("div", {}, [
          el("div", { style: "font-weight:700; color:var(--color-primary-900);" }, parent.fullName),
          el(
            "div",
            { style: "font-size:12px; color:var(--color-ink-soft);" },
            `${parent.relationship || "Guardian"} · ${parent.phone || "No phone"}`
          ),
        ]),
      ]
    )
  );

  // Active Linked Students Chips Wrap
  const linkedTagsWrap = el("div", { style: "display:flex; flex-wrap:wrap; gap:6px; min-height:32px;" });

  function renderLinkedChips() {
    linkedTagsWrap.innerHTML = "";
    if (!linkedIds.length) {
      linkedTagsWrap.append(
        el("span", { class: "text-muted", style: "font-size:12px; font-style:italic;" }, "No students linked currently.")
      );
      return;
    }
    linkedIds.forEach((id) => {
      const st = students.find((s) => s.id === id);
      const name = st?.fullName || "Student";
      const adm = st?.admissionNumber ? ` (${st.admissionNumber})` : "";
      const chip = el(
        "span",
        {
          class: "badge badge--info",
          style: "display:inline-flex; align-items:center; gap:6px; padding:3px 8px; font-size:12px;",
        },
        [
          icon("school", "style=font-size:13px;"),
          `${name}${adm}`,
          el(
            "button",
            {
              type: "button",
              style:
                "background:none; border:none; color:inherit; cursor:pointer; font-weight:700; font-size:14px; padding:0 2px; line-height:1;",
              title: `Unlink ${name}`,
              onClick: () => {
                linkedIds = linkedIds.filter((x) => x !== id);
                renderLinkedChips();
              },
            },
            "×"
          ),
        ]
      );
      linkedTagsWrap.append(chip);
    });
  }
  renderLinkedChips();

  // Search input & suggestions
  const searchInput = el("input", {
    type: "text",
    placeholder: "Search student by name or admission number to link...",
    style: "width:100%;",
  });

  const searchResultsWrap = el("div", {
    class: "student-search-results",
    style: "display:none; position:relative; margin-top:4px;",
  });

  function filterSearch(q) {
    if (!q || q.trim().length < 1) {
      searchResultsWrap.style.display = "none";
      return;
    }
    const query = q.trim().toLowerCase();
    const matches = students
      .filter(
        (s) =>
          !linkedIds.includes(s.id) &&
          ((s.fullName || "").toLowerCase().includes(query) ||
            (s.admissionNumber || "").toLowerCase().includes(query))
      )
      .slice(0, 6);

    searchResultsWrap.innerHTML = "";
    if (!matches.length) {
      searchResultsWrap.append(
        el("div", { style: "padding:8px 12px; font-size:12px; color:var(--color-ink-soft);" }, "No matching unlinked students.")
      );
    } else {
      matches.forEach((st) => {
        const item = el(
          "div",
          {
            class: "student-search-item",
            onClick: () => {
              linkedIds.push(st.id);
              renderLinkedChips();
              searchInput.value = "";
              searchResultsWrap.style.display = "none";
              searchInput.focus();
            },
          },
          [
            el("div", { class: "student-avatar-chip" }, getInitials(st.fullName)),
            el("div", { style: "flex:1;" }, [
              el("div", { style: "font-weight:600; font-size:13px;" }, st.fullName),
              el(
                "div",
                { style: "font-size:11px; color:var(--color-ink-soft);" },
                `Adm: ${st.admissionNumber || "N/A"} · ${st.grade || ""} ${st.stream || ""}`
              ),
            ]),
            el("span", { class: "badge badge--success", style: "font-size:10px;" }, "+ Link"),
          ]
        );
        searchResultsWrap.append(item);
      });
    }
    searchResultsWrap.style.display = "block";
  }

  searchInput.addEventListener("input", (e) => filterSearch(e.target.value));

  body.append(
    el("div", { class: "field", style: "margin-bottom:0;" }, [
      el("label", {}, "Currently Linked Students:"),
      linkedTagsWrap,
    ]),
    el("div", { class: "field", style: "margin-bottom:0; position:relative;" }, [
      el("label", {}, "Search & Add Students:"),
      searchInput,
      searchResultsWrap,
    ])
  );

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const saveBtn = el("button", { type: "button", class: "btn btn--primary" }, [icon("save"), "Save Links"]);

  body.append(
    el("div", { style: "display:flex; justify-content:flex-end; gap:8px; margin-top:var(--sp-2);" }, [
      cancelBtn,
      saveBtn,
    ])
  );

  const close = openModal(`Manage Linked Students: ${parent.fullName}`, body);
  cancelBtn.addEventListener("click", close);

  saveBtn.addEventListener("click", async () => {
    const restore = busyButton(saveBtn, "Saving…");
    try {
      await updateParent(profile.uid, parent.id, { linkedStudentIds: linkedIds });
      toast(`Updated student links for ${parent.fullName}.`, "success");
      close();
      await refresh(profile);
    } catch (err) {
      console.error(err);
      toast("Failed to update student links.", "error");
      restore();
    }
  });
}

/**
 * Full Parent Create / Edit Form Modal.
 */
function openParentForm(profile, existing = null) {
  const isEdit = !!existing;
  let linkedIds = [...(existing?.linkedStudentIds || [])];

  const form = el("form", {});

  const fullNameInput = el("input", {
    type: "text",
    id: "p-fullName",
    value: existing?.fullName || "",
    required: "true",
    placeholder: "e.g. Samuel Kiprono Cheruiyot",
  });

  const relSelect = el(
    "select",
    { id: "p-relationship", style: "width:100%;" },
    [
      el("option", { value: "Father" }, "Father"),
      el("option", { value: "Mother" }, "Mother"),
      el("option", { value: "Guardian" }, "Guardian"),
      el("option", { value: "Sponsor" }, "Sponsor"),
      el("option", { value: "Other" }, "Other (Custom)"),
    ]
  );
  if (existing?.relationship) {
    const found = Array.from(relSelect.options).find((o) => o.value.toLowerCase() === existing.relationship.toLowerCase());
    if (found) {
      relSelect.value = found.value;
    } else {
      relSelect.value = "Other";
    }
  }

  const customRelInput = el("input", {
    type: "text",
    id: "p-customRel",
    placeholder: "Specify relationship (e.g. Uncle, Aunt, Grandparent)",
    value: existing?.relationship || "",
    style: relSelect.value === "Other" ? "display:block; margin-top:6px;" : "display:none; margin-top:6px;",
  });

  relSelect.addEventListener("change", (e) => {
    if (e.target.value === "Other") {
      customRelInput.style.display = "block";
      customRelInput.focus();
    } else {
      customRelInput.style.display = "none";
    }
  });

  const phoneInput = el("input", {
    type: "tel",
    id: "p-phone",
    value: existing?.phone || "",
    placeholder: "e.g. 0712345678 or +254 712 345 678",
  });

  const emailInput = el("input", {
    type: "email",
    id: "p-email",
    value: existing?.email || "",
    placeholder: "e.g. parent.name@example.com",
  });

  const occInput = el("input", {
    type: "text",
    id: "p-occupation",
    value: existing?.occupation || "",
    placeholder: "e.g. Secondary School Teacher, Engineer, Agronomist",
  });

  // Linked Students tag picker
  const linkedTagsWrap = el("div", { style: "display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; min-height:28px;" });

  function renderFormLinkedChips() {
    linkedTagsWrap.innerHTML = "";
    if (!linkedIds.length) {
      linkedTagsWrap.append(
        el("span", { class: "text-muted", style: "font-size:12px; font-style:italic;" }, "No students linked yet.")
      );
      return;
    }
    linkedIds.forEach((id) => {
      const st = students.find((s) => s.id === id);
      const name = st?.fullName || "Student";
      const adm = st?.admissionNumber ? ` (${st.admissionNumber})` : "";
      const chip = el(
        "span",
        {
          class: "badge badge--info",
          style: "display:inline-flex; align-items:center; gap:6px; padding:3px 8px; font-size:12px;",
        },
        [
          icon("school", "style=font-size:13px;"),
          `${name}${adm}`,
          el(
            "button",
            {
              type: "button",
              style:
                "background:none; border:none; color:inherit; cursor:pointer; font-weight:700; font-size:14px; padding:0 2px; line-height:1;",
              title: `Unlink ${name}`,
              onClick: () => {
                linkedIds = linkedIds.filter((x) => x !== id);
                renderFormLinkedChips();
              },
            },
            "×"
          ),
        ]
      );
      linkedTagsWrap.append(chip);
    });
  }
  renderFormLinkedChips();

  const searchStInput = el("input", {
    type: "text",
    placeholder: "Search student to link by name or admission number...",
    style: "width:100%;",
  });

  const searchStResults = el("div", {
    class: "student-search-results",
    style: "display:none; position:relative;",
  });

  function searchFormStudents(query) {
    if (!query || query.trim().length < 1) {
      searchStResults.style.display = "none";
      return;
    }
    const q = query.trim().toLowerCase();
    const matches = students
      .filter(
        (s) =>
          !linkedIds.includes(s.id) &&
          ((s.fullName || "").toLowerCase().includes(q) ||
            (s.admissionNumber || "").toLowerCase().includes(q))
      )
      .slice(0, 5);

    searchStResults.innerHTML = "";
    if (!matches.length) {
      searchStResults.append(
        el("div", { style: "padding:8px 12px; font-size:12px; color:var(--color-ink-soft);" }, "No unlinked matching students.")
      );
    } else {
      matches.forEach((st) => {
        const item = el(
          "div",
          {
            class: "student-search-item",
            onClick: () => {
              linkedIds.push(st.id);
              renderFormLinkedChips();
              searchStInput.value = "";
              searchStResults.style.display = "none";
              searchStInput.focus();
            },
          },
          [
            el("div", { class: "student-avatar-chip" }, getInitials(st.fullName)),
            el("div", { style: "flex:1;" }, [
              el("div", { style: "font-weight:600; font-size:13px;" }, st.fullName),
              el("div", { style: "font-size:11px; color:var(--color-ink-soft);" }, `Adm: ${st.admissionNumber || "N/A"}`),
            ]),
            el("span", { class: "badge badge--success", style: "font-size:10px;" }, "+ Link"),
          ]
        );
        searchStResults.append(item);
      });
    }
    searchStResults.style.display = "block";
  }

  searchStInput.addEventListener("input", (e) => searchFormStudents(e.target.value));

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, [
    icon(isEdit ? "save" : "person_add"),
    isEdit ? "Save Changes" : "Register Guardian",
  ]);

  form.append(
    el("div", { class: "field", style: "margin-bottom:var(--sp-3);" }, [
      el("label", { for: "p-fullName" }, [
        "Full Name ",
        el("span", { style: "color:var(--color-danger);" }, "*"),
      ]),
      fullNameInput,
    ]),

    el("div", { style: "display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:var(--sp-3);" }, [
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "p-relationship" }, "Relationship to Student"),
        relSelect,
        customRelInput,
      ]),
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "p-occupation" }, "Occupation / Profession"),
        occInput,
      ]),
    ]),

    el("div", { style: "display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:var(--sp-3);" }, [
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "p-phone" }, "Primary Phone Number"),
        phoneInput,
      ]),
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "p-email" }, "Email Address"),
        emailInput,
      ]),
    ]),

    el("div", { class: "field", style: "margin-bottom:var(--sp-4);" }, [
      el("label", {}, "Link Enrolled Children / Students"),
      linkedTagsWrap,
      searchStInput,
      searchStResults,
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [cancelBtn, submitBtn])
  );

  const close = openModal(isEdit ? `Edit Guardian: ${existing.fullName}` : "Register New Parent / Guardian", form);
  cancelBtn.addEventListener("click", close);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = fullNameInput.value.trim();
    if (!name) {
      toast("Parent full name is required.", "error");
      fullNameInput.focus();
      return;
    }

    let rel = relSelect.value;
    if (rel === "Other") {
      rel = customRelInput.value.trim() || "Guardian";
    }

    const restore = busyButton(submitBtn, isEdit ? "Saving…" : "Registering…");

    const payload = {
      fullName: name,
      relationship: rel,
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
      occupation: occInput.value.trim(),
      linkedStudentIds: linkedIds,
    };

    try {
      if (isEdit) {
        await updateParent(profile.uid, existing.id, payload);
        toast(`Guardian ${name} updated successfully.`, "success");
      } else {
        await createParent(profile.uid, payload);
        toast(`Guardian ${name} registered successfully.`, "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to save parent.", "error");
      restore();
    }
  });
}

export async function render({ profile }) {
  currentProfile = profile;
  [parents, students] = await Promise.all([listParents(), listStudents()]);

  const wrap = el("div", { class: "parents-page" });

  const total = parents.length;
  const linkedCount = parents.filter((p) => (p.linkedStudentIds || []).length > 0).length;
  const unlinkedCount = total - linkedCount;
  const withPhone = parents.filter((p) => Boolean((p.phone || "").trim())).length;

  // 1. Executive Hero Banner with Dynamic Liaison Mascot
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildParentsMascotSvg({ width: 125, height: 110 });

  const heroBanner = el("div", { class: "parents-hero" }, [
    el("div", { class: "parents-hero__content" }, [
      el("div", { class: "parents-hero__status-row" }, [
        el("span", { class: "badge badge--neutral", style: "display:inline-flex; align-items:center; gap:5px;" }, [
          icon("family_restroom", "style=font-size:14px; color:var(--color-primary-600);"),
          "Community & Welfare · Parent & Guardian Registry",
        ]),
      ]),
      el("h1", { class: "parents-hero__title" }, "Parents & Guardians Directory"),
      el(
        "p",
        { class: "parents-hero__desc" },
        "Manage verified parent contact directories, family relationships, emergency channels, and student guardian links."
      ),
      el("div", { class: "parents-hero__pills" }, [
        el("div", { class: "parents-pill" }, [icon("person"), `${total} Registered Guardians`]),
        el("div", { class: "parents-pill" }, [icon("link"), `${linkedCount} Linked to Students`]),
        el(
          "div",
          { class: `parents-pill${unlinkedCount > 0 ? " parents-pill--warning" : ""}` },
          [icon("link_off"), `${unlinkedCount} Pending Link`]
        ),
        el("div", { class: "parents-pill" }, [icon("phone_iphone"), `${withPhone} With Phone Reach`]),
      ]),
    ]),
    el("div", { class: "parents-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Connect school communications directly with parents!"),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 3. Consolidated Modern Filter & Action Toolbar
  const searchInput = el("input", {
    type: "search",
    placeholder: "Search parent, phone, email, occupation, or linked student...",
    value: filterText,
    style: "height:36px; padding-left:32px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); width:100%;",
    onInput: (e) => {
      filterText = e.target.value;
      reRender(profile);
    },
  });

  const relFilterSelect = el(
    "select",
    {
      style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
      onChange: (e) => {
        filterRelationship = e.target.value;
        reRender(profile);
      },
    },
    [
      el("option", { value: "" }, "All Relationships"),
      el("option", { value: "father" }, "Fathers"),
      el("option", { value: "mother" }, "Mothers"),
      el("option", { value: "guardian" }, "Guardians"),
      el("option", { value: "sponsor" }, "Sponsors"),
      el("option", { value: "other" }, "Others"),
    ]
  );

  // Segmented Link Status Tabs
  const statusTabs = el("div", { class: "btn-group", style: "display:inline-flex;" }, [
    el(
      "button",
      {
        type: "button",
        class: `btn btn--sm ${filterStatus === "all" ? "btn--primary" : "btn--ghost"}`,
        onClick: (e) => {
          filterStatus = "all";
          updateStatusTabButtons(e.currentTarget);
          reRender(profile);
        },
      },
      `All (${total})`
    ),
    el(
      "button",
      {
        type: "button",
        class: `btn btn--sm ${filterStatus === "linked" ? "btn--primary" : "btn--ghost"}`,
        onClick: (e) => {
          filterStatus = "linked";
          updateStatusTabButtons(e.currentTarget);
          reRender(profile);
        },
      },
      `Linked (${linkedCount})`
    ),
    el(
      "button",
      {
        type: "button",
        class: `btn btn--sm ${filterStatus === "unlinked" ? "btn--primary" : "btn--ghost"}`,
        onClick: (e) => {
          filterStatus = "unlinked";
          updateStatusTabButtons(e.currentTarget);
          reRender(profile);
        },
      },
      `Unlinked (${unlinkedCount})`
    ),
  ]);

  function updateStatusTabButtons(activeBtn) {
    for (const btn of statusTabs.querySelectorAll("button")) {
      btn.className = "btn btn--sm btn--ghost";
    }
    activeBtn.className = "btn btn--sm btn--primary";
  }

  const clearFiltersBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost btn--sm",
      title: "Clear filters",
      onClick: () => {
        filterText = "";
        filterRelationship = "";
        filterStatus = "all";
        searchInput.value = "";
        relFilterSelect.value = "";
        const firstBtn = statusTabs.querySelector("button");
        if (firstBtn) updateStatusTabButtons(firstBtn);
        reRender(profile);
      },
    },
    [icon("filter_alt_off"), "Clear"]
  );

  const filterToolbar = el(
    "div",
    {
      class: "card",
      style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);",
    },
    [
      el(
        "div",
        {
          style:
            "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;",
        },
        [
          // Left filters
          el(
            "div",
            {
              style:
                "display:flex; align-items:center; gap:10px; flex:1; min-width:min(100%, 320px); flex-wrap:wrap;",
            },
            [
              el("div", { style: "position:relative; flex:1; min-width:220px;" }, [
                el(
                  "span",
                  {
                    class: "material-symbols-rounded",
                    style:
                      "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--color-ink-soft); pointer-events:none;",
                  },
                  "search"
                ),
                searchInput,
              ]),
              relFilterSelect,
              statusTabs,
              clearFiltersBtn,
            ]
          ),
          // Right CTA
          el("div", { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }, [
            el(
              "button",
              {
                type: "button",
                class: "btn btn--primary btn--sm",
                onClick: () => openParentForm(profile),
              },
              [icon("person_add"), "Add Parent"]
            ),
          ]),
        ]
      ),
    ]
  );
  wrap.append(filterToolbar);

  // 4. Modern Table Container
  tableContainerEl = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainerEl);

  return wrap;
}

