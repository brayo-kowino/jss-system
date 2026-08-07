// Parents collection.
// { schoolId, fullName, phone, email, occupation, relationship,
//   linkedStudentIds:[], createdAt }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";

export async function listParents() {
  const snap = await getDocs(query(collection(db, "parents"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
}

export async function getParent(id) {
  const snap = await getDoc(doc(db, "parents", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function createParent(userId, data) {
  const ref_ = await addDoc(collection(db, "parents"), {
    ...data,
    schoolId: getCurrentSchoolId(),
    linkedStudentIds: data.linkedStudentIds || [],
    createdAt: serverTimestamp(),
  });
  await logAction(userId, "create_parent", "parents", ref_.id);
  return ref_.id;
}

export async function updateParent(userId, id, data) {
  await updateDoc(doc(db, "parents", id), data);
  await logAction(userId, "edit_parent", "parents", id);
}

export async function linkStudentToParent(parentId, studentId) {
  await updateDoc(doc(db, "parents", parentId), { linkedStudentIds: arrayUnion(studentId) });
}

export async function unlinkStudentFromParent(parentId, studentId) {
  await updateDoc(doc(db, "parents", parentId), { linkedStudentIds: arrayRemove(studentId) });
}