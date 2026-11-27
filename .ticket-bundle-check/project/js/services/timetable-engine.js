import {
  DAYS, MAX_TEACHER_DAILY_LESSONS, MAX_TEACHER_WEEKLY_LESSONS,
  areAdjacentTeachingPeriods, isBreakPeriod, isDoubleEligibleSubject, roomBookingKey, timeToMinutes,
} from "./timetable-rules.js";

const DEFAULT_WEEKLY = {
  MATH: 5, ENG: 5, KIS: 4, SCI: 4, AGR: 4, PTS: 4,
  SST: 3, CRE: 3, IRE: 3, HRE: 3, CRA: 5,
};

export function defaultTimetablePlan(subjects, days, capacity) {
  const plan = subjects.map(({ code }) => ({
    code,
    count: Math.min(days, DEFAULT_WEEKLY[code] || 3),
    double: code === "SCI",
    room: "",
  }));
  let total = plan.reduce((sum, item) => sum + item.count, 0);
  while (total > capacity) {
    const item = plan.reduce((best, entry) => entry.count > best.count ? entry : best);
    item.count--;
    total--;
  }
  for (const item of plan) {
    if (total < capacity && item.count < days) {
      item.count++;
      total++;
    }
    item.double &&= item.count >= 2;
  }
  return plan;
}

function teacherCandidates(teachers, cohort, code) {
  const matches = teachers.map((teacher) => {
    const assignments = (teacher.teachingAssignments || []).filter((a) =>
      a.subjectCode === code && a.grade === cohort.grade);
    const exact = cohort.stream && assignments.some((a) => a.stream === cohort.stream);
    return { teacher, priority: exact ? 2 : Number(assignments.some((a) => !a.stream)) };
  }).filter(({ teacher, priority }) => teacher.id && priority);
  const bestPriority = Math.max(0, ...matches.map(({ priority }) => priority));
  return matches.filter(({ priority }) => priority === bestPriority).map(({ teacher }) => teacher);
}

const cohortKey = ({ grade, stream }) => JSON.stringify([grade, stream || ""]);

function createAttempt({ cohorts, teaching, days, pairs, demands, lockedSlots, fillStudy, useNamedRooms }) {
  const classStates = new Map(cohorts.map((cohort) => [cohortKey(cohort), {
    busy: new Set(), daily: new Array(days.length).fill(0), bySubject: new Map(),
  }]));
  const staff = new Map();
  const rooms = new Map();
  const slots = [];
  const singlePeriods = teaching.map((_, index) => index);
  let filled = 0;
  let staffed = 0;
  let doubles = 0;
  let repeats = 0;

  function teacherState(id) {
    if (!staff.has(id)) staff.set(id, { busy: new Set(), daily: new Array(days.length).fill(0), total: 0 });
    return staff.get(id);
  }

  function roomState(name) {
    if (!rooms.has(name)) rooms.set(name, new Set());
    return rooms.get(name);
  }

  function subjectState(state, code) {
    if (!state.bySubject.has(code)) state.bySubject.set(code, { days: new Set(), periods: new Map() });
    return state.bySubject.get(code);
  }

  function book(slot, day, period, state, subject) {
    const time = day * teaching.length + period;
    state.busy.add(time);
    state.daily[day]++;
    slots.push(slot);
    if (slot.isFree) return;
    subject.days.add(day);
    const uses = subject.periods.get(period) || 0;
    subject.periods.set(period, uses + 1);
    if (uses) repeats++;
    if (slot.teacherId) {
      const teacher = teacherState(slot.teacherId);
      teacher.busy.add(time);
      teacher.daily[day]++;
      teacher.total++;
    }
    const room = useNamedRooms ? roomBookingKey(slot.room) : "";
    if (room) roomState(room).add(time);
  }

  for (const slot of lockedSlots) {
    const day = days.indexOf(slot.day);
    const period = teaching.findIndex((p) => p.id === slot.periodId);
    const state = classStates.get(cohortKey(slot));
    book(slot, day, period, state, subjectState(state, slot.subjectCode));
  }

  function place(demand, width, teacherOptions) {
    const { cohort, item } = demand;
    const classState = classStates.get(cohortKey(cohort));
    const subject = subjectState(classState, item.code);
    const roomKey = demand.room;
    const room = roomKey ? roomState(roomKey) : null;
    const starts = width === 2 ? pairs : singlePeriods;
    let best = null;
    for (const teacher of teacherOptions) {
      const workload = teacher ? teacherState(teacher.id) : null;
      if (workload && workload.total + width > MAX_TEACHER_WEEKLY_LESSONS) continue;
      for (let day = 0; day < days.length; day++) {
        if (subject.days.has(day)) continue;
        if (workload && workload.daily[day] + width > MAX_TEACHER_DAILY_LESSONS) continue;
        for (const period of starts) {
          const time = day * teaching.length + period;
          if (classState.busy.has(time) || room?.has(time) || workload?.busy.has(time)) continue;
          if (width === 2 && (classState.busy.has(time + 1) || room?.has(time + 1) || workload?.busy.has(time + 1))) continue;
          const uses = (subject.periods.get(period) || 0) + (width === 2 ? subject.periods.get(period + 1) || 0 : 0);
          const score = Math.random() * 3 - uses * 8 - classState.daily[day] * 1.2 -
            (workload?.daily[day] || 0) * 1.5 - (workload?.total || 0) * 0.15;
          if (!best || score > best.score) best = { day, period, teacher, score };
        }
      }
    }
    if (!best) return false;
    for (let i = 0; i < width; i++) {
      book({
        ...cohort, day: days[best.day], periodId: teaching[best.period + i].id,
        subjectCode: item.code, subjectName: demand.name,
        teacherId: best.teacher?.id || "", teacherName: best.teacher?.fullName || best.teacher?.name || "",
        room: item.room, isDouble: width === 2,
      }, best.day, best.period + i, classState, subject);
    }
    filled += width;
    if (best.teacher) staffed += width;
    if (width === 2) doubles++;
    return true;
  }

  const pending = [];
  const ordered = demands.map((demand) => ({ ...demand, score: demand.priority + Math.random() * 14 }))
    .sort((a, b) => b.score - a.score);
  for (const demand of ordered) {
    const { item, candidates } = demand;
    let singles = item.count;
    if (item.double && (place(demand, 2, candidates) || place(demand, 2, [null]))) singles -= 2;
    for (let i = 0; i < singles; i++) {
      if (!place(demand, 1, candidates)) pending.push(demand);
    }
  }
  for (const demand of pending) place(demand, 1, [null]);

  if (fillStudy) {
    for (const cohort of cohorts) {
      const state = classStates.get(cohortKey(cohort));
      for (const [dayIndex, day] of days.entries()) {
        teaching.forEach((period, index) => {
          if (state.busy.has(dayIndex * teaching.length + index)) return;
          slots.push({
            ...cohort, day, periodId: period.id, subjectCode: "STUDY",
            subjectName: "Private Study", teacherId: "", teacherName: "", room: "",
          });
        });
      }
    }
  }
  return { slots, filled, staffed, doubles, repeats };
}

