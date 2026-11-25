// Timetable.
// periods/{autoId}: { schoolId, name, startTime, endTime, isBreak, createdAt }
// timetable_slots stores a school state document and one weekly document per
// class or stream in each generation. Older generations can contain individual
// period documents. Both formats are exposed as the same lesson records.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  getDocFromServer,
  runTransaction,
  getDocs,
  getDocsFromServer,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { slugify } from "./academic.service.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { escapeHtml, scopedId } from "../utils.js";
import { renderTimetableChart } from "../components/timetable-grid.js";
import { sharedTimetableDisplay } from "./timetable-layout.js";
import timetableGridCss from "../../css/timetable-grid.css?raw";
import { cached, invalidate } from "./query-cache.js";
import { buildDeepLink } from "./deep-link.service.js";

import { createTimetableDraft } from "./timetable-engine.js";
import {
  DAYS, areAdjacentTeachingPeriods, isBreakPeriod, namedTimetableRoom, roomBookingKey, timeToMinutes,
} from "./timetable-rules.js";

export {
  DAYS, DOUBLE_ELIGIBLE_SUBJECTS, MAX_TEACHER_DAILY_LESSONS, MAX_TEACHER_WEEKLY_LESSONS,
  SHARED_VENUES, isBreakPeriod, isDoubleAllowed, isDoubleEligibleSubject, timeToMinutes,
} from "./timetable-rules.js";
export { createTimetableDraft, defaultTimetablePlan } from "./timetable-engine.js";

export const DEFAULT_PERIODS = [
  { name: "Period 1", startTime: "08:00", endTime: "08:40", isBreak: false },
  { name: "Period 2", startTime: "08:40", endTime: "09:20", isBreak: false },
  { name: "Period 3", startTime: "09:20", endTime: "10:00", isBreak: false },
  { name: "Short Break", startTime: "10:00", endTime: "10:20", isBreak: true },
  { name: "Period 4", startTime: "10:20", endTime: "11:00", isBreak: false },
  { name: "Period 5", startTime: "11:00", endTime: "11:40", isBreak: false },
  { name: "Period 6", startTime: "11:40", endTime: "12:20", isBreak: false },
  { name: "Lunch", startTime: "12:20", endTime: "13:10", isBreak: true },
  { name: "Period 7", startTime: "13:10", endTime: "13:50", isBreak: false },
  { name: "Period 8", startTime: "13:50", endTime: "14:30", isBreak: false },
  { name: "Games & Clubs", startTime: "14:30", endTime: "15:30", isBreak: true },
];

// ------------------------------------------------------------------ Periods --

function periodsCacheKey() {
  return `periods:${getCurrentSchoolId()}`;
}

export async function listPeriods(forceRefresh = false) {
  // Read on every Timetable render but changes only from this page's own
  // period editor - same cache-with-forceRefresh pattern as
  // listClasses()/listSubjects() in academic.service.js.
  if (forceRefresh) invalidate(periodsCacheKey());
  return cached(periodsCacheKey(), 60 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "periods"), where("schoolId", "==", getCurrentSchoolId())));
    const all = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        isBreak: isBreakPeriod(data),
      };
    }).sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
    
    // Deduplicate periods that have identical name, start and end times
    const seen = new Set();
    const unique = [];
    for (const p of all) {
      const key = `${p.name || ""}_${p.startTime || ""}_${p.endTime || ""}_${!!p.isBreak}`.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(p);
      }
    }
    return unique;
  });
}

