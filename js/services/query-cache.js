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
 * If fetchFn fails (or returns empty while offline), falls back to the
 * persisted lastKnown entry from localStorage so the app functions offline.
 */
export async function cached(key, ttlMs, fetchFn) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  try {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Query timeout - using fallback")), 4000);
    });
    const fetchPromise = Promise.resolve().then(fetchFn);
    const data = await Promise.race([fetchPromise, timeoutPromise]).finally(() => clearTimeout(timer));
    
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const isEmptyArray = Array.isArray(data) && data.length === 0;
    const isNull = data === null;
    if (isOffline && (isEmptyArray || isNull) && lastKnown.has(key)) {
      const fallback = lastKnown.get(key);
      store.set(key, { data: fallback, expiresAt: Date.now() + ttlMs });
      return fallback;
    }
    store.set(key, { data, expiresAt: Date.now() + ttlMs });
    if (data !== undefined && data !== null) {
      if (!Array.isArray(data) || data.length > 0 || !lastKnown.has(key)) {
        setLastKnown(key, data);
      }
    }
    return data;
  } catch (err) {
    if (lastKnown.has(key)) {
      const fallback = lastKnown.get(key);
      store.set(key, { data: fallback, expiresAt: Date.now() + ttlMs });
      return fallback;
    }
    throw err;
  }
}

// Separate from the TTL cache above, and never consulted to skip a fetch -
// this only remembers the last value each key resolved to, for as long as
// the tab's been open, purely as a fallback when a fetch fails outright
// (e.g. offline, or a server-only aggregate query like getCountFromServer/
// getAggregateFromServer that has no cache of its own to fall back to).
//
// Persisted to localStorage (not just kept in memory) specifically for the
// service worker's app-shell caching: with the app able to boot fully
// offline now (see /sw.js), someone can open a *fresh* session - no
// in-memory lastKnown yet - with no connection at all. Without persistence
// that first aggregate fetch has nothing to fall back to and silently
// returns `fallback` (0) looking exactly like real data, no stale banner.
// Persisting across reloads means it instead shows the school's actual
// last-known revenue/headcount figures, correctly labeled stale.
const LAST_KNOWN_KEY = "jss_last_known_aggregates";
function readLastKnown() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(LAST_KNOWN_KEY) || "{}"))); }
  catch { return new Map(); }
}
function writeLastKnown(map) {
  try { localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(Object.fromEntries(map))); }
  catch { /* storage full/blocked - falls back to in-memory-only for this session, non-fatal */ }
}
const lastKnown = readLastKnown();

/**
 * Calls `fetchFn`. On success, remembers the result under `key` (for future
 * failures) and returns { value, stale: false }. On failure, returns the
 * last value that ever succeeded for `key`, tagged { value, stale: true },
 * instead of propagating the error or silently substituting a number like
 * 0 that looks like real data. If nothing has ever succeeded for `key`
 * either, returns { value: fallback, stale: false } - there's nothing
 * stale to show, so this isn't mislabeled as "stale."
 */
export async function cachedWithFallback(key, fetchFn, fallback, timeoutMs = 4000) {
  try {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Query timeout - using fallback")), timeoutMs);
    });
    const fetchPromise = Promise.resolve().then(fetchFn);
    const data = await Promise.race([fetchPromise, timeoutPromise]).finally(() => clearTimeout(timer));
    lastKnown.set(key, data);
    writeLastKnown(lastKnown);
    return { value: data, stale: false };
  } catch (err) {
    if (lastKnown.has(key)) return { value: lastKnown.get(key), stale: true };
    return { value: fallback, stale: false };
  }
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
  // lastKnown intentionally left alone: its entries are already scoped by
  // schoolId (see the `scopedId(...)` calls building each key in
  // fee.service.js/dashboard.js), so a different account never sees another
  // school's stale figures - wiping it here would only lose the "last known"
  // fallback that logging back in offline later relies on.
}

export function getLastKnown(key) {
  return lastKnown.get(key);
}

export function setLastKnown(key, data) {
  lastKnown.set(key, data);
  writeLastKnown(lastKnown);
}
