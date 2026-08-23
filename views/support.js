import {
  listSchoolTickets,
  raiseSupportTicket,
  resolveSupportTicket
} from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let tickets = [];

function renderRow(ticket, profile) {
  const isOpen = ticket.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el("span", { 
    class: `badge badge--${isOpen ? "warning" : "success"}` 
  }, isOpen ? "Open" : "Resolved");

  tr.append(
    el("td", {}, [
      el("strong", {}, ticket.subject),
      el("div", { class: "text-sm text-muted", style: "margin-top: 4px; max-width: 400px; white-space: normal;" }, ticket.message),
    ]),
    el("td", {}, formatDate(ticket.raisedAt?.seconds * 1000) || "Unknown"),
    el("td", {}, statusBadge),
    el("td", {}, [
      !isOpen && ticket.resolutionNote ? el("div", { class: "text-sm", style: "white-space: normal; max-width: 300px;" }, ticket.resolutionNote) : el("span", { class: "text-muted" }, "-")
    ]),
    el("td", { class: "actions-cell" }, [
      isOpen
        ? el("button", { class: "btn btn--sm btn--outline", onClick: () => showResolveModal(ticket, profile) }, [icon("check_circle"), "Close Ticket"])
        : ""
    ])
  );
  return tr;
}

function renderTable(profile) {
  if (tickets.length === 0) {
    return el("div", { class: "empty-state" }, [
      el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "support_agent"),
      el("h3", {}, "No support tickets"),
      el("p", { class: "text-muted" }, "You haven't contacted platform support yet.")
    ]);
  }

  return el("div", { class: "table-responsive" }, [
    el("table", { class: "data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Subject & Message"),
          el("th", { style: "width: 150px" }, "Date Raised"),
          el("th", { style: "width: 100px" }, "Status"),
          el("th", {}, "Resolution / Reply"),
          el("th", { style: "width: 120px" }, "Actions"),
        ]),
      ]),
      el("tbody", {}, tickets.map(t => renderRow(t, profile))),
    ])
  ]);
}

function showRaiseTicketModal(profile) {
  const subjectInput = el("input", { class: "input", placeholder: "Brief subject of your issue" });
  const messageInput = el("textarea", { class: "input", placeholder: "Please provide as much detail as possible...", rows: 5 });
  
  openModal({
    title: "Contact Platform Support",
    body: el("div", {}, [
      el("p", { class: "mb-md text-muted" }, "Raise an issue directly to the platform administrators."),
      el("div", { class: "form-group" }, [
        el("label", {}, "Subject"),
        subjectInput
      ]),
      el("div", { class: "form-group" }, [
        el("label", {}, "Message"),
        messageInput
      ])
    ]),
    actions: [
      { text: "Cancel", class: "btn btn--ghost", close: true },
      {
        text: "Submit Ticket",
        class: "btn btn--primary",
        onClick: async (e, close) => {
          if (!subjectInput.value.trim() || !messageInput.value.trim()) {
            return toast("Please fill in both subject and message.", "error");
          }
          await busyButton(e.target, async () => {
            try {
              await raiseSupportTicket(profile.uid, {
                subject: subjectInput.value,
                message: messageInput.value
              });
              toast("Ticket submitted successfully.", "success");
              await loadData();
              reRender(profile);
              close();
            } catch (err) {
              console.error(err);
              toast(err.message || "Failed to submit ticket.", "error");
            }
          });
        }
      }
    ]
  });
}

function showResolveModal(ticket, profile) {
  if (!confirm("Are you sure you want to close this ticket?")) return;
  
  // They can close their own ticket
  busyButton(null, async () => {
    try {
      await resolveSupportTicket(profile.uid, ticket.id, "Closed by school staff.");
      toast("Ticket closed.");
      await loadData();
      reRender(profile);
    } catch (err) {
      console.error(err);
      toast("Failed to close ticket.", "error");
    }
  }, true).catch(() => {});
}

async function loadData() {
  tickets = await listSchoolTickets();
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

  const newTicketBtn = el("button", { class: "btn btn--primary", onClick: () => showRaiseTicketModal(profile) }, [
    icon("add"), "New Ticket"
  ]);

  const toolbar = el("div", { class: "toolbar" }, [
    el("div", { class: "toolbar__left" }, []),
    el("div", { class: "toolbar__right" }, [newTicketBtn])
  ]);

  tableContainer = el("div", {}, [renderTable(profile)]);

  return el("div", { class: "page" }, [
    el("div", { class: "page-header" }, [
      el("h1", { class: "page-title" }, "Contact Support"),
      el("p", { class: "page-subtitle" }, "Raise an issue with the platform administration."),
    ]),
    toolbar,
    tableContainer
  ]);
}
