// ==========================================================================
// Auth gate screens: device-approval wait + 2FA code entry.
// ==========================================================================
// Originally these only rendered from views/login.js, right after the
// login form's submit handler got a needsApproval/needs2FA flag back from
// login(). That flag is a one-time signal from a single function call - it
// says nothing about the state of the world on the NEXT navigation, page
// refresh, or the router's independent onAuthStateChanged-driven render.
// Firebase Auth's own session is already fully live at that point
// regardless of these flags (see auth.service.js's login() - the
// signInWithEmailAndPassword call above the device/2FA checks always
// succeeds), so nothing stopped router.js from mounting the full app shell
// underneath/instead the moment the page re-rendered for any other reason.
// That's what let an unapproved device reach the dashboard (and its own
// pending-approval modal) directly.
//
// Now router.js calls getAuthGateStatus() (auth.service.js) on every
// protected-route render and, if it's non-null, renders one of these two
// screens INSTEAD of the shell - so the gate is enforced continuously, not
// just at the instant of form submission.
// ==========================================================================

import { watchLoginApproval, redeemLoginApproval } from "../services/login-approval.service.js";
import { validate2FALogin, is2FAEnabled, mark2FAVerifiedThisSession } from "../services/two-factor.service.js";
import { generateDeviceFingerprint, getDeviceInfo } from "../services/device.service.js";
import { logout, refreshCurrentSchool } from "../services/auth.service.js";
import { el, icon, toast, busyButton } from "../utils.js";

// ===========================================================================
// Awaiting-approval gate.
// Rendered when an admin/super_admin logs in from an unrecognized device.
// Shows device details and a live spinner while waiting for the primary
// device's holder to approve or deny the login attempt.
//
// @param {Object} gate - { uid, approvalId, fingerprint, deviceInfo }
// @param {Function} onDone - called once the gate clears (approved, and if
//   applicable, 2FA also passed) so the caller can proceed past it.
// ===========================================================================
export function renderApprovalGate(gate, onDone) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const di = gate.deviceInfo || {};
  const now = new Date();
  const timeStr = now.toLocaleString();

  const wrap = el("div", { class: "approval-wait" });
  wrap.append(
    el("span", { class: "material-symbols-rounded approval-wait__icon" }, "devices"),
    el("h1", { class: "approval-wait__title" }, "New Device Detected"),
    el("p", { class: "approval-wait__sub" }, "A login approval request has been sent to your primary device. Please approve the login from there to continue."),
    el("div", { class: "approval-wait__device-card" }, [
      el("div", { class: "approval-wait__device-row" }, [icon("computer"), el("span", { class: "approval-wait__device-label" }, "Device:"), el("span", {}, di.deviceName || "Unknown")]),
      el("div", { class: "approval-wait__device-row" }, [icon("aspect_ratio"), el("span", { class: "approval-wait__device-label" }, "Screen:"), el("span", {}, di.screenRes || "Unknown")]),
      el("div", { class: "approval-wait__device-row" }, [icon("schedule"), el("span", { class: "approval-wait__device-label" }, "Time:"), el("span", {}, timeStr)]),
      el("div", { class: "approval-wait__device-row" }, [icon("public"), el("span", { class: "approval-wait__device-label" }, "Timezone:"), el("span", {}, di.timezone || "Unknown")]),
    ]),
    el("div", { class: "approval-wait__spinner" }, [el("span", { class: "spinner spinner--md spinner--dark" })]),
    el("p", { class: "text-muted text-sm" }, "Waiting for approval..."),
  );

  const statusEl = el("div", { id: "approval-status" });
  wrap.append(statusEl);

  const cancelBtn = el("button", { class: "btn btn--outline approval-wait__cancel" }, "Cancel & Sign Out");
  wrap.append(cancelBtn);

  app.appendChild(wrap);

  // Real-time listener: watch for the approval doc to be updated to
  // "approved" or "denied". That write can now only ever have come from
  // login-approval-approve.ts (service-account credential) - see that
  // file's header - so this listener is safe to trust for UI purposes.
  const unsubscribe = watchLoginApproval(gate.uid, gate.approvalId, async (approval) => {
    if (!approval) return;
    if (approval.status === "approved") {
      unsubscribe();
      // Redeem the approval server-side - this independently re-verifies
      // the approval doc (not just the status this listener happened to
      // observe) before registering the device as trusted.
      try {
        const fingerprint = gate.fingerprint || generateDeviceFingerprint();
        const deviceInfo = gate.deviceInfo || getDeviceInfo();
        await redeemLoginApproval(gate.uid, gate.approvalId, fingerprint, deviceInfo);
      } catch (e) {
        console.error("Failed to redeem approved device:", e);
      }
      if (await is2FAEnabled(gate.uid)) {
        renderTwoFactorGate({ uid: gate.uid }, onDone);
        return;
      }
      await refreshCurrentSchool();
      toast("Login approved! Welcome in.", "success");
      onDone();
    } else if (approval.status === "denied") {
      unsubscribe();
      statusEl.innerHTML = "";
      statusEl.append(
        el("p", { class: "approval-wait__denied" }, "Login was denied from the primary device."),
      );
      // Sign out after a short delay so the message is visible
      setTimeout(async () => {
        await logout();
        window.location.hash = "#/login";
      }, 3000);
    }
  });

  cancelBtn.addEventListener("click", async () => {
    unsubscribe();
    await logout();
    window.location.hash = "#/login";
  });
}

