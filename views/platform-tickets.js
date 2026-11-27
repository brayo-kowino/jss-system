import { getSupportTicket, listAllPlatformTickets } from "../js/services/support.service.js";
import { listSchools } from "../js/services/school.service.js";
import { openAccountRecoveryModal } from "../js/services/recovery.service.js";
import { getTicketTiming } from "../js/support-workflow.js";
import { openSupportTicket } from "../js/components/support-ticket.js";
import { caseStatus, recordEmpty, recordField } from "../js/components/records-workspace.js";
import { el, icon, formatDate } from "../js/utils.js";

const FILTERS = [["open", "Open tickets"], ["overdue", "Overdue"], ["follow-up", "Follow-up requested"], ["resolved", "Resolved"], ["all", "All tickets"]];
const dueLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function isCritical(ticket) {
  return ticket.priority === "critical" || ["account_compromise", "security_breach"].includes(ticket.category) || /compromise|quarantine|breach|hack/i.test(ticket.subject || "");
}

function dueLine(label, date, overdue) {
  return date ? el("span", { class: overdue ? "records-status records-status--open" : "records-muted" },
    `${label} ${overdue ? "overdue" : "due"} · ${dueLabel.format(date)} EAT`) : null;
}

function ticketRow(ticket, school, profile, show) {
  const timing = getTicketTiming(ticket);
  const critical = isCritical(ticket);
  const subject = ticket.subject || "Support ticket";
  const schoolName = (ticket.schoolName !== "Unknown School" && ticket.schoolName) || school?.schoolName || school?.name || "Unknown school";
  return el("li", { class: "support-ticket-item" }, [
    el("div", { class: "support-ticket-item__summary" }, [
      el("div", { class: "support-ticket-item__meta" }, [el("span", { class: "records-muted" }, schoolName),
        el("code", { class: "support-ticket-reference" }, `#${ticket.id.slice(0, 6).toUpperCase()}`),
        critical ? el("span", { class: "badge badge--danger" }, "Critical") : null]),
      el("h3", { class: "support-ticket-item__subject" }, subject),
      el("p", { class: "records-excerpt" }, ticket.message || ""),
      el("div", { class: "records-actions records-meta" }, [
        ticket.firstResponseAt ? el("span", { class: "records-muted" }, `First response · ${formatDate(ticket.firstResponseAt)}`) : null,
        ticket.status === "open" && !ticket.firstResponseAt ? dueLine("First response", timing.firstResponseDue, timing.firstResponseOverdue) : null,
        ticket.status === "open" ? dueLine("Resolution", timing.resolutionDue, timing.resolutionOverdue) : null,
        ticket.status === "resolved" && ticket.resolvedAt ? el("span", { class: "records-muted" }, `Resolved · ${formatDate(ticket.resolvedAt)}`) : null,
        ticket.followUpRequestedAt ? el("span", { class: "records-status records-status--open" }, "Follow-up requested") : null,
        ticket.rating ? el("span", { class: "records-muted" }, `Rating ${ticket.rating.score}/5`) : null,
      ]),
    ]),
    el("div", { class: "support-ticket-item__status" }, [caseStatus(ticket.status === "open"), el("span", { class: "records-muted" }, formatDate(ticket.raisedAt))]),
    el("div", { class: "support-ticket-item__view records-actions" }, [
      ticket.schoolId && !["unresolved", "unassigned"].includes(ticket.schoolId) ? el("button", {
        type: "button", class: `btn btn--sm ${critical ? "btn--danger" : "btn--ghost"}`,
        onClick: () => openAccountRecoveryModal(ticket.schoolId, ticket.contactEmail || ticket.raisedBy, profile),
      }, [icon("shield"), "Recovery"]) : null,
      el("button", { type: "button", class: "btn btn--ghost btn--sm", "aria-label": `View ticket: ${subject}`, onClick: () => show(ticket) },
        ["View ticket", icon("chevron_right", { "aria-hidden": "true" })]),
    ]),
  ]);
}

