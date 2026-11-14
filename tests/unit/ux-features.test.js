import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachSearchClear,
  createPasswordField,
  attachCurrencyInput,
} from "../../js/utils.js";

describe("UX Features: Search Clear, Password Toggle & Currency Input", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("attachSearchClear", () => {
    it("attaches clear button and toggles visibility based on input value", () => {
      const container = document.createElement("div");
      const input = document.createElement("input");
      container.appendChild(input);
      document.body.appendChild(container);

      const onClear = vi.fn();
      const { clearBtn } = attachSearchClear(input, { onClear });

      expect(clearBtn).toBeDefined();
      expect(clearBtn.style.display).toBe("none");

      // Enter search term
      input.value = "Grade 8";
      input.dispatchEvent(new Event("input"));
      expect(clearBtn.style.display).toBe("flex");
      expect(clearBtn.classList.contains("is-visible")).toBe(true);

      // Click clear button
      const inputListener = vi.fn();
      input.addEventListener("input", inputListener);

      clearBtn.dispatchEvent(new MouseEvent("click"));
      expect(input.value).toBe("");
      expect(clearBtn.style.display).toBe("none");
      expect(inputListener).toHaveBeenCalled();
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe("createPasswordField", () => {
    it("renders password field with togglable visibility", () => {
      const { field, input, toggle } = createPasswordField({
        id: "test-pass",
        label: "Staff Password",
        placeholder: "Secret123",
      });
      document.body.appendChild(field);

      expect(input.type).toBe("password");
      expect(input.placeholder).toBe("Secret123");
      expect(toggle.getAttribute("aria-label")).toBe("Show password");

      // Click toggle to reveal
      toggle.dispatchEvent(new MouseEvent("click"));
      expect(input.type).toBe("text");
      expect(toggle.getAttribute("aria-label")).toBe("Hide password");

      // Click toggle to hide again
      toggle.dispatchEvent(new MouseEvent("click"));
      expect(input.type).toBe("password");
      expect(toggle.getAttribute("aria-label")).toBe("Show password");
    });

    it("respects initialVisible: true", () => {
      const { input, toggle } = createPasswordField({
        id: "visible-pass",
        initialVisible: true,
      });

      expect(input.type).toBe("text");
      expect(toggle.getAttribute("aria-label")).toBe("Hide password");
    });
  });

  describe("attachCurrencyInput", () => {
    it("formats value on blur and strips formatting on focus", () => {
      const container = document.createElement("div");
      const input = document.createElement("input");
      input.type = "text";
      container.appendChild(input);
      document.body.appendChild(container);

      const { previewEl } = attachCurrencyInput(input, { prefix: "KES " });

      // User types 14200
      input.value = "14200";
      input.dispatchEvent(new Event("input"));
      expect(previewEl.textContent).toContain("KES 14,200.00");

      // User blurs input
      input.dispatchEvent(new Event("blur"));
      expect(input.value).toBe("KES 14,200.00");
      expect(input.dataset.rawValue).toBe("14200");
      expect(input.numericValue).toBe(14200);

      // User focuses input to edit
      input.dispatchEvent(new Event("focus"));
      expect(input.value).toBe("14200");
    });

    it("reverts input value to raw numeric string on enclosing form submit in capture phase", () => {
      const form = document.createElement("form");
      const input = document.createElement("input");
      input.type = "text";
      input.value = "15000";
      form.appendChild(input);
      document.body.appendChild(form);

      attachCurrencyInput(input, { prefix: "KES " });
      input.dispatchEvent(new Event("blur"));
      expect(input.value).toBe("KES 15,000.00");

      let receivedOnSubmit = "";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        receivedOnSubmit = input.value;
      });

      form.dispatchEvent(new Event("submit", { cancelable: true }));
      expect(receivedOnSubmit).toBe("15000");
      expect(input.numericValue).toBe(15000);
    });
  });
});
