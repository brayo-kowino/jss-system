// ==========================================================================
// Login Approval Service
// Manages new-device login approval requests. Approvals are stored as
// Firestore subcollection docs under users/{uid}/login_approvals/{approvalId}.
//
// Creating a 'pending' request is still a direct client write (harmless -
// see firestore.rules). Deciding a request (approve/deny) and redeeming an
// approved one into an actual trusted device now go through
// netlify/edge-functions/login-approval-approve.ts and
// login-approval-redeem.ts - firestore.rules denies any client update on
// this collection outright now.
// ==========================================================================

import {
  doc, addDoc, getDoc, getDocs, deleteDoc,
  collection, query, where, orderBy, limit,
  serverTimestamp, onSnapshot, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

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
 * Creates a new login approval request for an unrecognized device.
 * Adds a new doc with status 'pending'. Still a plain client write -
 * firestore.rules requires status/resolvedAt/resolvedBy to be exactly
 * 'pending'/null/null on create, so this can never masquerade as an
 * already-decided request.
 *
 * @param {string} uid - The user ID
 * @param {Object} deviceInfo - Contains deviceFingerprint, deviceName, screenRes, timezone
 * @returns {Promise<string>} - The ID of the newly created approval document
 */
/**
 * Returns an existing pending approval for this exact device fingerprint if
 * one exists, otherwise creates a new one. Used both by login() (first
 * sign-in from an unknown device) and by the router-level gate (every
 * subsequent navigation/refresh while still unapproved) so the two don't
 * race into creating duplicate pending requests for the same device.
 *
 * @param {string} uid
 * @param {string} fingerprint
 * @param {Object} deviceInfo
 * @returns {Promise<string>} approvalId
 */
export async function findOrCreatePendingApproval(uid, fingerprint, deviceInfo) {
  try {
    const approvalsRef = collection(db, "users", uid, "login_approvals");
    const q = query(approvalsRef, where("status", "==", "pending"));
    const snap = await getDocs(q);
    const existing = snap.docs.find((d) => d.data().deviceFingerprint === fingerprint);
    if (existing) return existing.id;
  } catch (e) {
    console.warn("findOrCreatePendingApproval lookup failed:", e);
  }
  return createLoginApproval(uid, { ...deviceInfo, deviceFingerprint: fingerprint });
}

export async function createLoginApproval(uid, deviceInfo) {
  const approvalsRef = collection(db, "users", uid, "login_approvals");
  const docRef = await addDoc(approvalsRef, {
    deviceFingerprint: deviceInfo.deviceFingerprint || "",
    deviceName: deviceInfo.deviceName || "Unknown Device",
    screenRes: deviceInfo.screenRes || "Unknown",
    timezone: deviceInfo.timezone || "Unknown",
    status: "pending",
    requestedAt: serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null
  });

  // Log the creation (best-effort, non-blocking)
  logAction(uid, "create_login_approval", "login_approvals", docRef.id).catch(console.error);

  return docRef.id;
}

/**
 * Real-time onSnapshot listener on a single approval doc.
 * Used by the WAITING screen to detect when approval is granted or denied.
 * The status field this reports can now only ever have been set by
 * login-approval-approve.ts (service-account write) - there's no client
 * path left that could set it, so this listener is safe to trust.
 *
 * @param {string} uid - The user ID
 * @param {string} approvalId - The ID of the approval document
 * @param {Function} callback - Called on every change with the approval document data
 * @returns {Function} - The unsubscribe function to detach the listener
 */
export function watchLoginApproval(uid, approvalId, callback) {
  const docRef = doc(db, "users", uid, "login_approvals", approvalId);
  return onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, ...snap.data() });
    } else {
      callback(null);
    }
  });
}

/**
 * Real-time onSnapshot listener on the subcollection filtered by status == 'pending'.
 * Used by the PRIMARY device's shell to show incoming approval requests.
 *
 * @param {string} uid - The user ID
 * @param {Function} callback - Called on every change with an array of pending approvals
 * @returns {Function} - The unsubscribe function to detach the listener
 */
