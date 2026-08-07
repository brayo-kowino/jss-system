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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { slugify } from "./academic.service.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";

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

export async function listPeriods() {
  const snap = await getDocs(query(collection(db, "periods"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
}

export async function seedDefaultPeriodsIfEmpty() {
  const existing = await listPeriods();
  if (existing.length) return;
  const schoolId = getCurrentSchoolId();
  for (const p of DEFAULT_PERIODS) {
    await addDoc(collection(db, "periods"), { ...p, schoolId, createdAt: serverTimestamp() });
  }
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
  await logAction(userId, "delete_period", "periods", id);
}

// ------------------------------------------------------------------- Slots --

function slotId(schoolId, grade, stream, day, periodId) {
  return scopedId(schoolId, slugify(grade), slugify(stream), slugify(day), periodId);
}

/** Returns a lookup map keyed by "day_periodId" for easy grid rendering. */
export async function getClassTimetable(grade, stream) {
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
}

export async function getTeacherTimetable(teacherId) {
  const snap = await getDocs(
    query(collection(db, "timetable_slots"), where("schoolId", "==", getCurrentSchoolId()), where("teacherId", "==", teacherId))
  );
  const byKey = {};
  for (const d of snap.docs) {
    const data = d.data();
    byKey[`${data.day}_${data.periodId}`] = { id: d.id, ...data };
  }
  return byKey;
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
  await logAction(userId, "assign_timetable_slot", "timetable_slots", id);
  return id;
}

export async function clearSlot(userId, grade, stream, day, periodId) {
  const id = slotId(getCurrentSchoolId(), grade, stream, day, periodId);
  await deleteDoc(doc(db, "timetable_slots", id));
  await logAction(userId, "clear_timetable_slot", "timetable_slots", id);
}