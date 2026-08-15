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
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, firebaseApp } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { cached, invalidate, clearAll as clearReadCache } from "./query-cache.js";
import { getSubscriptionState } from "./subscription.service.js";

// ==========================================================================
// Subscription-status cookie
// ==========================================================================
// A small, readable-by-JS (not HttpOnly - it's a routing hint, not a
// credential) cookie mirroring getSubscriptionState()'s verdict for the
// signed-in user's own school. It exists for exactly one consumer:
// netlify/edge-functions/subscription-gate.ts, which reads it on the next
// page load/reload to decide whether to serve the app shell at all.
//
// This is a UI/perf optimization, never a security boundary - same as
// currentSchool/getCurrentSchool() itself (see that function's comment).
// The real enforcement stays exactly where it already was:
//   - firestore.rules' isSubscriptionActive(), live, server-side
//   - router.js's own lock gate, which still runs client-side on every
//     render regardless of what this cookie says
// A stale, missing, or tampered cookie can only ever cause the edge
// function to serve the *normal* app shell (fail-open) - see that file's
// header for why the "suspended" case is the only one it hard-blocks on,
// and why it treats anything else as "let it through, let the client-side
// checks above handle it."
//
// Kept deliberately short-lived (1 hour) and re-synced on every school
// snapshot change, sign-in, and manual refresh - it only ever needs to be
// roughly right by the next full page load, not instantly authoritative.
// ==========================================================================
const SUB_STATUS_COOKIE = "jss_sub_status";
const SUB_STATUS_MAX_AGE_SECONDS = 60 * 60; // 1 hour

