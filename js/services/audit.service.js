// Audit trail: append-only log of who did what, when.
// Collection "audit_logs": { userId, action, entity, entityId, timestamp }
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";

export async function logAction(userId, action, entity, entityId) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      userId: userId || "unknown",
      action,
      entity,
      entityId: entityId || null,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Never let audit logging break the primary user action.
    console.error("Audit log failed:", err);
  }
}

export async function fetchRecentLogs(count = 50) {
  const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
