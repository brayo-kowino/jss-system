// Daily Attendance.
// attendance/{schoolId__grade_stream_date}: { schoolId, grade, stream,
//   date ("YYYY-MM-DD"), academicYear, term,
//   records: { [studentId]: "present"|"absent"|"late"|"excused" },
//   markedBy, markedAt }
//
// One doc per class per day (not per student) - a class teacher marks the
// whole roster in a single save, which is also what keeps this cheap to
// read back for percentage roll-ups (one doc per school day, not one per
// student per day).
import {
  collection,
  doc,
  setDoc,
  getDoc,
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

export const STATUSES = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "excused", label: "Excused" },
];

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function attendanceId(schoolId, grade, stream, date) {
  return scopedId(schoolId, slugify(grade), slugify(stream), date);
}

export async function getAttendanceForClassDate(grade, stream, date) {
  const snap = await getDoc(doc(db, "attendance", attendanceId(getCurrentSchoolId(), grade, stream, date)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Upserts the whole day's roster for a class in one write. `records` is a
 * plain object of { studentId: status }.
 */
export async function saveAttendance(userId, { grade, stream, date, academicYear, term, records }) {
  const schoolId = getCurrentSchoolId();
  const id = attendanceId(schoolId, grade, stream, date);
  await setDoc(
    doc(db, "attendance", id),
    {
      schoolId,
      grade,
      stream,
      date,
      academicYear: academicYear || "",
      term: term || "",
      records,
      markedBy: userId,
      markedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await logAction(userId, "mark_attendance", "attendance", id);
  return id;
}

// Equality-only filters (no orderBy on a different field), same pattern used
// elsewhere in this codebase to avoid needing a composite index.
export async function listAttendanceForClassPeriod(grade, stream, academicYear, term) {
  const snap = await getDocs(
    query(
      collection(db, "attendance"),
      where("schoolId", "==", getCurrentSchoolId()),
      where("grade", "==", grade),
      where("stream", "==", stream),
      where("academicYear", "==", academicYear),
      where("term", "==", term)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Rolls up a set of attendance day-docs into per-student totals + percentage
 * (present + late count toward "present" for the percentage, per common CBC
 * school practice; absent and excused don't).
 */
export function summarizeForRoster(dayDocs, studentIds) {
  const perStudent = {};
  for (const id of studentIds) perStudent[id] = { present: 0, absent: 0, late: 0, excused: 0, marked: 0 };

  for (const day of dayDocs) {
    for (const [studentId, status] of Object.entries(day.records || {})) {
      if (!perStudent[studentId]) continue;
      if (perStudent[studentId][status] !== undefined) perStudent[studentId][status] += 1;
      perStudent[studentId].marked += 1;
    }
  }

  let classPresentPct = 0;
  let counted = 0;
  for (const id of studentIds) {
    const s = perStudent[id];
    const attended = s.present + s.late;
    s.percentage = s.marked ? Math.round((attended / s.marked) * 1000) / 10 : null;
    if (s.percentage !== null) {
      classPresentPct += s.percentage;
      counted += 1;
    }
  }

  return {
    daysMarked: dayDocs.length,
    perStudent,
    classAveragePercentage: counted ? Math.round((classPresentPct / counted) * 10) / 10 : null,
  };
}

/**
 * For the dashboard's "Attendance Today" stat: across every class marked
 * today, what fraction of recorded students were present or late.
 */
export async function getTodayAttendanceStat() {
  try {
    const snap = await getDocs(
      query(collection(db, "attendance"), where("schoolId", "==", getCurrentSchoolId()), where("date", "==", todayStr()))
    );
    let present = 0;
    let total = 0;
    for (const d of snap.docs) {
      const records = d.data().records || {};
      for (const status of Object.values(records)) {
        total += 1;
        if (status === "present" || status === "late") present += 1;
      }
    }
    if (!total) return "N/A";
    return `${Math.round((present / total) * 100)}%`;
  } catch {
    return "N/A";
  }
}