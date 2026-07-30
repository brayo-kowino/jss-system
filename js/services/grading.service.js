// CBC Grading & Position Engine.
//
// Turns raw marks (already captured per-assessment in `marks`, see
// marks.service.js) into the numbers a report card needs:
//   - per subject: weighted average across that term's assessments, CBC
//     grade + points + remark (from school_settings.gradingScale), and the
//     student's rank in that subject within the class
//   - per student: total marks, mean marks, mean grade, total points, and
//     overall class position
//   - per pathway (STEM / Social Sciences / Arts & Sports Science, as
//     assigned per-subject in Subject Management): average % and points
//
// Nothing here is persisted until `saveResults` is called — Compute is a
// read-only preview; Save writes one doc per student to `results/` so the
// Report Card Generator (next module) can read it back and show deviation
// against a prior term without recomputing.
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { listSubjects, slugify } from "./academic.service.js";
import { listAssessments } from "./assessment.service.js";
import { listMarks } from "./marks.service.js";
import { listStudents } from "./student.service.js";
import { DEFAULT_GRADING_SCALE } from "./settings.service.js";

// ---------------------------------------------------------------- Grading --

// Returns a scale where every band definitely has a `points` value, filling
// in 8..1 (highest band first) for scales saved before Points existed.
function normalizeScale(scale) {
  const rows = (scale && scale.length ? scale : DEFAULT_GRADING_SCALE).slice();
  const needsFill = rows.some((r) => r.points === undefined || r.points === null || r.points === "");
  if (!needsFill) return rows;
  const sorted = [...rows].sort((a, b) => b.min - a.min);
  const withPoints = sorted.map((r, i) => ({ ...r, points: sorted.length - i }));
  // Preserve original order for display purposes elsewhere.
  return rows.map((r) => withPoints.find((w) => w.grade === r.grade) || r);
}

export function gradeFor(score, gradingScale) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const scale = normalizeScale(gradingScale);
  const band =
    scale.find((r) => score >= r.min && score <= r.max) ||
    (score > 100 ? scale.reduce((a, b) => (a.max > b.max ? a : b)) : scale.reduce((a, b) => (a.min < b.min ? a : b)));
  return { grade: band.grade, points: Number(band.points) || 0, remark: band.remark };
}

// Standard competition ranking (1, 2, 2, 4, ...) over a list of
// { key, value } — highest value first, ties share a rank.
function rank(entries) {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const positions = {};
  let lastValue = null;
  let lastRank = 0;
  sorted.forEach((entry, i) => {
    if (lastValue === null || entry.value < lastValue) {
      lastRank = i + 1;
      lastValue = entry.value;
    }
    positions[entry.key] = lastRank;
  });
  return positions;
}

// ---------------------------------------------------------------- Compute --

function termIndex(term, terms) {
  const i = (terms || []).indexOf(term);
  return i === -1 ? 0 : i;
}

// Previous chronological period, wrapping to the last term of the prior year.
function previousPeriod(academicYear, term, terms) {
  const idx = termIndex(term, terms);
  if (idx > 0) return { academicYear, term: terms[idx - 1] };
  const yearNum = Number(academicYear);
  const prevYear = Number.isFinite(yearNum) ? String(yearNum - 1) : academicYear;
  return { academicYear: prevYear, term: terms[terms.length - 1] };
}

export function resultId(academicYear, term, grade, stream, studentId) {
  return `${slugify(academicYear)}_${slugify(term)}_${slugify(grade)}_${slugify(stream || "all")}_${studentId}`;
}

/**
 * Computes grading + positions for one class (grade, optionally a single
 * stream) in one academicYear/term.
 *
 * @returns {Promise<{ students: object[], subjectsUsed: object[], meta: object }>}
 */
