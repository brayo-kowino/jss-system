// Students collection.
// { admissionNumber, fullName, gender, dob, grade, stream, parentIds:[],
//   address, phone, previousSchool, kcpeNumber, photoUrl, medicalInfo,
//   status: "active"|"transferred"|"suspended"|"archived", admissionDate,
//   createdAt }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { linkStudentToParent, unlinkStudentFromParent } from "./parent.service.js";

export async function listStudents() {
  const snap = await getDocs(query(collection(db, "students"), orderBy("fullName")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getStudent(id) {
  const snap = await getDoc(doc(db, "students", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function registerStudent(userId, data, photoFile) {
  let photoUrl = "";
  const payload = {
    ...data,
    status: "active",
    admissionDate: data.admissionDate || new Date().toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  };
  const ref_ = await addDoc(collection(db, "students"), payload);
  if (photoFile) {
    photoUrl = await uploadStudentPhoto(ref_.id, photoFile);
    await updateDoc(ref_, { photoUrl });
  }
  for (const pid of data.parentIds || []) {
    await linkStudentToParent(pid, ref_.id);
  }
  await logAction(userId, "admit_student", "students", ref_.id);
  return ref_.id;
}

export async function updateStudent(userId, id, data, photoFile, previousParentIds = []) {
  let photoUrl = data.photoUrl;
  if (photoFile) photoUrl = await uploadStudentPhoto(id, photoFile);
  await updateDoc(doc(db, "students", id), { ...data, photoUrl });

  const nextParentIds = data.parentIds || [];
  const added = nextParentIds.filter((p) => !previousParentIds.includes(p));
  const removed = previousParentIds.filter((p) => !nextParentIds.includes(p));
  for (const pid of added) await linkStudentToParent(pid, id);
  for (const pid of removed) await unlinkStudentFromParent(pid, id);

  await logAction(userId, "edit_student", "students", id);
}

export async function transferStudent(userId, id, newGrade, newStream) {
  await updateDoc(doc(db, "students", id), { grade: newGrade, stream: newStream });
  await logAction(userId, "transfer_student", "students", id);
}

export async function promoteStudent(userId, id, newGrade, newStream) {
  await updateDoc(doc(db, "students", id), { grade: newGrade, stream: newStream });
  await logAction(userId, "promote_student", "students", id);
}

export async function setStudentStatus(userId, id, status) {
  await updateDoc(doc(db, "students", id), { status });
  await logAction(userId, `${status}_student`, "students", id);
}

async function uploadStudentPhoto(studentId, file) {
  const fileRef = ref(storage, `students/${studentId}-${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
