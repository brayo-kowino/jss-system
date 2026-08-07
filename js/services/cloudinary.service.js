// ==========================================================================
// Cloudinary media uploads.
// Replaces Firebase Storage for all media (school logos, student photos).
// Uses an unsigned upload preset via a plain fetch - no SDK required.
// ==========================================================================
const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/xtselsxh/image/upload";
const CLOUDINARY_PRESET = "connexa-storage";

/**
 * Uploads a File/Blob to Cloudinary and returns its secure (https) URL.
 * @param {File} file
 * @param {string} folder - Cloudinary folder to organize uploads under,
 *   e.g. `schools/{schoolId}/logo` or `schools/{schoolId}/students`.
 */
export async function uploadToCloudinary(file, folder = "misc") {
  if (!file) return "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_PRESET);
  if (folder) formData.append("folder", folder);

  let res;
  try {
    res = await fetch(CLOUDINARY_URL, { method: "POST", body: formData });
  } catch {
    throw new Error("Couldn't reach the image upload service. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || "Image upload failed. Please try again.");
  }

  const data = await res.json();
  return data.secure_url;
}