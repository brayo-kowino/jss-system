// ==========================================================================
// Maintenance mode
// ==========================================================================
// Runs on every request (wired up in netlify.toml). When MAINTENANCE_MODE
// is "true", every visitor gets a 503 maintenance page instead of the app —
// except whoever has the bypass cookie, which you hand out via a secret
// URL.
//
// HOW TO TURN IT ON / OFF
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
// Nothing here talks to Firebase/Cloudinary/etc — it's a static page with
// its own tight, self-contained CSP, so it works even if the rest of the
// app is misconfigured.
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

export default async (request: Request, context: Context) => {
  const maintenanceOn =
    (Netlify.env.get("MAINTENANCE_MODE") || "").toLowerCase() === "true";

  if (!maintenanceOn) {
    return context.next();
  }

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

  // Already-bypassed visitor: let them through to the real site.
  const cookieToken = getCookie(request, BYPASS_COOKIE);
  if (bypassToken && cookieToken === bypassToken) {
    return context.next();
  }

  const styleHash = await sha256Base64(STYLE);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>JSS Manager - Scheduled Maintenance</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128736;&#65039;</div>
    <h1>We'll be right back</h1>
    <p>JSS Manager is offline for scheduled maintenance.</p>
    <p>Your data is safe — nothing has been lost or changed.</p>
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
};

export const config = { path: "/*" };
