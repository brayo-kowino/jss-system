import {
  listAllIssuesForSchool,
  resolveIssue,
  reopenIssue,
  raiseIssue,
  ISSUE_CATEGORIES,
  issueCategoryLabel,
} from "../js/services/student-issue.service.js";
import { listStudents } from "../js/services/student.service.js";
import { el, icon, formatDate, formatDateTime, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

export const CATEGORY_META = {
  score_dispute: { label: "Wrong / Inaccurate Score", short: "Score Dispute", icon: "grading", color: "gold" },
  report_error: { label: "Report Card Error", short: "Report Error", icon: "description", color: "purple" },
  admission_error: { label: "Wrong Admission Details", short: "Admission Details", icon: "badge", color: "blue" },
  fee_discrepancy: { label: "Fee / Payment Discrepancy", short: "Fee Dispute", icon: "payments", color: "green" },
  attendance_dispute: { label: "Attendance Dispute", short: "Attendance", icon: "event_busy", color: "cyan" },
  other: { label: "General Discrepancy", short: "Other", icon: "help_outline", color: "gray" },
};

function getCategoryMeta(cat) {
  return (
    CATEGORY_META[cat] || {
      label: issueCategoryLabel(cat) || "Other Discrepancy",
      short: issueCategoryLabel(cat) || "Other",
      icon: "help_outline",
      color: "gray",
    }
  );
}

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ST";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Dynamic Student Discrepancy Investigator Mascot with magnifying glass and case dossier.
 */
export function buildIssuesMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="issues-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Student Discrepancy Desk Mascot">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Discrepancy Clipboard Dossier -->
        <g class="issues-mascot__folder">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Clipboard body -->
          <rect x="52" y="124" width="28" height="36" rx="2.5" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.4" transform="rotate(-6 66 142)" />
          <!-- Clipboard clip -->
          <rect x="59" y="120" width="14" height="6" rx="1.5" fill="#C9A227" stroke="#8C6F12" stroke-width="1" transform="rotate(-6 66 142)" />
          <!-- Checklist lines -->
          <line x1="56" y1="135" x2="74" y2="135" stroke="#0B2545" stroke-width="1.2" stroke-linecap="round" transform="rotate(-6 66 142)" />
          <line x1="56" y1="140" x2="70" y2="140" stroke="#64748B" stroke-width="1" stroke-linecap="round" transform="rotate(-6 66 142)" />
          <line x1="56" y1="145" x2="73" y2="145" stroke="#64748B" stroke-width="1" stroke-linecap="round" transform="rotate(-6 66 142)" />
          <!-- Green resolution check badge -->
          <circle cx="68" cy="151" r="3.2" fill="#059669" transform="rotate(-6 66 142)" />
          <!-- Hand Holding Clipboard -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Investigator Magnifying Glass with Animated Gleam -->
        <g class="issues-mascot__lens">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Magnifying glass handle -->
          <line x1="150" y1="110" x2="162" y2="98" stroke="#8C6F12" stroke-width="3.5" stroke-linecap="round" />
          <!-- Brass Lens Rim -->
          <circle cx="168" cy="92" r="13" fill="none" stroke="#C9A227" stroke-width="2.5" />
          <!-- Glass Optics Tint -->
          <circle cx="168" cy="92" r="11.5" fill="rgba(147, 197, 253, 0.45)" stroke="rgba(255,255,255,0.7)" stroke-width="1" />
          <!-- Lens Curved Reflection Gleam -->
          <path d="M162,86 A9 9 0 0 1 174 86" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.9" />
          <!-- Sparkle Star -->
          <polygon points="168,78 169.5,81 172.5,82.5 169.5,84 168,87 166.5,84 163.5,82.5 166.5,81" fill="#FEF08A" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Attentive Eyebrows -->
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

        <!-- Warm Smile -->
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

let issues = [];
let cachedStudents = [];
let filterStatus = "all";
let filterCategory = "";
let filterText = "";
let currentProfile = null;
let kpiGridEl = null;
let tableContainerEl = null;

function renderCategoryChip(catKey) {
  const meta = getCategoryMeta(catKey);
  return el("span", { class: `issue-category-chip issue-category-chip--${meta.color}` }, [
    icon(meta.icon),
    meta.short,
  ]);
}

function renderRow(issue, profile) {
  const isOpen = issue.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el(
    "span",
    {
      class: `badge badge--${isOpen ? "danger" : "success"}`,
      style: "display:inline-flex; align-items:center; gap:4px; font-weight:600;",
    },
    [
      icon(isOpen ? "hourglass_empty" : "check_circle", "style=font-size:13px;"),
      isOpen ? "Open" : "Resolved",
    ]
  );

  const initials = getInitials(issue.studentName);

  // Student profile cell
  const studentCell = el("td", { "data-label": "Student" }, [
    el("div", { style: "display:flex; align-items:center; gap:10px;" }, [
      el("div", { class: "student-avatar-chip" }, initials),
      el("div", {}, [
        el(
          "a",
          {
            href: `#/students?q=${encodeURIComponent(issue.admissionNumber || issue.studentName || "")}`,
            style: "font-weight:600; color:var(--color-primary-900); text-decoration:none; display:block;",
            title: "View student in student management",
          },
          issue.studentName || "Unknown Student"
        ),
        el(
          "span",
          {
            style:
              "display:inline-block; font-size:11px; padding:1px 6px; background:var(--color-cream); border:1px solid var(--color-line); border-radius:var(--radius-sm); color:var(--color-ink-soft); margin-top:2px;",
          },
          `Adm: ${issue.admissionNumber || "N/A"}`
        ),
      ]),
    ]),
  ]);

  // Category cell
  const catCell = el("td", { "data-label": "Category" }, [renderCategoryChip(issue.category)]);

  // Description & Resolution cell
  const descChildren = [
    el("div", { class: "issue-desc-cell" }, issue.description || "No description provided."),
  ];

  if (issue.context && (issue.context.academicYear || issue.context.term || issue.context.subjectCode)) {
    const ctxParts = [];
    if (issue.context.academicYear) ctxParts.push(issue.context.academicYear);
    if (issue.context.term) ctxParts.push(issue.context.term);
    if (issue.context.subjectCode) ctxParts.push(issue.context.subjectCode);

    descChildren.push(
      el(
        "div",
        {
          style:
            "display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--color-ink-soft); margin-top:4px; background:var(--color-cream); padding:1px 6px; border-radius:var(--radius-sm);",
        },
        [icon("school", "style=font-size:12px;"), ctxParts.join(" · ")]
      )
    );
  }

  if (!isOpen && issue.resolutionNote) {
    descChildren.push(
      el("div", { class: "resolution-quote" }, [
        el("div", { style: "display:flex; align-items:center; gap:4px; font-weight:600; margin-bottom:2px;" }, [
          icon("verified", "style=font-size:13px;"),
          "Resolution Note:",
        ]),
        el("div", {}, issue.resolutionNote),
      ])
    );
  }

  const descCell = el("td", { "data-label": "Discrepancy & Action" }, descChildren);

  // Reported timestamp cell
  const reportedDate = issue.raisedAt?.seconds ? new Date(issue.raisedAt.seconds * 1000) : null;
  const resolvedDate = issue.resolvedAt?.seconds ? new Date(issue.resolvedAt.seconds * 1000) : null;

  const reportedCell = el("td", { "data-label": "Reported" }, [
    el("div", { style: "font-weight:500; font-size:var(--fs-xs); color:var(--color-ink);" }, reportedDate ? formatDateTime(reportedDate) : "Recent"),
    !isOpen && resolvedDate
      ? el(
          "div",
          { style: "font-size:11px; color:var(--color-emerald-700, #047857); margin-top:3px;" },
          `Done: ${formatDate(resolvedDate)}`
        )
      : "",
  ]);

  // Actions cell
  const actionButtons = [];

  if (isOpen) {
    actionButtons.push(
      el(
        "button",
        {
          type: "button",
          class: "btn btn--primary btn--xs",
          title: "Resolve this issue and record action taken",
          onClick: () => showResolveModal(issue, profile),
        },
        [icon("check"), "Resolve"]
      )
    );
  } else {
    actionButtons.push(
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "Reopen this issue for further review",
          onClick: () => handleReopen(issue, profile),
        },
        [icon("undo"), "Reopen"]
      )
    );
  }

  actionButtons.push(
    el(
      "button",
      {
        type: "button",
        class: "btn btn--ghost btn--xs",
        title: "Inspect full case details and history",
        onClick: () => showDetailsModal(issue, profile),
      },
      [icon("visibility"), "Details"]
    )
  );

  const actionsCell = el("td", { "data-label": "Actions", class: "row-actions" }, [
    el("div", { style: "display:flex; align-items:center; gap:6px; justify-content:flex-end;" }, actionButtons),
  ]);

  tr.append(studentCell, catCell, descCell, reportedCell, el("td", { "data-label": "Status" }, [statusBadge]), actionsCell);
  return tr;
}

