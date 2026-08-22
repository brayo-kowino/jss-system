import { login, requestPasswordReset } from "../js/services/auth.service.js";
import { watchLoginApproval } from "../js/services/login-approval.service.js";
import { validate2FALogin, is2FAEnabled } from "../js/services/two-factor.service.js";
import { registerTrustedDevice, generateDeviceFingerprint, getDeviceInfo } from "../js/services/device.service.js";
import { auth } from "../js/firebase-config.js";
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { navigate } from "../js/router.js";
import { el, icon, toast, busyButton, setFavicon } from "../js/utils.js";
import { getSchoolBySlug, slugify, SLUG_PREFIX } from "../js/services/settings.service.js";
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

// Illustrated learner motif for the left brand panel: a seated figure in a
// graduation gown, reading a book with a mortarboard cap, drawn in the same
// gold/cream line-art style as the rest of the auth screen (translucent
// cream fills, gold strokes) instead of a literal tech/network diagram.
// Motion stays gentle and ambient: the book's page settles as if just
// turned, the cap has a faint float, and a handful of soft twinkles fade
// in and out around the figure.
const TWINKLES = [
  { cx: 96, cy: 108, s: 1.0, dur: 3.4, delay: 0.0 },
  { cx: 372, cy: 96, s: 0.75, dur: 3.0, delay: 0.6 },
  { cx: 392, cy: 236, s: 0.85, dur: 3.8, delay: 1.4 },
  { cx: 78, cy: 258, s: 0.7, dur: 3.2, delay: 2.0 },
  { cx: 336, cy: 330, s: 0.6, dur: 2.8, delay: 0.9 },
  { cx: 150, cy: 60, s: 0.65, dur: 3.6, delay: 1.7 },
];

// Small 4-point sparkle path centered on (cx, cy), sized by `s`.
function sparklePath(cx, cy, s) {
  const a = 9 * s, b = 2.4 * s;
  return `M${cx},${cy - a} L${cx + b},${cy - b} L${cx + a},${cy} L${cx + b},${cy + b} ` +
    `L${cx},${cy + a} L${cx - b},${cy + b} L${cx - a},${cy} L${cx - b},${cy - b} Z`;
}

function buildLearnerSvg() {
  const twinkles = TWINKLES.map(
    (t, i) => `<path class="learner-twinkle" style="animation-duration:${t.dur}s;animation-delay:${t.delay}s" d="${sparklePath(t.cx, t.cy, t.s)}" />`
  ).join("");

  return `
    <svg class="learner-svg" viewBox="0 0 480 420" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <g class="learner-twinkles">${twinkles}</g>

      <ellipse class="learner-shadow" cx="240" cy="378" rx="118" ry="12" />

      <g class="learner-books">
        <rect x="145" y="358" width="190" height="18" rx="4" transform="rotate(-1.5 240 367)" />
        <rect x="158" y="340" width="164" height="18" rx="4" transform="rotate(1.5 240 349)" />
        <rect x="150" y="322" width="180" height="18" rx="4" transform="rotate(-1 240 331)" />
      </g>

      <g class="learner-legs">
        <ellipse cx="203" cy="304" rx="36" ry="17" transform="rotate(-14 203 304)" />
        <ellipse cx="277" cy="304" rx="36" ry="17" transform="rotate(16 277 304)" />
      </g>

      <path class="learner-robe" d="M202,300 C197,264 199,229 214,209 L266,209 C281,229 283,264 278,300 Z" />

      <g class="learner-arms">
        <path d="M212,222 C192,244 182,270 194,293" />
        <path d="M268,222 C288,244 298,270 286,293" />
        <circle class="learner-hand" cx="194" cy="295" r="7" />
        <circle class="learner-hand" cx="286" cy="295" r="7" />
      </g>

      <circle class="learner-head" cx="240" cy="174" r="35" />

      <g class="learner-book">
        <path class="learner-book__page-left" d="M240,282 L179,290 L181,313 L240,306 Z" />
        <path class="learner-book__page-right" d="M240,282 L301,290 L299,313 L240,306 Z" />
        <g class="learner-book__lines">
          <path d="M197,291 L226,288" /><path d="M195,297 L227,294" /><path d="M194,303 L228,300" />
          <path d="M254,288 L283,291" /><path d="M253,294 L285,297" /><path d="M252,300 L286,303" />
        </g>
      </g>

      <g class="learner-cap">
        <path class="learner-cap__tassel" d="M240,120 C258,128 268,147 262,169" />
        <circle class="learner-cap__tuft" cx="262" cy="171" r="5" />
        <rect class="learner-cap__band" x="221" y="132" width="38" height="17" rx="8" />
        <path class="learner-cap__board" d="M240,94 L302,124 L240,142 L178,124 Z" />
        <circle class="learner-cap__button" cx="240" cy="119" r="4" />
      </g>
    </svg>`;
}

