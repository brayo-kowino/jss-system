// On-demand PDF export for a DOM node (used by the report card's "Download
// PDF" button). Both libraries are pulled from a CDN only when needed, so
// the app has zero extra weight until someone actually downloads a card.
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

export async function downloadElementAsPdf(node, filename) {
  const [{ default: html2canvas }, { jsPDF }] = await loadLibs();
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    // .no-print elements (Save Remarks button, Back/Print/Download bar,
    // etc.) are only hidden via a @media print rule, which html2canvas
    // doesn't apply since it renders the live on-screen DOM - so they'd
    // otherwise show up baked into the downloaded PDF. Skip them here too.
    ignoreElements: (el) => el.classList?.contains("no-print"),
  });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(filename);
}
