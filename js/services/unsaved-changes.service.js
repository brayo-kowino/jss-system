// ==========================================================================
// Unsaved Changes Guard Service
// Protects users from accidental data loss by tracking dirty form states
// and providing detailed contextual warnings about WHERE and WHAT changes
// are currently unsaved before leaving the page.
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
      if (typeof tracker === "function") {
        const res = tracker();
        if (res === true || typeof res === "string" || (res && typeof res === "object" && res.isDirty)) {
          return true;
        }
      }
    } catch (e) {
      console.warn("[UnsavedChanges] Error in tracker:", e);
    }
  }
  return false;
}

/**
 * Explicitly marks the current view as having unsaved changes or being clean.
 * @param {boolean} dirty
 * @param {string} [reason] Human-readable description of where the unsaved change is
 */
export function setDirty(dirty = true, reason = "") {
  isDirtyState = Boolean(dirty);
  dirtyReason = isDirtyState ? (reason || "You have unsaved changes.") : "";
}

/**
 * Registers an arbitrary predicate function that returns true or a description when dirty.
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
 */
export function clearDirtyTrackers() {
  dirtyTrackers.clear();
  isDirtyState = false;
  dirtyReason = "";
}

/**
 * Cleans raw label text (strips trailing colons, asterisks, and helper parentheticals).
 */
