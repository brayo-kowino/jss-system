/**
 * Deep Linking Engine & Dynamic Route Resolver
 *
 * Provides safe parsing, building, and clipboard sharing of dynamic deep links
 * across all modules (Students, Marks, Timetable, Fees, Attendance, Settings, etc.),
 * plus smart fuzzy route resolution and the playful cosmic Alien 404 page:
 * "Oops! Aliens might have eaten that page... let's find it"
 */
import { el, icon, toast } from "../utils.js";

/**
 * Parses the current or provided hash and search query into a sanitized route path and params dictionary.
 * Supports:
 *   - #/students?id=xyz123&action=view
 *   - #/marks?grade=Grade+7&stream=Blue&subject=ENG
 *   - ?school=ees-001#/timetable?tab=master&day=Monday
 */
export function parseDeepLink(rawHash = (typeof location !== "undefined" ? location.hash : "")) {
  const hash = String(rawHash || "").trim();
  const queryIndex = hash.indexOf("?");
  
  let rawPath = queryIndex !== -1 ? hash.slice(0, queryIndex) : hash;
  let rawQuery = queryIndex !== -1 ? hash.slice(queryIndex + 1) : "";

  // Normalize path
  rawPath = rawPath.replace(/^#[!/]*/, "/");
  if (!rawPath || rawPath === "/") rawPath = "/";
  try {
    rawPath = decodeURIComponent(rawPath);
  } catch {
    rawPath = "__invalid__";
  }

  // Parse parameters from hash query
  const params = {};
  if (rawQuery) {
    try {
      const sp = new URLSearchParams(rawQuery);
      for (const [k, v] of sp.entries()) {
        params[k] = v.trim();
      }
    } catch (e) {
      console.warn("Could not parse deep link query:", e);
    }
  }

  // Also include non-school query params from location.search if present
  if (typeof location !== "undefined" && location.search) {
    try {
      const searchSp = new URLSearchParams(location.search);
      for (const [k, v] of searchSp.entries()) {
        if (k !== "school" && k !== "_v" && !params[k]) {
          params[k] = v.trim();
        }
      }
    } catch {}
  }

  return {
    path: rawPath.toLowerCase(),
    originalPath: rawPath,
    params,
    raw: hash,
  };
}

/**
 * Builds a shareable deep link URL for a given path and params,
 * preserving school tenancy (?school=xyz) in the origin search params.
 */
export function buildDeepLink(path, params = {}) {
  const normPath = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();

  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      qs.set(key, String(val).trim());
    }
  }

  const queryStr = qs.toString() ? `?${qs.toString()}` : "";
  const hashPart = `#${normPath}${queryStr}`;

  if (typeof window === "undefined" || !window.location) {
    return hashPart;
  }

  const url = new URL(window.location.href);
  return `${url.origin}${url.pathname}${url.search}${hashPart}`;
}

/**
 * Safely navigates the active browser window to a deep link destination without reloading.
 */
export function navigateDeepLink(path, params = {}) {
  const normPath = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      qs.set(key, String(val).trim());
    }
  }
  const queryStr = qs.toString() ? `?${qs.toString()}` : "";
  const targetHash = `#${normPath}${queryStr}`;
  if (typeof window !== "undefined") {
    window.location.hash = targetHash;
  }
  return targetHash;
}

/**
 * Creates an accessible, interactive inline deep link element for safe in-app cross-module navigation.
 * Renders with a distinctive underlined accent and subtle jump arrow (↗) so users immediately recognize
 * it as an actionable shortcut to another module or modal.
 */
export function internalLink(path, params = {}, label = "", options = {}) {
  const normPath = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      qs.set(key, String(val).trim());
    }
  }
  const queryStr = qs.toString() ? `?${qs.toString()}` : "";
  const targetHash = `#${normPath}${queryStr}`;

  const linkNode = el("a", {
    href: targetHash,
    class: `deep-link-inline ${options.class || ""}`.trim(),
    role: "link",
    ...(options.style ? { style: options.style } : {}),
    title: options.title || `Jump to ${label}`,
    onClick: (e) => {
      e.preventDefault();
      if (typeof options.onClick === "function") {
        options.onClick(e);
      }
      navigateDeepLink(path, params);
    },
  }, [
    options.icon ? icon(options.icon, "text-xs") : null,
    el("span", { class: "deep-link-inline__text" }, label),
    options.externalIcon !== false ? el("span", { class: "deep-link-inline__arrow", "aria-hidden": "true" }, "↗") : null,
  ].filter(Boolean));

  return linkNode;
}

/**
 * Copies the constructed deep link to the user's clipboard and triggers a toast notification.
 */
