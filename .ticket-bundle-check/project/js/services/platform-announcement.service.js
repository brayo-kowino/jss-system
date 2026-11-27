// ==========================================================================
// Platform announcements (client side).
// ==========================================================================
// Collection "platform_announcements": { title, message, severity, active,
//   createdAt, createdBy, updatedAt, updatedBy, expiresAt? }
//
// This is deliberately a separate collection from "notifications"
// (js/services/notification.service.js), which is per-school and aimed at
// parents (SMS/email/WhatsApp queue). This one is the platform operator
// (super_admin) talking to every school's staff at once - "we're doing
// scheduled maintenance Sunday night", "SMS delivery is degraded, we're on
// it", "please take our 2-minute survey" - and shows up as a dismissible
// banner in the app shell (js/components/announcement-banner.js) rather
// than in anyone's Notifications inbox. firestore.rules enforces the write
// side (super_admin only); everything here is a thin client wrapper plus
// the small amount of shared logic (active-and-not-expired, dismiss-key)
// both the banner and the management page need to agree on.
// ==========================================================================
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { cached, invalidate } from "./query-cache.js";
import { dispatchPush } from "./fcm.service.js";

// Reads the same dismissed-announcements set that announcement-banner.js
// writes, so there is exactly one source of truth for "has the user seen
// this announcement already."
const DISMISSED_KEY = "jss_dismissed_announcements";
function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

// How many currently-live announcements has the user NOT yet dismissed?
// Used by the shell to add the announcement count into the badge total.
export function countUndismissedAnnouncements() {
  try {
    const dismissed = readDismissed();
    // We only have the cached list synchronously if listAllAnnouncements()
    // was already called (announcement-banner.js fires this on every shell
    // mount). If the cache is cold this returns 0 rather than hanging —
    // the live subscriber below will correct it within a few seconds.
    const raw = localStorage.getItem("jss_pa_live_ids");
    if (!raw) return 0;
    const liveIds = JSON.parse(raw);
    return liveIds.filter((key) => !dismissed.has(key)).length;
  } catch {
    return 0;
  }
}

// Live listener on platform_announcements filtered to active == true.
// Calls callback(announcements[]) whenever a doc changes. Returns an
// unsubscribe function — callers MUST call it on teardown.
// Also writes a compact "live ids" cache to localStorage so
// countUndismissedAnnouncements() has something to work with synchronously.
export function subscribeToActiveAnnouncements(callback) {
  const q = query(
    collection(db, "platform_announcements"),
    where("active", "==", true),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const live = docs.filter(isCurrentlyLive);
    try {
      // Persist dismiss-keys so countUndismissedAnnouncements() is fast.
      localStorage.setItem("jss_pa_live_ids", JSON.stringify(live.map(dismissKey)));
    } catch {}
    callback(live);
  }, () => {});
}


export const SEVERITIES = [
  { value: "info", label: "Info", icon: "info", description: "General notice - a survey, a heads-up, nothing broken." },
  { value: "warning", label: "Warning", icon: "warning", description: "Something needs attention - a scheduled maintenance window, a feature going away." },
  { value: "critical", label: "Critical", icon: "error", description: "Something is actively broken right now - degraded/down service." },
];

export function severityMeta(severity) {
  return SEVERITIES.find((s) => s.value === severity) || SEVERITIES[0];
}

const CACHE_KEY = "platform_announcements:all";

// True for a doc that should currently be shown: marked active, and either
// no expiresAt or an expiresAt still in the future. Shared by the banner
// (which only wants live ones) and the management page (which shows the
// computed status next to each row).
export function isCurrentlyLive(a) {
  if (!a?.active) return false;
  if (!a.expiresAt) return true;
  const expiresAtMs = a.expiresAt.toMillis ? a.expiresAt.toMillis() : new Date(a.expiresAt).getTime();
  return expiresAtMs > Date.now();
}

// Every announcement ever created, newest first - used by the management
// page. Short TTL cache (same pattern as notification.service.js's
// listNotifications()) since this is a low-traffic collection an admin
// might reload a few times while composing/ending one; every write below
// invalidates it immediately so that's just a staleness ceiling, not
// something callers need to think about.
export async function listAllAnnouncements(forceRefresh = false) {
  if (forceRefresh) invalidate(CACHE_KEY);
  return cached(CACHE_KEY, 60_000, async () => {
    const snap = await getDocs(query(collection(db, "platform_announcements"), orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}

// Just the ones a banner should render. Fetches the same full list (this
// collection is expected to stay small - a handful of live docs at most,
// most schools will have zero) rather than adding a second composite
// index/query just to filter server-side.
export async function listActiveAnnouncements() {
  const all = await listAllAnnouncements();
  return all.filter(isCurrentlyLive);
}

export async function createAnnouncement(userId, { title, message, severity, expiresAt }) {
  const cleanTitle = (title || "").trim();
  const cleanMessage = (message || "").trim();
  if (!cleanTitle || !cleanMessage) throw new Error("Title and message are required.");
  if (!SEVERITIES.some((s) => s.value === severity)) throw new Error("Invalid severity.");

  const ref = await addDoc(collection(db, "platform_announcements"), {
    title: cleanTitle,
    message: cleanMessage,
    severity,
    active: true,
    expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
    createdAt: serverTimestamp(),
    createdBy: userId,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });
  invalidate(CACHE_KEY);
  await logAction(userId, "create_platform_announcement", "platform_announcements", ref.id);

  dispatchPush({
    title: cleanTitle,
    message: cleanMessage,
    isPlatformAnnouncement: true
  });

  return ref.id;
}

export async function updateAnnouncement(userId, id, { title, message, severity, expiresAt }) {
  const cleanTitle = (title || "").trim();
  const cleanMessage = (message || "").trim();
  if (!cleanTitle || !cleanMessage) throw new Error("Title and message are required.");
  if (!SEVERITIES.some((s) => s.value === severity)) throw new Error("Invalid severity.");

  await updateDoc(doc(db, "platform_announcements", id), {
    title: cleanTitle,
    message: cleanMessage,
    severity,
    expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });
  invalidate(CACHE_KEY);
  await logAction(userId, "update_platform_announcement", "platform_announcements", id);
}

// "End" rather than delete - flips active off (so it disappears from every
// banner on its next fetch) but keeps the row around in the management
// list as a record of what was announced and when. Matches the
// suspend/reactivate pattern schools.js already uses for schools/{id}.status.
export async function setAnnouncementActive(userId, id, active) {
  await updateDoc(doc(db, "platform_announcements", id), {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });
  invalidate(CACHE_KEY);
  await logAction(userId, active ? "resume_platform_announcement" : "end_platform_announcement", "platform_announcements", id);
}

export async function deleteAnnouncement(userId, id) {
  await deleteDoc(doc(db, "platform_announcements", id));
  invalidate(CACHE_KEY);
  await logAction(userId, "delete_platform_announcement", "platform_announcements", id);
}

// The localStorage key a dismissed banner is remembered under. Keyed by
// id *and* updatedAt so editing a previously-dismissed announcement (new
// wording, or re-activating an ended one) makes it reappear - a dismissal
// only ever means "I've seen this exact version," not "never show me
// anything with this id again."
export function dismissKey(a) {
  const updatedAtMs = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  return `${a.id}:${updatedAtMs}`;
}
