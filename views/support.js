import { listSchoolTickets, raiseSupportTicket } from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { caseStatus, caseStatusFilter, openRecordModal, recordEmpty, recordField } from "../js/components/records-workspace.js";

export { buildSupportMascotSvg } from "../js/components/mascot.js";

const SUPPORT_EMAIL = "iskify360.tech@gmail.com";
const TICKET_CATEGORIES = [
  ["Academic & Grading", "Academics & grading"],
  ["Attendance & Students", "Attendance & student records"],
  ["Fee Invoicing & Receipts", "Fees & receipts"],
  ["System Access & Accounts", "Accounts & access"],
  ["General Assistance", "General assistance"],
];

function ticketInfo(ticket) {
  const subject = ticket.subject || "Support ticket";
  const category = TICKET_CATEGORIES.find(([id]) => subject.startsWith(`[${id}] `));
  return {
    subject: category ? subject.slice(category[0].length + 3) : subject,
    reference: ticket.id ? `#${ticket.id.slice(0, 6).toUpperCase()}` : "",
    category: category?.[1],
    date: ticket.raisedAt ? formatDate(ticket.raisedAt) : "Date unavailable",
  };
}

export async function render({ profile }) {
  let tickets = [];
  let active = "all";
  let state = "loading";
  let requestVersion = 0;

  const page = el("div", { class: "records-workspace" });
  const list = el("div", { class: "records-list" });
  const result = el("p", { class: "records-muted", role: "status" });
  const search = el("input", { type: "search", id: "support-search", placeholder: "Search by subject or ticket ID" });
  const statusFilter = caseStatusFilter((status) => {
    active = status;
    update();
  });
  const newTicket = el("button", { type: "button", class: "btn btn--primary btn--sm", onClick: () => showNewTicket(profile, afterCreate) }, [icon("add"), "New ticket"]);
  const reset = el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: resetFilters }, "Clear filters");

  function resetFilters() {
    active = "all";
    search.value = "";
    update();
    search.focus();
  }

  function update() {
    const open = tickets.filter((ticket) => ticket.status === "open").length;
    statusFilter.update(active, { all: tickets.length, open, resolved: tickets.length - open });
    const query = search.value.trim().toLowerCase();
    const matching = tickets.filter((ticket) => {
      if (active === "open" && ticket.status !== "open") return false;
      if (active === "resolved" && ticket.status === "open") return false;
      const { reference, category } = ticketInfo(ticket);
      return [ticket.subject, ticket.message, reference, ticket.id && `#${ticket.id}`, category].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    reset.hidden = active === "all" && !query;
    result.textContent = state === "ready" && tickets.length && !reset.hidden ? `${matching.length} of ${tickets.length} tickets` : "";

    if (state === "loading") {
      list.replaceChildren(el("p", { class: "records-pending", role: "status" }, "Loading tickets…"));
    } else if (state === "error") {
      list.replaceChildren(recordEmpty("error_outline", "Tickets couldn’t load", "Try loading your school’s tickets again.",
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: reload }, "Retry")));
    } else if (!tickets.length) {
      list.replaceChildren(recordEmpty("confirmation_number", "No support tickets yet", "Create a ticket to track a request and see replies here."));
    } else if (!matching.length) {
      const noMatches = query ? "No tickets match this search" : `No ${active} tickets`;
      list.replaceChildren(recordEmpty("search_off", noMatches, "Try another search or clear your filters."));
    } else {
      list.replaceChildren(el("ul", { class: "support-ticket-list" }, matching.map(ticketRow)));
    }
  }

  async function reload() {
    const request = ++requestVersion;
    state = "loading";
    list.setAttribute("aria-busy", "true");
    update();
    try {
      const nextTickets = await listSchoolTickets();
      if (request !== requestVersion) return;
      tickets = nextTickets;
      state = "ready";
    } catch (error) {
      if (request !== requestVersion) return;
      console.error("Could not load support tickets", error);
      tickets = [];
      state = "error";
    }
    list.removeAttribute("aria-busy");
    update();
  }

  function afterCreate() {
    active = "open";
    search.value = "";
    return reload();
  }

  search.addEventListener("input", update);
  page.append(el("div", { class: "records-split" }, [
    el("section", { class: "records-card", "aria-labelledby": "support-tickets" }, [
      el("div", { class: "records-toolbar records-card-head" }, [el("h2", { id: "support-tickets" }, "Support tickets"), newTicket]),
      el("div", { class: "records-controls" }, [recordField("Search tickets", search),
        el("div", { class: "records-toolbar" }, [statusFilter.group, reset])]),
      el("div", { class: "records-result" }, result),
      list,
    ]),
    contactPanel(),
  ]));
  await reload();
  return page;
}

