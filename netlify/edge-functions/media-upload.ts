// ==========================================================================
// Signed Cloudinary upload proxy.
// ==========================================================================
// Replaces the old unsigned-preset upload. That approach meant anyone who
// read the preset name out of our JS bundle could POST files straight to
// our Cloudinary account from anywhere - no login, no rate limit, nothing
// tying the upload to a real user of the app. This function closes that:
//
//   1. Requires a valid, current Firebase ID token (the caller must
//      actually be signed in to the app) - checked against Firebase
//      itself via the Identity Toolkit REST API, not decoded locally.
//   2. Rejects anything that isn't an image, and anything past a generous
//      size ceiling, before it touches Cloudinary.
//   3. Signs the upload server-side with the Cloudinary API secret, which
//      never ships to the browser. The unsigned preset can be retired in
//      the Cloudinary console once this is live.
//
// It's still not perfect defense in depth (a signed-in user could still
// script uploads within their own account's rate limit), but that's a
// world away from "unauthenticated internet, no limit" - and matches
// what the app actually needs: only real, logged-in users of THIS app
// should be able to write to our Cloudinary account.
//
// REQUIRED SETUP (Netlify Console -> Site configuration -> Environment
// variables - these are secrets, never commit them):
//   CLOUDINARY_API_KEY     - from Cloudinary Console -> Settings -> API Keys
//   CLOUDINARY_API_SECRET  - same page. Treat this like a password; it's
//                            the thing that makes a signature un-forgeable.
// A new deploy is needed after setting these (env vars are snapshotted at
// deploy time), same as the maintenance-mode vars in security.ts.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";
import { verifyFirebaseIdToken } from "./lib/firestore-rest.ts";

const CLOUDINARY_CLOUD_NAME = "xtselsxh"; 
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// Generous ceiling for the *compressed* upload arriving from the browser
// (see compressImage() in js/services/cloudinary.service.js, which brings
// real-world photos down to a few hundred KB). This is a server-side
// backstop in case someone calls this endpoint directly instead of going
// through the app - not the primary size control.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // See lib/firestore-rest.ts's jsonResponse() for why this is set
      // here directly rather than relied on from netlify.toml.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Cloudinary folders are just organizational strings we pass through, but
// they end up inside the signed string and inside Cloudinary's storage
// path - keep them to a conservative charset so nobody can smuggle
// unexpected structure through this field.
function sanitizeFolder(raw: string | null): string {
  if (!raw) return "misc";
  const cleaned = raw.replace(/[^a-zA-Z0-9/_-]/g, "");
  return cleaned.slice(0, 200) || "misc";
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const ip = clientIp(request, context);
  const rl = await checkRateLimit(`media-upload:${ip}`, 20, 60);
  if (!rl.allowed) {
    return rateLimitedResponse(rl.retryAfterSeconds);
  }

  // Reject oversized requests before spending any time parsing the body.
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: "File too large." }, 413);
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken || !(await verifyFirebaseIdToken(idToken))) {
    return jsonResponse({ error: "You must be signed in to upload files." }, 401);
  }

  const apiKey = Netlify.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Netlify.env.get("CLOUDINARY_API_SECRET");
  if (!apiKey || !apiSecret) {
    // Misconfiguration, not a caller error - don't leak details, but log
    // server-side so it shows up in Netlify's function logs.
    console.error("media-upload: CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET not set");
    return jsonResponse({ error: "Upload service is temporarily unavailable." }, 500);
  }

  let incomingForm: FormData;
  try {
    incomingForm = await request.formData();
  } catch {
    return jsonResponse({ error: "Malformed upload request." }, 400);
  }

  const file = incomingForm.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "No file provided." }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return jsonResponse({ error: "Only image uploads are allowed." }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: "File too large." }, 413);
  }

  const folder = sanitizeFolder(incomingForm.get("folder") as string | null);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Cloudinary's signing rule: every param going to the API except file,
  // api_key, signature, and resource_type, sorted alphabetically by key,
  // joined as key=value&key=value, with the API secret appended - then
  // SHA-1 the whole string. folder and timestamp are the only such params
  // we send, and they happen to already be alphabetical.
  const signature = await sha1Hex(`folder=${folder}&timestamp=${timestamp}${apiSecret}`);

  const outgoing = new FormData();
  outgoing.append("file", file, file.name);
  outgoing.append("api_key", apiKey);
  outgoing.append("timestamp", timestamp);
  outgoing.append("signature", signature);
  outgoing.append("folder", folder);

  let cloudinaryRes: Response;
  try {
    cloudinaryRes = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: outgoing });
  } catch {
    return jsonResponse({ error: "Couldn't reach the image upload service." }, 502);
  }

  const body = await cloudinaryRes.text();
  return new Response(body, {
    status: cloudinaryRes.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // See lib/firestore-rest.ts's jsonResponse() for why this is set
      // here directly rather than relied on from netlify.toml.
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const config = {
  path: "/media-upload",
  // Rate limiting is enforced in-code now (see lib/rate-limit.ts) rather
  // than declared here - see the comment at the top of that file for why.
};
