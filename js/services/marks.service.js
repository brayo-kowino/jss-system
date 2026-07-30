// Marks Entry.
// marks/{assessmentId_subjectCode_studentId}: { assessmentId, subjectCode,
//   studentId, grade, stream, score, maxScore, enteredBy, enteredAt, updatedAt }
//
// One doc per student per subject per assessment, with a deterministic ID so
// re-saving the same cell is a plain upsert (autosave-friendly) instead of
// creating duplicates.
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getAssessment } from "./assessment.service.js";

export const DEFAULT_MAX_SCORE = 100;

function markId(assessmentId, subjectCode, studentId) {
  return `${assessmentId}_${subjectCode}_${studentId}`;
}

export async function listMarks(assessmentId, subjectCode) {
  const snap = await getDocs(
    query(collection(db, "marks"), where("assessmentId", "==", assessmentId), where("subjectCode", "==", subjectCode))
  );
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
}

export async function bulkUpsertMarks(userId, assessmentId, subjectCode, entries) {
  const assessment = await getAssessment(assessmentId);
  if (assessment?.status === "locked") {
    throw new Error("This assessment is locked. Ask an admin to reopen it before entering marks.");
  }
  const results = { saved: 0, failed: [] };
  for (const entry of entries) {
    try {
      const n = validateScore(entry.score, entry.maxScore || DEFAULT_MAX_SCORE);
      await setDoc(
        doc(db, "marks", markId(assessmentId, subjectCode, entry.studentId)),
        {
          assessmentId,
          subjectCode,
          studentId: entry.studentId,
          grade: entry.grade,
          stream: entry.stream,
          score: n,
          maxScore: entry.maxScore || DEFAULT_MAX_SCORE,
          enteredBy: userId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      results.saved += 1;
    } catch (err) {
      results.failed.push({ studentId: entry.studentId, error: err.message });
    }
  }
  await logAction(userId, "bulk_enter_marks", "marks", `${assessmentId}_${subjectCode}`);
  return results;
}
