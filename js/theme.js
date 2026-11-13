// ==========================================================================
// Eeskia Theme Management (Light / Dark / System)
// ==========================================================================

import { applyThemeVariables } from "./theme-engine.js";

const STORAGE_KEY = "eeskia_theme";

/**
 * Returns saved theme mode: 'light', 'dark', or 'system'.
 * @returns {'light' | 'dark' | 'system'}
 */
export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "system";
  } catch {
    return "system";
  }
}

/**
 * Returns effective active theme: 'light' or 'dark'.
 * @returns {'light' | 'dark'}
 */
export function getEffectiveTheme() {
  const pref = getTheme();
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Sets the theme and updates the document and persistence.
 * @param {'light' | 'dark' | 'system'} mode
 */
export function setTheme(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // best-effort persistence
  }

  const effective = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", effective);

    // Apply active branding variables for the new mode immediately
    try {
      const raw = localStorage.getItem("eeskia_branding_cache");
      if (raw) {
        const { primary, secondary } = JSON.parse(raw);
        if (primary && secondary) {
          applyThemeVariables(primary, secondary, effective);
        }
      }
    } catch {
      // best-effort
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: mode, effectiveTheme: effective } }));
  }
}

/**
 * Toggles between light and dark modes.
 * @returns {'light' | 'dark'} the new effective theme
 */
export function toggleTheme() {
  const current = getEffectiveTheme();
  const next = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/**
 * Initializes theme listeners and ensures documentElement has the active theme.
 */
export function initTheme() {
  if (typeof window === "undefined") return;

  const effective = getEffectiveTheme();
  document.documentElement.setAttribute("data-theme", effective);

  try {
    const raw = localStorage.getItem("eeskia_branding_cache");
    if (raw) {
      const { primary, secondary } = JSON.parse(raw);
      if (primary && secondary) {
        applyThemeVariables(primary, secondary, effective);
      }
    }
  } catch {
    // best-effort
  }

  // Watch for system appearance changes when in system mode
  if (window.matchMedia) {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => {
      if (getTheme() === "system") {
        const nextEffective = e.matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", nextEffective);
        window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: "system", effectiveTheme: nextEffective } }));
      }
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
    } else if (mql.addListener) {
      mql.addListener(handler);
    }
  }
}
