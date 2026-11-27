// Assessment Management.
// assessments/{id}: { schoolId, name, type, weight, maxScore, contributionMode,
//   date, academicYear, term,
//   grades: string[] (grade names this assessment is administered to, empty = all grades),
//   subjects: string[] (subject codes this assessment applies to, empty = all subjects -
//     use this to leave an assessment out of subjects that don't sit it, e.g. no
//     Assignment for CRE, no Practical for a non-science subject),
//   subjectMaxScores: { [subjectCode]: number } (per-subject override of `maxScore` -
//     e.g. Agriculture CAT 1 out of 30 while Math CAT 1 (same occasion, same
//     weight/date) is out of 40; a subject with no entry here just uses the
//     assessment's default `maxScore`),
//   status: "open" | "locked", createdAt, updatedAt }
//
// `maxScore` is what this assessment was actually marked out of (e.g. a CAT
// sat out of 30, or an exam out of 100). Marks Entry captures raw scores
// against this number - or against `subjectMaxScores[subjectCode]` when that
// subject has an override, via `getAssessmentMaxScore` below. Because
// weighted-mode contribution is always converted to a % of whatever the mark
// was actually scored out of, subjects can freely use different max scores
// under the very same weight without throwing off the blended average.
//
// `contributionMode` controls how this assessment's marks feed into the
// final subject result (see grading.service.js#computeClassResults):
//   - "weighted" (default): score is converted to a percentage of maxScore.
//     `weight` on the stored doc is not what's actually used, though - it's
//     overwritten every compute by computeClassResults based on the Report
//     Mode chosen on the Grading & Positions page (Final/Average splits
//     evenly across the term's weighted assessments; Midterm/Endterm Only
//     force just that type to 100%). The field is kept on the schema for
//     backward compatibility but is not editable from the Assessments UI.
//   - "direct": the raw score is added straight onto the subject total,
//     untouched by weight or normalization - for things like bonus/practical
//     marks a teacher wants tacked on as-is rather than blended in by %.
//
// "locked" gates Marks Entry - once locked, no further marks can be
// entered/edited against this assessment until an admin reopens it.
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { cached, invalidate } from "./query-cache.js";

export const ASSESSMENT_TYPES = ["CAT", "Assignment", "Midterm", "Endterm", "Project", "Other"];
export const DEFAULT_ASSESSMENT_MAX_SCORE = 100;
export const CONTRIBUTION_MODES = [
  { value: "weighted", label: "Weighted % (blended in automatically via Report Mode)" },
  { value: "direct", label: "Add directly (raw marks added straight onto the total)" },
];

function assessmentsCacheKey() {
  return `assessments:${getCurrentSchoolId()}`;
}

export async function listAssessments() {
  // Read by Marks Entry, Grading, Report Cards and the Dashboard - a
  // shorter TTL than classes/subjects since status (open/locked) is
  // meant to be seen promptly once an admin flips it.
  return cached(assessmentsCacheKey(), 2 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "assessments"), where("schoolId", "==", getCurrentSchoolId())));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  });
}

export async function getAssessment(id) {
  const snap = await getDoc(doc(db, "assessments", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

// Resolves the max score marks should be entered against for one subject
// under this assessment: the subject's override if it has one, otherwise
// the assessment's own default `maxScore`.
export function getAssessmentMaxScore(assessment, subjectCode) {
  const override = assessment?.subjectMaxScores?.[subjectCode];
  if (override !== undefined && override !== null && override !== "" && Number.isFinite(Number(override)) && Number(override) > 0) {
    return Number(override);
  }
  return Number(assessment?.maxScore) || DEFAULT_ASSESSMENT_MAX_SCORE;
}

export async function addAssessment(userId, data) {
  const ref_ = await addDoc(collection(db, "assessments"), {
    schoolId: getCurrentSchoolId(),
    name: data.name.trim(),
    type: data.type,
    weight: Number(data.weight) || 0,
    maxScore: Number(data.maxScore) || DEFAULT_ASSESSMENT_MAX_SCORE,
    contributionMode: data.contributionMode === "direct" ? "direct" : "weighted",
    date: data.date || "",
    academicYear: data.academicYear || "",
    term: data.term || "",
    grades: data.grades || [],
    subjects: data.subjects || [],
    subjectMaxScores: data.subjectMaxScores || {},
    status: "open",
    createdAt: serverTimestamp(),
  });
  invalidate(assessmentsCacheKey());
  await logAction(userId, "create_assessment", "assessments", ref_.id);
  return ref_.id;
}

export async function updateAssessment(userId, id, data) {
  const existing = await getAssessment(id);
  if (existing?.status === "locked") {
    throw new Error("This assessment is locked. Reopen it before editing.");
  }
  await updateDoc(doc(db, "assessments", id), {
    name: data.name.trim(),
    type: data.type,
    weight: Number(data.weight) || 0,
    maxScore: Number(data.maxScore) || DEFAULT_ASSESSMENT_MAX_SCORE,
    contributionMode: data.contributionMode === "direct" ? "direct" : "weighted",
    date: data.date || "",
    academicYear: data.academicYear || "",
    term: data.term || "",
    grades: data.grades || [],
    subjects: data.subjects || [],
    subjectMaxScores: data.subjectMaxScores || {},
    updatedAt: serverTimestamp(),
  });
  invalidate(assessmentsCacheKey());
  await logAction(userId, "update_assessment", "assessments", id);
}

export async function setAssessmentStatus(userId, id, status) {
  await updateDoc(doc(db, "assessments", id), { status, updatedAt: serverTimestamp() });
  invalidate(assessmentsCacheKey());
  await logAction(userId, status === "locked" ? "lock_assessment" : "reopen_assessment", "assessments", id);
}

export async function deleteAssessment(userId, id) {
  const marksSnap = await getDocs(
    query(collection(db, "marks"), where("schoolId", "==", getCurrentSchoolId()), where("assessmentId", "==", id))
  );
  if (marksSnap.size > 0) {
    throw new Error(`Cannot delete: ${marksSnap.size} mark record(s) already exist for this assessment.`);
  }
  await deleteDoc(doc(db, "assessments", id));
  invalidate(assessmentsCacheKey());
  await logAction(userId, "delete_assessment", "assessments", id);
}