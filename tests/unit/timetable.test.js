import { describe, it, expect } from "vitest";
import {
  detectTimetableConflicts,
  buildCollisionFreeSchedule,
  createTimetableDraft,
  DAYS,
  DEFAULT_PERIODS,
  generateSecureShareToken,
  generateStandaloneHtml,
  isDoubleEligibleSubject,
  isDoubleAllowed,
  isBreakPeriod,
  timeToMinutes,
  minutesToTime,
  addMinutesToTime,
  calculateDurationMinutes,
  MAX_TEACHER_WEEKLY_LESSONS,
  MAX_TEACHER_DAILY_LESSONS,
} from "../../js/services/timetable.service.js";
import { buildTimetableGrid } from "../../js/services/timetable-layout.js";
import { renderTimetablePdf } from "../../js/services/timetable-pdf.js";

describe("Timetable Conflict Detection & Scheduling Engine", () => {
  it("honours class overrides and keeps a practical block with its assigned teacher and room", () => {
    const [first, second] = [{ grade: "Grade 7", stream: "Blue" }, { grade: "Grade 7", stream: "Green" }];
    const periods = DEFAULT_PERIODS.map((period, index) => ({ ...period, id: `p${index}` }));
    const plan = [{ code: "SCI", count: 2, double: true, room: "Science Lab" }];
    const result = createTimetableDraft({
      cohorts: [first, second], instructionalPeriods: periods, periods,
      subjects: [{ code: "SCI", name: "Integrated Science" }],
      teachers: [{ id: "science", fullName: "A. Mwangi", teachingAssignments: [{ ...first, subjectCode: "SCI" }] }],
      plan, cohortPlans: [{ ...second, plan: [{ code: "SCI", count: 1, room: "Science Lab" }] }],
    });
    expect(result).toMatchObject({ scheduled: 3, staffed: 2, doubles: 1 });
    expect(result.issues).toMatchObject([{ ...second, hasTeacher: false, unassigned: 1 }]);
    const science = result.slots.filter(({ stream }) => stream === first.stream);
    expect(science.every((slot) => slot.isDouble && slot.teacherId === "science" && slot.room === "Science Lab")).toBe(true);
    expect(science[0].day).toBe(science[1].day);
    expect(periods.find((p) => p.id === science[0].periodId).endTime)
      .toBe(periods.find((p) => p.id === science[1].periodId).startTime);
    expect(detectTimetableConflicts(result.slots)).toEqual([]);
  });

  it("reports unavoidable room shortages and leaves saved activities in place", () => {
    const cohorts = [{ grade: "Grade 7" }, { grade: "Grade 8" }];
    const periods = [{ id: "first", name: "Period 1", startTime: "08:00", endTime: "08:40" },
      { id: "second", name: "Period 2", startTime: "08:40", endTime: "09:20" }];
    const activity = { ...cohorts[0], day: "Monday", periodId: "first", subjectCode: "CLUB", isActivity: true };
    const result = createTimetableDraft({
      cohorts, periods, instructionalPeriods: periods, days: ["Monday"],
      subjects: [{ code: "SCI", name: "Science" }, { code: "PTS", name: "Pre-Technical Studies" }],
      plan: [{ code: "SCI", count: 1, room: "Hall Lab" }],
      cohortPlans: [{ ...cohorts[1], plan: [
        { code: "SCI", count: 1, room: "Hall Lab" }, { code: "PTS", count: 1, room: "Hall Lab" },
      ] }],
      lockedSlots: [activity],
    });
    expect(result.slots).toContainEqual(activity);
    expect(result.scheduled).toBe(2);
    expect(result.issues.some((issue) => issue.unscheduled === 1 && issue.roomOverCapacity === "Hall Lab")).toBe(true);
    expect(detectTimetableConflicts(result.slots)).toEqual([]);
  });

  it("uses separate usual classrooms when named rooms are off, preserving rooms in the plan", () => {
    const cohorts = [{ grade: "Grade 7", stream: "East" }, { grade: "Grade 7", stream: "West" }];
    const periods = [{ id: "first", name: "Period 1", startTime: "08:00", endTime: "08:40" }];
    const options = {
      cohorts, periods, instructionalPeriods: periods, days: ["Monday"],
      subjects: [{ code: "SCI", name: "Science" }],
      plan: [{ code: "SCI", count: 1, room: "Science Lab" }],
    };
    const draft = createTimetableDraft({ ...options, useNamedRooms: false });
    expect(draft.scheduled).toBe(2);
    expect(draft.plan[0].room).toBe("Science Lab");
    expect(detectTimetableConflicts(draft.slots, { useNamedRooms: false })).toEqual([]);
    const withSameTeacher = draft.slots.map((slot) => ({ ...slot, teacherId: "teacher" }));
    expect(detectTimetableConflicts(withSameTeacher, { useNamedRooms: false }).map(({ type }) => type)).toEqual(["teacher"]);
    expect(createTimetableDraft({ ...options, useNamedRooms: true }).scheduled).toBe(1);
    expect(createTimetableDraft({ ...options, plan: [{ code: "SCI", count: 1, room: "Classroom" }] }).scheduled).toBe(2);
  });

  it("refuses to generate from overlapping bell periods", () => {
    const periods = [
      { id: "a", name: "Period 1", startTime: "08:00", endTime: "08:40" },
      { id: "b", name: "Period 2", startTime: "08:30", endTime: "09:10" },
    ];
    expect(() => createTimetableDraft({ cohorts: [{ grade: "Grade 7" }], instructionalPeriods: periods, periods }))
      .toThrow(/Period 2 overlaps Period 1/);
  });

  it("merges adjacent practical lessons in a wall chart and keeps their second-period conflict visible", () => {
    const periods = DEFAULT_PERIODS.slice(0, 3).map((period, index) => ({ ...period, id: `p${index}` }));
    const slot = { grade: "Grade 7", subjectCode: "SCI", subjectName: "Science", teacherId: "teacher", room: "Lab A" };
    const slots = [{ ...slot, id: "first" }, { ...slot, id: "second" }, { ...slot, room: "Lab B" }];
    const grid = buildTimetableGrid({
      kind: "master", periods, days: ["Monday"], cohorts: [{ grade: "Grade 7" }],
      conflictIds: new Set(["second"]), getSlot: (day, id) => slots[Number(id.slice(1))],
    });
    expect(grid.groups[0].rows[0].cells).toMatchObject([
      { colspan: 2, conflict: true, detail: "Lab A" }, { colspan: 1, detail: "Lab B" },
    ]);
    const teacherGrid = buildTimetableGrid({
      kind: "teacher", periods, days: ["Monday"], useNamedRooms: false, getSlot: (day, id) => slots[Number(id.slice(1))],
    });
    expect(teacherGrid.groups[0].rows[0].cells).toMatchObject([
      { colspan: 2, detail: "Grade 7" }, { colspan: 1 },
    ]);
  });

  it("paginates a large landscape PDF while preserving text content", async () => {
    const periods = DEFAULT_PERIODS.map((period, index) => ({ ...period, id: `p${index}` }));
    const cohorts = Array.from({ length: 25 }, (_, index) => ({ grade: `Grade ${index + 1}` }));
    const grid = buildTimetableGrid({
      kind: "master", periods, cohorts, days: DAYS,
      getSlot: () => ({ subjectName: "Advanced Practical Science", room: "Science Lab", teacherName: "A. Mwangi" }),
    });
    const pdf = await renderTimetablePdf(grid, { school: "Kilimani Junior School", title: "Master timetable" });
    const source = new TextDecoder("windows-1252").decode(await pdf.arrayBuffer());
    expect(source).toMatch(/^%PDF-/);
    expect(source.match(/\/Type \/Page\b/g).length).toBeGreaterThan(1);
    expect(source).toContain("/BaseFont /Times-Bold");
  });

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

    it("allows multiple classes to share outdoor venues like Sports Field or Pitch without room collisions", () => {
      const slots = [
        {
          id: "slot1",
          grade: "Grade 7",
          stream: "Blue",
          day: "Thursday",
          periodId: "p6",
          teacherId: "tr1",
          room: "Sports Field",
        },
        {
          id: "slot2",
          grade: "Grade 8",
          stream: "Red",
          day: "Thursday",
          periodId: "p6",
          teacherId: "tr2",
          room: "Sports Field",
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

    it("handles realistic multi-stream school with 8 cohorts and shared teachers without collisions or dropped slots", () => {
      const cohorts = [
        { grade: "Grade 5", stream: "" },
        { grade: "Grade 6", stream: "Blue" },
        { grade: "Grade 6", stream: "Green" },
        { grade: "Grade 7", stream: "Blue" },
        { grade: "Grade 7", stream: "Green" },
        { grade: "Grade 7", stream: "Red" },
        { grade: "Grade 8", stream: "Blue" },
        { grade: "Grade 9", stream: "Green" },
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
      const teachers = [
        {
          id: "t_purity",
          fullName: "Purity Atieno",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "ENG" },
            { grade: "Grade 7", stream: "Green", subjectCode: "ENG" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "SCI" },
            { grade: "Grade 9", stream: "Green", subjectCode: "SCI" },
          ],
        },
        {
          id: "t_allan",
          fullName: "Allan Owino",
          teachingAssignments: [
            { grade: "Grade 5", stream: "", subjectCode: "MATH" },
            { grade: "Grade 6", stream: "Blue", subjectCode: "MATH" },
            { grade: "Grade 6", stream: "Green", subjectCode: "MATH" },
          ],
        },
        {
          id: "t_benard",
          fullName: "Benard Owino",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "AGR" },
            { grade: "Grade 7", stream: "Green", subjectCode: "AGR" },
            { grade: "Grade 7", stream: "Red", subjectCode: "AGR" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "CRE" },
          ],
        },
        {
          id: "t_mercy",
          fullName: "Mercy Akeyo",
          teachingAssignments: [
            { grade: "Grade 5", stream: "", subjectCode: "KIS" },
            { grade: "Grade 6", stream: "Blue", subjectCode: "KIS" },
            { grade: "Grade 6", stream: "Green", subjectCode: "KIS" },
          ],
        },
        {
          id: "t_finley",
          fullName: "Finley Owino",
          teachingAssignments: [
            { grade: "Grade 6", stream: "Blue", subjectCode: "CRA" },
            { grade: "Grade 6", stream: "Green", subjectCode: "CRA" },
            { grade: "Grade 7", stream: "Green", subjectCode: "SST" },
          ],
        },
        {
          id: "t_john",
          fullName: "John Ochieng",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Red", subjectCode: "MATH" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "MATH" },
            { grade: "Grade 9", stream: "Green", subjectCode: "MATH" },
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

      console.log("Realistic test - slots generated:", generated.length, "expected:", 8 * 40);
      const conflicts = detectTimetableConflicts(generated);
      console.log("Realistic test - conflicts:", conflicts.length);
      expect(conflicts).toHaveLength(0);
      expect(generated).toHaveLength(8 * 40);
    });
  });

  describe("JSS Default Periods & Daily Break Structure", () => {
    it("contains 8 instructional periods, Short Break, Lunch, and Games & Clubs", () => {
      expect(DEFAULT_PERIODS).toBeDefined();
      expect(DEFAULT_PERIODS.length).toBe(11);

      const breaks = DEFAULT_PERIODS.filter((p) => p.isBreak);
      const instructional = DEFAULT_PERIODS.filter((p) => !p.isBreak);

      expect(instructional).toHaveLength(8);
      expect(breaks).toHaveLength(3);

      expect(breaks.map((b) => b.name)).toEqual([
        "Short Break",
        "Lunch",
        "Games & Clubs",
      ]);
    });

    it("verifies JSS daily sequence: Periods 1-3 -> Short Break -> Periods 4-6 -> Lunch -> Periods 7-8 -> Games & Clubs", () => {
      const names = DEFAULT_PERIODS.map((p) => p.name);
      expect(names).toEqual([
        "Period 1",
        "Period 2",
        "Period 3",
        "Short Break",
        "Period 4",
        "Period 5",
        "Period 6",
        "Lunch",
        "Period 7",
        "Period 8",
        "Games & Clubs",
      ]);

      const games = DEFAULT_PERIODS.find((p) => p.name === "Games & Clubs");
      expect(games.startTime).toBe("14:30");
      expect(games.endTime).toBe("15:30");
      expect(games.isBreak).toBe(true);
    });

    it("isBreakPeriod() automatically identifies lunch, breaks, and non-instructional slots even if isBreak flag was omitted", () => {
      // Unflagged lunch (as seen in Sirandumb where user forgot to check the box)
      expect(isBreakPeriod({ name: "LUNCH", isBreak: false })).toBe(true);
      expect(isBreakPeriod({ name: "Lunch", isBreak: false })).toBe(true);
      expect(isBreakPeriod({ name: "Lunch Break", isBreak: false })).toBe(true);

      // Other variations of breaks
      expect(isBreakPeriod({ name: "SHORT BREAK", isBreak: false })).toBe(true);
      expect(isBreakPeriod({ name: "SECOND BREAK", isBreak: false })).toBe(true);
      expect(isBreakPeriod({ name: "Tea Break" })).toBe(true);
      expect(isBreakPeriod({ name: "Recess" })).toBe(true);
      expect(isBreakPeriod({ name: "Games & Clubs" })).toBe(true);
      expect(isBreakPeriod({ name: "Morning Devotion" })).toBe(true);
      expect(isBreakPeriod({ name: "School Assembly" })).toBe(true);

      // Explicitly flagged
      expect(isBreakPeriod({ name: "Custom Time", isBreak: true })).toBe(true);

      // Normal teaching periods must remain false
      expect(isBreakPeriod({ name: "Period 1", isBreak: false })).toBe(false);
      expect(isBreakPeriod({ name: "Period 6", isBreak: false })).toBe(false);
      expect(isBreakPeriod({ name: "Mathematics", isBreak: false })).toBe(false);
      expect(isBreakPeriod({ name: "Lesson 3" })).toBe(false);
    });

    it("timeToMinutes, minutesToTime, addMinutesToTime, calculateDurationMinutes calculate period durations correctly", () => {
      expect(timeToMinutes("08:20")).toBe(500);
      expect(timeToMinutes("09:00")).toBe(540);
      expect(minutesToTime(500)).toBe("08:20");
      expect(minutesToTime(540)).toBe("09:00");

      expect(addMinutesToTime("08:20", 40)).toBe("09:00");
      expect(addMinutesToTime("09:40", 10)).toBe("09:50");
      expect(addMinutesToTime("13:00", 60)).toBe("14:00");

      expect(calculateDurationMinutes("08:20", "09:00")).toBe(40);
      expect(calculateDurationMinutes("09:40", "09:50")).toBe(10);
      expect(calculateDurationMinutes("11:10", "11:40")).toBe(30);
      expect(calculateDurationMinutes("13:00", "14:00")).toBe(60);
    });
  });

  describe("Public Timetable Sharing & Standalone HTML Generator", () => {
    it("generateSecureShareToken() generates high-entropy unguessable tokens with 0 collisions", () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        const token = generateSecureShareToken();
        expect(typeof token).toBe("string");
        expect(token.length).toBeGreaterThanOrEqual(16);
        tokens.add(token);
      }
      expect(tokens.size).toBe(100);
    });

    it("generateStandaloneHtml() creates a standalone, self-contained HTML document with complete timetable structure", () => {
      const sampleData = {
        type: "master",
        title: "Master Timetable 2026",
        subTitle: "All Classes",
        schoolInfo: {
          name: "Kilimani Junior Secondary School",
          motto: "Elimu Ni Nguvu",
          academicYear: 2026,
          term: "Term 1",
        },
        periods: DEFAULT_PERIODS.map((p, idx) => ({ ...p, id: `p${idx + 1}` })),
        slots: [
          {
            grade: "Grade 7",
            stream: "A",
            day: "Monday",
            periodId: "p1",
            subjectCode: "MAT",
            subjectName: "Mathematics",
            teacherName: "Mr. Mwangi",
            room: "Room 101",
          },
          {
            grade: "Grade 7",
            stream: "A",
            day: "Monday",
            periodId: "p2",
            subjectCode: "ENG",
            subjectName: "English",
            teacherName: "Mrs. Otieno",
            room: "Room 101",
          },
        ],
      };

      const html = generateStandaloneHtml(sampleData);

      expect(typeof html).toBe("string");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Kilimani Junior Secondary School");
      expect(html).toContain("Elimu Ni Nguvu");
      expect(html).toContain("Master Timetable 2026");
      expect(html).toContain("Term 1");
      expect(html).toContain("Mathematics");
      expect(html).toContain("Mr. Mwangi");
      expect(html).toContain("Short Break");
      expect(html).toContain("Lunch");
      expect(new DOMParser().parseFromString(html, "text/html").body.textContent).toContain("Games & Clubs");
      expect(html).toContain("window.print()");
      expect(html).toContain("@media print");
    });

    it("generateStandaloneHtml() renders teacher schedule with FREE / PREP markers for unscheduled periods", () => {
      const teacherData = {
        type: "teacher",
        title: "Teacher Schedule: Mr. Mwangi",
        schoolInfo: {
          name: "Kilimani Junior Secondary School",
        },
        periods: [
          { id: "p1", name: "Period 1", startTime: "08:00", endTime: "08:45", isBreak: false },
          { id: "b1", name: "Short Break", startTime: "08:45", endTime: "09:05", isBreak: true },
          { id: "p2", name: "Period 2", startTime: "09:05", endTime: "09:50", isBreak: false },
        ],
        slots: [
          {
            grade: "Grade 7",
            stream: "A",
            day: "Monday",
            periodId: "p1",
            subjectCode: "MAT",
            subjectName: "Mathematics",
            teacherName: "Mr. Mwangi",
          },
        ],
      };

      const html = generateStandaloneHtml(teacherData);
      expect(html).toContain("Teacher Schedule: Mr. Mwangi");
      expect(html).toContain("Grade 7 A");
      expect(html).toContain("FREE / PREP");
      expect(html).not.toContain('<th style="width:110px;">CLASS</th>');
    });
  });

  describe("CBC Timetable Quality Standards: Daily Subject Distribution & Teacher Free Periods", () => {
    it("isDoubleAllowed() allows practical sciences and explicit double flags, but rejects theory subjects", () => {
      // Practical sciences & arts are double-eligible
      expect(isDoubleAllowed({ subjectCode: "SCI" })).toBe(true);
      expect(isDoubleAllowed({ subjectCode: "AGR" })).toBe(true);
      expect(isDoubleAllowed({ subjectCode: "PTS" })).toBe(true);
      expect(isDoubleAllowed({ subjectCode: "CRA" })).toBe(true);
      expect(isDoubleAllowed({ subjectCode: "PE" })).toBe(true);

      // Theory subjects are NOT double-eligible by default
      expect(isDoubleAllowed({ subjectCode: "MATH" })).toBe(false);
      expect(isDoubleAllowed({ subjectCode: "ENG" })).toBe(false);
      expect(isDoubleAllowed({ subjectCode: "KIS" })).toBe(false);
      expect(isDoubleAllowed({ subjectCode: "SST" })).toBe(false);
      expect(isDoubleAllowed({ subjectCode: "CRE" })).toBe(false);

      // Explicit manual admin override with isDouble: true is honored
      expect(isDoubleAllowed({ subjectCode: "MATH", isDouble: true })).toBe(true);
    });

    it("guarantees Mathematics is scheduled strictly 1 period per day (Mon-Fri) for all classes, with 0 repeats in a day", () => {
      const cohorts = [
        { grade: "Grade 7", stream: "Blue" },
        { grade: "Grade 7", stream: "Green" },
        { grade: "Grade 8", stream: "Blue" },
      ];
      const periods = DEFAULT_PERIODS.map((p, idx) => ({ ...p, id: `p${idx + 1}` }));
      const instructionalPeriods = periods.filter((p) => !p.isBreak);

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
          id: "t_allan",
          fullName: "Allan Owino",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "MATH" },
            { grade: "Grade 7", stream: "Green", subjectCode: "MATH" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "MATH" },
          ],
        },
        {
          id: "t_purity",
          fullName: "Purity Atieno",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "ENG" },
            { grade: "Grade 7", stream: "Green", subjectCode: "ENG" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "ENG" },
          ],
        },
        {
          id: "t_mercy",
          fullName: "Mercy Akeyo",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "KIS" },
            { grade: "Grade 7", stream: "Green", subjectCode: "KIS" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "KIS" },
          ],
        },
        {
          id: "t_science",
          fullName: "Finley Owino",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "SCI" },
            { grade: "Grade 7", stream: "Green", subjectCode: "SCI" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "SCI" },
          ],
        },
      ];

      const generated = buildCollisionFreeSchedule({
        cohorts,
        instructionalPeriods,
        periods,
        days: DAYS,
        subjects,
        teachers,
      });

      expect(generated.length).toBe(cohorts.length * DAYS.length * instructionalPeriods.length);

      // Check daily distribution for every cohort
      for (const cohort of cohorts) {
        for (const day of DAYS) {
          const daySlots = generated.filter(
            (s) => s.grade === cohort.grade && s.stream === cohort.stream && s.day === day
          );

          // Mathematics must be EXACTLY 1 lesson per day (never 0, never >= 2)
          const mathCount = daySlots.filter((s) => s.subjectCode === "MATH").length;
          expect(mathCount).toBe(1);

          // English must be EXACTLY 1 lesson per day (never 0, never >= 2)
          const engCount = daySlots.filter((s) => s.subjectCode === "ENG").length;
          expect(engCount).toBe(1);

          // Kiswahili must be at most 1 lesson per day
          const kisCount = daySlots.filter((s) => s.subjectCode === "KIS").length;
          expect(kisCount).toBeLessThanOrEqual(1);

          // Social Studies and CRE must be at most 1 lesson per day
          const sstCount = daySlots.filter((s) => s.subjectCode === "SST").length;
          expect(sstCount).toBeLessThanOrEqual(1);
          const creCount = daySlots.filter((s) => s.subjectCode === "CRE").length;
          expect(creCount).toBeLessThanOrEqual(1);
        }
      }
    });

    it("guarantees every teacher has free periods daily with daily load <= 6 and weekly load <= 28", () => {
      const cohorts = [
        { grade: "Grade 7", stream: "Blue" },
        { grade: "Grade 7", stream: "Green" },
        { grade: "Grade 8", stream: "Blue" },
      ];
      const periods = DEFAULT_PERIODS.map((p, idx) => ({ ...p, id: `p${idx + 1}` }));
      const instructionalPeriods = periods.filter((p) => !p.isBreak);

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
          id: "t_allan",
          fullName: "Allan Owino",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "MATH" },
            { grade: "Grade 7", stream: "Green", subjectCode: "MATH" },
            { grade: "Grade 8", stream: "Blue", subjectCode: "MATH" },
          ],
        },
      ];

      const generated = buildCollisionFreeSchedule({
        cohorts,
        instructionalPeriods,
        periods,
        days: DAYS,
        subjects,
        teachers,
      });

      // Allan teaches 3 cohorts x 5 days = 15 lessons total
      const allanSlots = generated.filter((s) => s.teacherId === "t_allan");
      expect(allanSlots.length).toBeLessThanOrEqual(MAX_TEACHER_WEEKLY_LESSONS); // <= 28

      // On each day, Allan teaches <= 6 lessons, leaving at least 2 free periods out of 8
      for (const day of DAYS) {
        const allanDaySlots = allanSlots.filter((s) => s.day === day);
        expect(allanDaySlots.length).toBeLessThanOrEqual(MAX_TEACHER_DAILY_LESSONS); // <= 6
        const freePeriods = instructionalPeriods.length - allanDaySlots.length;
        expect(freePeriods).toBeGreaterThanOrEqual(2); // Guaranteed at least 2 free periods daily
      }
    });

    it("verifies practical sciences double lessons are consecutive and never cross break intervals", () => {
      const cohorts = [{ grade: "Grade 7", stream: "Blue" }];
      const periods = DEFAULT_PERIODS.map((p, idx) => ({ ...p, id: `p${idx + 1}` }));
      const instructionalPeriods = periods.filter((p) => !p.isBreak);

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
          id: "t_mwangi",
          fullName: "Mr. Mwangi",
          teachingAssignments: [
            { grade: "Grade 7", stream: "Blue", subjectCode: "SCI" },
            { grade: "Grade 7", stream: "Blue", subjectCode: "AGR" },
          ],
        },
      ];

      const generated = buildCollisionFreeSchedule({
        cohorts,
        instructionalPeriods,
        periods,
        days: DAYS,
        subjects,
        teachers,
      });

      // Check if any double lessons exist
      for (const day of DAYS) {
        for (const subj of subjects) {
          const slots = generated.filter((s) => s.day === day && s.subjectCode === subj.code);
          if (slots.length === 2) {
            // Must be double-eligible
            expect(isDoubleEligibleSubject(subj.code)).toBe(true);

            // Must be consecutive without a break in between
            const p1 = slots[0];
            const p2 = slots[1];
            const idx1 = periods.findIndex((p) => p.id === p1.periodId);
            const idx2 = periods.findIndex((p) => p.id === p2.periodId);
            expect(Math.abs(idx2 - idx1)).toBe(1);
            expect(periods[idx1].isBreak).toBe(false);
            expect(periods[idx2].isBreak).toBe(false);
          }
        }
      }
    });
  });
});