// Captured once, before any school branding has had a chance to overwrite
// it, so we always have the real generic title to fall back to (e.g. when
// switching back to the unbranded login screen).
const DEFAULT_TITLE = document.title;

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

  const logoSrc = school?.logoUrl || "/assets/logo.png";
  const brandName = school?.schoolName || "Eeskia";
  const brandTag = school ? (school.motto || "Powered by Eeskia") : "School Management System";

  document.title = school?.schoolName ? `${school.schoolName} ` : DEFAULT_TITLE;
  setFavicon(logoSrc);

  const wrap = el("div", { class: "auth-screen" });

  // Left: brand panel. No screenshot/photo - just an animated abstract
  // backdrop (drifting grid + soft gradient orbs) behind a rotating,
  // one-line-at-a-time feature carousel. Keeps the panel calm at a glance
  // while still feeling alive/tech rather than a static wall of text.
  const rotatorIcon = el("span", { class: "auth-rotator__icon", id: "auth-rotator-icon" }, [icon(BRAND_POINTS[0].icon)]);
  const rotatorText = el("span", { class: "auth-rotator__text", id: "auth-rotator-text" }, BRAND_POINTS[0].text);
  const rotatorTrack = el("div", { class: "auth-rotator__track", id: "auth-rotator-track" }, [rotatorIcon, rotatorText]);
  const rotatorDots = el("div", { class: "auth-rotator__dots", id: "auth-rotator-dots" }, BRAND_POINTS.map((_, i) =>
    el("button", { type: "button", class: `auth-rotator__dot${i === 0 ? " is-active" : ""}`, "data-index": String(i), "aria-label": `Show feature ${i + 1}` })
  ));

  const illustration = el("div", { class: "auth-brand__illustration", "aria-hidden": "true" });
  illustration.innerHTML = buildLearnerSvg();

  const brand = el("div", { class: "auth-brand" }, [
    el("div", { class: "auth-brand__bg" }, [
      el("div", { class: "auth-brand__grid" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--1" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--2" }),
    ]),
    el("div", { class: "auth-brand__top" }, [
      el("div", { class: "seal" }, [el("img", { class: "seal__img", src: logoSrc, alt: `${brandName} logo` })]),
      el("div", {}, [
        el("div", { class: "auth-brand__top-name" }, brandName),
        el("div", { class: "auth-brand__top-tag" }, brandTag),
      ]),
    ]),
    illustration,
    el("div", { class: "auth-brand__content" }, [
      el("div", { class: "auth-rotator", id: "auth-rotator" }, [rotatorTrack]),
      rotatorDots,
    ]),
  ]);

  // Right: form panel
  const offlineBanner = el("div", {
    id: "login-offline-banner",
    class: "badge badge--warning",
    style: `${typeof navigator !== "undefined" && navigator.onLine ? "display:none;" : "display:inline-flex;"}align-items:center;gap:6px;padding:8px 12px;margin-bottom:16px;width:100%;justify-content:center;border-radius:var(--radius-md);box-sizing:border-box;`,
  }, [
    icon("wifi_off"),
    el("span", {}, "You are offline. An internet connection is required to sign in."),
  ]);

  const card = el("div", { class: "auth-card" });
  card.append(
    el("div", { class: "auth-card__header" }, [
      el("div", { class: "seal seal--lg" }, [el("img", { class: "seal__img", src: logoSrc, alt: `${brandName} logo` })]),
      el("h1", {}, "Hi, welcome back"),
      el("p", { class: "text-muted" }, school ? `Sign in to your ${school.schoolName} account` : "Please sign in with your account details"),
    ]),
    offlineBanner
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
        el("span", { class: "text-sm text-muted" }, "Already using Eeskia at your school? "),
        el("a", { href: "#", id: "enter-code-link" }, "Enter your school code"),
      ]);

  const codeInput = el("input", { id: "school-code-input", type: "text", placeholder: "e.g. greenhill-jss" });
  const codePrefixBadge = el("span", { class: "slug-input__prefix" }, `${SLUG_PREFIX}-`);
  const codeInputGroup = el("div", { class: "slug-input-group", style: "flex:1;" }, [codePrefixBadge, codeInput]);
  const codeForm = el("form", { id: "school-code-form", style: "display:none;margin-top:10px;" }, [
    el("div", { style: "display:flex;gap:8px;align-items:flex-start;" }, [
      el("div", { class: "field", style: "flex:1;margin-bottom:0;" }, [codeInputGroup]),
      el("button", { type: "submit", class: "btn btn--tonal btn--sm" }, "Go"),
    ]),
    el("div", { class: "field-error", id: "school-code-error" }, ""),
  ]);

  const formside = el("div", { class: "auth-formside" }, [
    card,
    switchRow,
    codeForm,
    el("div", { class: "auth-copyright" }, [
      `© ${new Date().getFullYear()} `,
      el("b", {}, "ISKIFY360 ERP Softwares"),
      ". All rights reserved.",
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

// Cycles the left-panel feature line through BRAND_POINTS on a timer, with
// a small fade/slide swap. Self-cleaning: each tick checks the rotator is
// still attached to the document (this app's views have no unmount hook)
// and stops the interval once the user has navigated away.
function initRotator() {
  const root = document.getElementById("auth-rotator");
  if (!root) return;
  const track = document.getElementById("auth-rotator-track");
  const iconEl = document.getElementById("auth-rotator-icon");
  const textEl = document.getElementById("auth-rotator-text");
  const dots = Array.from(document.querySelectorAll("#auth-rotator-dots .auth-rotator__dot"));
  const SWAP_MS = 220;
  const INTERVAL_MS = 3800;
  let index = 0;
  let timer = null;

  function show(i) {
    index = i;
    track.classList.add("is-swapping");
    setTimeout(() => {
      iconEl.innerHTML = "";
      iconEl.append(icon(BRAND_POINTS[i].icon));
      textEl.textContent = BRAND_POINTS[i].text;
      track.classList.remove("is-swapping");
    }, SWAP_MS);
    dots.forEach((d, di) => d.classList.toggle("is-active", di === i));
  }

  function restart() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (!document.body.contains(root)) {
        clearInterval(timer);
        return;
      }
      show((index + 1) % BRAND_POINTS.length);
    }, INTERVAL_MS);
  }

  dots.forEach((d) => {
    d.addEventListener("click", () => {
      show(Number(d.dataset.index));
      restart();
    });
  });

  restart();
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
      const result = await login(email, password);

      // Admin account protection gates: the login service returns extra flags
      // instead of a plain profile when additional verification is needed.
      if (result.needsApproval) {
        restore();
        renderApprovalWaitScreen(result);
        return;
      }
      if (result.needs2FA) {
        restore();
        render2FAScreen(result);
        return;
      }

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

  initRotator();

  // "Not your school?" - drop the remembered code and reload onto the
  // generic screen. A full reload (rather than re-rendering in place) is
  // deliberate: it's a rare action, and it guarantees every bit of applied
  // branding (CSS vars, page title, etc.) resets cleanly.
  document.getElementById("switch-school-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearStoredSlug();
    location.href = loginUrl(null);
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
    // The badge only shows the prefix - it isn't part of the input's own
    // value - so it has to be re-added here before slugifying, same as
    // School Settings' buildFullSlug() does when saving a code.
    const clean = slugify(`${SLUG_PREFIX}-${raw}`);
    if (clean === SLUG_PREFIX || !raw.trim()) {
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
      // Same reasoning as "switch school": a full navigation to the new,
      // now-branded URL - not a re-render in place - guarantees every bit
      // of applied branding (CSS vars, page title, etc.) resets cleanly.
      location.href = loginUrl(school.slug);
    } catch (err) {
      codeErrorEl.textContent = "Couldn't check that code right now - try again.";
      restore();
    }
  });

  const offlineBannerEl = document.getElementById("login-offline-banner");
  const updateOnlineState = () => {
    if (offlineBannerEl) {
      offlineBannerEl.style.display = navigator.onLine ? "none" : "inline-flex";
    }
  };
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
}

