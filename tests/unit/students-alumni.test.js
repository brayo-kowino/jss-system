import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  listAlumni: vi.fn(), listCertificates: vi.fn(), issueCertificate: vi.fn(), listReports: vi.fn(),
  downloadCertificate: vi.fn(), downloadReport: vi.fn(), reportDownloads: true,
}));

vi.mock("../../js/services/alumni.service.js", () => ({
  ALUMNI_ROLES: ["admin", "principal", "deputy_principal", "registrar"],
  CERTIFICATE_TYPES: { leaving: "School Leaving Certificate", graduation: "Graduation Certificate" },
  listAlumni: data.listAlumni, listAlumniCertificates: data.listCertificates, issueAlumniCertificate: data.issueCertificate,
}));
vi.mock("../../js/services/grading.service.js", () => ({
  listResultsForStudent: data.listReports,
  reportModeLabel: () => "ENDTERM",
}));
vi.mock("../../js/services/alumni-pdf.js", () => ({
  downloadAlumniCertificate: data.downloadCertificate, downloadSavedAlumniReport: data.downloadReport,
  formatCertificateDate: () => "30 November 2026",
}));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchool: () => ({ canComputeOrGenerate: data.reportDownloads }),
}));
vi.mock("../../js/services/settings.service.js", () => ({ getSchoolSettings: async () => ({ schoolName: "Example Academy" }) }));

import { renderAlumni } from "../../views/students-alumni.js";

const graduate = {
  studentId: "graduate", alumniId: "archive", fullName: "Sample Graduate", admissionNumber: "016/25",
  grade: "Grade 9", stream: "Blue", graduationYear: "2026",
};
const certificate = { type: "leaving", number: "LC-EXAMPLE", ...graduate };
const savedReport = { studentId: "graduate", academicYear: "2025", term: "Term 2", grade: "Grade 8", reportMode: "endterm" };
const button = (label, mount = document) => [...mount.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
const modal = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
  data.reportDownloads = true;
  data.listAlumni.mockResolvedValue([
    graduate, { studentId: "legacy", fullName: "Older Learner", admissionNumber: "0008", grade: "Grade 7" },
  ]);
  data.listCertificates.mockResolvedValue([]);
  data.issueCertificate.mockResolvedValue(certificate);
  data.listReports.mockResolvedValue([savedReport]);
});

describe("Students Alumni", () => {
  it("filters by year and admission number and links to the original learner profile", async () => {
    document.body.append(await renderAlumni());
    const filter = document.querySelector("#alumni-year");
    filter.value = "2026";
    filter.dispatchEvent(new Event("change"));
    const rows = document.querySelector("tbody");
    expect(rows.textContent).toContain(graduate.fullName);
    expect(rows.textContent).not.toContain("Older Learner");
    expect(rows.querySelector("a").getAttribute("href")).toBe("#/students?id=graduate");

    filter.value = "";
    filter.dispatchEvent(new Event("change"));
    const search = document.querySelector("#alumni-search");
    search.value = "0008";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("tbody").textContent).toContain("Older Learner");
    expect(document.querySelector("tbody").textContent).toContain("Not recorded");
  });

  it("shows saved report cards, requires explicit issuance, and offers the saved certificate for reprint", async () => {
    document.body.append(await renderAlumni());
    const documents = button("Documents");
    documents.click();
    await vi.waitFor(() => expect(modal().textContent).toContain("Term 2 2025"));
    button("Download PDF", modal()).click();
    await vi.waitFor(() => expect(data.downloadReport).toHaveBeenCalledExactlyOnceWith(savedReport, { schoolName: "Example Academy" }));

    modal().querySelector('[aria-label="Review and issue School Leaving Certificate"]').click();
    expect(modal().textContent).toContain("016/25");
    expect(data.issueCertificate).not.toHaveBeenCalled();
    button("Issue Certificate", modal()).click();
    await vi.waitFor(() => expect(modal().textContent).toContain("LC-EXAMPLE"));
    expect(data.issueCertificate).toHaveBeenCalledExactlyOnceWith(graduate, "leaving");
    button("Reprint PDF", modal()).click();
    expect(data.downloadCertificate).toHaveBeenCalledExactlyOnceWith(certificate);
    button("Done", modal()).click();
    expect(document.activeElement).toBe(documents);
  });

  it("preserves the existing school restriction on report downloads", async () => {
    data.reportDownloads = false;
    document.body.append(await renderAlumni());
    button("Documents").click();
    await vi.waitFor(() => expect(button("Download PDF", modal())?.disabled).toBe(true));
    expect(modal().textContent).toContain("Report downloads require an active school subscription.");
    expect(data.downloadReport).not.toHaveBeenCalled();
  });
});
