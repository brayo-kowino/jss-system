// ==========================================================================
// System Tour - a lightweight, dependency-free walkthrough that spotlights
// real UI elements (via [data-tour="..."] hooks) and explains what they do.
//
// Usage:
//   import { startTour } from "./components/tour.js";
//   startTour(steps, { onClose });
//
// `steps` is an ordered array of { target, title, body, shortcut?, category?, icon? }.
// Steps whose target isn't in the DOM (e.g. a nav link the current role can't see)
// are skipped automatically, so one step list can safely cover every role.
// ==========================================================================
import { el, icon } from "../utils.js";

// Scroll is instant ("auto"), so a short settle delay is enough before we
// measure the target's final position and place the spotlight/card.
const SCROLL_SETTLE_MS = 40;

let activeTour = null; // internal state for the tour currently on screen, if any

export function isTourActive() {
  return !!activeTour;
}

/**
 * Starts a guided tour.
 * @param {{target:string, title:string, body:string, shortcut?:string, category?:string, icon?:string}[]} steps
 * @param {{onClose?: (finished: boolean) => void}} [opts]
 * @returns {boolean} true if a tour was actually started (i.e. at least one
 *   step's target exists in the DOM right now)
 */
export function startTour(steps, opts = {}) {
  // Never stack two tours - a fresh call replaces whatever's showing.
  if (activeTour) closeTour(false);

  const available = steps.filter((s) => document.querySelector(s.target));
  if (!available.length) return false;

  const overlay = el("div", { class: "tour-overlay" });
  const spotlight = el("div", { class: "tour-spotlight" });
  const card = el("div", { class: "tour-card", role: "dialog", "aria-live": "polite" });
  overlay.append(spotlight, card);
  document.body.append(overlay);
  document.body.classList.add("tour-open");

  activeTour = {
    steps: available,
    index: 0,
    overlay,
    spotlight,
    card,
    onClose: typeof opts.onClose === "function" ? opts.onClose : null,
    onKeydown: null,
    onResize: null,
    onScroll: null,
  };

  activeTour.onKeydown = (e) => {
    if (e.key === "Escape") closeTour(false);
    else if (e.key === "ArrowRight" || e.key === "Enter") advance(1);
    else if (e.key === "ArrowLeft") advance(-1);
  };
  activeTour.onResize = () => renderStep();
  activeTour.onScroll = () => updateSpotlightPosition();

  window.addEventListener("keydown", activeTour.onKeydown);
  window.addEventListener("resize", activeTour.onResize);
  window.addEventListener("scroll", activeTour.onScroll, { passive: true });

  // Clicking the dimmed backdrop exits the tour, matching this app's modal convention
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTour(false);
  });

  renderStep();
  return true;
}

export function closeTour(finished = false) {
  if (!activeTour) return;
  const { overlay, onClose, onKeydown, onResize, onScroll } = activeTour;
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onResize);
  if (onScroll) window.removeEventListener("scroll", onScroll);
  overlay.remove();
  document.body.classList.remove("tour-open");
  activeTour = null;
  onClose?.(finished);
}

function advance(delta) {
  if (!activeTour) return;
  const next = activeTour.index + delta;
  if (next < 0) return;
  if (next >= activeTour.steps.length) {
    closeTour(true);
    return;
  }
  activeTour.index = next;
  renderStep();
}

function updateSpotlightPosition() {
  if (!activeTour) return;
  const { steps, index, spotlight } = activeTour;
  const step = steps[index];
  if (!step) return;
  const target = document.querySelector(step.target);
  if (!target) return;

  const PAD = 8;
  const rect = target.getBoundingClientRect();
  spotlight.style.top = `${rect.top - PAD}px`;
  spotlight.style.left = `${rect.left - PAD}px`;
  spotlight.style.width = `${rect.width + PAD * 2}px`;
  spotlight.style.height = `${rect.height + PAD * 2}px`;
}

function renderStep() {
  if (!activeTour) return;
  const { steps, index } = activeTour;
  let step = steps[index];

  // A target can disappear between steps (e.g. dynamic role changes)
  while (step && !document.querySelector(step.target)) {
    activeTour.index += 1;
    if (activeTour.index >= steps.length) {
      closeTour(true);
      return;
    }
    step = steps[activeTour.index];
  }
  if (!step) return;

  const target = document.querySelector(step.target);

  // If target is inside a collapsed nav-group, automatically expand that group so the target is fully visible
  const parentGroup = target.closest(".nav-group");
  if (parentGroup && parentGroup.classList.contains("nav-group--collapsed")) {
    parentGroup.classList.remove("nav-group--collapsed");
    const chevron = parentGroup.querySelector(".nav-group__chevron");
    if (chevron) chevron.classList.remove("nav-group__chevron--collapsed");
  }

  target.scrollIntoView({ block: "nearest", behavior: "auto" });

  placeStep(target, step);
  // Let layout/scroll settle before updating final spotlight coordinates
  setTimeout(() => updateSpotlightPosition(), SCROLL_SETTLE_MS);
}

