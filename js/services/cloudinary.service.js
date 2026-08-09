// ==========================================================================
// Cloudinary media uploads.
// Replaces Firebase Storage for all media (school logos, student photos).
//
// Routed through our own same-origin /media-upload path, handled by
// netlify/edge-functions/media-upload.ts, instead of calling
// api.cloudinary.com directly. That edge function checks the caller is a
// signed-in user before it signs anything with the Cloudinary API secret -
// see its file header for the full reasoning. This module's job is just
// to shrink the image before it leaves the browser and attach the current
// user's ID token so the edge function can verify them.
// ==========================================================================
import { auth } from "../firebase-config.js";

const CLOUDINARY_URL = "/media-upload";

// Anything above this, after compression, gets rejected client-side with a
// clear message rather than being sent and bounced by the server (which
// enforces the same ceiling independently - see MAX_UPLOAD_BYTES in
// media-upload.ts). Kept in sync with that value.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Images larger than this on their longest side get scaled down. 1600px
// is comfortably more than this app ever displays a logo or student photo
// at, even on a large screen or a printed report card.
const MAX_DIMENSION = 1600;
const COMPRESSED_QUALITY = 0.82;

/**
 * Downscales and re-encodes an image client-side before upload, so a
 * 12MP phone photo (often 5-10MB) doesn't get sent over the wire and
 * stored at full size for something that's displayed as a thumbnail or a
 * small report-card photo. Falls back to the original file untouched if
 * anything about compression fails or doesn't actually help - a slightly
 * larger upload is a much better failure mode than a broken one.
 * @param {File} file
 * @returns {Promise<File>}
 */
async function compressImage(file) {
  // SVGs are vector - rasterizing them through canvas would make them
  // *worse* (fixed resolution, larger file for simple shapes) and defeats
  // the point of using SVG. Leave them alone.
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Not decodable as an image by the browser - let the server validate/reject it instead of failing silently here.
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);

    // WebP over JPEG/PNG: supports transparency (matters for logos) and
    // typically compresses noticeably smaller than either at comparable
    // visual quality, and every browser this app supports can produce it.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", COMPRESSED_QUALITY));

    // If compression didn't actually shrink it (rare - e.g. a tiny icon,
    // or an image that was already heavily compressed), keep the original
    // rather than uploading a same-size-or-bigger "compressed" copy.
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp" });
  } finally {
    bitmap.close?.();
  }
}

/**
 * Uploads a File/Blob to Cloudinary (via our signed edge-function proxy)
 * and returns its secure (https) URL. Requires a signed-in Firebase user.
 * @param {File} file
 * @param {string} folder - Cloudinary folder to organize uploads under,
 *   e.g. `schools/{schoolId}/logo` or `schools/{schoolId}/students`.
 */
export async function uploadToCloudinary(file, folder = "misc") {
  if (!file) return "";

  if (!auth.currentUser) {
    throw new Error("You must be signed in to upload files.");
  }

  const toUpload = await compressImage(file);
  if (toUpload.size > MAX_UPLOAD_BYTES) {
    throw new Error("That image is too large even after compression. Please use a smaller file.");
  }

  const idToken = await auth.currentUser.getIdToken();

  const formData = new FormData();
  formData.append("file", toUpload);
  if (folder) formData.append("folder", folder);

  let res;
  try {
    res = await fetch(CLOUDINARY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      body: formData,
    });
  } catch {
    throw new Error("Couldn't reach the image upload service. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "Image upload failed. Please try again.");
  }

  const data = await res.json();
  return data.secure_url;
}