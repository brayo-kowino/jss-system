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
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { slugify } from "./academic.service.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";

export const PAYMENT_METHODS = ["Cash", "M-Pesa", "Bank Transfer", "Cheque"];

function structureId(schoolId, grade, academicYear, term) {
  return scopedId(schoolId, slugify(grade), slugify(academicYear), slugify(term));
}

// ---------------------------------------------------------- Fee Structure --

export async function listFeeStructures() {
  const snap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (a.academicYear + a.term + a.grade).localeCompare(b.academicYear + b.term + b.grade)
    );
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
  await logAction(userId, "set_fee_structure", "fees", id);
  return id;
}

export async function deleteFeeStructure(userId, id) {
  await deleteDoc(doc(db, "fees", id));
  await logAction(userId, "delete_fee_structure", "fees", id);
}

// -------------------------------------------------------------- Payments --

export async function recordPayment(userId, { studentId, studentName, grade, stream, academicYear, term, amount, method, reference, date }) {
  const n = Number(amount);
  if (Number.isNaN(n) || n <= 0) throw new Error("Enter a valid payment amount.");
  const ref_ = await addDoc(collection(db, "fee_payments"), {
    schoolId: getCurrentSchoolId(),
    studentId,
    studentName: studentName || "",
    grade: grade || "",
    stream: stream || "",
    academicYear,
    term,
    amount: n,
    method: method || "Cash",
    reference: reference || "",
    date: date || new Date().toISOString().slice(0, 10),
    recordedBy: userId,
    createdAt: serverTimestamp(),
  });
  await logAction(userId, "record_payment", "fee_payments", ref_.id);
  return ref_.id;
}

export async function listPaymentsForStudent(studentId) {
  const snap = await getDocs(
    query(collection(db, "fee_payments"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? 1 : -1));
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

/** For the dashboard's "Fees Collected (Term)" stat. */
export async function getTermCollectionTotal(academicYear, term) {
  try {
    const snap = await getDocs(
      query(
        collection(db, "fee_payments"),
        where("schoolId", "==", getCurrentSchoolId()),
        where("academicYear", "==", academicYear),
        where("term", "==", term)
      )
    );
    return snap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);
  } catch {
    return 0;
  }
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
  const paid = paymentsSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

  return { expected, paid, balance: Math.max(expected - paid, 0) };
}

export function formatKES(amount) {
  return `KES ${Number(amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}