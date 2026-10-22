// ==========================================================================
// Platform Settings (Super Admin Only)
// Direct, clean settings portal for Platform Administrators.
// ==========================================================================

import {
  getPlatformSecuritySettings,
  savePlatformSecuritySettings,
  getPlatformEmailSettings,
  savePlatformEmailSettings,
  getPlatformTrialConfig,
  savePlatformTrialConfig,
} from "../js/services/platform-settings.service.js";
import {
  listTrustedDevices,
  removeTrustedDevice,
  resetAllTrustedDevices,
} from "../js/services/device.service.js";
import {
  is2FAEnabled,
  generate2FASetup,
  enable2FA,
  disable2FA,
} from "../js/services/two-factor.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

const TABS = [
  { id: "security", label: "Security & Devices", icon: "shield" },
  { id: "email", label: "Email Engine", icon: "mail" },
  { id: "trials", label: "Subscriptions & Trials", icon: "workspace_premium" },
  { id: "account", label: "Profile", icon: "badge" },
];

let securitySettings = null;
let emailSettings = null;
let trialConfig = null;
let trustedDevices = [];
let has2FA = false;

function getActiveTabFromUrl() {
  const hash = location.hash || "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex !== -1) {
    const params = new URLSearchParams(hash.slice(queryIndex));
    const tab = params.get("tab");
    if (tab && TABS.some((t) => t.id === tab)) return tab;
  }
  return "security";
}

export async function render({ profile }) {
  if (profile.role !== "super_admin") {
    return el("div", { class: "card", style: "padding:var(--sp-6); text-align:center;" }, [
      icon("lock", "text-danger", "style: font-size:48px;"),
      el("h3", {}, "Access Restricted"),
      el("p", { class: "text-muted" }, "Reserved for Platform Administrators."),
    ]);
  }

  [securitySettings, emailSettings, trialConfig, trustedDevices, has2FA] = await Promise.all([
    getPlatformSecuritySettings(),
    getPlatformEmailSettings(),
    getPlatformTrialConfig(),
    listTrustedDevices(profile.uid).catch(() => []),
    is2FAEnabled(profile.uid).catch(() => false),
  ]);

  const wrap = el("div", { class: "platform-settings-wrap" });

  // Tabs Navigation
  const tabsNav = el("div", { class: "profile-tabs no-print", style: "margin-bottom:var(--sp-4);" });
  const activeTab = getActiveTabFromUrl();

  const panels = {};
  for (const t of TABS) {
    panels[t.id] = el("div", { class: "settings-tab-panel", id: `panel-${t.id}` });
    const btn = el(
      "button",
      {
        type: "button",
        class: `profile-tab${t.id === activeTab ? " profile-tab--active" : ""}`,
        "data-tab": t.id,
        onClick: () => switchTab(t.id, tabsNav, panels),
      },
      [icon(t.icon), t.label]
    );
    tabsNav.append(btn);
  }

  for (const t of TABS) panels[t.id].style.display = t.id === activeTab ? "" : "none";

  panels.security.append(buildSecurityTab(profile));
  panels.email.append(buildEmailTab(profile));
  panels.trials.append(buildTrialsTab(profile));
  panels.account.append(buildAccountTab(profile));

  wrap.append(tabsNav);
  for (const t of TABS) wrap.append(panels[t.id]);

  return wrap;
}

function switchTab(tabId, tabsNav, panels) {
  for (const btn of tabsNav.querySelectorAll(".profile-tab")) {
    btn.classList.toggle("profile-tab--active", btn.dataset.tab === tabId);
  }
  for (const t of TABS) panels[t.id].style.display = t.id === tabId ? "" : "none";
  try {
    history.replaceState(null, "", `#/platform-settings?tab=${encodeURIComponent(tabId)}`);
  } catch {}
}

// =========================================================================
// Tab 1: Security & Devices
// =========================================================================