function getFilteredIssues() {
  return issues.filter((i) => {
    if (filterStatus === "open" && i.status !== "open") return false;
    if (filterStatus === "resolved" && i.status !== "resolved") return false;
    if (filterCategory && i.category !== filterCategory) return false;

    if (filterText) {
      const q = filterText.toLowerCase();
      const matchName = i.studentName?.toLowerCase().includes(q);
      const matchAdm = i.admissionNumber?.toLowerCase().includes(q);
      const matchDesc = i.description?.toLowerCase().includes(q);
      const matchNote = i.resolutionNote?.toLowerCase().includes(q);
      const catMeta = getCategoryMeta(i.category);
      const matchCat = catMeta.label.toLowerCase().includes(q) || catMeta.short.toLowerCase().includes(q);
      if (!matchName && !matchAdm && !matchDesc && !matchNote && !matchCat) return false;
    }
    return true;
  });
}

function renderTable(profile) {
  const filtered = getFilteredIssues();

  if (issues.length === 0) {
    return el("div", { class: "card", style: "padding:var(--sp-6) var(--sp-4); text-align:center;" }, [
      el("div", { class: "empty-state" }, [
        el(
          "span",
          {
            class: "material-symbols-rounded icon empty-state__icon",
            style: "font-size:48px; color:var(--color-primary-400);",
          },
          "assignment_turned_in"
        ),
        el("h3", { style: "margin-top:12px; font-size:var(--fs-lg);" }, "No Student Issues Recorded"),
        el(
          "p",
          { class: "text-muted", style: "max-width:440px; margin:6px auto 16px auto; font-size:var(--fs-sm);" },
          "All student records, marks, and fees are currently in order. Log discrepancies here whenever discrepancies arise."
        ),
        el(
          "button",
          {
            type: "button",
            class: "btn btn--primary btn--sm",
            onClick: () => showLogIssueModal(profile),
          },
          [icon("add_circle"), "Log First Issue"]
        ),
      ]),
    ]);
  }

  if (filtered.length === 0) {
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
        el("h3", { style: "margin-top:12px; font-size:var(--fs-md);" }, "No Matching Issues Found"),
        el(
          "p",
          { class: "text-muted", style: "max-width:400px; margin:6px auto 14px auto; font-size:var(--fs-sm);" },
          "No discrepancies match your active search terms or category filter. Try clearing your filters."
        ),
        el(
          "button",
          {
            type: "button",
            class: "btn btn--ghost btn--sm",
            onClick: () => {
              filterText = "";
              filterStatus = "all";
              filterCategory = "";
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
          el("span", { style: "font-weight:700; font-size:var(--fs-sm); color:var(--color-primary-900);" }, "Discrepancy Case Log"),
          el(
            "span",
            {
              class: "badge badge--info",
              style: "font-size:11px; padding:2px 7px;",
            },
            `Showing ${filtered.length} of ${issues.length}`
          ),
        ]),
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el(
            "button",
            {
              type: "button",
              class: "btn btn--primary btn--sm",
              onClick: () => showLogIssueModal(profile),
            },
            [icon("add_circle"), "Log Issue"]
          ),
        ]),
      ]
    ),
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", { class: "reports-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { style: "width:220px;" }, "Student"),
            el("th", { style: "width:150px;" }, "Category"),
            el("th", {}, "Discrepancy & Action"),
            el("th", { style: "width:130px;" }, "Reported"),
            el("th", { style: "width:105px;" }, "Status"),
            el("th", { class: "col-right", style: "width:150px;" }, "Actions"),
          ]),
        ]),
        el("tbody", {}, filtered.map((i) => renderRow(i, profile))),
      ]),
    ]),
  ]);

  return tableCard;
}

