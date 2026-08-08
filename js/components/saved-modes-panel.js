import { REPORT_MODES, reportModeLabel } from "../services/grading.service.js";
import { el, formatDateTime } from "../utils.js";

// savedModes: result of listSavedModesForPeriod() - one entry per mode that
// has at least one saved student, e.g. [{ reportMode, count, classSize,
// latestComputedAt, computedBy }].
// options.activeMode: which mode to visually highlight (usually the mode
// currently selected in the page's picker).
// options.onSelect(mode): if given, saved chips become clickable and call
// this with the chosen mode; chips for modes with nothing saved stay inert.
export function savedModesPanel(savedModes, { activeMode, onSelect } = {}) {
  const byMode = Object.fromEntries((savedModes || []).map((m) => [m.reportMode, m]));

  const chips = el("div", { class: "saved-modes-panel__chips" });
  for (const mode of REPORT_MODES) {
    const saved = byMode[mode];
    const isActive = mode === activeMode;
    const classes = [
      "saved-mode-chip",
      saved ? "saved-mode-chip--saved" : "saved-mode-chip--empty",
      isActive ? "saved-mode-chip--active" : "",
    ].filter(Boolean).join(" ");

    const label = el("span", {}, [
      el("strong", {}, reportModeLabel(mode)),
      el("span", { class: "saved-mode-chip__meta" }, saved
        ? `${saved.count} student${saved.count === 1 ? "" : "s"} · ${formatDateTime(saved.latestComputedAt)}`
        : "not saved yet"),
    ]);

    const chip = el("button", {
      type: "button",
      class: classes,
      ...(saved && onSelect ? { onClick: () => onSelect(mode) } : { disabled: "true" }),
    }, [
      el("span", { class: "material-symbols-rounded" }, saved ? "check_circle" : "radio_button_unchecked"),
      label,
    ]);
    chips.append(chip);
  }

  return el("div", { class: "saved-modes-panel" }, [
    el("div", { class: "saved-modes-panel__title" }, "Saved so far"),
    chips,
  ]);
}
