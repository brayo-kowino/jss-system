import { describe, it, expect } from "vitest";
import {
  parseStudentsCsv,
  validateStudentRows,
  buildTemplateCsv,
  buildErrorReportCsv,
} from "../../js/services/student-import.service.js";

describe("Student CSV Import Pipeline", () => {
  const MOCK_CLASSES = [
    { grade: "Grade 7", streams: ["Blue", "Red"] },
    { grade: "Grade 8", streams: ["Alpha"] },
  ];

  describe("parseStudentsCsv()", () => {
    it("parses valid CSV data with standard headers", () => {
      const csv = `Admission Number,Full Name,Gender (Male/Female),Date of Birth (YYYY-MM-DD),Grade,Stream
ADM001,Alice Wambui,Female,2012-05-10,Grade 7,Blue
ADM002,Bob Mwangi,Male,2012-08-20,Grade 7,Red`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].raw.admissionNumber).toBe("ADM001");
      expect(result.rows[0].raw.fullName).toBe("Alice Wambui");
      expect(result.rows[0].raw.gender).toBe("Female");
    });

    it("handles alternative header aliases (Adm No, Name, Sex, Class)", () => {
      const csv = `Adm No,Name,Sex,Class
ADM101,John Doe,Male,Grade 7`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].raw.admissionNumber).toBe("ADM101");
      expect(result.rows[0].raw.fullName).toBe("John Doe");
      expect(result.rows[0].raw.gender).toBe("Male");
      expect(result.rows[0].raw.grade).toBe("Grade 7");
    });

    it("handles quoted fields and escaped quotes in CSV", () => {
      const csv = `Admission Number,Full Name,Gender,Grade
"ADM,003","O'Connor, ""Tim""",Male,Grade 7`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows[0].raw.admissionNumber).toBe("ADM,003");
      expect(result.rows[0].raw.fullName).toBe('O\'Connor, "Tim"');
    });

    it("rejects empty files or files with unrecognized headers", () => {
      expect(parseStudentsCsv("").error).toBe("The file is empty.");
      expect(parseStudentsCsv("RandomHeader1,RandomHeader2").error).toContain("headers weren't recognized");
    });
  });

  describe("validateStudentRows()", () => {
    it("validates and marks complete valid rows as 'ready'", () => {
      const rawRows = [
        {
          rowNumber: 2,
          raw: {
            admissionNumber: "ADM001",
            fullName: "Alice Wambui",
            gender: "Female",
            dob: "2012-05-10",
            grade: "Grade 7",
            stream: "Blue",
          },
        },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).toBe("ready");
      expect(validated[0].issues).toHaveLength(0);
      expect(validated[0].data.gender).toBe("Female");
    });

    it("blocks rows with missing required fields (fullName, gender, invalid grade)", () => {
      const rawRows = [
        {
          rowNumber: 2,
          raw: {
            admissionNumber: "ADM001",
            fullName: "", // Missing
            gender: "Alien", // Invalid gender
            grade: "Grade 99", // Nonexistent class
          },
        },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).toBe("blocked");
      const issueFields = validated[0].issues.map((i) => i.field);
      expect(issueFields).toContain("fullName");
      expect(issueFields).toContain("gender");
      expect(issueFields).toContain("grade");
    });

    it("normalizes lowercase and single-letter genders (m -> Male, female -> Female)", () => {
      const rawRows = [
        { rowNumber: 2, raw: { fullName: "A", gender: "m", grade: "Grade 7" } },
        { rowNumber: 3, raw: { fullName: "B", gender: "f", grade: "Grade 7" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].data.gender).toBe("Male");
      expect(validated[1].data.gender).toBe("Female");
    });

    it("assigns placeholder admission number if missing and sets warning", () => {
      const rawRows = [
        {
          rowNumber: 2,
          raw: { fullName: "Charlie", gender: "Male", grade: "Grade 7", stream: "Blue" },
        },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].data.admissionNumber).toMatch(/^PENDING-/);
      expect(validated[0].autoAssigned).toBe(true);
      expect(validated[0].status).toBe("warning");
    });

    it("detects duplicate admission numbers within the same file and blocks them", () => {
      const rawRows = [
        { rowNumber: 2, raw: { admissionNumber: "ADM-DUP", fullName: "First", gender: "Male", grade: "Grade 7" } },
        { rowNumber: 3, raw: { admissionNumber: "ADM-DUP", fullName: "Second", gender: "Female", grade: "Grade 7" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).not.toBe("blocked");
      expect(validated[1].status).toBe("blocked");
      expect(validated[1].issues.some((i) => i.message.includes("duplicated elsewhere in this file"))).toBe(true);
    });

    it("flags duplicate against existing database students as warning and sets duplicateOf", () => {
      const existing = [{ id: "db-student-1", admissionNumber: "ADM-EXISTING", fullName: "Existing Student" }];
      const rawRows = [
        { rowNumber: 2, raw: { admissionNumber: "ADM-EXISTING", fullName: "New Student", gender: "Male", grade: "Grade 7" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES, existingStudents: existing });
      expect(validated[0].status).toBe("warning");
      expect(validated[0].duplicateOf).toBe("db-student-1");
      expect(validated[0].action).toBe("skip");
    });
  });

  describe("Template & Error Report Helpers", () => {
    it("generates template CSV containing headers and sample data", () => {
      const template = buildTemplateCsv(MOCK_CLASSES);
      expect(template).toContain("Admission Number");
      expect(template).toContain("Full Name");
      expect(template).toContain("Grade 7");
    });

    it("generates clean error reports listing rows and issue details", () => {
      const rows = [
        {
          rowNumber: 2,
          status: "blocked",
          raw: { fullName: "Bad Row", admissionNumber: "ADM999", grade: "Unknown" },
          issues: [{ message: "Grade is invalid" }],
        },
      ];
      const errorReport = buildErrorReportCsv(rows);
      expect(errorReport).toContain("Bad Row");
      expect(errorReport).toContain("Grade is invalid");
    });
  });
});
