// Academic Structure: Classes (Grade + Streams) and Subjects.
// classes/{schoolId__slug}:  { schoolId, grade, streams: string[], createdAt, updatedAt }
// subjects/{schoolId__code}: { schoolId, code, name, department, pathway, createdAt, updatedAt }
//
// Doc IDs are namespaced by schoolId so two schools can both have a
// "Grade 7" or a "MATH" subject without colliding on the same doc.
//
// Deletes are guarded: a grade/stream or subject already referenced by a
// student or teacher record cannot be removed until it's unassigned first.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { scopedId } from "../utils.js";

export const PATHWAYS = ["STEM", "Social Sciences", "Arts & Sports Science"];

export const DEPARTMENTS = [
  "Sciences",
  "Languages",
  "Humanities",
  "Technical & Applied",
  "Creative Arts",
];

const DEFAULT_CLASSES = [
  { grade: "Grade 7", streams: ["Blue", "Green", "Red"] },
  { grade: "Grade 8", streams: ["Blue", "Green"] },
  { grade: "Grade 9", streams: ["Blue", "Green"] },
];

const DEFAULT_SUBJECTS = [
  { code: "MATH", name: "Mathematics", department: "Sciences", pathway: "STEM" },
  { code: "ENG", name: "English", department: "Languages", pathway: "Social Sciences" },
  { code: "KIS", name: "Kiswahili", department: "Languages", pathway: "Social Sciences" },
  { code: "SCI", name: "Integrated Science", department: "Sciences", pathway: "STEM" },
  { code: "AGR", name: "Agriculture", department: "Sciences", pathway: "STEM" },
  { code: "SST", name: "Social Studies", department: "Humanities", pathway: "Social Sciences" },
  { code: "CRA", name: "Creative Arts", department: "Creative Arts", pathway: "Arts & Sports Science" },
  { code: "CRE", name: "CRE", department: "Humanities", pathway: "Social Sciences" },
  { code: "PTS", name: "Pre-Technical Studies", department: "Technical & Applied", pathway: "STEM" },
];

export function slugify(text) {
  return String(text).trim().replace(/\s+/g, "_");
}

// ---------------------------------------------------------------- Classes --

