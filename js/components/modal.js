import { el } from "../utils.js";

/**
 * Opens a modal with arbitrary content. Returns a close() function.
 * @param {string} title
 * @param {HTMLElement} bodyNode
 */
export function openModal(title, bodyNode) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const modal = el("div", { class: "modal" });
  const header = el("div", { class: "modal__header" }, [
    el("h3", { style: "margin:0;" }, title),
    el("button", { class: "modal__close", "aria-label": "Close", onClick: close }, "×"),
  ]);
  modal.append(header, bodyNode);
  backdrop.append(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);

  function close() {
    backdrop.remove();
  }
  return close;
}