export async function computeClassResults({ grade, stream, academicYear, term, gradingScale }) {
  if (!grade || !academicYear || !term) throw new Error("Grade, academic year, and term are required.");

  const [allSubjects, allAssessments, allStudents] = await Promise.all([
    listSubjects(),
    listAssessments(),
    listStudents(),
  ]);

  const relevantAssessments = allAssessments.filter(
    (a) => a.academicYear === academicYear && a.term === term && (!a.grades?.length || a.grades.includes(grade))
  );

  const roster = allStudents
    .filter((s) => s.grade === grade && (!stream || s.stream === stream) && s.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  if (!relevantAssessments.length) {
    return { students: [], subjectsUsed: [], meta: { grade, stream, academicYear, term, noAssessments: true } };
  }
  if (!roster.length) {
    return { students: [], subjectsUsed: [], meta: { grade, stream, academicYear, term, noStudents: true } };
  }

  // marksIndex[assessmentId][subjectCode] = [{studentId, score}]
  const marksIndex = {};
  await Promise.all(
    relevantAssessments.flatMap((a) =>
      allSubjects.map(async (subj) => {
        const marks = await listMarks(a.id, subj.code);
        if (!marks.length) return;
        marksIndex[a.id] = marksIndex[a.id] || {};
        marksIndex[a.id][subj.code] = marks;
      })
    )
  );

  const subjectsUsed = allSubjects.filter((subj) =>
    relevantAssessments.some((a) => marksIndex[a.id]?.[subj.code]?.length)
  );

  // Per student per subject: weighted average across assessments that have
  // a mark for that student (weight-normalized, so a subject isn't unfairly
  // penalized just because e.g. the Endterm hasn't been marked yet).
  const perStudentSubjects = {}; // studentId -> { code: {average, grade, points, remark} }
  for (const student of roster) {
    perStudentSubjects[student.id] = {};
    for (const subj of subjectsUsed) {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const a of relevantAssessments) {
        const mark = marksIndex[a.id]?.[subj.code]?.find((m) => m.studentId === student.id);
        if (!mark) continue;
        const w = Number(a.weight) || 0;
        weightedSum += mark.score * w;
        weightTotal += w;
      }
      if (weightTotal <= 0) continue;
      const average = weightedSum / weightTotal;
      const g = gradeFor(average, gradingScale);
      perStudentSubjects[student.id][subj.code] = { average, ...g };
    }
  }

  // Subject positions: rank within class, per subject, among students who
  // have an average for it.
  for (const subj of subjectsUsed) {
    const entries = roster
      .filter((s) => perStudentSubjects[s.id][subj.code])
      .map((s) => ({ key: s.id, value: perStudentSubjects[s.id][subj.code].average }));
    const positions = rank(entries);
    for (const s of roster) {
      if (perStudentSubjects[s.id][subj.code]) {
        perStudentSubjects[s.id][subj.code].position = positions[s.id];
      }
    }
  }

  // Per-student totals + pathway breakdown.
  const summaries = {};
  for (const student of roster) {
    const subjectResults = subjectsUsed
      .filter((subj) => perStudentSubjects[student.id][subj.code])
      .map((subj) => ({ code: subj.code, name: subj.name, pathway: subj.pathway, ...perStudentSubjects[student.id][subj.code] }));

    const totalMarks = subjectResults.reduce((sum, s) => sum + s.average, 0);
    const totalOutOf = subjectResults.length * 100;
    const totalPoints = subjectResults.reduce((sum, s) => sum + s.points, 0);
    const meanMarks = subjectResults.length ? totalMarks / subjectResults.length : 0;
    const meanPoints = subjectResults.length ? totalPoints / subjectResults.length : 0;
    const meanGradeInfo = subjectResults.length ? gradeFor(meanMarks, gradingScale) : null;

    const pathwayMap = {};
    for (const s of subjectResults) {
      const key = s.pathway || "Unassigned";
      pathwayMap[key] = pathwayMap[key] || { pathway: key, subjects: [], points: 0, percentageSum: 0 };
      pathwayMap[key].subjects.push(s.code);
      pathwayMap[key].points += s.points;
      pathwayMap[key].percentageSum += s.average;
    }
    const pathwayBreakdown = Object.values(pathwayMap).map((p) => ({
      pathway: p.pathway,
      points: p.points,
      percentage: p.percentageSum / p.subjects.length,
      subjectCount: p.subjects.length,
    }));

    summaries[student.id] = {
      studentId: student.id,
      admissionNumber: student.admissionNumber,
      fullName: student.fullName,
      gender: student.gender || "",
      photoUrl: student.photoUrl || "",
      subjects: subjectResults,
      totalMarks,
      totalOutOf,
      totalPoints,
      meanMarks,
      meanPoints,
      meanGrade: meanGradeInfo?.grade || null,
      meanRemark: meanGradeInfo?.remark || null,
      pathwayBreakdown,
      classSize: roster.length,
    };
  }

  // Overall position: rank by mean marks, only among students with any score.
  const overallEntries = roster
    .filter((s) => summaries[s.id].subjects.length)
    .map((s) => ({ key: s.id, value: summaries[s.id].meanMarks }));
  const overallPositions = rank(overallEntries);
  for (const s of roster) {
    summaries[s.id].overallPosition = overallPositions[s.id] || null;
  }

  return {
    students: roster.map((s) => summaries[s.id]),
    subjectsUsed,
    meta: { grade, stream, academicYear, term, classSize: roster.length, assessmentsUsed: relevantAssessments.length },
  };
}

