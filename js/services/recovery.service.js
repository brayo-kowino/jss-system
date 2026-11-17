// ==========================================================================
// Account Recovery Service & Incident Response Suite (Super Admin Only)
// Connects to /account-recovery edge function to quarantine breached accounts,
// wipe unauthorized 2FA/trusted devices, and issue clean credentials.
// ==========================================================================

import { auth } from "../firebase-config.js";
import { openModal } from "../components/modal.js";
import { el, icon, toast, busyButton, formatDateTime } from "../utils.js";

async function callRecoveryApi(action, data = {}) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Authentication required.");

  const res = await fetch("/account-recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action, ...data }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Recovery operation failed.");
  return body;
}

export async function fetchAccountRecoveryDetails({ schoolId, uid }) {
  return callRecoveryApi("get_details", { schoolId, uid });
}

export async function toggleAccountQuarantine({ uid, status, reason }) {
  return callRecoveryApi("toggle_quarantine", { uid, status, reason });
}

export async function wipeAccountSecurity({ uid, schoolId }) {
  return callRecoveryApi("wipe_security", { uid, schoolId });
}

export async function issueTempRecoveryCredentials({ uid, schoolId }) {
  return callRecoveryApi("issue_temp_credentials", { uid, schoolId });
}

/**
 * Opens the interactive Super Admin Incident Response & Account Recovery Modal.
 */
export async function openAccountRecoveryModal(schoolId, uidOrEmail = null, profile = null) {
  const container = el("div", { style: "display:flex; flex-direction:column; gap:16px; min-width:320px; max-width:560px;" });
  
  // Loading placeholder
  const loadingEl = el("div", { style: "text-align:center; padding:32px 0;" }, [
    el("div", { class: "spinner", style: "margin:0 auto 12px; width:36px; height:36px;" }),
    el("p", { class: "text-muted text-sm" }, "Fetching security profile and active devices…"),
  ]);
  container.append(loadingEl);

  const close = openModal("🛡️ Account Recovery & Quarantine Suite", container);

  try {
    const details = await fetchAccountRecoveryDetails({ schoolId, uid: uidOrEmail });
    container.innerHTML = "";
    renderRecoveryContent(container, details, schoolId, close);
  } catch (err) {
    container.innerHTML = "";
    container.append(
      el("div", { style: "text-align:center; padding:24px 0;" }, [
        icon("error", "text-danger", "style: font-size:40px; margin-bottom:12px;"),
        el("h4", { style: "margin:0 0 8px;" }, "Could Not Load Account"),
        el("p", { class: "text-muted text-sm", style: "line-height:1.5; margin-bottom:16px;" }, err.message || "Failed to inspect account."),
        el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Close"),
      ])
    );
  }
}

