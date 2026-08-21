// ==========================================================================
// Login Approval Service
// Manages new-device login approval requests. Approvals are stored as
// Firestore subcollection docs under users/{uid}/login_approvals/{approvalId}.
// ==========================================================================

import {
  doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  serverTimestamp, onSnapshot, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

/**
 * Creates a new login approval request for an unrecognized device.
 * Adds a new doc with status 'pending'.
 * 
 * @param {string} uid - The user ID
 * @param {Object} deviceInfo - Contains deviceFingerprint, deviceName, screenRes, timezone
 * @returns {Promise<string>} - The ID of the newly created approval document
 */
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
 * Approves a login request.
 * Updates the document status to 'approved'.
 * 
 * @param {string} uid - The user ID of the account being accessed
 * @param {string} approvalId - The ID of the approval document
 * @param {string} approvedByUid - The user ID of the admin or owner granting approval
 */
export async function approveLogin(uid, approvalId, approvedByUid) {
  const docRef = doc(db, "users", uid, "login_approvals", approvalId);
  await updateDoc(docRef, {
    status: "approved",
    resolvedAt: serverTimestamp(),
    resolvedBy: approvedByUid
  });
  
  await logAction(approvedByUid, "approve_login", "login_approvals", approvalId);
}

/**
 * Denies a login request.
 * Updates the document status to 'denied'.
 * 
 * @param {string} uid - The user ID of the account being accessed
 * @param {string} approvalId - The ID of the approval document
 * @param {string} deniedByUid - The user ID of the admin or owner denying approval
 */
export async function denyLogin(uid, approvalId, deniedByUid) {
  const docRef = doc(db, "users", uid, "login_approvals", approvalId);
  await updateDoc(docRef, {
    status: "denied",
    resolvedAt: serverTimestamp(),
    resolvedBy: deniedByUid
  });
  
  await logAction(deniedByUid, "deny_login", "login_approvals", approvalId);
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
