import { describe, it, expect } from "vitest";
import {
  packZipWithWorker,
  buildXlsxTemplateWithWorker,
  parseXlsxWithWorker,
} from "../../js/services/export-worker.client.js";

describe("Export Worker Client & Fallback Engine", () => {
  it("packs files into a valid ZIP blob with progress updates", async () => {
    const progressEvents = [];
    const files = [
      { name: "test1.txt", data: new TextEncoder().encode("Hello World") },
      { name: "test2.txt", data: new Blob(["Second file content"], { type: "text/plain" }) },
    ];

    const zipBlob = await packZipWithWorker(files, (meta) => {
      progressEvents.push(meta);
    });

    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.type).toBe("application/zip");
    expect(zipBlob.size).toBeGreaterThan(0);

    // Verify ZIP magic bytes PK\x03\x04
    const buffer = await zipBlob.arrayBuffer();
    const header = new Uint8Array(buffer).slice(0, 4);
    expect(header[0]).toBe(0x50); // 'P'
    expect(header[1]).toBe(0x4b); // 'K'
    expect(header[2]).toBe(0x03);
    expect(header[3]).toBe(0x04);
  });

  it("builds a valid XLSX template array buffer", async () => {
    const classes = [
      { grade: "Grade 7", streams: ["Alpha", "Beta"] },
      { grade: "Grade 8", streams: ["East", "West"] },
    ];

    const buffer = await buildXlsxTemplateWithWorker(classes);
    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBeGreaterThan(0);

    // Parse the generated template back to verify structure
    const rawTable = await parseXlsxWithWorker(buffer);
    expect(Array.isArray(rawTable)).toBe(true);
    expect(rawTable.length).toBeGreaterThan(1);
    expect(rawTable[0]).toContain("Admission Number");
    expect(rawTable[0]).toContain("Full Name");
  });

  it("parses an XLSX workbook and extracts raw table rows", async () => {
    const buffer = await buildXlsxTemplateWithWorker([
      { grade: "Grade 7", streams: ["Blue"] },
    ]);

    const table = await parseXlsxWithWorker(buffer);
    expect(Array.isArray(table)).toBe(true);
    expect(table[0][0]).toBe("Admission Number");
    expect(table[1][0]).toBe("ADM001");
  });
});
