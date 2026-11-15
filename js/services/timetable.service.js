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
  getDoc,
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
import { buildDeepLink } from "./deep-link.service.js";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

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
  if (!code) return false;
  return DOUBLE_ELIGIBLE_SUBJECTS.has(String(code).toUpperCase().trim());
}

export function isDoubleAllowed(slot) {
  if (!slot) return false;
  if (slot.isDouble) return true;
  return isDoubleEligibleSubject(slot.subjectCode);
}

export const MAX_TEACHER_WEEKLY_LESSONS = 28; // Kenya TSC maximum weekly workload
export const MAX_TEACHER_DAILY_LESSONS = 6;    // Guarantees at least 2 free/prep periods per day

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

function masterTimetableCacheKey() {
  return `timetable_master:${getCurrentSchoolId()}`;
}

/** Returns all timetable slots for the school. */
export async function getMasterTimetable(forceRefresh = false) {
  const key = masterTimetableCacheKey();
  if (forceRefresh) invalidate(key);
  return cached(key, 60 * 60_000, async () => {
    const snap = await getDocs(
      query(collection(db, "timetable_slots"), where("schoolId", "==", getCurrentSchoolId()))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

export const SHARED_VENUES = [
  "field",
  "sports field",
  "pitch",
  "playground",
  "assembly ground",
  "school grounds",
  "school hall",
  "hall",
  "dining hall",
];

/**
 * Scans a list of slots and identifies any teacher or room double-bookings.
 * Returns an array of detected conflict descriptors.
 */
export function detectTimetableConflicts(slots) {
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
    const room = (slot.room || "").trim().toLowerCase();
    const isSharedVenue = room && SHARED_VENUES.some((v) => room.includes(v));
    if (room && !isSharedVenue) {
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
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generates one candidate weekly timetable with period-shuffling and collision prevention.
 */
function generateSingleScheduleAttempt({
  cohorts,
  instructionalPeriods,
  allPeriods = [],
  days,
  subjects,
  teachers,
}) {
  const totalPeriodsPerDay = instructionalPeriods.length;
  const totalSlotsPerWeek = days.length * totalPeriodsPerDay;

  // Standard CBC lessons per week distribution
  const defaultLessonDistribution = {
    MATH: 5,
    ENG: 5,
    KIS: 4,
    SCI: 4,
    AGR: 4,
    PTS: 4,
    SST: 3,
    CRE: 3,
    IRE: 3,
    HRE: 3,
    CRA: 5,
  };

  const generatedSlots = [];
  const cohortPools = new Map();

  // Track global lesson assignments across teachers during pool construction
  const teacherAssignedLessons = new Map();

  for (const cohort of cohorts) {
    const cohortKey = `${cohort.grade}_${cohort.stream}`;
    const pool = [];

    for (const subj of subjects) {
      const count = defaultLessonDistribution[subj.code] || 3;

      // 1. Exact match for this cohort (grade + stream + subject) respecting weekly cap
      let assignedTeacher = teachers.find((t) =>
        (t.teachingAssignments || []).some(
          (a) =>
            a.subjectCode === subj.code &&
            a.grade === cohort.grade &&
            a.stream &&
            a.stream === cohort.stream
        ) && (teacherAssignedLessons.get(t.id) || 0) + count <= MAX_TEACHER_WEEKLY_LESSONS
      );

      // 2. Grade-level match (same grade, no stream specified) respecting weekly cap
      if (!assignedTeacher) {
        assignedTeacher = teachers.find((t) =>
          (t.teachingAssignments || []).some(
            (a) =>
              a.subjectCode === subj.code &&
              a.grade === cohort.grade &&
              !a.stream
          ) && (teacherAssignedLessons.get(t.id) || 0) + count <= MAX_TEACHER_WEEKLY_LESSONS
        );
      }

      // 3. Fallback: Qualified teacher for this subject who is NOT already over weekly capacity
      if (!assignedTeacher) {
        const eligible = teachers.filter((t) => {
          const teachesSubj = (t.teachingAssignments || []).some((a) => a.subjectCode === subj.code);
          const currentLoad = teacherAssignedLessons.get(t.id) || 0;
          return teachesSubj && currentLoad + count <= MAX_TEACHER_WEEKLY_LESSONS;
        });
        // Prioritize teacher with lowest workload
        eligible.sort((a, b) => (teacherAssignedLessons.get(a.id) || 0) - (teacherAssignedLessons.get(b.id) || 0));
        assignedTeacher = eligible[0] || null;
      }

      // 4. Practical staffing fallback: If all qualified teachers exceed the ideal 28 cap (e.g. understaffed school),
      // assign the admin's explicitly designated teacher rather than dropping the teacher and leaving slots unassigned
      if (!assignedTeacher) {
        const designated = teachers.filter((t) =>
          (t.teachingAssignments || []).some(
            (a) =>
              a.subjectCode === subj.code &&
              a.grade === cohort.grade &&
              (!a.stream || a.stream === cohort.stream)
          )
        );
        if (designated.length > 0) {
          designated.sort((a, b) => (teacherAssignedLessons.get(a.id) || 0) - (teacherAssignedLessons.get(b.id) || 0));
          assignedTeacher = designated[0];
        } else {
          const anyQualified = teachers.filter((t) =>
            (t.teachingAssignments || []).some((a) => a.subjectCode === subj.code)
          );
          if (anyQualified.length > 0) {
            anyQualified.sort((a, b) => (teacherAssignedLessons.get(a.id) || 0) - (teacherAssignedLessons.get(b.id) || 0));
            assignedTeacher = anyQualified[0];
          }
        }
      }

      const tid = assignedTeacher?.id || "";
      const tname = assignedTeacher?.fullName || "";
      if (tid) {
        teacherAssignedLessons.set(tid, (teacherAssignedLessons.get(tid) || 0) + count);
      }

      for (let i = 0; i < count; i++) {
        pool.push({
          subjectCode: subj.code,
          subjectName: subj.name,
          teacherId: tid,
          teacherName: tname,
        });
      }
    }

    // Pad pool to match total weekly slots exactly without violating subject caps
    if (pool.length < totalSlotsPerWeek && subjects.length > 0) {
      const eligibleForPadding = subjects.filter((s) => {
        const curCount = pool.filter((c) => c.subjectCode === s.code).length;
        const maxWeekly = isDoubleEligibleSubject(s.code) ? 5 : Math.min(5, days.length);
        return curCount < maxWeekly;
      });

      let padIdx = 0;
      while (pool.length < totalSlotsPerWeek) {
        if (eligibleForPadding.length > 0 && padIdx < eligibleForPadding.length * 3) {
          const subj = eligibleForPadding[padIdx % eligibleForPadding.length];
          const curCount = pool.filter((c) => c.subjectCode === subj.code).length;
          const maxWeekly = isDoubleEligibleSubject(subj.code) ? 5 : Math.min(5, days.length);

          if (curCount < maxWeekly) {
            const assignedTeacher = teachers.find((t) =>
              (t.teachingAssignments || []).some(
                (a) =>
                  a.subjectCode === subj.code &&
                  a.grade === cohort.grade &&
                  (!a.stream || a.stream === cohort.stream)
              ) && (teacherAssignedLessons.get(t.id) || 0) + 1 <= MAX_TEACHER_WEEKLY_LESSONS
            ) || teachers.find((t) =>
              (t.teachingAssignments || []).some((a) => a.subjectCode === subj.code) &&
              (teacherAssignedLessons.get(t.id) || 0) + 1 <= MAX_TEACHER_WEEKLY_LESSONS
            );

            const tid = assignedTeacher?.id || "";
            const tname = assignedTeacher?.fullName || "";
            if (tid) {
              teacherAssignedLessons.set(tid, (teacherAssignedLessons.get(tid) || 0) + 1);
            }

            pool.push({
              subjectCode: subj.code,
              subjectName: subj.name,
              teacherId: tid,
              teacherName: tname,
            });
            padIdx++;
            continue;
          }
          padIdx++;
        } else {
          // All subjects have reached weekly limit; fill remainder with Library / Study session
          pool.push({
            subjectCode: "STUDY",
            subjectName: "Library / Private Study",
            teacherId: "",
            teacherName: "",
          });
        }
      }
    } else if (pool.length > totalSlotsPerWeek) {
      // Equitable trim: reduce from subjects with the highest count first
      while (pool.length > totalSlotsPerWeek) {
        const counts = new Map();
        for (const card of pool) {
          counts.set(card.subjectCode, (counts.get(card.subjectCode) || 0) + 1);
        }
        let maxCount = 0;
        let highestSubjCode = "";
        for (const [code, count] of counts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            highestSubjCode = code;
          }
        }
        const idxToRemove = pool.findLastIndex((c) => c.subjectCode === highestSubjCode);
        if (idxToRemove !== -1) {
          pool.splice(idxToRemove, 1);
        } else {
          pool.pop();
        }
      }
    }

    // Shuffle each cohort's card pool so subjects aren't processed in rigid initial array order
    cohortPools.set(cohortKey, shuffleArray(pool));
  }

  // Calculate teacher workloads to prioritize highly-loaded teachers
  const teacherFrequency = new Map();
  for (const [, pool] of cohortPools.entries()) {
    for (const card of pool) {
      if (card.teacherId) {
        teacherFrequency.set(card.teacherId, (teacherFrequency.get(card.teacherId) || 0) + 1);
      }
    }
  }

  // Tracking maps for diversity, teacher workload, and subject daily limits
  const cohortDaySubjectCount = new Map();       // `${cohortKey}_${day}_${subjectCode}` -> count
  const cohortPeriodSubjectCount = new Map();    // `${cohortKey}_${periodId}_${subjectCode}` -> count
  const teacherPeriodCohortCount = new Map();    // `${teacherId}_${periodId}_${cohortKey}` -> count
  const teacherDayCount = new Map();             // `${teacherId}_${day}` -> count (guarantees daily free periods)
  const cohortDoubleDone = new Set();            // `${cohortKey}_${subjectCode}` -> boolean (max 1 double/week)
  const cohortLastPlacedPeriod = new Map();      // `${cohortKey}_${day}` -> { chronoIdx, subjectCode, teacherId }

  // Iterate over days and instructional periods
  for (let dIdx = 0; dIdx < days.length; dIdx++) {
    const day = days[dIdx];
    const remainingDays = days.length - dIdx;

    // Period rotation shift: e.g. Day 0: 0, Day 1: 3, Day 2: 6...
    const periodShift = (dIdx * 3) % totalPeriodsPerDay;
    const rotatedPeriods = [
      ...instructionalPeriods.slice(periodShift),
      ...instructionalPeriods.slice(0, periodShift),
    ];

    for (const period of rotatedPeriods) {
      const busyTeachersInSlot = new Set();

      // Sort cohorts so cohorts with heavily-loaded teachers are placed first
      const sortedCohorts = [...cohorts].sort((a, b) => {
        const poolA = cohortPools.get(`${a.grade}_${a.stream}`) || [];
        const poolB = cohortPools.get(`${b.grade}_${b.stream}`) || [];
        const maxWorkloadA = poolA.reduce((max, c) => Math.max(max, teacherFrequency.get(c.teacherId) || 0), 0);
        const maxWorkloadB = poolB.reduce((max, c) => Math.max(max, teacherFrequency.get(c.teacherId) || 0), 0);
        return maxWorkloadB - maxWorkloadA;
      });

      for (const cohort of sortedCohorts) {
        const cohortKey = `${cohort.grade}_${cohort.stream}`;
        const pool = cohortPools.get(cohortKey) || [];

        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < pool.length; i++) {
          const card = pool[i];

          // 1. STRICT COLLISION PREVENTION: Skip if this teacher is already teaching in this slot
          if (card.teacherId && busyTeachersInSlot.has(card.teacherId)) {
            continue;
          }

          // 2. TEACHER DAILY WORKLOAD CAP: Guarantee teacher gets at least 2 free/prep periods every day!
          if (card.teacherId) {
            const tDaily = teacherDayCount.get(`${card.teacherId}_${day}`) || 0;
            if (tDaily >= MAX_TEACHER_DAILY_LESSONS) {
              continue;
            }
          }

          const dailyCount = cohortDaySubjectCount.get(`${cohortKey}_${day}_${card.subjectCode}`) || 0;
          const isDoubleEligible = isDoubleEligibleSubject(card.subjectCode);

          // 3. HARD CONSTRAINT: Theory subjects (MATH, ENG, KIS, SST, CRE) CANNOT exceed 1 lesson/day!
          if (!isDoubleEligible && dailyCount >= 1) {
            continue;
          }

          // 4. For double-eligible practical sciences (SCI, AGR, PTS, CRA):
          // Max 2 lessons per day, and ONLY if consecutive (forming a double lesson) and not already doubled this week!
          if (isDoubleEligible) {
            if (dailyCount >= 2) {
              continue;
            }
            if (dailyCount === 1) {
              const lastPlaced = cohortLastPlacedPeriod.get(`${cohortKey}_${day}`);
              const alreadyDoubled = cohortDoubleDone.has(`${cohortKey}_${card.subjectCode}`);
              let isConsecutive = false;
              if (lastPlaced && lastPlaced.subjectCode === card.subjectCode && card.teacherId === lastPlaced.teacherId) {
                if (allPeriods && allPeriods.length) {
                  const p1Idx = allPeriods.findIndex((p) => p.id === lastPlaced.periodId);
                  const p2Idx = allPeriods.findIndex((p) => p.id === period.id);
                  isConsecutive = p1Idx !== -1 && p2Idx !== -1 && Math.abs(p2Idx - p1Idx) === 1;
                } else {
                  const p1Idx = instructionalPeriods.findIndex((p) => p.id === lastPlaced.periodId);
                  const p2Idx = instructionalPeriods.findIndex((p) => p.id === period.id);
                  isConsecutive = p1Idx !== -1 && p2Idx !== -1 && Math.abs(p2Idx - p1Idx) === 1;
                }
              }
              if (!isConsecutive || alreadyDoubled) {
                continue;
              }
            }
          }

          const periodCount = cohortPeriodSubjectCount.get(`${cohortKey}_${period.id}_${card.subjectCode}`) || 0;
          const teacherPeriodCount = card.teacherId ? (teacherPeriodCohortCount.get(`${card.teacherId}_${period.id}_${cohortKey}`) || 0) : 0;

          let score = 0;

          // Remaining cards urgency for subjects with >= remainingDays (e.g. 5-lesson MATH/ENG):
          // Ensures MATH is scheduled on Monday, Tuesday, Wednesday, Thursday, Friday (1 per day)!
          const remainingCards = pool.filter((c) => c.subjectCode === card.subjectCode).length;
          if (dailyCount === 0 && remainingCards >= remainingDays) {
            score += 300;
          }

          // Heavy penalty if this subject was already placed at this exact period on another day
          if (periodCount > 0) {
            score -= periodCount * 80;
          } else {
            score += 35; // Reward placing subject at a fresh period
          }

          // Consecutive double lesson completion bonus for practical sciences
          if (isDoubleEligible && dailyCount === 1) {
            score += 180;
          }

          // Penalty if teacher already taught this cohort at this period on other days
          if (teacherPeriodCount > 0) {
            score -= teacherPeriodCount * 30;
          }

          // Cognitive load balance (morning focus vs afternoon practical/creative)
          const pNum = parseInt((period.name || "").replace(/\D/g, ""), 10) || 1;
          const isMorning = pNum <= 4;
          const isAfternoon = pNum >= 5;
          const morningPreferred = ["MATH", "SCI", "ENG", "KIS"];
          const afternoonPreferred = ["CRA", "AGR", "PTS", "PE", "PHE", "CRE", "IRE", "HRE", "SST"];

          if (isMorning && morningPreferred.includes(card.subjectCode)) {
            score += 20;
          } else if (isAfternoon && afternoonPreferred.includes(card.subjectCode)) {
            score += 20;
          }

          // Heavily loaded teacher prioritization
          if (card.teacherId) {
            score += (teacherFrequency.get(card.teacherId) || 0) * 8;
          }

          // Random jitter for rich, dynamic shuffling
          score += Math.random() * 15;

          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }

        // Fallback: any card that strictly respects daily subject limit and teacher collision
        if (bestIndex === -1) {
          let fallbackScore = -Infinity;
          for (let i = 0; i < pool.length; i++) {
            const card = pool[i];
            if (card.teacherId && busyTeachersInSlot.has(card.teacherId)) continue;
            if (card.teacherId && (teacherDayCount.get(`${card.teacherId}_${day}`) || 0) >= MAX_TEACHER_DAILY_LESSONS) continue;
            const dCount = cohortDaySubjectCount.get(`${cohortKey}_${day}_${card.subjectCode}`) || 0;
            const isDouble = isDoubleEligibleSubject(card.subjectCode);
            if (!isDouble && dCount >= 1) continue;
            if (dCount >= 2) continue;

            const pCount = cohortPeriodSubjectCount.get(`${cohortKey}_${period.id}_${card.subjectCode}`) || 0;
            const s = -(pCount * 25) + Math.random() * 5;
            if (s > fallbackScore) {
              fallbackScore = s;
              bestIndex = i;
            }
          }
        }

        // Failsafe: if every card has a busy teacher in this period,
        // unassign the teacher for this specific slot so students still receive their lesson,
        // but STILL STRICTLY RESPECT the daily subject limit (never 2 Maths on same day)!
        let unassignedFallbackCard = null;
        if (bestIndex === -1 && pool.length > 0) {
          let candidateIdx = pool.findIndex((c) => {
            const dCount = cohortDaySubjectCount.get(`${cohortKey}_${day}_${c.subjectCode}`) || 0;
            const isDouble = isDoubleEligibleSubject(c.subjectCode);
            return isDouble ? dCount < 2 : dCount === 0;
          });
          if (candidateIdx !== -1) {
            bestIndex = candidateIdx;
            unassignedFallbackCard = { ...pool[bestIndex], teacherId: "", teacherName: "" };
            pool.splice(bestIndex, 1);
          } else {
            // All remaining pool cards have already reached their daily cap today.
            // Insert designated Study / Library period rather than repeating a subject!
            generatedSlots.push({
              grade: cohort.grade,
              stream: cohort.stream,
              day,
              periodId: period.id,
              subjectCode: "STUDY",
              subjectName: "Library / Private Study",
              teacherId: "",
              teacherName: "",
              room: "",
            });
            continue;
          }
        }

        if (unassignedFallbackCard !== null) {
          const dKey = `${cohortKey}_${day}_${unassignedFallbackCard.subjectCode}`;
          const newDCount = (cohortDaySubjectCount.get(dKey) || 0) + 1;
          cohortDaySubjectCount.set(dKey, newDCount);

          if (isDoubleEligibleSubject(unassignedFallbackCard.subjectCode) && newDCount === 2) {
            cohortDoubleDone.add(`${cohortKey}_${unassignedFallbackCard.subjectCode}`);
          }

          const currChronoIdx = instructionalPeriods.findIndex((p) => p.id === period.id);
          cohortLastPlacedPeriod.set(`${cohortKey}_${day}`, {
            periodId: period.id,
            chronoIdx: currChronoIdx,
            subjectCode: unassignedFallbackCard.subjectCode,
            teacherId: "",
          });

          generatedSlots.push({
            grade: cohort.grade,
            stream: cohort.stream,
            day,
            periodId: period.id,
            subjectCode: unassignedFallbackCard.subjectCode,
            subjectName: unassignedFallbackCard.subjectName,
            teacherId: "",
            teacherName: "",
            room: "",
          });
          continue;
        }

        if (bestIndex !== -1) {
          const [selectedCard] = pool.splice(bestIndex, 1);
          if (selectedCard.teacherId) {
            busyTeachersInSlot.add(selectedCard.teacherId);
            const tdKey = `${selectedCard.teacherId}_${day}`;
            teacherDayCount.set(tdKey, (teacherDayCount.get(tdKey) || 0) + 1);
          }

          const dailyKey = `${cohortKey}_${day}_${selectedCard.subjectCode}`;
          const newDailyCount = (cohortDaySubjectCount.get(dailyKey) || 0) + 1;
          cohortDaySubjectCount.set(dailyKey, newDailyCount);

          if (isDoubleEligibleSubject(selectedCard.subjectCode) && newDailyCount === 2) {
            cohortDoubleDone.add(`${cohortKey}_${selectedCard.subjectCode}`);
          }

          const currChronoIdx = instructionalPeriods.findIndex((p) => p.id === period.id);
          cohortLastPlacedPeriod.set(`${cohortKey}_${day}`, {
            periodId: period.id,
            chronoIdx: currChronoIdx,
            subjectCode: selectedCard.subjectCode,
            teacherId: selectedCard.teacherId,
          });

          const periodKey = `${cohortKey}_${period.id}_${selectedCard.subjectCode}`;
          cohortPeriodSubjectCount.set(periodKey, (cohortPeriodSubjectCount.get(periodKey) || 0) + 1);

          if (selectedCard.teacherId) {
            const tpKey = `${selectedCard.teacherId}_${period.id}_${cohortKey}`;
            teacherPeriodCohortCount.set(tpKey, (teacherPeriodCohortCount.get(tpKey) || 0) + 1);
          }

          generatedSlots.push({
            grade: cohort.grade,
            stream: cohort.stream,
            day,
            periodId: period.id,
            subjectCode: selectedCard.subjectCode,
            subjectName: selectedCard.subjectName,
            teacherId: selectedCard.teacherId || "",
            teacherName: selectedCard.teacherName || "",
            room: "",
          });
        }
      }
    }
  }

  return generatedSlots;
}

/**
 * Pure scheduler that distributes subjects and teachers across instructional periods
 * guaranteeing ZERO teacher collisions, diverse period shuffling across days,
 * and balanced weekly subject distribution.
 */
export function buildCollisionFreeSchedule({
  cohorts, // [{ grade, stream }]
  instructionalPeriods, // [{ id, name, startTime, endTime }]
  periods, // full list of periods including breaks (optional)
  days = DAYS,
  subjects = [],
  teachers = [],
  attempts = 12,
}) {
  if (!cohorts || !cohorts.length) throw new Error("No classes found to generate timetable for.");
  if (!instructionalPeriods || !instructionalPeriods.length) throw new Error("No instructional periods found.");

  const totalExpectedSlots = cohorts.length * days.length * instructionalPeriods.length;

  let bestSchedule = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = generateSingleScheduleAttempt({
      cohorts,
      instructionalPeriods,
      allPeriods: periods || instructionalPeriods,
      days,
      subjects,
      teachers,
    });

    const conflicts = detectTimetableConflicts(candidate);
    if (conflicts.length > 0) continue; // Collision-free is mandatory

    const completeness = candidate.length / totalExpectedSlots;

    // Calculate period repeat score across cohorts:
    // We want subjects to be in different periods across days (low repeats)
    let periodRepeats = 0;
    const periodMap = new Map();
    for (const slot of candidate) {
      const key = `${slot.grade}_${slot.stream}_${slot.periodId}_${slot.subjectCode}`;
      periodMap.set(key, (periodMap.get(key) || 0) + 1);
    }
    for (const count of periodMap.values()) {
      if (count > 1) periodRepeats += (count - 1);
    }

    // High completeness + low repeats = high quality shuffled timetable
    const qualityScore = (completeness * 1000) - (periodRepeats * 15);

    if (qualityScore > bestScore) {
      bestScore = qualityScore;
      bestSchedule = candidate;
      if (completeness >= 1 && periodRepeats === 0) {
        break; // Perfect schedule found early
      }
    }
  }

  return bestSchedule || [];
}

/**
 * Generates and commits a collision-free master timetable across all classes in the school.
 */
export async function generateCollisionFreeTimetable(userId, { classes, subjects, teachers, periods, days = DAYS }) {
  const schoolId = getCurrentSchoolId();
  const instructionalPeriods = periods.filter((p) => !p.isBreak);

  const cohorts = [];
  for (const c of classes) {
    if (!c.streams || !c.streams.length) {
      cohorts.push({ grade: c.grade, stream: "" });
    } else {
      for (const s of c.streams) {
        cohorts.push({ grade: c.grade, stream: s });
      }
    }
  }

  const generated = buildCollisionFreeSchedule({
    cohorts,
    instructionalPeriods,
    periods,
    days,
    subjects,
    teachers,
  });

  const conflicts = detectTimetableConflicts(generated);

  // CRITICAL: Cleanly wipe all existing timetable slots for the school first
  // so stale, incomplete, or legacy slots CANNOT bleed through or collide with fresh schedule
  await clearAllTimetableSlots(userId);

  // Commit in chunks of 450 to respect Firestore batch limits
  const BATCH_SIZE = 450;
  for (let i = 0; i < generated.length; i += BATCH_SIZE) {
    const chunk = generated.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const slot of chunk) {
      const id = slotId(schoolId, slot.grade, slot.stream, slot.day, slot.periodId);
      batch.set(
        doc(db, "timetable_slots", id),
        {
          ...slot,
          schoolId,
          updatedBy: userId,
          updatedAt: serverTimestamp(),
        }
      );
    }
    await batch.commit();
  }

  invalidatePrefix(`timetable_class:${schoolId}`);
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  invalidate(masterTimetableCacheKey());
  await logAction(userId, "generate_master_timetable", "timetable_slots", schoolId);

  const unassignedCount = generated.filter((s) => !s.teacherId).length;
  return { totalSlots: generated.length, conflictsCount: conflicts.length, unassignedCount };
}

/** Clears all timetable slots for the entire school. */
export async function clearAllTimetableSlots(userId) {
  const schoolId = getCurrentSchoolId();
  const snap = await getDocs(
    query(collection(db, "timetable_slots"), where("schoolId", "==", schoolId))
  );
  const docs = snap.docs;
  const BATCH_SIZE = 450;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const d of chunk) {
      batch.delete(doc(db, "timetable_slots", d.id));
    }
    await batch.commit();
  }

  invalidatePrefix(`timetable_class:${schoolId}`);
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  invalidate(masterTimetableCacheKey());
  await logAction(userId, "clear_all_timetable_slots", "timetable_slots", schoolId);
}

