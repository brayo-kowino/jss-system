// Student Issues: a lightweight front-desk ticket log for problems raised
// in person or by phone about a specific student - a wrong/inaccurate
// score, a report card error, incorrect admission details, a fee
// discrepancy, etc - so nothing raised gets lost and every student's
// profile shows what's still open against them.
//
// student_issues/{autoId}: { schoolId, studentId, studentName,
//   admissionNumber, category, description,
//   context: { academicYear, term, subjectCode } | null,
//   status: "open" | "resolved", raisedBy, raisedAt,
//   resolvedBy, resolvedAt, resolutionNote }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";

export const ISSUE_CATEGORIES = [
  { value: "score_dispute", label: "Wrong / inaccurate score" },
  { value: "report_error", label: "Report card error" },
  { value: "admission_error", label: "Wrong admission details" },
  { value: "fee_discrepancy", label: "Fee / payment discrepancy" },
  { value: "attendance_dispute", label: "Attendance dispute" },
  { value: "other", label: "Other" },
];

export function issueCategoryLabel(value) {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label || value || "Other";
}

export async function raiseIssue(userId, { studentId, studentName, admissionNumber, category, description, context }) {
  if (!studentId) throw new Error("Student is required.");
  if (!category) throw new Error("Choose a category for this issue.");
  const desc = (description || "").trim();
  if (!desc) throw new Error("Describe the issue.");
  const ref_ = await addDoc(collection(db, "student_issues"), {
    schoolId: getCurrentSchoolId(),
    studentId,
    studentName: studentName || "",
    admissionNumber: admissionNumber || "",
    category,
    description: desc,
    context: context || null,
    status: "open",
    raisedBy: userId,
    raisedAt: serverTimestamp(),
  });
  await logAction(userId, "raise_student_issue", "student_issues", ref_.id);
  return ref_.id;
}

export async function listIssuesForStudent(studentId) {
  const snap = await getDocs(
    query(collection(db, "student_issues"), where("schoolId", "==", getCurrentSchoolId()), where("studentId", "==", studentId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.raisedAt?.seconds || 0) - (a.raisedAt?.seconds || 0));
}

// Every open issue school-wide, keyed by studentId, so the Students table
// can flag rows with a badge from a single query instead of one read per
// student.
export async function listOpenIssues() {
  const snap = await getDocs(
    query(collection(db, "student_issues"), where("schoolId", "==", getCurrentSchoolId()), where("status", "==", "open"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function resolveIssue(userId, id, resolutionNote) {
  await updateDoc(doc(db, "student_issues", id), {
    status: "resolved",
    resolutionNote: (resolutionNote || "").trim(),
    resolvedBy: userId,
    resolvedAt: serverTimestamp(),
  });
  await logAction(userId, "resolve_student_issue", "student_issues", id);
}

export async function reopenIssue(userId, id) {
  await updateDoc(doc(db, "student_issues", id), {
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: "",
  });
  await logAction(userId, "reopen_student_issue", "student_issues", id);
}
