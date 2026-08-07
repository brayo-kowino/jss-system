// ==========================================================================
// Auth Service
// Wraps Firebase Auth + the `users` Firestore collection, which stores the
// role and profile info Firebase Auth itself doesn't hold.
//
// Firestore doc shape - collection "users", doc id == auth uid:
// {
//   fullName, email, role: "super_admin"|"admin"|"principal"|
//     "deputy_principal"|"academic_master"|"class_teacher"|
//     "subject_teacher"|"bursar"|"registrar"|"parent"|"student",
//   schoolId: string|null, // null only for "super_admin" - every other
//     role belongs to exactly one school and every query in the app is
//     scoped to it (see getCurrentSchoolId() below).
//   status: "active"|"suspended",
//   createdAt, linkedStudentIds: [] // for parent role
// }
// ==========================================================================
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, firebaseApp } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

let currentProfile = null; // cached { uid, ...firestore user doc }

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      currentProfile = null;
      callback(null);
      return;
    }
    currentProfile = await fetchProfile(fbUser.uid);
    callback(currentProfile);
  });
}

async function fetchProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

export function getCurrentProfile() {
  return currentProfile;
}

// The school the logged-in user belongs to (null for super_admin, who
// isn't scoped to any single school). Every service that reads/writes
// school data calls this rather than taking a schoolId as a parameter,
// so views don't need to thread it through everywhere.
export function getCurrentSchoolId() {
  return currentProfile?.schoolId || null;
}

export function isSuperAdmin() {
  return currentProfile?.role === "super_admin";
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const profile = await fetchProfile(cred.user.uid);
  if (!profile) throw new Error("Account has no role profile. Contact the administrator.");
  if (profile.status === "suspended") {
    await signOut(auth);
    throw new Error("This account has been suspended.");
  }
  currentProfile = profile;
  await logAction(profile.uid, "login", "auth", null);
  return profile;
}

export async function logout() {
  if (currentProfile) await logAction(currentProfile.uid, "logout", "auth", null);
  await signOut(auth);
}

export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

export function changeOwnPassword(newPassword) {
  return updatePassword(auth.currentUser, newPassword);
}

/**
 * Admin action: create a login for a staff/parent/student without ending the
 * admin's own session. Firebase's client SDK signs in as whoever it creates,
 * so we spin up a throwaway secondary app instance just for this call.
 * (For heavier volume, move this to a Cloud Function with the Admin SDK.)
 */
export async function createUserAccount({ fullName, email, role, tempPassword, schoolId }) {
  const secondary = initializeApp(firebaseApp.options, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
    await setDoc(doc(db, "users", cred.user.uid), {
      fullName,
      email,
      role,
      schoolId: schoolId || getCurrentSchoolId(),
      status: "active",
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    });
    await logAction(currentProfile?.uid, "create_user", "users", cred.user.uid);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth);
    await deleteApp(secondary);
  }
}

// Every user account belonging to the current school - used to resolve an
// audit log's raw userId into a name/role for display (e.g. Audit Trail).
export async function listSchoolUsers() {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  const snap = await getDocs(query(collection(db, "users"), where("schoolId", "==", schoolId)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export const ROLES = [
  { value: "admin", label: "School Administrator" },
  { value: "super_admin", label: "Platform Administrator"},
  { value: "principal", label: "Principal" },
  { value: "deputy_principal", label: "Deputy Principal" },
  { value: "academic_master", label: "Academic Master/Mistress" },
  { value: "class_teacher", label: "Class Teacher" },
  { value: "subject_teacher", label: "Subject Teacher" },
  { value: "bursar", label: "Bursar/Accountant" },
  { value: "registrar", label: "Registrar" },
  { value: "parent", label: "Parent" },
  { value: "student", label: "Student" },
];