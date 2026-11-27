import { login, requestPasswordReset } from "../js/services/auth.service.js";
import { renderApprovalGate, renderTwoFactorGate, renderDeviceLimitGate, renderRegistrationErrorGate } from "../js/components/auth-gate.js";
import { auth } from "../js/firebase-config.js";
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { navigate, getDefaultRoute, routes } from "../js/router.js";
import { resolvePostLoginDestination } from "../js/services/deep-link.service.js";
import { el, icon, toast, busyButton, setFavicon } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";
import { getSchoolBySlug, slugify, SLUG_PREFIX } from "../js/services/settings.service.js";
import { applyBranding } from "../js/services/branding.service.js";

const BRAND_POINTS = [
  { icon: "school", label: "Admissions and classes", text: "Admissions, classes, streams and CBC subjects in one place" },
  { icon: "assessment", label: "Assessments and report cards", text: "Assessments, marks and auto-generated CBC report cards" },
  { icon: "payments", label: "Fees, attendance and timetables", text: "Fees, attendance and timetables tracked in real time" },
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
// in and out around the figure. The eyes (added below) layer small
// contextual and idle animations on top of this same calm baseline.
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

// One-time injection of the eye styles. Kept local to this module (rather
// than the shared stylesheet) since the eyes are purely a login-screen
// flourish - guarded so re-rendering the view (e.g. switching schools)
// never duplicates the <style> tag.
const EYE_STYLE_ID = "learner-eye-styles";
function ensureEyeStyles() {
  if (document.getElementById(EYE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = EYE_STYLE_ID;
  style.textContent = `
    .learner-eye__white { fill: var(--auth-illustration-cream, #fdf6e3); }
    .learner-eye__pupil {
      fill: var(--auth-illustration-gold-dark, #7a5c1e);
      transition: transform 0.15s ease-out;
    }
    .learner-eye__lid {
      fill: var(--auth-illustration-gold, #c9a24b);
      transform-origin: center top;
      transform-box: fill-box;
      transform: scaleY(0);
      transition: transform 0.12s ease-in;
    }
    #learner-eyes.is-blinking .learner-eye__lid { transform: scaleY(1); transition-duration: 0.09s; }
    #learner-eyes.is-sleepy .learner-eye__lid { transform: scaleY(1); transition-duration: 1.6s; }
    #learner-eyes.is-waking .learner-eye__lid { transform: scaleY(0); transition-duration: 0.15s; }
    #learner-eyes.is-happy .learner-eye__lid { transform: scaleY(0.55); transition-duration: 0.2s; }
    .learner-mouth {
      fill: none;
      stroke: var(--auth-illustration-gold-dark, #7a5c1e);
      stroke-width: 2.2;
      stroke-linecap: round;
      transition: d 0.25s ease;
    }
  `;
  document.head.appendChild(style);
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

      <g class="learner-eyes" id="learner-eyes">
        <g class="learner-eye" data-eye="left">
          <ellipse class="learner-eye__white" cx="228" cy="168" rx="6" ry="7" />
          <circle class="learner-eye__pupil" id="learner-pupil-l" cx="228" cy="169" r="2.6" />
          <rect class="learner-eye__lid" x="221" y="159" width="14" height="16" rx="7" />
        </g>
        <g class="learner-eye" data-eye="right">
          <ellipse class="learner-eye__white" cx="252" cy="168" rx="6" ry="7" />
          <circle class="learner-eye__pupil" id="learner-pupil-r" cx="252" cy="169" r="2.6" />
          <rect class="learner-eye__lid" x="245" y="159" width="14" height="16" rx="7" />
        </g>
      </g>

      <path class="learner-mouth" id="learner-mouth" d="M231,186 Q240,190 249,186" />

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
  const motto = String(school?.motto || "").trim();

  document.title = school?.schoolName ? `${school.schoolName} ` : DEFAULT_TITLE;
  setFavicon(logoSrc);

  const wrap = el("div", { class: "auth-screen login-screen" });

  ensureEyeStyles();
  const illustration = el("div", { class: "auth-brand__illustration", "aria-hidden": "true" });
  illustration.innerHTML = buildLearnerSvg();

  const firstPoint = BRAND_POINTS[0];
  const brand = el("div", { class: "auth-brand" }, [
    el("div", { class: "auth-brand__bg", "aria-hidden": "true" }, [
      el("div", { class: "auth-brand__grid" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--1" }),
      el("div", { class: "auth-brand__orb auth-brand__orb--2" }),
    ]),
    el("div", { class: "auth-brand__top" }, [
      el("span", { class: "seal" }, el("img", { class: "seal__img", src: logoSrc, alt: "" })),
      el("div", {}, [
        el("div", { class: "auth-brand__top-name" }, brandName),
        el("div", { class: "auth-brand__top-tag" }, school ? (motto || "Powered by Eeskia") : "School Management System"),
      ]),
    ]),
    illustration,
    el("div", { class: "auth-brand__content" }, [
      el("div", { class: "auth-rotator" }, el("div", { class: "auth-rotator__track", id: "login-feature" }, [
        el("span", { class: "auth-rotator__icon", "aria-hidden": "true" }, icon(firstPoint.icon)),
        el("span", { class: "auth-rotator__text" }, firstPoint.text),
      ])),
      el("div", { class: "auth-rotator__dots", role: "group", "aria-label": "Platform highlights" }, [
        ...BRAND_POINTS.map(({ label }, index) => el("button", {
          type: "button", class: "auth-rotator__dot", "aria-controls": "login-feature",
          "aria-label": label, "aria-pressed": String(index === 0), title: label,
        })),
        el("button", {
          type: "button", class: "auth-rotator__playback", "aria-controls": "login-feature",
          "aria-label": "Pause highlights", title: "Pause highlights",
        }, icon("pause", { "aria-hidden": "true" })),
      ]),
    ]),
  ]);

  const schoolAction = el("button", {
    id: "login-school-picker",
    type: "button",
    class: "login-text-action",
    "aria-controls": "school-code-form",
    "aria-expanded": "false",
  }, school ? "Switch school" : "Enter school code");
  const codeInput = el("input", {
    id: "school-code-input", name: "school-code", type: "text", placeholder: "e.g. greenhill-jss",
    autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-describedby": "school-code-error",
  });
  const codeForm = el("form", { id: "school-code-form", class: "login-school-picker", hidden: "" }, [
    el("div", { class: "field" }, [
      el("label", { for: codeInput.id }, "School code"),
      el("div", { class: "slug-input-group" }, [el("span", { class: "slug-input__prefix", "aria-hidden": "true" }, `${SLUG_PREFIX}-`), codeInput]),
      el("div", { class: "field-error", id: "school-code-error", role: "alert" }),
    ]),
    el("div", { class: "login-school-picker__actions" }, [
      el("button", { type: "button", id: "school-code-cancel", class: "btn btn--ghost btn--sm" }, "Cancel"),
      el("button", { type: "submit", class: "btn btn--primary btn--sm" }, "Use this school"),
    ]),
    school ? el("a", { href: loginUrl(null), id: "clear-login-school", class: "login-text-action" }, "Continue without a school code") : null,
  ]);

  const offlineBanner = el("div", {
    id: "login-offline-banner",
    class: "login-offline",
    role: "status",
    hidden: navigator.onLine ? "" : null,
  }, [
    icon("wifi_off", { "aria-hidden": "true" }),
    el("span", {}, "You are offline. An internet connection is required to sign in."),
  ]);

  const form = el("form", { id: "login-form", "aria-labelledby": "login-title" });
  const emailField = el("div", { class: "field" }, [
    el("label", { for: "email" }, "Email address"),
    el("input", { id: "email", name: "email", type: "email", placeholder: "you@school.ac.ke", required: "", autocomplete: "username", autocapitalize: "none", "aria-describedby": "login-error" }),
  ]);

  const passwordInput = el("input", { id: "password", name: "password", type: "password", placeholder: "Enter your password", required: "", autocomplete: "current-password", "aria-describedby": "login-error" });
  const passwordToggle = el("button", { type: "button", class: "field__toggle", "aria-label": "Show password", "aria-controls": passwordInput.id }, [icon("visibility", { "aria-hidden": "true" })]);
  const passwordField = el("div", { class: "field" }, [
    el("label", { for: "password" }, "Password"),
    el("div", { class: "field--password" }, [passwordInput, passwordToggle]),
    el("div", { class: "field-error", id: "login-error", role: "alert" }),
  ]);

  const rememberCheckbox = el("input", { type: "checkbox", id: "remember-me" });
  form.append(
    emailField, passwordField,
    el("div", { class: "auth-row" }, [
      el("label", { for: "remember-me" }, [rememberCheckbox, "Remember me"]),
      el("button", { type: "button", id: "forgot-link", class: "login-text-action" }, "Forgot password?"),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block login-submit" }, "Sign In"),
  );

  const formside = el("main", { class: "auth-formside login-formside" }, [
    el("div", { class: "auth-card" }, [
      el("header", { class: "auth-card__header" }, [
        el("div", { class: "seal seal--lg" }, el("img", { class: "seal__img", src: logoSrc, alt: "" })),
        el("h1", { id: "login-title" }, "Hi, welcome back"),
        el("p", { class: "text-muted" }, school?.schoolName ? `Sign in to your ${brandName} account` : "Sign in to your Eeskia account"),
      ]),
      offlineBanner, form,
      el("div", { class: "login-help" }, [
        el("span", {}, "Account locked or compromised?"),
        el("button", { type: "button", id: "emergency-support-link", class: "login-text-action" }, [
          icon("security", { "aria-hidden": "true" }), "Emergency help",
        ]),
      ]),
      el("div", { class: "login-switch-school" }, [
        school ? el("span", {}, "Not your school?") : null,
        schoolAction,
      ]),
      codeForm,
      el("footer", { class: "auth-copyright" }, [
        `© ${new Date().getFullYear()} `,
        el("b", {}, "ISKIFY360 ERP Softwares"),
        ". All rights reserved.",
      ]),
    ]),
  ]);

  passwordToggle.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    passwordToggle.innerHTML = "";
    passwordToggle.append(icon(showing ? "visibility" : "visibility_off", { "aria-hidden": "true" }));
    passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  // Re-theme sidebar/button colors to the resolved school's brand, same
  // helper the authenticated shell uses. A no-op (falls back to defaults)
  // when no school was resolved.
  applyBranding(school);

  wrap.append(formside, brand);
  return wrap;
}

function initRotator() {
  const root = document.querySelector(".login-screen .auth-brand__content");
  const track = root.querySelector(".auth-rotator__track");
  const featureIcon = track.querySelector(".auth-rotator__icon");
  const featureText = track.querySelector(".auth-rotator__text");
  const dots = Array.from(root.querySelectorAll(".auth-rotator__dot"));
  const playback = root.querySelector(".auth-rotator__playback");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let paused = false;

  function show(nextIndex) {
    if (nextIndex === index) return;
    index = nextIndex;
    const point = BRAND_POINTS[index];
    featureIcon.replaceChildren(icon(point.icon));
    featureText.textContent = point.text;
    dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === index)));
    if (!reducedMotion.matches) track.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180 });
  }

  dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));
  playback.addEventListener("click", () => {
    paused = !paused;
    const label = paused ? "Play highlights" : "Pause highlights";
    playback.setAttribute("aria-label", label);
    playback.title = label;
    playback.replaceChildren(icon(paused ? "play_arrow" : "pause", { "aria-hidden": "true" }));
  });

  const timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      return;
    }
    if (paused || reducedMotion.matches || document.hidden || !root.offsetWidth || root.matches(":hover, :focus-within")) return;
    show((index + 1) % BRAND_POINTS.length);
  }, 6500);
}

