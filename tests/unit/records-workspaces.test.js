import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  tickets: vi.fn(), platformTickets: vi.fn(), raiseTicket: vi.fn(), getTicket: vi.fn(), ticketEvents: vi.fn(), ticketUpdates: vi.fn(), supportAction: vi.fn(),
  issues: vi.fn(), raiseIssue: vi.fn(), resolveIssue: vi.fn(), reopenIssue: vi.fn(), students: vi.fn(),
  logsSince: vi.fn(), recentLogs: vi.fn(),
}));
vi.mock("../../js/services/support.service.js", () => ({
  listSchoolTickets: data.tickets, raiseSupportTicket: data.raiseTicket, getSupportTicket: data.getTicket,
  listSupportEvents: data.ticketEvents, listSupportUpdates: data.ticketUpdates, submitSupportAction: data.supportAction,
  listAllPlatformTickets: data.platformTickets,
}));
vi.mock("../../js/services/school.service.js", () => ({ listSchools: async () => [] }));
vi.mock("../../js/services/recovery.service.js", () => ({ openAccountRecoveryModal: vi.fn() }));
vi.mock("../../js/services/student-issue.service.js", () => ({
  listAllIssuesForSchool: data.issues, raiseIssue: data.raiseIssue, resolveIssue: data.resolveIssue, reopenIssue: data.reopenIssue,
  ISSUE_CATEGORIES: [{ value: "score_dispute", label: "Wrong / inaccurate score" }], issueCategoryLabel: (id) => id,
}));
vi.mock("../../js/services/student.service.js", () => ({ listStudents: data.students }));
vi.mock("../../js/services/audit.service.js", () => ({
  fetchLogsSince: data.logsSince, fetchRecentLogs: data.recentLogs,
  describeLog: ({ action }) => ({ label: action === "login" ? "Login" : "Record payment", icon: "history", color: "blue" }),
}));
vi.mock("../../js/services/auth.service.js", () => ({ listSchoolUsers: async () => [{ uid: "operator", fullName: "Sample Operator", role: "admin" }] }));

import { render as renderAudit } from "../../views/audit.js";
import { render as renderIssues } from "../../views/student-issues.js";
import { init as openPlatformLink, render as renderPlatform } from "../../views/platform-tickets.js";
import { render as renderSupport, init as openLinkedTicket } from "../../views/support.js";

const profile = { uid: "operator" };
const ticket = { id: "tkt12345", subject: "Report card help", message: "The PDF has a blank page.", status: "resolved", resolutionNote: "Template corrected." };
const openIssue = { id: "case-1", studentId: "student-1", studentName: "Sample Learner", admissionNumber: "ADM-1", category: "score_dispute", status: "open", description: "Check the exam score." };
const log = { userId: "operator", action: "login", entity: "auth", entityId: "browser-session", timestamp: { seconds: 1773000000 } };
const find = (selector) => document.querySelector(selector);
const button = (name, root = document) => [...root.querySelectorAll("button")].find((btn) => btn.textContent.trim().endsWith(name));
const dialog = () => find('[role="dialog"]');

function edit(selector, value, type = "input") {
  const control = find(selector);
  control.value = value;
  control.dispatchEvent(new Event(type, { bubbles: true }));
  return control;
}

function submitDialog() {
  const form = dialog().querySelector("form");
  form.requestSubmit(form.querySelector('button[type="submit"]'));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("confirm", () => true);
  data.tickets.mockResolvedValue([ticket]);
  data.platformTickets.mockResolvedValue([]);
  data.ticketEvents.mockResolvedValue([]);
  data.ticketUpdates.mockResolvedValue([]);
  data.issues.mockResolvedValue([openIssue]);
  data.students.mockResolvedValue([{ id: "student-1", fullName: "Sample Learner", admissionNumber: "ADM-1" }]);
  data.logsSince.mockResolvedValue([log]);
});

