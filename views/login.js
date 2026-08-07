import { login, requestPasswordReset } from "../js/services/auth.service.js";
import { auth } from "../js/firebase-config.js";
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { navigate } from "../js/router.js";
import { el, icon, toast, busyButton } from "../js/utils.js";
import { getSchoolBySlug, slugify } from "../js/services/settings.service.js";
import { applyBranding } from "../js/components/shell.js";

const BRAND_POINTS = [
  { icon: "school", text: "Admissions, classes, streams and CBC subjects in one place" },
  { icon: "assessment", text: "Assessments, marks and auto-generated CBC report cards" },
  { icon: "payments", text: "Fees, attendance and timetables tracked in real time" },
];

// ===========================================================================
// School-aware branding
// Every account signs into one shared login form regardless of school (the
// same email can only ever belong to one school, resolved server-side after
// auth succeeds) - so branding a returning school's login page is a purely
// cosmetic problem: look up their public code (school_public/{slug}, see
// settings.service.js) either from a ?school= link or from what this
// browser last used, and skin the page before it's ever shown.
// ===========================================================================

const LAST_SCHOOL_KEY = "jss_school_slug";

function readStoredSlug() {
  try {
    return localStorage.getItem(LAST_SCHOOL_KEY) || "";
  } catch {
    return "";
  }
}
function storeSlug(slug) {
  try {
    localStorage.setItem(LAST_SCHOOL_KEY, slug);
  } catch {
    // localStorage unavailable (private browsing, etc.) - the school just
    // won't be remembered for next time, which is harmless.
  }
}
function clearStoredSlug() {
  try {
    localStorage.removeItem(LAST_SCHOOL_KEY);
  } catch {
    // Same as above - non-fatal either way.
  }
}
function loginUrl(slug) {
  const base = `${location.origin}${location.pathname}`;
  return slug ? `${base}?school=${encodeURIComponent(slug)}#/login` : `${base}#/login`;
}

// An explicit ?school= link always wins over whatever's remembered on this
// device, so a freshly shared link never gets overridden by an old code.
async function resolveSchool() {
  const urlSlug = new URLSearchParams(location.search).get("school") || "";
  const candidate = urlSlug || readStoredSlug();
  if (!candidate) return null;
  const school = await getSchoolBySlug(candidate).catch(() => null);
  if (!school) {
    clearStoredSlug();
    return null;
  }
  storeSlug(school.slug);
  return school;
}

