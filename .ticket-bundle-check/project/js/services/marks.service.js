// Marks Entry.
// marks/{assessmentId_subjectCode_studentId}: { schoolId, assessmentId,
//   subjectCode, studentId, grade, stream, score, maxScore, enteredBy,
//   enteredAt, updatedAt }
//
// One doc per student per subject per assessment, with a deterministic ID so
// re-saving the same cell is a plain upsert (autosave-friendly) instead of
// creating duplicates. assessmentId/studentId are already Firestore auto-IDs
// (globally unique), so this composite key doesn't need schoolId namespacing.
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { getAssessment } from "./assessment.service.js";
import { cached, invalidate } from "./query-cache.js";

export const DEFAULT_MAX_SCORE = 100;

function markId(assessmentId, subjectCode, studentId) {
  return `${assessmentId}_${subjectCode}_${studentId}`;
}

function marksByAssessmentCacheKey(assessmentId) {
  return `marks_by_assessment:${getCurrentSchoolId()}:${assessmentId}`;
}

export async function listMarks(assessmentId, subjectCode) {
  return cached(`marks:${getCurrentSchoolId()}:${assessmentId}:${subjectCode}`, 5 * 60_000, async () => {
    const snap = await getDocs(
      query(
        collection(db, "marks"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("assessmentId", "==", assessmentId),
        where("subjectCode", "==", subjectCode)
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

// All marks (every subject) for a single assessment - the read the
// Assessments page's Results modal needs. Scoped to one assessment instead
// of the whole school, and cached so re-opening the same assessment's
// Results doesn't re-hit Firestore. See listAllMarks() below for why this
// exists as a separate, narrower query.
export async function listMarksByAssessment(assessmentId) {
  return cached(marksByAssessmentCacheKey(assessmentId), 2 * 60_000, async () => {
    const snap = await getDocs(
      query(
        collection(db, "marks"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("assessmentId", "==", assessmentId)
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

// Whole-school marks fetch - expensive (grows without bound as terms pass) -
// so nothing in the app calls this anymore (the grading engine now uses
// listMarksByAssessment() per assessment, and the Assessments page uses it
// too - see listMarksByAssessment() below). Kept only as an explicit "don't
// do this" whole-collection option, not wired into any current view.
export async function listAllMarks() {
  const snap = await getDocs(query(collection(db, "marks"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function validateScore(score, maxScore) {
  const n = Number(score);
  if (score === "" || score === null || Number.isNaN(n)) throw new Error("Enter a number.");
  if (n < 0 || n > maxScore) throw new Error(`Score must be between 0 and ${maxScore}.`);
  return n;
}

export async function upsertMark(userId, { assessmentId, subjectCode, studentId, grade, stream, score, maxScore = DEFAULT_MAX_SCORE }) {
  const assessment = await getAssessment(assessmentId);
  if (assessment?.status === "locked") {
    throw new Error("This assessment is locked. Ask an admin to reopen it before entering marks.");
  }
  const n = validateScore(score, maxScore);
  await setDoc(
    doc(db, "marks", markId(assessmentId, subjectCode, studentId)),
    {
      schoolId: getCurrentSchoolId(),
      assessmentId,
      subjectCode,
      studentId,
      grade,
      stream,
      score: n,
      maxScore,
      enteredBy: userId,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  invalidate(marksByAssessmentCacheKey(assessmentId));
  invalidate(`marks:${getCurrentSchoolId()}:${assessmentId}:${subjectCode}`);
}

export async function bulkUpsertMarks(userId, assessmentId, subjectCode, entries) {
  const assessment = await getAssessment(assessmentId);
  if (assessment?.status === "locked") {
    throw new Error("This assessment is locked. Ask an admin to reopen it before entering marks.");
  }
  const schoolId = getCurrentSchoolId();
  const results = { saved: 0, failed: [] };

  // Validate every entry up front (pure, no network) before touching
  // Firestore at all - this used to be interleaved with a setDoc-per-entry
  // loop below, which meant the "single bulkUpsertMarks call" the 7-second
  // autosave loop was built around actually still fired one network
  // round-trip per dirty cell (40 students changed -> 40 sequential
  // writes). Validating first, batching second, means an invalid score
  // can't abort or slow down everyone else's marks, and a full class only
  // ever costs one round trip.
  const valid = [];
  for (const entry of entries) {
    try {
      const n = validateScore(entry.score, entry.maxScore || DEFAULT_MAX_SCORE);
      valid.push({ ...entry, score: n });
    } catch (err) {
      results.failed.push({ studentId: entry.studentId, error: err.message });
    }
  }

  // Firestore caps a single batch at 500 writes - chunk defensively even
  // though a single class roster (the only caller of this today) will
  // essentially never approach that ceiling.
  const BATCH_LIMIT = 500;
  for (let i = 0; i < valid.length; i += BATCH_LIMIT) {
    const chunk = valid.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const entry of chunk) {
      batch.set(
        doc(db, "marks", markId(assessmentId, subjectCode, entry.studentId)),
        {
          schoolId,
          assessmentId,
          subjectCode,
          studentId: entry.studentId,
          grade: entry.grade,
          stream: entry.stream,
          score: entry.score,
          maxScore: entry.maxScore || DEFAULT_MAX_SCORE,
          enteredBy: userId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
    results.saved += chunk.length;
  }

  invalidate(marksByAssessmentCacheKey(assessmentId));
  invalidate(`marks:${schoolId}:${assessmentId}:${subjectCode}`);
  await logAction(userId, "bulk_enter_marks", "marks", `${assessmentId}_${subjectCode}`);
  return results;
}