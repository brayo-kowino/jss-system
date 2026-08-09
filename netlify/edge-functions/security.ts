// ==========================================================================
// Security edge function
// ==========================================================================
// Runs on every request (wired up via `export const config` below — no
// [[edge_functions]] block needed in netlify.toml). Does two things:
//
//   1. MAINTENANCE MODE — when MAINTENANCE_MODE is "true", every visitor
//      gets a 503 maintenance page instead of the app, except whoever has
//      the bypass cookie. See "HOW TO TURN IT ON / OFF" below.
//
//   2. CSP NONCE INJECTION — every other response passes through
//      applyNonceCsp(), which generates a fresh random nonce per request,
//      stamps it onto every <script> tag in the HTML, and rewrites the
//      Content-Security-Policy header's script-src to allow only that
//      nonce. This replaces the old approach of hardcoding a SHA-256 hash
//      per inline script in netlify.toml — that list had to be manually
//      recomputed and updated by hand every time an inline script's
//      content changed, and forgetting to do so silently broke the page
//      (blank sections, dead buttons) with only a browser-console error
//      to explain why. A nonce is generated at request time, so inline
//      <script> content can change freely with no build step required.
//
// HOW TO TURN MAINTENANCE MODE ON / OFF
//   1. Site configuration → Environment variables in the Netlify UI.
//   2. Set MAINTENANCE_MODE to "true" (on) or "false"/unset (off).
//   3. Deploys → Trigger deploy → "Deploy site". No code change or git
//      push needed — but a new deploy IS required, because env vars are
//      snapshotted at deploy time, not read live. This takes well under
//      a minute.
//
// HOW TO GET IN WHILE IT'S ON (e.g. to QA the live site before reopening)
//   1. Set MAINTENANCE_BYPASS_TOKEN to some long random secret (env var,
//      same place as above). Treat it like a password.
//   2. Visit https://yoursite.netlify.app/?bypass=<that token>
//   3. That sets a short-lived cookie and redirects you into the real
//      site; reloading keeps working until the cookie expires (12h) or
//      you clear cookies.
//
// The maintenance page itself talks to nothing else — it's a static page
// with its own tight, self-contained CSP, so it works even if the rest of
// the app (or this file's nonce logic) is misconfigured.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";

const BYPASS_COOKIE = "jss_maint_bypass";
const BYPASS_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

const STYLE = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      font-family: Georgia, 'Times New Roman', serif;
      background: #FAF6F0;
      color: #21262B;
    }
    .card {
      max-width: 460px;
      width: 100%;
      background: #FFFFFF;
      border: 1px solid #DCE3E8;
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(11, 37, 69, 0.16);
      padding: 44px 36px;
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 18px;
      border-radius: 50%;
      background: #E4EDF7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 30px;
    }
    h1 {
      color: #0B2545;
      margin: 0 0 10px;
      font-size: 22px;
    }
    p {
      color: #5C6A73;
      margin: 0 0 6px;
      line-height: 1.6;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 15px;
    }
    .fine {
      margin-top: 18px;
      font-size: 12px;
      color: #8A97A0;
      font-family: Arial, Helvetica, sans-serif;
    }
  `;

async function sha256Base64(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Random per-request value used as the CSP script-src nonce. 16 bytes
// base64-encoded, same strength as a v4 UUID's random bits.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// Stamps nonce="..." onto every <script> tag (inline or external — it's
// harmless on external ones, and simplest to apply uniformly) and swaps
// the response's script-src directive to allow only that nonce, in place
// of whatever the static netlify.toml header declared (hashes, if any —
// see the netlify.toml comment for why that list is now just a fallback).
// Only rewrites HTML responses; everything else passes through untouched
// with the header still corrected, so non-HTML assets aren't needlessly
// buffered.
async function applyNonceCsp(response: Response): Promise<Response> {
  const nonce = generateNonce();
  const headers = new Headers(response.headers);

  const existingCsp = headers.get("Content-Security-Policy");
  if (existingCsp) {
    const nonceCsp = existingCsp.replace(
      /script-src[^;]*/,
      `script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net https://www.google.com 'nonce-${nonce}'`,
    );
    headers.set("Content-Security-Policy", nonceCsp);
  }

  const contentType = headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return new Response(response.body, { status: response.status, headers });
  }

  const html = await response.text();
  const withNonce = html.replace(
    /<script(?![^>]*\bnonce=)/g,
    `<script nonce="${nonce}"`,
  );

  return new Response(withNonce, { status: response.status, headers });
}

export default async (request: Request, context: Context) => {
  const maintenanceOn =
    (Netlify.env.get("MAINTENANCE_MODE") || "").toLowerCase() === "true";

  if (maintenanceOn) {
    const url = new URL(request.url);
    const bypassToken = Netlify.env.get("MAINTENANCE_BYPASS_TOKEN") || "";

    // Admin visiting with ?bypass=<token>: set the cookie, redirect to the
    // clean URL so the token doesn't linger in browser history / logs.
    const queryToken = url.searchParams.get("bypass");
    if (bypassToken && queryToken && queryToken === bypassToken) {
      url.searchParams.delete("bypass");
      const redirect = new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          "Set-Cookie": `${BYPASS_COOKIE}=${bypassToken}; Path=/; Max-Age=${BYPASS_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
      return redirect;
    }

    // Already-bypassed visitor: let them through to the real site (still
    // gets the nonce treatment below, same as any other visitor).
    const cookieToken = getCookie(request, BYPASS_COOKIE);
    const isBypassed = bypassToken && cookieToken === bypassToken;

    if (!isBypassed) {
      const styleHash = await sha256Base64(STYLE);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Eeskia - Scheduled Maintenance</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128736;&#65039;</div>
    <h1>We'll be right back</h1>
    <p>Eeskia is offline for scheduled maintenance.</p>
    <p>Your data is safe and nothing has been lost or changed.</p>
    <div class="fine">Please check back shortly. If this persists, contact your school administrator.</div>
  </div>
</body>
</html>`;

      return new Response(html, {
        status: 503,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": "1800",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';`,
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      });
    }
  }

  const response = await context.next();
  return applyNonceCsp(response);
};

export const config = {
  path: "/*",
  // Blunt, site-wide backstop against scraping/bot floods. Deliberately
  // generous - a real visitor's initial SPA load fetches index.html plus
  // a couple dozen JS/CSS/view files, and normal navigation lazy-loads a
  // few more per route change, so this is sized to never bother a human
  // and only bite sustained scripted hammering from one IP. Firestore
  // reads/writes are NOT covered by this (they never touch Netlify - see
  // App Check in firebase-config.js for that side).
  rateLimit: {
    windowLimit: 400,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};