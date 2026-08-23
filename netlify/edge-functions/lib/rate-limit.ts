// ==========================================================================
// In-code rate limiter (In-Memory Sliding Window), zero external dependencies
// ==========================================================================

interface RateLimitRecord {
  count: number;
  windowStart: number; // epoch ms
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Clean up expired entries every 5 minutes to prevent memory leaks
let lastCleanup = Date.now();
function cleanupExpiredRecords(now: number) {
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, record] of memoryStore.entries()) {
    if (now - record.windowStart > 3600_000) {
      memoryStore.delete(key);
    }
  }
}

export async function checkRateLimit(
  key: string,
  windowLimit: number,
  windowSizeSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSizeSeconds * 1000;
  cleanupExpiredRecords(now);

  const record = memoryStore.get(key);

  if (!record || now - record.windowStart >= windowMs) {
    memoryStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.count >= windowLimit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  record.count += 1;
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
