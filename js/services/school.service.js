// ==========================================================================
// Schools Registry (super_admin only).
// A "school" doc at schools/{schoolId} doubles as the registry entry AND
// the school's own settings/customization doc (see settings.service.js,
// which reads/writes the same collection scoped to the logged-in user's
// own schoolId). This file is only for the platform-level super_admin:
// creating new schools (+ their first admin login), listing every school,
// and suspending/reactivating one.
// ==========================================================================
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, firebaseApp } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { DEFAULT_SETTINGS, slugify, isSlugAvailable, publishSchoolBranding } from "./settings.service.js";

export async function listSchools() {
  const snap = await getDocs(collection(db, "schools"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getSchool(id) {
  const snap = await getDoc(doc(db, "schools", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

// Turns a school name into a unique login code ("Green Hill JSS" ->
// "green-hill-jss", or "-2", "-3"... appended if that's already taken).
async function generateUniqueSlug(name) {
  const base = slugify(name) || "school";
  let candidate = base;
  let n = 2;
  while (!(await isSlugAvailable(candidate))) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

/**
 * Creates a new school + its first admin login in one go. Uses a throwaway
 * secondary Firebase Auth app so the super_admin's own session survives
 * (same trick auth.service.js's createUserAccount uses).
 */
export async function createSchool(superAdminUserId, { name, address, phone, email, adminFullName, adminEmail, tempPassword }) {
  if (!name?.trim()) throw new Error("School name is required.");
  if (!adminFullName?.trim() || !adminEmail?.trim() || !tempPassword) {
    throw new Error("The school's first admin needs a name, email, and temporary password.");
  }

  const schoolRef = doc(collection(db, "schools"));
  const slug = await generateUniqueSlug(name);
  await setDoc(schoolRef, {
    ...DEFAULT_SETTINGS,
    schoolName: name.trim(),
    slug,
    address: address || "",
    phone: phone || "",
    email: email || "",
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: superAdminUserId,
  });
  const schoolId = schoolRef.id;

  const secondary = initializeApp(firebaseApp.options, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, adminEmail, tempPassword);
    await setDoc(doc(db, "users", cred.user.uid), {
      fullName: adminFullName.trim(),
      email: adminEmail.trim(),
      role: "admin",
      schoolId,
      status: "active",
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Roll back the school doc if the admin account couldn't be created,
    // so we don't leave an orphaned school with no one able to log into it.
    await updateDoc(schoolRef, { status: "suspended", setupFailed: true });
    throw err;
  } finally {
    await signOut(secondaryAuth);
    await deleteApp(secondary);
  }

  // Only publish the public login-branding doc once the school actually has
  // someone who can sign into it - avoids a bookmarkable login link for a
  // school whose setup failed and got rolled back above.
  await publishSchoolBranding(schoolId, {
    slug,
    schoolName: name.trim(),
    logoUrl: "",
    themeColor: DEFAULT_SETTINGS.themeColor,
    secondaryColor: DEFAULT_SETTINGS.secondaryColor,
    status: "active",
  });

  await logAction(superAdminUserId, "create_school", "schools", schoolId);
  return schoolId;
}

// Setting status to "suspended" is a hard lock, not just a registry label
// - firestore.rules' isSubscriptionActive() (the actual enforcement) and
// subscription.service.js's getSubscriptionState() (client mirror) both
// check this field, so every operational read/write for the school's
// staff/students/parents is denied server-side the instant this write
// lands, and any already-open session gets kicked to the lock screen via
// auth.service.js's live listener on this doc - no separate "revoke"
// action needed.
export async function setSchoolStatus(superAdminUserId, schoolId, status) {
  await updateDoc(doc(db, "schools", schoolId), { status, updatedAt: serverTimestamp() });
  // Keep the public login-branding doc's status in step, so a suspended
  // school's direct login link stops resolving instead of still showing
  // its branding to anonymous visitors.
  const snap = await getDoc(doc(db, "schools", schoolId));
  const slug = snap.exists() ? snap.data().slug : null;
  if (slug) {
    await setDoc(doc(db, "school_public", slug), { status }, { merge: true }).catch(() => {});
  }
  await logAction(superAdminUserId, status === "suspended" ? "suspend_school" : "activate_school", "schools", schoolId);
}