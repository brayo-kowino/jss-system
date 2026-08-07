// Teachers collection.
// { schoolId, teacherNumber, tscNumber, fullName, phone, email,
//   subjectCodes:[], classAssignments:[{grade, stream}],
//   userId (linked login, optional), status, createdAt }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
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

function teachersCacheKey() {
  return `teachers:${getCurrentSchoolId()}`;
}

export async function listTeachers() {
  // Full roster - read by the Teachers page and Analytics, written to only
  // by the handful of functions below.
  return cached(teachersCacheKey(), 3 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", getCurrentSchoolId())));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  });
}

export async function getTeacher(id) {
  const snap = await getDoc(doc(db, "teachers", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

// Used by Marks Entry (and anywhere else) to find which teacher record a
// logged-in subject/class teacher owns, so their subject/class pickers can
// be limited to what they're actually assigned to teach.
export async function getTeacherByUserId(userId) {
  const snap = await getDocs(
    query(collection(db, "teachers"), where("schoolId", "==", getCurrentSchoolId()), where("userId", "==", userId))
  );
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getTeacherByEmail(email) {
  if (!email) return null;
  const snap = await getDocs(
    query(collection(db, "teachers"), where("schoolId", "==", getCurrentSchoolId()), where("email", "==", email))
  );
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function createTeacher(userId, data) {
  const ref_ = await addDoc(collection(db, "teachers"), {
    ...data,
    schoolId: getCurrentSchoolId(),
    status: "active",
    subjectCodes: data.subjectCodes || [],
    classAssignments: data.classAssignments || [],
    createdAt: serverTimestamp(),
  });
  invalidate(teachersCacheKey());
  await logAction(userId, "create_teacher", "teachers", ref_.id);
  return ref_.id;
}

export async function updateTeacher(userId, id, data) {
  await updateDoc(doc(db, "teachers", id), data);
  invalidate(teachersCacheKey());
  await logAction(userId, "edit_teacher", "teachers", id);
}

export async function assignSubjects(userId, id, subjectCodes) {
  await updateDoc(doc(db, "teachers", id), { subjectCodes });
  invalidate(teachersCacheKey());
  await logAction(userId, "assign_subjects", "teachers", id);
}

export async function assignClasses(userId, id, classAssignments) {
  await updateDoc(doc(db, "teachers", id), { classAssignments });
  invalidate(teachersCacheKey());
  await logAction(userId, "assign_classes", "teachers", id);
}

export async function setTeacherStatus(userId, id, status) {
  await updateDoc(doc(db, "teachers", id), { status });
  invalidate(teachersCacheKey());
  await logAction(userId, `${status}_teacher`, "teachers", id);
}