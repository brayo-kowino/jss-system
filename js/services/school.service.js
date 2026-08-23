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
import { db, auth, firebaseApp, attachAppCheck } from "../firebase-config.js";
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
  attachAppCheck(secondary);
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
    // `status` now has to go through the school-status edge function (see
    // its file header / setSchoolStatus below) rather than a direct client
    // write - firestore.rules no longer permits that field on a plain
    // update, even from super_admin. setupFailed isn't a subscription
    // field, so it stays a normal client write. Best-effort: the school
    // has no admin account at this point (that's the failure we're
    // handling), so there's no one signed in whose access this status
    // change could even be gating yet - if either of these fails, the
    // original error below is still what surfaces to the caller.
    await setSchoolStatus(superAdminUserId, schoolId, "suspended").catch((statusErr) => {
      console.error("createSchool: rollback status update failed", statusErr);
    });
    await updateDoc(schoolRef, { setupFailed: true }).catch(() => {});
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
// Routed through the school-status Netlify edge function rather than a
// direct client write - see the comment at the top of that file. In
// short: `status` now feeds firestore.rules' isSubscriptionActive() via a
// custom claim that has to be fanned out to every one of the school's
// staff, which only the edge function's privileged service-account
// credential can do; firestore.rules no longer permits a plain client SDK
// write to this field at all, even from super_admin. The edge function
// also keeps school_public/{slug} in step and writes the audit log entry,
// so this is now just the network call.
export async function setSchoolStatus(superAdminUserId, schoolId, status) {
  if (!auth.currentUser) throw new Error("You must be signed in.");
  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch("/school-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId, status }),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Unexpected response from the server.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}