// Small eye-animation state machine for the learner illustration:
//  - idle default: gentle cursor-follow (eyes drift toward the pointer)
//  - periodic blink
//  - sleepy: eyes slowly close after IDLE_MS of no mouse/keyboard activity,
//    and snap back open ("wake") on the next input
//  - contextual glance: password focus/typing nudges the pupils toward the
//    form for a held duration, overriding cursor-follow while active
//  - happy: brief lid-lowered "content" look, triggered on login success
// Returns null if the eyes markup isn't present (e.g. illustration swapped
// out), so callers can safely optional-chain every method.
function initEyes() {
  const eyesRoot = document.getElementById("learner-eyes");
  if (!eyesRoot || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return null;
  const pupilL = document.getElementById("learner-pupil-l");
  const pupilR = document.getElementById("learner-pupil-r");
  const svgEl = document.querySelector(".learner-svg");

  let lastActivity = Date.now();
  let sleepy = false;
  let overrideUntil = 0; // while Date.now() < this, a contextual glance owns the pupils
  let blinkTimer = null;
  let idleInterval = null;

  function isAttached() {
    return document.body.contains(eyesRoot);
  }

  // --- blinking ---
  function scheduleBlink() {
    const next = 2500 + Math.random() * 3500; // every 2.5-6s
    blinkTimer = setTimeout(() => {
      if (!isAttached()) {
        return; // view was swapped out - stop the chain rather than reschedule forever
      }
      if (!sleepy) {
        eyesRoot.classList.add("is-blinking");
        setTimeout(() => eyesRoot.classList.remove("is-blinking"), 120);
      }
      scheduleBlink();
    }, next);
  }
  scheduleBlink();

  // --- mouth ---
  const MOUTHS = {
    neutral: "M231,186 Q240,190 249,186", // gentle content curve, resting/reading
    focus:   "M233,187 Q240,189 247,187", // slightly tighter - concentrating on typing
    smile:   "M228,184 Q240,196 252,184", // happy - wider, deeper curve
    sleepy:  "M232,187 L248,187",         // flat line while dozing
  };
  const mouthEl = document.getElementById("learner-mouth");
  function setMouth(state) {
    if (mouthEl) mouthEl.setAttribute("d", MOUTHS[state] || MOUTHS.neutral);
  }

  // --- pupil positioning ---
  function setPupil(dx, dy) {
    const max = 2.4; // px of travel - past this it starts looking cross-eyed
    const cx = Math.max(-max, Math.min(max, dx));
    const cy = Math.max(-max, Math.min(max, dy));
    pupilL.style.transform = `translate(${cx}px, ${cy}px)`;
    pupilR.style.transform = `translate(${cx}px, ${cy}px)`;
  }

  // --- cursor follow (default, lowest priority) ---
  function onMouseMove(e) {
    lastActivity = Date.now();
    if (sleepy) wake();
    if (Date.now() < overrideUntil || !svgEl) return; // a contextual glance is active - don't fight it
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const headCx = rect.left + rect.width * (240 / 480);
    const headCy = rect.top + rect.height * (174 / 420);
    setPupil((e.clientX - headCx) / 40, (e.clientY - headCy) / 60);
  }
  function onKeyActivity() {
    lastActivity = Date.now();
    if (sleepy) wake();
  }
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("keydown", onKeyActivity);

  // --- sleepy idle ---
  const IDLE_MS = 9000;
  idleInterval = setInterval(() => {
    if (!isAttached()) {
      clearInterval(idleInterval);
      clearTimeout(blinkTimer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyActivity);
      return;
    }
    if (!sleepy && Date.now() - lastActivity > IDLE_MS) {
      sleepy = true;
      eyesRoot.classList.add("is-sleepy");
      setPupil(0, 1); // rest gently downward as the lids close
      setMouth("sleepy");
    }
  }, 1000);

  function wake() {
    sleepy = false;
    eyesRoot.classList.remove("is-sleepy");
    eyesRoot.classList.add("is-waking");
    setMouth("neutral");
    setTimeout(() => eyesRoot.classList.remove("is-waking"), 200);
  }

  // --- contextual glances, called from init()'s form listeners ---
  function glanceAt(dx, dy, holdMs) {
    overrideUntil = Date.now() + holdMs;
    if (sleepy) wake();
    setPupil(dx, dy);
    setMouth(holdMs > 0 ? "focus" : "neutral");
  }

  function happy() {
    eyesRoot.classList.add("is-happy");
    setMouth("smile");
  }

  return { glanceAt, happy };
}

export function init() {
  const eyes = initEyes();
  initRotator();

  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const forgotLink = document.getElementById("forgot-link");
  const rememberCheckbox = document.getElementById("remember-me");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  // Contextual eye states around the password field: focus holds a glance
  // toward the form for as long as the field is focused (refreshed on
  // every keystroke so it doesn't lapse back to cursor-follow mid-typing),
  // and blur releases it back to center/cursor-follow.
  passwordInput.addEventListener("focus", () => eyes?.glanceAt(1.6, -0.6, 60000));
  passwordInput.addEventListener("input", () => eyes?.glanceAt(1.2, -0.4, 500));
  passwordInput.addEventListener("blur", () => eyes?.glanceAt(0, 0, 0));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const btn = form.querySelector("button[type=submit]");
    if (btn.disabled) return;
    const restore = busyButton(btn, "Signing in…");
    try {
      await setPersistence(auth, rememberCheckbox.checked ? browserLocalPersistence : browserSessionPersistence);
      const result = await login(email, password);

      const safeNavigatePostLogin = (prof) => {
        // Always navigate after a gate clears (approval / 2FA). The old guard
        // only called navigate() when the hash started with "#/login", which
        // silently dropped the redirect when a user landed directly on a
        // bookmarked protected page (e.g. "#/dashboard"), got the 2FA gate,
        // verified, and then onDone() was a no-op - leaving the gate UI
        // frozen with an endless spinner.  Now we always resolve the
        // destination and navigate unconditionally; router.navigate() is
        // safe to call even when the hash hasn't changed - it calls
        // renderRoute() directly in that case.
        const dest = resolvePostLoginDestination(prof, routes, getDefaultRoute);
        navigate(dest);
      };

      // Admin account protection gates: the login service returns extra flags
      // instead of a plain profile when additional verification is needed.
      // Rendered via the same shared gate screens router.js uses on every
      // subsequent navigation, so there's exactly one implementation of
      // each screen (see js/components/auth-gate.js).
      if (result.needsApproval) {
        restore();
        renderApprovalGate(result, () => safeNavigatePostLogin(result));
        return;
      }
      if (result.needs2FA) {
        restore();
        renderTwoFactorGate(result, () => safeNavigatePostLogin(result));
        return;
      }
      if (result.needsDeviceLimit) {
        restore();
        renderDeviceLimitGate(result);
        return;
      }
      if (result.needsRegistrationError) {
        restore();
        renderRegistrationErrorGate();
        return;
      }

      eyes?.happy();
      safeNavigatePostLogin(result);
    } catch (err) {
      errorEl.textContent = friendlyError(err);
      restore();
    }
  });

  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!emailInput.checkValidity()) {
      errorEl.textContent = "Enter a valid email address to request a password reset.";
      emailInput.focus();
      return;
    }
    errorEl.textContent = "";
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

  document.getElementById("emergency-support-link").addEventListener("click", () => {
    openEmergencySupportModal(emailInput.value.trim());
  });

  const schoolPicker = document.getElementById("login-school-picker");
  const codeForm = document.getElementById("school-code-form");
  const codeInput = document.getElementById("school-code-input");
  const codeErrorEl = document.getElementById("school-code-error");
  const codeSubmit = codeForm.querySelector("button[type=submit]");
  function showCodeForm(show) {
    codeForm.hidden = !show;
    schoolPicker.setAttribute("aria-expanded", String(show));
    (show ? codeInput : schoolPicker).focus();
  }
  schoolPicker.addEventListener("click", () => showCodeForm(codeForm.hidden));
  document.getElementById("school-code-cancel").addEventListener("click", () => showCodeForm(false));
  codeForm.addEventListener("keydown", (event) => {
    if (event.key === "Escape") showCodeForm(false);
  });
  document.getElementById("clear-login-school")?.addEventListener("click", clearStoredSlug);

  codeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (codeSubmit.disabled) return;
    codeErrorEl.textContent = "";
    const code = slugify(codeInput.value.trim());
    if (!code || code === SLUG_PREFIX) {
      codeErrorEl.textContent = "Enter your school's code first.";
      codeInput.focus();
      return;
    }
    const prefix = `${SLUG_PREFIX}-`;
    const clean = code.startsWith(prefix) ? code : slugify(`${prefix}${code}`);
    const restore = busyButton(codeSubmit, "Checking…");
    try {
      const school = await getSchoolBySlug(clean);
      if (!school) {
        codeErrorEl.textContent = "That code wasn't recognized - check with your school administrator.";
        return;
      }
      storeSlug(school.slug);
      // Reload to apply the new school name, favicon, and palette together.
      location.href = loginUrl(school.slug);
    } catch (err) {
      codeErrorEl.textContent = "Couldn't check that code right now - try again.";
    } finally {
      restore();
    }
  });

  const offlineBannerEl = document.getElementById("login-offline-banner");
  const updateOnlineState = () => {
    if (offlineBannerEl.isConnected) {
      offlineBannerEl.hidden = navigator.onLine;
    } else {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    }
  };
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
}