function buildKpis() {
  const total = issues.length;
  const openCount = issues.filter((i) => i.status === "open").length;
  const resolvedCount = issues.filter((i) => i.status === "resolved").length;
  const rate = total > 0 ? Math.round((resolvedCount / total) * 100) : 100;

  return [
    { label: "Total Logged Issues", value: String(total), icon: "assignment_late", color: "blue" },
    { label: "Awaiting Resolution", value: String(openCount), icon: "pending_actions", color: openCount > 0 ? "red" : "green" },
    { label: "Resolved Discrepancies", value: String(resolvedCount), icon: "check_circle", color: "green" },
    { label: "Resolution Rate", value: `${rate}%`, icon: "speed", color: "gold" },
  ];
}

function renderKpiGrid() {
  const kpis = buildKpis();
  return el(
    "div",
    { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" },
    kpis.map((k) =>
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
        el("div", { class: "md3-kpi-chip__data" }, [
          el("div", { class: "md3-kpi-chip__label" }, k.label),
          el("div", { class: "md3-kpi-chip__value" }, k.value),
        ]),
      ])
    )
  );
}

/**
 * Modal to log a new front-desk student discrepancy.
 */
async function showLogIssueModal(profile) {
  // Ensure students are loaded
  if (!cachedStudents.length) {
    try {
      cachedStudents = await listStudents();
    } catch (e) {
      console.warn("Could not preload students:", e);
    }
  }

  let selectedStudent = null;

  const form = el("form", {});

  // Student Search input with autocomplete dropdown
  const studentSearchInput = el("input", {
    type: "text",
    placeholder: "Search by student name or admission number...",
    autocomplete: "off",
    style: "width:100%;",
  });

  const searchResultsWrap = el("div", {
    class: "student-search-results",
    style: "display:none;",
  });

  const selectedStudentDisplay = el(
    "div",
    {
      style:
        "display:none; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--color-primary-50, #eff6ff); border:1px solid var(--color-primary-200, #bfdbfe); border-radius:var(--radius-md); margin-bottom:var(--sp-3);",
    },
    []
  );

  function updateSelectedStudent(st) {
    selectedStudent = st;
    if (st) {
      studentSearchInput.style.display = "none";
      searchResultsWrap.style.display = "none";
      selectedStudentDisplay.style.display = "flex";
      selectedStudentDisplay.innerHTML = "";
      selectedStudentDisplay.append(
        el("div", { style: "display:flex; align-items:center; gap:10px;" }, [
          el("div", { class: "student-avatar-chip" }, getInitials(st.fullName)),
          el("div", {}, [
            el("div", { style: "font-weight:700; color:var(--color-primary-900);" }, st.fullName || "Student"),
            el(
              "div",
              { style: "font-size:12px; color:var(--color-ink-soft);" },
              `Adm: ${st.admissionNumber || "N/A"} · ${st.grade || "Grade"} ${st.stream || ""}`
            ),
          ]),
        ]),
        el(
          "button",
          {
            type: "button",
            class: "btn btn--ghost btn--xs",
            onClick: () => {
              selectedStudent = null;
              selectedStudentDisplay.style.display = "none";
              studentSearchInput.style.display = "";
              studentSearchInput.value = "";
              studentSearchInput.focus();
            },
          },
          [icon("close"), "Change"]
        )
      );
    } else {
      selectedStudentDisplay.style.display = "none";
      studentSearchInput.style.display = "";
    }
  }

  function filterStudents(query) {
    if (!query || query.trim().length < 1) {
      searchResultsWrap.style.display = "none";
      return;
    }
    const q = query.trim().toLowerCase();
    const matches = cachedStudents
      .filter(
        (s) =>
          (s.fullName || "").toLowerCase().includes(q) ||
          (s.admissionNumber || "").toLowerCase().includes(q)
      )
      .slice(0, 7);

    searchResultsWrap.innerHTML = "";
    if (!matches.length) {
      searchResultsWrap.append(
        el(
          "div",
          { style: "padding:10px 12px; font-size:12px; color:var(--color-ink-soft);" },
          "No student found matching query."
        )
      );
    } else {
      matches.forEach((st) => {
        const item = el(
          "div",
          {
            class: "student-search-item",
            onClick: () => updateSelectedStudent(st),
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
            el("span", { class: "badge badge--info", style: "font-size:10px;" }, "Select"),
          ]
        );
        searchResultsWrap.append(item);
      });
    }
    searchResultsWrap.style.display = "block";
  }

  studentSearchInput.addEventListener("input", (e) => filterStudents(e.target.value));
  studentSearchInput.addEventListener("focus", (e) => filterStudents(e.target.value));

  // Category select
  const catSelect = el(
    "select",
    { id: "issue-category", required: "true", style: "width:100%;" },
    [
      el("option", { value: "" }, "-- Select Discrepancy Category --"),
      ...ISSUE_CATEGORIES.map((c) => el("option", { value: c.value }, c.label)),
    ]
  );

  // Optional Academic Context row
  const currentYear = new Date().getFullYear();
  const yearInput = el("input", {
    type: "number",
    id: "issue-context-year",
    value: String(currentYear),
    placeholder: String(currentYear),
    style: "width:100%;",
  });

  const termSelect = el(
    "select",
    { id: "issue-context-term", style: "width:100%;" },
    [
      el("option", { value: "" }, "Select Term (Optional)"),
      el("option", { value: "Term 1" }, "Term 1"),
      el("option", { value: "Term 2" }, "Term 2"),
      el("option", { value: "Term 3" }, "Term 3"),
    ]
  );

  const subjectInput = el("input", {
    type: "text",
    id: "issue-context-subject",
    placeholder: "e.g. Mathematics, English, General...",
    style: "width:100%;",
  });

  // Description textarea
  const descInput = el("textarea", {
    id: "issue-description",
    required: "true",
    rows: "3",
    placeholder:
      "Explain the exact issue clearly (e.g. Midterm marks entered as 45% instead of 75% recorded on student paper; fee receipt 4022 not reflected).",
    style: "width:100%; resize:vertical;",
  });

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, [
    icon("assignment_late"),
    "Log Discrepancy",
  ]);

  form.append(
    el("div", { class: "field", style: "position:relative; margin-bottom:var(--sp-3);" }, [
      el("label", {}, [
        "Student ",
        el("span", { style: "color:var(--color-danger);" }, "*"),
      ]),
      selectedStudentDisplay,
      studentSearchInput,
      searchResultsWrap,
    ]),

    el("div", { class: "field", style: "margin-bottom:var(--sp-3);" }, [
      el("label", { for: "issue-category" }, [
        "Discrepancy Category ",
        el("span", { style: "color:var(--color-danger);" }, "*"),
      ]),
      catSelect,
    ]),

    el("div", { style: "display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:var(--sp-3);" }, [
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "issue-context-year" }, "Academic Year"),
        yearInput,
      ]),
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "issue-context-term" }, "Term Cycle"),
        termSelect,
      ]),
      el("div", { class: "field", style: "margin-bottom:0;" }, [
        el("label", { for: "issue-context-subject" }, "Subject / Paper"),
        subjectInput,
      ]),
    ]),

    el("div", { class: "field", style: "margin-bottom:var(--sp-4);" }, [
      el("label", { for: "issue-description" }, [
        "Discrepancy Description & Findings ",
        el("span", { style: "color:var(--color-danger);" }, "*"),
      ]),
      descInput,
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [cancelBtn, submitBtn])
  );

  const close = openModal("Log New Student Discrepancy", form);
  cancelBtn.addEventListener("click", close);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedStudent) {
      toast("Please search and select a student record.", "error");
      studentSearchInput.focus();
      return;
    }
    const cat = catSelect.value;
    if (!cat) {
      toast("Please select a discrepancy category.", "error");
      catSelect.focus();
      return;
    }
    const desc = descInput.value.trim();
    if (!desc) {
      toast("Please provide an issue description.", "error");
      descInput.focus();
      return;
    }

    const restore = busyButton(submitBtn, "Logging…");
    try {
      const context = {
        academicYear: yearInput.value.trim() || undefined,
        term: termSelect.value.trim() || undefined,
        subjectCode: subjectInput.value.trim() || undefined,
      };

      await raiseIssue(profile.uid, {
        studentId: selectedStudent.id,
        studentName: selectedStudent.fullName,
        admissionNumber: selectedStudent.admissionNumber || "",
        category: cat,
        description: desc,
        context,
      });

      toast(`Discrepancy logged for ${selectedStudent.fullName}.`, "success");
      close();
      await loadData();
      reRender(profile);
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to log student issue.", "error");
      restore();
    }
  });
}

