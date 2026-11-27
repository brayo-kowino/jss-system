import { createHash } from "node:crypto";
import { supportStore } from "./lib/support-store.mjs";

const STAFF = new Set(["admin", "principal", "deputy_principal", "academic_master", "class_teacher", "subject_teacher", "bursar", "registrar"]);
const ACTIONS = new Set(["create", "reply", "resolve", "reopen", "help", "rate"]);
const ADMIN = new Set(["admin", "super_admin"]);
const ID = /^[\w-]{1,128}$/;
const REQUEST_ID = /^[\w-]{16,80}$/;

class TicketError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireText(value, limit, label, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || value.length > limit || (!optional && !value.trim())) {
    throw new TicketError(400, `${label} must contain ${optional ? "at most" : "1 to"} ${limit} characters.`);
  }
  return value.trim();
}

export function ticketTransition(ticket, action, fields, actor, now) {
  const platform = actor.role === "super_admin";
  const isOpen = ticket.status === "open";
  const resolutionText = (label) => requireText(fields.message, 6000, label);
  const firstResponse = ticket.firstResponseAt || now;
  if (action === "reply" && isOpen) {
    return { patch: platform ? { firstResponseAt: firstResponse } : {}, message: resolutionText("Reply"), notify: platform ? "replied" : "school-reply" };
  }
  if (action === "resolve" && platform && isOpen) {
    const message = resolutionText("Resolution");
    return { patch: { status: "resolved", resolutionNote: message, resolvedBy: actor.uid, resolvedAt: now, firstResponseAt: firstResponse }, message, notify: "resolved" };
  }
  if (action === "reopen" && platform && !isOpen) {
    return { patch: { status: "open", resolutionNote: "", resolvedBy: null, resolvedAt: null,
      followUpRequestedAt: null, firstResponseAt: null, cycleStartedAt: now, cycle: (ticket.cycle || 0) + 1 }, notify: "reopened" };
  }
  if (action === "help" && !platform && !isOpen) {
    if (ticket.followUpRequestedAt) throw new TicketError(409, "A follow-up has already been requested.");
    return { patch: { followUpRequestedAt: now }, message: resolutionText("Follow-up"), notify: "help" };
  }
  if (action === "rate" && !platform && !isOpen && ticket.raisedBy === actor.uid) {
    if (ticket.followUpRequestedAt || ticket.rating) throw new TicketError(409, "Feedback is no longer available for this ticket.");
    if (!Number.isInteger(fields.score) || fields.score < 1 || fields.score > 5) throw new TicketError(400, "Select a rating from 1 to 5.");
    return { patch: { rating: { score: fields.score, comment: requireText(fields.comment, 1500, "Comment", true), at: now, by: actor.uid } } };
  }
  throw new TicketError(409, "This action is unavailable for the current ticket. Refresh and try again.");
}

function identity(profile, token, now) {
  if (!profile || profile.status === "suspended" || !(profile.role === "super_admin" || STAFF.has(profile.role) && profile.schoolId)) {
    throw new TicketError(403, "Support tickets are unavailable for this account.");
  }
  if ((ADMIN.has(profile.role) && !(token.deviceApprovedUntilMs > now.getTime())) ||
    (profile.twoFactorEnabled && !(token.twoFactorVerifiedUntilMs > now.getTime()))) {
    throw new TicketError(403, "Verify this session before managing support tickets.");
  }
  return { uid: token.uid, role: profile.role, schoolId: profile.schoolId || null };
}

export default async function handler(request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") || "");
  if (!bearer) return Response.json({ error: "Sign in to use support tickets." }, { status: 401 });
  try {
    const { db, auth } = supportStore();
    let token;
    try { token = await auth.verifyIdToken(bearer[1], true); }
    catch { throw new TicketError(401, "Sign in again to use support tickets."); }

    const body = await request.json().catch(() => null);
    if (!body || !ACTIONS.has(body.action) || typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId) ||
      (body.action !== "create" && (typeof body.ticketId !== "string" || !ID.test(body.ticketId)))) {
      throw new TicketError(400, "Invalid support ticket request.");
    }
    const { action, requestId } = body;
    const key = createHash("sha256").update(`${token.uid}/${action}/${requestId}`).digest("hex").slice(0, 40);
    const ticketId = action === "create" ? key : body.ticketId;
    const ref = db.collection("support_tickets").doc(ticketId);
    const event = ref.collection("events").doc(key);
    const actorRef = db.collection("users").doc(token.uid);
    const now = new Date();

    await db.runTransaction(async (tx) => {
      const [actorSnap, ticketSnap, eventSnap] = await tx.getAll(actorRef, ref, event);
      const actor = identity(actorSnap.data(), token, now);
      const platform = actor.role === "super_admin";
      const existing = ticketSnap.data();
      let ticket = existing;
      let notification;
      let message = "";
      if (action === "create") {
        if (platform) throw new TicketError(403, "Only school staff can submit a school ticket.");
        if (existing?.raisedBy === actor.uid && existing.schoolId === actor.schoolId && eventSnap.exists) return;
        const school = (await tx.get(db.collection("schools").doc(actor.schoolId))).data();
        if (!school) throw new TicketError(403, "School unavailable.");
        ticket = { schoolId: actor.schoolId, schoolName: school.schoolName || school.name || "School", raisedBy: actor.uid,
          subject: requireText(body.subject, 220, "Subject"), message: requireText(body.message, 6000, "Description"),
          status: "open", raisedAt: now, cycleStartedAt: now, cycle: 0, workflowVersion: 1 };
        tx.create(ref, ticket);
        notification = "received";
      } else {
        if (!existing || (!platform && existing.schoolId !== actor.schoolId)) throw new TicketError(404, "Ticket unavailable.");
        if (!platform && (action === "resolve" || action === "reopen")) throw new TicketError(403, "Platform support manages ticket status.");
        if (eventSnap.exists) return;
        const result = ticketTransition(ticket, action, body, actor, now);
        if (!ticket.workflowVersion && ticket.resolutionNote) {
          tx.create(ref.collection("events").doc("legacy-resolution"), {
            type: "resolve", actor: "support", message: ticket.resolutionNote, at: ticket.resolvedAt || ticket.raisedAt || now,
          });
        }
        tx.update(ref, { ...result.patch, workflowVersion: 1, updatedAt: now });
        notification = result.notify;
        message = result.message || "";
      }
      tx.create(event, { type: action, actor: platform ? "support" : "school", at: now, message });
      tx.create(db.collection("audit_logs").doc(), { schoolId: platform ? null : actor.schoolId, userId: actor.uid,
        action: `${action === "create" ? "raise" : action}_support_ticket`, entity: "support_tickets", entityId: ticketId, timestamp: now });
      if (notification) {
        const platformAlert = notification === "help" || notification === "school-reply";
        const recipientId = !platformAlert && ticket.raisedBy !== "public_emergency_portal" ? ticket.raisedBy : null;
        const update = { kind: notification, schoolId: ticket.schoolId, ticketId, createdAt: now };
        if (recipientId) tx.create(db.collection("users").doc(recipientId).collection("support_updates").doc(key), update);
        tx.create(db.collection("support_delivery").doc(`${ticketId}_${key}`), {
          ...update, recipientId: recipientId || null, platform: platformAlert, status: "pending", nextAttemptAt: now, attempts: 0,
        });
      }
    });
    return Response.json({ ticketId });
  } catch (error) {
    if (error instanceof TicketError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Support ticket action failed", error.code || error.name);
    return Response.json({ error: "Couldn’t save the ticket update. Please try again." }, { status: 503 });
  }
}
