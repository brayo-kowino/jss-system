// Fee Management.
//
// fees/{schoolId__grade_academicYear_term}: { schoolId, grade, academicYear,
//   term, amount, updatedAt } - one fee structure per grade per term;
//   deterministic ID doubles as an upsert key.
// fee_payments/{autoId}: { schoolId, studentId, studentName, grade, stream,
//   academicYear, term, amount, method, reference, date, recordedBy, createdAt }
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  getAggregateFromServer,
  runTransaction,
  sum,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { slugify } from "./academic.service.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";
import { listStudents } from "./student.service.js";
import { loadGraduationRecord } from "./alumni.service.js";
import { buildGraduateFeeHistory } from "./graduate-fees.js";
import { listResultsForStudent } from "./grading.service.js";
import { getSchoolSettings } from "./settings.service.js";
import { cached, cachedWithFallback, invalidate } from "./query-cache.js";

export const PAYMENT_METHODS = ["Cash", "M-Pesa", "Bank Transfer", "Cheque"];

function structureId(schoolId, grade, academicYear, term) {
  return scopedId(schoolId, slugify(grade), slugify(academicYear), slugify(term));
}

// student_fee_status/{schoolId__studentId_academicYear_term}: { schoolId,
//   studentId, grade, academicYear, term, expected, paid, balance,
//   updatedAt } - one summary doc per student per term, kept in sync from
//   recordPayment() (single student) and saveFeeStructure() (bulk-resynced
//   for every student in the affected grade). Retains recorded charges for
//   graduate profiles and saves per-student reads on the dashboard.
function feeStatusId(schoolId, studentId, academicYear, term) {
  return scopedId(schoolId, studentId, slugify(academicYear), slugify(term));
}

function feeStructuresCacheKey() {
  return `fees:${getCurrentSchoolId()}`;
}

export async function listFeeStructures(forceRefresh = false) {
  if (forceRefresh) invalidate(feeStructuresCacheKey());
  return cached(feeStructuresCacheKey(), 30 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", getCurrentSchoolId())));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        (a.academicYear + a.term + a.grade).localeCompare(b.academicYear + b.term + b.grade)
      );
  });
}

export async function saveFeeStructure(userId, { grade, academicYear, term, amount }) {
  const n = Number(amount);
  if (!grade) throw new Error("Select a grade.");
  if (!academicYear || !term) throw new Error("Academic year and term are required.");
  if (Number.isNaN(n) || n < 0) throw new Error("Enter a valid amount.");
  const schoolId = getCurrentSchoolId();
  const id = structureId(schoolId, grade, academicYear, term);
  await setDoc(
    doc(db, "fees", id),
    { schoolId, grade, academicYear, term, amount: n, updatedAt: serverTimestamp() },
    { merge: true }
  );
  invalidate(feeStructuresCacheKey());
  await logAction(userId, "set_fee_structure", "fees", id);
  // The fee structure changing means "expected" (and therefore balance) for
  // every student in this grade/term just moved - resync student_fee_status
  // for all of them so the dashboard's balances count reflects it, instead
  // of silently going stale until each student's next payment.
  await resyncFeeStatusForGrade({ grade, academicYear, term });
  return id;
}

export async function deleteFeeStructure(userId, id) {
  await deleteDoc(doc(db, "fees", id));
  invalidate(feeStructuresCacheKey());
  await logAction(userId, "delete_fee_structure", "fees", id);
}

// -------------------------------------------------------------- Payments --

export async function recordPayment(userId, { studentId, studentName, grade, stream, academicYear, term, amount, method, reference, date, pastCharge = false }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid payment amount.");
  const schoolId = getCurrentSchoolId();
  const paymentRef = doc(collection(db, "fee_payments"));
  const isGraduate = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(doc(db, "students", studentId));
    const student = snapshot.data();
    if (!student || student.schoolId !== schoolId) throw new Error("The learner record could not be found.");
    const graduated = student.status === "graduated";
    let placement = { studentName, grade, stream };
    if (graduated) {
      if (!pastCharge) throw new Error("Open the graduate’s Fees History and select a recorded past charge.");
      const learner = { ...student, id: studentId };
      const [graduation, reports, settings] = await Promise.all([
        loadGraduationRecord(learner), listResultsForStudent(studentId), getSchoolSettings(schoolId),
      ]);
      const { rows } = await getGraduateFeeHistory(studentId, graduation, reports, settings.terms || []);
      const charge = rows.find((row) => String(row.academicYear) === String(academicYear) &&
        row.term === term && !row.needsReview && row.balance > 0);
      if (!charge) throw new Error("This period has no confirmed past balance. Refresh Fees History and try again.");
      placement = { studentName: student.fullName, grade: charge.grade, stream: charge.stream ??
        (charge.grade === graduation.grade ? graduation.stream : "") };
    } else if (pastCharge) {
      throw new Error("The learner’s enrollment status changed. Reopen the profile before recording payment.");
    }
    transaction.set(paymentRef, {
      schoolId, studentId, studentName: placement.studentName || "", grade: placement.grade || "", stream: placement.stream || "",
      academicYear, term, amount: n, method: method || "Cash", reference: reference || "",
      date: date || new Date().toISOString().slice(0, 10), recordedBy: userId, createdAt: serverTimestamp(),
    });
    return graduated;
  });
  await logAction(userId, "record_payment", "fee_payments", paymentRef.id);
  // Keep the balances summary current for this one student - the cheap,
  // common-case path (a single payment) vs. the grade-wide resync below.
  // A graduate's saved expected amount is historical. The ledger adds the
  // new receipt without recalculating the old charge from today's schedule.
  if (!isGraduate) {
    try {
      await syncStudentFeeStatus({ studentId, grade: grade || "", academicYear, term });
    } catch (syncErr) {
      console.warn("Derived fee status sync skipped:", syncErr);
    }
  }
  return paymentRef.id;
}

