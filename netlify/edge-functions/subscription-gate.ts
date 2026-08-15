// ==========================================================================
// Subscription gate (suspended schools only)
// ==========================================================================
// Scoped to "/app/*" (see `config` below) - never touches the marketing
// site at "/" or the /subscription-* edge functions. Runs before
// security.ts's CSP/nonce pass (see netlify.toml's edge-function ordering
// comment).
//
// This checks schools/{id}.status LIVE against Firestore on every request,
// using the same service-account credential subscription-issue.ts and
// subscription-activate.ts already use (see lib/firestore-rest.ts) - not a
// client-supplied cookie. That was this file's first design (a
// jss_sub_status cookie synced by auth.service.js), and it worked, but it
// had a real problem: the only code that could ever *update* that cookie
// only ran after the app had already loaded - so a stale "suspended" value
// had no way to self-correct once this function was the thing blocking
// that load in the first place. Reactivating a school server-side did
// nothing for a browser that already had the old cookie until it expired
// or the person found a manual "recheck" escape hatch. Asking Firestore
// directly here removes that whole class of problem: there's no cookie to
// go stale, so a reactivation takes effect on the very next request, no
// waiting and no workaround link needed.
//
// WHAT THIS COSTS: one Firestore REST read added to every /app/* page
// navigation (not on every asset - see the schoolId cookie note below), for
// every signed-in user, not just suspended ones - this function can't know
// who's suspended without checking. IN_MEMORY_CACHE below keeps that from
// meaning a fresh network round trip on literally every reload: a result
// is reused for CACHE_TTL_MS after the first check for a given school, on
// whichever warm edge instance handles the request. That bounds the
// worst-case staleness (a school suspended mid-window keeps loading for up
// to CACHE_TTL_MS longer) without paying full latency on every hit. Tune
// CACHE_TTL_MS down if that window ever feels too long for how fast a
// suspension needs to bite - down to 0 makes every request fully live,
// at the cost of full latency on every one of them.
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
//   that lets a school get itself unstuck without waiting on us. So
//   anything other than a live "suspended" read - active, expired,
//   revoked, or no schoolId cookie at all - falls through to
//   context.next(): the app loads normally, and router.js's own lock gate
//   (still the real UI-layer decision-maker) shows the right screen once
//   it re-derives the same verdict from the live Firestore doc, same as
//   it always has.
//
// WHY THIS IS STILL FAIL-OPEN
//   No schoolId cookie (first-ever visit, cookies cleared, a non-browser
//   client, a super_admin who has no schoolId at all) skips the Firestore
//   read entirely and lets the request through - there's nothing to check
//   yet. A Firestore/token-exchange failure (network hiccup, an expired
//   GOOGLE_SERVICE_ACCOUNT_KEY, Firestore itself being briefly down) is
//   caught and also falls through to context.next() rather than blocking
//   - an infra problem in this function should never be able to lock
//   every signed-in user out of the whole app. firestore.rules'
//   isSubscriptionActive() remains the actual enforcement in every case;
//   this function only ever saves a *genuinely* suspended visitor a
//   wasted download, it never grants or removes real access, and a bug or
//   outage here can only ever result in the old (pre-gate) behaviour of
//   loading the app and letting router.js's own check catch it.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import { getAccessToken, getFsDoc } from "./lib/firestore-rest.ts";

const SCHOOL_ID_COOKIE = "jss_school_id";

// Warm-instance-only, best-effort cache - see the header comment above for
// the latency/staleness tradeoff this controls. Not shared across edge
// locations or cold starts; that's fine, it only ever needs to save
// *repeat* reads on an instance that's already warm, not be globally
// consistent.
const CACHE_TTL_MS = 20_000;
const statusCache = new Map<string, { suspended: boolean; expiresAt: number }>();

async function isSuspended(schoolId: string): Promise<boolean> {
  const cached = statusCache.get(schoolId);
  if (cached && cached.expiresAt > Date.now()) return cached.suspended;

  const token = await getAccessToken();
  const school = await getFsDoc(token, `schools/${schoolId}`);
  const suspended = school?.status === "suspended";
  statusCache.set(schoolId, { suspended, expiresAt: Date.now() + CACHE_TTL_MS });
  return suspended;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

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

export default async (request: Request, context: Context) => {
  const schoolId = getCookie(request, SCHOOL_ID_COOKIE);
  if (!schoolId) return context.next();

  let suspended = false;
  try {
    suspended = await isSuspended(schoolId);
  } catch {
    // Firestore/token exchange failed - fail open, see header comment.
    return context.next();
  }
  if (!suspended) return context.next();

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
    <p>We've suspended this school's access. This isn't a subscription/token issue - only we can restore it.</p>
    <p>Contact us at <a href="mailto:support@iskify360.com">support@iskify360.com</a> for more information and to inquire about restoring your access.</p>
    <div class="fine">Just been reactivated? You can refresh the page to load the application.</div>
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