export async function render() {
  const school = await resolveSchool();

  // Keeps the address bar canonical (?school=slug for a branded page, bare
  // for the generic one) so this exact page is always bookmarkable/
  // shareable, even when the branding came from a remembered code rather
  // than the URL the visitor actually typed.
  history.replaceState(null, "", loginUrl(school?.slug));

  const logoSrc = school?.logoUrl || "assets/logo.png";
  const brandName = school?.schoolName || "JSS Manager";
  const brandTag = school ? "Powered by JSS Manager" : "School Management System";
  const headline = school ? `Welcome back to ${school.schoolName}` : "Run your junior secondary school with confidence";
  const sub = school
    ? "Sign in to manage students, grading, fees, attendance and more."
    : "One dashboard for admins, teachers, parents and support staff to manage students, grading, fees and more - built for the CBC curriculum.";

  const wrap = el("div", { class: "auth-screen" });

  // Left: brand panel
  const brand = el("div", { class: "auth-brand" }, [
    el("div", { class: "auth-brand__top" }, [
      el("div", { class: "seal" }, [el("img", { class: "seal__img", src: logoSrc, alt: `${brandName} logo` })]),
      el("div", {}, [
        el("div", { class: "auth-brand__top-name" }, brandName),
        el("div", { class: "auth-brand__top-tag" }, brandTag),
      ]),
    ]),
    el("div", { class: "auth-brand__content" }, [
      el("h1", { class: "auth-brand__headline" }, headline),
      el("p", { class: "auth-brand__sub" }, sub),
      el("div", { class: "auth-brand__points" }, BRAND_POINTS.map((p) =>
        el("div", { class: "auth-brand__point" }, [icon(p.icon), el("span", {}, p.text)])
      )),
    ]),
  ]);

  // Right: form panel
  const card = el("div", { class: "auth-card" });
  card.append(
    el("div", { class: "auth-card__header" }, [
      el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: logoSrc, alt: `${brandName} logo` })]),
      el("h1", {}, "Hi, welcome back"),
      el("p", { class: "text-muted" }, school ? `Sign in to your ${school.schoolName} account` : "Please sign in with your account details"),
    ])
  );

  const form = el("form", { id: "login-form" });
  const emailField = el("div", { class: "field" }, [
    el("label", { for: "email" }, "Email Address"),
    el("input", { id: "email", type: "email", placeholder: "you@school.ac.ke", required: "true", autocomplete: "username" }),
  ]);

  const passwordInput = el("input", { id: "password", type: "password", placeholder: "Enter your password", required: "true", autocomplete: "current-password" });
  const passwordToggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password" }, [icon("visibility")]);
  const passwordField = el("div", { class: "field" }, [
    el("label", { for: "password" }, "Password"),
    el("div", { class: "field--password" }, [passwordInput, passwordToggle]),
    el("div", { class: "field-error", id: "login-error" }, ""),
  ]);

  const rememberCheckbox = el("input", { type: "checkbox", id: "remember-me" });
  const authRow = el("div", { class: "auth-row" }, [
    el("label", { for: "remember-me" }, [rememberCheckbox, "Remember me"]),
    el("a", { href: "#", id: "forgot-link" }, "Forgot Password?"),
  ]);

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Sign In");

  form.append(emailField, passwordField, authRow, submitBtn);
  card.append(form);

  // Switch-school / enter-code affordance: a one-line link that reveals a
  // small inline form, rather than a second full page.
  const switchRow = school
    ? el("div", { style: "margin-top:16px;text-align:center;" }, [
        el("span", { class: "text-sm text-muted" }, "Not your school? "),
        el("a", { href: "#", id: "switch-school-link" }, "Use a different one"),
      ])
    : el("div", { style: "margin-top:16px;text-align:center;" }, [
        el("span", { class: "text-sm text-muted" }, "Already using JSS Manager at your school? "),
        el("a", { href: "#", id: "enter-code-link" }, "Enter your school code"),
      ]);

  const codeInput = el("input", { id: "school-code-input", type: "text", placeholder: "e.g. greenhill-jss" });
  const codeForm = el("form", { id: "school-code-form", style: "display:none;margin-top:10px;" }, [
    el("div", { style: "display:flex;gap:8px;align-items:flex-start;" }, [
      el("div", { class: "field", style: "flex:1;margin-bottom:0;" }, [codeInput]),
      el("button", { type: "submit", class: "btn btn--tonal btn--sm" }, "Go"),
    ]),
    el("div", { class: "field-error", id: "school-code-error" }, ""),
  ]);

  const formside = el("div", { class: "auth-formside" }, [
    card,
    switchRow,
    codeForm,
    el("div", {
      style: "margin-top: 24px; text-align: center; font-size: 0.75rem; color: var(--color-ink-soft);",
    }, [
      "Powered by ",
      el("b", { style: "color: var(--color-primary-700); letter-spacing: 0.05em;" }, "ISKY360 ERP Softwares"),
    ]),
  ]);

  passwordToggle.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    passwordToggle.innerHTML = "";
    passwordToggle.append(icon(showing ? "visibility" : "visibility_off"));
    passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  // Re-theme sidebar/button colors to the resolved school's brand, same
  // helper the authenticated shell uses. A no-op (falls back to defaults)
  // when no school was resolved.
  applyBranding(school);

  wrap.append(brand, formside);
  return wrap;
}

export function init() {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const forgotLink = document.getElementById("forgot-link");
  const rememberCheckbox = document.getElementById("remember-me");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const btn = form.querySelector("button[type=submit]");
    const restore = busyButton(btn, "Signing in…");
    try {
      await setPersistence(auth, rememberCheckbox.checked ? browserLocalPersistence : browserSessionPersistence);
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      errorEl.textContent = friendlyError(err);
      restore();
    }
  });

  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!email) {
      errorEl.textContent = "Enter your email above first, then click 'Forgot Password?'";
      return;
    }
    const restore = busyButton(forgotLink, "Sending…");
    try {
      await requestPasswordReset(email);
      toast("Password reset email sent - check your inbox.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      restore();
    }
  });

  // "Not your school?" - drop the remembered code and reload onto the
  // generic screen. A full reload (rather than re-rendering in place) is
  // deliberate: it's a rare action, and it guarantees every bit of applied
  // branding (CSS vars, page title, etc.) resets cleanly.
  document.getElementById("switch-school-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearStoredSlug();
    location.href = loginUrl(null);
    location.reload();
  });

  // "Enter your school code" - reveals the inline code form.
  document.getElementById("enter-code-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("enter-code-link").parentElement.style.display = "none";
    const codeForm = document.getElementById("school-code-form");
    codeForm.style.display = "";
    document.getElementById("school-code-input").focus();
  });

  document.getElementById("school-code-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const codeErrorEl = document.getElementById("school-code-error");
    codeErrorEl.textContent = "";
    const raw = document.getElementById("school-code-input").value;
    const clean = slugify(raw);
    if (!clean) {
      codeErrorEl.textContent = "Enter your school's code first.";
      return;
    }
    const btn = e.submitter;
    const restore = busyButton(btn, "");
    try {
      const school = await getSchoolBySlug(clean);
      if (!school) {
        codeErrorEl.textContent = "That code wasn't recognized - check with your school administrator.";
        restore();
        return;
      }
      storeSlug(school.slug);
      // Same reasoning as "switch school": reload onto the now-branded URL
      // rather than re-rendering everything in place.
      location.href = loginUrl(school.slug);
      location.reload();
    } catch (err) {
      codeErrorEl.textContent = "Couldn't check that code right now - try again.";
      restore();
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
