import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openCommandPalette, closeCommandPalette, toggleCommandPalette, initCommandPalette } from "../../js/components/command-palette.js";

// Mock router
vi.mock("../../js/router.js", () => ({
  navigate: vi.fn(),
}));

// Mock theme
vi.mock("../../js/theme.js", () => ({
  toggleTheme: vi.fn(),
  getEffectiveTheme: vi.fn(() => "light"),
}));

// Mock services
vi.mock("../../js/services/student.service.js", () => ({
  listStudents: vi.fn(async () => [
    { id: "s1", fullName: "Jane Doe", admissionNumber: "ADM-101", grade: "Grade 7", stream: "Alpha", status: "active" },
    { id: "s2", fullName: "Kevin Omondi", admissionNumber: "ADM-102", grade: "Grade 8", stream: "Beta", status: "active" },
  ]),
}));

vi.mock("../../js/services/academic.service.js", () => ({
  listClasses: vi.fn(async () => [
    { id: "c1", grade: "Grade 7", stream: "Alpha", room: "Room 1" },
    { id: "c2", grade: "Grade 8", stream: "Beta", room: "Room 2" },
  ]),
}));

vi.mock("../../js/services/teacher.service.js", () => ({
  listTeachers: vi.fn(async () => [
    { id: "t1", fullName: "Peter Mwangi", email: "peter@school.com", tscNumber: "TSC-12345", role: "Math Teacher" },
  ]),
}));