function cleanLabelText(str = "") {
  return String(str)
    .replace(/[\*:]+/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
}

/**
 * Finds a human-friendly field name for an element.
 */
function getFieldLabel(form, el) {
  if (el.id) {
    const explicitLabel = form.querySelector(`label[for="${el.id}"]`);
    if (explicitLabel?.textContent) {
      const cleaned = cleanLabelText(explicitLabel.textContent);
      if (cleaned) return cleaned;
    }
  }

  const parentField = el.closest(".field, .form-group, .field-row");
  if (parentField) {
    const fieldLabel = parentField.querySelector("label");
    if (fieldLabel?.textContent) {
      const cleaned = cleanLabelText(fieldLabel.textContent);
      if (cleaned) return cleaned;
    }
  }

  const attr = el.getAttribute("aria-label") || el.placeholder || el.name || "";
  const cleaned = cleanLabelText(attr);
  return cleaned || "Field";
}

/**
 * Resolves a human-friendly name for a form or modal container.
 */
function resolveFormTitle(form, options = {}) {
  if (options.name) return options.name;

  const modalTitle = form.closest(".modal")?.querySelector(".modal__title, .modal-title, .modal-header h2, .modal-header h3")?.textContent?.trim();
  if (modalTitle) return modalTitle;

  const formHeading = form.querySelector("h1, h2, h3, legend")?.textContent?.trim();
  if (formHeading) return formHeading;

  const pageTitle = typeof document !== "undefined"
    ? document.querySelector(".topbar__title, .page-header h1, main h1")?.textContent?.trim()
    : "";
  if (pageTitle) return pageTitle;

  return "Active Form";
}

/**
 * Automatically tracks a form element for unsaved input modifications.
 * Takes a snapshot on initialization, identifies exactly which fields were changed,
 * and reports the form name and modified field list.
 * 
 * @param {HTMLFormElement|HTMLElement} form
 * @param {Object} [options]
 * @param {string} [options.name] Human-readable name of the form (e.g. "Student Admission")
 * @param {Function} [options.onDirtyChange] Callback when dirty state flips (isDirty, details)
 * @param {string} [options.customSelector] Custom selector for tracked inputs
 * @returns {Function} cleanup/untrack function
 */
export function trackForm(form, options = {}) {
  if (!form || typeof form.querySelectorAll !== "function") return () => {};

  let formIsDirty = false;
  let modifiedFields = [];
  const initialValues = new Map();

  const getTrackedElements = () => {
    const selector = options.customSelector || "input:not([type=hidden]):not([type=submit]):not([type=button]):not([data-no-track]), select, textarea";
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

  const inspectModifiedFields = () => {
    const elements = getTrackedElements();
    const changedLabels = [];
    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx];
      const key = el.name || el.id || `field_${idx}`;
      if (!initialValues.has(key)) continue;
      const initial = initialValues.get(key);
      const current = (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
      if (current !== initial) {
        const label = getFieldLabel(form, el);
        if (!changedLabels.includes(label)) {
          changedLabels.push(label);
        }
      }
    }
    return changedLabels;
  };

  snapshotForm();

  const getDetails = () => {
    const formTitle = resolveFormTitle(form, options);
    if (!modifiedFields.length) return formTitle;
    const fieldsPreview = modifiedFields.slice(0, 3).join(", ");
    const remaining = modifiedFields.length - 3;
    const fieldText = remaining > 0 ? `${fieldsPreview}, and ${remaining} more` : fieldsPreview;
    return `${formTitle} (modified: ${fieldText})`;
  };

  const handleInput = () => {
    const changed = inspectModifiedFields();
    const isNowDirty = changed.length > 0;
    modifiedFields = changed;
    if (isNowDirty !== formIsDirty) {
      formIsDirty = isNowDirty;
      if (typeof options.onDirtyChange === "function") {
        options.onDirtyChange(formIsDirty, getDetails());
      }
    }
  };

  const handleReset = () => {
    setTimeout(() => {
      formIsDirty = false;
      modifiedFields = [];
      snapshotForm();
      if (typeof options.onDirtyChange === "function") options.onDirtyChange(false, "");
    }, 0);
  };

  const handleSubmit = () => {
    formIsDirty = false;
    modifiedFields = [];
    if (typeof options.onDirtyChange === "function") options.onDirtyChange(false, "");
  };

  form.addEventListener("input", handleInput);
  form.addEventListener("change", handleInput);
  form.addEventListener("reset", handleReset);
  form.addEventListener("submit", handleSubmit);

  const tracker = () => {
    if (!formIsDirty) return null;
    return {
      isDirty: true,
      description: getDetails(),
      formTitle: resolveFormTitle(form, options),
      modifiedFields: [...modifiedFields],
    };
  };
  dirtyTrackers.add(tracker);

  return function untrack() {
    form.removeEventListener("input", handleInput);
    form.removeEventListener("change", handleInput);
    form.removeEventListener("reset", handleReset);
    form.removeEventListener("submit", handleSubmit);
    dirtyTrackers.delete(tracker);
    formIsDirty = false;
    modifiedFields = [];
  };
}

/**
 * Returns a list of detailed descriptions of all areas that currently have unsaved changes.
 * @returns {string[]}
 */
export function getDirtySummary() {
  const items = [];
  if (isDirtyState && dirtyReason) {
    items.push(dirtyReason);
  }
  for (const tracker of dirtyTrackers) {
    try {
      if (typeof tracker === "function") {
        const res = tracker();
        if (res) {
          if (typeof res === "string") {
            items.push(res);
          } else if (typeof res === "object" && res.isDirty) {
            items.push(res.description || res.formTitle || "Unsaved form changes");
          } else if (res === true) {
            items.push("Unsaved form changes");
          }
        }
      }
    } catch (e) {
      console.warn("[UnsavedChanges] Error in tracker:", e);
    }
  }
  return items;
}

/**
 * Formats a clear, multi-line confirmation prompt indicating exactly what and where is unsaved.
 * @param {string} [customPrompt]
 * @returns {string}
 */
export function buildConfirmPrompt(customPrompt) {
  if (customPrompt) return customPrompt;
  const items = getDirtySummary();
  if (!items.length) {
    return "You have unsaved changes. Leave this page without saving?";
  }
  const bulletList = items.map((it) => ` • ${it}`).join("\n");
  return `You have unsaved changes in:\n${bulletList}\n\nIf you leave now, your edits will be discarded.\nLeave without saving?`;
}

/**
 * Prompts the user with a detailed contextual confirm dialog if dirty state is active.
 * If user confirms, resets dirty state and returns true.
 * If user cancels, returns false.
 * @param {string} [customPrompt]
 * @returns {boolean} Whether navigation can proceed
 */
export function confirmNavigationIfDirty(customPrompt) {
  if (!isFormDirty()) return true;
  const prompt = buildConfirmPrompt(customPrompt);
  const proceed = typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(prompt) : true;
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
