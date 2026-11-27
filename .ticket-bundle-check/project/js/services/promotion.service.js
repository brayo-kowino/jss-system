// Planning is read-only. Each save transaction pairs student changes with the
// school's saved progress, so an interrupted run resumes at its next learner.
import {
  arrayUnion, collection, doc, getDocFromServer, getDocsFromServer, query,
  runTransaction, serverTimestamp, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { getCurrentProfile, getCurrentSchoolId } from "./auth.service.js";
import { DEFAULT_SETTINGS } from "./settings.service.js";
import { invalidate } from "./query-cache.js";

const DEFAULT_TERMS = DEFAULT_SETTINGS.terms;
const MAX_CHUNK_WRITES = 200;

function gradeLevel(grade) {
  const match = /^(pp|grade|form)\s*(\d+)$/i.exec(grade);
  return match ? { type: match[1].toLowerCase(), level: Number(match[2]) } : null;
}

function compareGrades(a, b) {
  const order = ["pp", "grade", "form"];
  const first = gradeLevel(a);
  const second = gradeLevel(b);
  const difference = (first ? order.indexOf(first.type) : order.length) -
    (second ? order.indexOf(second.type) : order.length);
  return difference || String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function promotionGrades(classes) {
  return [...new Set(classes.map(({ grade }) => grade).filter(Boolean))].sort(compareGrades);
}

export function buildGradeProgression(classes) {
  const grades = promotionGrades(classes);
  const tracks = [
    grades.filter((grade) => ["pp", "grade"].includes(gradeLevel(grade)?.type)),
    grades.filter((grade) => gradeLevel(grade)?.type === "form"),
  ];
  // PP and Grade are consecutive. Forms are a separate track. A gap within
  // a track needs an administrator's decision.
  return Object.fromEntries(tracks.flatMap((track) => track.map((grade, index) => {
    const next = track[index + 1];
    if (!next) return [grade, null];
    const source = gradeLevel(grade);
    const destination = gradeLevel(next);
    const consecutive = source.type === destination.type
      ? destination.level === source.level + 1
      : source.type === "pp" && source.level === 2 && destination.type === "grade" && destination.level === 1;
    return [grade, consecutive ? next : undefined];
  })));
}

export function streamsForGrade(classes, grade) {
  return classes.find((item) => item.grade === grade)?.streams || [];
}

export function assignPromotionDestination(entry, classes, toGrade) {
  if (toGrade === null) return { ...entry, action: "graduate", toGrade: null, toStream: "", warning: "" };
  const streams = streamsForGrade(classes, toGrade);
  const toStream = streams.includes(entry.fromStream) ? entry.fromStream : streams[0] || "";
  const warning = streams.length && toStream !== entry.fromStream
    ? (entry.fromStream ? "Current stream is unavailable in this grade." : "Learner has no current stream.")
    : "";
  return { ...entry, action: "promote", toGrade, toStream, warning };
}

export function generatePromotionPlan(students, classes, { sourceGrade, destinationGrade } = {}) {
  const progression = buildGradeProgression(classes);
  const manual = sourceGrade !== undefined;
  const knownGrades = new Set(promotionGrades(classes));
  if (manual && (!knownGrades.has(sourceGrade) || (destinationGrade !== null && !knownGrades.has(destinationGrade)))) {
    throw new Error("Choose a valid source grade and destination.");
  }
  return students.filter((s) => s.status === "active" && (!manual || s.grade === sourceGrade)).map((student) => {
    const fromGrade = student.grade || "";
    const entry = { student, fromGrade, fromStream: student.stream || "", excluded: false };
    const toGrade = manual ? destinationGrade : Object.hasOwn(progression, fromGrade) ? progression[fromGrade] : undefined;
    if (toGrade === undefined) {
      const warning = knownGrades.has(fromGrade)
        ? "No automatic next grade. Choose a destination or keep this learner in their current class."
        : "Current grade is missing from Classes & Streams. Choose a destination or keep this learner in their current class.";
      return { ...entry, action: "unassigned", toGrade: null, toStream: "", warning };
    }
    return assignPromotionDestination(entry, classes, toGrade);
  }).sort((a, b) => compareGrades(a.fromGrade, b.fromGrade) ||
    (a.student.fullName || "").localeCompare(b.student.fullName || ""));
}

export function changesPlacement(entry) {
  return entry.action === "graduate" ||
    (entry.action === "promote" && (entry.fromGrade !== entry.toGrade || entry.fromStream !== entry.toStream));
}

export function isPromotionSeason(settings) {
  const terms = settings?.terms ?? DEFAULT_TERMS;
  return Boolean(terms.length && settings?.currentTerm === terms.at(-1));
}

export function promotionRollover(settings) {
  const year = String(settings.currentAcademicYear ?? "").trim();
  const terms = settings.terms ?? DEFAULT_TERMS;
  if (!isPromotionSeason(settings) || !/^[1-9]\d{3}$/.test(year) || year === "9999" || !terms[0]?.trim()) return null;
  const nextYear = String(Number(year) + 1);
  return {
    year: nextYear,
    term: terms[0],
  };
}

const schoolRef = (schoolId) => doc(db, "schools", schoolId);
const runRef = (schoolId) => doc(db, "schools", schoolId, "promotion_runs", "current");
const snapshotRows = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));