// ===========================================================================
// Two-factor authentication gate.
// Rendered when an admin/super_admin with 2FA enabled is on a trusted
// device but hasn't verified a code yet this browser session.
//
// @param {Object} gate - { uid }
// @param {Function} onDone - called once a valid code is entered.
// ===========================================================================
export function renderTwoFactorGate(gate, onDone) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const wrap = el("div", { class: "twofa-gate" });
  const card = el("div", { class: "twofa-gate__card" });

  const codeInput = el("input", {
    class: "twofa-gate__input",
    type: "text",
    maxlength: "6",
    placeholder: "000000",
    autocomplete: "one-time-code",
    inputmode: "numeric",
    pattern: "[0-9]*",
  });
  const errorEl = el("div", { class: "twofa-gate__error" });
  const submitBtn = el("button", { class: "btn btn--primary btn--block" }, "Verify");
  const backupLink = el("a", { href: "#", class: "twofa-gate__backup-link" }, "Use a backup code instead");

  card.append(
    el("span", { class: "material-symbols-rounded twofa-gate__icon" }, "lock"),
    el("h2", { class: "twofa-gate__title" }, "Two-Factor Authentication"),
    el("p", { class: "twofa-gate__sub" }, "Enter the 6-digit code from your authenticator app."),
    codeInput,
    errorEl,
    submitBtn,
    backupLink,
  );

  const cancelBtn = el("button", { class: "btn btn--outline", style: "margin-top:16px;" }, "Cancel & Sign Out");
  wrap.append(card, cancelBtn);
  app.appendChild(wrap);

  setTimeout(() => codeInput.focus(), 100);

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/[^0-9]/g, "");
    if (codeInput.value.length === 6) {
      submitBtn.click();
    }
  });

  submitBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const code = codeInput.value.trim();
    if (code.length < 6) {
      errorEl.textContent = "Enter the full 6-digit code.";
      return;
    }
    const restore = busyButton(submitBtn, "Verifying…");
    try {
      const valid = await validate2FALogin(gate.uid, code);
      if (valid) {
        mark2FAVerifiedThisSession(gate.uid);
        await refreshCurrentSchool();
        toast("Verified! Welcome in.", "success");
        onDone();
      } else {
        errorEl.textContent = "Invalid code. Please try again.";
        codeInput.value = "";
        codeInput.focus();
        restore();
      }
    } catch (err) {
      errorEl.textContent = err.message || "Verification failed. Please try again.";
      restore();
    }
  });

  cancelBtn.addEventListener("click", async () => {
    await logout();
    window.location.hash = "#/login";
  });

  backupLink.addEventListener("click", (e) => {
    e.preventDefault();
    codeInput.setAttribute("maxlength", "8");
    codeInput.setAttribute("placeholder", "ABCD1234");
    codeInput.setAttribute("inputmode", "text");
    codeInput.removeAttribute("pattern");
    codeInput.value = "";
    codeInput.focus();
    backupLink.textContent = "Enter authenticator code";
    backupLink.addEventListener("click", (e2) => {
      e2.preventDefault();
      codeInput.setAttribute("maxlength", "6");
      codeInput.setAttribute("placeholder", "000000");
      codeInput.setAttribute("inputmode", "numeric");
      codeInput.setAttribute("pattern", "[0-9]*");
      codeInput.value = "";
      codeInput.focus();
      backupLink.textContent = "Use a backup code instead";
    }, { once: true });
  });
}