export async function copyDeepLink(path, params = {}, label = "Direct link") {
  const fullUrl = buildDeepLink(path, params);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fullUrl);
    } else {
      // Fallback for older environments
      const temp = document.createElement("textarea");
      temp.value = fullUrl;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    }
    toast(`${label} copied to clipboard!`, "success");
    return true;
  } catch (err) {
    console.warn("Clipboard write failed, showing prompt:", err);
    window.prompt("Copy this direct link:", fullUrl);
    return false;
  }
}

/**
 * Levenshtein distance string similarity calculator
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

/**
 * Suggests the closest valid route if a user mistypes or enters a broken link.
 */
export function findBestRouteMatch(badPath, routesTable = {}) {
  const clean = (badPath || "").toLowerCase().replace(/^\/+/, "").split("?")[0].trim();
  if (!clean) return null;

  let best = null;
  let minDistance = Infinity;

  for (const [routePath, meta] of Object.entries(routesTable)) {
    const routeClean = routePath.replace(/^\/+/, "");
    // Substring or prefix match
    if (routeClean.includes(clean) || clean.includes(routeClean)) {
      return { path: routePath, title: meta.title || routeClean, distance: 0 };
    }

    const dist = levenshtein(clean, routeClean);
    if (dist < minDistance && dist <= 3) {
      minDistance = dist;
      best = { path: routePath, title: meta.title || routeClean, distance: dist };
    }
  }

  return best;
}

/**
 * Renders the playful, cosmic Alien 404 screen:
 * "Oops! Aliens might have eaten that page... let's find it"
 */
