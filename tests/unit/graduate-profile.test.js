import { beforeEach, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  status: "graduated", getFeeSummary: vi.fn(), getPastFees: vi.fn(), loadAttendance: vi.fn(), loadGraduation: vi.fn(),
}));
vi.mock("../../js/services/student.service.js", () => ({
  listStudents: async () => [{ id: "learner", fullName: "Sample Learner", grade: "Grade 9", stream: "Blue", status: data.status }],
  registerStudent: vi.fn(), updateStudent: vi.fn(), transferStudent: vi.fn(), setStudentStatus: vi.fn(),
}));
vi.mock("../../js/services/parent.service.js", () => ({ listParents: async () => [] }));
vi.mock("../../js/services/academic.service.js", () => ({
  listClasses: async () => [{ grade: "Grade 9", streams: ["Blue"] }], seedDefaultsIfEmpty: async () => {},
}));
vi.mock("../../js/services/settings.service.js", () => ({
  getSchoolSettings: async () => ({ currentAcademicYear: "2027", currentTerm: "Term 1", terms: ["Term 1", "Term 2", "Term 3"] }),
}));
vi.mock("../../js/services/alumni.service.js", () => ({ ALUMNI_ROLES: ["admin"], loadGraduationRecord: data.loadGraduation }));
vi.mock("../../js/services/fee.service.js", () => ({
  getFeeSummary: data.getFeeSummary, getGraduateFeeHistory: data.getPastFees,
  listFeeStructures: vi.fn(), listPaymentsForStudent: vi.fn(), recordPayment: vi.fn(), PAYMENT_METHODS: ["Cash"],
  formatKES: (amount) => "KES " + amount,
}));
vi.mock("../../js/services/grading.service.js", () => ({
  listResultsForStudent: async () => [], pickHeadlineResult: () => null, reportModeLabel: () => "", positionScopeTag: () => "",
}));
vi.mock("../../js/services/attendance.service.js", () => ({
  listAttendanceForClassPeriod: data.loadAttendance,
  summarizeForRoster: () => ({ perStudent: {} }),
}));
vi.mock("../../js/services/student-issue.service.js", () => ({
  ISSUE_CATEGORIES: [], issueCategoryLabel: () => "", raiseIssue: vi.fn(), resolveIssue: vi.fn(),
  listIssuesForStudent: async () => [], listOpenIssues: async () => [],
}));
vi.mock("../../js/services/audit.service.js", () => ({ listLogsForEntity: async () => [] }));
vi.mock("../../js/services/auth.service.js", () => ({ getCurrentSchool: () => null }));
vi.mock("../../js/services/subscription.service.js", () => ({ isStarterPlan: () => false }));

import { render } from "../../views/students.js";

const profile = { role: "admin", uid: "admin" };
const exit = { year: "2026", term: "Term 2", grade: "Grade 9", stream: "Blue" };
const dialog = () => document.querySelector(".modal");
const tab = (label) => [...dialog().querySelectorAll(".profile-tab")].find((node) => node.textContent.endsWith(label));

beforeEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
  data.status = "graduated";
  data.getFeeSummary.mockResolvedValue({ balance: 15000 });
  data.getPastFees.mockResolvedValue({
    rows: [{ academicYear: "2026", term: "Term 2", grade: "Grade 9", expected: 9000, paid: 8000, balance: 1000 }],
    payments: [], totalBalance: 1000, hasUnverifiedBalance: false,
  });
  data.loadAttendance.mockResolvedValue([]);
  data.loadGraduation.mockResolvedValue(exit);
});

it("opens graduate history without charging the active term or showing enrollment actions", async () => {
  document.body.append(await render({ profile, params: { id: "learner" } }));
  await vi.waitFor(() => expect(dialog()?.textContent).toContain("Past Fee Balance"));
  expect(dialog().textContent).toContain("KES 1000");
  expect(dialog().textContent).not.toMatch(/Transfer\/Promote|Suspend|Raise Issue|Fee Balance \(this term\)/);
  expect(data.getFeeSummary).not.toHaveBeenCalled();

  tab("Fee History").click();
  await vi.waitFor(() => expect(dialog().textContent).toContain("Confirmed Past Balance"));
  expect(dialog().querySelector('[aria-label="Record payment for Term 2 2026"]')).not.toBeNull();
  tab("Attendance History").click();
  await vi.waitFor(() => expect(data.loadAttendance).toHaveBeenCalledExactlyOnceWith("Grade 9", "Blue", "2026"));
});

it("keeps the current-term balance and standard controls for active learners", async () => {
  data.status = "active";
  document.body.append(await render({ profile, params: { id: "learner" } }));
  await vi.waitFor(() => expect(dialog()?.textContent).toContain("Fee Balance (this term)"));
  expect(dialog().textContent).toContain("Transfer/Promote");
  expect(data.getFeeSummary).toHaveBeenCalledExactlyOnceWith({ studentId: "learner", grade: "Grade 9", academicYear: "2027", term: "Term 1" });
  expect(data.getPastFees).not.toHaveBeenCalled();
});