function buildSecurityTab(profile) {
  const container = el("div", { style: "display:flex; flex-direction:column; gap:var(--sp-4);" });

  // 1. Device Approval Policy
  const isApprovalReq = securitySettings.requireDeviceApproval === true;
  const policyCard = el("div", { class: "card", style: "padding:20px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;" }, [
      el("h3", { style: "margin:0; font-size:16px;" }, "Device Approval Policy"),
      el("span", { class: `badge badge--${isApprovalReq ? "warning" : "success"}` },
        isApprovalReq ? "Approval Required" : "Direct Multi-Device Login"
      ),
    ]),

    el("div", { style: "display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;" }, [
      el("label", { style: "display:flex; align-items:center; gap:8px; cursor:pointer; font-size:var(--fs-sm);" }, [
        el("input", {
          type: "checkbox",
          id: "ps-device-approval",
          checked: isApprovalReq,
          style: "width:18px; height:18px; cursor:pointer;",
        }),
        "Require approval from another device when signing in from a new browser",
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: async (e) => {
          const restore = busyButton(e.currentTarget, "Saving…");
          const checked = document.getElementById("ps-device-approval").checked;
          try {
            await savePlatformSecuritySettings(profile.uid, {
              requireDeviceApproval: checked,
            });
            securitySettings.requireDeviceApproval = checked;
            toast("Device policy updated.", "success");
            const { renderRoute } = await import("../js/router.js");
            renderRoute();
          } catch (err) {
            toast(err.message || "Failed to update device policy.", "error");
            restore();
          }
        },
      }, [icon("save", "text-xs"), "Save"]),
    ]),
  ]);
  container.append(policyCard);

  // 2. Two-Factor Authentication
  const mfaCard = el("div", { class: "card", style: "padding:20px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;" }, [
      el("h3", { style: "margin:0; font-size:16px;" }, "Two-Factor Authentication (2FA)"),
      el("span", { class: `badge badge--${has2FA ? "success" : "muted"}` },
        has2FA ? "Enabled" : "Disabled"
      ),
    ]),
    el("div", { style: "display:flex; gap:10px; align-items:center;" }, [
      has2FA
        ? el("button", {
            type: "button",
            class: "btn btn--outline btn--sm",
            onClick: () => openDisable2FAModal(profile),
          }, [icon("lock_open", "text-xs"), "Disable 2FA"])
        : el("button", {
            type: "button",
            class: "btn btn--primary btn--sm",
            onClick: () => openEnable2FAModal(profile),
          }, [icon("security", "text-xs"), "Set Up Authenticator App"]),
    ]),
  ]);
  container.append(mfaCard);

  // 3. Trusted Devices
  const devicesCard = el("div", { class: "card", style: "padding:20px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;" }, [
      el("h3", { style: "margin:0; font-size:16px;" }, `Registered Devices (${trustedDevices.length})`),
      trustedDevices.length > 0
        ? el("button", {
            type: "button",
            class: "btn btn--danger btn--xs",
            onClick: async (e) => {
              if (!confirm("Revoke all devices?")) return;
              const restore = busyButton(e.currentTarget, "Resetting…");
              try {
                await resetAllTrustedDevices(profile.uid);
                toast("Devices cleared.", "success");
                const { renderRoute } = await import("../js/router.js");
                renderRoute();
              } catch (err) {
                toast(err.message || "Failed to reset devices.", "error");
                restore();
              }
            },
          }, [icon("restart_alt", "text-xs"), "Reset All Devices"])
        : "",
    ]),

    trustedDevices.length === 0
      ? el("p", { class: "text-muted text-sm", style: "margin:0;" }, "No devices registered.")
      : el("div", { class: "table-wrap table-wrap--responsive" }, [
          el("table", {}, [
            el("thead", {}, el("tr", {}, [
              el("th", {}, "Device / Browser"),
              el("th", {}, "Screen"),
              el("th", {}, "Timezone"),
              el("th", {}, "Status"),
              el("th", { style: "text-align:right;" }, "Action"),
            ])),
            el("tbody", {}, trustedDevices.map((d) =>
              el("tr", {}, [
                el("td", {}, [
                  el("strong", {}, d.deviceName || "Browser"),
                  el("div", { class: "text-xs text-muted" }, d.browser || ""),
                ]),
                el("td", { class: "text-sm text-muted" }, d.screenRes || "—"),
                el("td", { class: "text-sm text-muted" }, d.timezone || "—"),
                el("td", {}, d.isPrimary
                  ? el("span", { class: "badge badge--success" }, "Primary")
                  : el("span", { class: "badge badge--muted" }, "Active")
                ),
                el("td", { style: "text-align:right;" }, [
                  el("button", {
                    type: "button",
                    class: "btn btn--ghost btn--xs btn--danger",
                    onClick: async (e) => {
                      if (!confirm(`Revoke this device?`)) return;
                      const restore = busyButton(e.currentTarget, "Removing…");
                      try {
                        await removeTrustedDevice(profile.uid, d.id || d.fingerprint);
                        toast("Device removed.", "success");
                        const { renderRoute } = await import("../js/router.js");
                        renderRoute();
                      } catch (err) {
                        toast(err.message || "Failed to remove device.", "error");
                        restore();
                      }
                    },
                  }, [icon("delete", "text-xs"), "Revoke"]),
                ]),
              ])
            )),
          ]),
        ]),
  ]);
  container.append(devicesCard);

  return container;
}

