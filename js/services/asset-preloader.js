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
    // 1. Explicitly load font faces with icon ligature text
    const sampleIcons = "dashboard attendance school notifications group schedule calendar_today payments receipt download print search menu edit delete add check close arrow_back person bar_chart description";
    const fontLoads = [
      document.fonts.load('24px "Material Symbols Rounded"', sampleIcons),
      document.fonts.load('500 14px "Manrope"'),
      document.fonts.load('600 14px "Manrope"'),
      document.fonts.load('700 16px "Manrope"'),
      document.fonts.load('600 18px "Lora"'),
      document.fonts.load('700 18px "Lora"'),
    ];
    await timeoutPromise(Promise.allSettled(fontLoads), 5000);
    await timeoutPromise(document.fonts.ready, 4000);

    // 2. Offscreen rendering warm-up to force browser text rasterizer to compile ligatures into GPU cache
    const testWrap = document.createElement("div");
    testWrap.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;display:flex;";
    for (const iconName of sampleIcons.split(" ")) {
      const span = document.createElement("span");
      span.className = "material-symbols-rounded";
      span.textContent = iconName;
      testWrap.appendChild(span);
    }
    document.body.appendChild(testWrap);
    void testWrap.offsetWidth;
    testWrap.remove();
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