/** Clears all timetable slots for a specific class cohort. */
export async function clearClassTimetableSlots(userId, grade, stream) {
  const schoolId = getCurrentSchoolId();
  const snap = await getDocs(
    query(
      collection(db, "timetable_slots"),
      where("schoolId", "==", schoolId),
      where("grade", "==", grade),
      where("stream", "==", stream)
    )
  );
  const batch = writeBatch(db);
  for (const d of snap.docs) {
    batch.delete(doc(db, "timetable_slots", d.id));
  }
  await batch.commit();

  invalidate(classTimetableCacheKey(grade, stream));
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  invalidate(masterTimetableCacheKey());
  await logAction(userId, "clear_class_timetable_slots", "timetable_slots", `${grade}_${stream}`);
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
 * Validates whether a slot can be assigned without teacher or room collisions.
 */
export async function checkSlotConflict({ grade, stream, day, periodId, teacherId, teacherName, room }) {
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

  const cleanRoom = (room || "").trim().toLowerCase();
  const isSharedVenue = cleanRoom && SHARED_VENUES.some((v) => cleanRoom.includes(v));

  for (const d of sameSlotElsewhere.docs) {
    if (d.id === id) continue;
    const other = d.data();
    if (teacherId && other.teacherId === teacherId) {
      const otherClass = `${other.grade || ""}${other.stream ? " " + other.stream : ""}`.trim();
      return {
        hasConflict: true,
        reason: `${teacherName || "This teacher"} is already teaching ${otherClass} at that time.`,
      };
    }
    if (!isSharedVenue && cleanRoom && other.room && other.room.trim().toLowerCase() === cleanRoom) {
      const otherClass = `${other.grade || ""}${other.stream ? " " + other.stream : ""}`.trim();
      return {
        hasConflict: true,
        reason: `Room "${room}" is already booked by ${otherClass} at that time.`,
      };
    }
  }

  return { hasConflict: false };
}

/**
 * Assigns (or reassigns) a class/day/period slot, blocking the save if the
 * chosen teacher - or, if given, the room - is already booked elsewhere at
 * that exact day+period.
 */
export async function assignSlot(
  userId,
  { grade, stream, day, periodId, subjectCode, subjectName, teacherId, teacherName, room, isActivity = false, activityType = "", isDouble = false }
) {
  const schoolId = getCurrentSchoolId();
  const id = slotId(schoolId, grade, stream, day, periodId);

  const conflict = await checkSlotConflict({ grade, stream, day, periodId, teacherId, teacherName, room });
  if (conflict.hasConflict) {
    throw new Error(conflict.reason);
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
    isActivity: !!isActivity,
    activityType: activityType || "",
    isDouble: !!isDouble,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  });
  invalidate(classTimetableCacheKey(grade, stream));
  invalidate(masterTimetableCacheKey());
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  await logAction(userId, "assign_timetable_slot", "timetable_slots", id);
  return id;
}

