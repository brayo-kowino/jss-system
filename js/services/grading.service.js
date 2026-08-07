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
// Nothing here is persisted until `saveResults` is called - Compute is a
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
import { listAssessments, getAssessmentMaxScore } from "./assessment.service.js";
import { listMarks } from "./marks.service.js";
import { listStudents } from "./student.service.js";
import { DEFAULT_GRADING_SCALE } from "./settings.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";

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
  // Bands are entered with inclusive min/max (e.g. 58-74, 75-89), but
  // computed averages are decimals (69.61, 74.3, ...) that can land in the
  // gap between one band's max and the next band's min - a strict
  // min<=score<=max match misses those and used to fall back to the lowest
  // band, silently showing BE2 for a score like 69.61. Matching on "highest
  // band whose min the score clears" has no such gaps and needs no
  // fallback: the top band catches anything at or above its min (including
  // scores over 100), and the bottom band catches everything else.
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find((r) => score >= r.min) || sorted[sorted.length - 1];
  return { grade: band.grade, points: Number(band.points) || 0, remark: band.remark };
}

// Official label for a saved/computed result's Report Mode - shown as-is
// on the printed report card, so wording stays plain and unambiguous for
// an official school document (no "Only" / "All" qualifiers).
export function reportModeLabel(mode) {
  if (mode === "midterm") return "MIDTERM";
  if (mode === "endterm") return "ENDTERM";
  return "ENDTERM AVG";
}
// { key, value } - highest value first, ties share a rank.
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
  return scopedId(getCurrentSchoolId(), slugify(academicYear), slugify(term), slugify(grade), slugify(stream || "all"), studentId);
}

/**
 * Computes grading + positions for one class (grade, optionally a single
 * stream) in one academicYear/term.
 *
 * @returns {Promise<{ students: object[], subjectsUsed: object[], meta: object }>}
 */
