import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeHex,
  hexToRgb,
  rgbToHsl,
  hslToHex,
  shade,
  tint,
  deriveDarkPalette,
  deriveLightPalette,
  applyThemeVariables,
} from "../../js/theme-engine.js";
import { THEME_PRESETS } from "../../js/theme-presets.js";

describe("Theme Engine", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  describe("Color Conversion Utilities", () => {
    it("normalizes hex strings correctly", () => {
      expect(normalizeHex("#abc")).toBe("#AABBCC");
      expect(normalizeHex("14538a")).toBe("#14538A");
      expect(normalizeHex("#14538A")).toBe("#14538A");
      expect(normalizeHex("invalid", "#112233")).toBe("#112233");
      expect(normalizeHex(null)).toBe("#14538A");
    });

    it("converts hex to RGB accurately", () => {
      expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#14538A")).toEqual({ r: 20, g: 83, b: 138 });
    });

    it("converts RGB to HSL and back to Hex accurately", () => {
      const { h, s, l } = rgbToHsl(20, 83, 138);
      expect(h).toBeGreaterThanOrEqual(200);
      expect(h).toBeLessThanOrEqual(215);
      const roundtrip = hslToHex(h, s, l);
      expect(roundtrip).toMatch(/^#[0-9A-F]{6}$/);
    });

    it("shades and tints hex colors correctly", () => {
      const shaded = shade("#14538A", 20);
      expect(shaded).toMatch(/^#[0-9A-F]{6}$/);
      const tinted = tint("#14538A", 0.2);
      expect(tinted).toMatch(/^#[0-9A-F]{6}$/);
    });
  });

  describe("deriveDarkPalette", () => {
    it("generates distinct atmospheric dark palettes for every preset", () => {
      const darkPalettes = {};

      for (const preset of THEME_PRESETS) {
        const dark = deriveDarkPalette(preset.primary, preset.secondary);
        darkPalettes[preset.id] = dark;

        // Verify all required tokens are present
        expect(dark.cream).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.creamDim).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.white).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.surface).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.surfaceAlt).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.line).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.sidebarBg).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.primary700).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.primary600).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.primary800).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.primary900).toBe("#F8FAFC");
        expect(dark.gold).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.goldSoft).toMatch(/^#[0-9A-F]{6}$/);
        expect(dark.heroGradient).toContain("linear-gradient");
      }

      // Ensure Emerald Scholar has a green undertone and Crimson has a red undertone
      const emerald = darkPalettes["emerald-scholar"];
      const crimson = darkPalettes["crimson-academy"];
      const ocean = darkPalettes["ocean-breeze"];

      expect(emerald.surface).not.toBe(crimson.surface);
      expect(emerald.primary700).not.toBe(crimson.primary700);
      expect(emerald.primary700).not.toBe(ocean.primary700);

      // Emerald primary700 should have a green hue (approx 140-180)
      const emeraldRgb = hexToRgb(emerald.primary700);
      const emeraldHsl = rgbToHsl(emeraldRgb.r, emeraldRgb.g, emeraldRgb.b);
      expect(emeraldHsl.h).toBeGreaterThanOrEqual(140);
      expect(emeraldHsl.h).toBeLessThanOrEqual(180);

      // Crimson primary700 should have a red/pink hue (approx 340-360 or 0-20)
      const crimsonRgb = hexToRgb(crimson.primary700);
      const crimsonHsl = rgbToHsl(crimsonRgb.r, crimsonRgb.g, crimsonRgb.b);
      expect(crimsonHsl.h >= 340 || crimsonHsl.h <= 20).toBe(true);
    });

    it("gracefully handles custom and edge case colors", () => {
      const custom = deriveDarkPalette("#6B21A8", "#F59E0B"); // Purple and Amber
      expect(custom.primary700).toMatch(/^#[0-9A-F]{6}$/);
      expect(custom.cream).toMatch(/^#[0-9A-F]{6}$/);

      const gray = deriveDarkPalette("#555555", "#888888"); // Achromatic
      expect(gray.primary700).toMatch(/^#[0-9A-F]{6}$/);
      expect(gray.cream).toMatch(/^#[0-9A-F]{6}$/);
    });
  });

  describe("deriveLightPalette", () => {
    it("generates correct light mode tokens", () => {
      const light = deriveLightPalette("#14538A", "#C9A227");
      expect(light.primary700).toBe("#14538A");
      expect(light.gold).toBe("#C9A227");
      expect(light.cream).toBe("#FAF6F0");
      expect(light.surface).toBe("#FFFFFF");
      expect(light.white).toBe("#FFFFFF");
    });
  });

  describe("applyThemeVariables", () => {
    it("applies light theme tokens to documentElement", () => {
      applyThemeVariables("#14538A", "#C9A227", "light");
      const style = document.documentElement.style;
      expect(style.getPropertyValue("--color-primary-700")).toBe("#14538A");
      expect(style.getPropertyValue("--color-gold")).toBe("#C9A227");
      expect(style.getPropertyValue("--color-cream")).toBe("#FAF6F0");
      expect(style.getPropertyValue("--color-surface")).toBe("#FFFFFF");

      const cached = JSON.parse(localStorage.getItem("eeskia_branding_cache"));
      expect(cached).toEqual({ primary: "#14538A", secondary: "#C9A227" });
    });

    it("applies dark theme tokens to documentElement", () => {
      applyThemeVariables("#1B5E4A", "#D9A441", "dark");
      const style = document.documentElement.style;
      // Should NOT be the default light colors
      expect(style.getPropertyValue("--color-cream")).not.toBe("#FAF6F0");
      expect(style.getPropertyValue("--color-surface")).not.toBe("#FFFFFF");
      expect(style.getPropertyValue("--color-primary-900")).toBe("#F8FAFC");

      // Verify radiant emerald primary700
      const primary700 = style.getPropertyValue("--color-primary-700");
      expect(primary700).toMatch(/^#[0-9A-F]{6}$/);
      const rgb = hexToRgb(primary700);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      expect(hsl.h).toBeGreaterThanOrEqual(140);
      expect(hsl.h).toBeLessThanOrEqual(180);
    });
  });
});
