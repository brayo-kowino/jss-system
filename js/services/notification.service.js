// ==========================================================================
// Notification Service
// Handles SMS/Email queue records, audience resolution, and templating.
// collection "notifications": { schoolId, title, body, category, channel, 
//   audience: { type, grade?, studentIds?, label }, recipientCount, 
//   status: "queued" | "delivered", createdAt }
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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "../firebase-config.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { logAction } from "./audit.service.js";
import { cached, invalidate } from "./query-cache.js";

export const CATEGORIES = [
  { value: "fees", label: "Fee Balance Reminder" },
  { value: "results", label: "Results Published" },
  { value: "term_closing", label: "Term Closing" },
  { value: "term_opening", label: "Term Opening" },
  { value: "general", label: "Custom Announcement" },
];

export const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "app", label: "In-App" },
];

export function categoryMeta(category) {
  const map = {
    fees: { icon: "payments", label: "Fees" },
    results: { icon: "grading", label: "Results" },
    term_closing: { icon: "event_busy", label: "Term Closing" },
    term_opening: { icon: "event_available", label: "Term Opening" },
    general: { icon: "campaign", label: "General" },
    subscription: { icon: "workspace_premium", label: "Subscription" },
  };
  return map[category] || { icon: "notifications", label: "Notification" };
}

function notificationsCacheKey(schoolId) {
  return `notifications:${schoolId}`;
}

export async function listNotifications(forceRefresh = false) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  if (forceRefresh) invalidate(notificationsCacheKey(schoolId));
  return cached(notificationsCacheKey(schoolId), 2 * 60_000, async () => {
    const snap = await getDocs(
      query(collection(db, "notifications"), where("schoolId", "==", schoolId))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  });
}

export async function createNotification(userId, data) {
  const schoolId = getCurrentSchoolId();
  const ref = await addDoc(collection(db, "notifications"), {
    schoolId,
    title: data.title,
    body: data.body,
    category: data.category,
    channel: data.channel,
    audience: data.audience,
    recipientCount: data.recipients?.length || 0,
    status: "queued",
    createdAt: serverTimestamp(),
  });
  invalidate(notificationsCacheKey(schoolId));
  await logAction(userId, "send_notification", "notifications", ref.id);
  
  if (data.channel === "email" || data.channel === "sms") {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        await fetch("/.netlify/functions/dispatch-notifications", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${idToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ notificationId: ref.id, schoolId })
        });
        // Invalidate again now that the status has flipped to 'delivered'
        invalidate(notificationsCacheKey(schoolId));
      }
    } catch (err) {
      console.error("Failed to trigger notification dispatch:", err);
    }
  }
  
  return ref.id;
}

export async function setNotificationStatus(userId, id, status) {
  await updateDoc(doc(db, "notifications", id), { status });
  invalidate(notificationsCacheKey(getCurrentSchoolId()));
  await logAction(
    userId,
    status === "delivered" ? "deliver_notification" : "requeue_notification",
    "notifications",
    id
  );
}

export async function deleteNotification(userId, id) {
  await deleteDoc(doc(db, "notifications", id));
  invalidate(notificationsCacheKey(getCurrentSchoolId()));
  await logAction(userId, "delete_notification", "notifications", id);
}

// Computes the actual target parents based on the selected audience criteria
export function resolveRecipients(audience, { students, parents }) {
  let targetParentIds = new Set();

  if (audience.type === "all") {
    // Only return parents who actually have a contact method
    return parents.filter((p) => p.phone || p.email);
  }

  if (audience.type === "grade") {
    const gradeStudents = students.filter((s) => s.grade === audience.grade);
    for (const s of gradeStudents) {
      (s.parentIds || []).forEach((pid) => targetParentIds.add(pid));
    }
  } else if (audience.type === "individual") {
    const specificStudents = students.filter((s) =>
      (audience.studentIds || []).includes(s.id)
    );
    for (const s of specificStudents) {
      (s.parentIds || []).forEach((pid) => targetParentIds.add(pid));
    }
  }

  return parents.filter(
    (p) => targetParentIds.has(p.id) && (p.phone || p.email)
  );
}

// Pre-fills the compose modal depending on the quick-action template chosen
export function buildTemplate(category, ctx) {
  const termInfo = `${ctx.term || ""} ${ctx.academicYear || ""}`.trim();

  if (category === "fees") {
    return {
      title: `Fee Balance Reminder - ${termInfo}`,
      body: `Dear Parent/Guardian, this is a gentle reminder to clear pending fee balances for ${termInfo} to avoid inconveniences. Please contact the school for inquiries.`,
    };
  }
  if (category === "results") {
    return {
      title: `${termInfo} Results Published`,
      body: `Dear Parent/Guardian, the results for ${
        ctx.grade ? ctx.grade + " " : ""
      }${termInfo} have been published. You can view or collect the report card from the school.`,
    };
  }
  if (category === "term_closing") {
    return {
      title: `Term Closing - ${termInfo}`,
      body: `Dear Parent/Guardian, the school will close for ${termInfo}${
        ctx.closingDate ? " on " + ctx.closingDate : ""
      }. We wish the students a restful holiday.`,
    };
  }
  if (category === "term_opening") {
    return {
      title: `Term Opening Reminder`,
      body: `Dear Parent/Guardian, a reminder that the school opens for the new term${
        ctx.openingDate ? " on " + ctx.openingDate : ""
      }. We look forward to welcoming the students back.`,
    };
  }

  return { title: "", body: "" };
}