export async function loadPromotionWorkspace() {
  const schoolId = getCurrentSchoolId();
  const canSave = getCurrentProfile()?.role === "admin";
  if (!schoolId) throw new Error("Select a school to open Promotions.");
  const [school, classes, students, run] = await Promise.all([
    getDocFromServer(schoolRef(schoolId)),
    getDocsFromServer(query(collection(db, "classes"), where("schoolId", "==", schoolId))),
    getDocsFromServer(query(collection(db, "students"), where("schoolId", "==", schoolId))),
    canSave ? getDocFromServer(runRef(schoolId)) : null,
  ]);
  if (!school.exists()) throw new Error("School settings could not be found.");
  const job = run?.data();
  return {
    schoolId,
    canSave,
    settings: { ...DEFAULT_SETTINGS, ...school.data() },
    classes: snapshotRows(classes),
    students: snapshotRows(students),
    pendingRun: job?.status === "pending" ? job : null,
  };
}

function buildJob(plan, { runId, mode, schoolId, settings, classes }) {
  if (mode !== "auto" && mode !== "manual") throw new Error("Choose a promotion mode.");
  const rollover = mode === "auto" ? promotionRollover(settings) : null;
  if (mode === "auto" && !rollover) throw new Error("School-wide promotions require the final term and a valid academic year.");
  const year = String(settings.currentAcademicYear ?? "").trim();
  if (!/^[1-9]\d{3}$/.test(year)) throw new Error("Set a valid academic year in School Settings.");

  const classesByGrade = new Map(classes.map((item) => [item.grade, item]));
  const ids = new Set();
  const entries = [];
  for (const entry of plan) {
    if (entry.excluded) continue;
    const { student, fromGrade, fromStream, toGrade, toStream, action } = entry;
    if (action !== "graduate" && action !== "promote") throw new Error("Review learners with no destination before saving.");
    if (!changesPlacement(entry)) continue;
    if (!student?.id || (student.schoolId && student.schoolId !== schoolId) || ids.has(student.id)) {
      throw new Error("The reviewed plan contains an invalid or duplicate learner. Open Promotions again.");
    }
    const destination = action === "promote" ? classesByGrade.get(toGrade) : null;
    const streams = destination?.streams || [];
    if (action === "promote" && (!destination?.id || (streams.length ? !streams.includes(toStream) : toStream !== ""))) {
      throw new Error("The reviewed plan contains an invalid class or stream.");
    }
    ids.add(student.id);
    entries.push({ studentId: student.id, fromGrade, fromStream, toGrade, toStream, action, classId: destination?.id || "" });
  }
  if (!entries.length) throw new Error("Choose at least one learner to move or graduate.");
  // Leave space for the Firestore document encoding and the job's other fields.
  if (new TextEncoder().encode(JSON.stringify(entries)).length > 600_000) {
    throw new Error("This plan is too large to save safely. Contact support before moving this school year.");
  }
  return {
    id: runId, mode, year, term: settings.currentTerm || "", rollover, entries,
    total: entries.length, done: 0, promoted: 0, graduated: 0, skipped: 0,
    retained: plan.length - entries.length, status: "pending",
  };
}

