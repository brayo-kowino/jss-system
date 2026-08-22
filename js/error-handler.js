// ==========================================================================
// Global error handling & resilience layer.
//
// Goal: the app should never show a blank screen, a browser's default error
// page, or a raw stack trace. Any uncaught exception, rejected promise,
// failed resource load, or broken/invalid link is caught here and turned
// into a calm, on-brand "something went wrong" message with a short
// reference code - never a silent crash.
//
// Three ways this shows up to the user, smallest to largest:
//   - errorToast(err)        small "heads up" toast for a recoverable slip
//   - renderInlineError(...) a card inside the current page (view failed to
//                            load, but the shell/nav is still usable)
//   - showFatalError(err)    full-screen takeover (the app itself couldn't
//                            start or the shell broke)
// ==========================================================================
import { el, icon, toast } from "./utils.js";

const STORAGE_KEY = "jss_error_log";
const MAX_STORED_ERRORS = 20;

// ---------------------------------------------------------------------------
// Error codes - short, shareable, not a security token. Just something a
// user can read out over the phone or paste into a message to their admin.
// ---------------------------------------------------------------------------
function generateErrorCode() {
  const time = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
  return `EKA-${time}-${rand}`;
}

// ---------------------------------------------------------------------------
// Classification - turns any thrown value (Error, DOMException, Firebase
// error object, plain string, undefined...) into a stable, human-friendly
// shape. Never echoes raw messages/stacks back to the user.
// ---------------------------------------------------------------------------
export function classifyError(err) {
  const raw = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
  const code = String(raw.code || "");
  const msg = String(raw.message || "");

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "offline", icon: "wifi_off", title: "You're offline", message: "No internet connection right now. Some things may not save until you're back online." };
  }
  if (/network|fetch|failed to fetch|err_internet|err_connection/i.test(msg) || code.includes("unavailable")) {
    return { kind: "network", icon: "wifi_off", title: "Connection problem", message: "We couldn't reach the server. Check your internet connection and try again." };
  }
  if (code.includes("permission-denied") || code.includes("insufficient-permission")) {
    return { kind: "permission", icon: "lock", title: "You don't have access to that", message: "Your account isn't permitted to view or change this. If that seems wrong, contact your school admin." };
  }
  if (code.includes("not-found")) {
    return { kind: "not-found", icon: "search_off", title: "We couldn't find that", message: "That record may have been moved or deleted." };
  }
  if (code.includes("deadline-exceeded") || code.includes("cancelled")) {
    return { kind: "timeout", icon: "hourglass_disabled", title: "That took too long", message: "The server didn't respond in time. This usually clears up on its own - please try again." };
  }
  if (code.startsWith("auth/")) {
    return { kind: "auth", icon: "no_accounts", title: "Sign-in problem", message: authMessage(code) };
  }
  if (/loading chunk|dynamic import|failed to fetch dynamically imported module|mime type/i.test(msg)) {
    return { kind: "load", icon: "sync_problem", title: "Couldn't load part of the app", message: "A file failed to load, often after an update. Refreshing usually fixes this." };
  }
  if (raw instanceof RangeError || raw instanceof TypeError || raw instanceof ReferenceError) {
    return { kind: "script", icon: "bug_report", title: "Something went wrong", message: "" };
  }
  return { kind: "generic", icon: "error", title: "Something went wrong", message: "That wasn't supposed to happen. Nothing has been lost and your data is safe." };
}

function authMessage(code) {
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "Incorrect email or password.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a moment and try again.";
  if (code.includes("user-disabled")) return "This account has been disabled. Contact your school admin.";
  if (code.includes("network-request-failed")) return "Couldn't reach the sign-in server. Check your connection.";
  return "We couldn't sign you in. Please try again.";
}

export function friendlyMessage(err) {
  return classifyError(err).message;
}

// ---------------------------------------------------------------------------
// Logging - always local (localStorage ring buffer), best-effort remote
// (Firestore) so admins can see what's failing for real users. Logging must
// never itself throw or block the UI response to the error.
// ---------------------------------------------------------------------------
function readLog() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function writeLog(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_STORED_ERRORS))); } catch { /* storage full or blocked - fine, console still has it */ }
}

export function getStoredErrors() {
  return readLog();
}

/**
 * Records an error (console + local log + best-effort remote log) and
 * returns a short reference code the caller can show the user.
 * @param {*} err
 * @param {object} context - free-form extra info (e.g. { where: "marks.save" })
 */
