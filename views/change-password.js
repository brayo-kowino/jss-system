import { completeForcedPasswordChange, changeOwnPassword, logout } from "../js/services/auth.service.js";
import { navigate, renderRoute } from "../js/router.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

// ===========================================================================
// Password Change View
// Supports two modes:
// 1. Forced password-change gate: When profile.mustChangePassword is true,
//    renders full-screen (replaces shell) until the temporary password is rotated.
// 2. In-shell voluntary password change: When accessed from the topbar menu
//    or /change-password route by an active user.
// In both cases, changing password successfully registers the current device
// as a trusted device.
// ===========================================================================

const MIN_LENGTH = 8;

export async function render({ profile, forced = false } = {}) {
  const isForced = forced || profile?.mustChangePassword === true;

  if (isForced) {
    return renderForcedScreen(profile);
  }

  return renderInShellScreen(profile);
}

function renderForcedScreen(profile) {
  const wrap = el("div", { class: "auth-screen" });

  const brand = el("div", { class: "auth-brand" }, [
    el("div", { class: "auth-brand__bg" }, [
      el("div", { class: "auth-brand__grid" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--1" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--2" }),
    ]),
    el("div", { class: "auth-brand__top" }, [
      el("div", { class: "seal" }, [el("img", { class: "seal__img", src: "/assets/logo.png", alt: "logo" })]),
      el("div", {}, [
        el("div", { class: "auth-brand__top-name" }, "Almost there"),
        el("div", { class: "auth-brand__top-tag" }, "One quick security step"),
      ]),
    ]),
    el("div", { class: "auth-brand__content" }, [
      el("h1", { class: "auth-brand__headline" }, "Set your own password"),
      el("p", { class: "auth-brand__sub" }, "For your account's security, the temporary password you were given can only be used once. Choose a new password only you know before you continue."),
      el("div", { class: "auth-brand__tips" }, [
        el("div", { class: "auth-brand__tip" }, [icon("lock"), el("span", {}, "Never share this password with anyone")]),
        el("div", { class: "auth-brand__tip" }, [icon("devices"), el("span", {}, "This device will be saved as your primary trusted device")]),
        el("div", { class: "auth-brand__tip" }, [icon("verified_user"), el("span", {}, "Choose something you don't use elsewhere")]),
      ]),
    ]),
  ]);

  const card = el("div", { class: "auth-card" });
  card.append(
    el("div", { class: "auth-card__header" }, [
      el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: "/assets/logo.png", alt: "logo" })]),
      el("h1", {}, "Set a new password"),
      el("p", { class: "text-muted" }, profile?.fullName ? `Welcome, ${profile.fullName}. Please set a password for your account.` : "Please set a password for your account."),
    ])
  );

  const form = el("form", { id: "change-password-form", "data-mode": "forced" });

  const pw1Input = el("input", { id: "cp-password", type: "password", placeholder: `At least ${MIN_LENGTH} characters`, required: "true", autocomplete: "new-password" });
  const pw1Toggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const pw1Field = el("div", { class: "field" }, [
    el("label", { for: "cp-password" }, "New Password"),
    el("div", { class: "field--password" }, [pw1Input, pw1Toggle]),
  ]);

  const pw2Input = el("input", { id: "cp-password-confirm", type: "password", placeholder: "Re-enter your new password", required: "true", autocomplete: "new-password" });
  const pw2Toggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const pw2Field = el("div", { class: "field" }, [
    el("label", { for: "cp-password-confirm" }, "Confirm New Password"),
    el("div", { class: "field--password" }, [pw2Input, pw2Toggle]),
    el("div", { class: "field-error", id: "change-password-error" }, ""),
  ]);

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Set Password & Continue");

  form.append(pw1Field, pw2Field, submitBtn);
  card.append(form);

  const signOutRow = el("div", { style: "margin-top:16px;text-align:center;" }, [
    el("a", { href: "#", id: "cp-signout-link" }, "Sign out instead"),
  ]);

  const formside = el("div", { class: "auth-formside" }, [card, signOutRow]);

  setupPasswordToggles([[pw1Toggle, pw1Input], [pw2Toggle, pw2Input]]);

  wrap.append(brand, formside);
  return wrap;
}

