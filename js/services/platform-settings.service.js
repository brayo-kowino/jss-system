// ==========================================================================
// Platform Settings Service (Super Admin Only)
// Manages global platform security, email configuration, trial defaults, and operator profile.
// ==========================================================================

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

const DEFAULT_SECURITY_SETTINGS = {
  // Device approval is disabled by default for platform admin so logging in across
  // different devices (phone, laptop, home PC) works seamlessly without approval locks.
  requireDeviceApproval: false,
  twoFactorRequiredForStaff: false,
  sessionTimeoutMins: 60,
  allowedAdminIps: "",
};

const DEFAULT_EMAIL_SETTINGS = {
  senderName: "Eeskia Platform Operations",
  senderEmail: "support@eeskia.iskify360.tech",
  replyTo: "support@eeskia.iskify360.tech",
  enableServiceAlertEmails: true,
  enableSubscriptionReminderEmails: true,
};

export async function getPlatformSecuritySettings() {
  try {
    const snap = await getDoc(doc(db, "platform_settings", "security"));
    if (snap.exists()) {
      return { ...DEFAULT_SECURITY_SETTINGS, ...snap.data() };
    }
  } catch (err) {
    console.warn("getPlatformSecuritySettings: failed to read, using defaults", err);
  }
  return { ...DEFAULT_SECURITY_SETTINGS };
}

export async function savePlatformSecuritySettings(superAdminUid, settings) {
  const ref = doc(db, "platform_settings", "security");
  const payload = {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedBy: superAdminUid,
  };
  await setDoc(ref, payload, { merge: true });
  await logAction(superAdminUid, "update_platform_security_settings", "platform_settings", "security");
  return payload;
}

export async function getPlatformEmailSettings() {
  try {
    const snap = await getDoc(doc(db, "platform_settings", "email"));
    if (snap.exists()) {
      return { ...DEFAULT_EMAIL_SETTINGS, ...snap.data() };
    }
  } catch (err) {
    console.warn("getPlatformEmailSettings: failed to read, using defaults", err);
  }
  return { ...DEFAULT_EMAIL_SETTINGS };
}

export async function savePlatformEmailSettings(superAdminUid, settings) {
  const ref = doc(db, "platform_settings", "email");
  const payload = {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedBy: superAdminUid,
  };
  await setDoc(ref, payload, { merge: true });
  await logAction(superAdminUid, "update_platform_email_settings", "platform_settings", "email");
  return payload;
}

export async function getPlatformTrialConfig() {
  try {
    const snap = await getDoc(doc(db, "platform_settings", "trial"));
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.warn("getPlatformTrialConfig: failed to read", err);
  }
  return {
    defaultTrialDays: 30,
    maxExtensions: 2,
    extensionDays: 7,
    gracePeriodDays: 3,
    autoTrialOnCreate: true,
    warningThresholds: [7, 3, 1],
  };
}

export async function savePlatformTrialConfig(superAdminUid, config) {
  const ref = doc(db, "platform_settings", "trial");
  const payload = {
    ...config,
    updatedAt: serverTimestamp(),
    updatedBy: superAdminUid,
  };
  await setDoc(ref, payload, { merge: true });
  await logAction(superAdminUid, "update_platform_trial_config", "platform_settings", "trial");
  return payload;
}