function placeStep(target, step) {
  if (!activeTour) return;
  const { spotlight, card, index, steps } = activeTour;
  const PAD = 8;
  const rect = target.getBoundingClientRect();

  spotlight.style.top = `${rect.top - PAD}px`;
  spotlight.style.left = `${rect.left - PAD}px`;
  spotlight.style.width = `${rect.width + PAD * 2}px`;
  spotlight.style.height = `${rect.height + PAD * 2}px`;

  card.innerHTML = "";

  const percent = Math.round(((index + 1) / steps.length) * 100);

  const eyebrowEl = el("div", { class: "tour-card__eyebrow" }, [
    el("div", { class: "tour-card__eyebrow-left" }, [
      icon(step.icon || "explore", "tour-card__eyebrow-icon"),
      el("span", { class: "tour-card__category" }, step.category || "Tour Guide"),
    ]),
    el("div", { class: "tour-card__eyebrow-right" }, [
      el("span", { class: "tour-card__step-counter" }, `${index + 1} of ${steps.length}`),
      el(
        "button",
        {
          type: "button",
          class: "tour-card__close-btn",
          "aria-label": "Close tour",
          title: "Close tour (ESC)",
          onClick: () => closeTour(false),
        },
        [icon("close", "tour-card__close-icon")]
      ),
    ]),
  ]);

  const titleRow = el("div", { class: "tour-card__title-row" }, [
    el("h3", { class: "tour-card__title" }, step.title),
    step.shortcut
      ? el("span", { class: "tour-card__shortcut", title: `Shortcut: ${step.shortcut}` }, [
          el("kbd", {}, step.shortcut.replace("+", " + ")),
        ])
      : "",
  ]);

  const bodyEl = el("p", { class: "tour-card__body" }, step.body);

  const progressWrap = el("div", { class: "tour-card__progress-wrap" }, [
    el("div", { class: "tour-card__progress-bar" }, [
      el("div", { class: "tour-card__progress-fill", style: `width: ${percent}%;` }),
    ]),
  ]);

  const actionsEl = el("div", { class: "tour-card__actions" }, [
    el("button", { class: "btn btn--ghost btn--sm tour-card__skip", onClick: () => closeTour(false) }, "Skip tour"),
    el("div", { class: "tour-card__nav" }, [
      ...(index > 0
        ? [el("button", { class: "btn btn--ghost btn--sm", onClick: () => advance(-1) }, "Back")]
        : []),
      el(
        "button",
        { class: "btn btn--primary btn--sm tour-card__next-btn", onClick: () => advance(1) },
        [
          index === steps.length - 1 ? "Finish tour" : "Next",
          icon(index === steps.length - 1 ? "check" : "arrow_forward", "btn-icon-xs"),
        ]
      ),
    ]),
  ]);

  card.append(eyebrowEl, titleRow, bodyEl, progressWrap, actionsEl);

  // Position the card in whichever direction has room, then clamp it to
  // stay fully inside the viewport with a margin.
  const margin = 14;
  card.style.top = "-9999px";
  card.style.left = "-9999px";
  card.style.visibility = "hidden";
  card.style.display = "block";

  requestAnimationFrame(() => {
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceRight = window.innerWidth - rect.right;

    let top, left;
    if (spaceBelow >= ch + margin * 2) {
      top = rect.bottom + margin;
      left = rect.left;
    } else if (spaceRight >= cw + margin * 2) {
      top = rect.top;
      left = rect.right + margin;
    } else if (rect.top >= ch + margin * 2) {
      top = rect.top - ch - margin;
      left = rect.left;
    } else {
      top = rect.left < window.innerWidth / 2 ? rect.top : margin;
      left = rect.right + margin <= window.innerWidth - margin ? rect.right + margin : margin;
    }

    top = Math.min(Math.max(top, margin), window.innerHeight - ch - margin);
    left = Math.min(Math.max(left, margin), window.innerWidth - cw - margin);

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
    card.style.visibility = "visible";
  });
}