// ---------------------------------------------------------------- Persist --

export async function saveResults(userId, { grade, stream, academicYear, term }, students) {
  const batch = writeBatch(db);
  for (const s of students) {
    if (!s.subjects.length) continue; // nothing to save for a student with no marks yet
    const id = resultId(academicYear, term, grade, stream, s.studentId);
    batch.set(doc(db, "results", id), {
      studentId: s.studentId,
      admissionNumber: s.admissionNumber || "",
      fullName: s.fullName || "",
      gender: s.gender || "",
      photoUrl: s.photoUrl || "",
      grade,
      stream: stream || "",
      academicYear,
      term,
      subjects: s.subjects,
      totalMarks: s.totalMarks,
      totalOutOf: s.totalOutOf,
      totalPoints: s.totalPoints,
      meanMarks: s.meanMarks,
      meanPoints: s.meanPoints,
      meanGrade: s.meanGrade,
      meanRemark: s.meanRemark,
      pathwayBreakdown: s.pathwayBreakdown,
      overallPosition: s.overallPosition,
      classSize: s.classSize,
      computedBy: userId,
      computedAt: serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  await logAction(userId, "compute_results", "results", `${grade}_${stream || "all"}_${academicYear}_${term}`);
}

export async function listResultsByPeriod({ grade, stream, academicYear, term }) {
  const snap = await getDocs(
    query(
      collection(db, "results"),
      where("grade", "==", grade),
      where("academicYear", "==", academicYear),
      where("term", "==", term)
    )
  );
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (stream) docs = docs.filter((d) => d.stream === stream);
  return docs.sort((a, b) => (a.overallPosition || 999) - (b.overallPosition || 999));
}

export async function getSavedResult(studentId, academicYear, term, grade, stream) {
  const id = resultId(academicYear, term, grade, stream, studentId);
  const snap = await getDocs(query(collection(db, "results"), where("studentId", "==", studentId)));
  const match = snap.docs.find((d) => d.id === id);
  return match ? { id: match.id, ...match.data() } : null;
}

export async function updateResultRemarks(userId, resultDocId, { teacherRemark, principalRemark }) {
  const patch = { updatedAt: serverTimestamp() };
  if (teacherRemark !== undefined) patch.teacherRemark = teacherRemark;
  if (principalRemark !== undefined) patch.principalRemark = principalRemark;
  await updateDoc(doc(db, "results", resultDocId), patch);
  await logAction(userId, "update_remarks", "results", resultDocId);
}

export async function getPreviousResult(studentId, grade, stream, academicYear, term, terms) {
  const { academicYear: prevYear, term: prevTerm } = previousPeriod(academicYear, term, terms);
  return getSavedResult(studentId, prevYear, prevTerm, grade, stream);
}

export async function listResultsForStudent(studentId) {
  const snap = await getDocs(query(collection(db, "results"), where("studentId", "==", studentId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