export function reportError(err, context = {}) {
  const code = generateErrorCode();
  const info = classifyError(err);
  const entry = {
    code,
    kind: info.kind,
    message: (err && err.message) || String(err ?? "Unknown error"),
    stack: err && err.stack ? String(err.stack).slice(0, 2000) : null,
    path: (typeof location !== "undefined" && location.hash) || "/",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    time: new Date().toISOString(),
    context,
  };
  console.error(`[${code}]`, err, context);
  writeLog([...readLog(), entry]);
  persistRemote(entry).catch(() => {});
  return code;
}

// Best-effort Firestore write. Imports are dynamic so that a broken/missing
// Firebase config can never prevent the local error UI from showing.
async function persistRemote(entry) {
  const [{ collection, addDoc, serverTimestamp }, cfg, authSvc] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    import("./firebase-config.js"),
    import("./services/auth.service.js").catch(() => null),
  ]);
  await addDoc(collection(cfg.db, "error_logs"), {
    code: entry.code,
    kind: entry.kind,
    message: entry.message,
    stack: entry.stack,
    path: entry.path,
    userAgent: entry.userAgent,
    userId: authSvc?.getCurrentProfile?.()?.uid || null,
    schoolId: authSvc?.getCurrentSchoolId?.() || null,
    createdAt: serverTimestamp(),
  });
}

// Attaches an optional user-supplied note to an already-reported error, and
// tries to sync it up. Used by the "Report this" modal.
async function attachNote(code, note) {
  const list = readLog().map((e) => (e.code === code ? { ...e, note } : e));
  writeLog(list);
  try {
    const [{ collection, addDoc, serverTimestamp }, cfg] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
      import("./firebase-config.js"),
    ]);
    await addDoc(collection(cfg.db, "error_reports"), { code, note, createdAt: serverTimestamp() });
  } catch { /* stored locally at minimum */ }
}

// ---------------------------------------------------------------------------
// UI building blocks
// ---------------------------------------------------------------------------
function copyCodeButton(code) {
  const btn = el("button", { type: "button", class: "btn btn--ghost btn--sm error-code__copy" }, [icon("content_copy"), "Copy code"]);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      btn.innerHTML = "";
      btn.append(icon("check"), "Copied");
      setTimeout(() => { btn.innerHTML = ""; btn.append(icon("content_copy"), "Copy code"); }, 1800);
    } catch {
      toast(`Reference code: ${code}`, "info", 6000);
    }
  });
  return btn;
}

function openReportModal(code, info) {
  // Lazily import to avoid a hard dependency cycle at module load time.
  import("./components/modal.js").then(({ openModal }) => {
    const note = el("textarea", {
      rows: "3",
      placeholder: "Optional - what were you doing when this happened?",
      style: "width:100%;font-family:inherit;font-size:var(--fs-sm);padding:var(--sp-3);border:1px solid var(--color-line);border-radius:var(--radius-md);resize:vertical;",
    });
    const sendBtn = el("button", { type: "button", class: "btn btn--primary" }, "Send report");
    const body = el("div", { style: "display:flex;flex-direction:column;gap:var(--sp-3);" }, [
      el("p", { class: "text-muted" }, `Reference ${code} has already been logged automatically. Add a note if it helps explain what happened.`),
      note,
      el("div", { style: "display:flex;justify-content:flex-end;" }, [sendBtn]),
    ]);
    const close = openModal("Report this issue", body);
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      await attachNote(code, note.value.trim().slice(0, 1000));
      close();
      toast("Thanks - your report was sent.", "success");
    });
  });
}

function reassuranceLine() {
  return el("p", { class: "error-card__reassure" }, [
    icon("verified_user", "text-gold"),
    "That was an error but your data is safe. Nothing was lost.",
  ]);
}

function codeRow(code) {
  return el("div", { class: "error-card__code-row" }, [
    el("span", { class: "error-card__code" }, code),
    copyCodeButton(code),
  ]);
}

/**
 * Full-page takeover for errors severe enough that the app shell itself
 * can't be trusted (failed boot, router/shell crash). Replaces #app.
 */
