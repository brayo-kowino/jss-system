import {
  listAllPlatformTickets,
  resolveSupportTicket,
  reopenSupportTicket,
} from "../js/services/support.service.js";
import { listSchools } from "../js/services/school.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let tickets = [];
let schoolsMap = new Map();
let filterStatus = "open";

function renderRow(ticket, profile) {
  const isOpen = ticket.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el(
    "span",
    { class: `badge badge--${isOpen ? "warning" : "success"}` },
    isOpen ? "Open" : "Resolved"
  );

  const resolvedSchoolName =
    (ticket.schoolName && ticket.schoolName !== "Unknown School" ? ticket.schoolName : null) ||
    schoolsMap.get(ticket.schoolId)?.schoolName ||
    schoolsMap.get(ticket.schoolId)?.name ||
    ticket.schoolName ||
    "Unknown School";

  tr.append(
    el("td", { "data-label": "School" }, [
      el("strong", {}, resolvedSchoolName),
      el("div", { class: "text-xs text-muted" }, `ID: ${ticket.schoolId}`),
    ]),
    el("td", { "data-label": "Subject & Issue" }, [
      el("strong", {}, ticket.subject),
      el(
        "div",
        {
          class: "text-sm text-muted",
          style: "margin-top: 4px; max-width: 380px; white-space: normal; line-height: 1.4;",
        },
        ticket.message
      ),
    ]),
    el("td", { "data-label": "Submitted" }, formatDate(ticket.raisedAt?.seconds * 1000) || "Unknown"),
    el("td", { "data-label": "Status" }, statusBadge),
    el("td", { "data-label": "Resolution Note" }, [
      !isOpen && ticket.resolutionNote
        ? el(
            "div",
            { class: "text-sm", style: "white-space: normal; max-width: 300px; line-height: 1.4;" },
            ticket.resolutionNote
          )
        : el("span", { class: "text-muted" }, "—"),
    ]),
    el("td", { "data-label": "Actions", class: "row-actions" }, [
      isOpen
        ? el(
            "button",
            {
              class: "btn btn--primary btn--sm",
              onClick: () => showResolveModal(ticket, profile),
            },
            [icon("reply"), "Resolve"]
          )
        : el(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              onClick: () => handleReopen(ticket, profile),
            },
            [icon("undo"), "Reopen"]
          ),
    ])
  );
  return tr;
}

function renderTable(profile) {
  if (tickets.length === 0) {
    return el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "task_alt"),
        el("h3", {}, "Inbox Zero"),
        el("p", { class: "text-muted" }, "There are no tickets matching your current filter."),
      ]),
    ]);
  }

  return el("div", { class: "card" }, [
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "School"),
            el("th", {}, "Subject & Issue"),
            el("th", { style: "width: 140px;" }, "Submitted"),
            el("th", { style: "width: 100px;" }, "Status"),
            el("th", {}, "Resolution Note"),
            el("th", { style: "width: 110px;" }, "Actions"),
          ]),
        ]),
        el("tbody", {}, tickets.map((t) => renderRow(t, profile))),
      ]),
    ]),
  ]);
}

function showResolveModal(ticket, profile) {
  const body = el("form", {});

  const noteInput = el("textarea", {
    id: "platform-resolution-note",
    placeholder: "Write your response/resolution for the school staff to see...",
    rows: "5",
    required: "true",
  });

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const resolveBtn = el("button", { type: "submit", class: "btn btn--primary" }, [icon("send"), "Send Resolution"]);

  const actions = el(
    "div",
    { style: "display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-4);" },
    [cancelBtn, resolveBtn]
  );

  body.append(
    el("p", { class: "text-sm text-muted", style: "margin-bottom: var(--sp-4);" }, [
      "Providing a resolution for ",
      el("strong", {}, ticket.schoolName || "this school"),
      ".",
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "platform-resolution-note" }, "Resolution / Response"),
      noteInput,
    ]),
    actions
  );

  const close = openModal("Resolve School Ticket", body);

  cancelBtn.addEventListener("click", close);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = noteInput.value.trim();
    if (!note) return toast("Please provide a resolution response.", "error");
    const restore = busyButton(e.submitter, "Resolving…");
    try {
      await resolveSupportTicket(profile.uid, ticket.id, note);
      toast("Ticket resolved and school notified.", "success");
      close();
      await loadData();
      reRender(profile);
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to resolve ticket.", "error");
      restore();
    }
  });
}

async function handleReopen(ticket, profile) {
  if (!confirm(`Reopen ticket for ${ticket.schoolName}?`)) return;
  try {
    await reopenSupportTicket(profile.uid, ticket.id);
    toast("Ticket reopened.", "success");
    await loadData();
    reRender(profile);
  } catch (err) {
    console.error(err);
    toast("Failed to reopen ticket.", "error");
  }
}

async function loadData() {
  const [ticketsList, allSchools] = await Promise.all([
    listAllPlatformTickets(filterStatus),
    listSchools().catch(() => []),
  ]);
  tickets = ticketsList;
  schoolsMap = new Map((allSchools || []).map((s) => [s.id, s]));
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
      el("p", { class: "text-sm text-muted" }, "Incoming inquiries, bug reports, and assistance requests from tenant schools."),
    ]),
  ]);
  wrap.append(header);

  // Status Filter Card
  const statusSelect = el(
    "select",
    {
      onChange: async (e) => {
        filterStatus = e.target.value;
        await loadData();
        reRender(profile);
      },
    },
    [
      el("option", { value: "open" }, "Open Tickets"),
      el("option", { value: "resolved" }, "Resolved Tickets"),
      el("option", { value: "" }, "All Tickets"),
    ]
  );

  const filterCard = el("div", { class: "card", style: "margin-bottom: var(--sp-4);" }, [
    el("div", { class: "field", style: "margin-bottom: 0; max-width: 240px;" }, [
      el("label", {}, "Filter by Status"),
      statusSelect,
    ]),
  ]);
  wrap.append(filterCard);

  tableContainer = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainer);

  return wrap;
}
