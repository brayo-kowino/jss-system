// Support Tickets: platform-level ticketing for schools to contact the super_admin.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "../firebase-config.js";
import { getCurrentSchoolId } from "./auth.service.js";

export async function submitSupportAction(action, ticketId, fields, requestId = crypto.randomUUID()) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in to use support tickets.");
  const response = await fetch("/.netlify/functions/support-ticket-action", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, action, ticketId, requestId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ticketId) throw new Error(data?.error || "Couldn’t save the ticket update. Please try again.");
  return data.ticketId;
}

export function raiseSupportTicket(fields, requestId) {
  return submitSupportAction("create", null, fields, requestId);
}

export async function getSupportTicket(id) {
  const ticket = await getDoc(doc(db, "support_tickets", id));
  return ticket.exists() ? { id: ticket.id, ...ticket.data() } : null;
}

export async function listSupportEvents(id) {
  const snapshot = await getDocs(query(collection(db, "support_tickets", id, "events"), orderBy("at")));
  return snapshot.docs.map((entry) => entry.data());
}

export async function listSupportUpdates(uid) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId || !uid) return [];
  const snapshot = await getDocs(query(collection(db, "users", uid, "support_updates"),
    where("schoolId", "==", schoolId), orderBy("createdAt", "desc"), limit(5)));
  return snapshot.docs.map((entry) => entry.data());
}

export async function listSchoolTickets() {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  const snap = await getDocs(
    query(collection(db, "support_tickets"), where("schoolId", "==", schoolId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.raisedAt?.seconds || 0) - (a.raisedAt?.seconds || 0));
}

export async function listAllPlatformTickets(statusFilter = null) {
  // super_admin only
  let q = collection(db, "support_tickets");
  if (statusFilter) {
    q = query(q, where("status", "==", statusFilter));
  }
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      // open tickets first, then sort by date
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (b.raisedAt?.seconds || 0) - (a.raisedAt?.seconds || 0);
    });
}

export async function listErrorLogs(codeQuery = null) {
  let q = collection(db, "error_logs");
  if (codeQuery) {
    q = query(q, where("code", "==", codeQuery), limit(10));
  } else {
    q = query(q, orderBy("createdAt", "desc"), limit(50));
  }
  const snap = await getDocs(q);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
