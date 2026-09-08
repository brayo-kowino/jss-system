let libsPromise = null;

function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
  }
  return libsPromise;
}

export function prewarmPdfLibs() {
  if (typeof window === "undefined") return;
  const schedule = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback : (cb) => setTimeout(cb, 500);
  schedule(() => {
    loadLibs().catch(() => {});
  });
}

let zipLibPromise = null;
function loadZipLib() {
  if (!zipLibPromise) {
    zipLibPromise = import("jszip").then((m) => m.default || m);
  }
  return zipLibPromise;
}

function yieldToMain(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Renders one DOM node to a PDF Blob. Uses hardware-accelerated JPEG encoding
// and A4 page layout to deliver a clean, printable PDF without UI freeze.
//
// Scale 1.5 (~150 DPI) keeps output sharp for professional printing while
// cutting canvas pixel count by ~44% compared to scale 2, roughly halving
// html2canvas rendering time.
//
// Report cards are generated in standard A4 portrait format so they print
// correctly on any printer without white gaps. Receipts keep a compact custom
// page size since they are short slips not printed on full A4 sheets.
export async function renderElementToPdfBlob(node, { scale = 1.5, imageTimeout = 3000, onStatus } = {}) {
  onStatus?.("loading_libs");
  await yieldToMain(20);
  const [{ default: html2canvas }, { jsPDF }] = await loadLibs();

  onStatus?.("rendering_canvas");
  await yieldToMain(30);

  const isReceipt = node.classList?.contains("receipt");
  const targetWidth = isReceipt ? 440 : 840;

  const canvas = await html2canvas(node, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: false,
    imageTimeout,
    logging: false,
    // .no-print elements (Save Remarks button, Back/Print/Download bar,
    // etc.) are only hidden via a @media print rule, which html2canvas
    // doesn't apply since it renders the live on-screen DOM - so they'd
    // otherwise show up baked into the downloaded PDF. Skip them here too.
    ignoreElements: (el) => el.classList?.contains("no-print"),
    onclone: (clonedDoc, clonedElement) => {
      // 1. Force a clean, unconstrained print width so tables never wrap or clip
      clonedElement.style.width = `${targetWidth}px`;
      clonedElement.style.maxWidth = `${targetWidth}px`;
      clonedElement.style.minWidth = `${targetWidth}px`;
      clonedElement.style.boxShadow = "none";
      clonedElement.style.margin = "0";
      clonedElement.style.padding = isReceipt ? "16px" : "24px";
      clonedElement.style.transform = "none";

      // 2. Expand all table containers to be fully visible (no horizontal scrollbar clipping)
      const wraps = clonedElement.querySelectorAll(".table-wrap, table, .report-card__student, .report-card__header");
      wraps.forEach((el) => {
        el.style.overflow = "visible";
        el.style.maxWidth = "none";
        el.style.width = "100%";
      });

      // 3. Ensure all textareas display their full content as readable text
      const textareas = clonedElement.querySelectorAll("textarea");
      textareas.forEach((ta) => {
        const div = clonedDoc.createElement("div");
        div.className = ta.className;
        div.style.cssText = ta.style.cssText;
        div.style.minHeight = "48px";
        div.style.whiteSpace = "pre-wrap";
        div.style.wordBreak = "break-word";
        div.textContent = ta.value || ta.placeholder || "";
        ta.parentNode.replaceChild(div, ta);
      });

      // 4. Mark all images as crossOrigin so html2canvas can draw Firebase
      //    Storage photos (logo, student photo) without tainting the canvas
      //    or triggering a redundant re-fetch on cache mismatch.
      clonedElement.querySelectorAll("img").forEach((img) => {
        img.crossOrigin = "anonymous";
      });
    },
  });


  onStatus?.("building_pdf");
  await yieldToMain(20);
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  // Standard PDF sizing in points (1px at 96 DPI = 0.75 pt at 72 DPI)
  const rawWidthPt = (canvas.width / scale) * 0.75;
  const rawHeightPt = (canvas.height / scale) * 0.75;

  // ── Receipts: compact custom page (short slip, not printed on A4) ─────────
  if (isReceipt) {
    const pdf = new jsPDF({ unit: "pt", format: [rawWidthPt, rawHeightPt], compress: true });
    pdf.addImage(imgData, "JPEG", 0, 0, rawWidthPt, rawHeightPt, undefined, "FAST");
    return pdf.output("blob");
  }

  // ── Report cards: single A4 portrait page, content scaled to fit ──────────
  // Scale content to fit within A4 with equal 18pt margins on all four sides.
  // Both width AND height are constrained so the card always fits on one page,
  // and the result is centred on the sheet so it looks balanced when printed.
  const A4_W = 595.28;  // pt
  const A4_H = 841.89;  // pt
  const MARGIN = 18;    // pt — margin on every side

  const contentW = A4_W - MARGIN * 2;
  const contentH = A4_H - MARGIN * 2;

  // Choose the smaller of width-fit and height-fit ratios so content never overflows
  const ratio = Math.min(contentW / rawWidthPt, contentH / rawHeightPt);
  const scaledW = rawWidthPt * ratio;
  const scaledH = rawHeightPt * ratio;

  // Centre within the content area
  const xOffset = MARGIN + (contentW - scaledW) / 2;
  const yOffset = MARGIN + (contentH - scaledH) / 2;

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  pdf.addImage(imgData, "JPEG", xOffset, yOffset, scaledW, scaledH, undefined, "FAST");
  return pdf.output("blob");
}

