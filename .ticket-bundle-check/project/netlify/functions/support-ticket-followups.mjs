import { randomUUID } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { getTicketTiming } from "../../js/support-workflow.js";
import { supportStore, supportTicketUrl } from "./lib/support-store.mjs";
import { createPlatformEmailDispatcher } from "./lib/email-dispatch.mjs";
import { buildSupportTicketEmail } from "./lib/email-templates.mjs";

const MINUTE = 60_000;
const PAGE_SIZE = 80;
const ALERT_EMAIL = "iskify360.tech@gmail.com";
const EMAIL_TOPICS = {
  received: "Support ticket received",
  replied: "Platform support replied to your ticket",
  resolved: "Your support ticket was resolved",
  reopened: "Your support ticket was reopened",
  help: "A school needs more help with a resolved ticket",
  "school-reply": "A school replied to a support ticket",
  "first-response-overdue": "A support ticket is overdue for a first response",
  "resolution-overdue": "A support ticket is overdue for resolution",
};

export function overdueKinds(ticket, now) {
  const timing = getTicketTiming(ticket, now);
  const kinds = [];
  if (timing.firstResponseOverdue) kinds.push("first-response-overdue");
  if (timing.resolutionOverdue) kinds.push("resolution-overdue");
  return kinds;
}

async function queueOverdue(db, now) {
  const cursorRef = db.collection("support_workflow_state").doc("overdue-scan");
  const after = (await cursorRef.get()).data()?.cursor;
  let query = db.collection("support_tickets").where("status", "==", "open").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (after) query = query.startAfter(after);
  const batch = await query.get();
  const overdue = batch.docs.filter((snap) => overdueKinds(snap.data(), now).length);
  // Read reminder documents together, then recheck candidates transactionally
  // so a resolution or reopened cycle wins over a stale reminder scan.
  if (overdue.length) {
    const candidates = overdue.flatMap((snap) => overdueKinds(snap.data(), now).map((kind) => reminderRef(db, snap.id, snap.data(), kind)));
    const existing = new Set((await db.getAll(...candidates)).filter((snap) => snap.exists).map((snap) => snap.id));
    await Promise.all(overdue.filter((snap) => overdueKinds(snap.data(), now).some((kind) => !existing.has(reminderRef(db, snap.id, snap.data(), kind).id)))
      .map((snap) => db.runTransaction(async (tx) => {
        const current = (await tx.get(snap.ref)).data();
        if (!current) return;
        const kinds = overdueKinds(current, now);
        if (!kinds.length) return;
        const statuses = await tx.getAll(...kinds.map((kind) => reminderRef(db, snap.id, current, kind)));
        statuses.forEach((status, index) => {
          if (!status.exists) tx.create(status.ref, { kind: kinds[index], schoolId: current.schoolId || null, ticketId: snap.id,
            cycle: current.cycle || 0, platform: true, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now });
        });
      })));
  }
  await cursorRef.set({ cursor: batch.size === PAGE_SIZE ? batch.docs.at(-1).id : null });
}

function reminderRef(db, ticketId, ticket, kind) {
  return db.collection("support_delivery").doc(`${ticketId}_${ticket.cycle || 0}_${kind}`);
}

async function deliver(db, ref, send) {
  const claim = randomUUID();
  const item = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status !== "pending" || (data.nextAttemptAt?.toDate?.() ?? data.nextAttemptAt) > new Date()) return null;
    tx.update(ref, { claim, attempts: data.attempts + 1, nextAttemptAt: new Date(Date.now() + 5 * MINUTE) });
    return data;
  });
  if (!item) return;

  let status = "sent";
  try {
    const ticket = item.cycle != null ? (await db.collection("support_tickets").doc(item.ticketId).get()).data() : null;
    const staleReminder = item.cycle != null && (!ticket || (ticket.cycle || 0) !== item.cycle || !overdueKinds(ticket, new Date()).includes(item.kind));
    const [user, school] = await Promise.all([
      !item.platform && item.recipientId ? db.collection("users").doc(item.recipientId).get().then((snap) => snap.data()) : null,
      !item.platform && item.schoolId ? db.collection("schools").doc(item.schoolId).get().then((snap) => snap.data()) : null,
    ]);
    const address = item.platform ? process.env.SUPPORT_ALERT_EMAIL || ALERT_EMAIL :
      user && user.schoolId === item.schoolId && user.status !== "suspended" ? user.email : null;
    if (staleReminder || !address || !/^[^@\s<>,]+@[^@\s<>,]+\.[^@\s<>,]+$/.test(address)) {
      status = "skipped";
    } else {
      const email = buildSupportTicketEmail({
        title: EMAIL_TOPICS[item.kind],
        reference: `#${item.ticketId.slice(0, 6).toUpperCase()}`,
        ticketUrl: supportTicketUrl(item.ticketId, school?.slug, item.platform),
        askForFeedback: item.kind === "resolved",
      });
      await send({ ...email, to: address, messageId: `<${ref.id}@eeskia.iskify360.tech>` });
    }
  } catch (error) {
    console.warn("Support email attempt failed", item.kind, error.code || error.name);
    status = item.attempts >= 7 ? "failed" : "pending";
  }
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.claim !== claim) return;
    tx.update(ref, {
      claim: null, status, completedAt: status === "pending" ? null : new Date(),
      nextAttemptAt: status === "pending" ? new Date(Date.now() + Math.min(360, 10 * 2 ** item.attempts) * MINUTE) : null,
    });
  });
}

export default async function handler() {
  try {
    const { db } = supportStore();
    const now = new Date();
    await queueOverdue(db, now);
    const settings = await db.collection("platform_settings").doc("email").get().then((snap) => snap.data()).catch((error) => {
      console.warn("Couldn’t read platform email settings", error.code || error.name);
      return null;
    });
    const { send } = createPlatformEmailDispatcher(settings, { connectionTimeout: 6000, greetingTimeout: 5000, socketTimeout: 7500 });
    if (!send) return new Response("Platform email is not configured. Support updates remain in the queue.");

    const batch = await db.collection("support_delivery").where("status", "==", "pending")
      .where("nextAttemptAt", "<=", now).orderBy("nextAttemptAt").limit(15).get();
    const results = await Promise.allSettled(batch.docs.map((snap) => deliver(db, snap.ref, send)));
    if (results.some((result) => result.status === "rejected")) throw new Error("Some delivery records could not be updated");
    return new Response(`Checked overdue tickets and processed ${batch.size} email updates.`);
  } catch (error) {
    console.error("Support follow-up job failed", error.code || error.name);
    return new Response("Support follow-up failed.", { status: 500 });
  }
}

export const config = { schedule: "*/10 * * * *" };
