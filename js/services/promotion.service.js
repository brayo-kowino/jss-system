// Promotion Engine — bulk end-of-year class progression.
//
// Reads the school's class list and active student roster, builds a
// promotion plan in memory (zero Firestore writes), then commits the
// reviewed plan in a single writeBatch().
//
// Two modes:
//   Auto — every active student advances one grade; final-grade students
//          graduate (status → "graduated", copied to alumni collection).
//   Manual — admin picks source/destination grades and selects students.
//
// The engine is intentionally "smart and direct": it does the absolute
// minimum number of writes — one batch (or chained batches for large
// rosters) — and gets it right because the admin reviews every planned
// move before committing.

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { invalidateStudentsCache } from "./student.service.js";
import { invalidate } from "./query-cache.js";

// ---------------------------------------------------------------- Helpers --

// Extracts the leading integer from a grade name for natural ordering.
// "Grade 7" → 7, "Grade 10" → 10, "Form 2" → 2, "PP1" → 1.
// Falls back to Infinity for non-numeric grades so they sort last.
function gradeNumber(grade) {
  const m = String(grade).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

// Natural sort comparator for grade names.
function compareGrades(a, b) {
  const na = gradeNumber(a);
  const nb = gradeNumber(b);
  if (na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

// ------------------------------------------------------- Grade Progression --

/**
 * Builds a grade progression map from the school's class list.
 *
 * Sorts grades naturally (Grade 7 < Grade 8 < Grade 9) and maps each
 * grade to the next. The final grade maps to `null` (graduation).
 *
 * @param {Array<{grade: string, streams: string[]}>} classes
 * @returns {Object} e.g. { "Grade 7": "Grade 8", "Grade 8": "Grade 9", "Grade 9": null }
 */
export function buildGradeProgression(classes) {
  const sorted = [...classes].sort((a, b) => compareGrades(a.grade, b.grade));
  const map = {};
  for (let i = 0; i < sorted.length; i++) {
    map[sorted[i].grade] = i < sorted.length - 1 ? sorted[i + 1].grade : null;
  }
  return map;
}

/**
 * Returns the streams available in a given grade.
 */
export function streamsForGrade(classes, grade) {
  const cls = classes.find((c) => c.grade === grade);
  return cls?.streams || [];
}

// --------------------------------------------------------- Plan Generation --

/**
 * Generates a promotion plan for all active students.
 *
 * Each entry in the returned array describes one student's planned move:
 *   { student, fromGrade, fromStream, toGrade, toStream, action, warning }
 *
 * Actions:
 *   "promote"  — student moves to the next grade
 *   "graduate" — student is in the final grade (no next grade)
 *   "exclude"  — student excluded from the plan (set by review step)
 *
 * @param {Array} students — full student list (will be filtered to active only)
 * @param {Array} classes — school's class list
 * @param {Object} [options]
 * @param {string} [options.sourceGrade] — manual mode: only include this grade
 * @param {string} [options.destinationGrade] — manual mode: move to this grade instead of auto
 * @returns {Array} promotion plan entries
 */
export function generatePromotionPlan(students, classes, options = {}) {
  const progression = buildGradeProgression(classes);
  const activeStudents = students.filter((s) => s.status === "active");
  const { sourceGrade, destinationGrade } = options;

  const plan = [];

  for (const student of activeStudents) {
    const fromGrade = student.grade;
    const fromStream = student.stream || "";

    // Manual mode: skip students not in the source grade
    if (sourceGrade && fromGrade !== sourceGrade) continue;

    // Determine destination grade
    let toGrade;
    if (destinationGrade) {
      // Manual mode: explicit destination
      toGrade = destinationGrade;
    } else {
      // Auto mode: use progression map
      toGrade = progression[fromGrade];
    }

    // Is this a graduation (final grade)?
    const isGraduating = toGrade === null || toGrade === undefined;

    // Determine destination stream
    let toStream = fromStream;
    let warning = "";

    if (!isGraduating && toGrade) {
      const available = streamsForGrade(classes, toGrade);
      if (available.length > 0 && !available.includes(fromStream)) {
        // Student's stream doesn't exist in the destination grade
        toStream = available[0]; // Default to first available
        warning = `Stream "${fromStream}" not found in ${toGrade}. Assigned to "${toStream}".`;
      }
    }

    plan.push({
      student,
      fromGrade,
      fromStream,
      toGrade: isGraduating ? null : toGrade,
      toStream: isGraduating ? "" : toStream,
      action: isGraduating ? "graduate" : "promote",
      warning,
    });
  }

  // Sort by grade then name for a clean review table
  plan.sort((a, b) => {
    const g = compareGrades(a.fromGrade, b.fromGrade);
    if (g !== 0) return g;
    return (a.student.fullName || "").localeCompare(b.student.fullName || "");
  });

  return plan;
}

// ---------------------------------------------------------- Plan Commit --

// Firestore writeBatch limit is 500 operations per batch.
const BATCH_LIMIT = 500;

/**
 * Commits the reviewed promotion plan to Firestore.
 *
 * Only processes entries whose action is "promote" or "graduate" —
 * "exclude" entries are silently skipped.
 *
 * For "graduate" entries:
 *   1. Student's status is set to "graduated" with a statusHistory entry.
 *   2. Student's full record is copied to the `alumni` collection.
 *
 * After all student writes, the school's currentAcademicYear is bumped
 * and currentTerm is reset to the first term.
 *
 * @param {string} userId — the admin committing the promotion
 * @param {Array} plan — the reviewed promotion plan
 * @param {Object} options
 * @param {string} options.newAcademicYear — e.g. "2027"
 * @param {string} options.firstTerm — e.g. "Term 1"
 * @param {function} [options.onProgress] — callback(completed, total) for UI progress
 * @returns {Object} { promoted: number, graduated: number, batches: number }
 */
export async function commitPromotionPlan(userId, plan, options = {}) {
  const { newAcademicYear, firstTerm = "Term 1", onProgress } = options;
  const schoolId = getCurrentSchoolId();

  // Filter to actionable entries only
  const actionable = plan.filter((e) => e.action === "promote" || e.action === "graduate");
  if (actionable.length === 0) throw new Error("No students to promote.");

  let promoted = 0;
  let graduated = 0;
  let batchCount = 0;
  let opsInBatch = 0;
  let batch = writeBatch(db);

  async function flushBatch() {
    if (opsInBatch > 0) {
      await batch.commit();
      batchCount++;
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }

  async function addOp(fn) {
    if (opsInBatch >= BATCH_LIMIT) await flushBatch();
    fn(batch);
    opsInBatch++;
  }

  const now = new Date().toISOString();

  for (let i = 0; i < actionable.length; i++) {
    const entry = actionable[i];
    const studentRef = doc(db, "students", entry.student.id);

    if (entry.action === "promote") {
      // Update grade and stream
      await addOp((b) =>
        b.update(studentRef, {
          grade: entry.toGrade,
          stream: entry.toStream,
        })
      );
      promoted++;
    } else if (entry.action === "graduate") {
      // Mark as graduated
      await addOp((b) =>
        b.update(studentRef, {
          status: "graduated",
          statusHistory: arrayUnion({
            status: "graduated",
            reason: `Graduated — End of ${options.currentAcademicYear || ""} academic year`,
            by: userId,
            at: now,
          }),
        })
      );

      // Copy to alumni collection
      const alumniData = { ...entry.student };
      delete alumniData.id; // Don't store the Firestore doc ID as a field
      await addOp((b) =>
        b.set(doc(collection(db, "alumni")), {
          ...alumniData,
          schoolId,
          status: "graduated",
          graduatedAt: serverTimestamp(),
          graduationYear: options.currentAcademicYear || newAcademicYear,
          promotedBy: userId,
          originalStudentId: entry.student.id,
        })
      );
      graduated++;
    }

    onProgress?.(i + 1, actionable.length);
  }

  // Bump academic year and reset term on the school document
  if (newAcademicYear) {
    await addOp((b) =>
      b.update(doc(db, "schools", schoolId), {
        currentAcademicYear: newAcademicYear,
        currentTerm: firstTerm,
        updatedAt: serverTimestamp(),
      })
    );
  }

  // Flush the final batch
  await flushBatch();

  // Invalidate caches so the rest of the app picks up the changes
  invalidateStudentsCache();
  invalidate(`school_settings:${schoolId}`);

  // Audit log
  await logAction(userId, "bulk_promote", "students", null);

  return { promoted, graduated, batches: batchCount };
}

// -------------------------------------------------- Term 3 Detection --

/**
 * Returns true when the school is in its final term (typically Term 3),
 * signaling that it's promotion season.
 *
 * @param {Object} settings — school settings from getSchoolSettings()
 * @returns {boolean}
 */
export function isPromotionSeason(settings) {
  if (!settings) return false;
  const terms = settings.terms || ["Term 1", "Term 2", "Term 3"];
  const current = settings.currentTerm || "";
  // It's promotion season when the current term is the LAST term
  return terms.length > 0 && current === terms[terms.length - 1];
}
