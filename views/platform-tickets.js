import {
  listAllPlatformTickets,
  resolveSupportTicket,
  reopenSupportTicket
} from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let tickets = [];
let filterStatus = "open";

function renderRow(ticket, profile) {
  const isOpen = ticket.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el("span", { 
    class: `badge badge--${isOpen ? "warning" : "success"}` 
  }, isOpen ? "Open" : "Resolved");

  tr.append(
    el("td", {}, [
      el("strong", {}, ticket.schoolName || "Unknown School"),
      el("div", { class: "text-sm text-muted" }, `ID: ${ticket.schoolId}`)
    ]),
    el("td", {}, [
      el("strong", {}, ticket.subject),
      el("div", { class: "text-sm text-muted", style: "margin-top: 4px; max-width: 300px; white-space: normal;" }, ticket.message),
    ]),
    el("td", {}, formatDate(ticket.raisedAt?.seconds * 1000) || "Unknown"),
    el("td", {}, statusBadge),
    el("td", {}, [
      !isOpen && ticket.resolutionNote ? el("div", { class: "text-sm", style: "white-space: normal; max-width: 250px;" }, ticket.resolutionNote) : el("span", { class: "text-muted" }, "-")
    ]),
    el("td", { class: "actions-cell" }, [
      isOpen
        ? el("button", { class: "btn btn--sm btn--primary", onClick: () => showResolveModal(ticket, profile) }, [icon("reply"), "Resolve"])
        : el("button", { class: "btn btn--sm btn--ghost", onClick: () => handleReopen(ticket, profile) }, [icon("undo"), "Reopen"])
    ])
  );
  return tr;
}

function renderTable(profile) {
  if (tickets.length === 0) {
    return el("div", { class: "empty-state" }, [
      el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "task_alt"),
      el("h3", {}, "Inbox Zero"),
      el("p", { class: "text-muted" }, "There are no tickets matching your filter.")
    ]);
  }

  return el("div", { class: "table-responsive" }, [
    el("table", { class: "data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "School"),
          el("th", {}, "Issue"),
          el("th", { style: "width: 120px" }, "Date Raised"),
          el("th", { style: "width: 100px" }, "Status"),
          el("th", {}, "Resolution"),
          el("th", { style: "width: 120px" }, "Actions"),
        ]),
      ]),
      el("tbody", {}, tickets.map(t => renderRow(t, profile))),
    ])
  ]);
}

function showResolveModal(ticket, profile) {
  const noteInput = el("textarea", { class: "input", placeholder: "Response to the school...", rows: 5 });
  
  const cancelBtn = el("button", { class: "btn btn--ghost" }, "Cancel");
  const resolveBtn = el("button", { class: "btn btn--primary" }, "Resolve");
  const actions = el("div", { class: "modal__actions", style: "display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px;" }, [cancelBtn, resolveBtn]);

  const bodyNode = el("div", {}, [
    el("p", { class: "mb-md" }, [
      "Resolving ticket for ", el("strong", {}, ticket.schoolName),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "Resolution / Reply"),
      noteInput
    ]),
    actions
  ]);
  
  const close = openModal("Resolve Ticket", bodyNode);
  
  cancelBtn.addEventListener("click", close);

  resolveBtn.addEventListener("click", async (e) => {
    if (!noteInput.value.trim()) {
      return toast("Please provide a resolution note.", "error");
    }
    await busyButton(e.target, async () => {
      try {
        await resolveSupportTicket(profile.uid, ticket.id, noteInput.value);
        toast("Ticket resolved.");
        await loadData();
        reRender(profile);
        close();
      } catch (err) {
        console.error(err);
        toast("Failed to resolve ticket.", "error");
      }
    });
  });
}

async function handleReopen(ticket, profile) {
  if (!confirm(`Reopen ticket for ${ticket.schoolName}?`)) return;
  try {
    await reopenSupportTicket(profile.uid, ticket.id);
    toast("Ticket reopened.");
    await loadData();
    reRender(profile);
  } catch (err) {
    console.error(err);
    toast("Failed to reopen ticket.", "error");
  }
}

async function loadData() {
  tickets = await listAllPlatformTickets(filterStatus);
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

  const statusSelect = el("select", {
    class: "input",
    style: "width: auto",
    onChange: async (e) => {
      filterStatus = e.target.value;
      await loadData();
      reRender(profile);
    }
  }, [
    el("option", { value: "open" }, "Open Tickets"),
    el("option", { value: "resolved" }, "Resolved Tickets"),
    el("option", { value: "" }, "All Tickets"),
  ]);

  const toolbar = el("div", { class: "toolbar" }, [
    el("div", { class: "toolbar__left" }, [
      statusSelect
    ]),
    el("div", { class: "toolbar__right" }, [])
  ]);

  tableContainer = el("div", {}, [renderTable(profile)]);

  return el("div", { class: "page" }, [
    el("div", { class: "page-header" }, [
      el("h1", { class: "page-title" }, "Platform Tickets"),
      el("p", { class: "page-subtitle" }, "Manage support tickets raised by schools."),
    ]),
    toolbar,
    tableContainer
  ]);
}