function getChunk(job) {
  let writes = 0;
  let count = 0;
  for (let i = job.done; i < job.entries.length; i++) {
    // Leave room for graduation's immutable alumni doc and field transforms.
    writes += job.entries[i].action === "graduate" ? 4 : 1;
    if (writes > MAX_CHUNK_WRITES) break;
    count++;
  }
  return job.entries.slice(job.done, job.done + count);
}

function matchingRollover(job, settings) {
  const current = promotionRollover(settings);
  return current && current.year === job.rollover.year && current.term === job.rollover.term;
}

export async function commitPromotionPlan(userId, plan, options) {
  const { runId, onProgress, approvedSkips = [] } = options;
  const schoolId = getCurrentSchoolId();
  const profile = getCurrentProfile();
  if (!schoolId || schoolId !== options.schoolId || profile?.role !== "admin" || profile.uid !== userId) {
    throw new Error("Only an administrator for this school can save promotions.");
  }
  if (!runId) throw new Error("Open the promotion plan again before saving.");
  const proposed = plan ? buildJob(plan, options) : null;
  const skipIds = new Set(approvedSkips);
  const jobRef = runRef(schoolId);
  const settingsRef = schoolRef(schoolId);
  // Rules hide deleted class documents. Look up existing IDs before the
  // transaction so a deleted class can be reviewed as a conflict.
  const schoolFilter = where("schoolId", "==", schoolId);
  const [classSnapshot, feeSnapshot] = await Promise.all([
    getDocsFromServer(query(collection(db, "classes"), schoolFilter)),
    !proposed || proposed.entries.some(({ action }) => action === "graduate")
      ? getDocsFromServer(query(collection(db, "fees"), schoolFilter)) : null,
  ]);
  const existingClassIds = new Set(classSnapshot.docs.map(({ id }) => id));
  const feeKey = (grade, year, term) => JSON.stringify([grade, String(year), term]);
  const feeIds = new Map(feeSnapshot?.docs.map((snapshot) => {
    const { grade, academicYear, term } = snapshot.data();
    return [feeKey(grade, academicYear, term), snapshot.id];
  }));
  const timestamp = new Date().toISOString();
  let job;

  do {
    job = await runTransaction(db, async (transaction) => {
      const saved = (await transaction.get(jobRef)).data();
      const sameRun = saved?.id === runId;
      if (sameRun && saved.status === "complete") return saved;
      if (!sameRun && saved?.status === "pending") {
        throw new Error("Another promotion is in progress. Reopen Promotions to resume it.");
      }
      const current = sameRun ? saved : proposed;
      if (!current) throw new Error("This promotion has changed. Reopen Promotions to see its current status.");

      const school = await transaction.get(settingsRef);
      const settings = { ...DEFAULT_SETTINGS, ...school.data() };
      if (!school.exists() || String(settings.currentAcademicYear).trim() !== current.year ||
          (current.rollover && ((settings.currentTerm || "") !== current.term || !matchingRollover(current, settings)))) {
        throw new Error("The school calendar changed since this plan was reviewed. Check School Settings before continuing.");
      }
      if (current.rollover && settings.lastCompletedPromotionYear === current.year) {
        throw new Error("School-wide promotion was already completed for " + current.year + ".");
      }
      const chunk = getChunk(current);
      const classIds = [...new Set(chunk.map(({ classId }) => classId).filter((id) => existingClassIds.has(id)))];
      const graduationFeeIds = [...new Set(chunk.filter(({ action }) => action === "graduate")
        .map(({ fromGrade }) => feeIds.get(feeKey(fromGrade, current.year, current.term))).filter(Boolean))];
      const [learners, destinations, graduationFees] = await Promise.all([
        Promise.all(chunk.map(({ studentId }) => transaction.get(doc(db, "students", studentId)))),
        Promise.all(classIds.map((id) => transaction.get(doc(db, "classes", id)))),
        Promise.all(graduationFeeIds.map((id) => transaction.get(doc(db, "fees", id)))),
      ]);
      const classById = new Map(destinations.map((snapshot) => [snapshot.id, snapshot.data()]));
      const feeById = new Map(graduationFees.map((snapshot) => [snapshot.id, snapshot.data()]));
      const conflicts = [];
      const eligible = [];
      let skipped = 0;
      for (const [index, entry] of chunk.entries()) {
        if (skipIds.has(entry.studentId)) {
          skipped++;
          continue;
        }
        const snapshot = learners[index];
        const learner = snapshot.data();
        const destination = classById.get(entry.classId);
        const streams = destination?.streams || [];
        if (!learner || learner.schoolId !== schoolId || learner.status !== "active" ||
            (learner.grade || "") !== entry.fromGrade || (learner.stream || "") !== entry.fromStream ||
            (entry.action === "promote" && (destination?.schoolId !== schoolId || destination.grade !== entry.toGrade ||
              (streams.length ? !streams.includes(entry.toStream) : entry.toStream !== "")))) {
          conflicts.push({ id: entry.studentId, name: learner?.fullName || learner?.admissionNumber || entry.studentId });
          continue;
        }
        eligible.push({ entry, snapshot, learner });
      }
      if (conflicts.length) {
        const error = new Error("Some learner or class records changed after this plan was reviewed.");
        error.conflicts = conflicts;
        throw error;
      }

      const promoted = eligible.filter(({ entry }) => entry.action === "promote").length;
      const done = current.done + chunk.length;
      const complete = done === current.total;
      const next = {
        ...current, done, promoted: current.promoted + promoted,
        graduated: current.graduated + eligible.length - promoted, skipped: current.skipped + skipped,
        status: complete ? "complete" : "pending",
      };
      if (complete && next.promoted + next.graduated === 0) throw new Error("No learner changes were saved. Review the current roster and create a new plan.");
      for (const { entry, snapshot, learner } of eligible) {
        if (entry.action === "promote") {
          transaction.update(snapshot.ref, { grade: entry.toGrade, stream: entry.toStream });
        } else {
          const fee = feeById.get(feeIds.get(feeKey(entry.fromGrade, current.year, current.term)));
          const expected = fee?.amount == null || fee.amount === "" ? NaN : Number(fee.amount);
          const graduation = {
            status: "graduated", graduationYear: current.year, graduationTerm: current.term,
            graduatedAt: serverTimestamp(),
            graduationFeeExpected: Number.isFinite(expected) && expected >= 0 ? expected : null,
          };
          transaction.update(snapshot.ref, {
            ...graduation,
            statusHistory: arrayUnion({ status: "graduated", reason: "Graduated in academic year " + current.year, by: userId, at: timestamp }),
          });
          transaction.set(doc(db, "alumni", entry.studentId), {
            ...learner, ...graduation,
            promotedBy: userId, originalStudentId: entry.studentId,
          });
        }
      }
      if (complete) {
        // Save the audit and calendar in the same transaction as completion.
        transaction.set(doc(db, "audit_logs", runId), {
          schoolId, userId, action: "bulk_promote", entity: "students", entityId: runId, timestamp: serverTimestamp(),
        });
        if (current.rollover) {
          transaction.update(settingsRef, {
            currentAcademicYear: current.rollover.year, currentTerm: current.rollover.term,
            lastCompletedPromotionYear: current.year, updatedAt: serverTimestamp(),
          });
        }
        next.entries = [];
      }
      if (sameRun && !complete) {
        transaction.update(jobRef, { done, promoted: next.promoted, graduated: next.graduated, skipped: next.skipped });
      } else {
        transaction.set(jobRef, next);
      }
      return next;
    });
    invalidate("students:" + schoolId);
    if (job.status === "complete") invalidate("school_settings:" + schoolId);
    onProgress?.(job);
  } while (job.status !== "complete");
  return job;
}
