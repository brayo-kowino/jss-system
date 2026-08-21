// ============================================================================
// Asset & Dependency Preloader
// ============================================================================
// Downloads, decodes, and caches all application assets and heavy modules
// (fonts, Material icons, logos, html2canvas, jsPDF, JSZip, Chart.js, core services)
// at first load during the splash screen so that subsequent actions (PDF downloads,
// icon rendering, charts, and navigation) are instant with zero runtime delay.
// ============================================================================

import { prewarmPdfLibs } from "./pdf.util.js";

function timeoutPromise(promise, ms, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
  ]);
}

async function preloadFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // Wait for the font set to be ready
    await timeoutPromise(document.fonts.ready, 4000);
    // Explicitly prime key typography and icon sets
    const fontLoads = [
      document.fonts.load('24px "Material Symbols Rounded"'),
      document.fonts.load('600 14px "Manrope"'),
      document.fonts.load('700 16px "Manrope"'),
      document.fonts.load('700 18px "Lora"'),
    ];
    await timeoutPromise(Promise.allSettled(fontLoads), 4000);
  } catch {
    // Non-fatal: system fallbacks apply
  }
}

async function preloadImages() {
  if (typeof window === "undefined") return;
  const urls = ["/assets/logo.png", "/assets/eeskia-hero-image.png"];
  const loads = urls.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
      })
  );
  await timeoutPromise(Promise.allSettled(loads), 3000);
}

async function preloadHeavyModules() {
  const loads = [
    import("html2canvas").catch(() => null),
    import("jspdf").catch(() => null),
    import("jszip").catch(() => null),
    import("chart.js").catch(() => null),
  ];
  await timeoutPromise(Promise.allSettled(loads), 8000);
  prewarmPdfLibs();
}

async function preloadCoreServices() {
  const loads = [
    import("./auth.service.js").catch(() => null),
    import("./settings.service.js").catch(() => null),
    import("./academic.service.js").catch(() => null),
    import("./grading.service.js").catch(() => null),
    import("./fee.service.js").catch(() => null),
    import("../router.js").catch(() => null),
  ];
  await timeoutPromise(Promise.allSettled(loads), 6000);
}

export async function preloadAllAppAssets(onProgress) {
  onProgress?.(10, "Checking environment…");

  // Step 1: Preload fonts & icon glyphs (avoids icon flashing and raw text names)
  onProgress?.(25, "Loading fonts & icon glyphs…");
  await preloadFonts();

  // Step 2: Preload core images & logos
  onProgress?.(45, "Loading graphics & branding…");
  await preloadImages();

  // Step 3: Preload PDF engine & Chart.js
  onProgress?.(70, "Preparing PDF & charting tools…");
  await preloadHeavyModules();

  // Step 4: Preload core app services & router
  onProgress?.(90, "Initializing system services…");
  await preloadCoreServices();

  onProgress?.(100, "Starting Eeskia…");
  // Short micro-delay so the 100% state is visible before transition
  await new Promise((r) => setTimeout(r, 200));
}
