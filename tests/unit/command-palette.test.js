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
});
