import { el, icon } from "../utils.js";
import { openModal } from "./modal.js";

export function recordField(label, control) {
  return el("div", { class: "field" }, [el("label", { for: control.id }, label), control]);
}

export function recordEmpty(symbol, title, description, action) {
  return el("div", { class: "records-empty" }, [
    icon(symbol, { "aria-hidden": "true" }),
    el("div", {}, [el("h3", {}, title), el("p", {}, description), action]),
  ]);
}

export function caseStatus(isOpen) {
  return el("span", { class: `records-status records-status--${isOpen ? "open" : "resolved"}` }, [
    icon(isOpen ? "schedule" : "check_circle", { "aria-hidden": "true" }),
    isOpen ? "Open" : "Resolved",
  ]);
}

export function caseStatusFilter(onChange) {
  const group = el("div", { class: "records-segmented", role: "group", "aria-label": "Filter by status" });
  const options = [["all", "All"], ["open", "Open"], ["resolved", "Resolved"]];
  const buttons = options.map(([id]) => el("button", { type: "button", onClick: () => onChange(id) }));
  group.append(...buttons);
  return {
    group,
    update(active, counts) {
      options.forEach(([id, label], index) => {
        const button = buttons[index];
        button.setAttribute("aria-pressed", String(id === active));
        button.textContent = `${label} (${counts[id]})`;
      });
    },
  };
}

export function openRecordModal(title, body, initialFocus) {
  const trigger = document.activeElement;
  const close = openModal({ title, body, extraClass: "records-dialog", onClose: () => trigger?.focus() });
  const dialog = body.parentElement;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll("button, a[href], input, select, textarea, summary")]
      .filter((control) => !control.disabled && control.offsetParent !== null);
    const first = controls.at(0);
    const last = controls.at(-1);
    if (!first || document.activeElement !== (event.shiftKey ? first : last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  });
  (initialFocus || dialog.querySelector(".modal__close")).focus();
  return close;
}