// ===========================================================================
// Awaiting-approval gate.
// Rendered when an admin/super_admin logs in from an unrecognized device.
// Shows device details and a live spinner while waiting for the primary
// device's holder to approve or deny the login attempt.
// ===========================================================================
function renderApprovalWaitScreen(result) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const di = result.deviceInfo || {};
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
  // "approved" or "denied" by the primary device's session.
  const unsubscribe = watchLoginApproval(result.uid, result.approvalId, async (approval) => {
    if (!approval) return;
    if (approval.status === "approved") {
      unsubscribe();
      // Register this device as trusted now that it's been approved
      try {
        const fingerprint = result.fingerprint || generateDeviceFingerprint();
        const deviceInfo = result.deviceInfo || getDeviceInfo();
        await registerTrustedDevice(result.uid, fingerprint, deviceInfo, false);
      } catch (e) {
        console.error("Failed to register approved device:", e);
      }
      if (await is2FAEnabled(result.uid)) {
        render2FAScreen(result);
        return;
      }
      toast("Login approved! Welcome in.", "success");
      navigate("/dashboard");
    } else if (approval.status === "denied") {
      unsubscribe();
      statusEl.innerHTML = "";
      statusEl.append(
        el("p", { class: "approval-wait__denied" }, "Login was denied from the primary device."),
      );
      // Sign out after a short delay so the message is visible
      setTimeout(async () => {
        const { logout } = await import("../js/services/auth.service.js");
        await logout();
        navigate("/login");
      }, 3000);
    }
  });

  cancelBtn.addEventListener("click", async () => {
    unsubscribe();
    const { logout } = await import("../js/services/auth.service.js");
    await logout();
    navigate("/login");
  });
}