function renderInShellScreen(profile) {
  const container = el("div", { class: "page" });

  // Create a focused, centered column for this single-purpose view
  const focusCol = el("div", { class: "settings-stack", style: "max-width: 560px; margin: 40px auto 0; width: 100%;" });

  const header = el("div", { style: "margin-bottom: 32px; text-align: center;" }, [
    el("div", { style: "display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:50%; background:color-mix(in srgb, var(--color-primary-700) 8%, white); color:var(--color-primary-700); margin-bottom:16px;" }, [
      icon("lock_person", { style: "font-size: 32px;" })
    ]),
    el("h1", { style: "font-size: var(--fs-xl); margin: 0 0 8px; color: var(--color-primary-900);" }, "Change Password"),
    el("p", { class: "text-muted", style: "margin: 0; font-size: var(--fs-md);" }, ""),
  ]);

  const notice = el("div", { class: "notice-banner" }, [
    icon("verified_user"),
    el("div", {}, "Updating your password will secure your account and automatically register this device as a trusted device."),
  ]);

  const card = el("div", { class: "card settings-card" });
  const form = el("form", { id: "change-password-form", "data-mode": "voluntary" });

  const curPwInput = el("input", { id: "cp-current-password", type: "password", placeholder: "Enter your current password", required: "true", autocomplete: "current-password" });
  const curPwToggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const curPwField = el("div", { class: "field" }, [
    el("label", { for: "cp-current-password" }, "Current Password"),
    el("div", { class: "field--password" }, [curPwInput, curPwToggle]),
  ]);

  const pw1Input = el("input", { id: "cp-password", type: "password", placeholder: `At least ${MIN_LENGTH} characters`, required: "true", autocomplete: "new-password" });
  const pw1Toggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const pw1Field = el("div", { class: "field", style: "margin-top: 24px;" }, [
    el("label", { for: "cp-password" }, "New Password"),
    el("div", { class: "field--password" }, [pw1Input, pw1Toggle]),
    el("span", { class: "field-hint" }, `Must be at least ${MIN_LENGTH} characters long`),
  ]);

  const pw2Input = el("input", { id: "cp-password-confirm", type: "password", placeholder: "Confirm your new password", required: "true", autocomplete: "new-password" });
  const pw2Toggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const pw2Field = el("div", { class: "field" }, [
    el("label", { for: "cp-password-confirm" }, "Confirm New Password"),
    el("div", { class: "field--password" }, [pw2Input, pw2Toggle]),
    el("div", { class: "field-error", id: "change-password-error" }, ""),
  ]);

  const actions = el("div", { class: "settings-form-actions" }, [
    el("button", { type: "button", class: "btn btn--ghost", onClick: () => navigate("/dashboard") }, "Cancel"),
    el("button", { type: "submit", class: "btn btn--primary" }, [icon("lock_reset"), " Update Password"]),
  ]);

  form.append(curPwField, pw1Field, pw2Field, actions);
  card.append(form);
  focusCol.append(header, notice, card);

  setupPasswordToggles([
    [curPwToggle, curPwInput],
    [pw1Toggle, pw1Input],
    [pw2Toggle, pw2Input],
  ]);

  container.append(focusCol);
  return container;
}

function setupPasswordToggles(pairs) {
  pairs.forEach(([toggle, input]) => {
    toggle.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.innerHTML = "";
      toggle.append(icon(showing ? "visibility" : "visibility_off"));
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
}

export function init({ profile } = {}) {
  const form = document.getElementById("change-password-form");
  if (!form) return;
  const errorEl = document.getElementById("change-password-error");
  const signOutLink = document.getElementById("cp-signout-link");
  const mode = form.getAttribute("data-mode") || "voluntary";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = "";
    const curPw = document.getElementById("cp-current-password")?.value || "";
    const pw1 = document.getElementById("cp-password")?.value || "";
    const pw2 = document.getElementById("cp-password-confirm")?.value || "";

    if (mode === "voluntary" && !curPw) {
      if (errorEl) errorEl.textContent = "Please enter your current password.";
      return;
    }
    if (pw1.length < MIN_LENGTH) {
      if (errorEl) errorEl.textContent = `Password must be at least ${MIN_LENGTH} characters.`;
      return;
    }
    if (pw1 !== pw2) {
      if (errorEl) errorEl.textContent = "Passwords don't match.";
      return;
    }

    const btn = form.querySelector("button[type=submit]");
    const restore = busyButton(btn, "Updating…");
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), 15000)
    );

    try {
      if (mode === "forced") {
        await Promise.race([completeForcedPasswordChange(pw1), timeout]);
        toast("Password set - welcome in! This device is registered as trusted.", "success");
        navigate("/dashboard");
        await renderRoute();
      } else {
        await Promise.race([changeOwnPassword(curPw, pw1), timeout]);
        toast("Password changed successfully! This device is registered as trusted.", "success");
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Password change failed:", err);
      if (errorEl) errorEl.textContent = friendlyError(err);
      restore();
    }
  });

  if (signOutLink) {
    signOutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      await logout();
      navigate("/login");
    });
  }
}

function friendlyError(err) {
  const code = err?.code || "";
  if (err?.message === "TIMEOUT") {
    return "This is taking too long - check your connection, or sign out and back in and try again.";
  }
  if (code.includes("wrong-password") || code.includes("invalid-credential") || code.includes("invalid-password")) {
    return "Your current password is incorrect. Please check and try again.";
  }
  if (code.includes("requires-recent-login") || code.includes("invalid-user-token") || code.includes("user-token-expired")) {
    return "Please enter your current password to confirm this change.";
  }
  if (code.includes("weak-password")) {
    return "Please choose a stronger password (at least 8 characters).";
  }
  if (code.includes("network-request-failed")) {
    return "Network problem - check your connection and try again.";
  }
  return err.message || "Couldn't update your password. Please check your details and try again.";
}