/**
 * Enhanced modal to resolve an issue with quick resolution shortcuts.
 */
function showResolveModal(issue, profile) {
  const body = el("form", {});

  const catMeta = getCategoryMeta(issue.category);

  const summaryCard = el(
    "div",
    {
      style:
        "padding:12px 14px; background:var(--color-cream); border:1px solid var(--color-line); border-radius:var(--radius-md); margin-bottom:var(--sp-4);",
    },
    [
      el("div", { style: "display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; flex-wrap:wrap; gap:8px;" }, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          el("div", { class: "student-avatar-chip" }, getInitials(issue.studentName)),
          el("strong", { style: "font-size:14px; color:var(--color-primary-900);" }, issue.studentName || "Student"),
          el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `Adm: ${issue.admissionNumber || "N/A"}`),
        ]),
        renderCategoryChip(issue.category),
      ]),
      el("div", { style: "font-size:var(--fs-xs); color:var(--color-ink-soft); line-height:1.4;" }, [
        el("strong", {}, "Reported: "),
        issue.description,
      ]),
    ]
  );

  const noteInput = el("textarea", {
    id: "resolution-note",
    placeholder: "Explain what action was taken to resolve this discrepancy (e.g. CAT 2 math score updated to 75% in gradebook, verified against physical paper)...",
    rows: "3",
    style: "width:100%; resize:vertical; margin-top:6px;",
  });

  // Quick action shortcut chips
  const quickNotes = [
    "Corrected score in gradebook & recalculated position",
    "Regenerated report card with verified scores",
    "Verified fee payment receipt and updated ledger",
    "Adjusted attendance register & notified class teacher",
    "Confirmed student admission details and updated profile",
  ];

  const quickWrap = el("div", { style: "display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 14px 0;" }, [
    el("div", { style: "width:100%; font-size:11px; font-weight:600; color:var(--color-ink-soft);" }, "Quick Resolution Shortcuts:"),
    ...quickNotes.map((q) =>
      el(
        "button",
        {
          type: "button",
          class: "quick-note-chip",
          onClick: () => {
            noteInput.value = q;
            noteInput.focus();
          },
        },
        [icon("add", "style=font-size:12px;"), q]
      )
    ),
  ]);

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const resolveBtn = el("button", { type: "submit", class: "btn btn--primary" }, [
    icon("check_circle"),
    "Mark as Resolved",
  ]);

  body.append(
    summaryCard,
    el("div", { class: "field", style: "margin-bottom:0;" }, [
      el("label", { for: "resolution-note" }, "Action Taken / Resolution Note"),
      noteInput,
      quickWrap,
    ]),
    el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [cancelBtn, resolveBtn])
  );

  const close = openModal("Resolve Student Discrepancy", body);
  cancelBtn.addEventListener("click", close);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(resolveBtn, "Resolving…");
    try {
      await resolveIssue(profile.uid, issue.id, noteInput.value);
      toast(`Issue resolved for ${issue.studentName || "student"}.`, "success");
      close();
      await loadData();
      reRender(profile);
    } catch (err) {
      console.error(err);
      toast("Failed to resolve issue.", "error");
      restore();
    }
  });
}

