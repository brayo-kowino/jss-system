// School settings: a single document at school_settings/main.
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

const SETTINGS_DOC = doc(db, "school_settings", "main");

export const DEFAULT_GRADING_SCALE = [
  { min: 90, max: 100, grade: "EE1", points: 8, remark: "Exceeding Expectation 1" },
  { min: 80, max: 89, grade: "EE2", points: 7, remark: "Exceeding Expectation 2" },
  { min: 70, max: 79, grade: "ME1", points: 6, remark: "Meeting Expectation 1" },
  { min: 60, max: 69, grade: "ME2", points: 5, remark: "Meeting Expectation 2" },
  { min: 50, max: 59, grade: "AE1", points: 4, remark: "Approaching Expectation 1" },
  { min: 40, max: 49, grade: "AE2", points: 3, remark: "Approaching Expectation 2" },
  { min: 30, max: 39, grade: "BE1", points: 2, remark: "Below Expectation 1" },
  { min: 0, max: 29, grade: "BE2", points: 1, remark: "Below Expectation 2" },
];

const DEFAULT_SETTINGS = {
  schoolName: "",
  motto: "",
  address: "",
  phone: "",
  email: "",
  logoUrl: "",
  currentAcademicYear: new Date().getFullYear().toString(),
  terms: ["Term 1", "Term 2", "Term 3"],
  currentTerm: "Term 1",
  closingDate: "",
  openingDate: "",
  gradingScale: DEFAULT_GRADING_SCALE,
};

export async function getSchoolSettings() {
  const snap = await getDoc(SETTINGS_DOC);
  // Merge over the defaults so any field never actually saved to Firestore
  // (e.g. `terms`, which no UI writes to) still comes back populated,
  // instead of silently returning as undefined once the doc exists.
  if (!snap.exists()) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...snap.data() };
}

export async function saveSchoolSettings(userId, data) {
  await setDoc(SETTINGS_DOC, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  await logAction(userId, "update_settings", "school_settings", "main");
}

export async function uploadSchoolLogo(file) {
  const fileRef = ref(storage, `school/logo-${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