// Every filename that ends up on disk - a single download or a zip entry
// - is flattened through here first. Names and admission numbers are
// free text a school types in, and a "019/25" style admission number (or
// a name containing a slash) is common - but every zip format treats "/"
// in an entry name as a folder boundary, so passing that straight through
// silently turns what should be one flat file into a multi-level folder
// buried several clicks deep (that's what was happening: an admission
// number like "019/25" split into "019" and "25.pdf" as separate nested
// levels inside the zip). Flattening here means a teacher can always just
// unzip and see every file sitting loosely at the top level, no matter
// how many students or what's in their names/admission numbers.
function flattenFilename(name) {
  return String(name)
    .replace(/[\\/]+/g, "-") // path separators -> dash, never a folder break
    .replace(/[:*?"<>|]/g, "") // other characters Windows/macOS/zip tooling reject in a filename
    .trim();
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = flattenFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadElementAsPdf(node, filename, opts) {
  const blob = await renderElementToPdfBlob(node, opts);
  triggerBlobDownload(blob, filename);
}

// Turns many DOM nodes into PDFs and bundles them into a single .zip -
// used for "Download all report cards" / "Download all receipts". Built
// to stay light on RAM and CPU even for a large class:
//  - Only ONE item is built/rendered/rasterized at a time (never all 40+
//    report cards in memory or in the DOM at once) - `items[i].build()`
//    is called just-in-time, right before that item is rendered, and
//    whatever DOM node it returns is discarded immediately after.
//  - A 0ms `setTimeout` yield between items hands control back to the
//    browser after each (fairly heavy) render, so the tab's UI thread
//    doesn't lock up solid for the whole batch and progress text can
//    actually repaint between students.
//  - Each PDF is already JPEG-compressed (see renderElementToPdfBlob)
//    before it goes into the zip, so the zip itself stays a reasonable
//    size instead of bundling dozens of multi-MB PNGs.
// `items`: array of { filename, build } where build() returns (or
// resolves to) the DOM node to render for that entry.
// `onProgress(done, total, currentFilename)` fires after each item.
export async function downloadPdfsAsZip(items, zipFilename, { onProgress, scale = 1.5 } = {}) {
  const JSZip = await loadZipLib();
  const zip = new JSZip();
  const usedNames = new Set(); // guards against two students flattening to the same name (e.g. "019/25" and "019-25" both becoming "019-25")
  for (let i = 0; i < items.length; i++) {
    const { filename, build } = items[i];
    const node = await build();
    try {
      const blob = await renderElementToPdfBlob(node, { scale });
      let flatName = flattenFilename(filename);
      if (usedNames.has(flatName)) {
        const dot = flatName.lastIndexOf(".");
        const base = dot === -1 ? flatName : flatName.slice(0, dot);
        const ext = dot === -1 ? "" : flatName.slice(dot);
        flatName = `${base}_${i + 1}${ext}`;
      }
      usedNames.add(flatName);
      zip.file(flatName, blob);
    } finally {
      node?.remove?.();
    }
    onProgress?.(i + 1, items.length, filename);
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  triggerBlobDownload(zipBlob, zipFilename);
}