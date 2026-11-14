import {
  listSchoolTickets,
  raiseSupportTicket,
  resolveSupportTicket,
} from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let tickets = [];
let activeFilter = "all";
let tableContainer = null;

import { buildSupportMascotSvg } from "../js/components/mascot.js";
export { buildSupportMascotSvg };

function renderRow(ticket, profile) {
  const isOpen = ticket.status === "open";
  const tr = el("tr", { class: isOpen ? "" : "row-dimmed" });

  const statusBadge = el(
    "span",
    {
      class: `badge badge--${isOpen ? "warning" : "success"}`,
      style: "display:inline-flex; align-items:center; gap:4px; font-weight:600;",
    },
    [
      icon(isOpen ? "schedule" : "check_circle", "text-sm"),
      isOpen ? "Open" : "Resolved",
    ]
  );

  const ticketId = ticket.id ? `#${ticket.id.slice(0, 6).toUpperCase()}` : "";

  tr.append(
    el("td", { "data-label": "Subject & Details" }, [
      el("div", { style: "display:flex; align-items:center; gap:6px; margin-bottom:2px;" }, [
        ticketId ? el("span", { class: "support-ticket-id" }, ticketId) : "",
        el("strong", { style: "color:var(--color-primary-900); font-size:var(--fs-sm);" }, ticket.subject),
      ]),
      el(
        "div",
        {
          class: "text-sm text-muted",
          style: "max-width: 440px; white-space: normal; line-height: 1.4;",
        },
        ticket.message
      ),
    ]),
    el("td", { "data-label": "Date Raised" }, [
      el("span", { style: "display:inline-flex; align-items:center; gap:4px; font-size:var(--fs-xs); color:var(--color-ink-soft);" }, [
        icon("calendar_today", "text-sm"),
        formatDate(ticket.raisedAt?.seconds * 1000) || "Recent",
      ]),
    ]),
    el("td", { "data-label": "Status" }, statusBadge),
    el("td", { "data-label": "Resolution / Reply" }, [
      !isOpen && ticket.resolutionNote
        ? el("div", { class: "support-reply-bubble" }, [
            el("div", { style: "font-weight:600; font-size:11px; margin-bottom:2px; color:var(--color-primary-700);" }, "Support Team Reply:"),
            ticket.resolutionNote,
          ])
        : el("span", { class: "text-muted text-xs" }, "Pending response"),
    ]),
    el("td", { "data-label": "Actions", class: "row-actions" }, [
      el("div", { style: "display:flex; gap:6px; align-items:center;" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "View full ticket",
          onClick: () => showTicketDetailsModal(ticket, profile),
        }, [icon("visibility"), "View"]),
        isOpen
          ? el(
              "button",
              {
                type: "button",
                class: "btn btn--ghost btn--xs",
                title: "Mark ticket as resolved",
                style: "color:var(--color-green);",
                onClick: () => handleCloseTicket(ticket, profile),
              },
              [icon("check_circle"), "Resolve"]
            )
          : "",
      ]),
    ])
  );
  return tr;
}

