// ==========================================================================
// In-code rate limiter (Netlify Blobs), used in place of the platform's
// code-based `rateLimit` config in each function's `export const config`.
// ==========================================================================
// WHY THIS EXISTS: Netlify's platform-level rate limiting is capped per
// project by account tier (2 code-based rules on our current tier - see
// https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/#availability).
// This project has 6 functions that each want their own limit, so most of
// them were being silently dropped at deploy time (visible in the deploy
// log as "Too many rules defined, max for your account tier is 2", under
// the "Post processing - redirect rules" step) with no error and no runtime
// indication - the affected endpoints just had no rate limiting live at
// all. Moving the limiting into function code sidesteps the per-project
// rule cap entirely, at the cost of a small amount of latency (~one Blobs
// read + write) added to every request this runs on.
//
// NOT used in security.ts - that one runs on every single request site-wide
// (path "/*", including static assets), and adding a per-request Blobs
// round-trip there would add latency to every page load for every visitor.
// It stays on the platform's rate limiter (the one project-wide rule we
// keep), which runs before the function is even invoked and costs nothing
// extra. Every other function below only runs on POST/GET calls to one
// specific API path, so the added latency here only affects API calls, not
// page loads.
//
// HOW IT WORKS: fixed window counter, keyed by whatever the caller passes
// (typically `${path}:${ip}`). Not perfectly atomic - a warm/concurrent
// edge invocation could race between the get() and the set() below, so
// under very bursty concurrent traffic from one IP the true limit enforced
// may be slightly looser than `windowLimit`. That's an acceptable trade for
// a "blunt backstop" per-IP limiter (same characterization the original
// platform rateLimit configs used), and is not the primary defense on any
// endpoint that also has its own stateful lockout (see results-lookup.ts's
// per-admission-number lockout in Firestore, which IS strictly enforced).
// If exact enforcement under concurrency ever matters here, swap the
// getStore() call below to `{ consistency: "strong" }` is already in use;
// beyond that would need a compare-and-swap primitive Blobs doesn't expose,
// which would mean moving this to Firestore transactions instead.
// ==========================================================================

import { getStore } from "https://esm.sh/@netlify/blobs@8.1.0";

interface RateLimitRecord {
  count: number;
  windowStart: number; // epoch ms
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function getBlobsRateLimitStore() {
  // Site-scoped (not deploy-scoped) so counters persist across deploys -
  // an attacker redeploying isn't a thing, but we don't want a routine
  // deploy to reset everyone's window either. "strong" consistency trades
  // a little latency for immediate read-after-write, which matters here:
  // eventual consistency could let a client's count silently under-count
  // for up to ~60s, defeating the limiter during exactly the burst it's
  // meant to catch.
  return getStore({ name: "rate-limits", consistency: "strong" });
}

// windowLimit: max requests allowed per window.
// windowSizeSeconds: window length in seconds (fixed window, not sliding).
export async function checkRateLimit(
  key: string,
  windowLimit: number,
  windowSizeSeconds: number,
): Promise<RateLimitResult> {
  const store = getBlobsRateLimitStore();
  const now = Date.now();
  const windowMs = windowSizeSeconds * 1000;

  let record: RateLimitRecord | null = null;
  try {
    record = await store.get(key, { type: "json" });
  } catch (err) {
    // Blobs is unavailable/misbehaving - fail OPEN, not closed. A rate
    // limiter outage should degrade to "no rate limiting" rather than
    // "the whole endpoint is down for everyone."
    console.error("rate-limit: store read failed, failing open", err);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (!record || now - record.windowStart >= windowMs) {
    try {
      await store.setJSON(key, { count: 1, windowStart: now });
    } catch (err) {
      console.error("rate-limit: store write failed", err);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.count >= windowLimit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  try {
    await store.setJSON(key, { count: record.count + 1, windowStart: record.windowStart });
  } catch (err) {
    console.error("rate-limit: store write failed", err);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

// Resolves a client IP the same way every one of these functions already
// resolved it individually (context.ip, falling back to the client-IP
// header Netlify sets), so callers don't have to duplicate this fallback.
export function clientIp(request: Request, context: { ip?: string }): string {
  return context.ip || request.headers.get("x-nf-client-connection-ip") || "unknown";
}
