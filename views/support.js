import {
  listSchoolTickets,
  raiseSupportTicket,
  resolveSupportTicket,
} from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let tickets = [];

function renderRow(ticket, profile) {
  const isOpen = ticket.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el(
    "span",
    { class: `badge badge--${isOpen ? "warning" : "success"}` },
    isOpen ? "Open" : "Resolved"
  );

  tr.append(
    el("td", { "data-label": "Subject & Details" }, [
      el("strong", {}, ticket.subject),
      el(
        "div",
        {
          class: "text-sm text-muted",
          style: "margin-top: 4px; max-width: 420px; white-space: normal; line-height: 1.4;",
        },
        ticket.message
      ),
    ]),
    el("td", { "data-label": "Date Raised" }, formatDate(ticket.raisedAt?.seconds * 1000) || "Unknown"),
    el("td", { "data-label": "Status" }, statusBadge),
    el("td", { "data-label": "Resolution / Reply" }, [
      !isOpen && ticket.resolutionNote
        ? el(
            "div",
            { class: "text-sm", style: "white-space: normal; max-width: 320px; line-height: 1.4;" },
            ticket.resolutionNote
          )
        : el("span", { class: "text-muted" }, "—"),
    ]),
    el("td", { "data-label": "Actions", class: "row-actions" }, [
      isOpen
        ? el(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              onClick: () => handleCloseTicket(ticket, profile),
            },
            [icon("check_circle"), "Close"]
          )
        : el("span", { class: "text-muted text-xs" }, "Resolved"),
    ])
  );
  return tr;
}

function renderTable(profile) {
  if (tickets.length === 0) {
    return el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "support_agent"),
        el("h3", {}, "No support tickets"),
        el("p", { class: "text-muted" }, "You haven't submitted any support requests to the platform administration yet."),
      ]),
    ]);
  }

  return el("div", { class: "card" }, [
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Subject & Details"),
            el("th", { style: "width: 140px;" }, "Date Raised"),
            el("th", { style: "width: 100px;" }, "Status"),
            el("th", {}, "Resolution / Reply"),
            el("th", { style: "width: 100px;" }, "Actions"),
          ]),
        ]),
        el("tbody", {}, tickets.map((t) => renderRow(t, profile))),
      ]),
    ]),
  ]);
}

function showRaiseTicketModal(profile) {
  const body = el("form", {});

  const subjectInput = el("input", {
    id: "ticket-subject",
    placeholder: "e.g. Need assistance with term fee structure update",
    required: "true",
  });

  const messageInput = el("textarea", {
    id: "ticket-message",
    placeholder: "Please describe the problem or question with as much detail as possible...",
    rows: "5",
    required: "true",
  });

  const cancelBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Cancel");
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, [icon("send"), "Submit Ticket"]);

  const actions = el(
    "div",
    { style: "display: flex; gap: var(--sp-2); justify-content: flex-end; margin-top: var(--sp-4);" },
    [cancelBtn, submitBtn]
  );

  body.append(
    el("p", { class: "text-sm text-muted", style: "margin-bottom: var(--sp-4);" }, "Submit a direct ticket to the ISKIFY360 team. We will review and respond promptly."),
    el("div", { class: "field" }, [
      el("label", { for: "ticket-subject" }, "Subject"),
      subjectInput,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "ticket-message" }, "Message / Description"),
      messageInput,
    ]),
    actions
  );

  const close = openModal("Contact Platform Support", body);

  cancelBtn.addEventListener("click", close);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = subjectInput.value.trim();
    const message = messageInput.value.trim();
    if (!subject || !message) {
      return toast("Please fill in both subject and message.", "error");
    }
    const restore = busyButton(e.submitter, "Submitting…");
    try {
      await raiseSupportTicket(profile.uid, { subject, message });
      toast("Support ticket submitted successfully.", "success");
      close();
      await loadData();
      reRender(profile);
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not submit ticket.", "error");
      restore();
    }
  });
}

async function handleCloseTicket(ticket, profile) {
  if (!confirm("Are you sure you want to close this ticket?")) return;
  try {
    await resolveSupportTicket(profile.uid, ticket.id, "Closed by school administrator.");
    toast("Ticket marked as resolved.", "success");
    await loadData();
    reRender(profile);
  } catch (err) {
    console.error(err);
    toast("Failed to close ticket.", "error");
  }
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

  const wrap = el("div", {});

  const newTicketBtn = el(
    "button",
    { class: "btn btn--primary", onClick: () => showRaiseTicketModal(profile) },
    [icon("add"), "New Ticket"]
  );

  const header = el("div", { class: "page-header" }, [
    el("div", {}, [
      el("p", { class: "text-sm text-muted" }, "Need help or encounter an issue? Reach out directly to us."),
    ]),
    el("div", { class: "page-header__actions" }, [newTicketBtn]),
  ]);
  wrap.append(header);

  // Direct Contact Channels Cards
  const contactCards = el(
    "div",
    {
      style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-5);",
    },
    [
      el("div", { class: "card", style: "display: flex; gap: var(--sp-3); align-items: flex-start;" }, [
        el(
          "div",
          {
            style: "background: var(--color-primary-100); color: var(--color-primary-700); padding: var(--sp-3); border-radius: var(--radius-md); display: grid; place-items: center;",
          },
          [icon("mail")]
        ),
        el("div", { style: "flex: 1;" }, [
          el("h3", { style: "margin: 0 0 4px 0; font-size: var(--fs-base);" }, "Email Support"),
          el(
            "p",
            { class: "text-sm text-muted", style: "margin: 0 0 8px 0; line-height: 1.4;" },
            "For general queries, billing questions, or detailed feature requests. Responds within 24h."
          ),
          el(
            "a",
            {
              href: "mailto:support@iskify360.com",
              class: "text-sm font-semibold",
              style: "color: var(--color-primary-700); text-decoration: none;",
            },
            "support@iskify360.com"
          ),
        ]),
      ]),
      el("div", { class: "card", style: "display: flex; gap: var(--sp-3); align-items: flex-start;" }, [
        el(
          "div",
          {
            style: "background: #E4F2E7; color: var(--color-green); padding: var(--sp-3); border-radius: var(--radius-md); display: grid; place-items: center;",
          },
          [icon("call")]
        ),
        el("div", { style: "flex: 1;" }, [
          el("h3", { style: "margin: 0 0 4px 0; font-size: var(--fs-base);" }, "Emergency Phone / WhatsApp"),
          el(
            "p",
            { class: "text-sm text-muted", style: "margin: 0 0 8px 0; line-height: 1.4;" },
            "For urgent blockers affecting live school operations. Available Mon–Fri, 8:00 AM – 5:00 PM EAT."
          ),
          el(
            "a",
            {
              href: "tel:+254700000000",
              class: "text-sm font-semibold",
              style: "color: var(--color-green); text-decoration: none;",
            },
            "+254 700 000 000"
          ),
        ]),
      ]),
    ]
  );
  wrap.append(contactCards);

  tableContainer = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainer);

  return wrap;
}