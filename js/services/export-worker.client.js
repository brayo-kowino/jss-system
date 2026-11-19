// ==========================================================================
// Export Worker Client - Manages Web Worker pool with automatic main-thread
// fallback when Web Workers are unavailable, disabled, or in test environments.
// ==========================================================================

let workerInstance = null;
let msgId = 0;
const pendingCallbacks = new Map();

function isWorkerSupported() {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    !window.process?.env?.VITEST
  );
}

function getWorker() {
  if (!isWorkerSupported()) return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL("../workers/export.worker.js", import.meta.url),
        { type: "module" }
      );
      workerInstance.onmessage = (e) => {
        const { id, type, buffer, rawTable, error, percent, currentFile } = e.data || {};
        const callbacks = pendingCallbacks.get(id);
        if (!callbacks) return;

        if (type === "PROGRESS") {
          callbacks.onProgress?.({ percent, currentFile });
        } else if (type === "SUCCESS") {
          pendingCallbacks.delete(id);
          callbacks.resolve({ buffer, rawTable });
        } else if (type === "ERROR") {
          pendingCallbacks.delete(id);
          callbacks.reject(new Error(error || "Worker operation failed"));
        }
      };
      workerInstance.onerror = (err) => {
        console.warn("Export worker error, will fall back to main thread:", err);
      };
    } catch (err) {
      console.warn("Failed to instantiate Export worker, falling back:", err);
      workerInstance = null;
    }
  }
  return workerInstance;
}

/**
 * Packs multiple files into a single ZIP Blob.
 * Uses Web Worker if available, falling back to JSZip on the main thread.
 *
 * @param {Array<{ name: string, data: ArrayBuffer | Uint8Array | Blob }>} files
 * @param {Function} [onProgress] - callback({ percent, currentFile })
 * @returns {Promise<Blob>}
 */
export async function packZipWithWorker(files, onProgress) {
  const worker = getWorker();
  if (worker) {
    try {
      const serializableFiles = await Promise.all(
        files.map(async (f) => {
          let data = f.data;
          if (data instanceof Blob) {
            data = await data.arrayBuffer();
          } else if (data.buffer && data.byteLength) {
            data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          }
          return { name: f.name, data };
        })
      );

      const transferables = serializableFiles.map((f) => f.data);
      const id = ++msgId;

      return await new Promise((resolve, reject) => {
        pendingCallbacks.set(id, {
          resolve: ({ buffer }) => resolve(new Blob([buffer], { type: "application/zip" })),
          reject,
          onProgress,
        });

        worker.postMessage(
          {
            id,
            type: "ZIP_FILES",
            payload: { files: serializableFiles, compression: "STORE" },
          },
          transferables
        );
      });
    } catch (err) {
      console.warn("Worker zip packing failed, falling back to main thread:", err);
    }
  }

  // Main thread fallback
  const JSZip = await import("jszip").then((m) => m.default || m);
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.name, f.data);
  }
  return await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    (meta) => onProgress?.({ percent: meta.percent, currentFile: meta.currentFile })
  );
}

/**
 * Generates an XLSX starter template.
 * Uses Web Worker if available, falling back to main-thread XLSX.
 *
 * @param {Array<{ grade: string, streams: string[] }>} [classes]
 * @returns {Promise<ArrayBuffer>}
 */
export async function buildXlsxTemplateWithWorker(classes = []) {
  const worker = getWorker();
  if (worker) {
    try {
      const id = ++msgId;
      const res = await new Promise((resolve, reject) => {
        pendingCallbacks.set(id, {
          resolve,
          reject,
        });
        worker.postMessage({
          id,
          type: "BUILD_XLSX_TEMPLATE",
          payload: { classes },
        });
      });
      return res.buffer;
    } catch (err) {
      console.warn("Worker template generation failed, falling back to main thread:", err);
    }
  }

  // Main thread fallback
  const XLSX = await import("xlsx/xlsx.mjs").then((m) => m.default || m);
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
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  const guideRows = [
    ["Valid Grades & Streams Guide (Configured in Settings)"],
    ["Grade", "Configured Streams"],
  ];
  for (const c of classes) {
    guideRows.push([c.grade, (c.streams || []).join(", ") || "(No streams)"]);
  }
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  XLSX.utils.book_append_sheet(wb, wsGuide, "Classes & Streams Guide");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/**
 * Parses an XLSX workbook in the worker.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<any>>}
 */
export async function parseXlsxWithWorker(buffer) {
  const worker = getWorker();
  if (worker) {
    try {
      const id = ++msgId;
      const res = await new Promise((resolve, reject) => {
        pendingCallbacks.set(id, {
          resolve,
          reject,
        });
        const transferBuffer = buffer.slice ? buffer.slice(0) : buffer;
        worker.postMessage({ id, type: "PARSE_XLSX", payload: { buffer: transferBuffer } }, [transferBuffer]);
      });
      return res.rawTable;
    } catch (err) {
      console.warn("Worker XLSX parse failed, falling back to main thread:", err);
    }
  }

  // Main thread fallback
  const XLSX = await import("xlsx/xlsx.mjs").then((m) => m.default || m);
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!wb.SheetNames || !wb.SheetNames.length) {
    throw new Error("The Excel file has no worksheets.");
  }
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}