/**
 * Detailed Case Inspection Modal.
 */
function showDetailsModal(issue, profile) {
  const isOpen = issue.status === "open";
  const catMeta = getCategoryMeta(issue.category);
  const reportedDate = issue.raisedAt?.seconds ? new Date(issue.raisedAt.seconds * 1000) : null;
  const resolvedDate = issue.resolvedAt?.seconds ? new Date(issue.resolvedAt.seconds * 1000) : null;

  const content = el("div", { style: "display:flex; flex-direction:column; gap:16px;" });

  // Status banner
  content.append(
    el(
      "div",
      {
        style: `display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-radius:var(--radius-md); background:${
          isOpen ? "#fef2f2" : "#f0fdf4"
        }; border:1px solid ${isOpen ? "#fecaca" : "#bbf7d0"};`,
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon(isOpen ? "hourglass_empty" : "verified", `style=color:${isOpen ? "#dc2626" : "#16a34a"}; font-size:20px;`),
          el("div", {}, [
            el("div", { style: `font-weight:700; color:${isOpen ? "#991b1b" : "#166534"}; font-size:14px;` }, isOpen ? "Discrepancy Open & Pending Action" : "Discrepancy Successfully Resolved"),
            el("div", { style: "font-size:11px; color:var(--color-ink-soft);" }, isOpen ? "Awaiting investigation and administrative resolution." : `Resolved on ${resolvedDate ? formatDateTime(resolvedDate) : "Recently"}`),
          ]),
        ]),
        renderCategoryChip(issue.category),
      ]
    )
  );

  // Student Profile Card
  content.append(
    el(
      "div",
      {
        style:
          "display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:var(--color-cream); border:1px solid var(--color-line); border-radius:var(--radius-md); flex-wrap:wrap; gap:10px;",
      },
      [
        el("div", { style: "display:flex; align-items:center; gap:12px;" }, [
          el("div", { class: "student-avatar-chip", style: "width:40px; height:40px; font-size:13px;" }, getInitials(issue.studentName)),
          el("div", {}, [
            el("div", { style: "font-weight:700; font-size:15px; color:var(--color-primary-900);" }, issue.studentName || "Student"),
            el(
              "div",
              { style: "font-size:12px; color:var(--color-ink-soft);" },
              `Admission No: ${issue.admissionNumber || "N/A"}`
            ),
          ]),
        ]),
        el(
          "a",
          {
            href: `#/students?q=${encodeURIComponent(issue.admissionNumber || issue.studentName || "")}`,
            class: "btn btn--ghost btn--xs",
            onClick: () => close(),
          },
          [icon("person"), "Student Profile"]
        ),
      ]
    )
  );

  // Case details block
  const detailsGrid = el(
    "div",
    {
      style:
        "display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; padding:12px; border:1px solid var(--color-line); border-radius:var(--radius-md);",
    },
    [
      el("div", {}, [
        el("div", { style: "font-size:11px; font-weight:600; color:var(--color-ink-soft); text-transform:uppercase;" }, "Category"),
        el("div", { style: "font-weight:600; font-size:13px; margin-top:2px;" }, catMeta.label),
      ]),
      el("div", {}, [
        el("div", { style: "font-size:11px; font-weight:600; color:var(--color-ink-soft); text-transform:uppercase;" }, "Date Reported"),
        el("div", { style: "font-size:13px; margin-top:2px;" }, reportedDate ? formatDateTime(reportedDate) : "Recent"),
      ]),
      el("div", {}, [
        el("div", { style: "font-size:11px; font-weight:600; color:var(--color-ink-soft); text-transform:uppercase;" }, "Academic Context"),
        el(
          "div",
          { style: "font-size:13px; margin-top:2px;" },
          issue.context?.academicYear || issue.context?.term || issue.context?.subjectCode
            ? [issue.context.academicYear, issue.context.term, issue.context.subjectCode].filter(Boolean).join(" · ")
            : "General"
        ),
      ]),
    ]
  );
  content.append(detailsGrid);

  // Full statement
  content.append(
    el("div", {}, [
      el("div", { style: "font-size:12px; font-weight:700; color:var(--color-ink-soft); margin-bottom:4px;" }, "Discrepancy Details & Problem Statement:"),
      el(
        "div",
        {
          style:
            "padding:12px 14px; background:var(--color-white); border:1px solid var(--color-line); border-radius:var(--radius-md); line-height:1.5; font-size:13px;",
        },
        issue.description || "No description provided."
      ),
    ])
  );

  // Resolution section if resolved
  if (!isOpen && issue.resolutionNote) {
    content.append(
      el("div", {}, [
        el("div", { style: "font-size:12px; font-weight:700; color:#15803d; margin-bottom:4px;" }, "Resolution Audit Trail:"),
        el(
          "div",
          {
            style:
              "padding:12px 14px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:var(--radius-md); font-size:13px; color:#166534; line-height:1.5;",
          },
          [
            el("div", { style: "font-weight:600; margin-bottom:4px;" }, issue.resolutionNote),
            el(
              "div",
              { style: "font-size:11px; color:#15803d; opacity:0.85;" },
              `Action logged on ${resolvedDate ? formatDateTime(resolvedDate) : "N/A"}`
            ),
          ]
        ),
      ])
    );
  }

  // Action buttons
  const closeBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Close");
  const modalActions = el("div", { style: "display:flex; justify-content:flex-end; gap:8px; margin-top:8px;" }, [
    closeBtn,
  ]);

  if (isOpen) {
    const resolveActionBtn = el(
      "button",
      {
        type: "button",
        class: "btn btn--primary",
        onClick: () => {
          close();
          showResolveModal(issue, profile);
        },
      },
      [icon("check_circle"), "Resolve This Discrepancy"]
    );
    modalActions.append(resolveActionBtn);
  } else {
    const reopenActionBtn = el(
      "button",
      {
        type: "button",
        class: "btn btn--ghost",
        onClick: async () => {
          close();
          await handleReopen(issue, profile);
        },
      },
      [icon("undo"), "Reopen Discrepancy"]
    );
    modalActions.append(reopenActionBtn);
  }

  content.append(modalActions);

  const close = openModal("Discrepancy Case Dossier", content);
  closeBtn.addEventListener("click", close);
}