function renderRecoveryContent(container, data, schoolId, modalClose) {
  const { user, trustedDevicesCount, pendingTransfer, schoolName } = data;
  const isSuspended = user.status === "suspended";

  // Header status banner
  const statusBanner = el("div", {
    style: `padding:14px 16px; border-radius:10px; border:1px solid ${isSuspended ? "#fca5a5" : "#bbf7d0"}; background:${isSuspended ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.08)"}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;`,
  }, [
    el("div", {}, [
      el("div", { style: "font-weight:700; font-size:14px; color:#0f172a; display:flex; align-items:center; gap:6px;" }, [
        icon(isSuspended ? "shield_lock" : "verified_user", isSuspended ? "text-danger" : "text-success"),
        user.fullName || "Administrator",
      ]),
      el("div", { class: "text-xs text-muted", style: "margin-top:2px;" }, `${user.email} • ${schoolName}`),
      user.freezeReason ? el("div", { style: "color:#b91c1c; font-size:11px; margin-top:3px; font-weight:600;" }, `Reason: ${user.freezeReason}`) : "",
    ]),
    el("span", {
      class: `badge badge--${isSuspended ? "danger" : "success"}`,
      style: "font-weight:700; font-size:11px;",
    }, isSuspended ? "QUARANTINED" : "ACTIVE ACCESS"),
  ]);
  container.append(statusBanner);

  // Security posture audit pills
  const statsGrid = el("div", {
    style: "display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin: 4px 0;",
  }, [
    el("div", { class: "card", style: "padding:10px; text-align:center;" }, [
      el("div", { class: "text-xs text-muted" }, "Trusted Devices"),
      el("div", { style: `font-size:18px; font-weight:700; color:${trustedDevicesCount > 0 ? "var(--color-ink)" : "#16a34a"};` }, trustedDevicesCount),
    ]),
    el("div", { class: "card", style: "padding:10px; text-align:center;" }, [
      el("div", { class: "text-xs text-muted" }, "2FA Posture"),
      el("div", { style: `font-size:14px; font-weight:700; margin-top:4px; color:${user.twoFactorEnabled ? "#d97706" : "var(--color-ink-soft)"};` },
        user.twoFactorEnabled ? "Active (TOTP)" : "None"
      ),
    ]),
    el("div", { class: "card", style: "padding:10px; text-align:center;" }, [
      el("div", { class: "text-xs text-muted" }, "Pending Transfer"),
      el("div", { style: `font-size:14px; font-weight:700; margin-top:4px; color:${pendingTransfer ? "#dc2626" : "#16a34a"};` },
        pendingTransfer ? "🚨 PENDING" : "None"
      ),
    ]),
  ]);
  container.append(statsGrid);

  // Pending Transfer Alarm if present
  if (pendingTransfer) {
    const ptAlert = el("div", {
      style: "background:rgba(220, 38, 38, 0.08); border:1px solid #f87171; border-radius:8px; padding:10px 12px; font-size:12px; color:#991b1b; line-height:1.4;",
    }, [
      el("strong", {}, "⚠️ Warning: "),
      `An ownership transfer to "${pendingTransfer.newAdmin?.email || "Unknown"}" is pending on this school. If unauthorized, wiping security below will immediately cancel it.`
    ]);
    container.append(ptAlert);
  }

  // Action Panel
  const actionsWrap = el("div", { style: "display:flex; flex-direction:column; gap:10px; margin-top:6px;" });

  // Action A: Quarantine / Reinstate
  const quarantineBtn = el("button", {
    type: "button",
    class: `btn btn--${isSuspended ? "success" : "danger"} btn--block`,
    style: "justify-content:center; gap:8px;",
    onClick: async (e) => {
      const nextStatus = isSuspended ? "active" : "suspended";
      const confirmMsg = isSuspended
        ? `Reinstate active access for ${user.email}?`
        : `Quarantine account ${user.email}? This instantly terminates all active login sessions and blocks database writes.`;
      if (!confirm(confirmMsg)) return;

      const restore = busyButton(e.currentTarget, "Updating…");
      try {
        await toggleAccountQuarantine({ uid: user.uid, status: nextStatus, reason: "Super Admin Recovery Action" });
        toast(`Account marked ${nextStatus}.`, "success");
        user.status = nextStatus;
        user.freezeReason = null;
        container.innerHTML = "";
        renderRecoveryContent(container, { user, trustedDevicesCount, pendingTransfer, schoolName }, schoolId, modalClose);
      } catch (err) {
        toast(err.message || "Failed to toggle quarantine.", "error");
        restore();
      }
    },
  }, [icon(isSuspended ? "lock_open" : "power_settings_new"), isSuspended ? "Reinstate Active Access" : "Quarantine Account (Kill Sessions)"]);

  // Action B: Wipe Hacker Setup (2FA, Trusted Devices, Pending Transfers)
  const wipeBtn = el("button", {
    type: "button",
    class: "btn btn--tonal btn--block",
    style: "justify-content:center; gap:8px; color:#b45309; border-color:#fde68a;",
    onClick: async (e) => {
      if (!confirm(`Wipe all trusted devices and disable 2FA on ${user.email}? Any hacker authenticator app or browser session will be revoked.`)) return;
      const restore = busyButton(e.currentTarget, "Wiping setup…");
      try {
        await wipeAccountSecurity({ uid: user.uid, schoolId });
        toast("Security setup wiped: 2FA removed, devices cleared, pending transfers canceled.", "success");
        user.twoFactorEnabled = false;
        container.innerHTML = "";
        renderRecoveryContent(container, { user, trustedDevicesCount: 0, pendingTransfer: null, schoolName }, schoolId, modalClose);
      } catch (err) {
        toast(err.message || "Failed to wipe security setup.", "error");
        restore();
      }
    },
  }, [icon("device_reset"), "Wipe Unauthorized 2FA & Trusted Devices"]);

  // Action C: Issue Clean Temporary Password
  const tempCredsBtn = el("button", {
    type: "button",
    class: "btn btn--primary btn--block",
    style: "justify-content:center; gap:8px;",
    onClick: async (e) => {
      const confirmMsg = `Generate secure temporary credentials for ${user.email}?\n\nThis will:\n1. Reset the password in Firebase Auth\n2. Invalidate all existing hacker sessions\n3. Clear 2FA and trusted devices\n4. Require the genuine admin to create a new password on login.`;
      if (!confirm(confirmMsg)) return;

      const restore = busyButton(e.currentTarget, "Generating clean credentials…");
      try {
        const creds = await issueTempRecoveryCredentials({ uid: user.uid, schoolId });
        toast("New credentials issued!", "success");
        showCredentialsModal(creds, modalClose);
      } catch (err) {
        toast(err.message || "Failed to issue credentials.", "error");
        restore();
      }
    },
  }, [icon("key"), "Issue Clean Temporary Credentials & Restore Access"]);

  actionsWrap.append(quarantineBtn, wipeBtn, tempCredsBtn);
  container.append(actionsWrap);
}

