// ==========================================================================
// Install-prompt service
//
// Wraps the browser's "Add to Home Screen"/"Install app" machinery so the
// rest of the app (currently just the topbar button in shell.js) doesn't
// need to know the difference between Chrome/Edge (which fire a real
// `beforeinstallprompt` event we can trigger programmatically) and iOS
// Safari (which never fires that event and only supports installing via
// the manual Share -> "Add to Home Screen" flow).
//
// Imported for its side effect (attaching the beforeinstallprompt listener)
// as early as possible from app.js - the event can fire before the router
// or shell exist, and if nothing is listening yet the browser's default
// mini-infobar behavior kicks in instead and the event is gone for good.
// ==========================================================================

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  for (const cb of listeners) {
    try { cb(getState()); } catch { /* one bad subscriber shouldn't break the rest */ }
  }
}

// Chrome/Edge/Android fire this instead of showing their own install UI,
// handing control of *when* to prompt to us - e.g. only once the user has
// actually reached the dashboard, not mid-login.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  notify();
});

// Fired after a successful install (from our button OR the browser's own
// menu) - clears the deferred prompt so the button hides itself instead of
// offering to "install" an app that's already installed.
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  notify();
});

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

// True once the app is actually running as an installed app, not a normal
// browser tab - covers Chrome/Edge/Android ("display-mode: standalone")
// and iOS Safari's older, non-standard `navigator.standalone` flag.
export function isRunningInstalled() {
  return (
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

// Whether there's something useful for a button to do right now: either a
// real one-tap install prompt is ready (Chrome/Edge/Android), or the
// person is on iOS Safari where installing is still possible but only via
// manual instructions (see promptInstall below).
export function isInstallable() {
  if (isRunningInstalled()) return false;
  return !!deferredPrompt || isIos();
}

// Which UI a caller should show for the current browser: a real one-tap
// prompt, iOS's manual steps, or nothing (not installable / already
// installed here).
export function installMethod() {
  if (isRunningInstalled()) return "none";
  if (deferredPrompt) return "prompt";
  if (isIos()) return "ios-manual";
  return "none";
}

// Triggers the native install prompt (Chrome/Edge/Android only - throws if
// called when installMethod() isn't "prompt"; callers should check first
// or just rely on the button only appearing when there's something to do).
// Resolves with the browser's own accepted/dismissed choice.
export async function promptInstall() {
  if (!deferredPrompt) throw new Error("No install prompt available");
  const promptEvent = deferredPrompt;
  deferredPrompt = null; // a captured prompt can only be used once
  notify();
  promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome; // "accepted" | "dismissed"
}

function getState() {
  return { installable: isInstallable(), method: installMethod(), installed: isRunningInstalled() };
}

// Subscribe to installability changes (the prompt becoming available,
// install completing, etc). Returns an unsubscribe function - callers that
// re-render on every navigation (like the shell) should unsubscribe the
// previous listener before adding a new one, or subscriptions pile up for
// the lifetime of the session.
export function onInstallabilityChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
