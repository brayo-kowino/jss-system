import { describe, it, expect } from "vitest";
import {
  parseStudentsCsv,
  parseStudentsWorkbook,
  parseStudentsFile,
  validateStudentRows,
  buildTemplateCsv,
  buildTemplateXlsx,
  buildErrorReportCsv,
  loadXlsxLib,
} from "../../js/services/student-import.service.js";

describe("Student CSV & Excel Import Pipeline", () => {
  const MOCK_CLASSES = [
    { grade: "Grade 7", streams: ["Blue", "Red"] },
    { grade: "Grade 8", streams: ["Alpha"] },
  ];

  describe("parseStudentsCsv()", () => {
    it("parses valid CSV data with standard streamlined headers including Assessment Number", () => {
      const csv = `Admission Number,Full Name,Gender (Male/Female),Grade,Stream,Date of Birth (YYYY-MM-DD),Assessment Number
ADM001,Alice Wambui,Female,Grade 7,Blue,2012-05-10,123456789
ADM002,Bob Mwangi,Male,Grade 7,Red,2012-08-20,987654321`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].raw.admissionNumber).toBe("ADM001");
      expect(result.rows[0].raw.fullName).toBe("Alice Wambui");
      expect(result.rows[0].raw.gender).toBe("Female");
      expect(result.rows[0].raw.kcpeNumber).toBe("123456789");
    });

    it("handles alternative header aliases (Adm No, Name, Sex, Class, UPI)", () => {
      const csv = `Adm No,Name,Sex,Class,UPI
ADM101,John Doe,Male,Grade 7,UPI-998877`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].raw.admissionNumber).toBe("ADM101");
      expect(result.rows[0].raw.fullName).toBe("John Doe");
      expect(result.rows[0].raw.gender).toBe("Male");
      expect(result.rows[0].raw.grade).toBe("Grade 7");
      expect(result.rows[0].raw.kcpeNumber).toBe("UPI-998877");
    });

    it("handles quoted fields and escaped quotes in CSV", () => {
      const csv = `Admission Number,Full Name,Gender,Grade
"ADM,003","O'Connor, ""Tim""",Male,Grade 7`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows[0].raw.admissionNumber).toBe("ADM,003");
      expect(result.rows[0].raw.fullName).toBe('O\'Connor, "Tim"');
    });

    it("supports backward compatibility with legacy columns (phone, address)", () => {
      const csv = `Admission Number,Full Name,Gender,Grade,Phone,Address
ADM102,Legacy Student,Female,Grade 7,0712345678,Nairobi`;

      const result = parseStudentsCsv(csv);
      expect(result.error).toBeNull();
      expect(result.rows[0].raw.fullName).toBe("Legacy Student");
      expect(result.rows[0].raw.phone).toBe("0712345678");
      expect(result.rows[0].raw.address).toBe("Nairobi");
    });

    it("rejects empty files or files with unrecognized headers", () => {
      expect(parseStudentsCsv("").error).toBe("The file is empty.");
      expect(parseStudentsCsv("RandomHeader1,RandomHeader2").error).toContain("headers weren't recognized");
    });
  });

  describe("Excel (.xlsx) Import & Export Pipeline", () => {
    it("generates and parses a valid Excel (.xlsx) workbook", async () => {
      const XLSX = await loadXlsxLib();
      const buffer = await buildTemplateXlsx(MOCK_CLASSES);
      expect(buffer).toBeDefined();
      expect(buffer.length || buffer.byteLength).toBeGreaterThan(0);

      // Verify workbook structure
      const wb = XLSX.read(buffer, { type: "array" });
      expect(wb.SheetNames).toContain("Students");
      expect(wb.SheetNames).toContain("Classes & Streams Guide");

      // Parse the generated template through parseStudentsWorkbook
      const result = await parseStudentsWorkbook(buffer);
      expect(result.error).toBeNull();
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      expect(result.rows[0].raw.admissionNumber).toBe("ADM1001");
      expect(result.rows[0].raw.fullName).toBe("Jane Wanjiru Kamau");
      expect(result.rows[0].raw.gender).toBe("Female");
      expect(result.rows[0].raw.kcpeNumber).toBe("1234567890");
    });

    it("correctly handles Excel date objects and date serial numbers in DOB", () => {
      const rawRows = [
        {
          rowNumber: 2,
          raw: {
            admissionNumber: "ADM001",
            fullName: "Date Test",
            gender: "Female",
            dob: new Date(2012, 4, 10), // JS Date
            grade: "Grade 7",
            stream: "Blue",
          },
        },
        {
          rowNumber: 3,
          raw: {
            admissionNumber: "ADM002",
            fullName: "Serial Date Test",
            gender: "Male",
            dob: "41039", // Excel serial number for 2012-05-10
            grade: "Grade 7",
            stream: "Blue",
          },
        },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].data.dob).toBe("2012-05-10");
      expect(validated[1].data.dob).toBe("2012-05-10");
    });

    it("parses an Excel file using parseStudentsFile dispatcher", async () => {
      const buffer = await buildTemplateXlsx(MOCK_CLASSES);
      const fakeFile = {
        name: "test-roster.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        arrayBuffer: async () => buffer,
      };

      const result = await parseStudentsFile(fakeFile);
      expect(result.error).toBeNull();
      expect(result.rows[0].raw.fullName).toBe("Jane Wanjiru Kamau");
    });
  });

  describe("validateStudentRows()", () => {
    it("validates and marks complete valid rows as 'ready' with Assessment Number", () => {
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
            kcpeNumber: "ASSESS-2026-001",
          },
        },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).toBe("ready");
      expect(validated[0].issues).toHaveLength(0);
      expect(validated[0].data.gender).toBe("Female");
      expect(validated[0].data.kcpeNumber).toBe("ASSESS-2026-001");
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
        { rowNumber: 2, raw: { admissionNumber: "ADM-DUP", fullName: "First", gender: "Male", grade: "Grade 7", stream: "Blue" } },
        { rowNumber: 3, raw: { admissionNumber: "ADM-DUP", fullName: "Second", gender: "Female", grade: "Grade 7", stream: "Blue" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).not.toBe("blocked");
      expect(validated[1].status).toBe("blocked");
      expect(validated[1].issues.some((i) => i.message.includes("duplicated elsewhere in this file"))).toBe(true);
    });

    it("flags duplicate against existing database students as warning and sets duplicateOf", () => {
      const existing = [{ id: "db-student-1", admissionNumber: "ADM-EXISTING", fullName: "Existing Student" }];
      const rawRows = [
        { rowNumber: 2, raw: { admissionNumber: "ADM-EXISTING", fullName: "New Student", gender: "Male", grade: "Grade 7", stream: "Blue" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES, existingStudents: existing });
      expect(validated[0].status).toBe("warning");
      expect(validated[0].duplicateOf).toBe("db-student-1");
      expect(validated[0].action).toBe("skip");
    });

    it("blocks rows if no classes or streams are configured in the school", () => {
      const rawRows = [
        { rowNumber: 2, raw: { admissionNumber: "ADM001", fullName: "Test Student", gender: "Male", grade: "Grade 7" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: [] });
      expect(validated[0].status).toBe("blocked");
      expect(validated[0].issues.some((i) => i.message.includes("No classes or streams have been set up"))).toBe(true);
    });

    it("blocks rows if grade has streams configured but stream is missing or invalid", () => {
      const rawRows = [
        { rowNumber: 2, raw: { fullName: "No Stream", gender: "Male", grade: "Grade 7", stream: "" } },
        { rowNumber: 3, raw: { fullName: "Bad Stream", gender: "Female", grade: "Grade 7", stream: "NonExistent" } },
      ];

      const validated = validateStudentRows(rawRows, { classes: MOCK_CLASSES });
      expect(validated[0].status).toBe("blocked");
      expect(validated[0].issues.some((i) => i.field === "stream" && i.level === "blocked")).toBe(true);
      expect(validated[1].status).toBe("blocked");
      expect(validated[1].issues.some((i) => i.field === "stream" && i.level === "blocked")).toBe(true);
    });
  });

  describe("Template & Error Report Helpers", () => {
    it("generates streamlined template CSV containing headers and sample data", () => {
      const template = buildTemplateCsv(MOCK_CLASSES);
      expect(template).toContain("Admission Number");
      expect(template).toContain("Full Name");
      expect(template).toContain("Assessment Number");
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
