export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const MAX_TEACHER_WEEKLY_LESSONS = 28;
export const MAX_TEACHER_DAILY_LESSONS = 6;

export const FREE_PERIOD = { subjectCode: "FREE", subjectName: "Free period", isFree: true };

export const DOUBLE_ELIGIBLE_SUBJECTS = new Set([
  "SCI", "INT_SCI", "INTEGRATED_SCIENCE", "SCIENCE",
  "AGR", "AGRICULTURE",
  "PTS", "PRE_TECH", "PRE_TECHNICAL", "PRE_TECHNICAL_STUDIES",
  "COMP", "COMPUTER", "COMPUTER_SCIENCE",
  "HOM", "HOME_SCIENCE",
  "CRA", "CREATIVE_ARTS", "PA", "PERFORMING_ARTS", "VA", "VISUAL_ARTS",
  "PE", "PHE", "PHYSICAL_EDUCATION",
]);

export function isDoubleEligibleSubject(code) {
  return DOUBLE_ELIGIBLE_SUBJECTS.has(String(code || "").toUpperCase().trim());
}

export function isDoubleAllowed(slot) {
  return !!slot && (slot.isDouble === true || isDoubleEligibleSubject(slot.subjectCode));
}

export function isBreakPeriod(period) {
  return !!period && (period.isBreak === true || period.isBreak === "true" ||
    /break|lunch|recess|tea\b|interval|games\b|clubs\b|assembly|devotion/i.test(period.name || ""));
}

export function timeToMinutes(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function areAdjacentTeachingPeriods(first, next) {
  return !!(first?.endTime && next?.startTime && !isBreakPeriod(first) && !isBreakPeriod(next) &&
    timeToMinutes(first.endTime) === timeToMinutes(next.startTime));
}

export function namedTimetableRoom(room) {
  const name = String(room || "").trim();
  return /^(classroom(?:\s*\/\s*hall)?|homeroom|assigned club rooms)$/i.test(name) ? "" : name;
}

export function canMergeLessons(first, next, period, nextPeriod, { useNamedRooms = true } = {}) {
  return !!(first && next && !first.isFree && !next.isFree && first.subjectCode && isDoubleAllowed(first) && isDoubleAllowed(next) &&
    areAdjacentTeachingPeriods(period, nextPeriod) &&
    first.subjectCode === next.subjectCode &&
    (first.subjectName || first.subjectCode) === (next.subjectName || next.subjectCode) &&
    (first.teacherId || "") === (next.teacherId || "") &&
    (first.teacherId || (first.teacherName || "") === (next.teacherName || "")) &&
    (!useNamedRooms || namedTimetableRoom(first.room).toLowerCase() === namedTimetableRoom(next.room).toLowerCase()) &&
    first.grade === next.grade && (first.stream || "") === (next.stream || "") &&
    !!first.isActivity === !!next.isActivity);
}

export const SHARED_VENUES = [
  "field", "sports field", "pitch", "sports field / pitch", "playground", "assembly ground",
  "school grounds", "school hall", "hall", "dining hall",
];

export function roomBookingKey(room) {
  const name = namedTimetableRoom(room).toLowerCase();
  return SHARED_VENUES.includes(name) ? "" : name;
}