function syncSubscriptionCookie(school) {
  if (typeof document === "undefined") return; // defensive - no-op outside a browser
  if (!school) {
    // Signed out, or a super_admin (no schoolId/school doc) - nothing to
    // gate on, so make sure no stale value lingers from a previous session
    // in the same browser.
    document.cookie = `${SUB_STATUS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  const { active, suspended } = getSubscriptionState(school);
  // Only three values the edge function needs to distinguish: "active"
  // (serve normally), "suspended" (hard-block, see the edge function),
  // and "locked" (expired/revoked - let it through so the admin's
  // self-reactivation token form on the lock screen still loads).
  const value = active ? "active" : suspended ? "suspended" : "locked";
  document.cookie = `${SUB_STATUS_COOKIE}=${value}; Path=/; Max-Age=${SUB_STATUS_MAX_AGE_SECONDS}; SameSite=Lax`;
}

let currentProfile = null; // cached { uid, ...firestore user doc }
// Cached schools/{schoolId} doc for the logged-in user's own school - kept
// alongside currentProfile so the router can check subscription status
// (subscriptionStatus/subscriptionExpiresAt) on every render without an
// extra fetch. Null for super_admin (no schoolId) and while signed out.
let currentSchool = null;

// Live listener on the signed-in user's own schools/{id} doc, so a
// platform admin hitting Suspend (or issuing/expiring a subscription) locks
// out an already-open session within moments, instead of only taking
// effect on that tab's next full sign-in or the next "online" reconnect.
// Firestore rules still allow this read while suspended/expired (see
// firestore.rules' schools/{schoolId} rule - it deliberately isn't gated
// by isSubscriptionActive() itself, or the app could never learn *why* it
// got locked out). Torn down on sign-out/account switch so it never leaks
// a listener onto the next session in the same tab.
let unsubscribeSchoolListener = null;

function watchCurrentSchool(schoolId, onChange) {
  unsubscribeSchoolListener?.();
  unsubscribeSchoolListener = onSnapshot(
    doc(db, "schools", schoolId),
    (snap) => {
      currentSchool = snap.exists() ? { id: schoolId, ...snap.data() } : null;
      syncSubscriptionCookie(currentSchool);
      onChange();
    },
    () => {} // best-effort - a real problem here still surfaces normally on next navigation/read
  );
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (fbUser) => {
    unsubscribeSchoolListener?.();
    unsubscribeSchoolListener = null;
    if (!fbUser) {
      currentProfile = null;
      currentSchool = null;
      syncSubscriptionCookie(null);
      callback(null);
      return;
    }
    currentProfile = await fetchProfile(fbUser.uid);
    currentSchool = currentProfile?.schoolId ? await fetchSchool(currentProfile.schoolId) : null;
    syncSubscriptionCookie(currentSchool);
    if (currentProfile?.schoolId) {
      // Re-render on every subsequent change so a suspension/expiry (or a
      // reactivation/renewal) shows up immediately without a page reload.
      // The callback itself does the routing work (see app.js's
      // onAuthChange wiring), so re-invoking it is what re-runs the router.
      watchCurrentSchool(currentProfile.schoolId, () => callback(currentProfile));
    }
    callback(currentProfile);
  });
}

async function fetchProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

async function fetchSchool(schoolId) {
  const snap = await getDoc(doc(db, "schools", schoolId));
  return snap.exists() ? { id: schoolId, ...snap.data() } : null;
}

export function getCurrentProfile() {
  return currentProfile;
}

// The logged-in user's own school doc, including its subscription fields
// - read by router.js's lock gate. Not cached via query-cache.js like most
// other reads, on purpose: the whole point is this can't go stale for
// longer than a page render, since it's the thing deciding whether the
// app is locked.
export function getCurrentSchool() {
  return currentSchool;
}

// Called right after activateSubscription() succeeds (school-settings.js)
// so the just-activated status is reflected immediately, without waiting
// for the next full sign-in.
export async function refreshCurrentSchool() {
  if (!currentProfile?.schoolId) return null;
  currentSchool = await fetchSchool(currentProfile.schoolId);
  syncSubscriptionCookie(currentSchool);
  return currentSchool;
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
  syncSubscriptionCookie(null);
  // So the next sign-in (possibly a different account/school in the same
  // tab) never reads another account's cached data out of query-cache.js.
  clearReadCache();
}

export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

export function changeOwnPassword(newPassword) {
  return updatePassword(auth.currentUser, newPassword);
}

// Used by the forced "you must set a new password" screen every fresh
// account (created by an admin, or by createSchool for a school's first
// admin) lands on until this runs once. Rotates the temp/handed-out
// password for a real secret only the user knows, then clears the flag
// so future logins go straight through.
export async function completeForcedPasswordChange(newPassword) {
  if (!auth.currentUser || !currentProfile) throw new Error("Not signed in.");
  // Force a fresh ID token before this sensitive call. Firebase requires a
  // genuinely recent sign-in for password changes; on a single-page app the
  // in-memory token can otherwise sit unrefreshed across a lot of in-app
  // navigation (no full reload ever happens), which is what was causing
  // 400s here until the page was manually refreshed. Refreshing it
  // ourselves means people never have to figure that out.
  await auth.currentUser.getIdToken(true);
  await updatePassword(auth.currentUser, newPassword);
  await setDoc(doc(db, "users", currentProfile.uid), { mustChangePassword: false }, { merge: true });
  currentProfile = { ...currentProfile, mustChangePassword: false };
  await logAction(currentProfile.uid, "forced_password_change", "auth", null);
  return currentProfile;
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
    invalidate(schoolUsersCacheKey(schoolId || getCurrentSchoolId()));
    await logAction(currentProfile?.uid, "create_user", "users", cred.user.uid);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth);
    await deleteApp(secondary);
  }
}

function schoolUsersCacheKey(schoolId) {
  return `school_users:${schoolId}`;
}

export async function listSchoolUsers(forceRefresh = false) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  // Read by the Audit Trail (to label each log with who did it) and by User
  // Management on every render - same cache-with-forceRefresh pattern as
  // listClasses()/listSubjects() in academic.service.js. Cleared entirely on
  // logout via clearReadCache() above, same as every other cached list.
  if (forceRefresh) invalidate(schoolUsersCacheKey(schoolId));
  return cached(schoolUsersCacheKey(schoolId), 5 * 60_000, async () => {
    const snap = await getDocs(query(collection(db, "users"), where("schoolId", "==", schoolId)));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  });
}

export async function setUserStatus(actingUserId, uid, status) {
  await setDoc(doc(db, "users", uid), { status }, { merge: true });
  invalidate(schoolUsersCacheKey(getCurrentSchoolId()));
  await logAction(actingUserId, `${status}_user`, "users", uid);
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