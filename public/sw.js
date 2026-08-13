// ==========================================================================
// Eeskia service worker - app-shell + asset caching for the /app/ dashboard.
//
// Scope: registered by js/app.js as navigator.serviceWorker.register("/sw.js",
// { scope: "/app/" }) - this file lives at the site root only because that's
// where public/ files land unhashed post-build (see netlify.toml), it never
// controls the marketing site at "/".
//
// Strategy (deliberately NOT a build-time precache manifest / Workbox):
// this app's build already changes tooling enough (see the obfuscator plugin
// in vite.config.js); adding a precache-manifest step on top would mean this
// file has to be regenerated every build. Instead this is a runtime cache
// that fills itself in as the person actually uses the app:
//
//   - The very first time someone opens /app/ *online*, every screen they
//     visit gets its JS/CSS chunk cached as it's fetched.
//   - After that, reopening the app - even with zero connectivity - serves
//     the shell and every previously-visited screen straight from cache.
//     A screen that was genuinely never opened while online won't be
//     available until it has been.
//   - Content-hashed build output (/assets/*-<hash>.js/.css) is cached
//     cache-first, forever - the hash changes if the content ever does, so
//     there's no staleness risk and no need to ever re-fetch it.
//   - The HTML shell and unhashed assets (logo, manifest) are network-first
//     so a new deploy is picked up immediately when online, falling back to
//     cache only when offline.
//   - Firebase/Auth/Firestore/App Check API calls are never intercepted -
//     Firestore already has its own offline write queue and local cache
//     (see persistentLocalCache in js/firebase-config.js); this service
//     worker only ever touches static files, never app data.
// ==========================================================================

// IMPORTANT: bump this any time netlify.toml's CSP changes. A service
// worker's own fetch() calls (see staleWhileRevalidate below) are bound to
// the CSP that was live when that worker instance was installed - not the
// page's current CSP - and browsers only reinstall a worker when its script
// bytes change. Without a version bump here, anyone who installed the SW
// before a CSP change keeps enforcing the old policy indefinitely (only a
// forced/hard reload bypasses the SW long enough to hide the symptom).
const CACHE_VERSION = "eeskia-v3.4";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, RUNTIME_CACHE];

const APP_SHELL_URL = "/app/index.html";

// Hosts this service worker is allowed to cache. Everything else
// cross-origin (Firestore RPCs, auth, App Check token minting, the
// Cloudinary upload proxy, subscription edge functions) passes straight
// through to the network, untouched and uncached - see the header comment
// above for why.
const CACHEABLE_CROSS_ORIGIN_HOSTS = new Set([
  "www.gstatic.com",       // Firebase modular SDK (ESM, versioned URLs)
  "fonts.googleapis.com",  // Google Fonts stylesheet
  "fonts.gstatic.com",     // Google Fonts font files
  "cdn.jsdelivr.net",      // Chart.js, plus html2canvas/jsPDF/JSZip for report card PDF export
  "res.cloudinary.com",    // School logos and student/staff photos - shown in the shell, report
                            // cards, and student profiles, so these need to survive offline too.
]);

self.addEventListener("install", (event) => {
  // Don't wait for old tabs to close before taking over - see the
  // controllerchange handling in app.js for how an already-open tab is
  // told a new version is ready rather than being silently swapped under it.
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(APP_SHELL_URL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !ALL_CACHES.includes(name)).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// Lets an already-open tab know a new version has taken over, so app.js can
// show a "Refresh to update" toast instead of the person wondering why
// things look stale. Best-effort only - if no client is listening, this is
// a no-op.
async function notifyClientsOfUpdate() {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage({ type: "EESKIA_SW_UPDATED" });
}
self.addEventListener("activate", (event) => {
  event.waitUntil(notifyClientsOfUpdate());
});

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigationRequest(request)) {
      const shellFallback = await cache.match(APP_SHELL_URL);
      if (shellFallback) return shellFallback;
      return offlineFirstVisitResponse();
    }
    throw new Error("network-first: no network and nothing cached");
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

// Shown only when someone opens the app for the very first time ever with
// no connection at all, so there's genuinely nothing cached yet to fall
// back to. Every other offline scenario (already used the app at least
// once online) is served from cache instead and never reaches this.
function offlineFirstVisitResponse() {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Eeskia</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAF6F0;font-family:Arial,Helvetica,sans-serif;color:#21262B;padding:32px;box-sizing:border-box;}
      .card{max-width:420px;width:100%;background:#FFFFFF;border:1px solid #DCE3E8;border-radius:8px;box-shadow:0 12px 32px rgba(11,37,69,0.16);padding:40px 32px;text-align:center;}
      h2{color:#0B2545;margin:0 0 8px;font-family:Georgia,serif;}
      p{color:#5C6A73;line-height:1.5;margin:0 0 12px;}
      button{background:#14538A;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer;}
    </style></head>
    <body><div class="card">
      <h2>Connect once to get started</h2>
      <p>Eeskia needs an internet connection the first time it opens on this device. After that, it'll keep working even without one.</p>
      <button onclick="location.reload()">Try again</button>
    </div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept writes/uploads

  const url = new URL(request.url);

  // Cross-origin: only ever touch the small allowlist of CDN hosts the app
  // itself imports from; everything else (Firestore, Auth, App Check,
  // Cloudinary, subscription functions) goes straight to the network.
  if (url.origin !== self.location.origin) {
    if (CACHEABLE_CROSS_ORIGIN_HOSTS.has(url.hostname)) {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    }
    return;
  }

  // Same-origin, but outside this SW's own scope (e.g. the marketing site,
  // /results/ lookup page) - leave those to the network untouched.
  if (!url.pathname.startsWith("/app/") && !url.pathname.startsWith("/assets/") && url.pathname !== "/site.webmanifest") {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Content-hashed build output - immutable, safe to cache forever.
  if (url.pathname.startsWith("/assets/") && /-[a-f0-9]{6,}\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Everything else same-origin (unhashed icons/images, site.webmanifest) -
  // fine to serve stale-then-refresh rather than blocking on network.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});