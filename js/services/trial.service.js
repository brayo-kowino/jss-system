// ==========================================================================
// Trial Service
// Handles fetching trial configuration, computing trial state for a school,
// and making edge function calls for super admin operations.
// ==========================================================================
import { db, auth } from "../firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { toast } from "../utils.js";

let configCache = null;
let configCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Read platform-wide trial config. Caches for 5 minutes.
 */
export async function getTrialConfig() {
  const now = Date.now();
  if (configCache && now - configCacheTime < CACHE_TTL) {
    return configCache;
  }

  try {
    const docRef = doc(db, "platform_settings", "trial");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      configCache = docSnap.data();
      configCacheTime = now;
      return configCache;
    }
  } catch (err) {
    console.error("Failed to load trial config:", err);
  }

  // Fallback defaults if doc is missing or unreadable
  return {
    defaultTrialDays: 30,
    maxExtensions: 2,
    extensionDays: 7,
    gracePeriodDays: 3,
    autoTrialOnCreate: true,
    trialFeatureTier: "growth",
    enableTrialBanner: true,
    warningThresholds: [7, 3, 1]
  };
}

export function clearTrialConfigCache() {
  configCache = null;
  configCacheTime = 0;
}

/**
 * Compute trial display state from a school doc
 */
export function getTrialState(school) {
  const state = {
    onTrial: school.subscriptionStatus === "trial",
    trialExpired: false,
    inGracePeriod: false,
    daysRemaining: null,
    totalTrialDays: null,
    daysUsed: null,
    graceDaysRemaining: null,
    converted: school.trialEndReason === "converted",
    hadTrial: !!school.trialStartedAt,
    canExtend: false,
    extensionCount: Array.isArray(school.trialExtensions) ? school.trialExtensions.length : 0,
    maxExtensions: configCache ? configCache.maxExtensions : 2, // Best effort synchronous fallback
  };

  if (!state.hadTrial) return state;

  const now = new Date();
  const started = school.trialStartedAt?.toDate ? school.trialStartedAt.toDate() : new Date(school.trialStartedAt);
  const expires = school.trialExpiresAt?.toDate ? school.trialExpiresAt.toDate() : new Date(school.trialExpiresAt);
  const ended = school.trialEndedAt?.toDate ? school.trialEndedAt.toDate() : (school.trialEndedAt ? new Date(school.trialEndedAt) : null);

  const referenceDate = ended || now;
  const totalDays = Math.round((expires - started) / (1000 * 60 * 60 * 24));
  const usedDays = Math.round((referenceDate - started) / (1000 * 60 * 60 * 24));
  const remaining = Math.ceil((expires - referenceDate) / (1000 * 60 * 60 * 24));

  state.totalTrialDays = totalDays;
  state.daysUsed = usedDays;
  state.daysRemaining = remaining;

  if (state.onTrial) {
    if (remaining <= 0) {
      state.trialExpired = true;
      const graceDays = configCache ? configCache.gracePeriodDays : 3;
      const daysPastExpiry = Math.abs(remaining);
      
      if (daysPastExpiry <= graceDays) {
        state.inGracePeriod = true;
        state.graceDaysRemaining = graceDays - daysPastExpiry;
      }
    }
    
    state.canExtend = state.extensionCount < state.maxExtensions;
  }

  return state;
}

// --------------------------------------------------------------------------
// Super Admin Edge Function Calls
// --------------------------------------------------------------------------

async function callTrialManage(payload) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/trial-manage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Trial operation failed");
  }
  return data;
}

export async function extendTrial(schoolId, reason) {
  return callTrialManage({ action: "extend", schoolId, reason });
}

export async function endTrial(schoolId, reason) {
  return callTrialManage({ action: "end", schoolId, reason });
}

export async function assignTrial(schoolId, days, reason) {
  return callTrialManage({ action: "assign", schoolId, days, reason });
}

export async function updateTrialConfig(settings) {
  const result = await callTrialManage({ action: "configure", settings });
  clearTrialConfigCache();
  return result;
}