export async function render({ profile, params = {} }) {
  let version = 0;
  const list = el("div", { class: "records-list" });
  const results = el("p", { role: "status", class: "records-muted" });
  const search = el("input", { id: "platform-ticket-search", type: "search", placeholder: "Ticket, school or reference" });
  const filter = el("select", { id: "platform-ticket-filter" }, FILTERS.map(([id, label]) => el("option", { value: id }, label)));
  let tickets = [];
  let state = "loading";
  const schoolPromise = listSchools().catch(() => []);
  let schools = new Map();

  function matches(ticket) {
    const timing = getTicketTiming(ticket);
    if (filter.value === "overdue" && !timing.firstResponseOverdue && !timing.resolutionOverdue) return false;
    if (filter.value === "follow-up" && !ticket.followUpRequestedAt) return false;
    const school = schools.get(ticket.schoolId);
    return [ticket.id, `#${ticket.id}`, ticket.subject, ticket.message, ticket.schoolName, school?.schoolName, school?.name]
      .filter(Boolean).join(" ").toLowerCase().includes(search.value.trim().toLowerCase());
  }

  function show(ticket) {
    openSupportTicket(ticket, { profile, platform: true, onUpdate: reload });
  }

  function update() {
    results.textContent = "";
    if (state === "loading") {
      list.replaceChildren(el("p", { class: "records-pending", role: "status" }, "Loading tickets…"));
    } else if (state === "error") {
      list.replaceChildren(recordEmpty("error_outline", "Tickets couldn’t load", "Try loading the support queue again.",
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: reload }, "Retry")));
    } else {
      const visible = tickets.filter(matches);
      visible.sort((a, b) => Number(isCritical(b)) - Number(isCritical(a)) || Number(!!b.followUpRequestedAt) - Number(!!a.followUpRequestedAt));
      results.textContent = `${visible.length} ${visible.length === 1 ? "ticket" : "tickets"}`;
      list.replaceChildren(visible.length
        ? el("ul", { class: "support-ticket-list" }, visible.map((ticket) => ticketRow(ticket, schools.get(ticket.schoolId), profile, show)))
        : recordEmpty("confirmation_number", "No matching tickets", "Choose another queue or change your search."));
    }
  }

  async function reload() {
    const request = ++version;
    const status = { open: "open", overdue: "open", resolved: "resolved", "follow-up": "resolved" }[filter.value];
    state = "loading";
    update();
    try {
      const [data, entries] = await Promise.all([listAllPlatformTickets(status), schoolPromise]);
      if (request !== version) return;
      schools = new Map(entries.map((entry) => [entry.id, entry]));
      tickets = data;
      state = "ready";
    } catch (error) {
      if (request !== version) return;
      console.error("Failed to load platform tickets", error.code || error.name);
      state = "error";
    }
    update();
  }

  filter.addEventListener("change", reload);
  search.addEventListener("input", update);
  const page = el("div", { class: "records-workspace" }, el("section", { class: "records-card" }, [
    el("div", { class: "records-card-head" }, el("h2", {}, "Support queue")),
    el("div", { class: "records-controls records-controls--issues" }, [recordField("Search tickets", search), recordField("Queue", filter)]),
    el("div", { class: "records-result" }, results), list,
  ]));
  if (params.ticket) {
    const linked = /^[\w-]{1,128}$/.test(params.ticket) ? getSupportTicket(params.ticket).catch(() => null) : null;
    const [ticket] = await Promise.all([linked, reload()]);
    if (ticket) {
      const linkedTicket = el("button", { type: "button", hidden: "", "data-open-platform-ticket": "", onClick: () => {
        filter.focus();
        show(ticket);
      } });
      page.append(linkedTicket);
    }
    else list.prepend(el("p", { class: "records-pending", role: "status" }, "This ticket is unavailable."));
  } else await reload();
  return page;
}

export function init() {
  document.querySelector("[data-open-platform-ticket]")?.click();
}
