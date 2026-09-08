import { describe, it, expect, vi } from "vitest";

vi.mock("html2canvas", () => ({
  default: vi.fn(async (_node, _options) => {
    const canvas = {
      width: 840,
      height: 1200,
      toDataURL: (_type, _quality) =>
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    };
    return canvas;
  }),
}));

import { renderElementToPdfBlob, prewarmPdfLibs } from "../../js/services/pdf.util.js";

describe("PDF Utility (pdf.util.js)", () => {
  it("exports renderElementToPdfBlob and prewarmPdfLibs functions", () => {
    expect(typeof renderElementToPdfBlob).toBe("function");
    expect(typeof prewarmPdfLibs).toBe("function");
  });

  it("fires status events in order and returns a valid PDF blob (JPEG FAST path)", async () => {
    const statuses = [];
    const node = document.createElement("div");
    node.className = "report-card";
    node.innerHTML = "<h1>Report</h1><p>Student A</p>";

    const blob = await renderElementToPdfBlob(node, {
      scale: 2,
      onStatus: (s) => statuses.push(s),
    });

    expect(statuses).toEqual(["loading_libs", "rendering_canvas", "building_pdf"]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
  });

  it("handles receipt nodes (isReceipt=true) and returns a PDF blob", async () => {
    const node = document.createElement("div");
    node.className = "receipt";
    node.innerHTML = "<p>KES 5,000</p>";

    const blob = await renderElementToPdfBlob(node, { scale: 1 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
  });
});
