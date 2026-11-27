import { el, icon, formatDate, busyButton, toast } from "../utils.js";
import { getSupportTicket, listSupportEvents, submitSupportAction } from "../services/support.service.js";
import { caseStatus, openRecordModal, recordField } from "./records-workspace.js";

export const SUPPORT_UPDATE_LABELS = {
  received: "Ticket received", replied: "Platform support replied", resolved: "Ticket resolved", reopened: "Ticket reopened",
};

function messageCard(label, message, at) {
  return el("section", { class: "records-detail" }, [
    el("div", { class: "records-toolbar" }, [el("h4", {}, label), at ? el("time", { class: "records-muted" }, formatDate(at)) : null]),
    message ? el("p", {}, message) : null,
  ]);
}

export function openSupportTicket(initialTicket, { profile, subject = initialTicket.subject, category, platform = false, onUpdate }) {
  let ticket = initialTicket;
  let events = [];
  let historyVersion = 0;
  let saving = false;
  const history = el("div", { class: "records-dialog-body" });
  const controls = el("div", { class: "records-dialog-body" });
  const header = el("div", { class: "support-ticket-detail__header" });
  const feedback = el("p", { class: "records-muted", role: "status" });
  const done = el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Done");
  const body = el("div", { class: "records-dialog-body support-ticket-detail" }, [
    header,
    el("p", { class: "records-muted" }, [category, ticket.id && `Ticket ID ${ticket.id}`].filter(Boolean).join(" · ")),
    history, controls, feedback, el("div", { class: "records-dialog-actions" }, done),
  ]);

  function renderHistory() {
    const items = [messageCard("Ticket message", ticket.message || "No message recorded.", ticket.raisedAt)];
    let hasReply = false;
    for (const { type, actor, at, message } of events) {
      const labels = { reply: actor === "support" ? "Platform support" : "School reply", resolve: "Resolution", reopen: "Ticket reopened", help: "School requested more help" };
      if (type === "reply" && actor === "support") hasReply = true;
      if (labels[type]) items.push(messageCard(labels[type], message, at));
    }
    if (ticket.resolutionNote && !events.some((event) => event.type === "resolve")) items.push(messageCard("Resolution", ticket.resolutionNote, ticket.resolvedAt));
    if (ticket.status === "open" && !ticket.firstResponseAt && !hasReply) items.push(el("p", { class: "records-muted" }, "Awaiting a response from platform support."));
    history.replaceChildren(...items);
  }

  async function refreshHistory() {
    if (!ticket.id) return;
    const request = ++historyVersion;
    try {
      const latest = await listSupportEvents(ticket.id);
      if (request !== historyVersion || !body.isConnected) return;
      events = latest;
      renderHistory();
    } catch {
      if (request !== historyVersion || !body.isConnected) return;
      feedback.replaceChildren("Conversation history couldn’t load. ", el("button", {
        type: "button", class: "btn btn--ghost btn--sm", onClick: () => { feedback.textContent = ""; refreshHistory(); },
      }, "Retry"));
    }
  }

  async function save(action, fields, button, requestId) {
    if (saving) return;
    saving = true;
    const restore = busyButton(button, "Saving…");
    feedback.textContent = "";
    try {
      await submitSupportAction(action, ticket.id, fields, requestId);
    } catch (error) {
      feedback.textContent = error.message;
      restore();
      saving = false;
      return;
    }
    try {
      ticket = await getSupportTicket(ticket.id) || ticket;
      if (body.isConnected) {
        refresh();
        done.focus();
        await refreshHistory();
      }
      await onUpdate?.(ticket);
    } catch {
      feedback.textContent = "Update saved. Reopen the ticket to refresh its details.";
      controls.replaceChildren();
    } finally {
      saving = false;
    }
  }

  function replyForm(help = false) {
    const message = el("textarea", { id: "support-ticket-reply", rows: 4, required: "", maxlength: 6000,
      placeholder: help ? "What still needs attention?" : "Add information to this conversation." });
    const reply = el("button", { type: "submit", class: "btn btn--primary btn--sm", value: help ? "help" : "reply" },
      help ? "Request follow-up" : "Post reply");
    const resolve = platform ? el("button", { type: "submit", class: "btn btn--ghost btn--sm", value: "resolve" }, "Post and resolve") : null;
    const ids = new Map();
    const form = el("form", { class: "records-dialog-body" }, [recordField(help ? "What still needs attention?" : "Reply", message),
      el("div", { class: "records-actions" }, [reply, resolve])]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!message.value.trim()) { message.focus(); return; }
      const button = event.submitter || reply;
      if (!ids.has(button.value)) ids.set(button.value, crypto.randomUUID());
      save(button.value, { message: message.value.trim() }, button, ids.get(button.value));
    });
    if (!help) return form;
    return el("details", { class: "records-details" }, [el("summary", {}, "I still need help"), form]);
  }

  function ratingForm() {
    const score = el("select", { id: "support-ticket-rating", required: "" }, [el("option", { value: "" }, "Select a rating"),
      ...[5, 4, 3, 2, 1].map((value) => el("option", { value }, `${value} out of 5`))]);
    const comment = el("textarea", { id: "support-ticket-comment", rows: 2, maxlength: 1500 });
    const submit = el("button", { type: "submit", class: "btn btn--ghost btn--sm" }, "Send feedback");
    const requestId = crypto.randomUUID();
    const form = el("form", { class: "records-dialog-body" }, [recordField("Rating", score), recordField("Comment (optional)", comment), el("div", {}, submit)]);
    form.addEventListener("submit", (event) => { event.preventDefault(); save("rate", { score: Number(score.value), comment: comment.value }, submit, requestId); });
    return el("details", { class: "records-details" }, [el("summary", {}, "Rate the support you received"), form]);
  }

  function refresh() {
    const open = ticket.status === "open";
    header.replaceChildren(el("h4", { class: "records-detail-title" }, subject || "Support ticket"), caseStatus(open));
    controls.replaceChildren();
    if (ticket.followUpRequestedAt) controls.append(el("p", { class: "records-muted" }, "Follow-up requested. Platform support will review this ticket."));
    if (ticket.rating && (platform || ticket.raisedBy === profile.uid)) {
      controls.append(messageCard(`${ticket.rating.score} out of 5 · Support feedback`, ticket.rating.comment, ticket.rating.at));
    }
    if (open) controls.append(replyForm());
    else if (platform) {
      const requestId = crypto.randomUUID();
      controls.append(el("div", {}, el("button", { type: "button", class: "btn btn--primary btn--sm", onClick: (event) => save("reopen", {}, event.currentTarget, requestId) },
        [icon("undo"), "Reopen ticket"])));
    } else if (!ticket.followUpRequestedAt) {
      controls.append(replyForm(true));
      if (ticket.raisedBy === profile.uid && !ticket.rating) controls.append(ratingForm());
    }
    renderHistory();
  }

  refresh();
  const close = openRecordModal("Ticket details", body);
  refreshHistory();
  return close;
}
