// Students collection.
// { schoolId, admissionNumber, fullName, gender, dob, grade, stream,
//   parentIds:[], address, phone, previousSchool, kcpeNumber, photoUrl,
//   medicalInfo, status: "active"|"transferred"|"suspended"|"archived",
//   admissionDate, createdAt }
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  serverTimestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { uploadToCloudinary } from "./cloudinary.service.js";
import { linkStudentToParent, unlinkStudentFromParent } from "./parent.service.js";
import { cached, invalidate } from "./query-cache.js";

function studentsCacheKey() {
  return `students:${getCurrentSchoolId()}`;
}

// Exported so student-import.service.js (bulk CSV import, a separate write
// path that doesn't go through registerStudent/updateStudent below) can
// invalidate the same cache entry after committing its batch writes,
// without duplicating the cache-key logic.
export function invalidateStudentsCache() {
  invalidate(studentsCacheKey());
}

export async function listStudents(forceRefresh = false) {
  // Read on almost every page (rosters, marks entry, fees, reports...) but
  // written only from Student Management/import - cache rather than
  // re-querying on every render. forceRefresh lets a caller that just
  // created/updated/transferred/archived a student skip past a
  // still-fresh cache entry instead of waiting out the TTL.
  if (forceRefresh) invalidate(studentsCacheKey());
  return cached(studentsCacheKey(), 3 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "students"), where("schoolId", "==", getCurrentSchoolId())));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  });
}

export async function getStudent(id) {
  const snap = await getDoc(doc(db, "students", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function registerStudent(userId, data, photoFile) {
  let photoUrl = "";
  const payload = {
    ...data,
    schoolId: getCurrentSchoolId(),
    status: "active",
    admissionDate: data.admissionDate || new Date().toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  };
  const ref_ = await addDoc(collection(db, "students"), payload);
  if (photoFile) {
    photoUrl = await uploadStudentPhoto(ref_.id, photoFile);
    await updateDoc(ref_, { photoUrl });
  }
  // Independent per-parent writes - no ordering dependency between them,
  // so fire them together instead of awaiting one at a time.
  await Promise.all((data.parentIds || []).map((pid) => linkStudentToParent(pid, ref_.id)));
  invalidate(studentsCacheKey());
  await logAction(userId, "admit_student", "students", ref_.id);
  return ref_.id;
}

export async function updateStudent(userId, id, data, photoFile, previousParentIds = []) {
  let photoUrl = data.photoUrl;
  if (photoFile) photoUrl = await uploadStudentPhoto(id, photoFile);
  
  const payload = { ...data };
  if (photoUrl !== undefined) {
    payload.photoUrl = photoUrl;
  }
  await updateDoc(doc(db, "students", id), payload);

  const nextParentIds = data.parentIds || [];
  const added = nextParentIds.filter((p) => !previousParentIds.includes(p));
  const removed = previousParentIds.filter((p) => !nextParentIds.includes(p));
  // Same reasoning as registerStudent() above - these are independent
  // writes to different parent docs, so run every add/remove concurrently
  // instead of one round trip at a time.
  await Promise.all([
    ...added.map((pid) => linkStudentToParent(pid, id)),
    ...removed.map((pid) => unlinkStudentFromParent(pid, id)),
  ]);

  invalidate(studentsCacheKey());
  await logAction(userId, "edit_student", "students", id);
}

export async function transferStudent(userId, id, newGrade, newStream) {
  await updateDoc(doc(db, "students", id), { grade: newGrade, stream: newStream });
  invalidate(studentsCacheKey());
  await logAction(userId, "transfer_student", "students", id);
}

export async function promoteStudent(userId, id, newGrade, newStream) {
  await updateDoc(doc(db, "students", id), { grade: newGrade, stream: newStream });
  invalidate(studentsCacheKey());
  await logAction(userId, "promote_student", "students", id);
}

// `reason` is required by the UI when suspending, optional otherwise (a
// note on why a student was reinstated/archived/transferred). Every change
// is appended to statusHistory so a student's profile can show a timeline
// of exactly what happened and why, not just the current status.
export async function setStudentStatus(userId, id, status, reason = "") {
  await updateDoc(doc(db, "students", id), {
    status,
    ...(status === "suspended" ? { suspensionReason: reason || "" } : { suspensionReason: "" }),
    statusHistory: arrayUnion({
      status,
      reason: reason || "",
      by: userId,
      at: new Date().toISOString(),
    }),
  });
  invalidate(studentsCacheKey());
  await logAction(userId, `${status}_student`, "students", id);
}

async function uploadStudentPhoto(studentId, file) {
  return uploadToCloudinary(file, `schools/${getCurrentSchoolId()}/students/${studentId}`);
}