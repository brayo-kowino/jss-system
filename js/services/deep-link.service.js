/**
 * Deep Linking Engine & Dynamic Route Resolver
 *
 * Provides safe parsing, building, and clipboard sharing of dynamic deep links
 * across all modules (Students, Marks, Timetable, Fees, Attendance, Settings, etc.),
 * plus smart fuzzy route resolution and the playful cosmic Alien 404 page:
 * "Oops! Aliens might have eaten that page... let's find it 🛸"
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
 * "Oops! Aliens might have eaten that page... let's find it 🛸"
 */
export function renderAlienNotFound(container, { badRoute = "", routes = {}, authed = true, onNavigate }) {
  container.innerHTML = "";

  const safeBadRoute = badRoute || location.hash || "unknown-dimension";
  const similar = findBestRouteMatch(safeBadRoute, routes);

  const wrap = el("div", { class: "alien-404-container" });

  // Floating UFO illustration with tractor beam and alien mascot
  const ufoSvg = `
    <svg class="alien-404__ufo" viewBox="0 0 240 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="beamGrad" cx="50%" cy="0%" r="90%">
          <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.45" />
          <stop offset="70%" stop-color="#818CF8" stop-opacity="0.12" />
          <stop offset="100%" stop-color="#818CF8" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="saucerBody" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#E0E7FF" />
          <stop offset="50%" stop-color="#6366F1" />
          <stop offset="100%" stop-color="#312E81" />
        </linearGradient>
        <radialGradient id="cockpit" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#A7F3D0" />
          <stop offset="70%" stop-color="#10B981" />
          <stop offset="100%" stop-color="#047857" />
        </radialGradient>
      </defs>
      <!-- Tractor Beam -->
      <polygon points="120,70 30,175 210,175" fill="url(#beamGrad)" class="alien-beam" />
      <ellipse cx="120" cy="175" rx="90" ry="10" fill="#38BDF8" fill-opacity="0.25" />
      <!-- Saucer Upper Dome -->
      <path d="M 85,62 C 85,35 155,35 155,62 Z" fill="#67E8F9" fill-opacity="0.8" stroke="#0284C7" stroke-width="2" />
      <!-- Alien Inside Cockpit -->
      <ellipse cx="120" cy="50" rx="13" ry="15" fill="url(#cockpit)" />
      <!-- Alien Antenna -->
      <line x1="120" y1="35" x2="120" y2="25" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="120" cy="22" r="4.5" fill="#FBBF24" class="alien-antenna-glow" />
      <!-- Alien Big Eyes -->
      <ellipse cx="115" cy="48" rx="3.5" ry="5" fill="#0F172A" />
      <circle cx="114" cy="46" r="1.2" fill="#FFFFFF" />
      <ellipse cx="125" cy="48" rx="3.5" ry="5" fill="#0F172A" />
      <circle cx="124" cy="46" r="1.2" fill="#FFFFFF" />
      <!-- Alien Smile -->
      <path d="M 117,57 Q 120,60 123,57" stroke="#064E3B" stroke-width="1.5" fill="none" stroke-linecap="round" />
      <!-- Main Metallic Saucer -->
      <ellipse cx="120" cy="68" rx="72" ry="18" fill="url(#saucerBody)" stroke="#4338CA" stroke-width="2.5" />
      <ellipse cx="120" cy="64" rx="60" ry="10" fill="#C7D2FE" fill-opacity="0.6" />
      <!-- Saucer Lights -->
      <circle cx="68" cy="71" r="3.5" fill="#FBBF24" class="alien-light alien-light--1" />
      <circle cx="92" cy="74" r="3.5" fill="#38BDF8" class="alien-light alien-light--2" />
      <circle cx="120" cy="75" r="4" fill="#F43F5E" class="alien-light alien-light--3" />
      <circle cx="148" cy="74" r="3.5" fill="#38BDF8" class="alien-light alien-light--4" />
      <circle cx="172" cy="71" r="3.5" fill="#FBBF24" class="alien-light alien-light--5" />
      <!-- Floating space debris / paper page being beamed up -->
      <g class="alien-page-abduction">
        <rect x="110" y="115" width="20" height="26" rx="2" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5" transform="rotate(-15 120 128)" />
        <line x1="114" y1="120" x2="124" y2="120" stroke="#CBD5E1" stroke-width="1.5" stroke-linecap="round" transform="rotate(-15 120 128)" />
        <line x1="114" y1="125" x2="124" y2="125" stroke="#CBD5E1" stroke-width="1.5" stroke-linecap="round" transform="rotate(-15 120 128)" />
        <line x1="114" y1="130" x2="120" y2="130" stroke="#CBD5E1" stroke-width="1.5" stroke-linecap="round" transform="rotate(-15 120 128)" />
      </g>
    </svg>
  `;

  const illustrationMount = el("div", { class: "alien-404__hero-art" });
  illustrationMount.innerHTML = ufoSvg;

  // Header badges & titles
  const badge = el("div", { class: "alien-404__badge" }, [
    icon("satellite_alt", "text-xs"),
    "404 · Signal Lost in Space",
  ]);

  const title = el("h1", { class: "alien-404__title" }, "Oops! Aliens might have eaten that page...");

  const subtitle = el("p", { class: "alien-404__subtitle" }, [
    "We scanned our radar across the galaxy, but couldn't find ",
    el("code", { class: "alien-bad-path" }, safeBadRoute),
    ". It may have been beamed away, mistyped, or eaten by space creatures. Let's find it!",
  ]);

  // Suggested Route Banner (if close match found)
  const suggestionBox = el("div", {});
  if (similar) {
    suggestionBox.append(
      el("div", { class: "alien-404__suggestion" }, [
        el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
          icon("travel_explore", "text-sm", "style: color:#38BDF8;"),
          el("span", {}, [
            "Radar detected a match! Did you mean ",
            el("strong", {}, similar.title),
            ` (${similar.path})?`,
          ]),
        ]),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => {
            if (onNavigate) onNavigate(similar.path);
            else location.hash = `#${similar.path}`;
          },
        }, [icon("rocket_launch", "text-xs"), `Beam to ${similar.title}`]),
      ])
    );
  }

  // Interactive "Let's Find It" Teleport Search Box
  const searchInput = el("input", {
    type: "search",
    class: "input alien-404__search-input",
    placeholder: "Type a destination (e.g. students, marks, timetable, fees, settings)…",
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
      searchResultsMount.append(el("div", { class: "alien-search-empty" }, "No cosmic routes found for that search."));
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
            icon("arrow_forward", "text-xs", "style: color:var(--color-primary-600);"),
            el("strong", {}, meta.title || p),
          ]),
          el("code", { class: "text-muted text-xs" }, `#${p}`),
        ])
      );
    }
  });

  const searchContainer = el("div", { class: "alien-404__search-wrap" }, [
    el("div", { style: "position:relative;" }, [
      icon("search", "alien-search-icon"),
      searchInput,
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
    }, [icon("rocket_launch"), `Beam to ${homeLabel}`]),

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
    }, [icon("arrow_back"), "Go Back"]),
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