/**
 * Assigns a 2-period Double Lesson atomically, verifying both periods for collisions first.
 */
export async function assignDoubleSlot(
  userId,
  { grade, stream, day, period1Id, period2Id, subjectCode, subjectName, teacherId, teacherName, room, isActivity = false, activityType = "" }
) {
  // Validate Period 1
  const c1 = await checkSlotConflict({ grade, stream, day, periodId: period1Id, teacherId, teacherName, room });
  if (c1.hasConflict) throw new Error(c1.reason);

  // Validate Period 2
  const c2 = await checkSlotConflict({ grade, stream, day, periodId: period2Id, teacherId, teacherName, room });
  if (c2.hasConflict) throw new Error(`Period 2 conflict: ${c2.reason}`);

  // Save both periods with isDouble: true
  await assignSlot(userId, { grade, stream, day, periodId: period1Id, subjectCode, subjectName, teacherId, teacherName, room, isActivity, activityType, isDouble: true });
  await assignSlot(userId, { grade, stream, day, periodId: period2Id, subjectCode, subjectName, teacherId, teacherName, room, isActivity, activityType, isDouble: true });
}

export async function clearSlot(userId, grade, stream, day, periodId) {
  const schoolId = getCurrentSchoolId();
  const id = slotId(schoolId, grade, stream, day, periodId);
  await deleteDoc(doc(db, "timetable_slots", id));
  invalidate(classTimetableCacheKey(grade, stream));
  invalidate(masterTimetableCacheKey());
  invalidatePrefix(`timetable_teacher:${schoolId}`);
  await logAction(userId, "clear_timetable_slot", "timetable_slots", id);
}

