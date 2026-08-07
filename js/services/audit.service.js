// Audit trail: append-only log of who did what, when.
// Collection "audit_logs": { schoolId, userId, action, entity, entityId, timestamp }
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { getCurrentSchoolId } from "./auth.service.js";

export async function logAction(userId, action, entity, entityId) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      schoolId: getCurrentSchoolId(),
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
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  const snap = await getDocs(query(collection(db, "audit_logs"), where("schoolId", "==", schoolId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))
    .slice(0, count);
}

// One entity's history (e.g. every logged action against a single student),
// for an in-context activity trail rather than the whole school's feed.
export async function listLogsForEntity(entity, entityId, count = 30) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId || !entityId) return [];
  const snap = await getDocs(
    query(
      collection(db, "audit_logs"),
      where("schoolId", "==", schoolId),
      where("entity", "==", entity),
      where("entityId", "==", entityId)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Shared presentation helpers so every screen that renders a log entry (the
// dashboard's live activity feed, the full Audit Trail page, a student's
// activity tab, etc.) describes the same action the same way, instead of
// each screen keeping its own partial, easily-stale lookup table.
// ---------------------------------------------------------------------------

// Icon fallback by entity, used when there's no more specific action icon.
const ENTITY_ICON = {
  classes: "school",
  subjects: "menu_book",
  assessments: "assignment",
  attendance: "fact_check",
  auth: "login",
  users: "person",
  fees: "payments",
  fee_payments: "payments",
  results: "analytics",
  marks: "edit_note",
  parents: "family_restroom",
  schools: "apartment",
  students: "person",
  student_issues: "report",
  teachers: "badge",
  periods: "schedule",
  timetable_slots: "calendar_view_week",
  notifications: "notifications",
  newsletters: "newspaper",
};

// Icon overrides for specific actions where the entity-level icon isn't
// specific enough (e.g. every students-entity action shouldn't get the
// generic "person" icon).
const ACTION_ICON = {
  login: "login",
  logout: "logout",
  admit_student: "person_add",
  bulk_import_students: "upload_file",
  transfer_student: "sync_alt",
  promote_student: "trending_up",
  record_payment: "payments",
  set_fee_structure: "receipt_long",
  bulk_enter_marks: "edit_note",
  compute_results: "analytics",
  create_user: "person_add",
  create_school: "add_business",
  raise_student_issue: "report",
  resolve_student_issue: "check_circle",
  reopen_student_issue: "restart_alt",
  send_notification: "send",
  deliver_notification: "mark_email_read",
  requeue_notification: "undo",
  publish_newsletter: "publish",
  unpublish_newsletter: "unpublish",
};

export function describeLog(log) {
  const action = log.action || "unknown_action";
  const icon = ACTION_ICON[action] || ENTITY_ICON[log.entity] || "history";

  let color = "blue";
  if (/^(delete|remove|suspend|deactivate)/.test(action)) color = "red";
  else if (/^(create|add|admit|activate|resolve|send|publish)/.test(action)) color = "green";
  else if (/lock|suspend/.test(action)) color = "gold";

  const label = action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { icon, color, label };
}