export function createTimetableDraft({
  cohorts, instructionalPeriods, periods = instructionalPeriods, days = DAYS,
  subjects = [], teachers = [], plan, cohortPlans = [], lockedSlots = [], useNamedRooms = true, attempts = 48,
}) {
  if (!cohorts?.length) throw new Error("Add at least one class in Academics.");
  if (!days.length || new Set(days).size !== days.length) throw new Error("Choose distinct timetable days.");
  const teaching = (instructionalPeriods || []).filter((p) => !isBreakPeriod(p))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  if (!teaching.length) throw new Error("Add at least one teaching period in Period Configuration.");
  const bellSchedule = [...periods].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  for (const [index, period] of bellSchedule.entries()) {
    const start = timeToMinutes(period.startTime);
    if (!period.startTime || !period.endTime || start >= timeToMinutes(period.endTime)) {
      throw new Error(`Set valid start and end times for ${period.name}.`);
    }
    if (index > 0 && start < timeToMinutes(bellSchedule[index - 1].endTime)) {
      throw new Error(`${period.name} overlaps ${bellSchedule[index - 1].name}. Adjust the bell schedule first.`);
    }
  }
  const capacity = days.length * teaching.length;
  const lessonPlan = plan || defaultTimetablePlan(subjects, days.length, capacity);
  const pairs = teaching.flatMap((p, i) => areAdjacentTeachingPeriods(p, teaching[i + 1]) ? [i] : []);
  const byCode = new Map(subjects.map((subject) => [subject.code, subject]));
  function normalizePlan(entries) {
    if (new Set(entries.map(({ code }) => code)).size !== entries.length) {
      throw new Error("Enter each subject once in the weekly lesson plan.");
    }
    return entries.map((rule) => {
      const subject = byCode.get(rule.code);
      const count = Number(rule.count);
      const double = rule.double === true && count >= 2;
      if (!subject || !Number.isInteger(count) || count < 0 || count > days.length + Number(double)) {
        throw new Error(`Check the weekly lesson count for ${subject?.name || rule.code}.`);
      }
      if (double && !isDoubleEligibleSubject(rule.code)) {
        throw new Error(`${subject.name} is set up for single periods only.`);
      }
      if (double && !pairs.length && plan) {
        throw new Error(`${subject.name} needs two consecutive teaching periods with no gap or break.`);
      }
      return { code: rule.code, count, double: double && pairs.length > 0, room: String(rule.room || "").trim() };
    });
  }
  const rules = normalizePlan(lessonPlan);
  const allowedCohorts = new Set(cohorts.map(cohortKey));
  const overrides = cohortPlans.filter((item) => allowedCohorts.has(cohortKey(item)))
    .map(({ grade, stream = "", plan: entries }) => ({ grade, stream, plan: normalizePlan(entries) }));
  const rulesByCohort = new Map(overrides.map((item) => [cohortKey(item), item.plan]));
  const periodIds = new Set(teaching.map(({ id }) => id));
  lockedSlots = lockedSlots.filter((slot) =>
    allowedCohorts.has(cohortKey(slot)) && days.includes(slot.day) && periodIds.has(slot.periodId));
  const demands = [];
  const teacherPressure = new Map();
  const roomPressure = new Map();
  for (const cohort of cohorts) {
    const key = cohortKey(cohort);
    const reserved = lockedSlots.filter((slot) => cohortKey(slot) === key).length;
    const available = Math.max(0, capacity - reserved);
    let effectiveRules = rulesByCohort.get(key) || rules;
    if (!plan && reserved && !rulesByCohort.has(key)) {
      effectiveRules = normalizePlan(defaultTimetablePlan(subjects, days.length, available));
      overrides.push({ ...cohort, stream: cohort.stream || "", plan: effectiveRules });
    }
    const expected = effectiveRules.reduce((sum, item) => sum + item.count, 0);
    if (expected > available) {
      const label = [cohort.grade, cohort.stream].filter(Boolean).join(" ");
      throw new Error(`${label} requests ${expected} lessons with ${available} teaching periods available after ${reserved} reserved periods. Reduce its weekly lesson counts.`);
    }
    for (const item of effectiveRules.filter(({ count }) => count)) {
      const candidates = teacherCandidates(teachers, cohort, item.code);
      const room = useNamedRooms ? roomBookingKey(item.room) : "";
      for (const { id } of candidates) {
        teacherPressure.set(id, (teacherPressure.get(id) || 0) + item.count / candidates.length);
      }
      if (room) roomPressure.set(room, (roomPressure.get(room) || 0) + item.count);
      demands.push({ cohort, item, candidates, room, name: byCode.get(item.code).name || item.code });
    }
  }
  for (const demand of demands) {
    const pressure = Math.max(0, ...demand.candidates.map(({ id }) => teacherPressure.get(id)));
    demand.priority = Number(demand.item.double) * 36 + demand.item.count * 13 +
      Math.min(25, pressure) + Math.min(25, roomPressure.get(demand.room) || 0) +
      (demand.candidates.length ? 12 / demand.candidates.length : 0);
  }

  const target = demands.reduce((sum, { item }) => sum + item.count, 0);
  let best = null;
  const requestedDoubles = demands.filter(({ item }) => item.double).length;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    const draft = createAttempt({ cohorts, teaching, days, pairs, demands, lockedSlots, fillStudy: !plan, useNamedRooms });
    const improvement = best && (draft.filled - best.filled || draft.staffed - best.staffed ||
      draft.doubles - best.doubles || best.repeats - draft.repeats);
    if (!best || improvement > 0) best = draft;
    if (draft.filled === target && draft.staffed === target && draft.doubles === requestedDoubles && draft.repeats === 0) break;
  }

  const actual = new Map();
  for (const slot of best.slots) {
    const key = JSON.stringify([cohortKey(slot), slot.subjectCode]);
    if (!actual.has(key)) actual.set(key, []);
    if (!slot.isFree && !slot.isActivity) actual.get(key).push(slot);
  }
  const issues = demands.flatMap(({ cohort, item, candidates, name, room }) => {
    const lessons = actual.get(JSON.stringify([cohortKey(cohort), item.code])) || [];
    const unscheduled = Math.max(0, item.count - lessons.length);
    const unassigned = lessons.filter((slot) => !slot.teacherId).length;
    const missingDouble = item.double && !lessons.some((slot) => slot.isDouble);
    if (!unscheduled && !unassigned && !missingDouble) return [];
    const roomOverCapacity = room && roomPressure.get(room) > capacity ? item.room : "";
    return [{ ...cohort, subject: name, unscheduled, unassigned, missingDouble, roomOverCapacity, hasTeacher: candidates.length > 0 }];
  });
  const keptFreePeriods = lockedSlots.filter((slot) => slot.isFree).length;
  return {
    slots: best.slots, issues, target, plan: rules, cohortPlans: overrides, staffed: best.staffed, scheduled: best.filled,
    doubles: best.doubles, keptFreePeriods, keptActivities: lockedSlots.length - keptFreePeriods,
  };
}
