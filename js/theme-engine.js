// ==========================================================================
// Eeskia Dynamic Theming & Atmospheric Dark Palette Engine
// Computes harmonious, vibrant, WCAG-compliant design tokens for any school brand
// ==========================================================================

/**
 * Normalizes a hex string (handles shorthand #RGB and invalid values).
 * @param {string} hex
 * @param {string} fallback
 * @returns {string} 6-character hex with #
 */
export function normalizeHex(hex, fallback = "#14538A") {
  if (!hex || typeof hex !== "string") return fallback;
  let c = hex.trim().replace(/^#/, "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (!/^[0-9A-Fa-f]{6}$/.test(c)) return fallback;
  return "#" + c.toUpperCase();
}

/**
 * Converts a hex string to RGB components.
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function hexToRgb(hex) {
  const c = normalizeHex(hex).slice(1);
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/**
 * Converts RGB components to HSL (h: 0-360, s: 0-100, l: 0-100).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{h: number, s: number, l: number}}
 */
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / d + 2) * 60;
    } else {
      h = ((r - g) / d + 4) * 60;
    }
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Converts HSL components to 6-digit Hex.
 * @param {number} h 0-360
 * @param {number} s 0-100
 * @param {number} l 0-100
 * @returns {string} Hex string (#RRGGBB)
 */
export function hslToHex(h, s, l) {
  h = (Math.round(h) % 360 + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");

  return ("#" + toHex(f(0)) + toHex(f(8)) + toHex(f(4))).toUpperCase();
}

/**
 * Lightens/darkens a hex color by amt (-255..255).
 * @param {string} hex
 * @param {number} amt
 * @returns {string}
 */
export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const nr = clamp(r + amt);
  const ng = clamp(g + amt);
  const nb = clamp(b + amt);
  const toHex = (x) => x.toString(16).padStart(2, "0");
  return ("#" + toHex(nr) + toHex(ng) + toHex(nb)).toUpperCase();
}

/**
 * Tints a hex color toward white by ratio (0..1).
 * @param {string} hex
 * @param {number} ratio
 * @returns {string}
 */
export function tint(hex, ratio = 0.12) {
  const { r, g, b } = hexToRgb(hex);
  const nr = Math.round(r * ratio + 255 * (1 - ratio));
  const ng = Math.round(g * ratio + 255 * (1 - ratio));
  const nb = Math.round(b * ratio + 255 * (1 - ratio));
  const toHex = (x) => x.toString(16).padStart(2, "0");
  return ("#" + toHex(nr) + toHex(ng) + toHex(nb)).toUpperCase();
}

/**
 * Derives a rich, colorful, atmospheric dark palette customized to the school's primary and secondary brand colors.
 * Ensures high contrast, vibrant accents, and cohesive brand personality.
 *
 * @param {string} primaryHex
 * @param {string} secondaryHex
 * @returns {Object}
 */
export function deriveDarkPalette(primaryHex, secondaryHex) {
  const pRgb = hexToRgb(primaryHex);
  const pHsl = rgbToHsl(pRgb.r, pRgb.g, pRgb.b);
  const sRgb = hexToRgb(secondaryHex || "#C9A227");
  const sHsl = rgbToHsl(sRgb.r, sRgb.g, sRgb.b);

  const h = pHsl.h;
  const s = pHsl.s;

  // Atmospheric dark undertones based on school hue
  const cream = hslToHex(h, Math.min(s * 0.35, 22), 6.5);
  const creamDim = hslToHex(h, Math.min(s * 0.35, 22), 9.5);
  const white = hslToHex(h, Math.min(s * 0.40, 24), 11.5);
  const surface = hslToHex(h, Math.min(s * 0.45, 26), 14.5);
  const surfaceAlt = hslToHex(h, Math.min(s * 0.40, 24), 8.5);
  const line = hslToHex(h, Math.min(s * 0.45, 28), 22);
  const sidebarBg = hslToHex(h, Math.min(s * 0.60, 40), 8);

  // Vibrant, luminous primary brand elements that glow on dark backgrounds
  const primary700 = hslToHex(h, Math.max(s, 72), 60);
  const primary600 = hslToHex(h, Math.max(s, 72), 70);
  // Saturated medium-dark shade for solid buttons and checked inputs (clean contrast with white text)
  const primary800 = hslToHex(h, Math.max(s, 65), 32);
  const primary100 = hslToHex(h, Math.min(s * 0.6, 38), 19);

  // Luminous warm secondary/accent tones
  const gold = hslToHex(sHsl.h, Math.max(sHsl.s, 80), 62);
  const goldSoft = hslToHex(sHsl.h, Math.max(sHsl.s, 75), 78);

  return {
    primary700,
    primary600,
    primary800,
    primary900: "#F8FAFC",
    primary100,
    sidebarBg,
    gold,
    goldSoft,
    cream,
    creamDim,
    white,
    surface,
    surfaceAlt,
    line,
    ink: "#F8FAFC",
    inkSoft: "#94A3B8",
    heroGradient: `linear-gradient(135deg, ${surface} 0%, ${creamDim} 100%)`,
  };
}

/**
 * Derives design tokens for light mode based on primary and secondary brand colors.
 *
 * @param {string} primaryHex
 * @param {string} secondaryHex
 * @returns {Object}
 */
export function deriveLightPalette(primaryHex, secondaryHex) {
  const primary = normalizeHex(primaryHex, "#14538A");
  const accent = normalizeHex(secondaryHex, "#C9A227");

  return {
    primary700: primary,
    primary600: shade(primary, 25),
    primary800: shade(primary, -15),
    primary900: shade(primary, -30),
    primary100: tint(primary, 0.12),
    sidebarBg: shade(primary, -30),
    gold: accent,
    goldSoft: shade(accent, 60),
    cream: "#FAF6F0",
    creamDim: "#F1EAE0",
    white: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceAlt: "#F8FAFC",
    line: "#DCE3E8",
    ink: "#21262B",
    inkSoft: "#5C6A73",
    heroGradient: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
  };
}

/**
 * Applies derived theme design tokens to the documentElement and persists branding cache.
 *
 * @param {string} primary
 * @param {string} secondary
 * @param {'light' | 'dark'} effectiveTheme
 */
export function applyThemeVariables(primary, secondary, effectiveTheme = "light") {
  if (typeof document === "undefined") return;

  const root = document.documentElement.style;
  const isDark = effectiveTheme === "dark";
  const palette = isDark
    ? deriveDarkPalette(primary, secondary)
    : deriveLightPalette(primary, secondary);

  root.setProperty("--color-primary-700", palette.primary700);
  root.setProperty("--color-primary-600", palette.primary600);
  root.setProperty("--color-primary-800", palette.primary800);
  root.setProperty("--color-primary-900", palette.primary900);
  root.setProperty("--color-primary-100", palette.primary100);
  root.setProperty("--color-sidebar-bg", palette.sidebarBg);
  root.setProperty("--color-gold", palette.gold);
  root.setProperty("--color-gold-soft", palette.goldSoft);
  root.setProperty("--color-cream", palette.cream);
  root.setProperty("--color-cream-dim", palette.creamDim);
  root.setProperty("--color-white", palette.white);
  root.setProperty("--color-surface", palette.surface);
  root.setProperty("--color-surface-alt", palette.surfaceAlt);
  root.setProperty("--color-line", palette.line);
  root.setProperty("--color-ink", palette.ink);
  root.setProperty("--color-ink-soft", palette.inkSoft);
  root.setProperty("--hero-gradient", palette.heroGradient);

  // Cache branding colors in localStorage for instant reload without FOUT
  try {
    localStorage.setItem(
      "eeskia_branding_cache",
      JSON.stringify({ primary: normalizeHex(primary), secondary: normalizeHex(secondary) })
    );
  } catch {
    // best-effort persistence
  }

  // Update browser chrome meta theme-color
  updateThemeColor(isDark ? palette.sidebarBg : palette.primary700);
}

/**
 * Updates the browser's theme-color meta tag for PWA window frames and mobile status bars.
 * @param {string} color
 */
export function updateThemeColor(color) {
  if (!color || typeof document === "undefined") return;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas.length) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.appendChild(meta);
  } else {
    metas.forEach((m) => m.setAttribute("content", color));
  }
}