// -------------------------------------------------------------------------
// 2FA Modals
// -------------------------------------------------------------------------

async function openEnable2FAModal(profile) {
  const modalBody = el("div", { style: "padding:8px 0;" }, [
    el("div", { class: "spinner-overlay", style: "padding:24px; text-align:center;" }, [
      el("span", { class: "spinner spinner--md spinner--dark" }),
    ]),
  ]);

  const close = openModal("Set Up 2FA", modalBody);

  try {
    const setup = await generate2FASetup(profile.uid, profile.email);
    modalBody.innerHTML = "";

    const codeInput = el("input", {
      type: "text",
      id: "twofa-code",
      placeholder: "123456",
      maxlength: "6",
      style: "font-size:18px; font-weight:700; letter-spacing:4px; text-align:center; max-width:180px; margin:0 auto;",
    });

    const form = el("form", { style: "display:flex; flex-direction:column; gap:14px;" }, [
      el("p", { class: "text-sm text-muted", style: "margin:0;" },
        "Scan this QR code in your Authenticator app and enter the 6-digit code:"
      ),
      el("div", { style: "text-align:center; padding:12px; background:#fff; border:1px solid var(--color-line); border-radius:8px; margin:0 auto;" }, [
        setup.qrCodeUrl
          ? el("img", { src: setup.qrCodeUrl, style: "width:160px; height:160px; display:block; margin:0 auto;" })
          : el("code", {}, setup.secret),
      ]),
      el("div", { style: "background:var(--color-surface-soft); padding:8px 12px; border-radius:6px; text-align:center;" }, [
        el("div", { class: "text-xs text-muted" }, "Manual key:"),
        el("code", { style: "font-size:12px; font-weight:700; letter-spacing:1px;" }, setup.secret),
      ]),
      el("div", { class: "field", style: "text-align:center;" }, [
        codeInput,
      ]),
      el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Enable 2FA"),
    ]);

    modalBody.append(form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      if (!code || code.length !== 6) return toast("Enter a valid 6-digit code.", "error");
      const restore = busyButton(e.submitter, "Verifying…");
      try {
        await enable2FA(profile.uid, setup.secret, code);
        toast("2FA enabled.", "success");
        close();
        const { renderRoute } = await import("../js/router.js");
        renderRoute();
      } catch (err) {
        toast(err.message || "Invalid code.", "error");
        restore();
      }
    });
  } catch (err) {
    modalBody.innerHTML = "";
    modalBody.append(el("p", { class: "text-danger" }, err.message));
  }
}

