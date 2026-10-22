// ==========================================================================
// Platform Settings & Security Portal (Super Admin Only)
// Complete standalone configuration portal for Platform Administrators.
// Covers device access policies (toggle device approval on/off), 2FA,
// trusted devices, platform email settings, and subscription/trial defaults.
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
import { el, icon, toast, busyButton, formatDate } from "../js/utils.js";

const TABS = [
  { id: "security", label: "Security & Device Access", icon: "shield" },
  { id: "email", label: "Email Engine & Alerts", icon: "mail" },
  { id: "trials", label: "Subscription & Trial Defaults", icon: "workspace_premium" },
  { id: "account", label: "Operator Profile", icon: "badge" },
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
    const denied = el("div", { class: "card", style: "padding:var(--sp-6); text-align:center;" }, [
      icon("lock", "text-danger", "style: font-size:48px;"),
      el("h3", {}, "Access Restricted"),
      el("p", { class: "text-muted" }, "This portal is reserved exclusively for Platform Administrators."),
    ]);
    return denied;
  }

  // Load all platform configurations in parallel
  [securitySettings, emailSettings, trialConfig, trustedDevices, has2FA] = await Promise.all([
    getPlatformSecuritySettings(),
    getPlatformEmailSettings(),
    getPlatformTrialConfig(),
    listTrustedDevices(profile.uid).catch(() => []),
    is2FAEnabled(profile.uid).catch(() => false),
  ]);

  const wrap = el("div", { class: "platform-settings-wrap" });

  // Executive Platform Header
  const hero = el("div", {
    class: "card",
    style: "background: linear-gradient(135deg, #0d3559 0%, #14538a 100%); color: #ffffff; padding: 28px 32px; margin-bottom: var(--sp-4); border-radius: 16px; border: none; box-shadow: 0 4px 20px rgba(13, 53, 89, 0.15);",
  }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px; margin-bottom:6px;" }, [
          el("span", { class: "badge", style: "background: rgba(255,255,255,0.15); color:#ffffff; font-weight:700; border: 1px solid rgba(255,255,255,0.25);" }, "Platform Super Admin"),
          el("span", { class: "badge", style: "background: #10b981; color:#ffffff; font-weight:700;" }, "Standalone Portal"),
        ]),
        el("h1", { style: "margin:0 0 6px; font-size:24px; font-weight:700; color:#ffffff; letter-spacing:-0.5px;" }, "Platform Administration & Security"),
        el("p", { style: "margin:0; font-size:var(--fs-sm); color:rgba(255,255,255,0.85); max-width:650px; line-height:1.5;" },
          "Manage global platform security policies, multi-device login rules, the automated email notification engine, and default school subscription thresholds."
        ),
      ]),
      el("div", { style: "display:flex; gap:10px; align-items:center;" }, [
        el("a", { href: "#/schools", class: "btn btn--sm", style: "background: rgba(255,255,255,0.12); color:#ffffff; border:1px solid rgba(255,255,255,0.3);" }, [
          icon("corporate_fare", "text-xs"), "Manage Schools"
        ]),
        el("a", { href: "#/platform-announcements", class: "btn btn--sm", style: "background: #ffffff; color:#0d3559; font-weight:600; border:none;" }, [
          icon("campaign", "text-xs"), "Broadcast Alerts"
        ]),
      ]),
    ]),
  ]);
  wrap.append(hero);

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

  // Build individual tab panels
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
// Tab 1: Security & Device Access
// =========================================================================

