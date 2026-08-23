import {
  listAllIssuesForSchool,
  resolveIssue,
  reopenIssue,
  issueCategoryLabel,
} from "../js/services/student-issue.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let issues = [];
let filterStatus = "";
let filterText = "";

function renderRow(issue, profile) {
  const isOpen = issue.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el(
    "span",
    { class: `badge badge--${isOpen ? "danger" : "success"}` },
    isOpen ? "Open" : "Resolved"
  );

  tr.append(
    el("td", { "data-label": "Student" }, [
      el("strong", {}, issue.studentName || "Unknown"),
      el("div", { class: "text-xs text-muted" }, `Adm: ${issue.admissionNumber || "N/A"}`),
    ]),
    el("td", { "data-label": "Category" }, issueCategoryLabel(issue.category)),
    el("td", { "data-label": "Description" }, [
      el("div", { style: "max-width: 340px; white-space: normal; line-height: 1.4;" }, issue.description),
      !isOpen && issue.resolutionNote
        ? el(
            "div",
            {
              class: "text-xs text-muted",
              style: "margin-top: 6px; border-left: 2px solid var(--color-primary-600); padding-left: 8px; line-height: 1.3;",
            },
            `Resolution: ${issue.resolutionNote}`
          )
        : "",
    ]),
    el("td", { "data-label": "Reported" }, [
      el("div", {}, formatDate(issue.raisedAt?.seconds * 1000) || "Unknown"),
      !isOpen && issue.resolvedAt
        ? el("div", { class: "text-xs text-muted" }, `Done: ${formatDate(issue.resolvedAt?.seconds * 1000)}`)
        : "",
    ]),
    el("td", { "data-label": "Status" }, statusBadge),
    el("td", { "data-label": "Actions", class: "row-actions" }, [
      isOpen
        ? el(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              onClick: () => showResolveModal(issue, profile),
            },
            [icon("check_circle"), "Resolve"]
          )
        : el(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              onClick: () => handleReopen(issue, profile),
            },
            [icon("undo"), "Reopen"]
          ),
    ])
  );
  return tr;
}

function renderTable(profile) {
  const filtered = issues.filter((i) => {
    if (filterStatus && i.status !== filterStatus) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      const matchName = i.studentName?.toLowerCase().includes(q);
      const matchAdm = i.admissionNumber?.toLowerCase().includes(q);
      const matchDesc = i.description?.toLowerCase().includes(q);
      if (!matchName && !matchAdm && !matchDesc) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "assignment_turned_in"),
        el("h3", {}, "No issues found"),
        el("p", { class: "text-muted" }, "No student issues match your current filters."),
      ]),
    ]);
  }

  return el("div", { class: "card" }, [
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Student"),
            el("th", {}, "Category"),
            el("th", {}, "Description"),
            el("th", { style: "width: 140px;" }, "Reported"),
            el("th", { style: "width: 100px;" }, "Status"),
            el("th", { style: "width: 110px;" }, "Actions"),
          ]),
        ]),
        el("tbody", {}, filtered.map((i) => renderRow(i, profile))),
      ]),
    ]),
  ]);
}

function showResolveModal(issue, profile) {
  const body = el("form", {});

  const noteInput = el("textarea", {
    id: "resolution-note",
    placeholder: "Explain what action was taken to resolve this (e.g. corrected marks in CAT 2)...",
    rows: "4",
  });

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const resolveBtn = el("button", { type: "submit", class: "btn btn--primary" }, [icon("check"), "Mark Resolved"]);

  const actions = el(
    "div",
    { style: "display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-4);" },
    [cancelBtn, resolveBtn]
  );

  body.append(
    el("p", { class: "text-sm text-muted", style: "margin-bottom: var(--sp-4);" }, [
      "Resolving issue for ",
      el("strong", {}, issue.studentName || "student"),
      ` (${issue.admissionNumber || "No Adm"}).`,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "resolution-note" }, "Resolution Note (Optional)"),
      noteInput,
    ]),
    actions
  );

  const close = openModal("Resolve Student Issue", body);

  cancelBtn.addEventListener("click", close);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Resolving…");
    try {
      await resolveIssue(profile.uid, issue.id, noteInput.value);
      toast("Issue marked as resolved.", "success");
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

async function handleReopen(issue, profile) {
  if (!confirm(`Reopen issue for ${issue.studentName}?`)) return;
  try {
    await reopenIssue(profile.uid, issue.id);
    toast("Issue reopened.", "success");
    await loadData();
    reRender(profile);
  } catch (err) {
    console.error(err);
    toast("Failed to reopen issue.", "error");
  }
}

async function loadData() {
  issues = await listAllIssuesForSchool();
}

let tableContainer;

function reRender(profile) {
  if (tableContainer) {
    tableContainer.innerHTML = "";
    tableContainer.appendChild(renderTable(profile));
  }
}

export async function render({ profile }) {
  await loadData();

  const wrap = el("div", {});

  const header = el("div", { class: "page-header" }, [
    el("div", {}, [
      el("h1", {}, "Student Issues & Disputes"),
      el("p", { class: "text-sm text-muted" }, "Track, investigate, and resolve front-desk student discrepancies across the school."),
    ]),
  ]);
  wrap.append(header);

  // Filters Card
  const searchInput = el("input", {
    type: "search",
    placeholder: "Search student name, admission number, or issue...",
    onInput: (e) => {
      filterText = e.target.value;
      reRender(profile);
    },
  });

  const statusSelect = el(
    "select",
    {
      onChange: (e) => {
        filterStatus = e.target.value;
        reRender(profile);
      },
    },
    [
      el("option", { value: "" }, "All Statuses"),
      el("option", { value: "open" }, "Open Issues"),
      el("option", { value: "resolved" }, "Resolved Issues"),
    ]
  );

  const filterCard = el("div", { class: "card", style: "margin-bottom: var(--sp-4);" }, [
    el("div", { class: "field-row" }, [
      el("div", { class: "field", style: "margin-bottom: 0;" }, [
        el("label", {}, "Search"),
        searchInput,
      ]),
      el("div", { class: "field", style: "margin-bottom: 0;" }, [
        el("label", {}, "Filter by Status"),
        statusSelect,
      ]),
    ]),
  ]);
  wrap.append(filterCard);

  tableContainer = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainer);

  return wrap;
}