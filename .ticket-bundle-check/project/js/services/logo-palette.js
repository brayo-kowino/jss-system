/**
 * logo-palette.js
 *
 * Extracts the two most dominant, visually distinct colors from a logo image
 * using the HTML Canvas API. Zero external dependencies.
 *
 * Usage:
 *   import { extractLogoPalette } from "./logo-palette.js";
 *   const { primary, accent } = await extractLogoPalette(imageUrlOrFile);
 *
 * Works with:
 *   - A URL string (Cloudinary HTTPS). Loaded with crossOrigin="anonymous".
 *   - A File / Blob from a file input — no CORS issue at all.
 */

const CANVAS_SIZE = 64; // Downscale to 64x64 before sampling
const K = 6;            // Number of color buckets
const ITERATIONS = 10;  // K-means iterations

// --- Helpers ----------------------------------------------------------------

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Perceived luminance (0-1) using standard coefficients. */
function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Saturation as max-min channel difference (0-1). */
function saturation(r, g, b) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Euclidean distance in RGB space. */
function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Scores how suitable a color (by its luminance) is as a UI primary/brand color.
 *
 * Very bright colors (yellow, lime) score poorly — they are typically background
 * fills or highlights in a logo, not the intended brand color for a UI.
 * Mid-dark colors (reds, blues, greens, dark golds) score best.
 *
 * Score range: 0.0 (terrible) → 1.0 (ideal for primary UI color)
 */
function uiSuitabilityScore(lum, sat) {
  // Ideal luminance for a UI primary: 0.15 - 0.50
  // Penalise very bright (> 0.7) sharply — those are fills/highlights
  const lumScore = lum < 0.15
    ? (lum / 0.15)           // too dark ramps up from 0
    : lum <= 0.50
      ? 1.0                  // ideal zone
      : lum <= 0.70
        ? (0.70 - lum) / 0.20  // acceptable — fades to 0 by lum=0.70
        : 0.0;               // too bright — hard zero (yellow, lime, etc.)

  // Favour saturated colors; grey is rarely a brand color
  const satScore = Math.min(sat / 0.4, 1.0);

  return lumScore * satScore;
}

// --- Image loading ----------------------------------------------------------

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load logo image. Check CORS or network."));
    img.src = url;
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read logo file.")); };
    img.src = url;
  });
}

// --- Pixel sampling ---------------------------------------------------------

/**
 * Draws the image onto an offscreen 64x64 canvas and returns filtered pixels
 * as { rgb, weight } objects. Weight encodes how "brand-suitable" the pixel is,
 * so the K-means step naturally clusters toward darker, saturated hues.
 */
function samplePixels(img) {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const pixels = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

    // Skip transparent pixels
    if (a < 128) continue;

    const lum = luminance(r, g, b);
    const sat = saturation(r, g, b);

    // Skip near-white (page backgrounds) and near-black (outlines/shadows)
    if (lum > 0.93) continue;
    if (lum < 0.05) continue;

    // Skip near-grey (low saturation = not a meaningful brand color)
    if (sat < 0.10) continue;

    const weight = uiSuitabilityScore(lum, sat);

    // Even include low-scoring pixels (for accent detection), but at least
    // include them once so they still appear in the sample.
    pixels.push({ rgb: [r, g, b], weight: Math.max(weight, 0.05) });
  }

  return pixels;
}

// --- Weighted K-means -------------------------------------------------------

function kMeans(pixels, k, iterations) {
  if (pixels.length === 0) return [];

  const step = Math.floor(pixels.length / k);
  let centroids = Array.from({ length: k }, (_, i) => [...(pixels[i * step]?.rgb || pixels[0].rgb)]);
  let assignments = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    for (let p = 0; p < pixels.length; p++) {
      let minDist = Infinity, best = 0;
      for (let c = 0; c < k; c++) {
        const d = colorDist(pixels[p].rgb, centroids[c]);
        if (d < minDist) { minDist = d; best = c; }
      }
      assignments[p] = best;
    }

    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const totalWeights = new Array(k).fill(0);

    for (let p = 0; p < pixels.length; p++) {
      const c = assignments[p];
      const w = pixels[p].weight;
      sums[c][0] += pixels[p].rgb[0] * w;
      sums[c][1] += pixels[p].rgb[1] * w;
      sums[c][2] += pixels[p].rgb[2] * w;
      totalWeights[c] += w;
    }

    centroids = centroids.map((_, c) =>
      totalWeights[c] > 0
        ? [sums[c][0] / totalWeights[c], sums[c][1] / totalWeights[c], sums[c][2] / totalWeights[c]]
        : centroids[c]
    );
  }

  // Accumulate weighted mass per bucket for ranking
  const massByCluster = new Array(k).fill(0);
  for (let p = 0; p < pixels.length; p++) massByCluster[assignments[p]] += pixels[p].weight;

  return centroids
    .map((c, i) => ({ color: c, mass: massByCluster[i] }))
    .filter((b) => b.mass > 0)
    .sort((a, b) => b.mass - a.mass);  // largest weighted mass first
}

// --- Public API -------------------------------------------------------------

/**
 * Extracts the two dominant brand colors from a logo.
 *
 * @param {string | File | Blob} source  URL string or File/Blob.
 * @returns {Promise<{ primary: string, accent: string }>}  Hex color strings.
 */
export async function extractLogoPalette(source) {
  const img =
    typeof source === "string"
      ? await loadImageFromUrl(source)
      : await loadImageFromFile(source);

  const pixels = samplePixels(img);

  if (pixels.length < 20) {
    throw new Error(
      "Couldn't extract distinct colors from this logo — the image may be " +
      "black & white or too transparent. Try picking colors manually."
    );
  }

  const buckets = kMeans(pixels, K, ITERATIONS);

  if (buckets.length < 1) {
    throw new Error("Couldn't extract distinct colors from this logo — try picking manually.");
  }

  const primary = rgbToHex(...buckets[0].color);

  // Accent: next bucket that is visually distinct enough from primary (distance > 55).
  // Fall back to bucket[1] if nothing is far enough.
  let accentBucket = buckets[1] || buckets[0];
  for (let i = 1; i < buckets.length; i++) {
    if (colorDist(buckets[0].color, buckets[i].color) > 55) {
      accentBucket = buckets[i];
      break;
    }
  }

  const accent = rgbToHex(...accentBucket.color);
  return { primary, accent };
}