export function renderAlienNotFound(container, { badRoute = "", routes = {}, authed = true, onNavigate }) {
  container.innerHTML = "";

  const safeBadRoute = badRoute || location.hash || "unknown-dimension";
  const similar = findBestRouteMatch(safeBadRoute, routes);

  const wrap = el("div", { class: "alien-404-container" });

  // Bespoke Eeskia Institutional Celestial Navigator & Deep-Link Illustration
  const ufoSvg = `
    <svg class="alien-404__ufo" viewBox="0 0 240 170" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Navigator">
      <defs>
        <radialGradient id="eeskiaCosmicGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--color-gold, #C9A227)" stop-opacity="0.12" />
          <stop offset="60%" stop-color="var(--color-primary-700, #14538A)" stop-opacity="0.04" />
          <stop offset="100%" stop-color="transparent" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="eeskiaSaucerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1E3A62" />
          <stop offset="100%" stop-color="#0B2545" />
        </linearGradient>
        <linearGradient id="eeskiaNavyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1E6FB5" />
          <stop offset="100%" stop-color="#0E3A62" />
        </linearGradient>
        <linearGradient id="eeskiaDomeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(255, 255, 255, 0.75)" />
          <stop offset="100%" stop-color="rgba(228, 237, 247, 0.25)" />
        </linearGradient>
        <linearGradient id="eeskiaBeamGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(201, 162, 39, 0.25)" />
          <stop offset="100%" stop-color="transparent" />
        </linearGradient>
      </defs>
      
      <!-- Ambient Cosmic Glow & Orbit Guides -->
      <circle cx="120" cy="85" r="75" fill="url(#eeskiaCosmicGlow)" />
      <ellipse cx="120" cy="95" rx="100" ry="24" stroke="var(--color-line, #DCE3E8)" stroke-width="1.2" stroke-dasharray="4,4" opacity="0.8" />
      <ellipse cx="120" cy="90" rx="88" ry="18" stroke="var(--color-gold, #C9A227)" stroke-width="1" stroke-dasharray="3,3" opacity="0.45" transform="rotate(-8 120 90)" />

      <!-- Constellation Star Accents -->
      <polygon points="40,78 41.5,82 45.5,82.5 42.5,85 43.5,89 40,87 36.5,89 37.5,85 34.5,82.5 38.5,82" fill="var(--color-gold)" opacity="0.8" />
      <polygon points="200,64 201.2,67 204.5,67.5 202,69.5 202.8,72.5 200,71 197.2,72.5 198,69.5 195.5,67.5 198.8,67" fill="var(--color-gold)" opacity="0.7" />
      <circle cx="68" cy="54" r="1.5" fill="var(--color-primary-600)" opacity="0.6" />
      <circle cx="178" cy="115" r="1.5" fill="var(--color-primary-600)" opacity="0.5" />

      <!-- Soft Ground Shadow & Guidance Beam -->
      <ellipse cx="120" cy="154" rx="46" ry="6" fill="var(--color-primary-900)" opacity="0.1" />
      <polygon points="120,86 85,152 155,152" fill="url(#eeskiaBeamGrad)" opacity="0.5" class="alien-beam" />

      <!-- Exploration Vessel Hull -->
      <ellipse cx="120" cy="82" rx="60" ry="15" fill="url(#eeskiaSaucerGrad)" stroke="var(--color-primary-900)" stroke-width="1.5" />
      <ellipse cx="120" cy="79" rx="52" ry="9" fill="url(#eeskiaNavyGrad)" />
      <path d="M 64,82 C 64,88 176,88 176,82" stroke="var(--color-gold)" stroke-width="1.5" fill="none" opacity="0.9" />

      <!-- Status Pips -->
      <circle cx="76" cy="83" r="2" fill="var(--color-gold)" class="alien-light" />
      <circle cx="98" cy="85" r="2" fill="var(--color-primary-100)" opacity="0.8" />
      <circle cx="120" cy="86" r="2.5" fill="var(--color-gold)" class="alien-light" />
      <circle cx="142" cy="85" r="2" fill="var(--color-primary-100)" opacity="0.8" />
      <circle cx="164" cy="83" r="2" fill="var(--color-gold)" class="alien-light" />

      <!-- Crystal Observatory Dome -->
      <path d="M 92,76 C 92,54 148,54 148,76 Z" fill="url(#eeskiaDomeGrad)" stroke="var(--color-line)" stroke-width="1.2" />
      <path d="M 98,72 C 100,58 120,56 126,56" stroke="rgba(255,255,255,0.75)" stroke-width="1.2" stroke-linecap="round" fill="none" />

      <!-- Eeskia Academic Navigator Character -->
      <ellipse cx="120" cy="67" rx="9" ry="8.5" fill="var(--color-cream, #FAF6F0)" stroke="var(--color-primary-700)" stroke-width="1.2" />
      <circle cx="117.5" cy="66" r="1.3" fill="var(--color-primary-900)" />
      <circle cx="122.5" cy="66" r="1.3" fill="var(--color-primary-900)" />
      <path d="M 118.5,69.5 Q 120,71 121.5,69.5" stroke="var(--color-primary-900)" stroke-width="1" fill="none" stroke-linecap="round" />

      <!-- Scholar Mortarboard Cap & Tassel -->
      <polygon points="120,53 134,58 120,62 106,58" fill="var(--color-gold)" stroke="var(--color-primary-900)" stroke-width="1" />
      <circle cx="120" cy="57.5" r="1.2" fill="var(--color-primary-900)" />
      <path d="M 120,57.5 C 126,59 130,63 129,68" stroke="var(--color-primary-900)" stroke-width="1" fill="none" />
      <circle cx="129" cy="68.5" r="1" fill="var(--color-primary-900)" />

      <!-- Celestial Navigation Astrolabe / Pointer -->
      <line x1="138" y1="74" x2="152" y2="52" stroke="var(--color-gold)" stroke-width="2" stroke-linecap="round" />
      <circle cx="152" cy="52" r="2.5" fill="none" stroke="var(--color-gold)" stroke-width="1.2" />

      <!-- Floating CBC Document Token -->
      <g class="alien-page-abduction">
        <rect x="111" y="116" width="18" height="24" rx="2" fill="var(--color-surface, #FFFFFF)" stroke="var(--color-line, #DCE3E8)" stroke-width="1.2" transform="rotate(-8 120 128)" />
        <line x1="115" y1="121" x2="124" y2="120" stroke="var(--color-primary-700)" stroke-width="1.2" stroke-linecap="round" transform="rotate(-8 120 128)" />
        <line x1="115" y1="125" x2="125" y2="124" stroke="var(--color-gold)" stroke-width="1.2" stroke-linecap="round" transform="rotate(-8 120 128)" />
        <line x1="115" y1="129" x2="121" y2="128" stroke="var(--color-line)" stroke-width="1.2" stroke-linecap="round" transform="rotate(-8 120 128)" />
        <circle cx="123" cy="133" r="1.8" fill="var(--color-red)" opacity="0.8" transform="rotate(-8 120 128)" />
      </g>
    </svg>
  `;

  const illustrationMount = el("div", { class: "alien-404__hero-art" });
  illustrationMount.innerHTML = ufoSvg;

  // Header badges & titles
  const badge = el("div", { class: "alien-404__badge" }, [
    el("span", { class: "alien-badge-dot" }),
    "404 · Route Not Found",
  ]);

  const title = el("h1", { class: "alien-404__title" }, "Oops! Aliens might have eaten that page... let's find it");

  const subtitle = el("p", { class: "alien-404__subtitle" }, [
    "The requested route ",
    el("code", { class: "alien-bad-path" }, safeBadRoute),
    " could not be located. It may have moved or was mistyped.",
  ]);

  // Suggested Route Banner (if close match found)
  const suggestionBox = el("div", {});
  if (similar) {
    suggestionBox.append(
      el("div", { class: "alien-404__suggestion" }, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("explore", "text-sm", "style: color:var(--color-gold); flex-shrink:0;"),
          el("span", {}, [
            "Did you mean ",
            el("strong", {}, similar.title),
            el("span", { class: "text-muted text-xs", style: "margin-left: 4px;" }, `(${similar.path})`),
            "?",
          ]),
        ]),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => {
            if (onNavigate) onNavigate(similar.path);
            else location.hash = `#${similar.path}`;
          },
        }, [icon("arrow_forward", "text-xs"), `Go to ${similar.title}`]),
      ])
    );
  }

  // Interactive "Let's Find It" Teleport Search Box
  const searchInput = el("input", {
    type: "search",
    class: "input alien-404__search-input",
    placeholder: "Search destinations (e.g. students, marks, timetable, fees)...",
    autocomplete: "off",
  });

  const searchResultsMount = el("div", { class: "alien-404__search-results", style: "display:none;" });

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    searchResultsMount.innerHTML = "";
    if (!q) {
      searchResultsMount.style.display = "none";
      return;
    }

    const matches = Object.entries(routes)
      .filter(([p, meta]) => {
        const title = (meta.title || "").toLowerCase();
        return p.toLowerCase().includes(q) || title.includes(q);
      })
      .slice(0, 5);

    if (matches.length === 0) {
      searchResultsMount.style.display = "block";
      searchResultsMount.append(el("div", { class: "alien-search-empty" }, "No destination matches found."));
      return;
    }

    searchResultsMount.style.display = "grid";
    for (const [p, meta] of matches) {
      searchResultsMount.append(
        el("button", {
          type: "button",
          class: "alien-search-item",
          onClick: () => {
            if (onNavigate) onNavigate(p);
            else location.hash = `#${p}`;
          },
        }, [
          el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
            icon("arrow_forward", "text-xs", "style: color:var(--color-primary-700);"),
            el("strong", {}, meta.title || p),
          ]),
          el("code", { class: "text-muted text-xs" }, `#${p}`),
        ])
      );
    }
  });

  const searchContainer = el("div", { class: "alien-404__search-wrap" }, [
    el("div", { class: "alien-search-box-inner" }, [
      icon("search", "alien-search-icon"),
      searchInput,
      el("kbd", { class: "alien-search-kbd" }, "Ctrl K"),
    ]),
    searchResultsMount,
  ]);

  // Teleport Action Pills (Quick destinations)
  const homeTarget = authed ? "/dashboard" : "/login";
  const homeLabel = authed ? "Dashboard" : "Sign In";

  const quickTeleports = el("div", { class: "alien-404__teleports" }, [
    el("button", {
      type: "button",
      class: "btn btn--primary",
      onClick: () => onNavigate ? onNavigate(homeTarget) : (location.hash = `#${homeTarget}`),
    }, [icon("home"), `Return to ${homeLabel}`]),

    el("button", {
      type: "button",
      class: "btn btn--ghost",
      onClick: () => onNavigate ? onNavigate("/students") : (location.hash = "#/students"),
    }, [icon("group"), "Students"]),

    el("button", {
      type: "button",
      class: "btn btn--ghost",
      onClick: () => onNavigate ? onNavigate("/timetable") : (location.hash = "#/timetable"),
    }, [icon("calendar_month"), "Timetable"]),

    el("button", {
      type: "button",
      class: "btn btn--ghost",
      onClick: () => onNavigate ? onNavigate("/marks") : (location.hash = "#/marks"),
    }, [icon("edit_note"), "Marks Entry"]),

    el("button", {
      type: "button",
      class: "btn btn--ghost",
      onClick: () => {
        // Open Command Palette if available
        const searchInput = document.querySelector(".topbar-search-input") || document.querySelector("[data-tour='topbar-search']");
        if (searchInput) {
          searchInput.click();
        } else {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
        }
      },
    }, [icon("search"), "Search (Ctrl + K)"]),

    el("button", {
      type: "button",
      class: "btn btn--ghost",
      onClick: () => history.back(),
    }, [icon("arrow_back"), "Previous Page"]),
  ]);

  wrap.append(
    illustrationMount,
    badge,
    title,
    subtitle,
    suggestionBox,
    searchContainer,
    quickTeleports
  );

  container.append(wrap);
}
