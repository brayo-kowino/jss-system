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
 *   - A URL string (e.g. Cloudinary HTTPS URL). The image is loaded with
 *     crossOrigin="anonymous" so the CDN must send CORS headers (Cloudinary
 *     does this by default for this app).
 *   - A File / Blob object picked from a file input — no CORS issue at all.
 */

const CANVAS_SIZE = 64; // Downscale to 64x64 before sampling (fast + enough detail)
const K = 6;            // Number of color buckets
const ITERATIONS = 8;   // K-means iterations

// --- Helpers ----------------------------------------------------------------

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Perceived luminance (0-1). */
function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Saturation as a rough 0-1 measure (max - min channel). */
function saturation(r, g, b) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Euclidean distance in RGB space. */
function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
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
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read logo file."));
    };
    img.src = url;
  });
}

// --- Pixel sampling ---------------------------------------------------------

/**
 * Draws the image onto an offscreen 64x64 canvas and returns the filtered
 * array of [r, g, b] pixels that are useful for palette extraction.
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

    // Skip near-white (background) and near-black (outlines/shadows)
    if (lum > 0.92) continue;
    if (lum < 0.06) continue;

    // Skip near-grey (low saturation = not a brand color)
    if (sat < 0.12) continue;

    pixels.push([r, g, b]);
  }

  return pixels;
}

// --- K-means quantization ---------------------------------------------------

function kMeans(pixels, k, iterations) {
  if (pixels.length === 0) return [];

  // Initialise centroids by spreading evenly across the pixel list
  const step = Math.floor(pixels.length / k);
  let centroids = Array.from({ length: k }, (_, i) => [...(pixels[i * step] || pixels[0])]);

  let assignments = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign each pixel to nearest centroid
    for (let p = 0; p < pixels.length; p++) {
      let minDist = Infinity, best = 0;
      for (let c = 0; c < k; c++) {
        const d = colorDist(pixels[p], centroids[c]);
        if (d < minDist) { minDist = d; best = c; }
      }
      assignments[p] = best;
    }

    // Recompute centroids as the mean of assigned pixels
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let p = 0; p < pixels.length; p++) {
      const c = assignments[p];
      sums[c][0] += pixels[p][0];
      sums[c][1] += pixels[p][1];
      sums[c][2] += pixels[p][2];
      counts[c]++;
    }
    centroids = centroids.map((_, c) =>
      counts[c] > 0
        ? [sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]]
        : centroids[c]
    );
  }

  // Return buckets sorted by pixel count descending
  const countMap = new Array(k).fill(0);
  for (const a of assignments) countMap[a]++;

  return centroids
    .map((c, i) => ({ color: c, count: countMap[i] }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
}

// --- Public API -------------------------------------------------------------

/**
 * Extracts the two dominant brand colors from a logo.
 *
 * @param {string | File | Blob} source  - A URL string or a File/Blob object.
 * @returns {Promise<{ primary: string, accent: string }>}  Hex color strings.
 * @throws  If the image cannot be loaded or no distinct colors can be found.
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

  // Pick the accent: the next bucket visually distinct enough from primary
  // (color distance > 60 in RGB space). Fall back to bucket[1] if nothing
  // meets the threshold.
  let accentBucket = buckets[1] || buckets[0];
  for (let i = 1; i < buckets.length; i++) {
    if (colorDist(buckets[0].color, buckets[i].color) > 60) {
      accentBucket = buckets[i];
      break;
    }
  }

  const accent = rgbToHex(...accentBucket.color);

  return { primary, accent };
}