async function handleReopen(issue, profile) {
  if (!confirm(`Reopen discrepancy case for ${issue.studentName || "this student"}?`)) return;
  try {
    await reopenIssue(profile.uid, issue.id);
    toast("Issue reopened and marked as open.", "success");
    await loadData();
    reRender(profile);
  } catch (err) {
    console.error(err);
    toast("Failed to reopen issue.", "error");
  }
}

async function loadData() {
  const [issuesData, studentsData] = await Promise.all([
    listAllIssuesForSchool(),
    listStudents().catch(() => []),
  ]);
  issues = issuesData;
  cachedStudents = studentsData;
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

export async function render({ profile }) {
  currentProfile = profile;
  await loadData();

  const wrap = el("div", { class: "student-issues-page" });

  const total = issues.length;
  const openCount = issues.filter((i) => i.status === "open").length;
  const resolvedCount = issues.filter((i) => i.status === "resolved").length;
  const resolutionRate = total > 0 ? Math.round((resolvedCount / total) * 100) : 100;

  // 1. Executive Hero Banner with Dynamic Detective Mascot
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildIssuesMascotSvg({ width: 125, height: 110 });

  const heroBanner = el("div", { class: "issues-hero" }, [
    el("div", { class: "issues-hero__content" }, [
      el("h1", { class: "issues-hero__title" }, "Student Issues & Discrepancies"),
      el(
        "p",
        { class: "issues-hero__desc" },
        "Track, investigate, and resolve front-desk discrepancies regarding CBC scores, report card remarks, fee balances, and admission records."
      ),
      el("div", { class: "issues-hero__pills" }, [
        el("div", { class: "issues-pill" }, [icon("list_alt"), `${total} Total Cases`]),
        el(
          "div",
          { class: `issues-pill${openCount > 0 ? " issues-pill--danger" : ""}` },
          [icon("pending_actions"), `${openCount} Awaiting Action`]
        ),
        el("div", { class: "issues-pill" }, [icon("verified"), `${resolvedCount} Resolved`]),
        el("div", { class: "issues-pill" }, [icon("speed"), `${resolutionRate}% Resolution Rate`]),
      ]),
    ]),
    el("div", { class: "issues-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Investigate & resolve discrepancies swiftly!"),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 2. Executive KPI Metrics Strip
  kpiGridEl = el("div", {}, [renderKpiGrid()]);
  wrap.append(kpiGridEl);

  // 3. Consolidated Modern Filter & Action Toolbar
  const searchInput = el("input", {
    type: "search",
    placeholder: "Search student, admission no, discrepancy, category...",
    value: filterText,
    style: "height:36px; padding-left:32px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); width:100%;",
    onInput: (e) => {
      filterText = e.target.value;
      reRender(profile);
    },
  });

  const categorySelect = el(
    "select",
    {
      style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
      onChange: (e) => {
        filterCategory = e.target.value;
        reRender(profile);
      },
    },
    [
      el("option", { value: "" }, "All Categories"),
      ...ISSUE_CATEGORIES.map((c) => el("option", { value: c.value, selected: filterCategory === c.value ? "true" : undefined }, c.label)),
    ]
  );

  // Segmented Status Buttons
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
        class: `btn btn--sm ${filterStatus === "open" ? "btn--primary" : "btn--ghost"}`,
        onClick: (e) => {
          filterStatus = "open";
          updateStatusTabButtons(e.currentTarget);
          reRender(profile);
        },
      },
      `Open (${openCount})`
    ),
    el(
      "button",
      {
        type: "button",
        class: `btn btn--sm ${filterStatus === "resolved" ? "btn--primary" : "btn--ghost"}`,
        onClick: (e) => {
          filterStatus = "resolved";
          updateStatusTabButtons(e.currentTarget);
          reRender(profile);
        },
      },
      `Resolved (${resolvedCount})`
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
      title: "Clear all filters",
      onClick: () => {
        filterText = "";
        filterStatus = "all";
        filterCategory = "";
        searchInput.value = "";
        categorySelect.value = "";
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
          // Left: Search & category & status
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
              categorySelect,
              statusTabs,
              clearFiltersBtn,
            ]
          ),
          // Right: Action button
          el("div", { style: "display:flex; align-items:center; gap:8px; flex-shrink:0;" }, [
            el(
              "button",
              {
                type: "button",
                class: "btn btn--primary btn--sm",
                onClick: () => showLogIssueModal(profile),
              },
              [icon("add_circle"), "Log Student Issue"]
            ),
          ]),
        ]
      ),
    ]
  );
  wrap.append(filterToolbar);

  // 4. Data Table Container
  tableContainerEl = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainerEl);

  return wrap;
}