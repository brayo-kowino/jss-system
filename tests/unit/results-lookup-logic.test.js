import { describe, it, expect } from "vitest";

// Port of input sanitization & validation logic in netlify/edge-functions/results-lookup.ts
function cleanSlug(raw) {
  return String(raw || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

function cleanAdmissionNumber(raw) {
  return String(raw || "").trim().replace(/[^a-zA-Z0-9/_-]/g, "").slice(0, 40);
}

function isValidDob(raw) {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function attemptDocId(schoolId, admissionNumber) {
  return `${schoolId}_${admissionNumber}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
}

function redactResultForParent(latest) {
  return {
    academicYear: latest.academicYear,
    term: latest.term,
    reportMode: latest.reportMode,
    subjects: (latest.subjects || []).map((s) => ({
      code: s.code,
      name: s.name,
      average: s.average,
      grade: s.grade,
      points: s.points,
      remark: s.remark,
    })),
    totalMarks: latest.totalMarks,
    totalOutOf: latest.totalOutOf,
    meanMarks: latest.meanMarks,
    meanGrade: latest.meanGrade,
    meanPoints: latest.meanPoints,
    overallPosition: latest.overallPosition,
    classPosition: latest.classPosition,
    classSize: latest.classSize,
    teacherRemark: latest.teacherRemark || "",
    principalRemark: latest.principalRemark || "",
  };
}

describe("Results Lookup Edge Function Security Logic", () => {
  describe("Input Sanitization & Validation", () => {
    it("cleans school slug to lowercase alphanumeric-dash charset capped at 40 chars", () => {
      const dirty = "  MY-SCHOOL_101!@#$%^&*()_+=  ";
      expect(cleanSlug(dirty)).toBe("my-school101");
    });

    it("cleans admission number and rejects path traversal chars", () => {
      const malicious = "  ADM/2024/001../..//etc/passwd  ";
      expect(cleanAdmissionNumber(malicious)).toBe("ADM/2024/001///etc/passwd");
    });

    it("strictly validates DOB format against YYYY-MM-DD pattern", () => {
      expect(isValidDob("2012-04-15")).toBe(true);
      expect(isValidDob("15/04/2012")).toBe(false);
      expect(isValidDob("2012-4-15")).toBe(false);
      expect(isValidDob("")).toBe(false);
      expect(isValidDob(null)).toBe(false);
    });

    it("generates safe attemptDocId without path traversal or invalid characters", () => {
      const id = attemptDocId("school-1", "ADM/2024/001");
      expect(id).toBe("school-1_ADM_2024_001");
      expect(id).not.toContain("/");
    });
  });

  describe("Data Minimization / PII Redaction", () => {
    it("never includes sensitive student PII in public response", () => {
      const rawResultFromDatabase = {
        fullName: "John Doe",
        admissionNumber: "ADM001",
        kcpeNumber: "123456789",
        phone: "+254712345678",
        parentPhone: "+254798765432",
        parentName: "Jane Doe",
        homeAddress: "Nairobi, Kenya",
        medicalNotes: "Asthmatic",
        academicYear: "2026",
        term: "Term 1",
        reportMode: "average",
        totalMarks: 450,
        meanMarks: 75,
        subjects: [{ code: "MATH", name: "Mathematics", average: 85, grade: "EE1" }],
      };

      const redacted = redactResultForParent(rawResultFromDatabase);

      // Verify academic fields exist
      expect(redacted.academicYear).toBe("2026");
      expect(redacted.meanMarks).toBe(75);
      expect(redacted.subjects).toHaveLength(1);

      // Verify sensitive PII fields are completely absent
      expect(redacted).not.toHaveProperty("phone");
      expect(redacted).not.toHaveProperty("parentPhone");
      expect(redacted).not.toHaveProperty("parentName");
      expect(redacted).not.toHaveProperty("homeAddress");
      expect(redacted).not.toHaveProperty("medicalNotes");
      expect(redacted).not.toHaveProperty("kcpeNumber");
    });
  });
});
