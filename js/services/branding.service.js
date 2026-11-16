// ==========================================================================
// School Branding & Theme Customization Service
// ==========================================================================
import { getEffectiveTheme } from "../theme.js";
import { applyThemeVariables } from "../theme-engine.js";
import { setFavicon } from "../utils.js";

const DEFAULT_TITLE = typeof document !== "undefined" ? document.title : "Eeskia";
let cachedSettings = null;

/**
 * Re-themes the whole app (sidebar, buttons, letterhead accents, browser
 * tab title, PWA status bar / window title bar) to a school's chosen brand.
 * @param {Object} settings - School settings doc containing themeColor, secondaryColor, schoolName, logoUrl
 */
export function applyBranding(settings) {
  if (settings) {
    cachedSettings = settings;
  }
  const primary = settings?.themeColor || cachedSettings?.themeColor || "#14538A";
  const accent = settings?.secondaryColor || cachedSettings?.secondaryColor || "#C9A227";
  const effectiveTheme = getEffectiveTheme();

  applyThemeVariables(primary, accent, effectiveTheme);

  if (typeof document !== "undefined") {
    document.title = settings?.schoolName
      ? `${settings.schoolName} `
      : (cachedSettings?.schoolName ? `${cachedSettings.schoolName} ` : DEFAULT_TITLE);
  }
  setFavicon(settings?.logoUrl || cachedSettings?.logoUrl || "/assets/logo.png");
}

if (typeof window !== "undefined") {
  window.addEventListener("themechange", () => {
    applyBranding(cachedSettings || {});
  });
}
