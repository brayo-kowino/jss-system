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
import { listMarksByAssessment } from "./marks.service.js";
import { listStudents } from "./student.service.js";
import { DEFAULT_GRADING_SCALE } from "./settings.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId, toDate } from "../utils.js";

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

// Every compute now ranks each student in BOTH scopes at once - within
// their own stream (classPosition/streamClassSize) and across the whole
// grade (overallPosition/classSize) - so a single Compute+Save covers
// every stream plus the whole-grade view with no re-fetching. These
// helpers just pick which pair of numbers to show; pass an explicit
// boolean for which scope is currently being *viewed* (e.g. a stream is
// selected in the picker) rather than inferring it from a result's own
// `stream` field, since a saved result now always carries a real stream.
export function positionScopeLabel(isClassScope) {
  return isClassScope ? "Class Position" : "Overall Position";
}
export function positionScopeTag(isClassScope) {
  return isClassScope ? "Class" : "Overall";
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

// Ranks the same set of entries two ways in one pass: `overall` against
// every entry regardless of group, and `byGroup` against only the other
// entries sharing that entry's `group` (here, stream). This is what lets
// one compute produce both "Class Position" and "Overall Position" for
// every student without querying per stream.
function rankBothScopes(entries) {
  const overall = rank(entries);
  const groups = {};
  for (const e of entries) {
    (groups[e.group || ""] = groups[e.group || ""] || []).push(e);
  }
  const byGroup = {};
  for (const key of Object.keys(groups)) Object.assign(byGroup, rank(groups[key]));
  return { overall, byGroup };
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

// reportMode is part of the ID (not just a field) so Midterm, Endterm, and
// Average saves for the same year/term/class/student are three distinct
// documents instead of one overwriting another - a school saves a Midterm
// report, then later saves the Endterm/Average report for the same term,
// and both need to still be there for report cards and history.
//
// Stream is NOT part of the ID: one Compute+Save covers the whole grade
// (every stream) in a single pass, and each student's doc carries both
// their class-within-stream ranking and their grade-wide ranking (see
// computeClassResults). That's what avoids running Compute+Save once per
// stream plus once more for "all streams" - three-plus round trips to
// Firestore for what is really one dataset.
export function resultId(academicYear, term, grade, studentId, reportMode = "average") {
  return scopedId(getCurrentSchoolId(), slugify(academicYear), slugify(term), slugify(grade), slugify(reportMode || "average"), studentId);
}

// Canonical display order for the three report modes, used anywhere they're
// listed together (saved-runs summaries, tabs, etc).
export const REPORT_MODES = ["midterm", "endterm", "average"];

/**
 * Computes grading + positions for one whole grade (every stream at once)
 * in one academicYear/term. Every student gets ranked two ways in the same
 * pass - classPosition (within their own stream) and overallPosition
 * (across the whole grade) - so a single compute/save serves every
 * stream's class report and the whole-grade report; nothing needs to be
 * recomputed per stream.
 *
 * @returns {Promise<{ students: object[], subjectsUsed: object[], meta: object }>}
 */
export async function computeClassResults({ grade, academicYear, term, gradingScale, reportMode = "average" }) {
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
    .filter((s) => s.grade === grade && s.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  if (!relevantAssessments.length) {
    return { students: [], subjectsUsed: [], meta: { grade, academicYear, term, noAssessments: true } };
  }
  if (!roster.length) {
    return { students: [], subjectsUsed: [], meta: { grade, academicYear, term, noStudents: true } };
  }

  // marksIndex[assessmentId][subjectCode] = [{studentId, score}]
  // Fetched from allTermAssessments (not the reportMode-filtered
  // relevantAssessments) so Midterm/Endterm reference marks are available
  // for display regardless of which Report Mode is selected.
  //
  // One listMarksByAssessment() call per assessment (already used - and
  // cached - by the Assessments page) instead of one listMarks() call per
  // assessment×subject pair: a class with 5 assessments and 10 subjects
  // used to fire 50 queries here, now it fires 5. Marks are grouped by
  // subjectCode client-side from that single per-assessment fetch.
  const marksIndex = {};
  const marksByAssessment = await Promise.all(
    allTermAssessments.map((a) => listMarksByAssessment(a.id))
  );
  allTermAssessments.forEach((a, i) => {
    for (const mark of marksByAssessment[i]) {
      if (!mark.subjectCode) continue;
      marksIndex[a.id] = marksIndex[a.id] || {};
      (marksIndex[a.id][mark.subjectCode] = marksIndex[a.id][mark.subjectCode] || []).push(mark);
    }
  });

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

  // Subject positions: rank per subject among students who have an
  // average for it, both within the student's own stream (classPosition)
  // and across the whole grade (position) - same reasoning as the overall
  // ranking below.
  for (const subj of subjectsUsed) {
    const entries = roster
      .filter((s) => perStudentSubjects[s.id][subj.code])
      .map((s) => ({ key: s.id, value: perStudentSubjects[s.id][subj.code].average, group: s.stream || "" }));
    const { overall, byGroup } = rankBothScopes(entries);
    for (const s of roster) {
      if (perStudentSubjects[s.id][subj.code]) {
        perStudentSubjects[s.id][subj.code].position = overall[s.id];
        perStudentSubjects[s.id][subj.code].classPosition = byGroup[s.id];
      }
    }
  }

  // Count of active roster members per stream, so a stream-scoped
  // position can be shown as "x/streamClassSize" - same convention as the
  // grade-wide classSize below (the denominator is everyone active in
  // that scope, not just students with a score).
  const streamSizes = {};
  for (const s of roster) streamSizes[s.stream || ""] = (streamSizes[s.stream || ""] || 0) + 1;

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
      stream: student.stream || "",
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
      streamClassSize: streamSizes[student.stream || ""] || 0,
      hasIncompleteSubject,
    };
  }

  // Position: rank by total marks, only among students with any score -
  // both overall (whole grade) and classPosition (within the student's own
  // stream), computed together so a report picking "Grade 7 Blue" and one
  // picking "All streams" both read off this same compute/save.
  const overallEntries = roster
    .filter((s) => summaries[s.id].subjects.length)
    .map((s) => ({ key: s.id, value: summaries[s.id].totalMarks, group: s.stream || "" }));
  const { overall: overallPositions, byGroup: classPositions } = rankBothScopes(overallEntries);
  for (const s of roster) {
    summaries[s.id].overallPosition = overallPositions[s.id] || null;
    summaries[s.id].classPosition = classPositions[s.id] || null;
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
      grade, academicYear, term, classSize: roster.length,
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

export async function saveResults(userId, { grade, academicYear, term, reportMode }, students) {
  const batch = writeBatch(db);
  for (const s of students) {
    if (!s.subjects.length) continue; // nothing to save for a student with no marks yet
    const id = resultId(academicYear, term, grade, s.studentId, reportMode);
    batch.set(doc(db, "results", id), {
      schoolId: getCurrentSchoolId(),
      studentId: s.studentId,
      admissionNumber: s.admissionNumber || "",
      kcpeNumber: s.kcpeNumber || "",
      fullName: s.fullName || "",
      gender: s.gender || "",
      photoUrl: s.photoUrl || "",
      grade,
      stream: s.stream || "",
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
      classPosition: s.classPosition,
      streamClassSize: s.streamClassSize,
      computedBy: userId,
      computedAt: serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  await logAction(userId, "compute_results", "results", `${grade}_${academicYear}_${term}`);
}

// reportMode is an optional client-side filter (not a Firestore `where`, to
// avoid requiring a new composite index) - pass it to get just that mode's
// saved results, or omit it to get every mode saved for this period (e.g.
// to build the saved-runs summary). `stream` is likewise a client-side
// filter down to one stream's students; omit it (or pass "") to get the
// whole grade - all from the SAME saved dataset, since one Compute+Save
// now covers every stream at once (see computeClassResults). Sorted by
// whichever position matches what was asked for: classPosition when a
// stream was requested, overallPosition otherwise.
export async function listResultsByPeriod({ grade, stream, academicYear, term, reportMode }) {
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
  if (stream) docs = docs.filter((d) => (d.stream || "") === stream);
  if (reportMode) docs = docs.filter((d) => (d.reportMode || "average") === reportMode);
  const positionField = stream ? "classPosition" : "overallPosition";
  return docs.sort((a, b) => (a[positionField] ?? 999) - (b[positionField] ?? 999));
}

// Summarizes what's already been saved for a grade/year/term, one entry
// per report mode that has at least one saved student, so the Grading and
// Report Card screens can show "Midterm: saved, 32 students, 5 Aug" etc
// before anyone computes/saves/loads anything. Grade-wide, not
// per-stream - one Compute+Save now covers every stream, so there's only
// ever one "saved" state per grade/year/term/mode to report on.
export async function listSavedModesForPeriod({ grade, academicYear, term }) {
  const results = await listResultsByPeriod({ grade, academicYear, term });
  const groups = {};
  for (const r of results) {
    const mode = r.reportMode || "average";
    const g = (groups[mode] = groups[mode] || {
      reportMode: mode,
      count: 0,
      classSize: r.classSize || 0,
      latestComputedAt: null,
      computedBy: "",
    });
    g.count += 1;
    const ts = toDate(r.computedAt);
    if (ts && (!g.latestComputedAt || ts > g.latestComputedAt)) {
      g.latestComputedAt = ts;
      g.computedBy = r.computedBy || g.computedBy;
    }
  }
  return REPORT_MODES.map((mode) => groups[mode]).filter(Boolean);
}

export async function getSavedResult(studentId, academicYear, term, grade, reportMode = "average") {
  const id = resultId(academicYear, term, grade, studentId, reportMode);
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

// Prefers a prior-period saved result in the same report mode (Midterm vs
// Midterm, Average vs Average); if that exact mode wasn't saved for the
// prior period, falls back to whichever mode was saved (preferring
// Average, since that's the closest thing to a "final" result) rather than
// showing no comparison at all. Not stream-scoped: every saved result
// carries both classPosition and overallPosition, so the caller picks
// whichever pair matches the scope currently being viewed.
export async function getPreviousResult(studentId, grade, academicYear, term, terms, reportMode = "average") {
  const { academicYear: prevYear, term: prevTerm } = previousPeriod(academicYear, term, terms);
  const exact = await getSavedResult(studentId, prevYear, prevTerm, grade, reportMode);
  if (exact) return exact;
  const all = await listResultsForStudent(studentId);
  const candidates = all.filter(
    (r) => r.academicYear === prevYear && r.term === prevTerm && r.grade === grade
  );
  if (!candidates.length) return null;
  return candidates.find((r) => (r.reportMode || "average") === "average") || candidates[0];
}

// Picks one "headline" result to represent a student's most recent term,
// out of a list that may now contain a few saved docs for that same term
// (one per report mode - Midterm/Endterm/Average; no longer one per
// stream, since a single Compute+Save covers the whole grade). Most
// recent term first, then prefers the Average mode, since that's the
// closest thing to a single official figure for a "latest result" summary.
export function pickHeadlineResult(results) {
  if (!results?.length) return null;
  const latestKey = results.reduce((max, r) => {
    const key = `${r.academicYear}${r.term}`;
    return key > max ? key : max;
  }, "");
  const candidates = results.filter((r) => `${r.academicYear}${r.term}` === latestKey);
  return candidates.find((r) => (r.reportMode || "average") === "average") || candidates[0];
}

export async function listResultsForStudent(studentId) {
  const snap = await getDocs(
    query(collection(db, "results"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}