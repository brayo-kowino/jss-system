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
  const MAX_TEACHER_WEEKLY_LESSONS = 35; // Maximum weekly teaching load cap to prevent pigeonhole trap

  // Track global lesson assignments across teachers during pool construction
  const teacherAssignedLessons = new Map();

  for (const cohort of cohorts) {
    const cohortKey = `${cohort.grade}_${cohort.stream}`;
    const pool = [];

    for (const subj of subjects) {
      const count = defaultLessonDistribution[subj.code] || 3;

      // 1. Exact match for this cohort (grade + stream + subject)
      let assignedTeacher = teachers.find((t) =>
        (t.teachingAssignments || []).some(
          (a) =>
            a.subjectCode === subj.code &&
            a.grade === cohort.grade &&
            a.stream &&
            a.stream === cohort.stream
        )
      );

      // 2. Grade-level match (same grade, no stream specified = applies to all streams in grade)
      if (!assignedTeacher) {
        assignedTeacher = teachers.find((t) =>
          (t.teachingAssignments || []).some(
            (a) =>
              a.subjectCode === subj.code &&
              a.grade === cohort.grade &&
              !a.stream
          )
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

    // Pad or trim pool to match total weekly slots exactly
    if (pool.length < totalSlotsPerWeek && subjects.length > 0) {
      let subjIdx = 0;
      while (pool.length < totalSlotsPerWeek) {
        const subj = subjects[subjIdx % subjects.length];
        const assignedTeacher = teachers.find((t) =>
          (t.teachingAssignments || []).some(
            (a) =>
              a.subjectCode === subj.code &&
              a.grade === cohort.grade &&
              (!a.stream || a.stream === cohort.stream)
          )
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
        subjIdx++;
      }
    } else if (pool.length > totalSlotsPerWeek) {
      pool.length = totalSlotsPerWeek;
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

  // Tracking maps for diversity
  const cohortDaySubjectCount = new Map();       // `${cohortKey}_${day}_${subjectCode}` -> count
  const cohortPeriodSubjectCount = new Map();    // `${cohortKey}_${periodId}_${subjectCode}` -> count
  const teacherPeriodCohortCount = new Map();    // `${teacherId}_${periodId}_${cohortKey}` -> count

  // Iterate over days and instructional periods
  // We rotate the period processing order across different days so morning vs afternoon slots are naturally varied
  for (let dIdx = 0; dIdx < days.length; dIdx++) {
    const day = days[dIdx];

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
          // STRICT COLLISION PREVENTION: Skip if this teacher is already teaching in this slot
          if (card.teacherId && busyTeachersInSlot.has(card.teacherId)) {
            continue;
          }

          const dailyCount = cohortDaySubjectCount.get(`${cohortKey}_${day}_${card.subjectCode}`) || 0;
          // Prefer not exceeding 2 lessons of the same subject on the same day
          if (dailyCount >= 2 && pool.some((c) => (cohortDaySubjectCount.get(`${cohortKey}_${day}_${c.subjectCode}`) || 0) < 2 && (!c.teacherId || !busyTeachersInSlot.has(c.teacherId)))) {
            continue;
          }

          const periodCount = cohortPeriodSubjectCount.get(`${cohortKey}_${period.id}_${card.subjectCode}`) || 0;
          const teacherPeriodCount = card.teacherId ? (teacherPeriodCohortCount.get(`${card.teacherId}_${period.id}_${cohortKey}`) || 0) : 0;

          let score = 0;

          // 1. Heavy penalty if this subject was already placed at this exact period on another day!
          // This directly ensures subjects appear at DIFFERENT times of day throughout the week.
          if (periodCount > 0) {
            score -= periodCount * 70;
          } else {
            score += 25; // Reward placing subject at a fresh period
          }

          // 2. Penalty if this subject was already taught today (spread across days)
          if (dailyCount === 0) {
            score += 30;
          } else if (dailyCount === 1) {
            score -= 40;
          }

          // 3. Penalty if teacher already taught this cohort at this period on other days
          if (teacherPeriodCount > 0) {
            score -= teacherPeriodCount * 30;
          }

          // 4. Cognitive load balance (morning focus vs afternoon practical/creative)
          const pNum = parseInt((period.name || "").replace(/\D/g, ""), 10) || 1;
          const isMorning = pNum <= 4;
          const isAfternoon = pNum >= 5;
          const morningPreferred = ["MATH", "SCI", "ENG", "KIS"];
          const afternoonPreferred = ["CRA", "AGR", "PTS", "PE", "PHE", "CRE", "IRE", "HRE", "SST"];

          if (isMorning && morningPreferred.includes(card.subjectCode)) {
            score += 16;
          } else if (isAfternoon && afternoonPreferred.includes(card.subjectCode)) {
            score += 16;
          }

          // 5. Heavily loaded teacher prioritization
          if (card.teacherId) {
            score += (teacherFrequency.get(card.teacherId) || 0) * 8;
          }

          // 6. Random jitter for rich, dynamic shuffling
          score += Math.random() * 15;

          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }

        // Fallback: any card that does not cause a teacher collision
        if (bestIndex === -1) {
          let fallbackScore = -Infinity;
          for (let i = 0; i < pool.length; i++) {
            const card = pool[i];
            if (!card.teacherId || !busyTeachersInSlot.has(card.teacherId)) {
              const pCount = cohortPeriodSubjectCount.get(`${cohortKey}_${period.id}_${card.subjectCode}`) || 0;
              const dCount = cohortDaySubjectCount.get(`${cohortKey}_${day}_${card.subjectCode}`) || 0;
              const s = -(pCount * 20) - (dCount * 10) + Math.random() * 5;
              if (s > fallbackScore) {
                fallbackScore = s;
                bestIndex = i;
              }
            }
          }
        }

        // Failsafe: if every card in the pool has a busy teacher in this period,
        // place the card but unassign the teacher for this specific slot so the students
        // still receive their lesson and zero slots are dropped, while strictly preventing collisions!
        if (bestIndex === -1 && pool.length > 0) {
          bestIndex = 0;
          pool[bestIndex].teacherId = "";
          pool[bestIndex].teacherName = "";
        }

        if (bestIndex !== -1) {
          const [selectedCard] = pool.splice(bestIndex, 1);
          if (selectedCard.teacherId) {
            busyTeachersInSlot.add(selectedCard.teacherId);
          }

          const dailyKey = `${cohortKey}_${day}_${selectedCard.subjectCode}`;
          cohortDaySubjectCount.set(dailyKey, (cohortDaySubjectCount.get(dailyKey) || 0) + 1);

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
  days = DAYS,
  subjects = [],
  teachers = [],
  attempts = 8,
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

  return { totalSlots: generated.length, conflictsCount: conflicts.length };
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
  { grade, stream, day, periodId, subjectCode, subjectName, teacherId, teacherName, room, isActivity = false, activityType = "" }
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

  // Save both periods
  await assignSlot(userId, { grade, stream, day, periodId: period1Id, subjectCode, subjectName, teacherId, teacherName, room, isActivity, activityType });
  await assignSlot(userId, { grade, stream, day, periodId: period2Id, subjectCode, subjectName, teacherId, teacherName, room, isActivity, activityType });
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