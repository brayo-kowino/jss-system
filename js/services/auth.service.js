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
import { auth, db, firebaseApp, attachAppCheck } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { cached, invalidate, clearAll as clearReadCache } from "./query-cache.js";

// ==========================================================================
// School-id cookie
// ==========================================================================
// A small, readable-by-JS (not HttpOnly - it's a routing hint, not a
// credential, and schoolId isn't sensitive - it's the same value visible
// in every Firestore doc path this session already reads) cookie carrying
// only the signed-in user's own schoolId. It exists for exactly one
// consumer: netlify/edge-functions/subscription-gate.ts, which uses it to
// look up that school's live status directly from Firestore (via the same
// service-account credential the subscription-issue/-activate edge
// functions already use) before deciding whether to serve the app shell
// at all.
//
// Earlier versions of this cookie carried the *computed* subscription
// status itself (active/suspended/locked), synced from getSubscriptionState()
// on every school snapshot change. That worked but had a real gap: the
// only code that could ever refresh that value ran *after* the app had
// loaded, so a stale "suspended" value had no way to self-correct once
// the edge function was the thing blocking that load. Carrying just the
// schoolId instead - a stable value that basically never changes for a
// signed-in user - and having the edge function ask Firestore directly
// removes that problem entirely: there's no computed status to go stale,
// so a reactivation takes effect on the school's very next request rather
// than waiting out a cookie TTL.
//
// Still purely a UI/perf optimization, never a security boundary - a
// stale, missing, or tampered schoolId can only ever cause the edge
// function to look up the wrong (or no) school, which falls through to
// serving the normal app shell (fail-open, see that file's header). The
// real enforcement stays exactly where it already was: firestore.rules'
// isSubscriptionActive(), live, server-side, and router.js's own lock
// gate, which still runs client-side on every render regardless of what
// this cookie says.
//
// Set once schoolId is known (sign-in) and cleared on sign-out - it
// doesn't need re-syncing on every school snapshot change like the old
// status cookie did, since the schoolId itself doesn't change while
// signed in. Kept for 30 days for the same reason - there's nothing
// time-sensitive being cached here anymore, just an identifier.
// ==========================================================================
const SCHOOL_ID_COOKIE = "jss_school_id";
const SCHOOL_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function syncSchoolIdCookie(schoolId) {
  if (typeof document === "undefined") return; // defensive - no-op outside a browser
  if (!schoolId) {
    // Signed out, or a super_admin (no schoolId) - nothing to gate on, so
    // make sure no stale value lingers from a previous session in the
    // same browser.
    document.cookie = `${SCHOOL_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${SCHOOL_ID_COOKIE}=${schoolId}; Path=/; Max-Age=${SCHOOL_ID_MAX_AGE_SECONDS}; SameSite=Lax`;
}

const PROFILE_STORAGE_KEY = "jss_cached_profile";
const SCHOOL_STORAGE_KEY = "jss_cached_school";

function readCachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null"); } catch { return null; }
}
function writeCachedProfile(profile) {
  try {
    if (profile) localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {}
}

function readCachedSchool() {
  try { return JSON.parse(localStorage.getItem(SCHOOL_STORAGE_KEY) || "null"); } catch { return null; }
}
function writeCachedSchool(school) {
  try {
    if (school) localStorage.setItem(SCHOOL_STORAGE_KEY, JSON.stringify(school));
    else localStorage.removeItem(SCHOOL_STORAGE_KEY);
  } catch {}
}

let currentProfile = readCachedProfile(); // cached { uid, ...firestore user doc }
let currentSchool = readCachedSchool();

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
      if (snap.exists()) {
        currentSchool = { id: schoolId, ...snap.data() };
        writeCachedSchool(currentSchool);
      }
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
      writeCachedProfile(null);
      writeCachedSchool(null);
      syncSchoolIdCookie(null);
      callback(null);
      return;
    }
    try {
      const liveProfile = await fetchProfile(fbUser.uid);
      if (liveProfile) {
        currentProfile = liveProfile;
        writeCachedProfile(currentProfile);
      } else if (!currentProfile || currentProfile.uid !== fbUser.uid) {
        currentProfile = readCachedProfile();
      }

      if (currentProfile?.schoolId) {
        const liveSchool = await fetchSchool(currentProfile.schoolId);
        if (liveSchool) {
          currentSchool = liveSchool;
          writeCachedSchool(currentSchool);
        } else if (!currentSchool) {
          currentSchool = readCachedSchool();
        }
      } else {
        currentSchool = null;
      }
    } catch (err) {
      // Offline fallback: if Firestore reads fail, fall back to cached profile/school in localStorage
      const cachedProf = readCachedProfile();
      if (cachedProf && cachedProf.uid === fbUser.uid) {
        currentProfile = cachedProf;
        currentSchool = readCachedSchool();
      } else {
        currentProfile = null;
        currentSchool = null;
        writeCachedProfile(null);
        writeCachedSchool(null);
        syncSchoolIdCookie(null);
        const { errorToast } = await import("../error-handler.js");
        errorToast(err, { where: "auth.onAuthChange.fetchProfile" });
        callback(null);
        return;
      }
    }

    if (!currentProfile) {
      callback(null);
      return;
    }

    // Set once here, not re-synced on every school snapshot change below -
    // schoolId itself doesn't change while signed in, unlike the old
    // status cookie this replaced (see the comment above
    // syncSchoolIdCookie() for why that distinction matters).
    syncSchoolIdCookie(currentProfile?.schoolId || null);
    if (currentProfile?.schoolId && navigator.onLine) {
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
  if (!snap.exists()) return null;
  return { id: schoolId, ...snap.data() };
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

// And on explicit sign-in/switch: refresh currentSchool if we have one.
// Called right after fetchProfile() inside login() below and after any
// direct schoolId assignment.
export async function refreshCurrentSchool() {
  if (!currentProfile?.schoolId) return null;
  currentSchool = await fetchSchool(currentProfile.schoolId);
  if (currentSchool) writeCachedSchool(currentSchool);
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
  writeCachedProfile(profile);
  if (profile.schoolId) {
    const school = await fetchSchool(profile.schoolId);
    if (school) {
      currentSchool = school;
      writeCachedSchool(school);
    }
  }
  await logAction(profile.uid, "login", "auth", null);
  return profile;
}

export async function logout() {
  if (currentProfile) await logAction(currentProfile.uid, "logout", "auth", null);
  currentProfile = null;
  currentSchool = null;
  writeCachedProfile(null);
  writeCachedSchool(null);
  await signOut(auth);
  syncSchoolIdCookie(null);
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
  attachAppCheck(secondary);
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