export async function seedDefaultPeriodsIfEmpty() {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return;
  const snap = await getDocs(query(collection(db, "periods"), where("schoolId", "==", schoolId)));
  const existingDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // If duplicate periods exist from a previous concurrent seed, clean up unassigned duplicates
  if (existingDocs.length > DEFAULT_PERIODS.length) {
    const usedPeriodIds = new Set((await readSchedule(schoolId)).slots.map((slot) => slot.periodId));
    
    const seen = new Map();
    const duplicateIdsToDelete = [];
    for (const p of existingDocs) {
      const key = `${p.name || ""}_${p.startTime || ""}_${p.endTime || ""}_${!!p.isBreak}`.toLowerCase().trim();
      if (seen.has(key)) {
        // If this duplicate is not used by any slot, queue for deletion
        if (!usedPeriodIds.has(p.id)) {
          duplicateIdsToDelete.push(p.id);
        } else if (!usedPeriodIds.has(seen.get(key).id)) {
          // If the previous one wasn't used, delete the previous one instead
          duplicateIdsToDelete.push(seen.get(key).id);
          seen.set(key, p);
        }
      } else {
        seen.set(key, p);
      }
    }

    if (duplicateIdsToDelete.length > 0) {
      const batch = writeBatch(db);
      for (const id of duplicateIdsToDelete) {
        batch.delete(doc(db, "periods", id));
      }
      await batch.commit();
      invalidate(periodsCacheKey());
    }
    return;
  }

  if (existingDocs.length) return;

  const batch = writeBatch(db);
  for (const p of DEFAULT_PERIODS) {
    const periodId = scopedId(schoolId, slugify(p.name), slugify(p.startTime));
    batch.set(doc(db, "periods", periodId), { ...p, schoolId, createdAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  invalidate(periodsCacheKey());
}

export function minutesToTime(totalMins) {
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesToTime(timeStr, mins) {
  return minutesToTime(timeToMinutes(timeStr) + (mins || 0));
}

export function calculateDurationMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end >= start ? end - start : (1440 - start + end);
}

export async function addPeriod(userId, { name, startTime, endTime, isBreak }) {
  if (!name?.trim()) throw new Error("Period name is required.");
  if (!startTime || !endTime) throw new Error("Start and end time are required.");
  const resolvedBreak = isBreakPeriod({ name, isBreak });
  const ref_ = await addDoc(collection(db, "periods"), {
    schoolId: getCurrentSchoolId(),
    name: name.trim(),
    startTime,
    endTime,
    isBreak: resolvedBreak,
    createdAt: serverTimestamp(),
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "create_period", "periods", ref_.id);
  return ref_.id;
}

export async function updatePeriod(userId, id, { name, startTime, endTime, isBreak }) {
  const resolvedBreak = isBreakPeriod({ name, isBreak });
  if (resolvedBreak) {
    const { slots } = await readSchedule(getCurrentSchoolId(), { fromServer: true });
    if (slots.some((slot) => slot.periodId === id)) {
      throw new Error("Move or clear the lessons in this period before converting it to a break.");
    }
  }
  await updateDoc(doc(db, "periods", id), {
    name: name.trim(),
    startTime,
    endTime,
    isBreak: resolvedBreak,
    updatedAt: serverTimestamp(),
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "update_period", "periods", id);
}

export async function batchUpdatePeriods(userId, updatedPeriods) {
  if (!updatedPeriods || !updatedPeriods.length) return;
  const schoolId = getCurrentSchoolId();
  const batch = writeBatch(db);
  for (const p of updatedPeriods) {
    if (!p.id) continue;
    const ref_ = doc(db, "periods", p.id);
    const resolvedBreak = isBreakPeriod(p);
    batch.update(ref_, {
      name: (p.name || "").trim(),
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: resolvedBreak,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  invalidate(periodsCacheKey());
  await logAction(userId, "batch_update_periods", "periods", schoolId);
}

export async function resetToStandardPeriods(userId) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return;
  const [snap, schedule] = await Promise.all([
    getDocsFromServer(query(collection(db, "periods"), where("schoolId", "==", schoolId))),
    readSchedule(schoolId, { fromServer: true }),
  ]);
  const standard = new Map(DEFAULT_PERIODS.map((period) => [
    scopedId(schoolId, slugify(period.name), slugify(period.startTime)), period,
  ]));
  if (schedule.slots.some(({ periodId }) => !standard.has(periodId) || isBreakPeriod(standard.get(periodId)))) {
    throw new Error("The saved timetable uses custom periods. Move or clear those lessons before resetting the bell schedule.");
  }
  await commitTimetableChange(schoolId, schedule.revision, (transaction) => {
    for (const item of snap.docs) {
      if (!standard.has(item.id)) transaction.delete(item.ref);
    }
    for (const [periodId, period] of standard) {
      transaction.set(doc(db, "periods", periodId), { ...period, schoolId, createdAt: serverTimestamp() }, { merge: true });
    }
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "reset_periods", "periods", schoolId);
}

export async function deletePeriod(userId, id) {
  const schoolId = getCurrentSchoolId();
  const { revision, slots } = await readSchedule(schoolId, { fromServer: true });
  const used = slots.filter((slot) => slot.periodId === id).length;
  if (used > 0) {
    throw new Error(`Cannot delete: ${used} timetable slot(s) still use this period. Clear them first.`);
  }
  await commitTimetableChange(schoolId, revision, (transaction) => {
    transaction.delete(doc(db, "periods", id));
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "delete_period", "periods", id);
}

// ------------------------------------------------------------------- Slots --

function masterTimetableCacheKey() {
  return `timetable_master:${getCurrentSchoolId()}`;
}

/** Returns all currently published slots for the school. */
export async function getMasterTimetable(forceRefresh = false) {
  const schoolId = getCurrentSchoolId();
  const key = masterTimetableCacheKey();
  if (forceRefresh) invalidate(key);
  return cached(key, 60 * 60_000, async () => (await readSchedule(schoolId)).slots);
}

/**
 * Scans a list of slots and identifies any teacher or room double-bookings.
 * Returns an array of detected conflict descriptors.
 */
export function detectTimetableConflicts(slots, { useNamedRooms = true } = {}) {
  const conflicts = [];
  const byDayPeriodTeacher = new Map();
  const byDayPeriodRoom = new Map();

  for (const slot of slots) {
    if (!slot.day || !slot.periodId) continue;
    const classLabel = `${slot.grade || ""}${slot.stream ? " " + slot.stream : ""}`.trim();

    // Check teacher collision (only if a teacher is assigned)
    if (slot.teacherId) {
      const key = `${slot.day}_${slot.periodId}_${slot.teacherId}`;
      if (!byDayPeriodTeacher.has(key)) {
        byDayPeriodTeacher.set(key, []);
      }
      byDayPeriodTeacher.get(key).push({ ...slot, classLabel });
    }

    // Check room collision (only if room is specified and not a shared outdoor/assembly venue)
    const room = useNamedRooms ? roomBookingKey(slot.room) : "";
    if (room) {
      const key = `${slot.day}_${slot.periodId}_${room}`;
      if (!byDayPeriodRoom.has(key)) {
        byDayPeriodRoom.set(key, []);
      }
      byDayPeriodRoom.get(key).push({ ...slot, classLabel });
    }
  }

  for (const [key, group] of byDayPeriodTeacher.entries()) {
    if (group.length > 1) {
      const sample = group[0];
      const classes = group.map((s) => s.classLabel).join(" & ");
      conflicts.push({
        type: "teacher",
        key,
        day: sample.day,
        periodId: sample.periodId,
        teacherId: sample.teacherId,
        teacherName: sample.teacherName || "Teacher",
        classes: group.map((s) => s.classLabel),
        slotIds: group.map((s) => s.id),
        message: `${sample.teacherName || "Teacher"} is double-booked on ${sample.day} in ${classes}.`,
      });
    }
  }

  for (const [key, group] of byDayPeriodRoom.entries()) {
    if (group.length > 1) {
      const sample = group[0];
      const classes = group.map((s) => s.classLabel).join(" & ");
      conflicts.push({
        type: "room",
        key,
        day: sample.day,
        periodId: sample.periodId,
        room: sample.room,
        classes: group.map((s) => s.classLabel),
        slotIds: group.map((s) => s.id),
        message: `Room "${sample.room}" is double-booked on ${sample.day} in ${classes}.`,
      });
    }
  }

  return conflicts;
}

/**
 * Pure scheduler that distributes subjects and teachers across instructional periods
 * guaranteeing ZERO teacher collisions and balanced daily distribution.
 */
export function buildCollisionFreeSchedule(options) {
  return createTimetableDraft(options).slots;
}

function timetableRef(schoolId) {
  return doc(db, "timetable_slots", scopedId(schoolId, "timetable_state"));
}

function roomModeCacheKey(schoolId) {
  return `timetable_room_mode:${schoolId}`;
}

export async function getTimetableRoomMode() {
  const schoolId = getCurrentSchoolId();
  return cached(roomModeCacheKey(schoolId), 60_000, async () =>
    (await getDoc(timetableRef(schoolId))).data()?.useNamedRooms === true);
}

export async function setTimetableRoomMode(userId, enabled) {
  const schoolId = getCurrentSchoolId();
  const state = (await getDocFromServer(timetableRef(schoolId))).data();
  await commitTimetableChange(schoolId, state?.revision, () => ({ useNamedRooms: enabled === true }));
  invalidate(roomModeCacheKey(schoolId));
  await logAction(userId, "update_timetable_room_mode", "timetable_slots", schoolId);
}

function classWeekId(schoolId, generation, { grade, stream }) {
  return scopedId(schoolId, "week", generation, encodeURIComponent(JSON.stringify([grade, stream || ""])));
}

function lessonKey({ day, periodId }) {
  return JSON.stringify([day, periodId]);
}

function sameClass(slot, { grade, stream }) {
  return slot.grade === grade && (slot.stream || "") === (stream || "");
}

function lessonId(weekId, slot) {
  return scopedId(weekId, encodeURIComponent(lessonKey(slot)));
}

function isClassWeek(data) {
  return data.kind === "class_week" && Array.isArray(data.lessons);
}

function classWeekData({ grade, stream }, slots, { schoolId, generation, userId }) {
  const lessons = slots.map(({ id, grade: slotGrade, stream: slotStream, schoolId: oldSchoolId,
    generation: oldGeneration, updatedBy, updatedAt, ...lesson }) => lesson);
  return {
    kind: "class_week", schoolId, generation, grade, stream: stream || "", lessons,
    updatedBy: userId, updatedAt: serverTimestamp(),
  };
}

function readLessons(record) {
  const data = record.data();
  if (!isClassWeek(data)) return [{ ...data, id: record.id }];
  const { schoolId, generation, grade, stream, lessons, updatedBy, updatedAt } = data;
  return lessons.map((lesson) => ({
    ...lesson, id: lessonId(record.id, lesson), schoolId, generation, grade, stream, updatedBy, updatedAt,
  }));
}

async function generationDocs(schoolId, generation, { fromServer = false } = {}) {
  const filters = [where("schoolId", "==", schoolId)];
  if (generation) filters.push(where("generation", "==", generation));
  const readSlots = fromServer ? getDocsFromServer : getDocs;
  const snap = await readSlots(query(collection(db, "timetable_slots"), ...filters));
  return snap.docs.filter((d) => {
    const slot = d.data();
    return (isClassWeek(slot) || slot.periodId) && (slot.generation || "") === generation;
  });
}

async function readSchedule(schoolId, { fromServer = false } = {}) {
  const ref = timetableRef(schoolId);
  const readState = fromServer ? getDocFromServer : getDoc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = (await readState(ref)).data() || {};
    const docs = await generationDocs(schoolId, state.generation || "", { fromServer });
    const latest = (await readState(ref)).data();
    if (state.revision === latest?.revision) {
      return { ...state, schoolId, docs, slots: docs.flatMap(readLessons) };
    }
  }
  throw new Error("The timetable is being edited. Try again in a moment.");
}

export function loadTimetableDraftInputs() {
  return readSchedule(getCurrentSchoolId(), { fromServer: true });
}

function invalidateTimetable(schoolId) {
  invalidate(`timetable_master:${schoolId}`);
}

async function commitTimetableChange(schoolId, expectedRevision, update) {
  const stateRef = timetableRef(schoolId);
  await runTransaction(db, async (transaction) => {
    const state = (await transaction.get(stateRef)).data() || {};
    if ((state.revision || "") !== (expectedRevision || "")) {
      throw new Error("The saved timetable changed while you were working. Refresh and try again.");
    }
    const updates = update(transaction) || {};
    transaction.set(stateRef, { ...updates, schoolId, revision: generateSecureShareToken() }, { merge: true });
  });
  invalidateTimetable(schoolId);
}

async function removeGeneration(schoolId, generation, knownDocs) {
  try {
    const docs = knownDocs || await generationDocs(schoolId, generation || "");
    for (let start = 0; start < docs.length; start += 450) {
      const batch = writeBatch(db);
      for (const item of docs.slice(start, start + 450)) batch.delete(item.ref);
      await batch.commit();
    }
  } catch (error) {
    console.warn("Could not remove superseded timetable slots:", error);
  }
}

export async function publishTimetableDraft(userId, draft, base) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId || base.schoolId !== schoolId) throw new Error("Open the timetable for your current school.");
  if (!draft.slots.length) throw new Error("The draft has no lessons to save.");
  const conflicts = detectTimetableConflicts(draft.slots, { useNamedRooms: base.useNamedRooms === true });
  if (conflicts.length) throw new Error(conflicts[0].message);

  const generation = generateSecureShareToken();
  const weeksById = new Map();
  for (const slot of draft.slots) {
    const id = classWeekId(schoolId, generation, slot);
    if (!weeksById.has(id)) weeksById.set(id, new Map());
    const lessons = weeksById.get(id);
    const key = lessonKey(slot);
    if (lessons.has(key)) throw new Error("The draft contains duplicate class periods.");
    lessons.set(key, slot);
  }
  const weeks = [...weeksById].map(([id, lessons]) => ({ id, slots: [...lessons.values()] }));
  // Stage the whole draft before switching the school's active timetable.
  // Manual edits and simultaneous publishes change the revision and invalidate this switch.
  try {
    for (let start = 0; start < weeks.length; start += 450) {
      const batch = writeBatch(db);
      for (const { id, slots } of weeks.slice(start, start + 450)) {
        batch.set(doc(db, "timetable_slots", id), classWeekData(slots[0], slots, { schoolId, generation, userId }));
      }
      await batch.commit();
    }
    await commitTimetableChange(schoolId, base.revision, () => ({
      generation, plan: draft.plan, cohortPlans: draft.cohortPlans || [],
    }));
  } catch (error) {
    // A transport error can follow a successful commit. Check the pointer
    // before removing staged data, and leave it intact if the server is unreachable.
    const state = await getDocFromServer(timetableRef(schoolId)).catch(() => null);
    if (!state) throw error;
    if (state.data()?.generation !== generation) {
      await removeGeneration(schoolId, generation);
      throw error;
    }
    invalidateTimetable(schoolId);
  }
  await removeGeneration(schoolId, base.generation, base.docs);
  await logAction(userId, "generate_master_timetable", "timetable_slots", schoolId);
  return {
    totalSlots: draft.slots.length, conflictsCount: 0,
    unassignedCount: draft.issues.reduce((sum, issue) => sum + issue.unassigned, 0),
  };
}

export async function generateCollisionFreeTimetable(userId, { classes, subjects, teachers, periods, days = DAYS }) {
  const base = await loadTimetableDraftInputs();
  const cohorts = classes.flatMap(({ grade, streams }) =>
    (streams?.length ? streams : [""]).map((stream) => ({ grade, stream })));
  const draft = createTimetableDraft({
    cohorts, instructionalPeriods: periods, periods, days, subjects, teachers, useNamedRooms: base.useNamedRooms === true,
  });
  return publishTimetableDraft(userId, draft, base);
}

export async function clearAllTimetableSlots(userId) {
  const schoolId = getCurrentSchoolId();
  const state = (await getDocFromServer(timetableRef(schoolId))).data() || {};
  await commitTimetableChange(schoolId, state.revision, () => ({ generation: generateSecureShareToken() }));
  await removeGeneration(schoolId, state.generation);
  await logAction(userId, "clear_all_timetable_slots", "timetable_slots", schoolId);
}

export async function clearClassTimetableSlots(userId, grade, stream) {
  const schoolId = getCurrentSchoolId();
  const schedule = await readSchedule(schoolId, { fromServer: true });
  const cohort = { grade, stream };
  if (!schedule.slots.some((slot) => sameClass(slot, cohort))) return;
  await saveClassWeek(userId, schedule, cohort, []);
  await logAction(userId, "clear_class_timetable_slots", "timetable_slots", `${grade}_${stream}`);
}

/** Returns a lookup map keyed by day and period. */
export async function getClassTimetable(grade, stream, forceRefresh = false) {
  const slots = await getMasterTimetable(forceRefresh);
  return Object.fromEntries(slots.filter((slot) => sameClass(slot, { grade, stream }))
    .map((slot) => [`${slot.day}_${slot.periodId}`, slot]));
}

export async function getTeacherTimetable(teacherId, forceRefresh = false) {
  const slots = await getMasterTimetable(forceRefresh);
  return Object.fromEntries(slots.filter((slot) => slot.teacherId === teacherId)
    .map((slot) => [`${slot.day}_${slot.periodId}`, slot]));
}

function findSlotConflict(slots, { grade, stream, day, periodId, teacherId, teacherName, room }, useNamedRooms) {
  const venue = useNamedRooms ? roomBookingKey(room) : "";
  for (const other of slots) {
    if (other.day !== day || other.periodId !== periodId ||
        (other.grade === grade && (other.stream || "") === (stream || ""))) continue;
    const otherClass = [other.grade, other.stream].filter(Boolean).join(" ");
    if (teacherId && other.teacherId === teacherId) {
      return { hasConflict: true, reason: `${teacherName || "This teacher"} is already teaching ${otherClass} at that time.` };
    }
    if (venue && venue === roomBookingKey(other.room)) {
      return { hasConflict: true, reason: `Room "${room}" is already booked by ${otherClass} at that time.` };
    }
  }
  return { hasConflict: false };
}

export async function checkSlotConflict(slot) {
  const { slots, useNamedRooms } = await readSchedule(getCurrentSchoolId());
  return findSlotConflict(slots, slot, useNamedRooms === true);
}

async function saveAssignedSlots(userId, assignments, removePeriodIds = []) {
  const schoolId = getCurrentSchoolId();
  const [schedule, periods] = await Promise.all([
    readSchedule(schoolId, { fromServer: true }), listPeriods(),
  ]);
  const { slots, useNamedRooms } = schedule;
  const assignmentPeriods = assignments.map(({ periodId }) => periods.find((period) => period.id === periodId));
  if (assignmentPeriods.some((period) => !period || isBreakPeriod(period))) {
    throw new Error("Select a teaching period.");
  }
  if (assignments.length === 2 && !areAdjacentTeachingPeriods(...assignmentPeriods)) {
    throw new Error("A double lesson needs two consecutive teaching periods.");
  }
  for (const slot of assignments) {
    const conflict = findSlotConflict(slots, slot, useNamedRooms === true);
    if (conflict.hasConflict) throw new Error(conflict.reason);
  }
  const first = assignments[0];
  const week = new Map(slots.filter((slot) => sameClass(slot, first)).map((slot) => [lessonKey(slot), slot]));
  for (const periodId of removePeriodIds) {
    if (!assignments.some((slot) => slot.periodId === periodId)) week.delete(lessonKey({ day: first.day, periodId }));
  }
  for (const slot of assignments) {
    const key = lessonKey(slot);
    const previous = week.get(key);
    const sameLesson = previous && previous.subjectCode === slot.subjectCode && !!previous.isActivity === slot.isActivity;
    const room = useNamedRooms === true ? slot.room : sameLesson ? previous.room || "" : "";
    week.set(key, { ...slot, room });
  }
  const weekId = await saveClassWeek(userId, schedule, first, [...week.values()]);
  const id = lessonId(weekId, first);
  await logAction(userId, "assign_timetable_slot", "timetable_slots", id);
  return id;
}

async function saveClassWeek(userId, schedule, cohort, slots) {
  const { schoolId, revision, docs } = schedule;
  const generation = schedule.generation || "";
  const id = classWeekId(schoolId, generation, cohort);
  await commitTimetableChange(schoolId, revision, (transaction) => {
    for (const record of docs) {
      if (sameClass(record.data(), cohort) && (!slots.length || record.id !== id)) transaction.delete(record.ref);
    }
    if (slots.length) {
      transaction.set(doc(db, "timetable_slots", id), classWeekData(cohort, slots, { schoolId, generation, userId }));
    }
  });
  return id;
}

function assignedSlot({
  grade, stream = "", day, periodId, subjectCode, subjectName = "", teacherId = "",
  teacherName = "", room = "", isActivity = false, activityType = "", isDouble = false,
}) {
  return { grade, stream, day, periodId, subjectCode, subjectName, teacherId, teacherName,
    room: namedTimetableRoom(room), isActivity, activityType, isDouble };
}

export function assignSlot(userId, assignment, { removePeriodIds = [] } = {}) {
  return saveAssignedSlots(userId, [assignedSlot(assignment)], removePeriodIds);
}

export function assignDoubleSlot(userId, { period1Id, period2Id, ...assignment }) {
  const pair = [period1Id, period2Id].map((periodId) => assignedSlot({ ...assignment, periodId, isDouble: true }));
  return saveAssignedSlots(userId, pair);
}

async function clearSlots(userId, grade, stream, day, periodIds) {
  const schoolId = getCurrentSchoolId();
  const schedule = await readSchedule(schoolId, { fromServer: true });
  const cohort = { grade, stream };
  const week = schedule.slots.filter((slot) => sameClass(slot, cohort));
  const shouldClear = (slot) => slot.day === day && periodIds.includes(slot.periodId);
  const first = week.find(shouldClear);
  if (!first) return;
  await saveClassWeek(userId, schedule, cohort, week.filter((slot) => !shouldClear(slot)));
  await logAction(userId, "clear_timetable_slot", "timetable_slots", first.id);
}

export function clearSlot(userId, grade, stream, day, periodId) {
  return clearSlots(userId, grade, stream, day, [periodId]);
}

export function clearDoubleSlot(userId, grade, stream, day, period1Id, period2Id) {
  return clearSlots(userId, grade, stream, day, [period1Id, period2Id]);
}

export function generateSecureShareToken() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "tt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Creates an unguessable, secure shared timetable document in Firestore.
 * Anyone with the resulting link can view this timetable without logging in.
 */
export async function createSharedTimetable(userId, {
  type = "master", // "master" | "teacher" | "class"
  targetId = "master",
  title = "",
  subTitle = "",
  slots = [],
  periods = [],
  cohorts = [],
  schoolSettings = {},
  teachers = [],
  pin = null,
}) {
  const schoolId = getCurrentSchoolId();
  const useNamedRooms = (await getDocFromServer(timetableRef(schoolId))).data()?.useNamedRooms === true;
  const shareId = `sec_${generateSecureShareToken()}`;

  const payload = {
    id: shareId,
    schoolId,
    type,
    targetId,
    title: title || (type === "master" ? "Institutional Master Timetable" : type === "teacher" ? "Teacher Schedule" : "Class Schedule"),
    subTitle: subTitle || "",
    useNamedRooms,
    schoolInfo: {
      name: schoolSettings.schoolName || schoolSettings.name || "School Timetable",
      motto: schoolSettings.motto || "Excellence in Competency-Based Education",
      logoUrl: schoolSettings.logoUrl || "",
      address: schoolSettings.address || "",
      phone: schoolSettings.phone || "",
      email: schoolSettings.email || "",
      academicYear: schoolSettings.currentAcademicYear || schoolSettings.academicYear || new Date().getFullYear(),
      term: schoolSettings.currentTerm || schoolSettings.term || "Term 1",
    },
    cohorts: cohorts.map(({ grade, stream = "" }) => ({ grade, stream })),
    periods: (periods || []).map((p) => ({
      id: p.id,
      name: p.name,
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: isBreakPeriod(p),
    })),
    slots: (slots || []).map((s) => ({
      grade: s.grade || "",
      stream: s.stream || "",
      day: s.day,
      periodId: s.periodId,
      subjectCode: s.subjectCode || "",
      subjectName: s.subjectName || "",
      teacherId: s.teacherId || "",
      teacherName: s.teacherName || "",
      room: useNamedRooms ? namedTimetableRoom(s.room) : "",
      isActivity: !!s.isActivity,
      isDouble: !!s.isDouble,
      category: s.category || "",
    })),
    teachers: (teachers || []).map((t) => ({
      id: t.id,
      fullName: t.fullName || t.name || "",
      tscNumber: t.tscNumber || "",
      homeroom: t.homeroom || "",
      phone: t.phone || "",
    })),
    pin: pin ? String(pin).trim() : null,
    createdAt: serverTimestamp(),
    createdBy: userId,
  };

  await setDoc(doc(db, "shared_timetables", shareId), payload);
  await logAction(userId, "create_shared_timetable", "shared_timetables", shareId);

  // Cache locally on authoring device
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(`eeskia_shared_tt_${shareId}`, JSON.stringify({ ...payload, createdAt: Date.now() }));
    } catch {}
  }

  const shareUrl = buildDeepLink("/shared-timetable", { id: shareId });

  return { shareId, shareUrl, payload };
}

/**
 * Retrieves a shared timetable document by its secure unguessable share ID.
 * Falls back to local storage cache if offline.
 */
export async function getSharedTimetable(shareId) {
  if (!shareId) throw new Error("Missing timetable share ID.");

  let cachedData = null;
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(`eeskia_shared_tt_${shareId}`);
      if (raw) cachedData = JSON.parse(raw);
    } catch {}
  }

  try {
    const snap = await getDoc(doc(db, "shared_timetables", shareId));
    if (snap.exists()) {
      const data = { id: snap.id, ...snap.data(), isOnline: true };
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(`eeskia_shared_tt_${shareId}`, JSON.stringify(data));
        } catch {}
      }
      return data;
    }
  } catch (err) {
    console.warn("Could not fetch online shared timetable, falling back to local cache:", err);
    if (cachedData) {
      return { ...cachedData, isOffline: true };
    }
    throw err;
  }

  if (cachedData) {
    return { ...cachedData, isOffline: true };
  }

  throw new Error("This timetable link was not found or has expired.");
}