export async function computeClassResults({ grade, stream, academicYear, term, gradingScale, reportMode = "average" }) {
  if (!grade || !academicYear || !term) throw new Error("Grade, academic year, and term are required.");

  const [allSubjects, allAssessments, allStudents] = await Promise.all([
    listSubjects(),
    listAssessments(),
    listStudents(),
  ]);

  let relevantAssessments = allAssessments.filter(
    (a) => a.academicYear === academicYear && a.term === term && (!a.grades?.length || a.grades.includes(grade))
  );
  // Kept pristine (pre reportMode filtering/weight-mutation) so Midterm and
  // Endterm raw scores can still be shown on the report card as reference
  // columns even when the selected Report Mode only counts one of them (or
  // averages across everything) toward the final Score.
  const allTermAssessments = relevantAssessments.slice();

  // Dynamic weighting: teachers mark every exam out of 100 and never touch
  // weights - how those exams combine into the term's final mark depends on
  // which report is being generated, so the weighting is derived here in
  // memory rather than requiring manual weight edits per assessment. This
  // only mutates the assessment objects held in this function's scope
  // (fetched fresh from listAssessments above); nothing is written back to
  // the database, so the underlying assessment records stay untouched.
  if (reportMode === "midterm") {
    relevantAssessments = relevantAssessments.filter((a) => a.type === "Midterm");
    for (const a of relevantAssessments) a.weight = 100;
  } else if (reportMode === "endterm") {
    relevantAssessments = relevantAssessments.filter((a) => a.type === "Endterm");
    for (const a of relevantAssessments) a.weight = 100;
  } else if (reportMode === "average") {
    const count = relevantAssessments.length;
    if (count > 0) {
      for (const a of relevantAssessments) a.weight = 100 / count;
    }
  }

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
  // Fetched from allTermAssessments (not the reportMode-filtered
  // relevantAssessments) so Midterm/Endterm reference marks are available
  // for display regardless of which Report Mode is selected.
  const marksIndex = {};
  await Promise.all(
    allTermAssessments.flatMap((a) =>
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
  // penalized just because e.g. the Endterm hasn't been marked yet), plus
  // anything marked "direct" added straight on top - see
  // assessment.service.js for contributionMode semantics.
  // `expectedWeightTotal` is what the term's *weighted* assessments should
  // add up to - used to flag results as partial when weight actually marked
  // falls short of that, rather than silently presenting them as final.
  // `expectedCapacityTotal` adds the direct assessments' Max Scores on top,
  // since a direct assessment's Max Score is really "this is worth up to N
  // of the final 100 points" - the two portions together should land on 100
  // for the term's final mark to be a true /100 without any code-level cap.
  // An assessment only applies to a subject if that subject is checked in
  // its Subjects list (empty list = every subject) - so e.g. an Assignment
  // set up without Practical work never shows up as "missing" for CRE.
  // Each subject therefore gets its own weighted/direct split and its own
  // expected weight total, computed once and cached per subject code.
  const assessmentsBySubject = {};
  function assessmentsForSubject(code) {
    if (assessmentsBySubject[code]) return assessmentsBySubject[code];
    const subjRelevant = relevantAssessments.filter((a) => !a.subjects?.length || a.subjects.includes(code));
    const weightedAssessments = subjRelevant.filter((a) => (a.contributionMode || "weighted") !== "direct");
    const directAssessments = subjRelevant.filter((a) => (a.contributionMode || "weighted") === "direct");
    const expectedWeightTotal = weightedAssessments.reduce((sum, a) => sum + (Number(a.weight) || 0), 0);
    const directMaxScoreTotal = directAssessments.reduce((sum, a) => sum + getAssessmentMaxScore(a, code), 0);
    const expectedCapacityTotal = expectedWeightTotal + directMaxScoreTotal;
    const info = { weightedAssessments, directAssessments, expectedWeightTotal, expectedCapacityTotal };
    assessmentsBySubject[code] = info;
    return info;
  }

  // Reference score for one assessment type (Midterm / Endterm) for one
  // student+subject, independent of the selected Report Mode - shown on
  // report cards as the MIDT/END columns so a reader can see both exams,
  // not just whichever one (or blend) the Score column reflects. Assumes
  // the normal one-Midterm-exam / one-Endterm-exam-per-term setup; if a
  // school has more than one assessment of the same type for a subject,
  // this averages their percentages equally.
  function referenceScoreForType(subj, studentId, type) {
    const typeAssessments = allTermAssessments.filter(
      (a) => a.type === type && (!a.subjects?.length || a.subjects.includes(subj.code))
    );
    if (!typeAssessments.length) return null;
    const weighted = typeAssessments.filter((a) => (a.contributionMode || "weighted") !== "direct");
    const direct = typeAssessments.filter((a) => (a.contributionMode || "weighted") === "direct");
    let sum = 0, count = 0;
    for (const a of weighted) {
      const mark = marksIndex[a.id]?.[subj.code]?.find((m) => m.studentId === studentId);
      if (!mark) continue;
      const pct = mark.maxScore ? (mark.score / mark.maxScore) * 100 : mark.score;
      sum += pct;
      count += 1;
    }
    let directSum = 0, directCount = 0;
    for (const a of direct) {
      const mark = marksIndex[a.id]?.[subj.code]?.find((m) => m.studentId === studentId);
      if (!mark) continue;
      directSum += Number(mark.score) || 0;
      directCount += 1;
    }
    if (count === 0 && directCount === 0) return null;
    return (count ? sum / count : 0) + directSum;
  }

  const perStudentSubjects = {}; // studentId -> { code: {average, grade, points, remark} }
  for (const student of roster) {
    perStudentSubjects[student.id] = {};
    for (const subj of subjectsUsed) {
      const { weightedAssessments, directAssessments, expectedWeightTotal } = assessmentsForSubject(subj.code);
      let weightedSum = 0;
      let weightTotal = 0;
      for (const a of weightedAssessments) {
        const mark = marksIndex[a.id]?.[subj.code]?.find((m) => m.studentId === student.id);
        if (!mark) continue;
        const w = Number(a.weight) || 0;
        const pct = mark.maxScore ? (mark.score / mark.maxScore) * 100 : mark.score;
        weightedSum += pct * w;
        weightTotal += w;
      }
      let directSum = 0;
      let directCount = 0;
      for (const a of directAssessments) {
        const mark = marksIndex[a.id]?.[subj.code]?.find((m) => m.studentId === student.id);
        if (!mark) continue;
        directSum += Number(mark.score) || 0;
        directCount += 1;
      }
      const directExpected = directAssessments.length;
      if (weightTotal <= 0 && directCount <= 0) continue;
      // rawAvgPct is the pro-rated 0-100 average among the weighted
      // assessments actually marked so far (so a subject isn't unfairly
      // penalized just because e.g. the Endterm hasn't been marked yet).
      // It's then scaled down to `portionPoints` - this weighted group's
      // allotted share of the final /100 (expectedWeightTotal points) -
      // rather than treated as if it were the whole grade. Direct-add
      // assessments' raw scores are already bounded points on that same
      // /100 scale, so they're added on as-is.
      const rawAvgPct = weightTotal > 0 ? weightedSum / weightTotal : 0;
      const portionPoints = rawAvgPct * (expectedWeightTotal / 100);
      const average = portionPoints + directSum;
      const g = gradeFor(average, gradingScale);
      const incomplete = (weightTotal < expectedWeightTotal - 0.01) || (directCount < directExpected);
      perStudentSubjects[student.id][subj.code] = {
        average, ...g,
        weightUsed: weightTotal, weightExpected: expectedWeightTotal,
        directAdded: directSum, directCount, directExpected,
        incomplete,
        midtScore: referenceScoreForType(subj, student.id, "Midterm"),
        endScore: referenceScoreForType(subj, student.id, "Endterm"),
      };
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

    const hasIncompleteSubject = subjectResults.some((s) => s.incomplete);

    summaries[student.id] = {
      studentId: student.id,
      admissionNumber: student.admissionNumber,
      kcpeNumber: student.kcpeNumber || "",
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
      hasIncompleteSubject,
    };
  }

  // Overall position: rank by total marks, only among students with any score.
  const overallEntries = roster
    .filter((s) => summaries[s.id].subjects.length)
    .map((s) => ({ key: s.id, value: summaries[s.id].totalMarks }));
  const overallPositions = rank(overallEntries);
  for (const s of roster) {
    summaries[s.id].overallPosition = overallPositions[s.id] || null;
  }

  const subjectsIncomplete = subjectsUsed
    .map((subj) => {
      const { weightedAssessments, directAssessments } = assessmentsForSubject(subj.code);
      const missingWeighted = weightedAssessments.filter((a) => !marksIndex[a.id]?.[subj.code]?.length);
      const missingDirect = directAssessments.filter((a) => !marksIndex[a.id]?.[subj.code]?.length);
      const weightMissing = missingWeighted.reduce((sum, a) => sum + (Number(a.weight) || 0), 0);
      const missing = [...missingWeighted, ...missingDirect];
      return missing.length ? { code: subj.code, name: subj.name, missingAssessments: missing.map((a) => a.name), weightMissing } : null;
    })
    .filter(Boolean);

  // Each subject can have its own line-up of assessments (see
  // assessmentsForSubject above), so "does this add up to 100" is checked
  // per subject rather than once for the whole class.
  const subjectWeightTotals = subjectsUsed.map((subj) => {
    const { weightedAssessments, directAssessments, expectedWeightTotal, expectedCapacityTotal } = assessmentsForSubject(subj.code);
    return {
      code: subj.code,
      name: subj.name,
      expectedWeightTotal,
      expectedCapacityTotal,
      mismatched: Math.abs(expectedCapacityTotal - 100) > 0.01,
      assessments: [...weightedAssessments, ...directAssessments].map((a) => ({
        name: a.name, weight: Number(a.weight) || 0, maxScore: getAssessmentMaxScore(a, subj.code),
        contributionMode: a.contributionMode || "weighted",
      })),
    };
  });

  return {
    students: roster.map((s) => summaries[s.id]),
    subjectsUsed,
    meta: {
      grade, stream, academicYear, term, classSize: roster.length,
      reportMode,
      assessmentsUsed: relevantAssessments.length,
      relevantAssessments: relevantAssessments.map((a) => ({
        name: a.name, type: a.type, weight: Number(a.weight) || 0,
        maxScore: Number(a.maxScore) || 100,
        contributionMode: a.contributionMode || "weighted",
      })),
      subjectWeightTotals,
      weightWarning: subjectWeightTotals.some((s) => s.mismatched),
      subjectsIncomplete,
    },
  };
}

// ---------------------------------------------------------------- Persist --

export async function saveResults(userId, { grade, stream, academicYear, term, reportMode }, students) {
  const batch = writeBatch(db);
  for (const s of students) {
    if (!s.subjects.length) continue; // nothing to save for a student with no marks yet
    const id = resultId(academicYear, term, grade, stream, s.studentId);
    batch.set(doc(db, "results", id), {
      schoolId: getCurrentSchoolId(),
      studentId: s.studentId,
      admissionNumber: s.admissionNumber || "",
      kcpeNumber: s.kcpeNumber || "",
      fullName: s.fullName || "",
      gender: s.gender || "",
      photoUrl: s.photoUrl || "",
      grade,
      stream: stream || "",
      academicYear,
      term,
      reportMode: reportMode || "average",
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
      where("schoolId", "==", getCurrentSchoolId()),
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
  const snap = await getDocs(
    query(collection(db, "results"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
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
  const snap = await getDocs(
    query(collection(db, "results"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}