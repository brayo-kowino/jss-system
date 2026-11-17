// ==========================================================================
// Emergency Account Freeze View
// Public route rendered when an admin clicks their email security alert link.
// ==========================================================================

import { el, icon } from "../js/utils.js";
import { navigate } from "../js/router.js";

export async function render() {
  const hash = location.hash || "";
  const queryIndex = hash.indexOf("?");
  const params = queryIndex !== -1 ? new URLSearchParams(hash.slice(queryIndex)) : new URLSearchParams();
  const token = params.get("token");

  const wrap = el("div", {
    class: "auth-page-wrap",
    style: "min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--color-bg, #f8fafc);",
  });

  const card = el("div", {
    class: "card",
    style: "max-width: 540px; width: 100%; padding: 36px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border-radius: 16px; border: 1px solid var(--color-line, #e2e8f0); text-align: center;",
  });

  if (!token) {
    card.append(
      el("div", { style: "width: 64px; height: 64px; border-radius: 50%; background: #fef2f2; color: #dc2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;" }, [
        icon("error", "style: font-size: 32px;"),
      ]),
      el("h2", { style: "font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px;" }, "Invalid Emergency Link"),
      el("p", { class: "text-muted", style: "font-size: 14px; line-height: 1.6; margin-bottom: 24px;" },
        "This emergency freeze link is missing its security token. Please click the exact link provided in your security alert email."
      ),
      el("button", {
        type: "button",
        class: "btn btn--primary",
        onClick: () => navigate("/login"),
      }, "Return to Sign In")
    );
    wrap.append(card);
    return wrap;
  }

  // Show loading while performing the freeze call
  const loadingEl = el("div", {}, [
    el("div", { class: "spinner", style: "margin: 0 auto 20px; width: 44px; height: 44px; border-width: 3px;" }),
    el("h2", { style: "font-size: 18px; font-weight: 600; color: #0f172a;" }, "Quarantining Account…"),
    el("p", { class: "text-muted text-sm" }, "Contacting security servers to terminate active sessions…"),
  ]);
  card.append(loadingEl);
  wrap.append(card);

  try {
    const res = await fetch(`/emergency-freeze?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    const data = await res.json();
    card.innerHTML = "";

    if (!res.ok || !data.success) {
      card.append(
        el("div", { style: "width: 64px; height: 64px; border-radius: 50%; background: #fef2f2; color: #dc2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;" }, [
          icon("lock_clock", "style: font-size: 32px;"),
        ]),
        el("h2", { style: "font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px;" }, "Link Expired or Already Used"),
        el("p", { class: "text-muted", style: "font-size: 14px; line-height: 1.6; margin-bottom: 24px;" },
          data.error || "This freeze token has already been processed or expired. If your account is compromised, please use the emergency support button on the login screen."
        ),
        el("button", {
          type: "button",
          class: "btn btn--primary",
          onClick: () => navigate("/login"),
        }, "Go to Login Page")
      );
      return wrap;
    }

    // Success quarantine screen
    card.append(
      el("div", { style: "width: 68px; height: 68px; border-radius: 50%; background: #ecfdf5; color: #059669; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;" }, [
        icon("shield", "style: font-size: 36px;"),
      ]),
      el("h2", { style: "font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 8px;" }, "Account Quarantined & Protected"),
      el("p", { style: "font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 20px;" }, [
        "Your account (",
        el("strong", { style: "color: #0f172a;" }, data.email || "Administrator"),
        ") has been immediately suspended to prevent unauthorized actions."
      ]),

      el("div", { style: "background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left;" }, [
        el("div", { style: "display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: #0f172a;" }, [
          icon("check_circle", "text-success text-sm"),
          "Active sessions across all browsers terminated immediately"
        ]),
        el("div", { style: "display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: #0f172a;" }, [
          icon("check_circle", "text-success text-sm"),
          "Two-factor authentication and device approvals cleared"
        ]),
        el("div", { style: "display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #0f172a;" }, [
          icon("check_circle", "text-success text-sm"),
          `High-priority security incident ticket #${(data.ticketId || "EMERGENCY").slice(0, 8)} opened`
        ]),
      ]),

      el("div", { style: "background: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 14px; margin-bottom: 24px; text-align: left;" }, [
        el("div", { style: "font-weight: 600; color: #92400e; font-size: 13px; margin-bottom: 4px;" }, "What happens next?"),
        el("p", { style: "font-size: 12px; color: #78350f; margin: 0; line-height: 1.5;" },
          "Our platform security desk has been alerted. An engineer will verify your identity via the official school administration phone lines before re-issuing clean temporary credentials."
        ),
      ]),

      el("button", {
        type: "button",
        class: "btn btn--primary btn--block",
        onClick: () => navigate("/login"),
      }, "Return to Sign In Page")
    );
  } catch (err) {
    card.innerHTML = "";
    card.append(
      el("div", { style: "width: 64px; height: 64px; border-radius: 50%; background: #fef2f2; color: #dc2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;" }, [
        icon("wifi_off", "style: font-size: 32px;"),
      ]),
      el("h2", { style: "font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px;" }, "Network Error"),
      el("p", { class: "text-muted", style: "font-size: 14px; line-height: 1.6; margin-bottom: 24px;" },
        "Could not reach the security server. Please check your internet connection and try again."
      ),
      el("button", {
        type: "button",
        class: "btn btn--primary",
        onClick: () => location.reload(),
      }, "Try Again")
    );
  }

  return wrap;
}
