// ==========================================================================
// Rate limiter backed by Netlify Blobs (sliding window, shared across
// isolates/regions) - this MUST use a shared store, not in-memory state.
// Edge functions run as many independent isolates across edge locations;
// a plain in-memory Map is scoped to a single isolate, so two requests
// from the same caller can land on different isolates (or a freshly
// cold-started one) and each see their own empty counter, letting
// callers blow past the intended limit. That matters most here because
// several of these limits guard brute-force-sensitive endpoints
// (2FA verify, login-approval-approve, etc.) - see call sites.
// ==========================================================================

import { getStore } from "@netlify/blobs";

interface RateLimitRecord {
  count: number;
  windowStart: number; // epoch ms
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function store() {
  // "rate-limits" is a dedicated blob store; consistency: "strong" so a
  // read immediately after a write on the same key doesn't see stale data,
  // which matters for a counter that's read-then-written on every request.
  return getStore({ name: "rate-limits", consistency: "strong" });
}

export async function checkRateLimit(
  key: string,
  windowLimit: number,
  windowSizeSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSizeSeconds * 1000;
  const blobKey = `rl:${key}`;
  const blobs = store();

  let record: RateLimitRecord | null = null;
  try {
    record = await blobs.get(blobKey, { type: "json" });
  } catch (e) {
    // If the blob store is unreachable, fail open rather than locking
    // every caller out - log it so it's visible, but don't 500 the request.
    console.error("checkRateLimit: blob read failed, failing open", e);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (!record || now - record.windowStart >= windowMs) {
    const fresh: RateLimitRecord = { count: 1, windowStart: now };
    try {
      await blobs.setJSON(blobKey, fresh, { metadata: { expiresAt: now + windowMs } });
    } catch (e) {
      console.error("checkRateLimit: blob write failed", e);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.count >= windowLimit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  const updated: RateLimitRecord = { count: record.count + 1, windowStart: record.windowStart };
  try {
    await blobs.setJSON(blobKey, updated, { metadata: { expiresAt: record.windowStart + windowMs } });
  } catch (e) {
    console.error("checkRateLimit: blob write failed", e);
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
