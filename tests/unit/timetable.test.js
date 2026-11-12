import { describe, it, expect } from "vitest";
import {
  detectTimetableConflicts,
  buildCollisionFreeSchedule,
  DAYS,
} from "../../js/services/timetable.service.js";

describe("Timetable Conflict Detection & Scheduling Engine", () => {
  describe("detectTimetableConflicts()", () => {
    it("reports 0 conflicts when slots are collision-free", () => {
      const slots = [
        {
          id: "slot1",
          grade: "Grade 7",
          stream: "Blue",
          day: "Monday",
          periodId: "p1",
          teacherId: "tr1",
          teacherName: "Mr. Mwangi",
          room: "Room 101",
        },
        {
          id: "slot2",
          grade: "Grade 8",
          stream: "Red",
          day: "Monday",
          periodId: "p1",
          teacherId: "tr2",
          teacherName: "Mrs. Otieno",
          room: "Room 102",
        },
        {
          id: "slot3",
          grade: "Grade 7",
          stream: "Blue",
          day: "Monday",
          periodId: "p2",
          teacherId: "tr2",
          teacherName: "Mrs. Otieno",
          room: "Room 101",
        },
      ];

      const conflicts = detectTimetableConflicts(slots);
      expect(conflicts).toHaveLength(0);
    });

    it("detects teacher collision when same teacher is booked in two classes at the same day & period", () => {
      const slots = [
        {
          id: "slot1",
          grade: "Grade 7",
          stream: "Blue",
          day: "Monday",
          periodId: "p1",
          teacherId: "tr1",
          teacherName: "Mr. Mwangi",
        },
        {
          id: "slot2",
          grade: "Grade 8",
          stream: "Red",
          day: "Monday",
          periodId: "p1",
          teacherId: "tr1",
          teacherName: "Mr. Mwangi",
        },
      ];

      const conflicts = detectTimetableConflicts(slots);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("teacher");
      expect(conflicts[0].teacherId).toBe("tr1");
      expect(conflicts[0].day).toBe("Monday");
      expect(conflicts[0].periodId).toBe("p1");
      expect(conflicts[0].message).toContain("Mr. Mwangi is double-booked");
    });

    it("detects room collision when same room is booked in two classes at the same day & period", () => {
      const slots = [
        {
          id: "slot1",
          grade: "Grade 7",
          stream: "Blue",
          day: "Tuesday",
          periodId: "p3",
          teacherId: "tr1",
          room: "Science Lab",
        },
        {
          id: "slot2",
          grade: "Grade 9",
          stream: "Green",
          day: "Tuesday",
          periodId: "p3",
          teacherId: "tr2",
          room: "science lab",
        },
      ];

      const conflicts = detectTimetableConflicts(slots);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("room");
      expect(conflicts[0].message.toLowerCase()).toContain("room \"science lab\" is double-booked");
    });

    it("ignores unassigned teacher or empty room without false positives", () => {
      const slots = [
        {
          id: "slot1",
          grade: "Grade 7",
          stream: "Blue",
          day: "Wednesday",
          periodId: "p4",
          teacherId: "",
          room: "",
        },
        {
          id: "slot2",
          grade: "Grade 8",
          stream: "Red",
          day: "Wednesday",
          periodId: "p4",
          teacherId: "",
          room: "",
        },
      ];

      const conflicts = detectTimetableConflicts(slots);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("buildCollisionFreeSchedule()", () => {
    it("generates a complete schedule with 0 teacher collisions across multiple cohorts", () => {
      const cohorts = [
        { grade: "Grade 7", stream: "Blue" },
        { grade: "Grade 7", stream: "Green" },
        { grade: "Grade 8", stream: "A" },
        { grade: "Grade 9", stream: "A" },
      ];

      const instructionalPeriods = [
        { id: "p1", name: "Period 1", startTime: "08:00", endTime: "08:40" },
        { id: "p2", name: "Period 2", startTime: "08:40", endTime: "09:20" },
        { id: "p3", name: "Period 3", startTime: "09:20", endTime: "10:00" },
        { id: "p4", name: "Period 4", startTime: "10:20", endTime: "11:00" },
        { id: "p5", name: "Period 5", startTime: "11:00", endTime: "11:40" },
        { id: "p6", name: "Period 6", startTime: "11:40", endTime: "12:20" },
        { id: "p7", name: "Period 7", startTime: "13:10", endTime: "13:50" },
        { id: "p8", name: "Period 8", startTime: "13:50", endTime: "14:30" },
      ];

      const subjects = [
        { code: "MATH", name: "Mathematics" },
        { code: "ENG", name: "English" },
        { code: "KIS", name: "Kiswahili" },
        { code: "SCI", name: "Integrated Science" },
        { code: "AGR", name: "Agriculture" },
        { code: "PTS", name: "Pre-Technical Studies" },
        { code: "SST", name: "Social Studies" },
        { code: "CRE", name: "CRE" },
        { code: "CRA", name: "Creative Arts" },
      ];

      // Several teachers teach across multiple grades (potential collision risk)
      const teachers = [
        {
          id: "t_math",
          fullName: "Mr. Math Master",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "MATH" },
            { grade: "Grade 7", stream: "Green", subjectCode: "MATH" },
            { grade: "Grade 8", stream: "A", subjectCode: "MATH" },
          ],
        },
        {
          id: "t_eng",
          fullName: "Mrs. English Queen",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "ENG" },
            { grade: "Grade 8", stream: "A", subjectCode: "ENG" },
            { grade: "Grade 9", stream: "A", subjectCode: "ENG" },
          ],
        },
        {
          id: "t_sci",
          fullName: "Dr. Science",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "SCI" },
            { grade: "Grade 7", stream: "Green", subjectCode: "SCI" },
            { grade: "Grade 8", stream: "A", subjectCode: "SCI" },
            { grade: "Grade 9", stream: "A", subjectCode: "SCI" },
          ],
        },
        {
          id: "t_kis",
          fullName: "Mwalimu Kiswahili",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Green", subjectCode: "KIS" },
            { grade: "Grade 8", stream: "A", subjectCode: "KIS" },
          ],
        },
      ];

      const generated = buildCollisionFreeSchedule({
        cohorts,
        instructionalPeriods,
        days: DAYS,
        subjects,
        teachers,
      });

      // Total expected slots = 4 cohorts * 8 periods/day * 5 days = 160 slots
      expect(generated).toHaveLength(160);

      // Verify ZERO conflicts exist in the generated schedule
      const conflicts = detectTimetableConflicts(generated);
      expect(conflicts).toHaveLength(0);

      // Verify every cohort has 40 slots
      for (const cohort of cohorts) {
        const cohortSlots = generated.filter(
          (s) => s.grade === cohort.grade && s.stream === cohort.stream
        );
        expect(cohortSlots).toHaveLength(40);
      }
    });

    it("shuffles lessons across varied periods instead of repeating the same subject at the same hour daily", () => {
      const cohorts = [{ grade: "Grade 5", stream: "" }];
      const instructionalPeriods = [
        { id: "p1", name: "Period 1", startTime: "08:00", endTime: "08:40" },
        { id: "p2", name: "Period 2", startTime: "08:40", endTime: "09:20" },
        { id: "p3", name: "Period 3", startTime: "09:20", endTime: "10:00" },
        { id: "p4", name: "Period 4", startTime: "10:20", endTime: "11:00" },
        { id: "p5", name: "Period 5", startTime: "11:00", endTime: "11:40" },
        { id: "p6", name: "Period 6", startTime: "11:40", endTime: "12:20" },
        { id: "p7", name: "Period 7", startTime: "13:10", endTime: "13:50" },
        { id: "p8", name: "Period 8", startTime: "13:50", endTime: "14:30" },
      ];
      const subjects = [
        { code: "MATH", name: "Mathematics" },
        { code: "ENG", name: "English" },
        { code: "KIS", name: "Kiswahili" },
        { code: "SCI", name: "Integrated Science" },
        { code: "AGR", name: "Agriculture" },
        { code: "PTS", name: "Pre-Technical Studies" },
        { code: "SST", name: "Social Studies" },
        { code: "CRE", name: "CRE" },
        { code: "CRA", name: "Creative Arts" },
      ];
      const teachers = [
        {
          id: "tr_owino",
          fullName: "Allan Owino",
          teachingAssignments: [
            { grade: "Grade 5", stream: "", subjectCode: "MATH" },
            { grade: "Grade 5", stream: "", subjectCode: "CRA" },
            { grade: "Grade 5", stream: "", subjectCode: "PTS" },
          ],
        },
      ];

      const generated = buildCollisionFreeSchedule({
        cohorts,
        instructionalPeriods,
        days: DAYS,
        subjects,
        teachers,
      });

      expect(generated).toHaveLength(40);

      // Verify Mathematics is distributed across multiple distinct periods (NOT same period every day)
      const mathSlots = generated.filter((s) => s.subjectCode === "MATH");
      const mathDistinctPeriods = new Set(mathSlots.map((s) => s.periodId));
      expect(mathDistinctPeriods.size).toBeGreaterThanOrEqual(4);

      // Verify Creative Arts is also distributed across multiple distinct periods
      const craSlots = generated.filter((s) => s.subjectCode === "CRA");
      const craDistinctPeriods = new Set(craSlots.map((s) => s.periodId));
      expect(craDistinctPeriods.size).toBeGreaterThanOrEqual(4);

      // Verify teacher Allan Owino doesn't teach the same class at the same period every day
      const teacherSlots = generated.filter((s) => s.teacherId === "tr_owino");
      const p1TeacherSlots = teacherSlots.filter((s) => s.periodId === "p1");
      // Across 5 days, teacher should NOT have the exact same class at P1 all 5 days
      const p1Subjects = new Set(p1TeacherSlots.map((s) => s.subjectCode));
      // Either teacher has different subjects/classes or free time at P1
      expect(p1TeacherSlots.length).toBeLessThan(5);
    });
  });
});
