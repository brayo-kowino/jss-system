import { login, requestPasswordReset } from "../js/services/auth.service.js";
import { navigate } from "../js/router.js";
import { el, toast } from "../js/utils.js";

export async function render() {
  const wrap = el("div", { class: "auth-screen" });

  const card = el("div", { class: "auth-card" });
  card.append(
    el("div", { class: "auth-card__header" }, [
      el("div", { class: "seal seal--lg" }, "JS"),
      el("h1", {}, "JSS Manager"),
      el("p", { class: "text-muted" }, "Sign in to continue to your dashboard"),
    ])
  );

  const form = el("form", { id: "login-form" });

  const emailField = el("div", { class: "field" }, [
    el("label", { for: "email" }, "Email"),
    el("input", { id: "email", type: "email", required: "true", autocomplete: "username" }),
  ]);

  const passwordField = el("div", { class: "field" }, [
    el("label", { for: "password" }, "Password"),
    el("input", { id: "password", type: "password", required: "true", autocomplete: "current-password" }),
    el("div", { class: "field-error", id: "login-error" }, ""),
  ]);

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Sign in");
  const forgotLink = el(
    "p",
    { class: "text-sm text-right", style: "margin-top:12px;" },
    [el("a", { href: "#", id: "forgot-link" }, "Forgot password?")]
  );

  form.append(emailField, passwordField, submitBtn, forgotLink);
  card.append(form);
  wrap.append(card);
  return wrap;
}

export function init() {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const forgotLink = document.getElementById("forgot-link");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      errorEl.textContent = friendlyError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!email) {
      errorEl.textContent = "Enter your email above first, then click 'Forgot password?'";
      return;
    }
    try {
      await requestPasswordReset(email);
      toast("Password reset email sent — check your inbox.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  });
}

function friendlyError(err) {
  const code = err?.code || "";
  if (code.includes("user-not-found") || code.includes("invalid-credential") || code.includes("wrong-password")) {
    return "Incorrect email or password.";
  }
  if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  return err.message || "Something went wrong. Please try again.";
}
