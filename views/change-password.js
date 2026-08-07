import { completeForcedPasswordChange, logout } from "../js/services/auth.service.js";
import { navigate, renderRoute } from "../js/router.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

// ===========================================================================
// Forced password-change gate.
// Rendered directly by router.js (not through the normal route table) any
// time the signed-in profile has mustChangePassword === true - i.e. every
// account an admin/super_admin just created with a temporary password, and
// every school's first admin login. It fully replaces the shell (no sidebar,
// no nav) so there's no way to reach the rest of the app until this runs.
// ===========================================================================

const MIN_LENGTH = 8;

export async function render({ profile } = {}) {
  const wrap = el("div", { class: "auth-screen" });

  const brand = el("div", { class: "auth-brand" }, [
    el("div", { class: "auth-brand__device" }, [
      el("div", { class: "laptop-frame" }, [
        el("div", { class: "laptop-frame__screen" }, [
          el("div", { class: "laptop-frame__cam" }),
          el("div", { class: "laptop-frame__viewport" }, [
            el("img", { src: "assets/jss-manager-hero-image.png", alt: "JSS Manager dashboard preview" }),
            el("div", { class: "laptop-frame__sheen" }),
          ]),
        ]),
        el("div", { class: "laptop-frame__base" }),
      ]),
    ]),
    el("div", { class: "auth-brand__scrim" }),
    el("div", { class: "auth-brand__top" }, [
      el("div", { class: "seal" }, [el("img", { class: "seal__img", src: "assets/logo.png", alt: "logo" })]),
      el("div", {}, [
        el("div", { class: "auth-brand__top-name" }, "Almost there"),
        el("div", { class: "auth-brand__top-tag" }, "One quick security step"),
      ]),
    ]),
    el("div", { class: "auth-brand__content" }, [
      el("h1", { class: "auth-brand__headline" }, "Set your own password"),
      el("p", { class: "auth-brand__sub" }, "For your account's security, the temporary password you were given can only be used once. Choose a new password only you know before you continue."),
      el("div", { class: "auth-brand__points" }, [
        el("div", { class: "auth-brand__point" }, [icon("lock"), el("span", {}, "Never share this password with anyone")]),
        el("div", { class: "auth-brand__point" }, [icon("verified_user"), el("span", {}, "Choose something you don't use elsewhere")]),
      ]),
    ]),
  ]);

  const card = el("div", { class: "auth-card" });
  card.append(
    el("div", { class: "auth-card__header" }, [
      el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: "assets/logo.png", alt: "logo" })]),
      el("h1", {}, "Set a new password"),
      el("p", { class: "text-muted" }, profile?.fullName ? `Welcome, ${profile.fullName}. Please set a password for your account.` : "Please set a password for your account."),
    ])
  );

  const form = el("form", { id: "change-password-form" });

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

  [
    [pw1Toggle, pw1Input],
    [pw2Toggle, pw2Input],
  ].forEach(([toggle, input]) => {
    toggle.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.innerHTML = "";
      toggle.append(icon(showing ? "visibility" : "visibility_off"));
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });

  wrap.append(brand, formside);
  return wrap;
}

export function init() {
  const form = document.getElementById("change-password-form");
  const errorEl = document.getElementById("change-password-error");
  const signOutLink = document.getElementById("cp-signout-link");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const pw1 = document.getElementById("cp-password").value;
    const pw2 = document.getElementById("cp-password-confirm").value;

    if (pw1.length < MIN_LENGTH) {
      errorEl.textContent = `Password must be at least ${MIN_LENGTH} characters.`;
      return;
    }
    if (pw1 !== pw2) {
      errorEl.textContent = "Passwords don't match.";
      return;
    }

    const btn = form.querySelector("button[type=submit]");
    const restore = busyButton(btn, "Updating…");
    // Belt-and-braces against ever leaving the button stuck spinning: if
    // completeForcedPasswordChange doesn't settle within a reasonable time
    // (flaky connection, a stale session hanging on a token refresh, etc.)
    // this timeout wins the race and hands control back to the person
    // instead of the screen looking frozen forever.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), 15000)
    );
    try {
      await Promise.race([completeForcedPasswordChange(pw1), timeout]);
      toast("Password set - welcome in.", "success");
      // The hash is already "/dashboard" while mustChangePassword gated us
      // here, so navigate("/dashboard") would set location.hash to its own
      // current value - browsers don't fire hashchange for that, so the
      // router would never re-run and this screen would stay stuck even
      // though the profile is now cleared. Re-render directly instead of
      // going through navigate()/hashchange.
      if (location.hash.replace(/^#/, "") === "/dashboard") {
        await renderRoute();
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Forced password change failed:", err);
      errorEl.textContent = friendlyError(err);
      restore();
    }
  });

  signOutLink.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout();
    navigate("/login");
  });
}

function friendlyError(err) {
  const code = err?.code || "";
  if (err?.message === "TIMEOUT") {
    return "This is taking too long - check your connection, or sign out and back in and try again.";
  }
  if (code.includes("requires-recent-login") || code.includes("invalid-user-token") || code.includes("user-token-expired")) {
    return "Your sign-in session isn't fresh enough for this. Please sign out and sign back in, then try again.";
  }
  if (code.includes("weak-password")) {
    return "Please choose a stronger password.";
  }
  if (code.includes("network-request-failed")) {
    return "Network problem - check your connection and try again.";
  }
  return err.message || "Couldn't update your password. Please sign out, sign back in, and try again.";
}