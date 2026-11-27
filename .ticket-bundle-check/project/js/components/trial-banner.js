import { el, icon, formatDate } from "../utils.js";
import { getTrialConfig, getTrialState } from "../services/trial.service.js";
import { db } from "../firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// A non-dismissible banner mounted in the topbar during an active trial.
// Shows days remaining, and turns warning/danger colored as it gets closer
// to expiry based on platform thresholds.
export function mountTrialBanner(profile) {
  const wrap = el("div", {});
  if (!profile || !profile.schoolId) return wrap;

  async function load() {
    const snap = await getDoc(doc(db, "schools", profile.schoolId));
    if (!snap.exists()) return;
    const school = { id: snap.id, ...snap.data() };
    
    const state = getTrialState(school);
    if (!state.onTrial || state.trialExpired || state.converted) return;
    
    const config = await getTrialConfig().catch(() => ({ enableTrialBanner: true, warningThresholds: [7, 3, 1] }));
    if (!config.enableTrialBanner) return;
    
    const daysLeft = state.daysRemaining;
    const thresholds = [...(config.warningThresholds || [7, 3, 1])].sort((a, b) => b - a);
    
    let mode = "primary-600";
    if (daysLeft <= thresholds[2]) mode = "red";
    else if (daysLeft <= thresholds[0]) mode = "gold";
    
    wrap.className = `trial-banner`;
    wrap.style = `display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; background: var(--color-${mode}); color: #fff; font-size: var(--fs-sm); font-weight: 500; text-align: center;`;
    
    const iconName = mode === "red" ? "warning" : mode === "gold" ? "schedule" : "stars";
    let msg = `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, after which system access will be locked.`;
    if (daysLeft === 0) msg = "Your free trial expires today! System access will be locked tomorrow.";
    
    wrap.append(
      icon(iconName, "", { style: "font-size: 18px;" }),
      el("span", {}, msg),
      el("a", { href: "#/settings", style: "color: inherit; text-decoration: underline; margin-left: 8px;" }, "Subscribe now")
    );
  }
  
  load();
  return wrap;
}
