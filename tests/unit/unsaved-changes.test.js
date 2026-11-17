import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isFormDirty,
  setDirty,
  registerDirtyTracker,
  clearDirtyTrackers,
  trackForm,
  confirmNavigationIfDirty,
  getDirtySummary,
  buildConfirmPrompt,
} from "../../js/services/unsaved-changes.service.js";

describe("Unsaved Changes Guard Service (Contextual Prompting)", () => {
  beforeEach(() => {
    clearDirtyTrackers();
    vi.restoreAllMocks();
  });

  it("reports dirty and includes reason when setDirty(true) is called", () => {
    expect(isFormDirty()).toBe(false);
    setDirty(true, "Marks Entry (3 unsaved student scores)");
    expect(isFormDirty()).toBe(true);

    const summary = getDirtySummary();
    expect(summary).toContain("Marks Entry (3 unsaved student scores)");

    setDirty(false);
    expect(isFormDirty()).toBe(false);
  });

  it("checks custom dirty trackers", () => {
    let customDirty = false;
    const unregister = registerDirtyTracker(() => customDirty ? "Custom Editor" : null);

    expect(isFormDirty()).toBe(false);
    customDirty = true;
    expect(isFormDirty()).toBe(true);
    expect(getDirtySummary()).toContain("Custom Editor");

    unregister();
    expect(isFormDirty()).toBe(false);
  });

  it("tracks form input changes and identifies exact form name and modified fields", () => {
    const form = document.createElement("form");

    const nameField = document.createElement("div");
    nameField.className = "field";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Full Name";
    const nameInput = document.createElement("input");
    nameInput.id = "s-name";
    nameInput.value = "Brian Odhiambo";
    nameField.append(nameLabel, nameInput);

    const gradeField = document.createElement("div");
    gradeField.className = "field";
    const gradeLabel = document.createElement("label");
    gradeLabel.textContent = "Grade (Class)";
    const gradeInput = document.createElement("input");
    gradeInput.id = "s-grade";
    gradeInput.value = "Grade 7";
    gradeField.append(gradeLabel, gradeInput);

    form.append(nameField, gradeField);
    document.body.appendChild(form);

    const onDirtyChange = vi.fn();
    const untrack = trackForm(form, { name: "Student Admission", onDirtyChange });

    expect(isFormDirty()).toBe(false);

    // Modify Full Name
    nameInput.value = "Jane Doe";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(isFormDirty()).toBe(true);
    const summaryAfterName = getDirtySummary();
    expect(summaryAfterName[0]).toContain("Student Admission");
    expect(summaryAfterName[0]).toContain("Full Name");

    // Modify Grade
    gradeInput.value = "Grade 8";
    gradeInput.dispatchEvent(new Event("input", { bubbles: true }));

    const summaryAfterBoth = getDirtySummary();
    expect(summaryAfterBoth[0]).toContain("Full Name, Grade");

    // Check prompt composition
    const prompt = buildConfirmPrompt();
    expect(prompt).toContain("You have unsaved changes in:");
    expect(prompt).toContain("Student Admission (modified: Full Name, Grade)");
    expect(prompt).toContain("If you leave now, your edits will be discarded.");

    untrack();
    form.remove();
  });

  it("clears dirty state on form submit", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.name = "amount";
    input.value = "1000";
    form.appendChild(input);
    document.body.appendChild(form);

    trackForm(form, { name: "Fee Form" });
    input.value = "2000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(isFormDirty()).toBe(true);

    form.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(isFormDirty()).toBe(false);

    form.remove();
  });

  it("prompts window.confirm with contextual details and aborts if canceled", () => {
    setDirty(true, "Marks Entry (4 pending scores)");
    window.confirm = vi.fn().mockReturnValue(false);

    const allowed = confirmNavigationIfDirty();
    expect(window.confirm).toHaveBeenCalled();
    const promptArg = window.confirm.mock.calls[0][0];
    expect(promptArg).toContain("You have unsaved changes in:");
    expect(promptArg).toContain("Marks Entry (4 pending scores)");
    expect(allowed).toBe(false);
    expect(isFormDirty()).toBe(true);
  });

  it("prompts window.confirm and clears dirty if user proceeds", () => {
    setDirty(true, "Student Profile Edit");
    window.confirm = vi.fn().mockReturnValue(true);

    const allowed = confirmNavigationIfDirty();
    expect(window.confirm).toHaveBeenCalled();
    expect(allowed).toBe(true);
    expect(isFormDirty()).toBe(false);
  });

  it("allows navigation without confirm prompt when not dirty", () => {
    window.confirm = vi.fn();
    const allowed = confirmNavigationIfDirty();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(allowed).toBe(true);
  });
});
