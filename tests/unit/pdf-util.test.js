import { describe, it, expect, vi } from "vitest";

// Mock html2canvas — Happy-DOM cannot run real DOM-to-canvas rendering.
// Returns a realistic canvas stub (840px-wide report card at scale 2).
vi.mock("html2canvas", () => ({
  default: vi.fn(async (_node, _options) => ({
    width: 1680,
    height: 2400,
    getContext: () => ({ drawImage: vi.fn() }),
    toDataURL: (_type, _quality) =>
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAAAAAAAAAAAAAAAAAAA/9k=",
  })),
}));

import { renderElementToPdfBlob, prewarmPdfLibs } from "../../js/services/pdf.util.js";

describe("PDF Utility (pdf.util.js)", () => {
  it("exports renderElementToPdfBlob and prewarmPdfLibs functions", () => {
    expect(typeof renderElementToPdfBlob).toBe("function");
    expect(typeof prewarmPdfLibs).toBe("function");
  });

  it("fires status events in order: loading_libs -> rendering_canvas -> building_pdf", async () => {
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

  it("generates a valid PDF blob with a %PDF- header for report cards", async () => {
    const node = document.createElement("div");
    node.className = "report-card";
    node.innerHTML = "<h1>Report</h1><p>Student B</p>";

    const blob = await renderElementToPdfBlob(node, { scale: 2 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    const arr = new Uint8Array(await blob.arrayBuffer());
    const header = String.fromCharCode(...arr.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("generates a compact custom-size PDF blob for receipt elements", async () => {
    const node = document.createElement("div");
    node.className = "receipt";
    node.innerHTML = "<p>KES 5,000</p>";

    const blob = await renderElementToPdfBlob(node, { scale: 1 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
  });
});
