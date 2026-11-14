import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachSearchClear,
  createPasswordField,
  attachCurrencyInput,
  makeCopyable,
  renderEmptyState,
  animateNumber,
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

  describe("makeCopyable", () => {
    it("attaches copyable styling, icon, and role attribute", () => {
      const el = document.createElement("span");
      el.textContent = "ADM-2024-001";
      document.body.appendChild(el);

      makeCopyable(el, "ADM-2024-001", { title: "Click to copy admission" });

      expect(el.classList.contains("copyable-text")).toBe(true);
      expect(el.getAttribute("role")).toBe("button");
      expect(el.getAttribute("title")).toBe("Click to copy admission");
      expect(el.tabIndex).toBe(0);
      expect(el.querySelector(".copyable-text__icon")).not.toBeNull();
    });

    it("copies text using navigator.clipboard.writeText and shows micro-tooltip", async () => {
      const el = document.createElement("span");
      el.textContent = "0712345678";
      document.body.appendChild(el);

      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      const onCopied = vi.fn();
      makeCopyable(el, "0712345678", { onCopied, successText: "Phone copied!" });

      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));

      expect(writeTextMock).toHaveBeenCalledWith("0712345678");
      expect(onCopied).toHaveBeenCalledWith("0712345678");

      const tooltip = el.querySelector(".copied-tooltip");
      expect(tooltip).not.toBeNull();
      expect(tooltip.textContent).toContain("Phone copied!");
    });

    it("triggers copy on Enter or Space keydown", async () => {
      const el = document.createElement("span");
      el.textContent = "QWE89123XZ";
      document.body.appendChild(el);

      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      makeCopyable(el, "QWE89123XZ");

      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));

      expect(writeTextMock).toHaveBeenCalledWith("QWE89123XZ");
    });
  });

  describe("renderEmptyState", () => {
    it("renders smart empty state with icon, title, and message", () => {
      const card = renderEmptyState({
        iconName: "search_off",
        title: "No learners match your search",
        message: "Try searching for a different name.",
      });

      expect(card.classList.contains("empty-state--smart")).toBe(true);
      expect(card.querySelector(".empty-state--smart__title").textContent).toBe("No learners match your search");
      expect(card.querySelector(".empty-state--smart__msg").textContent).toBe("Try searching for a different name.");
      expect(card.querySelector(".empty-state--smart__halo")).not.toBeNull();
    });

    it("renders reset button and fires onReset when clicked", () => {
      const onReset = vi.fn();
      const card = renderEmptyState({
        title: "Zero records",
        message: "No results found",
        resetText: "Clear filters & search",
        onReset,
      });

      const btn = card.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn.textContent).toContain("Clear filters & search");

      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it("renders custom actionBtn when provided", () => {
      const customBtn = document.createElement("button");
      customBtn.className = "custom-action-btn";
      customBtn.textContent = "Add Record";

      const card = renderEmptyState({
        title: "No records",
        actionBtn: customBtn,
      });

      expect(card.querySelector(".custom-action-btn")).not.toBeNull();
    });
  });

  describe("animateNumber", () => {
    it("immediately formats number if prefers-reduced-motion is enabled", () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }));

      const el = document.createElement("span");
      animateNumber(el, 1500);

      expect(el.textContent).toBe("1,500");
    });

    it("formats number with decimals, prefix, and suffix", () => {
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: true, // test synchronous formatting path
        media: "",
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }));

      const el = document.createElement("span");
      animateNumber(el, 84500.5, {
        decimals: 2,
        prefix: "KES ",
      });

      expect(el.textContent).toContain("KES 84,500.50");
    });

    it("handles non-numeric target gracefully", () => {
      const el = document.createElement("span");
      animateNumber(el, "N/A");
      expect(el.textContent).toBe("N/A");
    });
  });
});
