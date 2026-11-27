import { el, icon } from "../utils.js";

export function workspaceResults(title, message, { symbol = "table_rows", action } = {}) {
  return el("section", { class: "workspace-results card" }, [
    el("h2", { class: "module-section-title" }, title),
    el("div", { class: "workspace-results__body" }, [
      icon(symbol, "workspace-results__icon", { "aria-hidden": "true" }),
      el("p", { role: "status" }, message),
      action,
    ]),
  ]);
}
