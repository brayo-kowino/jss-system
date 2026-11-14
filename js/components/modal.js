import { el, icon } from "../utils.js";

/**
 * Opens a modal with arbitrary content. Returns a close() function.
 * Supports both:
 *   1. openModal(title, bodyNode, extraClass = "")
 *   2. openModal({ title, body, content, extraClass, maxWidth, style, actions })
 *
 * @param {string|Object} titleOrConfig
 * @param {HTMLElement} [bodyNode]
 * @param {string} [extraClass] - e.g. "modal--wide" for a wider desktop cap.
 * @returns {Function} close function to dismiss the modal
 */
export function openModal(titleOrConfig, bodyNode, extraClass = "") {
  let title = titleOrConfig;
  let body = bodyNode;
  let cls = extraClass || "";
  let customStyle = "";
  let actions = null;

  if (titleOrConfig && typeof titleOrConfig === "object" && !(titleOrConfig instanceof HTMLElement)) {
    title = titleOrConfig.title || "";
    body = titleOrConfig.body || titleOrConfig.content || null;
    cls = titleOrConfig.extraClass || titleOrConfig.class || "";
    if (titleOrConfig.maxWidth) {
      customStyle += `max-width:${titleOrConfig.maxWidth}; width:100%;`;
    }
    if (titleOrConfig.style) {
      customStyle += titleOrConfig.style;
    }
    actions = titleOrConfig.actions || null;
  }

  const backdrop = el("div", { class: "modal-backdrop" });
  const modalAttrs = {
    class: `modal${cls ? ` ${cls}` : ""}`,
  };
  if (customStyle) {
    modalAttrs.style = customStyle;
  }
  const modal = el("div", modalAttrs);

  const header = el("div", { class: "modal__header" }, [
    el("h3", { style: "margin:0;" }, title),
    el("button", { class: "modal__close", "aria-label": "Close", onClick: close }, [icon("close")]),
  ]);
  modal.append(header);

  if (body) {
    modal.append(body);
  }

  if (Array.isArray(actions) && actions.length > 0) {
    const footer = el("div", {
      class: "modal__footer",
      style: "display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:12px; border-top:1px solid var(--color-line);",
    }, actions.map((act) => {
      const btnVariant = act.variant ? `btn--${act.variant}` : "btn--secondary";
      return el("button", {
        type: "button",
        class: `btn btn--sm ${btnVariant}`,
        onClick: (e) => {
          if (typeof act.onClick === "function") {
            const res = act.onClick(e);
            if (res && typeof res.then === "function") {
              res.then((r) => { if (r !== false) close(); });
            } else if (res !== false) {
              close();
            }
          } else {
            close();
          }
        },
      }, act.label);
    }));
    modal.append(footer);
  }

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