export function watchPendingApprovals(uid, callback) {
  const approvalsRef = collection(db, "users", uid, "login_approvals");
  const q = query(approvalsRef, where("status", "==", "pending"));
  return onSnapshot(q, (snap) => {
    const pendingApprovals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(pendingApprovals);
  });
}

/**
 * Approves a login request via /login-approval-approve. Must be called
 * from a session sitting on an already-trusted device for this account -
 * the server independently verifies that (and a fresh 2FA code, if the
 * account has 2FA enabled) before flipping status.
 *
 * @param {string} uid - The user ID of the account being accessed
 * @param {string} approvalId - The ID of the approval document
 * @param {string} approverFingerprint - The fingerprint of the device approving (must be already-trusted)
 * @param {string} [stepUpToken] - Required when the account has 2FA enabled - from two-factor.service.js's verify2FAForStepUp()
 */
export async function approveLogin(uid, approvalId, approverFingerprint, stepUpToken) {
  await callFunction("/login-approval-approve", {
    approvalId,
    decision: "approved",
    approverFingerprint,
    stepUpToken,
  });
}

/**
 * Denies a login request via /login-approval-approve.
 *
 * @param {string} uid - The user ID of the account being accessed
 * @param {string} approvalId - The ID of the approval document
 * @param {string} approverFingerprint - The fingerprint of the device denying (must be already-trusted)
 * @param {string} [stepUpToken] - Required when the account has 2FA enabled
 */
export async function denyLogin(uid, approvalId, approverFingerprint, stepUpToken) {
  await callFunction("/login-approval-approve", {
    approvalId,
    decision: "denied",
    approverFingerprint,
    stepUpToken,
  });
}

/**
 * Called by the WAITING device once it observes status === 'approved'.
 * Re-verifies the approval server-side (never trusts the polled status
 * alone) and, only then, registers this device as trusted via
 * /login-approval-redeem.
 *
 * @param {string} uid - The user ID
 * @param {string} approvalId - The ID of the approval document
 * @param {string} fingerprint - This device's own fingerprint
 * @param {Object} deviceInfo - This device's own info
 */
export async function redeemLoginApproval(uid, approvalId, fingerprint, deviceInfo) {
  await callFunction("/login-approval-redeem", { approvalId, fingerprint, deviceInfo });
  // Same reasoning as device.service.js's registerTrustedDevice(): this
  // just granted deviceApprovedUntil server-side, so the waiting device's
  // current token needs to be swapped for one that actually carries it.
  if (auth.currentUser) {
    try {
      await auth.currentUser.getIdToken(true);
    } catch (err) {
      console.error("redeemLoginApproval: token refresh after grant failed:", err);
    }
  }
}

/**
 * Fetches recent approval docs ordered by requestedAt desc.
 * Used for the security settings activity log.
 *
 * @param {string} uid - The user ID
 * @param {number} count - Maximum number of records to return (defaults to 20)
 * @returns {Promise<Array>} - List of recent approvals
 */
export async function listRecentApprovals(uid, count = 20) {
  const approvalsRef = collection(db, "users", uid, "login_approvals");
  const q = query(approvalsRef, orderBy("requestedAt", "desc"), limit(count));
  const snap = await getDocs(q);

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Deletes approval docs older than 30 days.
 * This is designed to be fire-and-forget and should be called lazily (e.g., on login)
 * without awaiting its completion to avoid blocking the user flow.
 *
 * @param {string} uid - The user ID
 */
export async function cleanupOldApprovals(uid) {
  try {
    const approvalsRef = collection(db, "users", uid, "login_approvals");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const q = query(approvalsRef, where("requestedAt", "<", cutoffTimestamp));
    const snap = await getDocs(q);

    // Delete all matched old docs in parallel
    const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.allSettled(deletePromises);
  } catch (error) {
    // Fail silently so it doesn't interrupt the consumer (e.g. login flow)
    console.warn("Failed to cleanup old login approvals:", error);
  }
}
