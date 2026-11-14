// ==========================================================================
// Unsaved Changes Guard Service
// Protects users from accidental data loss by tracking dirty form states
// and intercepting tab closure, browser navigation, and in-app route changes.
// ==========================================================================

let isDirtyState = false;
let dirtyReason = "";
const dirtyTrackers = new Set();
let registeredBeforeUnload = false;

/**
 * Returns true if the page has any pending unsaved changes.
 */
export function isFormDirty() {
  if (isDirtyState) return true;
  for (const tracker of dirtyTrackers) {
    try {
      if (typeof tracker === "function" && tracker()) return true;
    } catch (e) {
      console.warn("[UnsavedChanges] Error in tracker:", e);
    }
  }
  return false;
}

/**
 * Explicitly marks the current view as having unsaved changes or being clean.
 * @param {boolean} dirty
 * @param {string} [reason]
 */
export function setDirty(dirty = true, reason = "") {
  isDirtyState = Boolean(dirty);
  dirtyReason = isDirtyState ? (reason || "You have unsaved changes.") : "";
}

/**
 * Registers an arbitrary predicate function that returns true when dirty.
 * Returns an unregister function.
 */
export function registerDirtyTracker(fn) {
  if (typeof fn === "function") {
    dirtyTrackers.add(fn);
  }
  return () => dirtyTrackers.delete(fn);
}

/**
 * Resets all dirty state and clears registered trackers.
 * Typically called after successful form submission or navigating to a new route.
 */
export function clearDirtyTrackers() {
  dirtyTrackers.clear();
  isDirtyState = false;
  dirtyReason = "";
}

/**
 * Automatically tracks a form element for unsaved input modifications.
 * Takes a snapshot on initialization and compares current values on input/change.
 * Automatically clears dirty state on form submit or reset.
 * 
 * @param {HTMLFormElement|HTMLElement} form
 * @param {Object} [options]
 * @param {Function} [options.onDirtyChange] Callback when dirty state flips
 * @param {string} [options.customSelector] Custom selector for tracked inputs
 * @returns {Function} cleanup/untrack function
 */
export function trackForm(form, { onDirtyChange, customSelector } = {}) {
  if (!form || typeof form.querySelectorAll !== "function") return () => {};

  let formIsDirty = false;
  const initialValues = new Map();

  const getTrackedElements = () => {
    const selector = customSelector || "input:not([type=hidden]):not([type=submit]):not([type=button]):not([data-no-track]), select, textarea";
    return Array.from(form.querySelectorAll(selector));
  };

  const snapshotForm = () => {
    initialValues.clear();
    const elements = getTrackedElements();
    elements.forEach((el, idx) => {
      const key = el.name || el.id || `field_${idx}`;
      if (el.type === "checkbox" || el.type === "radio") {
        initialValues.set(key, el.checked);
      } else {
        initialValues.set(key, el.value);
      }
    });
  };

  const checkFormDirty = () => {
    const elements = getTrackedElements();
    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx];
      const key = el.name || el.id || `field_${idx}`;
      if (!initialValues.has(key)) continue;
      const initial = initialValues.get(key);
      const current = (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
      if (current !== initial) {
        return true;
      }
    }
    return false;
  };

  snapshotForm();

  const handleInput = () => {
    const newDirty = checkFormDirty();
    if (newDirty !== formIsDirty) {
      formIsDirty = newDirty;
      if (typeof onDirtyChange === "function") {
        onDirtyChange(formIsDirty);
      }
    }
  };

  const handleReset = () => {
    setTimeout(() => {
      formIsDirty = false;
      snapshotForm();
      if (typeof onDirtyChange === "function") onDirtyChange(false);
    }, 0);
  };

  const handleSubmit = () => {
    formIsDirty = false;
    if (typeof onDirtyChange === "function") onDirtyChange(false);
  };

  form.addEventListener("input", handleInput);
  form.addEventListener("change", handleInput);
  form.addEventListener("reset", handleReset);
  form.addEventListener("submit", handleSubmit);

  const tracker = () => formIsDirty;
  dirtyTrackers.add(tracker);

  return function untrack() {
    form.removeEventListener("input", handleInput);
    form.removeEventListener("change", handleInput);
    form.removeEventListener("reset", handleReset);
    form.removeEventListener("submit", handleSubmit);
    dirtyTrackers.delete(tracker);
    formIsDirty = false;
  };
}

/**
 * Prompts the user with confirm() if dirty state is active.
 * If user confirms, resets dirty state and returns true.
 * If user cancels, returns false.
 * @param {string} [customPrompt]
 * @returns {boolean} Whether navigation can proceed
 */
export function confirmNavigationIfDirty(customPrompt) {
  if (!isFormDirty()) return true;
  const prompt = customPrompt || dirtyReason || "You have unsaved changes. Leave this page without saving?";
  const proceed = typeof window !== "undefined" && window.confirm ? window.confirm(prompt) : true;
  if (proceed) {
    clearDirtyTrackers();
    return true;
  }
  return false;
}

/**
 * Registers browser-level beforeunload guard for closing tab / browser refresh.
 */
export function initBeforeUnloadGuard() {
  if (registeredBeforeUnload || typeof window === "undefined" || !window.addEventListener) return;
  registeredBeforeUnload = true;
  window.addEventListener("beforeunload", (e) => {
    if (isFormDirty()) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      return e.returnValue;
    }
  });
}

// Auto-register on module load if in browser
initBeforeUnloadGuard();
