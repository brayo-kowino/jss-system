import { el } from "../js/utils.js";

export async function render({ title }) {
  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [el("div", {}, [el("h1", {}, title || "Coming soon")])]),
    el("div", { class: "card empty-state" }, [
      el("div", { class: "seal seal--lg", style: "margin:0 auto 16px;" }, "⏳"),
      el("h3", {}, `${title} is next in line`),
      el("p", {}, "This module is scaffolded in the build order but not wired up yet."),
    ])
  );
  return wrap;
}

export function init() {}
