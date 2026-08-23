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

  const statusBadge = el("span", { 
    class: `badge badge--${isOpen ? "danger" : "success"}` 
  }, isOpen ? "Open" : "Resolved");

  tr.append(
    el("td", {}, [
      el("strong", {}, issue.studentName || "Unknown"),
      el("div", { class: "text-sm text-muted" }, issue.admissionNumber || ""),
    ]),
    el("td", {}, issueCategoryLabel(issue.category)),
    el("td", {}, [
      el("div", { style: "max-width: 300px; white-space: normal;" }, issue.description),
      !isOpen && issue.resolutionNote ? el("div", { class: "text-sm text-muted", style: "margin-top: 4px; border-left: 2px solid var(--border); padding-left: 8px;" }, `Resolution: ${issue.resolutionNote}`) : "",
    ]),
    el("td", {}, [
      el("div", {}, formatDate(issue.raisedAt?.seconds * 1000) || "Unknown"),
      !isOpen && issue.resolvedAt ? el("div", { class: "text-sm text-muted" }, `Resolved: ${formatDate(issue.resolvedAt?.seconds * 1000)}`) : ""
    ]),
    el("td", {}, statusBadge),
    el("td", { class: "actions-cell" }, [
      isOpen
        ? el("button", { class: "btn btn--sm btn--outline", onClick: () => showResolveModal(issue, profile) }, [icon("check_circle"), "Resolve"])
        : el("button", { class: "btn btn--sm btn--ghost", onClick: () => handleReopen(issue, profile) }, [icon("undo"), "Reopen"])
    ])
  );
  return tr;
}

function renderTable(profile) {
  const filtered = issues.filter(i => {
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
    return el("div", { class: "empty-state" }, [
      el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "assignment_turned_in"),
      el("h3", {}, "No issues found"),
      el("p", { class: "text-muted" }, "There are no student issues matching your filters.")
    ]);
  }

  return el("div", { class: "table-responsive" }, [
    el("table", { class: "data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Student"),
          el("th", {}, "Category"),
          el("th", {}, "Description"),
          el("th", {}, "Date"),
          el("th", {}, "Status"),
          el("th", { style: "width: 100px" }, "Actions"),
        ]),
      ]),
      el("tbody", {}, filtered.map(i => renderRow(i, profile))),
    ])
  ]);
}

function showResolveModal(issue, profile) {
  const noteInput = el("textarea", { class: "input", placeholder: "How was this resolved? (optional)", rows: 3 });
  
  const cancelBtn = el("button", { class: "btn btn--ghost" }, "Cancel");
  const resolveBtn = el("button", { class: "btn btn--primary" }, "Resolve");
  const actions = el("div", { class: "modal__actions", style: "display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px;" }, [cancelBtn, resolveBtn]);

  const bodyNode = el("div", {}, [
    el("p", { class: "mb-md" }, [
      "Mark issue as resolved for ", el("strong", {}, issue.studentName), "?"
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "Resolution Note"),
      noteInput
    ]),
    actions
  ]);
  
  const close = openModal("Resolve Issue", bodyNode);

  cancelBtn.addEventListener("click", close);

  resolveBtn.addEventListener("click", async (e) => {
    await busyButton(e.target, async () => {
      await resolveIssue(profile.uid, issue.id, noteInput.value);
      toast("Issue resolved.");
      await loadData();
      reRender(profile);
      close();
    });
  });
}

async function handleReopen(issue, profile) {
  if (!confirm(`Reopen issue for ${issue.studentName}?`)) return;
  try {
    await reopenIssue(profile.uid, issue.id);
    toast("Issue reopened.");
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

  const searchInput = el("input", {
    type: "search",
    class: "input",
    placeholder: "Search name, adm...",
    style: "max-width: 250px",
    onInput: (e) => {
      filterText = e.target.value;
      reRender(profile);
    }
  });

  const statusSelect = el("select", {
    class: "input",
    style: "width: auto",
    onChange: (e) => {
      filterStatus = e.target.value;
      reRender(profile);
    }
  }, [
    el("option", { value: "" }, "All Statuses"),
    el("option", { value: "open" }, "Open"),
    el("option", { value: "resolved" }, "Resolved"),
  ]);

  const toolbar = el("div", { class: "toolbar" }, [
    el("div", { class: "toolbar__left" }, [
      el("div", { class: "search-box" }, [
        icon("search", "search-box__icon"),
        searchInput
      ]),
      statusSelect
    ]),
    el("div", { class: "toolbar__right" }, [])
  ]);

  tableContainer = el("div", {}, [renderTable(profile)]);

  return el("div", { class: "page" }, [
    el("div", { class: "page-header" }, [
      el("h1", { class: "page-title" }, ""),
      el("p", { class: "page-subtitle" }, "Track and resolve front-desk issues across the school."),
    ]),
    toolbar,
    tableContainer
  ]);
}