/**
 * Clears both slots of a Double Lesson.
 */
export async function clearDoubleSlot(userId, grade, stream, day, period1Id, period2Id) {
  await clearSlot(userId, grade, stream, day, period1Id);
  if (period2Id) {
    await clearSlot(userId, grade, stream, day, period2Id);
  }
}

// ------------------------------------ Secure Shared Public Timetables (No Login) --

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
  schoolSettings = {},
  teachers = [],
  pin = null,
}) {
  const schoolId = getCurrentSchoolId();
  const shareId = `sec_${generateSecureShareToken()}`;

  const payload = {
    id: shareId,
    schoolId,
    type,
    targetId,
    title: title || (type === "master" ? "Institutional Master Timetable" : type === "teacher" ? "Teacher Schedule" : "Class Schedule"),
    subTitle: subTitle || "",
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
    periods: (periods || []).map((p) => ({
      id: p.id,
      name: p.name,
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: !!p.isBreak,
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
      room: s.room || "",
      isActivity: !!s.isActivity,
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
  const school = data.schoolInfo || {};
  const periods = data.periods || [];
  const slots = data.slots || [];
  const title = data.title || "School Timetable";
  const subTitle = data.subTitle || "";
  const schoolName = school.name || "School Timetable";
  const motto = school.motto || "";
  const currentYear = school.academicYear || new Date().getFullYear();
  const currentTerm = school.term || "Term 1";

  const slotMap = new Map();
  for (const s of slots) {
    const key = `${s.grade || ""}_${s.stream || ""}_${s.day}_${s.periodId}`;
    slotMap.set(key, s);
  }

  const isMaster = data.type === "master";

  // Derive unique cohorts (only for master institutional wall chart)
  const cohortKeys = new Set();
  const cohorts = [];
  if (isMaster) {
    for (const s of slots) {
      const key = `${s.grade || ""}|${s.stream || ""}`;
      if (!cohortKeys.has(key)) {
        cohortKeys.add(key);
        const label = `${s.grade || ""}${s.stream ? " " + s.stream : ""}`.trim() || "All Classes";
        cohorts.push({ grade: s.grade || "", stream: s.stream || "", label });
      }
    }
    if (!cohorts.length) {
      cohorts.push({ grade: "", stream: "", label: "All Classes" });
    }
  }

  const days = DAYS;

  // Build grid HTML
  let theadHtml = `
    <thead>
      <tr>
        <th style="width:55px;">DAY</th>
        ${isMaster && cohorts.length > 1 ? '<th style="width:110px;">CLASS</th>' : ''}
        ${periods.map((p) => {
          if (p.isBreak) {
            return `<th class="th-break" style="width:36px;">${p.name}<br/><span style="font-size:7pt; font-family:monospace; font-weight:normal;">${p.startTime}–${p.endTime}</span></th>`;
          }
          return `<th>${p.name}<br/><span style="font-size:7pt; font-family:monospace; font-weight:normal;">${p.startTime}–${p.endTime}</span></th>`;
        }).join("")}
      </tr>
    </thead>
  `;

  let tbodyHtml = "<tbody>";
  if (isMaster && cohorts.length > 1) {
    for (const day of days) {
      for (let cIdx = 0; cIdx < cohorts.length; cIdx++) {
        const c = cohorts[cIdx];
        const isFirst = cIdx === 0;
        const isLast = cIdx === cohorts.length - 1;

        tbodyHtml += `<tr style="${isLast ? 'border-bottom: 2px solid #0f172a;' : ''}">`;

        if (isFirst) {
          tbodyHtml += `
            <td rowspan="${cohorts.length}" class="day-cell">
              <b>${day.substring(0, 4).toUpperCase()}</b>
            </td>
          `;
        }

        tbodyHtml += `
          <td class="class-cell">
            <b>${c.label}</b>
          </td>
        `;

        for (let pIdx = 0; pIdx < periods.length; pIdx++) {
          const p = periods[pIdx];

          if (p.isBreak) {
            if (isFirst) {
              tbodyHtml += `
                <td rowspan="${cohorts.length}" class="break-cell">
                  <div class="vertical-text">${p.name} (${p.startTime}–${p.endTime})</div>
                </td>
              `;
            }
            continue;
          }

          const slot = slotMap.get(`${c.grade}_${c.stream}_${day}_${p.id}`);

          let isMerged = false;
          if (slot && isDoubleAllowed(slot) && pIdx + 1 < periods.length) {
            const nextP = periods[pIdx + 1];
            if (!nextP.isBreak) {
              const nextSlot = slotMap.get(`${c.grade}_${c.stream}_${day}_${nextP.id}`);
              if (nextSlot && nextSlot.subjectCode === slot.subjectCode && nextSlot.teacherId === slot.teacherId) {
                isMerged = true;
              }
            }
          }

          if (isMerged) {
            tbodyHtml += `
              <td colspan="2" class="slot-cell slot-cell--merged">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="subj-name">${slot.subjectName || slot.subjectCode}</span>
                  <span class="tag-double">Double</span>
                </div>
                <div class="meta-line">${slot.teacherName || "—"} · ${slot.room || "Room"}</div>
              </td>
            `;
            pIdx++;
            continue;
          }

          if (slot) {
            tbodyHtml += `
              <td class="slot-cell">
                <div class="subj-name">${slot.subjectName || slot.subjectCode}</div>
                <div class="meta-line">${slot.teacherName || "—"} · ${slot.room || "Room"}</div>
              </td>
            `;
          } else {
            tbodyHtml += `<td class="slot-cell empty-cell">—</td>`;
          }
        }

        tbodyHtml += "</tr>";
      }
    }
  } else {
    // Individual Schedule (Teacher or Single Class): 1 clean row per Day!
    for (let dIdx = 0; dIdx < days.length; dIdx++) {
      const day = days[dIdx];
      const isFirst = dIdx === 0;
      const isLast = dIdx === days.length - 1;

      tbodyHtml += `<tr style="${isLast ? 'border-bottom: 2px solid #0f172a;' : ''}">`;

      tbodyHtml += `
        <td class="day-cell">
          <b>${day.substring(0, 4).toUpperCase()}</b>
        </td>
      `;

      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        const p = periods[pIdx];

        if (p.isBreak) {
          if (isFirst) {
            tbodyHtml += `
              <td rowspan="${days.length}" class="break-cell">
                <div class="vertical-text">${p.name} (${p.startTime}–${p.endTime})</div>
              </td>
            `;
          }
          continue;
        }

        const slot = slots.find((s) => s.day === day && s.periodId === p.id) || null;

        let isMerged = false;
        if (slot && isDoubleAllowed(slot) && pIdx + 1 < periods.length) {
          const nextP = periods[pIdx + 1];
          if (!nextP.isBreak) {
            const nextSlot = slots.find((s) => s.day === day && s.periodId === nextP.id) || null;
            if (nextSlot && nextSlot.subjectCode === slot.subjectCode) {
              if (data.type === "teacher") {
                if (nextSlot.grade === slot.grade && (nextSlot.stream || "") === (slot.stream || "")) {
                  isMerged = true;
                }
              } else {
                if (nextSlot.teacherId === slot.teacherId) {
                  isMerged = true;
                }
              }
            }
          }
        }

        if (isMerged) {
          const topLabel = data.type === "teacher" ? `${slot.grade} ${slot.stream || ""}`.trim() : (slot.subjectName || slot.subjectCode);
          const subLabel = data.type === "teacher" ? (slot.subjectName || slot.subjectCode) : (slot.teacherName || "—");

          tbodyHtml += `
            <td colspan="2" class="slot-cell slot-cell--merged">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="subj-name">${topLabel}</span>
                <span class="tag-double">Double</span>
              </div>
              <div class="meta-line">${subLabel} · ${slot.room || "Room"}</div>
            </td>
          `;
          pIdx++;
          continue;
        }

        if (slot) {
          const topLabel = data.type === "teacher" ? `${slot.grade} ${slot.stream || ""}`.trim() : (slot.subjectName || slot.subjectCode);
          const subLabel = data.type === "teacher" ? (slot.subjectName || slot.subjectCode) : (slot.teacherName || "—");

          tbodyHtml += `
            <td class="slot-cell">
              <div class="subj-name">${topLabel}</div>
              <div class="meta-line">${subLabel} · ${slot.room || "Room"}</div>
            </td>
          `;
        } else {
          tbodyHtml += `<td class="slot-cell empty-cell">${data.type === "teacher" ? "FREE / PREP" : "—"}</td>`;
        }
      }

      tbodyHtml += "</tr>";
    }
  }
  tbodyHtml += "</tbody>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · ${schoolName}</title>
<style>
  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f8fafc;
    color: #0f172a;
    padding: 20px;
    font-size: 13px;
  }
  .container {
    max-width: 1200px;
    margin: 0 auto;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .header {
    background: #0f2744;
    color: #ffffff;
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  .school-title { font-size: 20px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
  .school-motto { font-size: 11px; opacity: 0.85; font-style: italic; margin-top: 2px; }
  .doc-badge {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    text-align: right;
  }
  .actions-bar {
    background: #f1f5f9;
    border-bottom: 1px solid #cbd5e1;
    padding: 10px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #0f2744;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover { background: #1e3a8a; }
  .btn--ghost { background: #ffffff; color: #0f2744; border: 1px solid #cbd5e1; }
  .btn--ghost:hover { background: #e2e8f0; }
  .table-wrap { overflow-x: auto; padding: 20px; }
  table { width: 100%; border-collapse: collapse; min-width: 860px; font-size: 11px; }
  th, td { border: 1px solid #94a3b8; padding: 6px 8px; vertical-align: middle; }
  thead th {
    background: #0f2744;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    text-align: center;
    padding: 8px 6px;
  }
  thead th.th-break { background: #92400e; }
  .day-cell { background: #f1f5f9; text-align: center; font-size: 12px; font-weight: 800; }
  .class-cell { background: #f8fafc; font-weight: 700; white-space: nowrap; }
  .break-cell {
    background: #fef3c7;
    text-align: center;
    vertical-align: middle;
    padding: 2px;
    min-height: 80px;
  }
  .vertical-text {
    writing-mode: vertical-lr;
    transform: rotate(180deg);
    font-size: 9px;
    font-weight: 800;
    color: #78350f;
    letter-spacing: 0.05em;
    white-space: nowrap;
    margin: 0 auto;
  }
  .slot-cell { vertical-align: top; background: #ffffff; }
  .slot-cell--merged { background: #f0fdf4; border-left: 2px solid #0f172a; }
  .subj-name { font-weight: 700; font-size: 12px; color: #0f172a; display: block; }
  .meta-line { font-size: 10px; color: #475569; margin-top: 2px; }
  .empty-cell { text-align: center; color: #94a3b8; font-style: italic; font-size: 10px; }
  .tag-double { font-size: 8px; font-weight: 800; border: 1px solid #0284c7; color: #0284c7; padding: 0 4px; border-radius: 3px; text-transform: uppercase; }
  .footer {
    padding: 16px 24px;
    background: #f8fafc;
    border-top: 1px solid #cbd5e1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #64748b;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media print {
    body { padding: 0; background: #ffffff; }
    .container { border: none; box-shadow: none; max-width: 100%; }
    .actions-bar { display: none; }
    .header { background: #0f2744 !important; color: #ffffff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    th, td { border: 1px solid #0f172a !important; }
    thead th { background: #0f2744 !important; color: #ffffff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    thead th.th-break { background: #92400e !important; }
    .break-cell { background: #fef3c7 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div>
      <div class="school-title">${schoolName}</div>
      ${motto ? `<div class="school-motto">"${motto}"</div>` : ''}
      <div style="font-size:12px; margin-top:6px; opacity:0.9;"><b>${title}</b>${subTitle ? ` · ${subTitle}` : ''}</div>
    </div>
    <div class="doc-badge">
      <div><b>${currentTerm}</b></div>
      <div>Academic Year ${currentYear}</div>
      <div style="font-size:10px; opacity:0.8; margin-top:2px;">Official Timetable</div>
    </div>
  </div>

  <div class="actions-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#16a34a;"></span>
      <span style="font-weight:600; font-size:11.5px; color:#166534;">Saved Offline File · Works Without Internet</span>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="btn" onclick="window.print()">🖨️ Print / Save PDF</button>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      ${theadHtml}
      ${tbodyHtml}
    </table>
  </div>

  <div class="footer">
    <div>${schoolName} · Verified CBC JSS Timetable</div>
    <div>Generated from Official School Record · Offline Ready</div>
  </div>
</div>
</body>
</html>`;
}

/**
 * Triggers a browser file download of the standalone single-file HTML timetable.
 */
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