describe("Platform support queue", () => {
  it("filters overdue cases and opens a linked resolved ticket independently of that queue", async () => {
    const overdue = { ...ticket, status: "open", raisedAt: new Date("2025-01-01T08:00:00Z") };
    const current = { ...overdue, id: "current", subject: "New case", raisedAt: new Date() };
    data.platformTickets.mockResolvedValue([overdue, current]);
    data.getTicket.mockResolvedValue({ ...ticket, status: "resolved", followUpRequestedAt: new Date() });
    document.body.append(await renderPlatform({ profile, params: { ticket: ticket.id } }));
    edit("#platform-ticket-filter", "overdue", "change");
    await vi.waitFor(() => expect(find(".records-list").textContent).toContain("First response overdue"));
    expect(find(".records-list").textContent).not.toContain("New case");
    openPlatformLink();
    expect(dialog().textContent).toContain("Follow-up requested.");
    expect(button("Reopen ticket", dialog())).toBeTruthy();
  });
});

afterEach(() => {
  if (dialog()) dialog().querySelector(".modal__close").click();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Contact Support", () => {
  it("finds a ticket by reference and shows the full support reply in the detail dialog", async () => {
    document.body.append(await renderSupport({ profile }));
    button("Open (0)").click();
    expect(find(".records-list").textContent).toContain("No open tickets");
    button("Clear filters").click();
    const search = edit("#support-search", "#tkt12345");
    expect(document.activeElement).toBe(search);
    const view = find('button[aria-label="View ticket: Report card help"]');
    view.focus();
    view.click();
    expect(dialog().textContent).toContain("Template corrected.");
    expect(dialog().textContent).toContain("The PDF has a blank page.");
    expect(dialog().textContent).toContain("tkt12345");
    button("Done", dialog()).click();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(view);
  });

  it("shows a submitted ticket as open and lets the school read its status", async () => {
    document.body.append(await renderSupport({ profile }));
    const created = { id: "new001", status: "open", subject: "[Academic & Grading] Term grades", message: "Please check the export." };
    data.raiseTicket.mockImplementation(async () => { data.tickets.mockResolvedValue([created, ticket]); });
    button("New ticket").click();
    edit("#ticket-subject", "Term grades");
    edit("#ticket-message", created.message);
    submitDialog();
    const getViewButton = () => find('button[aria-label="View ticket: Term grades"]');
    await vi.waitFor(() => expect(getViewButton()).toBeTruthy());
    expect(data.raiseTicket).toHaveBeenCalledExactlyOnceWith({ subject: created.subject, message: created.message }, expect.any(String));
    expect(button("Open (1)").getAttribute("aria-pressed")).toBe("true");
    getViewButton().click();
    expect(dialog().textContent).toContain("Awaiting a response from platform support.");
    expect(button("Post reply", dialog())).toBeTruthy();
    expect(button("Post and resolve", dialog())).toBeUndefined();
  });

  it("links a notification to its ticket and lets the reporter request more help", async () => {
    const resolved = { ...ticket, raisedBy: profile.uid };
    data.tickets.mockResolvedValue([resolved]);
    data.ticketUpdates.mockResolvedValue([{ kind: "resolved", ticketId: ticket.id, createdAt: new Date() }]);
    data.getTicket.mockResolvedValue({ ...resolved, followUpRequestedAt: new Date() });
    data.supportAction.mockResolvedValue(ticket.id);
    document.body.append(await renderSupport({ profile, params: { ticket: ticket.id } }));
    expect(find(".support-updates a").getAttribute("href")).toBe(`#/support?ticket=${ticket.id}`);
    openLinkedTicket();
    expect(dialog().textContent).toContain("Rate the support you received");
    find("details").open = true;
    edit("#support-ticket-reply", "The export still fails");
    const reply = button("Request follow-up", dialog());
    reply.form.requestSubmit(reply);
    await vi.waitFor(() => expect(dialog().textContent).toContain("Follow-up requested."));
    expect(data.supportAction).toHaveBeenCalledExactlyOnceWith("help", ticket.id, { message: "The export still fails" }, expect.any(String));
  });
});