describe("Global Command Palette", () => {
  const adminProfile = {
    uid: "admin1",
    email: "admin@school.com",
    role: "admin",
    schoolId: "school1",
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    closeCommandPalette();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeCommandPalette();
  });

  it("opens the command palette dialog in the DOM", () => {
    openCommandPalette({ profile: adminProfile });
    const backdrop = document.querySelector(".cmd-palette-backdrop");
    expect(backdrop).not.toBeNull();
    const input = backdrop.querySelector(".cmd-palette-input");
    expect(input).not.toBeNull();
  });

  it("closes the command palette when closeCommandPalette is called", () => {
    openCommandPalette({ profile: adminProfile });
    expect(document.querySelector(".cmd-palette-backdrop")).not.toBeNull();

    closeCommandPalette();
    expect(document.querySelector(".cmd-palette-backdrop")).toBeNull();
  });

  it("toggles the command palette open and closed", () => {
    toggleCommandPalette({ profile: adminProfile });
    expect(document.querySelector(".cmd-palette-backdrop")).not.toBeNull();

    toggleCommandPalette({ profile: adminProfile });
    expect(document.querySelector(".cmd-palette-backdrop")).toBeNull();
  });

  it("renders suggested items when query is empty", () => {
    openCommandPalette({ profile: adminProfile });
    const items = document.querySelectorAll(".cmd-palette-item");
    expect(items.length).toBeGreaterThan(0);
    const firstTitle = items[0].querySelector(".cmd-palette-item-title");
    expect(firstTitle).not.toBeNull();
  });

  it("filters navigation items when typing query", () => {
    openCommandPalette({ profile: adminProfile });
    const input = document.querySelector(".cmd-palette-input");

    input.value = "attend";
    input.dispatchEvent(new Event("input"));

    const items = document.querySelectorAll(".cmd-palette-item");
    expect(items.length).toBeGreaterThan(0);
    const titles = Array.from(items).map((el) => el.querySelector(".cmd-palette-item-title").textContent);
    expect(titles.some((t) => t.toLowerCase().includes("attendance"))).toBe(true);
  });

  it("executes the selected navigation item on Enter", async () => {
    const { navigate } = await import("../../js/router.js");
    openCommandPalette({ profile: adminProfile });
    const input = document.querySelector(".cmd-palette-input");

    input.value = "fee";
    input.dispatchEvent(new Event("input"));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(navigate).toHaveBeenCalledWith("/fees");
    expect(document.querySelector(".cmd-palette-backdrop")).toBeNull();
  });

  it("closes on Escape key press", () => {
    openCommandPalette({ profile: adminProfile });
    const input = document.querySelector(".cmd-palette-input");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".cmd-palette-backdrop")).toBeNull();
  });

  it("triggers keyboard shortcut Ctrl+K", () => {
    initCommandPalette(adminProfile);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

    expect(document.querySelector(".cmd-palette-backdrop")).not.toBeNull();
  });

  it("jumps to School Settings when Ctrl+L is pressed", async () => {
    const { navigate } = await import("../../js/router.js");
    initCommandPalette(adminProfile);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true }));

    expect(navigate).toHaveBeenCalledWith("/settings");
  });

  it("jumps to Attendance when Ctrl+A is pressed", async () => {
    const { navigate } = await import("../../js/router.js");
    initCommandPalette(adminProfile);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }));

    expect(navigate).toHaveBeenCalledWith("/attendance");
  });

  it("jumps to Fees when Ctrl+F is pressed", async () => {
    const { navigate } = await import("../../js/router.js");
    initCommandPalette(adminProfile);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));

    expect(navigate).toHaveBeenCalledWith("/fees");
  });

  it("restricts navigation when role is unauthorized", async () => {
    const { navigate } = await import("../../js/router.js");
    const teacherProfile = { uid: "teacher1", email: "teacher@school.com", role: "subject_teacher", schoolId: "s1" };
    initCommandPalette(teacherProfile);
    // Subject teacher cannot access School Settings (/settings)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true }));

    expect(navigate).not.toHaveBeenCalledWith("/settings");
  });

  it("renders shortcut badge in command palette item", () => {
    openCommandPalette({ profile: adminProfile });
    const shortcuts = document.querySelectorAll(".cmd-palette-item-shortcut");
    expect(shortcuts.length).toBeGreaterThan(0);
    const firstShortcut = shortcuts[0].textContent;
    expect(firstShortcut).toMatch(/(Ctrl|⌘)\+[A-Z0-9]/);
  });

  it("opens directly in Key Hints view when defaultTab is 'hints'", () => {
    openCommandPalette({ profile: adminProfile, defaultTab: "hints" });
    const hintsView = document.querySelector(".cmd-palette-view--hints");
    expect(hintsView).not.toBeNull();
    expect(hintsView.style.display).not.toBe("none");

    const searchView = document.querySelector(".cmd-palette-view--search");
    expect(searchView.style.display).toBe("none");

    const rows = document.querySelectorAll(".cmd-palette-hint-row");
    expect(rows.length).toBeGreaterThan(10);
  });

  it("switches tabs between Search and Key Hints on click", () => {
    openCommandPalette({ profile: adminProfile, defaultTab: "search" });

    const tabs = document.querySelectorAll(".cmd-palette-tab");
    expect(tabs.length).toBe(2);

    // Click hints tab
    tabs[1].click();
    const hintsView = document.querySelector(".cmd-palette-view--hints");
    expect(hintsView.style.display).not.toBe("none");

    // Click search tab
    tabs[0].click();
    const searchView = document.querySelector(".cmd-palette-view--search");
    expect(searchView.style.display).not.toBe("none");
  });

  it("filters shortcut hints when typing in hints filter input", () => {
    openCommandPalette({ profile: adminProfile, defaultTab: "hints" });
    const filterInput = document.querySelector(".cmd-palette-hints-filter");
    expect(filterInput).not.toBeNull();

    filterInput.value = "settings";
    filterInput.dispatchEvent(new Event("input"));

    const rows = document.querySelectorAll(".cmd-palette-hint-row");
    const titles = Array.from(rows).map((r) => r.querySelector(".cmd-palette-hint-title")?.textContent || "");
    expect(titles.some((t) => t.includes("School Settings"))).toBe(true);
  });

  it("navigates directly when clicking a shortcut hint card", async () => {
    const { navigate } = await import("../../js/router.js");
    openCommandPalette({ profile: adminProfile, defaultTab: "hints" });

    const rows = document.querySelectorAll(".cmd-palette-hint-row");
    const settingsRow = Array.from(rows).find((r) =>
      r.querySelector(".cmd-palette-hint-title")?.textContent.includes("School Settings")
    );
    expect(settingsRow).toBeDefined();

    settingsRow.click();
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(document.querySelector(".cmd-palette-backdrop")).toBeNull();
  });

  it("opens Key Hints view when '?' is pressed outside input", () => {
    initCommandPalette(adminProfile);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));

    const hintsView = document.querySelector(".cmd-palette-view--hints");
    expect(hintsView).not.toBeNull();
    expect(hintsView.style.display).not.toBe("none");
  });
});