function openEmergencySupportModal(prefilledEmail = "") {
  const form = el("form", { style: "display:flex; flex-direction:column; gap:14px;" }, [
    el("div", { style: "background:rgba(220, 38, 38, 0.06); border:1px solid rgba(220, 38, 38, 0.2); border-radius:8px; padding:12px; font-size:13px; color:#991b1b; line-height:1.5;" }, [
      "Use this form if you suspect your account has been breached, credentials altered without consent, or if you are locked out by unrecognized 2FA. Our security team will review and contact you via verified school channels.",
      el("div", { style: "margin-top:8px; font-weight:600;" }, [
        "Emergency Security Hotline: ",
        el("a", { href: "tel:+2540107195545", style: "color:inherit; white-space:nowrap;" }, "+254 0107195545"),
      ]),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "em-school" }, "School Name or Code"),
      el("input", { id: "em-school", type: "text", required: "true", placeholder: "e.g. Green Hill JSS or greenhill-jss" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "em-name" }, "Your Full Name & Role"),
      el("input", { id: "em-name", type: "text", required: "true", placeholder: "e.g. Mr. Brian Odhiambo (Principal / School Admin)" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "em-email" }, "Affected Account Email"),
      el("input", { id: "em-email", type: "email", required: "true", value: prefilledEmail, placeholder: "admin@school.ac.ke" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "em-phone" }, "Verified Alternate Phone / WhatsApp Number"),
      el("input", { id: "em-phone", type: "tel", required: "true", placeholder: "e.g. +254 712 345 678" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "em-details" }, "Incident Description"),
      el("textarea", { id: "em-details", rows: "3", required: "true", placeholder: "Please explain what happened (e.g. password changed without my consent, unknown device locked me out...)" }),
    ]),
    el("div", { id: "em-error", class: "field-error", style: "margin-top:-6px;" }, ""),
    el("button", { type: "submit", class: "btn btn--danger btn--block" }, [
      icon("emergency", "text-sm"),
      " Submit Emergency Report",
    ]),
  ]);

  const close = openModal("Account Compromise & Locked-Out Support", form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("em-error");
    if (errorEl) errorEl.textContent = "";

    const schoolCodeOrName = document.getElementById("em-school").value.trim();
    const reporterName = document.getElementById("em-name").value.trim();
    const email = document.getElementById("em-email").value.trim();
    const contactPhone = document.getElementById("em-phone").value.trim();
    const details = document.getElementById("em-details").value.trim();

    const submitBtn = form.querySelector("button[type=submit]");
    const restore = busyButton(submitBtn, "Submitting alert…");

    try {
      const res = await fetch("/emergency-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolCodeOrName, reporterName, email, contactPhone, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit incident report.");

      close();
      toast("Emergency incident reported! Our security response desk has been alerted.", "success");

      let modalClose = null;
      const successModalBody = el("div", { style: "text-align:center; padding:16px 0;" }, [
        el("div", { style: "width:60px; height:60px; border-radius:50%; background:#ecfdf5; color:#059669; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;" }, [
          icon("check_circle", "style: font-size:32px;"),
        ]),
        el("h3", { style: "margin:0 0 8px; font-size:18px; color:#0f172a;" }, "Emergency Incident Reported"),
        el("p", { class: "text-sm text-muted", style: "line-height:1.6; margin-bottom:16px;" }, [
          "Emergency incident ticket ",
          el("strong", { style: "color:#0f172a;" }, `#${(data.ticketId || "").slice(0, 8)}`),
          " has been submitted with the security response desk."
        ]),
        el("div", { style: "background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:12px; color:#475569; text-align:left; line-height:1.5; margin-bottom:16px;" }, [
          el("strong", {}, "Next steps: "),
          "Our security engineers will cross-verify your identity using official school registration records and phone lines before recovering your account."
        ]),
        el("button", { type: "button", class: "btn btn--primary", onClick: () => modalClose && modalClose() }, "Understood")
      ]);
      modalClose = openModal("Emergency Incident Reported", successModalBody);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || "Failed to submit report.";
      restore();
    }
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