function buildSecurityTab(profile) {
  const container = el("div", { style: "display:flex; flex-direction:column; gap:var(--sp-4);" });

  // 1. Device Approval Policy Card
  const isApprovalReq = securitySettings.requireDeviceApproval === true;
  const policyCard = el("div", { class: "card", style: "padding:24px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:16px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("devices", "text-primary"),
          el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, "Device Approval Policy for Platform Admin"),
        ]),
        el("p", { class: "text-muted text-sm", style: "margin:6px 0 0;" },
          "Controls what happens when you sign into your Super Admin account from a new computer, tablet, or phone."
        ),
      ]),
      el("span", {
        class: `badge badge--${isApprovalReq ? "warning" : "success"}`,
        style: "font-weight:700; font-size:12px;",
      }, isApprovalReq ? "Strict Approval Active" : "Multi-Device Easy Login (Active)"),
    ]),

    el("div", {
      class: "notice-banner",
      style: isApprovalReq
        ? "background:#fffbeb; border:1px solid #fde68a; color:#92400e;"
        : "background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;",
    }, [
      icon(isApprovalReq ? "warning" : "verified_user", "text-xs"),
      el("div", {}, [
        el("strong", { style: "display:block; margin-bottom:2px;" },
          isApprovalReq
            ? "Waiting for Approval Enabled"
            : "Multi-Device Seamless Access Active (Recommended)"
        ),
        el("span", { style: "font-size:var(--fs-xs);" },
          isApprovalReq
            ? "New devices will be stopped by the 'Waiting for approval' screen and require your primary computer to approve them."
            : "You can sign in directly on any phone, laptop, or browser using your password and optional 2FA. No remote approval locks."
        ),
      ]),
    ]),

    el("div", { style: "margin-top:16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;" }, [
      el("label", { style: "display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:600; font-size:var(--fs-sm);" }, [
        el("input", {
          type: "checkbox",
          id: "ps-device-approval",
          checked: isApprovalReq,
          style: "width:18px; height:18px; cursor:pointer;",
        }),
        "Require login approval from an existing device on new logins",
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
            toast(
              checked
                ? "Device approval enabled for Platform Admin."
                : "Device approval disabled. You can now log in freely from any device.",
              "success"
            );
            const { renderRoute } = await import("../js/router.js");
            renderRoute();
          } catch (err) {
            toast(err.message || "Failed to update device policy.", "error");
            restore();
          }
        },
      }, [icon("save", "text-xs"), "Save Policy"]),
    ]),
  ]);
  container.append(policyCard);

  // 2. Two-Factor Authentication Card
  const mfaCard = el("div", { class: "card", style: "padding:24px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:12px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("lock_clock", "text-primary"),
          el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, "Two-Factor Authentication (TOTP / Authenticator App)"),
        ]),
        el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" },
          "Protects your Super Admin account using Google Authenticator, Microsoft Authenticator, or 1Password."
        ),
      ]),
      el("span", {
        class: `badge badge--${has2FA ? "success" : "muted"}`,
        style: "font-weight:700;",
      }, has2FA ? "2FA Enabled" : "2FA Disabled"),
    ]),

    el("div", { style: "margin-top:16px; display:flex; gap:10px; align-items:center;" }, [
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
          }, [icon("security", "text-xs"), "Set Up Authenticator App (2FA)"]),
    ]),
  ]);
  container.append(mfaCard);

  // 3. Trusted Devices Table
  const devicesCard = el("div", { class: "card", style: "padding:24px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("laptop_mac", "text-primary"),
          el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, `Registered Devices (${trustedDevices.length})`),
        ]),
        el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" },
          "Devices authorized to access the Super Admin portal."
        ),
      ]),
      trustedDevices.length > 0
        ? el("button", {
            type: "button",
            class: "btn btn--danger btn--sm",
            onClick: async (e) => {
              if (!confirm("Revoke all registered devices? You will remain signed in on this session.")) return;
              const restore = busyButton(e.currentTarget, "Resetting…");
              try {
                await resetAllTrustedDevices(profile.uid);
                toast("All trusted devices cleared.", "success");
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
      ? el("p", { class: "text-muted text-sm", style: "padding:12px 0;" }, "No devices registered yet.")
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
                  el("strong", {}, d.deviceName || "Web Browser"),
                  el("div", { class: "text-xs text-muted" }, d.browser || "Unknown"),
                ]),
                el("td", { class: "text-sm text-muted" }, d.screenRes || "—"),
                el("td", { class: "text-sm text-muted" }, d.timezone || "—"),
                el("td", {}, d.isPrimary
                  ? el("span", { class: "badge badge--success" }, "Primary Device")
                  : el("span", { class: "badge badge--muted" }, "Active Device")
                ),
                el("td", { style: "text-align:right;" }, [
                  el("button", {
                    type: "button",
                    class: "btn btn--ghost btn--xs btn--danger",
                    onClick: async (e) => {
                      if (!confirm(`Revoke device "${d.deviceName || 'this device'}"?`)) return;
                      const restore = busyButton(e.currentTarget, "Removing…");
                      try {
                        await removeTrustedDevice(profile.uid, d.id || d.fingerprint);
                        toast("Device revoked.", "success");
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
  const modalBody = el("div", { style: "padding:10px 0;" }, [
    el("div", { class: "spinner-overlay", style: "padding:32px; text-align:center;" }, [
      el("span", { class: "spinner spinner--md spinner--dark" }),
      el("p", { class: "text-muted text-sm", style: "margin-top:12px;" }, "Generating 2FA security secret…"),
    ]),
  ]);

  const close = openModal("Set Up Two-Factor Authentication", modalBody);

  try {
    const setup = await generate2FASetup(profile.uid, profile.email);
    modalBody.innerHTML = "";

    const codeInput = el("input", {
      type: "text",
      id: "twofa-code",
      placeholder: "123456",
      maxlength: "6",
      style: "font-size:20px; font-weight:700; letter-spacing:4px; text-align:center; max-width:200px; margin:0 auto;",
    });

    const form = el("form", { style: "display:flex; flex-direction:column; gap:16px;" }, [
      el("p", { class: "text-sm text-muted", style: "margin:0;" },
        "Scan the QR code below using your Authenticator App (Google Authenticator, Microsoft Authenticator, etc.), then enter the 6-digit verification code."
      ),
      el("div", { style: "text-align:center; padding:16px; background:#ffffff; border:1px solid var(--color-line); border-radius:12px; margin:0 auto;" }, [
        setup.qrCodeUrl
          ? el("img", { src: setup.qrCodeUrl, style: "width:180px; height:180px; display:block; margin:0 auto;" })
          : el("p", { class: "text-sm text-muted" }, "Secret: " + setup.secret),
      ]),
      el("div", { style: "background:var(--color-surface-soft); padding:10px 14px; border-radius:8px; text-align:center;" }, [
        el("div", { class: "text-xs text-muted", style: "margin-bottom:4px;" }, "Manual Entry Key:"),
        el("code", { style: "font-size:13px; font-weight:700; color:var(--color-primary-800); letter-spacing:1px;" }, setup.secret),
      ]),
      el("div", { class: "field", style: "text-align:center;" }, [
        el("label", { for: "twofa-code", style: "font-weight:600;" }, "Enter 6-Digit Code"),
        codeInput,
      ]),
      el("button", { type: "submit", class: "btn btn--primary btn--block" }, [
        icon("check_circle"), "Verify & Enable 2FA"
      ]),
    ]);

    modalBody.append(form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      if (!code || code.length !== 6) return toast("Enter a valid 6-digit code.", "error");
      const restore = busyButton(e.submitter, "Verifying…");
      try {
        await enable2FA(profile.uid, setup.secret, code);
        toast("Two-factor authentication enabled successfully!", "success");
        close();
        const { renderRoute } = await import("../js/router.js");
        renderRoute();
      } catch (err) {
        toast(err.message || "Invalid code. Please try again.", "error");
        restore();
      }
    });
  } catch (err) {
    modalBody.innerHTML = "";
    modalBody.append(el("p", { class: "text-danger" }, "Could not initialize 2FA: " + err.message));
  }
}

async function openDisable2FAModal(profile) {
  const codeInput = el("input", {
    type: "text",
    id: "twofa-disable-code",
    placeholder: "123456",
    maxlength: "6",
    style: "font-size:20px; font-weight:700; letter-spacing:4px; text-align:center; max-width:200px; margin:0 auto;",
  });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:16px;" }, [
    el("p", { class: "text-sm text-muted", style: "margin:0;" },
      "Enter a current 6-digit code from your Authenticator app to confirm turning off 2FA."
    ),
    el("div", { class: "field", style: "text-align:center;" }, [
      codeInput,
    ]),
    el("button", { type: "submit", class: "btn btn--danger btn--block" }, [
      icon("lock_open"), "Confirm & Disable 2FA"
    ]),
  ]);

  const close = openModal("Disable Two-Factor Authentication", form);

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
      toast(err.message || "Could not disable 2FA.", "error");
      restore();
    }
  });
}

// =========================================================================
// Tab 2: Email Engine & Alerts
// =========================================================================

function buildEmailTab(profile) {
  const card = el("div", { class: "card", style: "padding:24px;" });

  card.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("mail", "text-primary"),
          el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, "Platform Email Engine Configuration"),
        ]),
        el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" },
          "Configures the sender credentials and delivery behavior for Google-styled platform announcements, subscription reminders, and service alerts."
        ),
      ]),
      el("button", {
        type: "button",
        class: "btn btn--outline btn--sm",
        onClick: async (e) => {
          const restore = busyButton(e.currentTarget, "Sending test…");
          try {
            const res = await fetch("/.netlify/functions/broadcast-service-announcement", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                serviceName: "Eeskia Email Engine Test",
                status: "Restored",
                headline: "Email Engine Test: Google Layout Operational",
                summary: "This is a live test of the Google-styled transactional and announcement email engine.",
                resolution: "Verified responsive card formatting, status pills, and CTA button compatibility.",
                targetSchools: [], // test run
              }),
            });
            if (res.ok) {
              toast("Test broadcast processed successfully.", "success");
            } else {
              toast("Test response: " + (await res.text()), "info");
            }
          } catch (err) {
            toast(err.message || "Failed to trigger test email.", "error");
          } finally {
            restore();
          }
        },
      }, [icon("send", "text-xs"), "Send Test Email"]),
    ])
  );

  const senderNameInput = el("input", { type: "text", id: "pe-name", value: emailSettings.senderName || "Eeskia Platform Operations" });
  const senderEmailInput = el("input", { type: "email", id: "pe-email", value: emailSettings.senderEmail || "support@eeskia.iskify360.tech" });
  const replyToInput = el("input", { type: "email", id: "pe-reply", value: emailSettings.replyTo || "support@eeskia.iskify360.tech" });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:16px;" }, [
    el("div", { class: "filter-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Sender Display Name"), senderNameInput]),
      el("div", { class: "field" }, [el("label", {}, "Default Sender Email"), senderEmailInput]),
      el("div", { class: "field" }, [el("label", {}, "Reply-To Email"), replyToInput]),
    ]),

    el("div", { style: "background:var(--color-surface-soft); padding:16px; border-radius:12px; border:1px solid var(--color-line); margin-top:8px;" }, [
      el("h4", { style: "margin:0 0 12px; font-size:14px; color:var(--color-ink);" }, "Automated Email Triggers"),
      el("div", { style: "display:flex; flex-direction:column; gap:10px;" }, [
        el("label", { style: "display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); cursor:pointer;" }, [
          el("input", { type: "checkbox", id: "pe-sub-reminders", checked: emailSettings.enableSubscriptionReminderEmails !== false, style: "width:16px; height:16px;" }),
          "Send automated countdown reminder emails when school subscriptions are 7, 3, and 1 day(s) from expiring",
        ]),
        el("label", { style: "display:flex; align-items:center; gap:8px; font-size:var(--fs-sm); cursor:pointer;" }, [
          el("input", { type: "checkbox", id: "pe-service-alerts", checked: emailSettings.enableServiceAlertEmails !== false, style: "width:16px; height:16px;" }),
          "Allow broadcasting Service Restoration & Maintenance alert emails from Platform Announcements",
        ]),
      ]),
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; margin-top:8px;" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Email Settings"]),
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
      toast("Platform email settings saved.", "success");
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
// Tab 3: Subscriptions & Trials Defaults
// =========================================================================

