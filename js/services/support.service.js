// Support Tickets: platform-level ticketing for schools to contact the super_admin.
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId, getCurrentSchool } from "./auth.service.js";

export async function raiseSupportTicket(userId, { subject, message }) {
  if (!subject) throw new Error("Subject is required.");
  if (!message) throw new Error("Message is required.");
  const schoolId = getCurrentSchoolId();
  if (!schoolId) throw new Error("Must be associated with a school to raise a ticket.");

  let school = getCurrentSchool();
  let schoolName = school?.schoolName || school?.name;
  if (!schoolName) {
    try {
      const snap = await getDoc(doc(db, "schools", schoolId));
      if (snap.exists()) {
        const data = snap.data();
        schoolName = data.schoolName || data.name;
      }
    } catch (e) {}
  }

  const ref_ = await addDoc(collection(db, "support_tickets"), {
    schoolId,
    schoolName: schoolName || "Unknown School",
    subject: subject.trim(),
    message: message.trim(),
    status: "open",
    raisedBy: userId,
    raisedAt: serverTimestamp(),
  });
  await logAction(userId, "raise_support_ticket", "support_tickets", ref_.id);
  return ref_.id;
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

export async function resolveSupportTicket(userId, id, resolutionNote) {
  await updateDoc(doc(db, "support_tickets", id), {
    status: "resolved",
    resolutionNote: (resolutionNote || "").trim(),
    resolvedBy: userId,
    resolvedAt: serverTimestamp(),
  });
  // Using try/catch for logAction since super_admin might not be logged properly if cross-school
  try {
    await logAction(userId, "resolve_support_ticket", "support_tickets", id);
  } catch (err) {}
}

export async function reopenSupportTicket(userId, id) {
  await updateDoc(doc(db, "support_tickets", id), {
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: "",
  });
  try {
    await logAction(userId, "reopen_support_ticket", "support_tickets", id);
  } catch (err) {}
}