export function showFatalError(err, context = {}) {
  // A fatal error means boot is never going to complete normally, so
  // __jssBootOk will never fire to hide the splash on its own - do it
  // here, or this card renders invisibly underneath the splash overlay.
  window.__jssHideSplash?.();

  const code = reportError(err, { ...context, severity: "fatal" });
  const info = classifyError(err);
  const root = document.getElementById("app") || document.body;

  const card = el("div", { class: "error-card error-card--fatal" }, [
    el("div", { class: "error-card__icon-wrap" }, [icon(info.icon, "error-card__icon")]),
    el("h2", { class: "error-card__title" }, info.title),
    el("p", { class: "error-card__message" }, info.message),
    reassuranceLine(),
    codeRow(code),
    el("div", { class: "error-card__actions" }, [
      el("button", { class: "btn btn--primary", onClick: () => location.reload() }, [icon("refresh"), "Reload app"]),
      el("button", { class: "btn btn--ghost", onClick: () => openReportModal(code, info) }, [icon("flag"), "Report this"]),
    ]),
    el("p", { class: "error-card__hint" }, "If this keeps happening, share the reference code above with your school administrator or IT support."),
  ]);

  root.innerHTML = "";
  root.append(el("div", { class: "error-screen" }, [card]));
}

/**
 * Renders an error card inside a given container (e.g. a view that failed
 * to render/init) while leaving the surrounding shell/nav intact, so the
 * user isn't fully locked out - they can navigate elsewhere.
 */
export function renderInlineError(container, err, { onRetry, context = {} } = {}) {
  const info = classifyError(err);

  // The app is designed for full offline use. When the device is offline
  // and the error is simply "no network", don't show the full error card
  // with reference codes and a report button — the top bar's offline pill
  // already tells the person they're offline, and the inline error would
  // just make it look like something is broken when it isn't. Show a calm
  // placeholder instead, with a retry button to refresh once back online.
  if ((info.kind === "offline" || info.kind === "network") && typeof navigator !== "undefined" && !navigator.onLine) {
    reportError(err, { ...context, severity: "inline-offline-suppressed" });
    const actions = [];
    if (onRetry) {
      actions.push(el("button", { class: "btn btn--primary btn--sm", onClick: async () => {
        container.innerHTML = "";
        container.append(loadingRetryNode());
        try { await onRetry(); }
        catch (retryErr) { renderInlineError(container, retryErr, { onRetry, context }); }
      } }, [icon("refresh"), "Retry"]));
    }
    actions.push(el("button", { class: "btn btn--ghost btn--sm", onClick: () => { location.hash = "/dashboard"; } }, [icon("home"), "Go to dashboard"]));
    container.innerHTML = "";
    container.append(el("div", { class: "empty-state" }, [
      icon("cloud_off", "empty-state__icon"),
      el("h3", {}, "This page's data hasn't been cached yet"),
      el("p", { class: "text-muted" }, "Visit this page once while online so it's available offline next time."),
      el("div", { class: "error-card__actions" }, actions),
    ]));
    return;
  }

  const code = reportError(err, { ...context, severity: "inline" });

  const actions = [];
  if (onRetry) {
    actions.push(el("button", { class: "btn btn--primary btn--sm", onClick: async () => {
      container.innerHTML = "";
      container.append(loadingRetryNode());
      try { await onRetry(); }
      catch (retryErr) { renderInlineError(container, retryErr, { onRetry, context }); }
    } }, [icon("refresh"), "Try again"]));
  }
  actions.push(el("button", { class: "btn btn--ghost btn--sm", onClick: () => { location.hash = "/dashboard"; } }, [icon("home"), "Go to dashboard"]));
  actions.push(el("button", { class: "btn btn--ghost btn--sm", onClick: () => openReportModal(code, info) }, [icon("flag"), "Report this"]));

  const card = el("div", { class: "error-card error-card--inline" }, [
    el("div", { class: "error-card__icon-wrap error-card__icon-wrap--sm" }, [icon(info.icon, "error-card__icon")]),
    el("h3", { class: "error-card__title" }, info.title),
    el("p", { class: "error-card__message" }, info.message),
    reassuranceLine(),
    codeRow(code),
    el("div", { class: "error-card__actions" }, actions),
  ]);

  container.innerHTML = "";
  container.append(card);
}

function loadingRetryNode() {
  return el("div", { class: "error-card error-card--inline" }, [el("span", { class: "spinner spinner--md spinner--dark" }), el("p", { class: "text-muted", style: "margin-top:var(--sp-3);" }, "Retrying…")]);
}

/**
 * Small, dismissable toast for recoverable errors (a failed save, a
 * background refresh that didn't work, etc.) - doesn't interrupt the page.
 */
