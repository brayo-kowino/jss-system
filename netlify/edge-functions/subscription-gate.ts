// ==========================================================================
// Subscription gate (suspended schools only)
// ==========================================================================
// Scoped to "/app/*" (see `config` below) - never touches the marketing
// site at "/" or the /subscription-* edge functions. Runs before
// security.ts's CSP/nonce pass (see netlify.toml's edge-function ordering
// comment), reading the jss_sub_status cookie that auth.service.js's
// syncSubscriptionCookie() keeps in sync client-side.
//
// WHY ONLY "suspended", NOT "locked" (expired/revoked) TOO
//   A suspension has exactly one way out for every role, including the
//   school's own admin: contact us. Nobody needs anything the app ships -
//   so there's no reason to send the app shell, router, or any view chunk
//   to that browser at all. This function serves a small static page
//   instead and stops the request there.
//
//   Expired/revoked is different: the school's own admin can self-serve a
//   fresh token right on the lock screen (views/subscription-locked.js -
//   see its own header comment). That form needs auth.service.js,
//   subscription.service.js, and the lock screen's own view module to
//   actually work. Blocking those at the edge would break the one thing
//   that lets a school get itself unstuck without waiting on us. So a
//   "locked" cookie value (or "active", or no cookie at all) just falls
//   through to context.next() - the app loads normally, and router.js's
//   own lock gate (still the real UI-layer decision-maker) shows the
//   right screen once it re-derives the same verdict from the live
//   Firestore doc, same as it always has.
//
// WHY THIS IS FAIL-OPEN BY DESIGN
//   This cookie is a routing hint, not a credential or a security
//   boundary - see the comment above syncSubscriptionCookie() in
//   auth.service.js for the full reasoning. A missing cookie (first-ever
//   visit, cookies cleared, a non-browser client hitting the URL
//   directly), a stale one (up to its 1-hour Max-Age, e.g. a platform
//   admin suspends a school and the affected browser hasn't reloaded
//   since), or a tampered one set by hand can only ever result in this
//   function doing nothing and letting the request through - never in it
//   wrongly blocking someone. firestore.rules' isSubscriptionActive() is
//   what actually stops a suspended school's reads/writes from
//   succeeding regardless of what any client-side value claims; this
//   function only ever saves a legitimately-suspended visitor a wasted
//   download, it never grants or removes real access.
//
// A genuinely offline attacker who knows this can simply not carry a
// stale "active" cookie and load the app normally, straight into
// router.js's own lock gate - which is exactly what happens for anyone
// who never had the cookie in the first place, so nothing is lost by
// this function's fail-open behaviour.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";

const SUB_STATUS_COOKIE = "jss_sub_status";

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
    a { color: #14538A; }
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
  const status = getCookie(request, SUB_STATUS_COOKIE);
  if (status !== "suspended") {
    return context.next();
  }

  const styleHash = await sha256Base64(STYLE);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Eeskia - Access Suspended</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128683;</div>
    <h1>Access suspended</h1>
    <p>We've suspended this school's access. This isn't a subscription/token issue.</p>
    <p>Please contact us at <a href="mailto:support@iskify360.com">support@iskify360.com</a> for more information and to have your access restored.</p>
    <div class="fine"></div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';`,
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
};

export const config = { path: "/app/*" };