async function openDisable2FAModal(profile) {
  const codeInput = el("input", {
    type: "text",
    id: "twofa-disable-code",
    placeholder: "123456",
    maxlength: "6",
    style: "font-size:18px; font-weight:700; letter-spacing:4px; text-align:center; max-width:180px; margin:0 auto;",
  });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:14px;" }, [
    el("p", { class: "text-sm text-muted", style: "margin:0;" }, "Enter 6-digit code to turn off 2FA:"),
    el("div", { class: "field", style: "text-align:center;" }, [codeInput]),
    el("button", { type: "submit", class: "btn btn--danger btn--block" }, "Disable 2FA"),
  ]);

  const close = openModal("Disable 2FA", form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeInput.value.trim();
    if (!code || code.length !== 6) return toast("Enter a valid 6-digit code.", "error");
    const restore = busyButton(e.submitter, "Disabling…");
    try {
      await disable2FA(profile.uid, code);
      toast("2FA disabled.", "success");
      close();
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Invalid code.", "error");
      restore();
    }
  });
}

// =========================================================================
// Tab 2: Email Engine
// =========================================================================

function buildEmailTab(profile) {
  const card = el("div", { class: "card", style: "padding:20px;" });

  card.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;" }, [
      el("h3", { style: "margin:0; font-size:16px;" }, "Platform Email Engine"),
      el("button", {
        type: "button",
        class: "btn btn--outline btn--xs",
        onClick: async (e) => {
          const restore = busyButton(e.currentTarget, "Sending…");
          try {
            const res = await fetch("/.netlify/functions/broadcast-service-announcement", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                serviceName: "Eeskia Email Test",
                status: "Restored",
                headline: "Email Engine Test: Operational",
                summary: "Live test of Google-styled email engine.",
                resolution: "Verified delivery.",
                targetSchools: [],
              }),
            });
            if (res.ok) {
              toast("Test processed.", "success");
            } else {
              toast("Response: " + (await res.text()), "info");
            }
          } catch (err) {
            toast(err.message || "Test failed.", "error");
          } finally {
            restore();
          }
        },
      }, [icon("send", "text-xs"), "Send Test Email"]),
    ])
  );

  const senderNameInput = el("input", { type: "text", value: emailSettings.senderName || "Eeskia Platform Operations" });
  const senderEmailInput = el("input", { type: "email", value: emailSettings.senderEmail || "support@eeskia.iskify360.tech" });
  const replyToInput = el("input", { type: "email", value: emailSettings.replyTo || "support@eeskia.iskify360.tech" });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:14px;" }, [
    el("div", { class: "filter-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Sender Name"), senderNameInput]),
      el("div", { class: "field" }, [el("label", {}, "Sender Email"), senderEmailInput]),
      el("div", { class: "field" }, [el("label", {}, "Reply-To Email"), replyToInput]),
    ]),

    el("div", { style: "display:flex; flex-direction:column; gap:8px; margin-top:4px;" }, [
      el("label", { style: "display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); cursor:pointer;" }, [
        el("input", { type: "checkbox", id: "pe-sub-reminders", checked: emailSettings.enableSubscriptionReminderEmails !== false, style: "width:16px; height:16px;" }),
        "Automated subscription expiry countdown emails (7d, 3d, 1d)",
      ]),
      el("label", { style: "display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); cursor:pointer;" }, [
        el("input", { type: "checkbox", id: "pe-service-alerts", checked: emailSettings.enableServiceAlertEmails !== false, style: "width:16px; height:16px;" }),
        "Allow service news & restored alerts from Platform Announcements",
      ]),
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; margin-top:8px;" }, [
      el("button", { type: "submit", class: "btn btn--primary btn--sm" }, [icon("save", "text-xs"), "Save"]),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const payload = {
      senderName: senderNameInput.value.trim(),
      senderEmail: senderEmailInput.value.trim(),
      replyTo: replyToInput.value.trim(),
      enableSubscriptionReminderEmails: document.getElementById("pe-sub-reminders").checked,
      enableServiceAlertEmails: document.getElementById("pe-service-alerts").checked,
    };
    try {
      await savePlatformEmailSettings(profile.uid, payload);
      emailSettings = payload;
      toast("Email settings saved.", "success");
    } catch (err) {
      toast(err.message || "Failed to save email settings.", "error");
    } finally {
      restore();
    }
  });

  card.append(form);
  return card;
}

