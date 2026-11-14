import { describe, it, expect, beforeEach, vi } from "vitest";
import { openModal } from "../../js/components/modal.js";
import { el } from "../../js/utils.js";

describe("Modal Component (js/components/modal.js)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens modal with standard positional arguments (title, bodyNode, extraClass)", () => {
    const bodyNode = el("div", { class: "custom-body" }, "Hello Modal");
    const close = openModal("Test Modal Title", bodyNode, "modal--custom");

    const modal = document.querySelector(".modal");
    expect(modal).not.toBeNull();
    expect(modal.classList.contains("modal--custom")).toBe(true);

    const titleEl = modal.querySelector(".modal__header h3");
    expect(titleEl.textContent).toBe("Test Modal Title");

    const contentEl = modal.querySelector(".custom-body");
    expect(contentEl).not.toBeNull();
    expect(contentEl.textContent).toBe("Hello Modal");

    close();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("opens modal with config object ({ title, body, maxWidth })", () => {
    const bodyNode = el("div", { id: "receipt-content" }, "Receipt Card");
    const close = openModal({
      title: "Payment Receipt: Brian Omondi",
      body: bodyNode,
      maxWidth: "480px",
    });

    const modal = document.querySelector(".modal");
    expect(modal).not.toBeNull();
    expect(modal.style.maxWidth).toBe("480px");

    const titleEl = modal.querySelector(".modal__header h3");
    expect(titleEl.textContent).toBe("Payment Receipt: Brian Omondi");
    // Must NOT be "[object Object]"
    expect(titleEl.textContent).not.toContain("[object Object]");

    const bodyEl = modal.querySelector("#receipt-content");
    expect(bodyEl).not.toBeNull();
    expect(bodyEl.textContent).toBe("Receipt Card");

    close();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("supports config object with content alias and action buttons ({ title, content, actions })", async () => {
    const contentNode = el("div", { id: "workload-content" }, "Workload Table");
    const exportSpy = vi.fn();

    const close = openModal({
      title: "Faculty Workload & Lesson Distribution",
      content: contentNode,
      actions: [
        {
          label: "Export Excel (.xlsx)",
          variant: "ghost",
          onClick: exportSpy,
        },
        {
          label: "Close",
          variant: "secondary",
        },
      ],
    });

    const modal = document.querySelector(".modal");
    expect(modal).not.toBeNull();

    const titleEl = modal.querySelector(".modal__header h3");
    expect(titleEl.textContent).toBe("Faculty Workload & Lesson Distribution");

    const contentEl = modal.querySelector("#workload-content");
    expect(contentEl).not.toBeNull();

    const footer = modal.querySelector(".modal__footer");
    expect(footer).not.toBeNull();

    const buttons = footer.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("Export Excel (.xlsx)");

    buttons[0].click();
    expect(exportSpy).toHaveBeenCalledTimes(1);

    // Modal was closed by the action button
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("closes modal when clicking the close (X) button", () => {
    const body = el("p", {}, "Dismiss me");
    openModal("Dismissable Modal", body);

    const closeBtn = document.querySelector(".modal__close");
    expect(closeBtn).not.toBeNull();

    closeBtn.click();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });

  it("closes modal when clicking the backdrop", () => {
    const body = el("p", {}, "Backdrop test");
    openModal("Backdrop Modal", body);

    const backdrop = document.querySelector(".modal-backdrop");
    expect(backdrop).not.toBeNull();

    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });
});
