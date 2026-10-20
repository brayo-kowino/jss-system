import { describe, it, expect } from "vitest";
import {
  getSmartTeacherRemark,
  getSmartPrincipalRemark,
  getSmartSubjectRemark,
  getSmartParentRemark,
} from "../js/services/smart-remarks.util.js";

describe("Smart Remarks Engine v3.0", () => {
  it("generates personalized remarks for high achievers (EE tier)", () => {
    const student = {
      fullName: "Brian Omondi",
      gender: "male",
      admissionNumber: "ADM001",
      meanGrade: "EE1",
      meanMarks: 86.5,
      subjects: [
        { name: "Mathematics", average: 94, grade: "EE1" },
        { name: "Integrated Science", average: 88, grade: "EE1" },
        { name: "Kiswahili", average: 74, grade: "EE2" },
      ],
    };

    const teacherRemark = getSmartTeacherRemark(student);
    const principalRemark = getSmartPrincipalRemark(student);

    expect(teacherRemark).toContain("Brian");
    expect(teacherRemark).toContain("Mathematics");
    expect(principalRemark).toContain("Brian");
    expect(principalRemark).toMatch(/Exceptional|Outstanding|Exemplary|Distinguished|Superb/i);
  });

  it("identifies areas needing attention for meeting expectations (ME tier)", () => {
    const student = {
      fullName: "Faith Wangari",
      gender: "female",
      admissionNumber: "ADM002",
      meanGrade: "ME1",
      meanMarks: 64.0,
      subjects: [
        { name: "Integrated Science", average: 76, grade: "EE2" },
        { name: "Social Studies", average: 63, grade: "ME1" },
        { name: "Pre-Technical Studies", average: 45, grade: "ME2" },
      ],
    };

    const teacherRemark = getSmartTeacherRemark(student);
    const principalRemark = getSmartPrincipalRemark(student);

    expect(teacherRemark).toContain("Faith");
    expect(teacherRemark).toContain("Integrated Science");
    expect(teacherRemark).toContain("Pre-Technical Studies");
    expect(principalRemark).toMatch(/Commendable|Good|encouraging|Satisfactory|Praiseworthy/i);
  });

  it("handles approaching expectations with corrective guidance (AE tier)", () => {
    const student = {
      fullName: "John Kamau",
      gender: "male",
      admissionNumber: "ADM003",
      meanGrade: "AE1",
      meanMarks: 44.5,
      subjects: [
        { name: "Agriculture", average: 56, grade: "ME1" },
        { name: "English", average: 32, grade: "AE2" },
      ],
    };

    const teacherRemark = getSmartTeacherRemark(student);
    const principalRemark = getSmartPrincipalRemark(student);

    expect(teacherRemark).toContain("John");
    expect(teacherRemark).toContain("Agriculture");
    expect(teacherRemark).toContain("English");
    expect(principalRemark).toMatch(/Average|Fair|Moderate|Room|Modest/i);
  });

  it("handles below expectations with urgent remedial focus (BE tier)", () => {
    const student = {
      fullName: "Grace Achieng",
      gender: "female",
      admissionNumber: "ADM004",
      meanGrade: "BE1",
      meanMarks: 24.0,
      subjects: [
        { name: "Creative Arts", average: 38, grade: "ME2" },
        { name: "Mathematics", average: 15, grade: "BE2" },
      ],
    };

    const teacherRemark = getSmartTeacherRemark(student);
    const principalRemark = getSmartPrincipalRemark(student);

    expect(teacherRemark).toContain("Grace");
    expect(teacherRemark).toContain("Mathematics");
    expect(teacherRemark).toMatch(/remedial|intervention|recovery|catch-up/i);
    expect(principalRemark).toMatch(/Unsatisfactory|benchmark|Substandard|Concerning/i);
  });

  it("seamlessly incorporates position and class size data", () => {
    const student = {
      fullName: "Kevin Mutua",
      gender: "male",
      admissionNumber: "ADM005",
      meanGrade: "EE1",
      meanMarks: 89.0,
      overallPosition: 2,
      classSize: 45,
      subjects: [
        { name: "Mathematics", average: 92, grade: "EE1" },
        { name: "English", average: 86, grade: "EE1" },
      ],
    };

    const remark = getSmartTeacherRemark(student);
    expect(remark).toMatch(/2nd out of 45|position 2/i);
  });

  it("detects and highlights positive trajectory and rank climbing", () => {
    const student = {
      fullName: "Amina Hassan",
      gender: "female",
      admissionNumber: "ADM006",
      meanGrade: "ME1",
      meanMarks: 68.0,
      previousMeanMarks: 58.0,
      classPosition: 5,
      previousClassPosition: 12,
      streamClassSize: 40,
      subjects: [
        { name: "Integrated Science", average: 75, grade: "EE2" },
        { name: "Mathematics", average: 62, grade: "ME1" },
      ],
    };

    const remark = getSmartTeacherRemark(student);
    // Should mention the positive momentum or rank jump
    expect(remark).toMatch(/advancing 7 positions|climbed 7 places|leap of 7 ranks|improvement|progress|momentum/i);
  });

  it("integrates high and low attendance signals", () => {
    const highAttStudent = {
      fullName: "David Kiprono",
      gender: "male",
      admissionNumber: "ADM007",
      meanGrade: "ME1",
      meanMarks: 65.0,
      attendanceRate: 98,
      subjects: [{ name: "Mathematics", average: 65, grade: "ME1" }],
    };

    const lowAttStudent = {
      fullName: "Mary Wambui",
      gender: "female",
      admissionNumber: "ADM008",
      meanGrade: "AE1",
      meanMarks: 46.0,
      attendanceRate: 74,
      subjects: [{ name: "Social Studies", average: 46, grade: "AE1" }],
    };

    const highRemark = getSmartTeacherRemark(highAttStudent);
    expect(highRemark).toMatch(/98% attendance/i);

    const lowRemark = getSmartTeacherRemark(lowAttStudent);
    expect(lowRemark).toMatch(/74% attendance/i);
  });

  it("generates targeted subject-level micro-remarks", () => {
    const student = {
      admissionNumber: "ADM009",
      fullName: "Samuel Ndungu",
    };

    const highSubj = { name: "Mathematics", average: 91, grade: "EE1" };
    const lowSubj = { name: "Kiswahili", average: 28, grade: "BE2" };

    const highRemark = getSmartSubjectRemark(student, highSubj);
    const lowRemark = getSmartSubjectRemark(student, lowSubj);

    expect(highRemark).toContain("Mathematics");
    expect(highRemark).toMatch(/Exemplary|mastery|analytical|outstanding|competence/i);

    expect(lowRemark).toContain("Kiswahili");
    expect(lowRemark).toMatch(/remedial|guidance|review|Struggles/i);
  });

  it("generates compassionate, actionable parent-facing remarks", () => {
    const student = {
      fullName: "Zainab Ali",
      gender: "female",
      admissionNumber: "ADM010",
      meanGrade: "ME1",
      meanMarks: 62.0,
      subjects: [
        { name: "English", average: 75, grade: "EE2" },
        { name: "Mathematics", average: 48, grade: "ME2" },
      ],
    };

    const parentRemark = getSmartParentRemark(student);
    expect(parentRemark).toContain("Zainab");
    expect(parentRemark).toContain("English");
    expect(parentRemark).toMatch(/home|routine|practice|revision/i);
  });

  it("preserves strict determinism across multiple invocations", () => {
    const student = {
      fullName: "Dennis Otieno",
      gender: "male",
      admissionNumber: "ADM011",
      meanGrade: "ME1",
      meanMarks: 67.5,
      subjects: [
        { name: "Integrated Science", average: 78, grade: "EE2" },
        { name: "Pre-Technical Studies", average: 57, grade: "ME1" },
      ],
    };

    const remark1 = getSmartTeacherRemark(student);
    const remark2 = getSmartTeacherRemark(student);
    const principal1 = getSmartPrincipalRemark(student);
    const principal2 = getSmartPrincipalRemark(student);

    expect(remark1).toBe(remark2);
    expect(principal1).toBe(principal2);
  });

  it("avoids template collisions between peers with similar marks", () => {
    const studentA = {
      fullName: "Alice Muthoni",
      gender: "female",
      admissionNumber: "ADM101",
      meanGrade: "ME1",
      meanMarks: 60.0,
      subjects: [{ name: "Mathematics", average: 60, grade: "ME1" }],
    };

    const studentB = {
      fullName: "Bob Maina",
      gender: "male",
      admissionNumber: "ADM102",
      meanGrade: "ME1",
      meanMarks: 60.0,
      subjects: [{ name: "Integrated Science", average: 60, grade: "ME1" }],
    };

    const remarkA = getSmartTeacherRemark(studentA);
    const remarkB = getSmartTeacherRemark(studentB);

    // Remarks should not be identical because best subject and admission number differ
    expect(remarkA).not.toBe(remarkB);
  });

  it("consistently handles unknown gender using plural pronouns without discordance", () => {
    const student = {
      fullName: "Taylor Kim",
      admissionNumber: "ADM099",
      meanGrade: "EE1",
      meanMarks: 85.0,
      subjects: [
        { name: "Mathematics", average: 90, grade: "EE1" },
        { name: "English", average: 80, grade: "EE1" },
      ],
    };

    const remark = getSmartTeacherRemark(student);
    expect(remark).toContain("Taylor");
    // Should use 'they' / 'their' / 'them'
    expect(remark).not.toMatch(/\bhe\b|\bshe\b|\bhis\b|\bher\b/i);
  });
});