/**
 * Builds a 100% self-contained standalone HTML document that can be saved
 * locally to any phone, tablet, or PC and opened offline forever in any browser.
 */
export function generateStandaloneHtml(data) {
  const { grid, letterhead } = sharedTimetableDisplay(data);
  // A remote crest may require a connection. The saved grid and letterhead are fully embedded.
  const content = renderTimetableChart(grid, letterhead).outerHTML;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(letterhead.title)}</title>
<style>
${timetableGridCss}
body { margin: clamp(12px, 3vw, 32px); font-family: system-ui, sans-serif; }
.print-actions { margin: 0 0 18px; text-align: right; }
.print-actions button { padding: 8px 14px; cursor: pointer; }
@page { size: ${grid.kind === "master" ? "A3" : "A4"} landscape; margin: 9mm; }
@media print {
  * { print-color-adjust: exact; }
  body { margin: 0; }
  .print-actions { display: none; }
  .tt-chart .tt-chart-scroll { overflow: visible; max-height: none; }
  .tt-chart-table :is(thead, .tt-chart-day, .tt-chart-class) { position: static; }
  .tt-chart-lesson, .tt-chart-table .tt-chart-break, .tt-chart-table .tt-chart-class { min-width: 0; }
  .tt-chart-day-col, .tt-chart-break-col, .tt-chart-class-col { width: auto; }
  .tt-chart-table { min-width: 0; font: 9pt/1.15 Georgia, serif; }
  .tt-chart-table .tt-chart-cell { min-height: 0; }
  .tt-chart-table tr { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="print-actions"><button type="button" onclick="window.print()">Print timetable</button></div>
${content}
</body>
</html>`;
}

export function downloadStandaloneTimetableHtml(data) {
  const html = generateStandaloneHtml(data);
  const schoolSlug = ((data.schoolInfo && data.schoolInfo.name) || "School").replace(/[^a-zA-Z0-9_-]/g, "_");
  const titleSlug = (data.title || "Timetable").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${schoolSlug}_${titleSlug}_Offline.html`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 150);
}
