// ==========================================================================
// Lightweight session-level read cache.
//
// getDocs()/getDoc() (used throughout js/services) hit the server first
// whenever the device is online, even with Firestore's persistentLocalCache
// enabled in firebase-config.js - the local cache is only populated as a
// side effect, it doesn't get consulted first or refresh itself in the
// background. This module sits in front of specific service functions to
// avoid re-issuing the same query on every view render for data that
// rarely changes within a session (school settings, classes/subjects,
// teacher roster, assessments, etc).
//
// Not a replacement for Firestore's own offline cache - just cuts down how
// often we ask the server for something we already asked for moments ago.
// Cleared entirely on logout (see auth.service.js) and per-key on write via
// invalidate()/invalidatePrefix(), so nobody is ever shown data that's
// known to be out of date.
// ==========================================================================

const store = new Map(); // key -> { data, expiresAt }

/**
 * Returns the cached value for `key` if it hasn't expired yet; otherwise
 * calls `fetchFn`, caches the result for `ttlMs`, and returns it.
 */
export async function cached(key, ttlMs, fetchFn) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  const data = await fetchFn();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

/** Drop one cached entry (call after any write that changes it). */
export function invalidate(key) {
  store.delete(key);
}

/** Drop every cached entry whose key starts with `prefix`. */
export function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Wipe the whole cache - call on logout/school switch. */
export function clearAll() {
  store.clear();
}