export async function listClasses() {
  const snap = await getDocs(query(collection(db, "classes"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.grade || "").localeCompare(b.grade || ""));
}

export async function getClass(id) {
  const snap = await getDoc(doc(db, "classes", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function addClass(userId, grade, streams = []) {
  const schoolId = getCurrentSchoolId();
  const id = scopedId(schoolId, slugify(grade));
  const existing = await getDoc(doc(db, "classes", id));
  if (existing.exists()) throw new Error(`"${grade}" already exists.`);
  await setDoc(doc(db, "classes", id), {
    schoolId,
    grade: grade.trim(),
    streams: streams.map((s) => s.trim()).filter(Boolean),
    createdAt: serverTimestamp(),
  });
  await logAction(userId, "create_class", "classes", id);
  return id;
}

export async function addStreamToClass(userId, classId, streamName) {
  const cls = await getClass(classId);
  if (!cls) throw new Error("Grade not found.");
  const name = streamName.trim();
  if (!name) throw new Error("Stream name is required.");
  if ((cls.streams || []).some((s) => s.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Stream "${name}" already exists in ${cls.grade}.`);
  }
  const streams = [...(cls.streams || []), name];
  await updateDoc(doc(db, "classes", classId), { streams, updatedAt: serverTimestamp() });
  await logAction(userId, "add_stream", "classes", classId);
}

export async function renameStream(userId, classId, oldName, newName) {
  const cls = await getClass(classId);
  if (!cls) throw new Error("Grade not found.");
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Stream name is required.");
  const inUse = await countStudentsInStream(cls.grade, oldName);
  if (inUse > 0) {
    throw new Error(`Cannot rename: ${inUse} student(s) are currently in ${cls.grade} ${oldName}. Transfer them first.`);
  }
  const streams = (cls.streams || []).map((s) => (s === oldName ? trimmed : s));
  await updateDoc(doc(db, "classes", classId), { streams, updatedAt: serverTimestamp() });
  await logAction(userId, "rename_stream", "classes", classId);
}

export async function removeStreamFromClass(userId, classId, streamName) {
  const cls = await getClass(classId);
  if (!cls) throw new Error("Grade not found.");
  const inUse = await countStudentsInStream(cls.grade, streamName);
  if (inUse > 0) {
    throw new Error(`Cannot remove: ${inUse} student(s) are currently in ${cls.grade} ${streamName}. Transfer them first.`);
  }
  const streams = (cls.streams || []).filter((s) => s !== streamName);
  await updateDoc(doc(db, "classes", classId), { streams, updatedAt: serverTimestamp() });
  await logAction(userId, "remove_stream", "classes", classId);
}

export async function deleteClass(userId, classId) {
  const cls = await getClass(classId);
  if (!cls) throw new Error("Grade not found.");
  const studentCount = await countStudentsInGrade(cls.grade);
  if (studentCount > 0) {
    throw new Error(`Cannot delete ${cls.grade}: ${studentCount} student(s) are still enrolled in it.`);
  }
  const teacherCount = await countTeachersInGrade(cls.grade);
  if (teacherCount > 0) {
    throw new Error(`Cannot delete ${cls.grade}: ${teacherCount} teacher(s) are still assigned to it.`);
  }
  await deleteDoc(doc(db, "classes", classId));
  await logAction(userId, "delete_class", "classes", classId);
}

async function countStudentsInGrade(grade) {
  const snap = await getDocs(
    query(collection(db, "students"), where("schoolId", "==", getCurrentSchoolId()), where("grade", "==", grade))
  );
  return snap.size;
}

async function countStudentsInStream(grade, stream) {
  const snap = await getDocs(
    query(
      collection(db, "students"),
      where("schoolId", "==", getCurrentSchoolId()),
      where("grade", "==", grade),
      where("stream", "==", stream)
    )
  );
  return snap.size;
}

async function countTeachersInGrade(grade) {
  const snap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.filter((d) => (d.data().classAssignments || []).some((a) => a.grade === grade)).length;
}

// --------------------------------------------------------------- Subjects --

export async function listSubjects() {
  const snap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getSubject(id) {
  const snap = await getDoc(doc(db, "subjects", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

export async function addSubject(userId, { code, name, department, pathway }) {
  const schoolId = getCurrentSchoolId();
  const cleanCode = code.trim().toUpperCase();
  const id = scopedId(schoolId, cleanCode);
  const existing = await getDoc(doc(db, "subjects", id));
  if (existing.exists()) throw new Error(`Subject code "${cleanCode}" already exists.`);
  await setDoc(doc(db, "subjects", id), {
    schoolId,
    code: cleanCode,
    name: name.trim(),
    department: department || "",
    pathway: pathway || "",
    createdAt: serverTimestamp(),
  });
  await logAction(userId, "create_subject", "subjects", id);
  return id;
}

export async function updateSubject(userId, id, { name, department, pathway }) {
  await updateDoc(doc(db, "subjects", id), {
    name: name.trim(),
    department: department || "",
    pathway: pathway || "",
    updatedAt: serverTimestamp(),
  });
  await logAction(userId, "update_subject", "subjects", id);
}

export async function deleteSubject(userId, id) {
  const subject = await getSubject(id);
  const teacherSnap = await getDocs(
    query(
      collection(db, "teachers"),
      where("schoolId", "==", getCurrentSchoolId()),
      where("subjectCodes", "array-contains", subject?.code || id)
    )
  );
  if (teacherSnap.size > 0) {
    throw new Error(`Cannot delete: ${teacherSnap.size} teacher(s) are still assigned to teach this subject.`);
  }
  await deleteDoc(doc(db, "subjects", id));
  await logAction(userId, "delete_subject", "subjects", id);
}

// ------------------------------------------------------------------ Seed --

export async function seedDefaultsIfEmpty() {
  const schoolId = getCurrentSchoolId();
  const [classes, subjects] = await Promise.all([listClasses(), listSubjects()]);
  if (classes.length === 0) {
    for (const c of DEFAULT_CLASSES) {
      await setDoc(doc(db, "classes", scopedId(schoolId, slugify(c.grade))), { ...c, schoolId, createdAt: serverTimestamp() });
    }
  }
  if (subjects.length === 0) {
    for (const s of DEFAULT_SUBJECTS) {
      await setDoc(doc(db, "subjects", scopedId(schoolId, s.code)), { ...s, schoolId, createdAt: serverTimestamp() });
    }
  }
}