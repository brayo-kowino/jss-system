import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isFormDirty,
  setDirty,
  registerDirtyTracker,
  clearDirtyTrackers,
  trackForm,
  confirmNavigationIfDirty,
} from "../../js/services/unsaved-changes.service.js";

describe("Unsaved Changes Guard Service", () => {
  beforeEach(() => {
    clearDirtyTrackers();
    vi.restoreAllMocks();
  });

  it("reports dirty when setDirty(true) is called", () => {
    expect(isFormDirty()).toBe(false);
    setDirty(true, "Pending marks");
    expect(isFormDirty()).toBe(true);
    setDirty(false);
    expect(isFormDirty()).toBe(false);
  });

  it("checks custom dirty trackers", () => {
    let customDirty = false;
    const unregister = registerDirtyTracker(() => customDirty);

    expect(isFormDirty()).toBe(false);
    customDirty = true;
    expect(isFormDirty()).toBe(true);

    unregister();
    expect(isFormDirty()).toBe(false);
  });

  it("tracks form input changes and marks form dirty", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.name = "studentName";
    input.value = "John Doe";
    form.appendChild(input);
    document.body.appendChild(form);

    const onDirtyChange = vi.fn();
    const untrack = trackForm(form, { onDirtyChange });

    expect(isFormDirty()).toBe(false);

    // Modify input with bubbling event
    input.value = "Jane Doe";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(isFormDirty()).toBe(true);
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    // Revert input to initial value
    input.value = "John Doe";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(isFormDirty()).toBe(false);
    expect(onDirtyChange).toHaveBeenCalledWith(false);

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

    trackForm(form);
    input.value = "2000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(isFormDirty()).toBe(true);

    form.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(isFormDirty()).toBe(false);

    form.remove();
  });

  it("prompts window.confirm when dirty and aborts if canceled", () => {
    setDirty(true, "Unsaved form");
    window.confirm = vi.fn().mockReturnValue(false);

    const allowed = confirmNavigationIfDirty();
    expect(window.confirm).toHaveBeenCalledWith("Unsaved form");
    expect(allowed).toBe(false);
    expect(isFormDirty()).toBe(true);
  });

  it("prompts window.confirm and clears dirty if user proceeds", () => {
    setDirty(true, "Unsaved form");
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
