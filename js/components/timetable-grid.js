import { el, icon } from "../utils.js";

export function renderTimetableChart(grid, letterhead, { onEdit } = {}) {
  const master = grid.kind === "master";
  const minimumWidth = grid.columns.reduce((width, period) => width + (period.isBreak ? 68 : 103), master ? 159 : 88);
  const heading = el("header", { class: "tt-chart-letterhead" }, [
    letterhead.logo ? el("img", { src: letterhead.logo, alt: "", class: "tt-chart-logo" }) : null,
    el("strong", { class: "tt-chart-school" }, letterhead.school),
    letterhead.contact ? el("span", {}, letterhead.contact) : null,
    letterhead.motto ? el("em", {}, letterhead.motto) : null,
    el("h2", {}, letterhead.title),
    letterhead.subtitle ? el("strong", {}, letterhead.subtitle) : null,
    letterhead.term ? el("span", {}, letterhead.term) : null,
  ]);
  const table = el("table", {
    class: `tt-chart-table tt-chart-table--${grid.kind}`,
    style: `--tt-chart-min-width:${minimumWidth}px`,
    "aria-label": [letterhead.title, letterhead.subtitle].filter(Boolean).join(" "),
  }, [
    el("colgroup", {}, [
      el("col", { class: "tt-chart-day-col" }),
      master ? el("col", { class: "tt-chart-class-col" }) : null,
      ...grid.columns.map((period) => el("col", { class: period.isBreak ? "tt-chart-break-col" : "tt-chart-period-col" })),
    ]),
    el("thead", {}, el("tr", {}, [
      el("th", { class: "tt-chart-day", scope: "col" }, "Day"),
      master ? el("th", { class: "tt-chart-class", scope: "col" }, "Class / Stream") : null,
      ...grid.columns.map((period) => el("th", { scope: "col", class: period.isBreak ? "tt-chart-break" : "" }, [
        el("strong", {}, period.time),
        el("small", {}, period.name),
      ])),
    ])),
  ]);

  for (const { day, rows } of grid.groups) {
    table.append(el("tbody", {}, rows.map((row, index) => {
      const rowNode = el("tr");
      if (index === 0) {
        rowNode.append(el("th", {
          scope: "rowgroup", rowspan: rows.length, class: "tt-chart-day", title: day,
        }, master ? day.slice(0, 3).toUpperCase() : day));
      }
      if (master) rowNode.append(el("th", { scope: "row", class: "tt-chart-class" }, row.label));
      const cellsByIndex = new Map(row.cells.map((cell) => [cell.index, cell]));
      grid.columns.forEach((period, column) => {
        if (period.isBreak && index === 0) {
          rowNode.append(el("td", { rowspan: rows.length, class: "tt-chart-break" }, period.name));
        }
        const cell = cellsByIndex.get(column);
        if (!cell) return;
        const content = cell.slot ? [
          el("strong", {}, cell.title),
          cell.detail ? el("small", { class: cell.isUnstaffed ? "tt-chart-unstaffed" : "" }, cell.detail) : null,
          cell.conflict ? el("small", { class: "tt-chart-unstaffed" }, "Booking conflict") : null,
        ] : [cell.empty ? el("small", { class: "tt-chart-free" }, cell.empty) : null];
        const timeLabel = cell.colspan === 2 ? `${period.startTime} - ${grid.columns[column + 1].endTime}` : period.time;
        const description = [day, row.label, timeLabel, cell.title || "Assign lesson", cell.detail,
          cell.colspan === 2 ? "Double lesson" : "", cell.conflict ? "Booking conflict" : ""].filter(Boolean).join(", ");
        const child = onEdit ? el("button", {
          type: "button", class: `tt-chart-cell-button${cell.slot ? "" : " tt-chart-cell-button--empty"}`,
          title: description, onClick: () => onEdit(day, period, cell.slot, row.cohort),
        }, cell.slot ? content : [icon("add", "text-xs"), el("span", { class: "sr-only" }, description)]) : content;
        rowNode.append(el("td", {
          colspan: cell.colspan, class: "tt-chart-lesson",
          style: cell.fill ? `--tt-cell-fill:${cell.fill}` : undefined,
        }, el("div", { class: "tt-chart-cell" }, child)));
      });
      return rowNode;
    })));
  }
  return el("section", { class: `tt-chart tt-chart--${grid.kind}` }, [
    heading,
    el("div", { class: "tt-chart-scroll", tabindex: "0", role: "region", "aria-label": "Timetable grid. Scroll to see more periods." }, table),
  ]);
}
