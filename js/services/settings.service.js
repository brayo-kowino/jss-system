// School settings: one document per school at schools/{schoolId}. This
// same collection is also the schools *registry* the super_admin manages
// from school.service.js - this file only ever touches the logged-in
// user's own school (via getCurrentSchoolId()).
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { uploadToCloudinary } from "./cloudinary.service.js";
import { cached, invalidate } from "./query-cache.js";

export const DEFAULT_GRADING_SCALE = [
  { min: 90, max: 100, grade: "EE1", points: 8, remark: "Exceeding Expectations" },
  { min: 75, max: 89, grade: "EE2", points: 7, remark: "Exceeding Expectations" },
  { min: 58, max: 74, grade: "ME1", points: 6, remark: "Meeting Expectations" },
  { min: 41, max: 57, grade: "ME2", points: 5, remark: "Meeting Expectations" },
  { min: 31, max: 40, grade: "AE1", points: 4, remark: "Approaching Expectations" },
  { min: 21, max: 30, grade: "AE2", points: 3, remark: "Approaching Expectations" },
  { min: 11, max: 20, grade: "BE1", points: 2, remark: "Below Expectations" },
  { min: 0, max: 10, grade: "BE2", points: 1, remark: "Below Expectations" },
];

export const DEFAULT_SETTINGS = {
  schoolName: "",
  motto: "",
  address: "",
  phone: "",
  email: "",
  logoUrl: "",
  // Public login code (e.g. "greenhill") - lets this school's users reach a
  // pre-branded login screen via a direct link, and is looked up from the
  // school_public/{slug} doc below *before* anyone signs in. Empty until
  // the admin sets one (or one is auto-generated at school creation).
  slug: "",
  // Branding/customization - used to theme this school's shell (sidebar,
  // buttons, report card letterhead) once it's set from School Settings.
  themeColor: "#14538A",
  secondaryColor: "#C9A227",
  // Which preset from js/theme-presets.js is active ("custom" if the
  // colors above were hand-picked rather than installed as a preset).
  themeId: "navy-gold",
  // Leadership - surfaces on newsletters, notices and report card
  // signatures (e.g. "[Principal's Name]" in views/notifications.js).
  principalName: "",
  principalTitle: "Principal",
  deputyPrincipalName: "",
  deputyPrincipalTitle: "Deputy Principal",
  currentAcademicYear: new Date().getFullYear().toString(),
  terms: ["Term 1", "Term 2", "Term 3"],
  currentTerm: "Term 1",
  closingDate: "",
  openingDate: "",
  gradingScale: DEFAULT_GRADING_SCALE,
  status: "active",
  // Subscription fields live on this same doc but are never set here or by
  // any client write - only subscription-issue.ts/subscription-activate.ts
  // (via their service-account credential) ever set them for real. This
  // default just means a school that's never been activated reads back an
  // explicit "inactive" rather than undefined everywhere that checks it.
  subscriptionStatus: "inactive",
  // Settings for external notification APIs
  notificationProviders: {
    gmail: { address: "", appPassword: "" },
    africasTalking: { username: "", apiKey: "", senderId: "" }
  }
};

function schoolDocRef(schoolId) {
  const id = schoolId || getCurrentSchoolId();
  if (!id) throw new Error("No school selected for this account. Contact your administrator.");
  return doc(db, "schools", id);
}

export async function getSchoolSettings(schoolId, forceRefresh = false) {
  const id = schoolId || getCurrentSchoolId();
  // Read on almost every view (theming, letterhead, grading scale) but
  // changes only from the School Settings page - cache for a few minutes
  // rather than re-fetching it on every navigation. forceRefresh lets a
  // caller that just saved settings skip past a still-fresh cache entry.
  if (forceRefresh) invalidate(`school_settings:${id}`);
  return cached(`school_settings:${id}`, 60 * 60_000, async () => {
    const snap = await getDoc(schoolDocRef(id));
    // Merge over the defaults so any field never actually saved to Firestore
    // still comes back populated, instead of silently returning as undefined.
    if (!snap.exists()) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...snap.data() };
  });
}

export async function saveSchoolSettings(userId, data) {
  const schoolId = getCurrentSchoolId();
  await setDoc(schoolDocRef(schoolId), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  invalidate(`school_settings:${schoolId}`);
  await logAction(userId, "update_settings", "schools", schoolId);
}

export async function uploadSchoolLogo(file) {
  return uploadToCloudinary(file, `schools/${getCurrentSchoolId()}/logo`);
}

// ===========================================================================
// Public login branding
// A school's full settings doc (schools/{id}) requires being signed in as
// its own staff to read - correct for the operational data it also holds
// (grading scale, calendar, etc.), but that means the login screen has no
// way to know which school a visitor belongs to before they've signed in.
// school_public/{slug} is a deliberately narrow, publicly-readable mirror
// of just the cosmetic fields (name/logo/colors), keyed by the school's
// human-friendly code instead of its Firestore doc ID, so an anonymous
// visitor can look up "greenhill" and get back just enough to render a
// branded sign-in page - nothing operational or sensitive.
// ===========================================================================

// Every school's login code is prefixed with this so links are
// recognizable as belonging to our system at a glance (e.g.
// "ees-greenhill-jss"). Single source of truth - both the School Settings
// slug editor and the login screen's manual code entry need to agree on
// it, since a code typed without the prefix will never match a stored
// school_public/{slug} doc.
export const SLUG_PREFIX = "ees";

// Normalizes any input into a URL/doc-ID-safe code: lowercase letters,
// digits and single hyphens only, capped at 40 chars.
export function slugify(str = "") {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// A slug is available if no school_public doc uses it yet, or if the only
// doc using it already belongs to excludeSchoolId (so a school checking
// its own current code doesn't get told it's taken).
export async function isSlugAvailable(slug, excludeSchoolId) {
  const clean = slugify(slug);
  if (!clean) return false;
  const snap = await getDoc(doc(db, "school_public", clean));
  if (!snap.exists()) return true;
  return excludeSchoolId ? snap.data().schoolId === excludeSchoolId : false;
}

// Public, unauthenticated lookup used by the login screen. Returns null for
// an unknown code or a school that isn't currently active, so a suspended
// school's page doesn't reveal itself to anonymous visitors.
export async function getSchoolBySlug(slug) {
  const clean = slugify(slug);
  if (!clean) return null;
  const snap = await getDoc(doc(db, "school_public", clean));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.status !== "active") return null;
  return { slug: clean, ...data };
}

// Mirrors the cosmetic subset of a school's settings into school_public/
// {slug} so the login page can find them. Pass previousSlug when the code
// itself changed, so the old doc gets cleaned up rather than left as a
// stale duplicate pointing at the same school.
export async function publishSchoolBranding(schoolId, { slug, previousSlug, schoolName, motto, logoUrl, themeColor, secondaryColor, status } = {}) {
  const clean = slugify(slug);
  if (!clean) return;
  await setDoc(doc(db, "school_public", clean), {
    schoolId,
    schoolName: schoolName || "",
    motto: motto || "",
    logoUrl: logoUrl || "",
    themeColor: themeColor || "#14538A",
    secondaryColor: secondaryColor || "#C9A227",
    status: status || "active",
    updatedAt: serverTimestamp(),
  });
  const cleanPrevious = slugify(previousSlug || "");
  if (cleanPrevious && cleanPrevious !== clean) {
    await deleteDoc(doc(db, "school_public", cleanPrevious)).catch(() => {});
  }
}