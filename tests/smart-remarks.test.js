import { describe, it, expect } from "vitest";
import { getSmartTeacherRemark, getSmartPrincipalRemark } from "../js/services/smart-remarks.util.js";

describe("Smart Remarks Engine", () => {
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
    expect(teacherRemark).toContain("Kiswahili");
    expect(principalRemark).toContain("Brian");
    expect(principalRemark).toMatch(/Exceptional|Outstanding|Exemplary/);
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
    expect(principalRemark).toMatch(/Commendable|Good|encouraging/i);
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
    expect(principalRemark).toMatch(/Average|Fair|Below/);
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
    expect(teacherRemark).toMatch(/remedial|interv/i);
    expect(principalRemark).toMatch(/Unsatisfactory|benchmark|Substandard/i);
  });
});
