import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTheme, getEffectiveTheme, setTheme, toggleTheme, initTheme } from "../../js/theme.js";

describe("Theme Service", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system when no theme is saved", () => {
    expect(getTheme()).toBe("system");
  });

  it("sets dark theme and updates documentElement and localStorage", () => {
    setTheme("dark");
    expect(getTheme()).toBe("dark");
    expect(getEffectiveTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("eeskia_theme")).toBe("dark");
  });

  it("sets light theme and updates documentElement and localStorage", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(getEffectiveTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("eeskia_theme")).toBe("light");
  });

  it("toggles theme between light and dark", () => {
    setTheme("light");
    const next1 = toggleTheme();
    expect(next1).toBe("dark");
    expect(getEffectiveTheme()).toBe("dark");

    const next2 = toggleTheme();
    expect(next2).toBe("light");
    expect(getEffectiveTheme()).toBe("light");
  });

  it("dispatches themechange event when theme is set", () => {
    const handler = vi.fn();
    window.addEventListener("themechange", handler);

    setTheme("dark");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ theme: "dark", effectiveTheme: "dark" });

    window.removeEventListener("themechange", handler);
  });

  it("applies cached branding when dark mode is enabled", () => {
    localStorage.setItem("eeskia_branding_cache", JSON.stringify({ primary: "#1B5E4A", secondary: "#D9A441" }));
    setTheme("dark");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--color-primary-900")).toBe("#F8FAFC");
    expect(style.getPropertyValue("--color-cream")).toMatch(/^#[0-9A-F]{6}$/);
    expect(style.getPropertyValue("--color-cream")).not.toBe("#FAF6F0");
  });
});