function ticketRow(ticket) {
  const { subject, reference, category, date } = ticketInfo(ticket);
  return el("li", { class: "support-ticket-item" }, [
    el("div", { class: "support-ticket-item__summary" }, [
      el("div", { class: "support-ticket-item__meta" }, [
        reference ? el("span", { class: "support-ticket-reference" }, reference) : null,
        category ? el("span", { class: "records-muted" }, category) : null,
      ]),
      el("h3", { class: "support-ticket-item__subject" }, subject),
      ticket.message ? el("p", { class: "records-excerpt" }, ticket.message) : null,
    ]),
    el("div", { class: "support-ticket-item__status" }, [
      caseStatus(ticket.status === "open"),
      el("span", { class: "records-muted" }, date),
    ]),
    el("button", {
      type: "button", class: "btn btn--ghost btn--sm support-ticket-item__view",
      "aria-label": `View ticket: ${subject}`,
      onClick: () => showTicket(ticket),
    }, ["View ticket", icon("chevron_right", { "aria-hidden": "true" })]),
  ]);
}

function contactPanel() {
  const copy = el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast("Support email copied.", "success");
    } catch {
      toast("Couldn’t copy the address. You can select and copy it from the email link.", "error");
    }
  } }, [icon("content_copy"), "Copy email"]);

  return el("aside", { class: "records-card support-contacts", "aria-labelledby": "support-contact" }, [
    el("div", { class: "records-card-head" }, [
      el("h2", { id: "support-contact" }, "Contact options"),
      el("p", { class: "records-muted" }, "Mon–Fri, 8:00 AM–5:00 PM EAT"),
    ]),
    el("div", { class: "support-contact-row" }, [
      icon("mail", { "aria-hidden": "true" }),
      el("div", {}, [
        el("h3", {}, "Email support"),
        el("p", { class: "records-muted" }, "For billing, receipts, or general questions."),
        el("a", { href: `mailto:${SUPPORT_EMAIL}` }, SUPPORT_EMAIL),
        el("div", { class: "records-actions" }, copy),
      ]),
    ]),
    el("div", { class: "support-contact-row" }, [
      icon("headset_mic", { "aria-hidden": "true" }),
      el("div", {}, [
        el("h3", {}, "Urgent help"),
        el("p", { class: "records-muted" }, "Call or message us when school operations are blocked."),
        el("a", { href: "tel:+254702495776" }, "+254 702 495 776"),
        el("div", { class: "records-actions" }, el("a", {
          class: "btn btn--ghost btn--sm",
          href: "https://wa.me/254702495776?text=Hello%20Eeskia%20Support%2C%20I%20need%20assistance%20with%20our%20school%20account.",
          target: "_blank", rel: "noopener noreferrer",
        }, [icon("chat"), "WhatsApp"])),
      ]),
    ]),
  ]);
}

function showNewTicket(profile, onCreated) {
  const category = el("select", { id: "ticket-category" }, TICKET_CATEGORIES.map(([id, label]) => el("option", { value: id }, label)));
  const subject = el("input", { id: "ticket-subject", placeholder: "e.g. Report cards won’t download", required: "" });
  const message = el("textarea", { id: "ticket-message", placeholder: "Which screen were you using, and what happened?", rows: 5, required: "" });
  const cancel = el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Cancel");
  const submit = el("button", { type: "submit", class: "btn btn--primary" }, [icon("send"), "Submit ticket"]);
  const form = el("form", { class: "records-dialog-body" }, [
    recordField("Category", category),
    recordField("Subject", subject),
    recordField("Description", message),
    el("div", { class: "records-dialog-actions" }, [cancel, submit]),
  ]);
  const close = openRecordModal("New support ticket", form, category);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!subject.value.trim() || !message.value.trim()) {
      toast("Enter a subject and description.", "error");
      (subject.value.trim() ? message : subject).focus();
      return;
    }
    if (submit.disabled) return;
    const restore = busyButton(submit, "Submitting…");
    try {
      await raiseSupportTicket(profile.uid, { subject: `[${category.value}] ${subject.value.trim()}`, message: message.value.trim() });
      toast("Support ticket submitted.", "success");
      close();
      await onCreated();
    } catch (error) {
      toast(error.message || "Couldn’t submit the ticket.", "error");
      restore();
    }
  });
}

function showTicket(ticket) {
  const isOpen = ticket.status === "open";
  const { subject, category, date } = ticketInfo(ticket);
  const metadata = [
    ticket.id ? ["Ticket ID", ticket.id] : null,
    ["Submitted", date],
    category ? ["Category", category] : null,
    !isOpen && ticket.resolvedAt ? ["Resolved", formatDate(ticket.resolvedAt)] : null,
  ].filter(Boolean);
  const done = el("button", { type: "button", class: "btn btn--primary", onClick: () => close() }, "Done");
  const body = el("div", { class: "records-dialog-body" }, [
    el("div", { class: "support-ticket-detail__header" }, [el("h4", { class: "records-detail-title" }, subject), caseStatus(isOpen)]),
    el("dl", { class: "support-ticket-detail__metadata" }, metadata.map(([label, value]) => el("div", {}, [
      el("dt", {}, label), el("dd", {}, value),
    ]))),
    el("section", { class: "records-detail" }, [el("h4", {}, "Ticket message"), el("p", {}, ticket.message || "No message recorded.")]),
    el("section", { class: "records-detail" }, [
      el("h4", {}, isOpen ? "Support response" : "Resolution"),
      el("p", {}, ticket.resolutionNote || (isOpen ? "Awaiting a response from platform support." : "No resolution note recorded.")),
    ]),
    el("div", { class: "records-dialog-actions" }, done),
  ]);
  const close = openRecordModal("Ticket details", body);
}