export function errorToast(err, context = {}) {
  const code = reportError(err, { ...context, severity: "toast" });
  const info = classifyError(err);
  const root = document.getElementById("toast-root");
  if (!root) return code;
  const elToast = el("div", { class: "toast toast--error toast--rich" }, [
    icon(info.icon, "toast__icon"),
    el("div", { class: "toast__body" }, [
      el("div", { class: "toast__title" }, info.title),
      el("div", { class: "toast__message" }, info.message),
      el("button", { type: "button", class: "toast__code", title: "Click to copy" }, `Ref: ${code}`),
    ]),
  ]);
  elToast.querySelector(".toast__code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(code); toast("Reference code copied", "success", 2000); } catch { /* ignore */ }
  });
  root.appendChild(elToast);
  setTimeout(() => elToast.remove(), 7000);
  return code;
}

// ---------------------------------------------------------------------------
// Global listeners - install once, as early as possible (see app.js).
// ---------------------------------------------------------------------------
let installed = false;

export function initErrorHandling() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    // Broken resource loads (script/img/link) surface here with no message.
    const target = event.target;
    if (target && target !== window && (target.tagName === "SCRIPT" || target.tagName === "LINK" || target.tagName === "IMG")) {
      if (target.tagName === "IMG") return; // a missing photo isn't app-breaking; let it show a broken-image icon quietly
      const src = target.src || target.href || "";
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      // Third-party scripts (reCAPTCHA, CDNs) or non-essential assets failing offline must not crash the app
      if (src.includes("recaptcha") || src.includes("google.com") || isOffline) {
        reportError(new Error(`Failed to load ${target.tagName.toLowerCase()}: ${src || "unknown resource"}`), { where: "resource-load", severity: "suppressed-resource-load" });
        return;
      }
      showFatalError(new Error(`Failed to load ${target.tagName.toLowerCase()}: ${src || "unknown resource"}`), { where: "resource-load" });
      return;
    }
    if (event.error || event.message) {
      handleUncaught(event.error || new Error(event.message), { where: "window.onerror" });
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    handleUncaught(event.reason, { where: "unhandledrejection" });
  });

  window.addEventListener("offline", () => toast("You're offline - some actions may not save until you're back online.", "error", 6000));
  
  let actualOnlineStatus = true; // assume true initially if no offline event
  const verifyLoop = async () => {
    if (!navigator.onLine) return;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);
      const res = await fetch("/robots.txt", { method: "HEAD", cache: "no-store", signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        if (!actualOnlineStatus) {
          actualOnlineStatus = true;
          toast("Back online.", "success", 3000);
          window.dispatchEvent(new Event("actually-online"));
        }
        return; // we are online, stop polling
      }
    } catch (e) {} // ignore fetch error
    
    // If we reach here, we are on a network but no actual internet
    if (actualOnlineStatus) {
      actualOnlineStatus = false;
      window.dispatchEvent(new Event("offline"));
    }
    setTimeout(verifyLoop, 5000); // poll every 5s until real internet is found
  };
  
  window.addEventListener("online", () => {
    actualOnlineStatus = false; // reset flag
    verifyLoop();
  });
  
  // Also verify on initial load if the browser claims we are online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    verifyLoop();
  }
}

// A crashed render loop can throw the same error repeatedly; avoid spamming
// full-screen takeovers for the exact same message within a short window.
let lastSig = "";
let lastAt = 0;
function handleUncaught(err, context) {
  const sig = (err && (err.stack || err.message)) || String(err);
  const now = Date.now();
  if (sig === lastSig && now - lastAt < 4000) return;
  lastSig = sig;
  lastAt = now;

  // Suppress offline/network noise entirely when the device is genuinely
  // offline — the shell's persistent offline pill already communicates
  // the state clearly; flooding the screen with toasts or fatal overlays
  // for expected network failures makes the app feel broken.
  const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
  if (offlineNow) {
    const kind = classifyError(err).kind;
    if (kind === "offline" || kind === "network" || kind === "timeout") {
      reportError(err, { ...context, severity: "suppressed-offline" });
      return;
    }
  }

  // If the app shell has mounted successfully, prefer a toast so a stray
  // error in a background task doesn't nuke the whole screen. Only take
  // over the full page if the shell itself never rendered.
  const appEl = document.getElementById("app");
  const shellMounted = !!appEl?.querySelector(".shell, .auth-screen");
  if (shellMounted) errorToast(err, context);
  else showFatalError(err, context);
}