const MARGIN = 26;
const FOOTER = 22;

async function readLogo(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
  } catch {
    // The school name and contact details still render if the image is unavailable.
  }
  return null;
}

export async function renderTimetablePdf(grid, letterhead, { format = "a4" } = {}) {
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), readLogo(letterhead.logo)]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format, compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: `${letterhead.school} - ${letterhead.title}` });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  const bottom = pageHeight - MARGIN - FOOTER;
  const master = grid.kind === "master";
  const dayWidth = master ? 47 : 64;
  const classWidth = master ? 74 : 0;
  const baseSize = master ? 8.5 : 10;
  const weight = grid.columns.reduce((sum, p) => sum + (p.isBreak ? 0.67 : 1), 0);
  const unit = (width - dayWidth - classWidth) / Math.max(weight, 1);
  const bodySize = Math.min(baseSize, Math.max(6, unit / 7.2));
  const detailSize = bodySize - 0.8;
  const periodColumns = [];
  let columnX = MARGIN + dayWidth + classWidth;
  for (const period of grid.columns) {
    const w = unit * (period.isBreak ? 0.67 : 1);
    periodColumns.push({ ...period, x: columnX, w });
    columnX += w;
  }

  const textLines = (text, maxWidth, size, style = "normal") => {
    pdf.setFont("times", style);
    pdf.setFontSize(size);
    return text ? pdf.splitTextToSize(String(text), Math.max(4, maxWidth)) : [];
  };
  const lineHeight = (size) => size * 1.12;
  const textHeight = (entries) => entries.reduce((sum, { lines, size }) => sum + lines.length * lineHeight(size), 0);
  const line = (text, maxWidth, size, style, color = "#1d2529") => ({
    lines: textLines(text, maxWidth, size, style), size, style, color,
  });
  function textBlock(entries, x, y, w, h) {
    let top = y + (h - textHeight(entries)) / 2;
    for (const { lines, size, style, color } of entries) {
      pdf.setFont("times", style || "normal");
      pdf.setFontSize(size);
      pdf.setTextColor(color);
      for (const value of lines) {
        pdf.text(value, x + w / 2, top + size * 0.84, { align: "center" });
        top += lineHeight(size);
      }
    }
  }

  function cell(x, y, w, h, entries, fill) {
    if (fill) pdf.setFillColor(fill);
    pdf.rect(x, y, w, h, fill ? "FD" : "S");
    textBlock(entries, x, y, w, h);
  }

  const headerLabels = [
    { x: MARGIN, w: dayWidth, name: "DAY" },
    ...(master ? [{ x: MARGIN + dayWidth, w: classWidth, name: "CLASS / STREAM" }] : []),
    ...periodColumns,
  ].map((column) => ({
    ...column,
    entries: [
      line(column.time, column.w - 5, bodySize, "bold"),
      line(column.name, column.w - 5, column.time ? detailSize : bodySize, column.time ? "normal" : "bold"),
    ],
  }));
  const headerHeight = Math.max(22, ...headerLabels.map(({ entries }) => textHeight(entries) + 7));
  let hasLogo = !!logo;
  function startPage() {
    let y = MARGIN - 3;
    if (hasLogo) {
      try {
        const info = pdf.getImageProperties(logo);
        const scale = Math.min(32 / info.width, 32 / info.height);
        const logoWidth = scale * info.width;
        const logoHeight = scale * info.height;
        pdf.addImage(logo, info.fileType, (pageWidth - logoWidth) / 2, y, logoWidth, logoHeight, "school-logo", "FAST");
        y += logoHeight + 4;
      } catch {
        hasLogo = false;
      }
    }
    const header = [
      line(letterhead.school.toUpperCase(), width, 14, "bold"),
      line(letterhead.contact, width, 8, "normal"),
      line(letterhead.motto, width, 8, "italic"),
      line(letterhead.title.toUpperCase(), width, 11, "bold"),
      line(letterhead.subtitle, width, 9.5, "bold"),
      line(letterhead.term, width, 8.5, "normal"),
    ];
    const height = textHeight(header) + 4;
    textBlock(header, MARGIN, y, width, height);
    y += height + 7;
    pdf.setDrawColor("#454d51");
    pdf.setLineWidth(0.42);
    for (const column of headerLabels) {
      cell(column.x, y, column.w, headerHeight, column.entries, column.isBreak ? "#e9ecee" : "#f4f5f4");
    }
    return y + headerHeight;
  }

  let y = startPage();
  const firstRowY = y;
  function nextPage() {
    pdf.addPage(format, "landscape");
    y = startPage();
  }
  for (const { day, rows } of grid.groups) {
    const measured = rows.map((row) => {
      const label = master ? [line(row.label, classWidth - 7, bodySize, "bold")] : [];
      const cells = row.cells.map((item) => {
        const column = periodColumns[item.index];
        const w = column.w + (item.colspan === 2 ? periodColumns[item.index + 1].w : 0);
        const entries = [
          line(item.title, w - 7, bodySize, "bold"),
          line(item.detail || (!item.slot ? item.empty : ""), w - 7, detailSize, "normal",
            item.isUnstaffed ? "#a02624" : "#3d484f"),
        ];
        return { ...item, x: column.x, w, entries };
      });
      const height = Math.max(master ? 21 : 38, textHeight(label) + 7,
        ...cells.map(({ entries }) => textHeight(entries) + 7));
      return { label, cells, height };
    });
    const dayHeight = measured.reduce((sum, row) => sum + row.height, 0);
    if (dayHeight <= bottom - firstRowY && y + dayHeight > bottom) nextPage();
    for (let start = 0; start < measured.length;) {
      if (y + measured[start].height > bottom && y > firstRowY) nextPage();
      let end = start;
      let height = 0;
      while (end < measured.length && (height + measured[end].height <= bottom - y || end === start)) {
        height += measured[end++].height;
      }
      const dayText = master ? day.slice(0, 3).toUpperCase().split("").join("\n") : day;
      cell(MARGIN, y, dayWidth, height, [line(dayText, dayWidth - 6, bodySize, "bold")], "#f4f5f4");
      for (const period of periodColumns.filter((p) => p.isBreak)) {
        cell(period.x, y, period.w, height, [line(period.name, period.w - 5, detailSize, "bold")], "#e9ecee");
      }
      for (const row of measured.slice(start, end)) {
        if (master) cell(MARGIN + dayWidth, y, classWidth, row.height, row.label);
        for (const item of row.cells) cell(item.x, y, item.w, row.height, item.entries, item.fill);
        y += row.height;
      }
      pdf.setLineWidth(0.8);
      pdf.line(MARGIN, y, MARGIN + width, y);
      pdf.setLineWidth(0.42);
      start = end;
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("times", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#566166");
    pdf.text(`${page} / ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN, { align: "right" });
  }
  return pdf.output("blob");
}
