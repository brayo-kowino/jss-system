import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn() }));
vi.mock("../../netlify/functions/lib/support-store.mjs", () => ({
  supportStore: store.get, supportTicketUrl: (id) => `https://example.test/app/#/support?ticket=${id}`,
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: store.send }) } }));

import action from "../../netlify/functions/support-ticket-action.mjs";
import followups, { overdueKinds } from "../../netlify/functions/support-ticket-followups.mjs";
import { businessDeadline } from "../../js/support-workflow.js";

let documents;
let autoId;

function collection(path) {
  const filters = [];
  let count = Infinity;
  let after = "";
  const api = { doc: (id = `auto-${++autoId}`) => {
    const refPath = `${path}/${id}`;
    return { id, path: refPath, collection: (name) => collection(`${refPath}/${name}`),
      get: async () => snapshot({ id, path: refPath }), set: async (value) => documents.set(refPath, value) };
  }, where(field, op, expected) {
    filters.push((value) => op === "==" ? value[field] === expected : value[field] <= expected);
    return api;
  }, orderBy() { return api; }, limit(value) { count = value; return api; }, startAfter(value) { after = value; return api; },
  async get() {
    const docs = [...documents.entries()].filter(([key, value]) => {
      const id = key.slice(path.length + 1);
      return key.startsWith(`${path}/`) && !id.includes("/") && id > after && filters.every((test) => test(value));
    }).slice(0, count).map(([key]) => snapshot(api.doc(key.slice(path.length + 1))));
    return { docs, size: docs.length };
  } };
  return api;
}

function snapshot(ref) {
  return { id: ref.id, ref, exists: documents.has(ref.path), data: () => documents.get(ref.path) };
}

async function runTransaction(apply) {
  const writes = [];
  const result = await apply({
    get: async (ref) => snapshot(ref), getAll: async (...refs) => refs.map(snapshot),
    create(ref, data) {
      if (documents.has(ref.path)) throw new Error("Document exists");
      writes.push(() => documents.set(ref.path, data));
    },
    update(ref, patch) { writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...patch })); },
  });
  writes.forEach((write) => write());
  return result;
}

async function call(uid, name, fields = {}, requestId = `${name}-sample-request-${++autoId}`) {
  const response = await action(new Request("http://localhost/support", {
    method: "POST", headers: { Authorization: `Bearer ${uid}` }, body: JSON.stringify({ action: name, requestId, ...fields }),
  }));
  return { status: response.status, ...(await response.json()) };
}

const eventsFor = (id) => [...documents.entries()].filter(([path]) => path.startsWith(`support_tickets/${id}/events/`)).map(([, data]) => data);
const updatesFor = (uid) => [...documents.entries()].filter(([path]) => path.startsWith(`users/${uid}/support_updates/`)).map(([, data]) => data.kind);

beforeEach(() => {
  autoId = 0;
  store.send.mockReset().mockResolvedValue({ accepted: ["example@test.test"] });
  documents = new Map([
    ["schools/school1", { schoolName: "Example Academy" }],
    ["users/reporter", { role: "admin", schoolId: "school1" }],
    ["users/staff", { role: "registrar", schoolId: "school1" }],
    ["users/outsider", { role: "admin", schoolId: "school2" }],
    ["users/support", { role: "super_admin" }],
    ["users/unverified", { role: "admin", schoolId: "school1" }],
  ]);
  store.get.mockReturnValue({ db: { collection, runTransaction, getAll: async (...refs) => refs.map(snapshot) }, auth: { verifyIdToken: async (uid) => {
    return { uid, deviceApprovedUntilMs: uid === "unverified" ? 0 : Date.now() + 60_000 };
  } } });
});

