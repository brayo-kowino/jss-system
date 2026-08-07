// ==========================================================================
// System Tour - a lightweight, dependency-free walkthrough that spotlights
// real UI elements (via [data-tour="..."] hooks) and explains what they do.
//
// Usage:
//   import { startTour } from "./components/tour.js";
//   startTour(steps, { onClose });
//
// `steps` is an ordered array of { target, title, body }, where `target` is
// a CSS selector. Steps whose target isn't in the DOM (e.g. a nav link the
// current role can't see) are skipped automatically, so one step list can
// safely cover every role - see js/tour-steps.js for the full definition.
// ==========================================================================
import { el, icon } from "../utils.js";

// Scroll is instant ("auto"), so a short settle delay is enough before we
// measure the target's final position and place the spotlight/card.
const SCROLL_SETTLE_MS = 30;

let activeTour = null; // internal state for the tour currently on screen, if any

export function isTourActive() {
  return !!activeTour;
}

/**
 * Starts a guided tour.
 * @param {{target:string, title:string, body:string}[]} steps
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
  };

  activeTour.onKeydown = (e) => {
    if (e.key === "Escape") closeTour(false);
    else if (e.key === "ArrowRight" || e.key === "Enter") advance(1);
    else if (e.key === "ArrowLeft") advance(-1);
  };
  activeTour.onResize = () => renderStep();
  window.addEventListener("keydown", activeTour.onKeydown);
  window.addEventListener("resize", activeTour.onResize);

  // Clicking the dimmed backdrop exits the tour, matching this app's
  // existing modal-backdrop convention (click outside == close).
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTour(false);
  });

  renderStep();
  return true;
}

export function closeTour(finished = false) {
  if (!activeTour) return;
  const { overlay, onClose, onKeydown, onResize } = activeTour;
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onResize);
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

function renderStep() {
  if (!activeTour) return;
  const { steps, index, spotlight, card } = activeTour;
  let step = steps[index];

  // A target can disappear between steps (e.g. a collapsed nav group, or a
  // role-conditional element). Skip forward past anything that's gone.
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
  target.scrollIntoView({ block: "nearest", behavior: "auto" });

  // Let layout/scroll settle before measuring, so the spotlight lands on
  // the element's final position rather than a mid-scroll one.
  setTimeout(() => placeStep(target, step), SCROLL_SETTLE_MS);
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
  card.append(
    el("div", { class: "tour-card__eyebrow" }, [
      icon("map"),
      el("span", {}, `Step ${index + 1} of ${steps.length}`),
    ]),
    el("h3", { class: "tour-card__title" }, step.title),
    el("p", { class: "tour-card__body" }, step.body),
    el("div", { class: "tour-card__dots" }, steps.map((_, i) =>
      el("span", { class: `tour-card__dot${i === index ? " tour-card__dot--active" : ""}` })
    )),
    el("div", { class: "tour-card__actions" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => closeTour(false) }, "Skip tour"),
      el("div", { class: "tour-card__nav" }, [
        ...(index > 0
          ? [el("button", { class: "btn btn--ghost btn--sm", onClick: () => advance(-1) }, "Back")]
          : []),
        el(
          "button",
          { class: "btn btn--primary btn--sm", onClick: () => advance(1) },
          index === steps.length - 1 ? "Done" : "Next"
        ),
      ]),
    ])
  );

  // Position the card in whichever direction has room, then clamp it to
  // stay fully inside the viewport with a small margin.
  const margin = 12;
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