describe("Audit Trail", () => {
  it("preserves focus while filtering, keeps the newest range request, and exports the visible rows", async () => {
    document.body.append(await renderAudit());
    find("#f-search").focus();
    edit("#f-search", "access");
    expect(document.activeElement.id).toBe("f-search");
    expect(find("tbody").textContent).toContain("Sample Operator");
    const toggle = button("More filters");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    edit("#f-entity", "auth", "change");
    expect(toggle.textContent).toContain("More filters (1)");
    edit("#f-entity", "", "change");

    let finishOldRange;
    data.logsSince.mockImplementationOnce(() => new Promise((resolve) => { finishOldRange = resolve; }));
    data.recentLogs.mockResolvedValue([{ ...log, action: "record_payment", entity: "fee_payments", entityId: "receipt-123" }]);
    edit("#f-range", "7d", "change");
    expect(find("#export-csv").disabled).toBe(true);
    edit("#f-range", "all", "change");
    edit("#f-search", "receipt");
    await vi.waitFor(() => expect(find("tbody")?.textContent).toContain("receipt-123"));
    finishOldRange([log]);
    await Promise.resolve();
    expect(find("tbody").textContent).toContain("receipt-123");
    expect(data.recentLogs).toHaveBeenCalledExactlyOnceWith(1000);

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:example");
    find("#export-csv").click();
    expect(click.mock.contexts[0].download).toBe("audit-trail.csv");
    const csv = await createUrl.mock.calls[0][0].text();
    expect(csv).toContain('"Record payment","fee_payments","receipt-123"');
    expect(csv).not.toContain("browser-session");
  });
});

describe("Student Issues", () => {
  it("syncs the filters after clearing and after resolving an issue", async () => {
    document.body.append(await renderIssues({ profile }));
    edit("#student-issue-category", "score_dispute", "change");
    edit("#student-issue-search", "not-a-student");
    expect(find(".records-list").textContent).toContain("No matching issues");
    button("Clear filters").click();
    expect(find("#student-issue-category").value).toBe("");
    expect(find("#student-issue-search").value).toBe("");
    expect(find("tbody a").getAttribute("href")).toBe("#/students?id=student-1");

    data.resolveIssue.mockImplementation(async () => { data.issues.mockResolvedValue([{ ...openIssue, status: "resolved", resolutionNote: "Checked against original." }]); });
    button("Resolve").click();
    edit("#resolution-note", "Checked against original.");
    submitDialog();
    await vi.waitFor(() => expect(button("Resolved (1)")).toBeTruthy());
    expect(data.resolveIssue).toHaveBeenCalledExactlyOnceWith(profile.uid, openIssue.id, "Checked against original.");
    button("Details").click();
    expect(dialog().textContent).toContain("Checked against original.");
    data.reopenIssue.mockImplementation(async () => { data.issues.mockResolvedValue([openIssue]); });
    button("Reopen issue", dialog()).click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(data.reopenIssue).toHaveBeenCalledExactlyOnceWith(profile.uid, openIssue.id);
    expect(button("Open (1)")).toBeTruthy();
  });

  it("selects a student with a button and saves the issue with only supplied context fields", async () => {
    document.body.append(await renderIssues({ profile }));
    expect(data.students).not.toHaveBeenCalled();
    button("Log issue").click();
    edit("#issue-student", "ADM-1");
    await vi.waitFor(() => expect(find(".records-student-picker button")).toBeTruthy());
    find(".records-student-picker button").focus();
    find(".records-student-picker button").click();
    expect(document.activeElement.id).toBe("issue-category");
    edit("#issue-category", "score_dispute", "change");
    edit("#issue-description", "Review marks entered for this term.");
    edit("#issue-context-year", "2026");
    submitDialog();
    await vi.waitFor(() => expect(data.raiseIssue).toHaveBeenCalledExactlyOnceWith(profile.uid, {
      studentId: "student-1", studentName: "Sample Learner", admissionNumber: "ADM-1", category: "score_dispute",
      description: "Review marks entered for this term.", context: { academicYear: "2026" },
    }));
  });
});
