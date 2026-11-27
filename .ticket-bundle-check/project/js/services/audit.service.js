// Audit trail: append-only log of who did what, when.
// Collection "audit_logs": { schoolId, userId, action, entity, entityId, timestamp }
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
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
  // Sort/limit natively in Firestore so we only ever download `count` docs,
  // rather than pulling the whole audit_logs collection and slicing in JS
  // (that pattern crashes the app once the collection grows past a few
  // thousand entries). Requires a composite index on
  // (schoolId ==, timestamp desc) - Firestore will surface a
  // console link to create it the first time this runs if missing.
  const snap = await getDocs(
    query(
      collection(db, "audit_logs"),
      where("schoolId", "==", schoolId),
      orderBy("timestamp", "desc"),
      limit(count)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Time-bounded fetch for the Audit Trail page. Pushes the "how far back"
// filter into the Firestore query itself (schoolId ==, timestamp >=,
// timestamp desc) instead of pulling a fixed batch of docs and filtering
// client-side - so picking "Last hour" actually reads ~10-50 docs instead
// of paying for a 1000-doc fetch every time regardless of range.
// Requires a composite index on (schoolId ==, timestamp >=, timestamp desc);
// Firestore will surface a console link to create it the first time this
// runs if missing.
export async function fetchLogsSince(sinceMs, count = 500) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return [];
  const snap = await getDocs(
    query(
      collection(db, "audit_logs"),
      where("schoolId", "==", schoolId),
      where("timestamp", ">=", Timestamp.fromMillis(sinceMs)),
      orderBy("timestamp", "desc"),
      limit(count)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
      where("entityId", "==", entityId),
      orderBy("timestamp", "desc"),
      limit(count)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  result_releases: "visibility",
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
  login_approvals: "verified_user",
  trusted_devices: "devices",
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
  release_results: "visibility",
  unrelease_results: "visibility_off",
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
  // Admin account protection
  register_device: "devices",
  remove_device: "device_reset",
  reset_all_devices: "delete_sweep",
  create_login_approval: "new_window",
  approve_login: "check_circle",
  deny_login: "block",
  enable_2fa: "lock",
  disable_2fa: "lock_open",
  use_2fa_backup_code: "vpn_key",
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