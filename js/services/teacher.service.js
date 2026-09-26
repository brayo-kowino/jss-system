// Teachers collection.
// { schoolId, teacherNumber, tscNumber, fullName, phone, email,
//   teachingAssignments:[{grade, stream, subjectCode}],
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

export async function listTeachers(forceRefresh = false) {
  // Full roster - read by the Teachers page and Analytics, written to only
  // by the handful of functions below. forceRefresh lets a caller that
  // just wrote a teacher record bypass a still-fresh cache entry.
  if (forceRefresh) invalidate(teachersCacheKey());
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
    teachingAssignments: data.teachingAssignments || [],
    createdAt: serverTimestamp(),
  });
  invalidate(teachersCacheKey());
  await logAction(userId, "create_teacher", "teachers", ref_.id);
  return ref_.id;
}

export async function updateTeacher(userId, id, data) {
  await updateDoc(doc(db, "teachers", id), { ...data, schoolId: getCurrentSchoolId() });
  invalidate(teachersCacheKey());
  await logAction(userId, "edit_teacher", "teachers", id);
}

export async function updateTeachingAssignments(userId, id, teachingAssignments) {
  await updateDoc(doc(db, "teachers", id), { teachingAssignments, schoolId: getCurrentSchoolId() });
  invalidate(teachersCacheKey());
  await logAction(userId, "update_teaching_assignments", "teachers", id);
}

export async function setTeacherStatus(userId, id, status) {
  await updateDoc(doc(db, "teachers", id), { status, schoolId: getCurrentSchoolId() });
  invalidate(teachersCacheKey());
  await logAction(userId, `${status}_teacher`, "teachers", id);
}

/**
 * One-time migration to convert legacy subjectCodes and classAssignments
 * into the new teachingAssignments cartesian product.
 * You can remove this function after running it once successfully.
 */
export async function migrateLegacyTeachers(userId) {
  const teachers = await listTeachers();
  let migratedCount = 0;

  for (const t of teachers) {
    // If they have the old fields but no teachingAssignments
    if (!t.teachingAssignments && t.subjectCodes && t.classAssignments) {
      const teachingAssignments = [];
      
      // Build cartesian product of their classes x subjects
      for (const cls of t.classAssignments) {
        for (const subj of t.subjectCodes) {
          teachingAssignments.push({
            grade: cls.grade,
            stream: cls.stream || "",
            subjectCode: subj
          });
        }
      }
      
      if (teachingAssignments.length > 0) {
        await updateDoc(doc(db, "teachers", t.id), { 
          teachingAssignments,
          // We don't delete the old fields just in case we need to rollback,
          // they'll just be ignored by the UI.
        });
        migratedCount++;
      }
    }
  }
  
  if (migratedCount > 0) {
    invalidate(teachersCacheKey());
    await logAction(userId, "migrate_legacy_teachers", "teachers", "all");
  }
  
  return migratedCount;
}