// ===========================================================================
// Two-factor authentication gate.
// Rendered when an admin/super_admin with 2FA enabled logs in from a trusted
// device. They must enter the 6-digit code from their authenticator app.
// ===========================================================================
function render2FAScreen(result) {
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

  // Auto-focus the code input
  setTimeout(() => codeInput.focus(), 100);

  // Auto-submit when 6 digits are entered
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
      const valid = await validate2FALogin(result.uid, code);
      if (valid) {
        toast("Verified! Welcome in.", "success");
        navigate("/dashboard");
      } else {
        errorEl.textContent = "Invalid code. Please try again.";
        codeInput.value = "";
        codeInput.focus();
        restore();
      }
    } catch (err) {
      errorEl.textContent = "Verification failed. Please try again.";
      restore();
    }
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

  cancelBtn.addEventListener("click", async () => {
    const { logout } = await import("../js/services/auth.service.js");
    await logout();
    navigate("/login");
  });
}

function friendlyError(err) {
  const code = err?.code || "";
  const msg = err?.message || "";
  if (code.includes("user-not-found") || code.includes("invalid-credential") || code.includes("wrong-password")) {
    return "Incorrect email or password.";
  }
  if (code.includes("network-request-failed") || code.includes("unavailable") || /network|internet/i.test(msg) || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return "No internet connection. Please connect to the internet to sign in.";
  }
  if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  return err.message || "Something went wrong. Please try again.";
}