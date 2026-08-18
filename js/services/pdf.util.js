// On-demand PDF export for a DOM node (used by the report card's "Download
// PDF" button, fee receipts, and now bulk ZIP export). Both libraries are
// pulled from a CDN only when needed, so the app has zero extra weight
// until someone actually downloads something.
let libsPromise = null;

function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([
      import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm"),
      import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
    ]);
  }
  return libsPromise;
}

let zipLibPromise = null;
function loadZipLib() {
  if (!zipLibPromise) {
    zipLibPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then((m) => m.default || m);
  }
  return zipLibPromise;
}

// Renders one DOM node to a PDF Blob. Uses lossless PNG encoding with
// jsPDF's built-in Flate stream compression (`compress: true`, "SLOW"
// compression). Lossy JPEG previously introduced "smoky"/cloudy DCT ringing
// and mosquito noise around high-contrast typography and table borders;
// PNG ensures 100% pixel-perfect text clarity while compressing white space
// and table structures efficiently.
export async function renderElementToPdfBlob(node, { scale = 2 } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await loadLibs();
  const canvas = await html2canvas(node, {
    scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    // .no-print elements (Save Remarks button, Back/Print/Download bar,
    // etc.) are only hidden via a @media print rule, which html2canvas
    // doesn't apply since it renders the live on-screen DOM - so they'd
    // otherwise show up baked into the downloaded PDF. Skip them here too.
    ignoreElements: (el) => el.classList?.contains("no-print"),
  });
  const imgData = canvas.toDataURL("image/png");

  // Compact cards (like fee receipts) use their own natural card size
  const isReceipt = node.classList?.contains("receipt") || canvas.width < 500 * scale;
  if (isReceipt) {
    const pdf = new jsPDF({
      unit: "px",
      format: [canvas.width / scale, canvas.height / scale],
      compress: true,
      hotfixes: ["px_scaling"],
    });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width / scale, canvas.height / scale, undefined, "SLOW");
    return pdf.output("blob");
  }

  // Standard A4 portrait for Report Cards and School Documents (210mm x 297mm)
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 6; // 6mm margin around page
  const maxW = pageWidth - (margin * 2);
  const maxH = pageHeight - (margin * 2);

  const imgW = maxW;
  const imgH = (canvas.height * maxW) / canvas.width;

  if (imgH <= maxH) {
    // Fits cleanly on 1 page
    pdf.addImage(imgData, "PNG", margin, margin, imgW, imgH, undefined, "SLOW");
  } else {
    // Proportional fit to exactly 1 single A4 page so nothing overflows
    const scaleRatio = maxH / imgH;
    const scaledW = imgW * scaleRatio;
    const scaledH = maxH;
    const xOffset = margin + (maxW - scaledW) / 2;
    pdf.addImage(imgData, "PNG", xOffset, margin, scaledW, scaledH, undefined, "SLOW");
  }

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
export async function downloadPdfsAsZip(items, zipFilename, { onProgress, scale = 2 } = {}) {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  triggerBlobDownload(zipBlob, zipFilename);
}