function showCredentialsModal(creds, parentModalClose) {
  if (parentModalClose) parentModalClose();

  const wrap = el("div", { style: "display:flex; flex-direction:column; gap:16px; min-width:320px;" }, [
    el("div", { style: "background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:14px; text-align:center;" }, [
      el("div", { style: "width:48px; height:48px; border-radius:50%; background:#d1fae5; color:#059669; display:flex; align-items:center; justify-content:center; margin:0 auto 10px;" }, [
        icon("lock_reset", "style: font-size:26px;"),
      ]),
      el("h4", { style: "margin:0 0 4px; font-size:16px; color:#065f46;" }, "Access Restored & Clean Credentials Issued"),
      el("p", { class: "text-xs text-muted", style: "margin:0;" }, "Share these credentials with the verified school administrator over a trusted channel (e.g. verified phone call)."),
    ]),

    el("div", { style: "background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:16px;" }, [
      el("div", { style: "margin-bottom:10px;" }, [
        el("div", { class: "text-xs text-muted" }, "Login Email:"),
        el("div", { style: "font-family:var(--font-mono); font-weight:600; font-size:14px; color:#0f172a;" }, creds.email),
      ]),
      el("div", {}, [
        el("div", { class: "text-xs text-muted" }, "Temporary One-Time Password:"),
        el("div", { style: "display:flex; align-items:center; gap:8px; margin-top:4px;" }, [
          el("input", {
            type: "text",
            readonly: "true",
            value: creds.tempPassword,
            id: "recov-temp-pw",
            style: "font-family:var(--font-mono); font-size:15px; font-weight:700; color:#0f172a; flex:1; background:#fff; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;",
          }),
          el("button", {
            type: "button",
            class: "btn btn--tonal btn--sm",
            onClick: () => {
              const input = document.getElementById("recov-temp-pw");
              input.select();
              navigator.clipboard?.writeText(creds.tempPassword);
              toast("Temporary password copied to clipboard!", "success");
            },
          }, [icon("content_copy"), "Copy"]),
        ]),
      ]),
    ]),

    el("div", { style: "background:#fffbeb; border:1px solid #fef3c7; border-radius:8px; padding:12px; font-size:12px; color:#92400e; line-height:1.5;" }, [
      el("strong", {}, "Security protocol: "),
      "Upon signing in with this temporary password, the genuine administrator will be immediately forced to set their own permanent password and register their trusted device. All previous attacker devices and 2FA keys have been revoked."
    ]),

    el("button", {
      type: "button",
      class: "btn btn--primary btn--block",
      onClick: () => credsClose(),
    }, "Done"),
  ]);

  const credsClose = openModal("🔑 Clean Temporary Credentials", wrap);
}