describe("Platform support workflow", () => {
  it("adds a receipt once, records replies and resolutions, and sends updates to the original reporter", async () => {
    const form = { subject: "Export report cards", message: "The export has blank pages." };
    const created = await call("reporter", "create", form, "create-stable-request-id");
    const duplicate = await call("reporter", "create", form, "create-stable-request-id");
    const { ticketId } = created;
    expect(created).toEqual(duplicate);
    expect(created.status).toBe(200);
    expect(await call("unverified", "reply", { ticketId, message: "Not verified" })).toMatchObject({ status: 403 });
    expect(await call("outsider", "reply", { ticketId, message: "Other school" })).toMatchObject({ status: 404 });
    expect(await call("staff", "resolve", { ticketId, message: "Invalid resolution" })).toMatchObject({ status: 403 });
    expect(await call("support", "reply", { ticketId, message: "Checking the export" })).toMatchObject({ status: 200 });
    expect(await call("support", "resolve", { ticketId, message: "Template corrected" })).toMatchObject({ status: 200 });
    expect(eventsFor(ticketId).map(({ type }) => type)).toEqual(["create", "reply", "resolve"]);
    expect(updatesFor("reporter")).toEqual(["received", "replied", "resolved"]);
    expect(updatesFor("staff")).toEqual([]);
    expect(documents.get(`support_tickets/${ticketId}`)).toMatchObject({ status: "resolved", resolutionNote: "Template corrected", firstResponseAt: expect.any(Date) });
    expect([...documents.values()].filter((entry) => entry.recipientId === "reporter")).toHaveLength(3);
  });

  it("retains legacy resolutions and feedback when a school requests more help and support reopens the ticket", async () => {
    documents.set("support_tickets/old", { status: "resolved", schoolId: "school1", raisedBy: "reporter", resolutionNote: "Prior resolution" });
    const fields = { ticketId: "old" };
    expect((await call("staff", "rate", { ...fields, score: 5 })).status).toBe(409);
    expect((await call("reporter", "rate", { ...fields, score: 5, comment: "Thanks" })).status).toBe(200);
    expect((await call("reporter", "rate", { ...fields, score: 4 })).status).toBe(409);
    expect((await call("staff", "help", { ...fields, message: "Still seeing the issue" })).status).toBe(200);
    expect((await call("staff", "help", { ...fields, message: "Same issue" })).status).toBe(409);
    expect(documents.get("support_tickets/old")).toMatchObject({ status: "resolved", followUpRequestedAt: expect.any(Date) });
    expect((await call("support", "reopen", fields)).status).toBe(200);
    expect(documents.get("support_tickets/old")).toMatchObject({ status: "open", cycle: 1, firstResponseAt: null, rating: { score: 5 } });
    expect(eventsFor("old").map(({ type }) => type)).toEqual(["resolve", "rate", "help", "reopen"]);
  });
});

describe("Support deadlines", () => {
  it("carries unused working hours into the next weekday in Nairobi", () => {
    const fridayAtFour = new Date("2026-11-27T13:00:00Z");
    expect(businessDeadline(fridayAtFour, 2).toISOString()).toBe("2026-11-30T06:00:00.000Z");
    expect(businessDeadline(fridayAtFour, 16).toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });

  it("treats reply and resolution deadlines independently and skips closed tickets", () => {
    const ticket = { status: "open", raisedAt: new Date("2026-11-26T08:00:00Z") };
    expect(overdueKinds(ticket, new Date("2026-11-26T10:00:00Z"))).toEqual(["first-response-overdue"]);
    const nextWeek = new Date("2026-12-01T08:00:00Z");
    expect(overdueKinds({ ...ticket, firstResponseAt: ticket.raisedAt }, nextWeek)).toEqual(["resolution-overdue"]);
    expect(overdueKinds({ ...ticket, status: "resolved" }, nextWeek)).toEqual([]);
  });
});

describe("Scheduled support follow-up", () => {
  it("sends a receipt to the reporter and sends each overdue reminder only once", async () => {
    documents.set("platform_settings/email", { smtpUser: "test@example.test", smtpPass: "synthetic", senderName: "Platform Desk", replyTo: "support@example.test" });
    documents.set("users/reporter", { role: "admin", schoolId: "school1", email: "reporter@example.test" });
    documents.set("support_tickets/older", { status: "open", schoolId: "school1", raisedAt: new Date("2025-01-01T08:00:00Z") });
    const created = await call("reporter", "create", { subject: "Export issue", message: "Test" });
    expect(created.status).toBe(200);
    const { ticketId } = created;
    const firstRun = await followups();
    expect(firstRun.status).toBe(200);
    expect(await firstRun.text()).toContain("processed 3 email updates");
    expect((await followups()).status).toBe(200);
    expect(store.send).toHaveBeenCalledTimes(3);
    const receipts = store.send.mock.calls.map(([email]) => email).filter((email) => email.to === "reporter@example.test");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ from: { name: "Platform Desk", address: "test@example.test" }, replyTo: "support@example.test" });
    expect(receipts[0].text).toContain(`ticket=${ticketId}`);
    expect(receipts[0].html).toContain("View ticket");
    expect([...documents.entries()].filter(([path, record]) => path.startsWith("support_delivery/") && record.status === "sent").map(([, record]) => record.ticketId))
      .toEqual([ticketId, "older", "older"]);
  });
});
