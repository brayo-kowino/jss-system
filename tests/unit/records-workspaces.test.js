import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  tickets: vi.fn(), raiseTicket: vi.fn(), resolveTicket: vi.fn(),
  issues: vi.fn(), raiseIssue: vi.fn(), resolveIssue: vi.fn(), reopenIssue: vi.fn(), students: vi.fn(),
  logsSince: vi.fn(), recentLogs: vi.fn(),
}));
vi.mock("../../js/services/support.service.js", () => ({
  listSchoolTickets: data.tickets, raiseSupportTicket: data.raiseTicket, resolveSupportTicket: data.resolveTicket,
}));
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
import { render as renderSupport } from "../../views/support.js";

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
  data.issues.mockResolvedValue([openIssue]);
  data.students.mockResolvedValue([{ id: "student-1", fullName: "Sample Learner", admissionNumber: "ADM-1" }]);
  data.logsSince.mockResolvedValue([log]);
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
    const search = edit("#support-search", "tkt123");
    expect(document.activeElement).toBe(search);
    button("Report card help").click();
    expect(dialog().textContent).toContain("Template corrected.");
    expect(dialog().textContent).toContain("The PDF has a blank page.");
  });

  it("opens the submitted ticket in the Open list and retains the resolution workflow", async () => {
    document.body.append(await renderSupport({ profile }));
    const created = { id: "new001", status: "open", subject: "[Academic & Grading] Term grades", message: "Please check the export." };
    data.raiseTicket.mockImplementation(async () => { data.tickets.mockResolvedValue([created, ticket]); });
    data.resolveTicket.mockImplementation(async () => { data.tickets.mockResolvedValue([{ ...created, status: "resolved" }, ticket]); });
    button("New ticket").click();
    edit("#ticket-subject", "Term grades");
    edit("#ticket-message", created.message);
    submitDialog();
    await vi.waitFor(() => expect(button("Term grades")).toBeTruthy());
    expect(data.raiseTicket).toHaveBeenCalledExactlyOnceWith(profile.uid, { subject: created.subject, message: created.message });
    expect(button("Open (1)").getAttribute("aria-pressed")).toBe("true");
    button("Term grades").click();
    button("Mark resolved", dialog()).click();
    await vi.waitFor(() => expect(button("Resolved (2)")).toBeTruthy());
    expect(data.resolveTicket).toHaveBeenCalledExactlyOnceWith(profile.uid, created.id, "Resolved by school administrator.");
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
