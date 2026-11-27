// ==========================================================================
// Export Web Worker - Offloads heavy ZIP compression and XLSX processing
// from the main UI thread so progress animations and interactions stay 60fps.
// ==========================================================================

let jszipPromise = null;
function getJSZip() {
  if (!jszipPromise) {
    jszipPromise = import("jszip").then((m) => m.default || m);
  }
  return jszipPromise;
}

let xlsxPromise = null;
function getXlsx() {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx/xlsx.mjs").then((m) => m.default || m);
  }
  return xlsxPromise;
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  if (!id || !type) return;

  try {
    switch (type) {
      case "ZIP_FILES": {
        const { files, compression = "STORE" } = payload; // files: Array<{ name: string, data: ArrayBuffer }>
        const JSZip = await getJSZip();
        const zip = new JSZip();

        for (const file of files) {
          zip.file(file.name, file.data);
        }

        const buffer = await zip.generateAsync(
          {
            type: "arraybuffer",
            compression,
          },
          (metadata) => {
            self.postMessage({
              id,
              type: "PROGRESS",
              percent: metadata.percent,
              currentFile: metadata.currentFile,
            });
          }
        );

        // Transfer the resulting ArrayBuffer with zero-copy
        self.postMessage(
          { id, type: "SUCCESS", buffer },
          [buffer]
        );
        break;
      }

      case "BUILD_XLSX_TEMPLATE": {
        const { classes = [] } = payload;
        const XLSX = await getXlsx();
        const wb = XLSX.utils.book_new();

        const headers = [
          "Admission Number",
          "Full Name",
          "Gender (Male/Female)",
          "Grade",
          "Stream",
          "Date of Birth (YYYY-MM-DD)",
          "Assessment Number",
        ];

        const rows = [
          headers,
          ["ADM001", "Jane Mwangi", "Female", "Grade 7", "Red", "2012-04-15", "123456789"],
          ["ADM002", "David Otieno", "Male", "Grade 7", "Blue", "2011-11-20", "987654321"],
          ["ADM003", "Amina Hassan", "Female", "Grade 8", "Green", "2010-08-05", ""],
        ];

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [
          { wch: 18 },
          { wch: 25 },
          { wch: 22 },
          { wch: 12 },
          { wch: 12 },
          { wch: 25 },
          { wch: 20 },
        ];
        XLSX.utils.book_append_sheet(wb, ws, "Students");

        const guideRows = [
          ["Valid Grades & Streams Guide (Configured in Settings)"],
          ["Grade", "Configured Streams"],
        ];
        for (const c of classes) {
          guideRows.push([c.grade, (c.streams || []).join(", ") || "(No streams)"]);
        }
        if (!classes.length) {
          guideRows.push(["Grade 7", "Red, Blue, Green"]);
          guideRows.push(["Grade 8", "Red, Blue, Green"]);
          guideRows.push(["Grade 9", "Red, Blue, Green"]);
        }
        const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
        wsGuide["!cols"] = [{ wch: 15 }, { wch: 35 }];
        XLSX.utils.book_append_sheet(wb, wsGuide, "Classes & Streams Guide");

        const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        const arrayBuffer = out.buffer ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) : out;
        self.postMessage({ id, type: "SUCCESS", buffer: arrayBuffer }, [arrayBuffer]);
        break;
      }

      case "PARSE_XLSX": {
        const { buffer } = payload;
        const XLSX = await getXlsx();
        const wb = XLSX.read(buffer, { type: "array", cellDates: true });
        if (!wb.SheetNames || !wb.SheetNames.length) {
          throw new Error("The Excel file has no worksheets.");
        }
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rawTable = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        self.postMessage({ id, type: "SUCCESS", rawTable });
        break;
      }

      default:
        throw new Error(`Unknown worker task type: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, type: "ERROR", error: err.message || String(err) });
  }
};