function buildTrialsTab(profile) {
  const card = el("div", { class: "card", style: "padding:24px;" });

  card.append(
    el("div", { style: "margin-bottom:20px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("workspace_premium", "text-gold"),
        el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, "Global Subscription & Free Trial Defaults"),
      ]),
      el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" },
        "Configures default trial lengths, extension policies, and grace periods applied when creating new schools."
      ),
    ])
  );

  const trialDaysInput = el("input", { type: "number", min: "1", max: "365", value: trialConfig.defaultTrialDays || 30 });
  const maxExtInput = el("input", { type: "number", min: "0", max: "10", value: trialConfig.maxExtensions || 2 });
  const extDaysInput = el("input", { type: "number", min: "1", max: "60", value: trialConfig.extensionDays || 7 });
  const graceDaysInput = el("input", { type: "number", min: "0", max: "30", value: trialConfig.gracePeriodDays || 3 });
  const autoTrialCheckbox = el("input", { type: "checkbox", checked: trialConfig.autoTrialOnCreate !== false, style: "width:18px; height:18px; cursor:pointer;" });

  const form = el("form", { style: "display:flex; flex-direction:column; gap:16px;" }, [
    el("div", { class: "filter-grid" }, [
      el("div", { class: "field" }, [el("label", {}, "Default Trial Length (Days)"), trialDaysInput]),
      el("div", { class: "field" }, [el("label", {}, "Days per Extension"), extDaysInput]),
      el("div", { class: "field" }, [el("label", {}, "Max Extensions Allowed"), maxExtInput]),
      el("div", { class: "field" }, [el("label", {}, "Grace Period (Days)"), graceDaysInput]),
    ]),

    el("div", { style: "display:flex; align-items:center; gap:10px; margin-top:8px;" }, [
      autoTrialCheckbox,
      el("label", { style: "margin:0; cursor:pointer; font-weight:600; font-size:var(--fs-sm);" },
        "Automatically assign a free trial when a new school is registered"
      ),
    ]),

    el("div", { style: "display:flex; justify-content:flex-end; margin-top:8px;" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Trial Defaults"]),
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
      toast("Trial policies saved.", "success");
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
// Tab 4: Operator Profile
// =========================================================================

function buildAccountTab(profile) {
  const card = el("div", { class: "card", style: "padding:24px;" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;" }, [
      el("div", {}, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("admin_panel_settings", "text-gold"),
          el("h3", { style: "margin:0; font-size:17px; color:var(--color-ink);" }, "Super Administrator Identity"),
        ]),
        el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" },
          "Root credentials and platform operational privileges."
        ),
      ]),
      el("span", { class: "badge badge--gold", style: "font-weight:700; font-size:12px;" }, "Root Authority"),
    ]),

    el("div", { class: "filter-grid", style: "margin-bottom:24px;" }, [
      el("div", { class: "field" }, [
        el("label", {}, "Administrator Name"),
        el("input", { type: "text", value: profile.fullName || "Platform Admin", disabled: true }),
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "Login Email"),
        el("input", { type: "text", value: profile.email || "", disabled: true }),
      ]),
      el("div", { class: "field" }, [
        el("label", {}, "Platform Role"),
        el("input", { type: "text", value: "Super Administrator (All Access)", disabled: true }),
      ]),
    ]),

    el("div", { style: "display:flex; gap:12px; align-items:center; border-top:1px solid var(--color-line); padding-top:20px;" }, [
      el("a", { href: "#/change-password", class: "btn btn--primary btn--sm" }, [icon("lock_reset"), "Change Password"]),
    ]),
  ]);

  return card;
}

export function init() {}
