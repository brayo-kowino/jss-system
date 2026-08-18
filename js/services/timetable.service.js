// Timetable.
// periods/{autoId}: { schoolId, name, startTime, endTime, isBreak, createdAt }
// timetable_slots/{schoolId__grade_stream_day_periodId}: { schoolId, grade,
//   stream, day, periodId, subjectCode, subjectName, teacherId, teacherName,
//   room, updatedBy, updatedAt }
//
// One deterministic doc per class per day per period - re-assigning the same
// cell is a plain upsert. Teacher/room double-booking is checked at write
// time against every other class's slot in that same day+period.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { slugify } from "./academic.service.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";
import { cached, invalidate, invalidatePrefix } from "./query-cache.js";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const DEFAULT_PERIODS = [
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
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
    
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
    const slotsSnap = await getDocs(query(collection(db, "timetable_slots"), where("schoolId", "==", schoolId)));
    const usedPeriodIds = new Set(slotsSnap.docs.map((d) => d.data().periodId));
    
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

export async function addPeriod(userId, { name, startTime, endTime, isBreak }) {
  if (!name?.trim()) throw new Error("Period name is required.");
  if (!startTime || !endTime) throw new Error("Start and end time are required.");
  const ref_ = await addDoc(collection(db, "periods"), {
    schoolId: getCurrentSchoolId(),
    name: name.trim(),
    startTime,
    endTime,
    isBreak: !!isBreak,
    createdAt: serverTimestamp(),
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "create_period", "periods", ref_.id);
  return ref_.id;
}

export async function updatePeriod(userId, id, { name, startTime, endTime, isBreak }) {
  await updateDoc(doc(db, "periods", id), {
    name: name.trim(),
    startTime,
    endTime,
    isBreak: !!isBreak,
    updatedAt: serverTimestamp(),
  });
  invalidate(periodsCacheKey());
  await logAction(userId, "update_period", "periods", id);
}

export async function deletePeriod(userId, id) {
  const snap = await getDocs(
    query(collection(db, "timetable_slots"), where("schoolId", "==", getCurrentSchoolId()), where("periodId", "==", id))
  );
  if (snap.size > 0) {
    throw new Error(`Cannot delete: ${snap.size} timetable slot(s) still use this period. Clear them first.`);
  }
  await deleteDoc(doc(db, "periods", id));
  invalidate(periodsCacheKey());
  await logAction(userId, "delete_period", "periods", id);
}

// ------------------------------------------------------------------- Slots --

function slotId(schoolId, grade, stream, day, periodId) {
  return scopedId(schoolId, slugify(grade), slugify(stream), slugify(day), periodId);
}

function classTimetableCacheKey(grade, stream) {
  return `timetable_class:${getCurrentSchoolId()}:${grade}:${stream}`;
}

function teacherTimetableCacheKey(teacherId) {
  return `timetable_teacher:${getCurrentSchoolId()}:${teacherId}`;
}

/** Returns a lookup map keyed by "day_periodId" for easy grid rendering. */
export async function getClassTimetable(grade, stream, forceRefresh = false) {
  const key = classTimetableCacheKey(grade, stream);
  if (forceRefresh) invalidate(key);
  return cached(key, 60 * 60_000, async () => {
    const snap = await getDocs(
      query(
        collection(db, "timetable_slots"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("grade", "==", grade),
        where("stream", "==", stream)
      )
    );
    const byKey = {};
    for (const d of snap.docs) {
      const data = d.data();
      byKey[`${data.day}_${data.periodId}`] = { id: d.id, ...data };
    }
    return byKey;
  });
}

export async function getTeacherTimetable(teacherId, forceRefresh = false) {
  const key = teacherTimetableCacheKey(teacherId);
  if (forceRefresh) invalidate(key);
  return cached(key, 60 * 60_000, async () => {
    const snap = await getDocs(
      query(collection(db, "timetable_slots"), where("schoolId", "==", getCurrentSchoolId()), where("teacherId", "==", teacherId))
    );
    const byKey = {};
    for (const d of snap.docs) {
      const data = d.data();
      byKey[`${data.day}_${data.periodId}`] = { id: d.id, ...data };
    }
    return byKey;
  });
}

/**
 * Assigns (or reassigns) a class/day/period slot, blocking the save if the
 * chosen teacher - or, if given, the room - is already booked elsewhere at
 * that exact day+period.
 */
export async function assignSlot(userId, { grade, stream, day, periodId, subjectCode, subjectName, teacherId, teacherName, room }) {
  const schoolId = getCurrentSchoolId();
  const id = slotId(schoolId, grade, stream, day, periodId);

  const sameSlotElsewhere = await getDocs(
    query(
      collection(db, "timetable_slots"),
      where("schoolId", "==", schoolId),
      where("day", "==", day),
      where("periodId", "==", periodId)
    )
  );
  for (const d of sameSlotElsewhere.docs) {
    if (d.id === id) continue;
    const other = d.data();
    if (teacherId && other.teacherId === teacherId) {
      throw new Error(`${teacherName || "This teacher"} is already teaching ${other.grade} ${other.stream} at that time.`);
    }
    if (room && other.room && other.room.trim().toLowerCase() === room.trim().toLowerCase()) {
      throw new Error(`Room "${room}" is already booked by ${other.grade} ${other.stream} at that time.`);
    }
  }

  await setDoc(doc(db, "timetable_slots", id), {
    schoolId,
    grade,
    stream,
    day,
    periodId,
    subjectCode,
    subjectName: subjectName || "",
    teacherId: teacherId || "",
    teacherName: teacherName || "",
    room: room?.trim() || "",
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  });
  invalidate(classTimetableCacheKey(grade, stream));
  // A reassignment can also change (or clear) a *different* teacher's prior
  // booking of this exact slot, which we don't have loaded here without an
  // extra read - invalidate every cached teacher timetable for the school
  // rather than risk showing a stale grid to whichever teacher lost/gained
  // a slot. Cheap: this only runs on an explicit admin save, not on render.
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  await logAction(userId, "assign_timetable_slot", "timetable_slots", id);
  return id;
}

export async function clearSlot(userId, grade, stream, day, periodId) {
  const schoolId = getCurrentSchoolId();
  const id = slotId(schoolId, grade, stream, day, periodId);
  await deleteDoc(doc(db, "timetable_slots", id));
  invalidate(classTimetableCacheKey(grade, stream));
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  await logAction(userId, "clear_timetable_slot", "timetable_slots", id);
}