function renderTable(profile) {
  const filteredTickets = tickets.filter((t) => {
    if (activeFilter === "open") return t.status === "open";
    if (activeFilter === "resolved") return t.status !== "open";
    return true;
  });

  const openCount = tickets.filter((t) => t.status === "open").length;
  const resolvedCount = tickets.filter((t) => t.status !== "open").length;

  const card = el("div", { class: "support-tickets-card" });

  // Filter toolbar
  const header = el("div", { class: "support-tickets-card__header" }, [
    el("div", { class: "support-tickets-card__title-group" }, [
      el("h3", { class: "support-tickets-card__title" }, [
        icon("confirmation_number"),
        "Your Support Tickets",
      ]),
      el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${tickets.length} total`),
    ]),
    el("div", { class: "support-filter-tabs" }, [
      filterButton("all", `All (${tickets.length})`, profile),
      filterButton("open", `Open (${openCount})`, profile),
      filterButton("resolved", `Resolved (${resolvedCount})`, profile),
    ]),
  ]);
  card.append(header);

  if (filteredTickets.length === 0) {
    card.append(
      el("div", { class: "empty-state", style: "padding: var(--sp-6) var(--sp-4);" }, [
        el("div", {
          style: "width:120px; margin:0 auto var(--sp-2);",
          innerHTML: buildSupportMascotSvg({ width: 120, height: 110 }),
        }),
        el("h3", { style: "margin:0 0 6px 0;" }, "No Support Tickets Found"),
        el(
          "p",
          { class: "text-muted text-sm", style: "max-width:380px; margin:0 auto var(--sp-4);" },
          activeFilter === "open"
            ? "Great news! You have no open issues or pending inquiries."
            : "No support tickets match this filter. Click '+ New Ticket' above whenever you need assistance."
        ),
      ])
    );
    return card;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, "Subject & Details"),
          el("th", { style: "width: 140px;" }, "Date Raised"),
          el("th", { style: "width: 110px;" }, "Status"),
          el("th", {}, "Resolution / Reply"),
          el("th", { style: "width: 130px;" }, "Actions"),
        ]),
      ]),
      el("tbody", {}, filteredTickets.map((t) => renderRow(t, profile))),
    ]),
  ]);
  card.append(tableWrap);

  return card;
}

function filterButton(id, label, profile) {
  const btn = el(
    "button",
    {
      type: "button",
      class: `support-filter-btn${activeFilter === id ? " support-filter-btn--active" : ""}`,
      onClick: () => {
        activeFilter = id;
        reRender(profile);
      },
    },
    label
  );
  return btn;
}

function showTicketDetailsModal(ticket, profile) {
  const isOpen = ticket.status === "open";
  const body = el("div", { style: "display:flex; flex-direction:column; gap:16px;" });

  const statusBadge = el(
    "span",
    { class: `badge badge--${isOpen ? "warning" : "success"}` },
    isOpen ? "Open" : "Resolved"
  );

  const headerInfo = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding-bottom:12px; border-bottom:1px solid var(--color-line);",
  }, [
    el("div", {}, [
      el("div", { style: "font-size:11px; font-weight:700; color:var(--color-primary-700);" }, `TICKET ${ticket.id ? `#${ticket.id.slice(0, 8).toUpperCase()}` : ""}`),
      el("div", { style: "font-size:var(--fs-xs); color:var(--color-ink-soft); margin-top:2px;" }, `Raised on ${formatDate(ticket.raisedAt?.seconds * 1000) || "Recent"}`),
    ]),
    statusBadge,
  ]);

  const subjectBox = el("div", {}, [
    el("label", { style: "font-size:var(--fs-xs); text-transform:uppercase; color:var(--color-ink-soft); font-weight:700;" }, "Subject"),
    el("h4", { style: "margin:4px 0 0; color:var(--color-primary-900);" }, ticket.subject),
  ]);

  const messageBox = el("div", {}, [
    el("label", { style: "font-size:var(--fs-xs); text-transform:uppercase; color:var(--color-ink-soft); font-weight:700;" }, "Your Message"),
    el("div", {
      style: "background:var(--color-cream-dim); padding:12px; border-radius:var(--radius-md); margin-top:4px; font-size:var(--fs-sm); line-height:1.5; white-space:pre-wrap;",
    }, ticket.message),
  ]);

  const replyBox = el("div", {}, [
    el("label", { style: "font-size:var(--fs-xs); text-transform:uppercase; color:var(--color-ink-soft); font-weight:700;" }, "Platform Support Resolution"),
    ticket.resolutionNote
      ? el("div", {
          style: "background:var(--color-surface-alt, var(--color-cream-dim)); border-left:4px solid var(--color-green); padding:12px; border-radius:0 var(--radius-md) var(--radius-md) 0; margin-top:4px; font-size:var(--fs-sm); line-height:1.5; color:var(--color-ink);",
        }, ticket.resolutionNote)
      : el("div", { style: "color:var(--color-ink-soft); font-size:var(--fs-sm); font-style:italic; margin-top:4px;" }, "Our support team is reviewing your ticket and will update you shortly."),
  ]);

  const footerActions = el("div", {
    style: "display:flex; justify-content:flex-end; gap:8px; padding-top:12px; border-top:1px solid var(--color-line);",
  });

  const closeBtn = el("button", { type: "button", class: "btn btn--ghost btn--sm" }, "Close");
  footerActions.append(closeBtn);

  if (isOpen) {
    const resolveBtn = el("button", { type: "button", class: "btn btn--primary btn--sm" }, [icon("check_circle"), "Mark Resolved"]);
    resolveBtn.addEventListener("click", async () => {
      closeModal();
      await handleCloseTicket(ticket, profile);
    });
    footerActions.append(resolveBtn);
  }

  body.append(headerInfo, subjectBox, messageBox, replyBox, footerActions);
  const closeModal = openModal("Ticket Details", body);
  closeBtn.addEventListener("click", closeModal);
}

function showRaiseTicketModal(profile) {
  const body = el("form", {});

  const categorySelect = el("select", { id: "ticket-category", style: "width:100%; margin-bottom:12px;" }, [
    el("option", { value: "Academic & Grading" }, "Academic & Grading Scale"),
    el("option", { value: "Attendance & Students" }, "Attendance & Student Registry"),
    el("option", { value: "Fee Invoicing & Receipts" }, "Fees & Accounting"),
    el("option", { value: "System Access & Accounts" }, "System Access & Security"),
    el("option", { value: "General Assistance" }, "General Assistance / Other"),
  ]);

  const subjectInput = el("input", {
    id: "ticket-subject",
    placeholder: "e.g. Assistance with report card mean points calculation",
    required: "true",
  });

  const messageInput = el("textarea", {
    id: "ticket-message",
    placeholder: "Please describe the question, screen, or student records involved in detail…",
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
    el("div", {
      style: "display:flex; align-items:center; gap:12px; background:var(--color-cream-dim); padding:10px 14px; border-radius:var(--radius-md); margin-bottom:var(--sp-4);",
    }, [
      el("div", {
        style: "width:48px; height:48px; flex-shrink:0;",
        innerHTML: buildSupportMascotSvg({ width: 48, height: 48 }),
      }),
      el("p", { class: "text-sm text-muted", style: "margin:0; line-height:1.4;" },
        "Submit your issue directly to the ISKIFY360 engineering desk. We investigate promptly."
      ),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "ticket-category" }, "Category"),
      categorySelect,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "ticket-subject" }, "Subject / Topic"),
      subjectInput,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "ticket-message" }, "Detailed Description"),
      messageInput,
    ]),
    actions
  );

  const close = openModal("Raise Support Ticket", body);

  cancelBtn.addEventListener("click", close);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const category = categorySelect.value;
    const rawSubject = subjectInput.value.trim();
    const message = messageInput.value.trim();
    if (!rawSubject || !message) {
      return toast("Please fill in both subject and description.", "error");
    }
    const subject = `[${category}] ${rawSubject}`;
    const restore = busyButton(e.submitter, "Submitting…");
    try {
      await raiseSupportTicket(profile.uid, { subject, message });
      toast("Support ticket dispatched successfully.", "success");
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
  if (!confirm("Are you sure you want to mark this ticket as resolved?")) return;
  try {
    await resolveSupportTicket(profile.uid, ticket.id, "Resolved by school administrator.");
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

function reRender(profile) {
  if (tableContainer) {
    tableContainer.innerHTML = "";
    tableContainer.appendChild(renderTable(profile));
  }
}

export async function render({ profile }) {
  await loadData();

  const wrap = el("div", { class: "support-page" });

  const mascotWrap = el("div", {
    class: "support-hero__mascot-wrap",
    style: "width:165px; height:150px; display:flex; align-items:center; justify-content:center; flex-shrink:0;",
    "aria-hidden": "true",
  });
  mascotWrap.innerHTML = buildSupportMascotSvg({ width: 165, height: 150 });

  const heroCard = el("div", { class: "support-hero" }, [
    el("div", { class: "support-hero__content" }, [
      el("h1", { class: "support-hero__title" }, "School Help & Support Center"),
      el(
        "p",
        { class: "support-hero__desc" },
        "Encountering an operational question about marks entry, fee reconciliation, or report cards? Our technical engineers are standing by."
      ),
      el("div", { class: "support-hero__pills" }, [
        el("div", { class: "support-pill" }, [icon("timer"), "Typical Response: < 2 Hours"]),
        el("div", { class: "support-pill" }, [icon("verified"), "Mon–Fri, 8:00 AM – 5:00 PM EAT"]),
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary",
        onClick: () => showRaiseTicketModal(profile),
      }, [icon("add"), "New Support Ticket"]),
    ]),

    // Animated Mascot with Speech Bubble
    el("div", { class: "support-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Hi! How can we assist your school today?"),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroCard);

  // 2. Direct Contact Channels Cards (Modern 3-Column Grid)
  const contactCards = el("div", { class: "support-channels-grid" }, [
    // Card 1: Email Support
    el("div", { class: "support-channel-card" }, [
      el("div", {}, [
        el("div", { class: "support-channel-card__head" }, [
          el("div", { class: "support-channel-card__icon-wrap support-channel-card__icon-wrap--mail" }, [
            icon("mark_email_read"),
          ]),
          el("div", {}, [
            el("span", { class: "support-channel-card__badge" }, "Standard Inquiries"),
            el("h4", { class: "support-channel-card__title" }, "Email Support Helpdesk"),
          ]),
        ]),
        el(
          "p",
          { class: "support-channel-card__desc" },
          "For formal requests, billing reconciliations, official receipts, or detailed feature suggestions."
        ),
      ]),
      el("div", { class: "support-channel-card__action-row" }, [
        el("a", {
          href: "mailto:iskify360.tech@gmail.com",
          class: "support-channel-card__contact-link support-channel-card__contact-link--mail",
        }, [icon("send", "text-sm"), "iskify360.tech@gmail.com"]),
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs",
          title: "Copy email address",
          onClick: async () => {
            await navigator.clipboard.writeText("iskify360.tech@gmail.com");
            toast("Support email copied to clipboard.", "success");
          },
        }, [icon("content_copy"), "Copy"]),
      ]),
    ]),

    // Card 2: Emergency Phone / WhatsApp
    el("div", { class: "support-channel-card" }, [
      el("div", {}, [
        el("div", { class: "support-channel-card__head" }, [
          el("div", { class: "support-channel-card__icon-wrap support-channel-card__icon-wrap--phone" }, [
            icon("headset_mic"),
          ]),
          el("div", {}, [
            el("span", { class: "support-channel-card__badge", style: "color:var(--color-green);" }, "Live Urgent Hotline"),
            el("h4", { class: "support-channel-card__title" }, "Emergency Phone & WhatsApp"),
          ]),
        ]),
        el(
          "p",
          { class: "support-channel-card__desc" },
          "For urgent blockers affecting live operations, timetable cutoffs, or report card dispatches."
        ),
      ]),
      el("div", { class: "support-channel-card__action-row" }, [
        el("a", {
          href: "tel:+254702495776",
          class: "support-channel-card__contact-link support-channel-card__contact-link--phone",
        }, [icon("call", "text-sm"), "+254 702 495 776"]),
        el("a", {
          href: "https://wa.me/254702495776?text=Hello%20Eeskia%20Support%2C%20I%20need%20assistance%20with%20our%20school%20account.",
          target: "_blank",
          rel: "noopener noreferrer",
          class: "btn btn--ghost btn--xs",
          style: "color:var(--color-green); font-weight:700;",
        }, [icon("chat"), "WhatsApp"]),
      ]),
    ]),

    // Card 3: In-App Ticket Desk
    el("div", { class: "support-channel-card" }, [
      el("div", {}, [
        el("div", { class: "support-channel-card__head" }, [
          el("div", { class: "support-channel-card__icon-wrap support-channel-card__icon-wrap--ticket" }, [
            icon("confirmation_number"),
          ]),
          el("div", {}, [
            el("span", { class: "support-channel-card__badge", style: "color:#B45309;" }, "Direct Tracking"),
            el("h4", { class: "support-channel-card__title" }, "Direct Support Ticket"),
          ]),
        ]),
        el(
          "p",
          { class: "support-channel-card__desc" },
          "Submit questions directly to our engineering queue with full audit history and status tracking."
        ),
      ]),
      el("div", { class: "support-channel-card__action-row" }, [
        el("span", { style: "font-size:var(--fs-xs); color:var(--color-ink-soft);" }, "Tracked in portal"),
        el("button", {
          type: "button",
          class: "btn btn--outline btn--xs",
          onClick: () => showRaiseTicketModal(profile),
        }, [icon("add_circle"), "Raise Ticket"]),
      ]),
    ]),
  ]);
  wrap.append(contactCards);

  // 3. Support Tickets Table Container
  tableContainer = el("div", {}, [renderTable(profile)]);
  wrap.append(tableContainer);

  return wrap;
}