export async function listPaymentsForStudent(studentId) {
  const snap = await getDocs(
    query(collection(db, "fee_payments"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getGraduateFeeHistory(studentId, graduation, reports, terms) {
  const [summaries, payments] = await Promise.all([
    getDocs(query(collection(db, "student_fee_status"),
      where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))),
    listPaymentsForStudent(studentId),
  ]);
  return buildGraduateFeeHistory({ graduation, reports, terms, payments, summaries: summaries.docs.map((item) => item.data()) });
}

export async function listPaymentsForClassPeriod(grade, stream, academicYear, term) {
  const snap = await getDocs(
    query(
      collection(db, "fee_payments"),
      where("schoolId", "==", getCurrentSchoolId()),
      where("grade", "==", grade),
      where("stream", "==", stream),
      where("academicYear", "==", academicYear),
      where("term", "==", term)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function getPayment(id) {
  const snap = await getDoc(doc(db, "fee_payments", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

/** For the dashboard's "Fees Collected (Term)" stat - a single server-side
 * sum aggregate instead of downloading every payment doc for the term.
 * getAggregateFromServer has no offline cache of its own to fall back to
 * (it's server-only), so a failed fetch (e.g. no connection) returns the
 * last total that *did* load this session, tagged stale, rather than
 * silently reporting 0 as if the school had collected nothing. */
export async function getTermCollectionTotal(academicYear, term) {
  const key = `fees:term-total:${scopedId(getCurrentSchoolId(), academicYear, term)}`;
  const { value, stale } = await cachedWithFallback(key, async () => {
    const snap = await getAggregateFromServer(
      query(
        collection(db, "fee_payments"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("academicYear", "==", academicYear),
        where("term", "==", term)
      ),
      { total: sum("amount") }
    );
    return snap.data().total || 0;
  }, 0);
  return { value, stale };
}

/** Last `months` months of revenue for the dashboard's trend chart, as
 * [{ label, total }] oldest-first. Each month is one server-side sum
 * aggregate (bounded by the `date` string field, which sorts the same as
 * chronological order since dates are stored "YYYY-MM-DD") - no payment
 * docs are downloaded at all, however many terms of history exist.
 * Same offline-fallback reasoning as getTermCollectionTotal(): each
 * month's aggregate that fails to load falls back to its own last
 * successful total (stale) rather than 0, so a dropped connection doesn't
 * make the trend chart look like revenue fell off a cliff. */
export async function getMonthlyRevenueTrend(months = 6) {
  const schoolId = getCurrentSchoolId();
  const now = new Date();

  const monthDefs = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    monthDefs.push({
      label: start.toLocaleString("en-GB", { month: "short", year: "numeric" }),
      startStr: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`,
      endStr: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-01`,
    });
  }

  const results = await Promise.all(
    monthDefs.map(async ({ label, startStr, endStr }) => {
      const key = `fees:monthly-total:${scopedId(schoolId, startStr, endStr)}`;
      const { value, stale } = await cachedWithFallback(key, async () => {
        const snap = await getAggregateFromServer(
          query(
            collection(db, "fee_payments"),
            where("schoolId", "==", schoolId),
            where("date", ">=", startStr),
            where("date", "<", endStr)
          ),
          { total: sum("amount") }
        );
        return snap.data().total || 0;
      }, 0);
      return { label, total: value, stale };
    })
  );
  return { months: results, stale: results.some((m) => m.stale) };
}

/** Join recorded balances to the active roster so a historical summary
 * stops contributing to the dashboard as soon as a learner graduates. */
export async function getStudentsWithBalancesCount(academicYear, term, roster = listStudents()) {
  const key = `fees:active-balances-count:${scopedId(getCurrentSchoolId(), academicYear, term)}`;
  const { value, stale } = await cachedWithFallback(key, async () => {
    const balances = getDocsFromServer(
      query(
        collection(db, "student_fee_status"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("academicYear", "==", academicYear),
        where("term", "==", term),
        where("balance", ">", 0)
      )
    );
    const [snap, students] = await Promise.all([balances, roster]);
    const active = new Set(students.filter(({ status }) => status === "active").map(({ id }) => id));
    return new Set(snap.docs.map((item) => item.data().studentId).filter((id) => active.has(id))).size;
  }, 0);
  return { value, stale };
}

/** For the Analytics "Fee Defaulters & Balances" report - a single query
 * against the student_fee_status summary collection instead of an N+1
 * getFeeSummary() call per active student (the pattern already replaced on
 * the dashboard by getStudentsWithBalancesCount() above). Returns the raw
 * per-student summary docs for the period (optionally narrowed to one
 * grade); callers join against listStudents() for name/admission
 * number/status since student_fee_status doesn't carry those. Same
 * freshness caveat as getStudentsWithBalancesCount(): only as current as
 * the last payment or fee-structure change that synced it. */
export async function listFeeStatusesForPeriod({ grade, academicYear, term }) {
  const schoolId = getCurrentSchoolId();
  const constraints = [
    where("schoolId", "==", schoolId),
    where("academicYear", "==", academicYear),
    where("term", "==", term),
  ];
  if (grade) constraints.push(where("grade", "==", grade));
  const snap = await getDocs(query(collection(db, "student_fee_status"), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getFeeSummary({ studentId, grade, academicYear, term }) {
  const schoolId = getCurrentSchoolId();
  const structDocId = structureId(schoolId, grade, academicYear, term);
  const structureSnap = await getDoc(doc(db, "fees", structDocId));
  const expected = structureSnap.exists() ? Number(structureSnap.data().amount) || 0 : 0;

  const paymentsSnap = await getDocs(
    query(
      collection(db, "fee_payments"),
      where("schoolId", "==", schoolId),
      where("studentId", "==", studentId),
      where("academicYear", "==", academicYear),
      where("term", "==", term)
    )
  );
  const paid = paymentsSnap.docs.reduce((total, d) => total + (Number(d.data().amount) || 0), 0);

  return { expected, paid, balance: Math.max(expected - paid, 0) };
}

// ---------------------------------------------------- student_fee_status --

/** Recomputes and upserts one student's balance summary. Called after every
 * payment - cheap (one getFeeSummary() read/write pair), so it's fine to run
 * on the hot path. Silently skipped if the student has no grade yet (mirrors
 * the dashboard's own "skip - no fee structure yet" behavior).
 *
 * Pass `summary` ({ expected, paid, balance }) when the caller already has
 * it (e.g. the Fees page just ran getFeeSummary() for the same student) to
 * skip the redundant read - otherwise it's fetched here. */
export async function syncStudentFeeStatus({ studentId, grade, academicYear, term, summary }) {
  if (!studentId || !grade || !academicYear || !term) return;
  const schoolId = getCurrentSchoolId();
  const { expected, paid, balance } = summary || (await getFeeSummary({ studentId, grade, academicYear, term }));
  await setDoc(
    doc(db, "student_fee_status", feeStatusId(schoolId, studentId, academicYear, term)),
    {
      schoolId,
      studentId,
      grade,
      academicYear,
      term,
      expected,
      paid,
      balance,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Recomputes student_fee_status for every active student in a grade -
 * called when a fee structure is saved, since that changes "expected" (and
 * therefore balance) for the whole grade at once. Heavier than the
 * single-student sync above, but only runs on an explicit admin/bursar
 * action, not on every dashboard load. */
async function resyncFeeStatusForGrade({ grade, academicYear, term }) {
  if (!grade || !academicYear || !term) return;
  const students = await listStudents(true);
  const activeInGrade = students.filter((s) => s.status === "active" && s.grade === grade);
  await Promise.all(
    activeInGrade.map((s) => syncStudentFeeStatus({ studentId: s.id, grade, academicYear, term }))
  );
}

/** One-time (or run-whenever-you-like) backfill: syncs student_fee_status
 * for every active, graded student for one academic year + term. Needed
 * because syncStudentFeeStatus() only fires going forward, as a side effect
 * of recordPayment()/saveFeeStructure() - a student whose balance was set
 * before this collection existed, and who hasn't had a new payment or
 * fee-structure resave since, has no doc yet and won't show up in
 * getStudentsWithBalancesCount() until this runs once for their period.
 * Returns how many students were synced. */
export async function backfillAllFeeStatuses(academicYear, term) {
  if (!academicYear || !term) throw new Error("Academic year and term are required.");
  const students = await listStudents(true);
  const eligible = students.filter((s) => s.status === "active" && s.grade);
  await Promise.all(
    eligible.map((s) => syncStudentFeeStatus({ studentId: s.id, grade: s.grade, academicYear, term }))
  );
  return eligible.length;
}

export function formatKES(amount) {
  return `KES ${Number(amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
