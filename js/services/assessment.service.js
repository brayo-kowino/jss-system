// Assessment Management.
// assessments/{id}: { name, type, weight, date, academicYear, term,
//   grades: string[] (grade names this assessment is administered to),
//   status: "open" | "locked", createdAt, updatedAt }
//
// "locked" gates Marks Entry (built next) — once locked, no further marks
// can be entered/edited against this assessment until an admin reopens it.
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
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

export const ASSESSMENT_TYPES = ["CAT", "Assignment", "Midterm", "Endterm", "Project", "Other"];

export async function listAssessments() {
  const snap = await getDocs(query(collection(db, "assessments"), orderBy("date", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAssessment(id) {
  const snap = await getDoc(doc(db, "assessments", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function addAssessment(userId, data) {
  const ref_ = await addDoc(collection(db, "assessments"), {
    name: data.name.trim(),
    type: data.type,
    weight: Number(data.weight) || 0,
    date: data.date || "",
    academicYear: data.academicYear || "",
    term: data.term || "",
    grades: data.grades || [],
    status: "open",
    createdAt: serverTimestamp(),
  });
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
    date: data.date || "",
    academicYear: data.academicYear || "",
    term: data.term || "",
    grades: data.grades || [],
    updatedAt: serverTimestamp(),
  });
  await logAction(userId, "update_assessment", "assessments", id);
}

export async function setAssessmentStatus(userId, id, status) {
  await updateDoc(doc(db, "assessments", id), { status, updatedAt: serverTimestamp() });
  await logAction(userId, status === "locked" ? "lock_assessment" : "reopen_assessment", "assessments", id);
}

export async function deleteAssessment(userId, id) {
  const marksSnap = await getDocs(query(collection(db, "marks"), where("assessmentId", "==", id)));
  if (marksSnap.size > 0) {
    throw new Error(`Cannot delete: ${marksSnap.size} mark record(s) already exist for this assessment.`);
  }
  await deleteDoc(doc(db, "assessments", id));
  await logAction(userId, "delete_assessment", "assessments", id);
}
