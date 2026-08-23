// ==========================================================================
// Device Service
// Handles device fingerprinting and trusted device management.
// Used for security checks to ensure users log in from recognized devices,
// and to manage multi-factor authentication fallback paths.
//
// The fingerprint is deterministic per browser/device profile but includes a
// localStorage salt so that clearing browser data resets the fingerprint
// (forcing re-approval, which is a security feature).
//
// registerTrustedDevice() below now calls the /device-register edge
// function (netlify/edge-functions/device-register.ts) instead of writing
// straight to Firestore - firestore.rules no longer allows a client write
// to users/{uid}/trusted_devices/{deviceId} at all (see that match block).
// The edge function requires a recently-issued ID token (i.e. a genuine
// password entry a few minutes ago) or genuine first-device bootstrap -
// see that file's header for why.
// ==========================================================================
import {
  doc, getDoc, getDocs, deleteDoc, setDoc,
  collection, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

const DEVICE_SALT_KEY = 'jss_device_salt';

// FNV-1a simple 32-bit hash
function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function getOrGenerateSalt() {
  try {
    let salt = localStorage.getItem(DEVICE_SALT_KEY);
    if (!salt) {
      salt = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem(DEVICE_SALT_KEY, salt);
    }
    return salt;
  } catch {
    return "jss_default_salt";
  }
}

/**
 * Generates a device fingerprint by hashing stable device characteristics
 * combined with a local salt.
 * @returns {string} Hex string fingerprint
 */
export function generateDeviceFingerprint() {
  const salt = getOrGenerateSalt();
  const screenRes = (typeof window !== "undefined" && window.screen)
    ? `${window.screen.width || 0}x${window.screen.height || 0}x${window.screen.colorDepth || 0}`
    : "screen";
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {}
  const platform = (typeof navigator !== "undefined" && navigator.platform) || "unknown";
  const language = (typeof navigator !== "undefined" && navigator.language) || "unknown";
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "unknown";

  const raw = [salt, screenRes, tz, platform, language, ua].join("|");
  return fnv1a(raw);
}

// Basic user-agent parsing for human-readable device info
function parseUserAgent(ua = "") {
  let browser = "Unknown Browser";
  let os = "Unknown OS";

  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";

  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "Mac OS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iOS") || ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return { browser, os };
}

/**
 * Returns human-readable details about the current device.
 * Guarantees clean string fields so Firestore writes never fail with undefined values.
 * @returns {Object} Device info object
 */
export function getDeviceInfo() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const { browser = "Unknown Browser", os = "Unknown OS" } = parseUserAgent(ua);
  const screenRes = (typeof window !== "undefined" && window.screen)
    ? `${window.screen.width || 0}x${window.screen.height || 0}`
    : "Unknown";
  let timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {}
  return {
    deviceName: `${browser} on ${os}`,
    screenRes,
    timezone,
    browser,
    os,
  };
}

async function callFunction(path, payload) {
  if (!auth.currentUser) throw new Error("You must be signed in.");
  const idToken = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
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

/**
 * Registers the CALLER's own current device as trusted, via the
 * /device-register edge function. Only ever registers the signed-in
 * caller's own device - uid is implicit from the caller's ID token, not a
 * parameter, so this can no longer be used to register a device on behalf
 * of a different account (which is also why the login-approval "approve"
 * flow in shell.js no longer calls this directly - see
 * login-approval.service.js's redeemLoginApproval() instead).
 */
export async function registerTrustedDevice(uid, fingerprint, deviceInfo = {}, isPrimary = false) {
  if (!fingerprint) return;
  await callFunction("/device-register", { fingerprint: String(fingerprint), deviceInfo, isPrimary: Boolean(isPrimary) });
  // device-register.ts just minted deviceApprovedUntil on this account.
  // Without forcing a refresh here, this browser keeps using its old
  // token - which has no such claim - and every Firestore read/write
  // gated by isFullyVerified() in firestore.rules keeps failing for up to
  // an hour, even though the grant already succeeded server-side.
  if (auth.currentUser) {
    try {
      await auth.currentUser.getIdToken(true);
    } catch (err) {
      console.error("registerTrustedDevice: token refresh after grant failed:", err);
    }
  }
}

/**
 * Checks if a specific device fingerprint is registered as trusted for the user.
 */
export async function isDeviceTrusted(uid, fingerprint) {
  if (!uid || !fingerprint) return false;
  try {
    const docRef = doc(db, "users", uid, "trusted_devices", String(fingerprint));
    const snap = await getDoc(docRef);
    return snap.exists();
  } catch (err) {
    console.error("isDeviceTrusted check failed:", err);
    return false;
  }
}

/**
 * Gets the primary trusted device for a user, if one exists.
 */
export async function getPrimaryDevice(uid) {
  const q = query(
    collection(db, "users", uid, "trusted_devices"),
    where("isPrimary", "==", true)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Lists all registered trusted devices for a user.
 */
export async function listTrustedDevices(uid) {
  const snap = await getDocs(collection(db, "users", uid, "trusted_devices"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Removes a trusted device. Still a direct client delete - firestore.rules
 * continues to allow this for the account owner/admin/super_admin, since
 * *removing* trust (forcing a future re-approval) isn't the sensitive
 * direction; only *granting* it is.
 */
export async function removeTrustedDevice(uid, deviceId) {
  await deleteDoc(doc(db, "users", uid, "trusted_devices", deviceId));
  await logAction(uid, "remove_device", "users", deviceId);
}

/**
 * Resets (removes) all trusted devices for a user. Admin action.
 */
export async function resetAllTrustedDevices(uid) {
  const devices = await listTrustedDevices(uid);
  for (const device of devices) {
    await deleteDoc(doc(db, "users", uid, "trusted_devices", device.id));
  }
  await logAction(uid, "reset_all_devices", "users", uid);
}

/**
 * Updates the last seen timestamp for a trusted device. Still a direct
 * client write via setDoc's merge - firestore.rules' `allow create, update:
 * if false` on trusted_devices blocks this too now, same as everything
 * else on that collection, so this best-effort call will fail silently
 * (callers already treat it as fire-and-forget). Left in place rather than
 * removed so lastSeenAt simply stops updating rather than throwing - a
 * cosmetic regression, not a security one, and worth revisiting by adding
 * a narrow allow-update-lastSeenAt-only rule if it's wanted back.
 */
export async function updateLastSeen(uid, fingerprint) {
  try {
    const docRef = doc(db, "users", uid, "trusted_devices", fingerprint);
    await setDoc(docRef, { lastSeenAt: serverTimestamp() }, { merge: true });
  } catch {
    // Expected now that trusted_devices denies client writes outright -
    // see comment above.
  }
}