// =========================================================================
// Tab 3: Subscriptions & Trials
// =========================================================================

function buildTrialsTab(profile) {
  const card = el("div", { class: "card", style: "padding:20px;" });

  card.append(
    el("h3", { style: "margin:0 0 16px; font-size:16px;" }, "Subscription & Trial Defaults")
  );

  const trialDaysInput = el("input", { type: "number", min: "1", max: "365", value: trialConfig.defaultTrialDays || 30 });
  const maxExtInput = el("input", { type: "number", min: "0", max: "10", value: trialConfig.maxExtensions || 2 });
  const extDaysInput = el("input", { type: "number", min: "1", max: "60", value: trialConfig.extensionDays || 7 });
  const graceDaysInput = el("input", { type: "number", min: "0", max: "30", value: trialConfig.gracePeriodDays || 3 });
  const autoTrialCheckbox = el("input", { type: "checkbox", checked: trialConfig.autoTrialOnCreate !== false, style: "width:18px; height:18px; cursor:pointer;" });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:14px;" }, [
    el("div", { class: "filter-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Default Trial Days"), trialDaysInput]),
      el("div", { class: "field" }, [el("label", {}, "Days per Extension"), extDaysInput]),
      el("div", { class: "field" }, [el("label", {}, "Max Extensions"), maxExtInput]),
      el("div", { class: "field" }, [el("label", {}, "Grace Period (Days)"), graceDaysInput]),
    ]),

    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      autoTrialCheckbox,
      el("label", { style: "margin:0; cursor:pointer; font-size:var(--fs-sm);" },
        "Assign trial automatically when creating a school"
      ),
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; margin-top:8px;" }, [
      el("button", { type: "submit", class: "btn btn--primary btn--sm" }, [icon("save", "text-xs"), "Save"]),
    ]),
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const payload = {
      defaultTrialDays: parseInt(trialDaysInput.value, 10) || 30,
      maxExtensions: parseInt(maxExtInput.value, 10) || 2,
      extensionDays: parseInt(extDaysInput.value, 10) || 7,
      gracePeriodDays: parseInt(graceDaysInput.value, 10) || 3,
      autoTrialOnCreate: autoTrialCheckbox.checked,
      warningThresholds: [7, 3, 1],
    };
    try {
      await savePlatformTrialConfig(profile.uid, payload);
      trialConfig = payload;
      toast("Trial defaults saved.", "success");
    } catch (err) {
      toast(err.message || "Failed to save trial defaults.", "error");
    } finally {
      restore();
    }
  });

  card.append(form);
  return card;
}

// =========================================================================
// Tab 4: Profile
// =========================================================================

function buildAccountTab(profile) {
  const card = el("div", { class: "card", style: "padding:20px;" }, [
    el("h3", { style: "margin:0 0 16px; font-size:16px;" }, "Platform Admin Profile"),

    el("div", { class: "filter-grid", style: "margin-bottom:16px;" }, [
      el("div", { class: "field" }, [
        el("label", {}, "Name"),
        el("input", { type: "text", value: profile.fullName || "Platform Admin", disabled: true }),
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "Email"),
        el("input", { type: "text", value: profile.email || "", disabled: true }),
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "Role"),
        el("input", { type: "text", value: "Super Administrator", disabled: true }),
      ]),
    ]),

    el("div", { style: "display:flex; justify-content:flex-start;" }, [
      el("a", { href: "#/change-password", class: "btn btn--primary btn--sm" }, [icon("lock_reset", "text-xs"), "Change Password"]),
    ]),
  ]);

  return card;
}

export function init() {}
