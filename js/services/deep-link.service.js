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
 * Renders the clean, institutional 404 screen:
 * "Page Not Found · Institutional Directory"
 */
export function renderAlienNotFound(container, { badRoute = "", routes = {}, authed = true, onNavigate }) {
  container.innerHTML = "";

  const safeBadRoute = badRoute || location.hash || "unknown-destination";
  const similar = findBestRouteMatch(safeBadRoute, routes);

  const wrap = el("div", { class: "alien-404-container eeskia-404-container" });

  // Bespoke Eeskia Institutional Compass & Directory Crest
  const crestSvg = `
    <svg class="alien-404__ufo eeskia-404__crest" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Institutional Directory Navigator">
      <circle cx="50" cy="50" r="46" fill="var(--color-cream-dim, #F8FAFC)" stroke="var(--color-line, #CBD5E1)" stroke-width="1.5" />
      <circle cx="50" cy="50" r="39" stroke="var(--color-gold, #C9A227)" stroke-width="1" stroke-dasharray="2,3" opacity="0.8" />
      
      <!-- Compass Axis Lines -->
      <line x1="50" y1="12" x2="50" y2="18" stroke="var(--color-primary-800, #133B68)" stroke-width="2" stroke-linecap="round" />
      <line x1="50" y1="82" x2="50" y2="88" stroke="var(--color-primary-800, #133B68)" stroke-width="2" stroke-linecap="round" />
      <line x1="12" y1="50" x2="18" y2="50" stroke="var(--color-primary-800, #133B68)" stroke-width="2" stroke-linecap="round" />
      <line x1="82" y1="50" x2="88" y2="50" stroke="var(--color-primary-800, #133B68)" stroke-width="2" stroke-linecap="round" />

      <!-- Compass Star Facets -->
      <polygon points="50,22 55,42 68,34 58,47 78,50 58,53 68,66 55,58 50,78 45,58 32,66 42,53 22,50 42,47 32,34 45,42" fill="var(--color-primary-900, #0B2545)" opacity="0.08" />
      
      <!-- Primary Cardinal Star Pointers -->
      <polygon points="50,22 54,48 50,50" fill="var(--color-gold, #C9A227)" />
      <polygon points="50,22 46,48 50,50" fill="var(--color-primary-800, #133B68)" />
      <polygon points="50,78 54,52 50,50" fill="var(--color-primary-600, #1E6FB5)" />
      <polygon points="50,78 46,52 50,50" fill="var(--color-primary-900, #0B2545)" />
      <polygon points="78,50 52,54 50,50" fill="var(--color-gold, #C9A227)" />
      <polygon points="78,50 52,46 50,50" fill="var(--color-primary-800, #133B68)" />
      <polygon points="22,50 48,54 50,50" fill="var(--color-primary-600, #1E6FB5)" />
      <polygon points="22,50 48,46 50,50" fill="var(--color-primary-900, #0B2545)" />

      <!-- Center Pivot Jewel -->
      <circle cx="50" cy="50" r="5" fill="var(--color-gold, #C9A227)" stroke="#FFFFFF" stroke-width="1.5" />
      <circle cx="50" cy="50" r="2" fill="var(--color-primary-900, #0B2545)" />
    </svg>
  `;

  const illustrationMount = el("div", { class: "alien-404__hero-art eeskia-404__art" });
  illustrationMount.innerHTML = crestSvg;

  // Header badges & titles
  const badge = el("div", { class: "alien-404__badge eeskia-404__badge" }, [
    el("span", { class: "alien-badge-dot" }),
    "404 · Page Not Found",
  ]);

  const title = el("h1", { class: "alien-404__title eeskia-404__title" }, "Page Not Found");

  const subtitle = el("p", { class: "alien-404__subtitle eeskia-404__subtitle" }, [
    "The requested destination ",
    el("code", { class: "alien-bad-path" }, safeBadRoute),
    " could not be located in the system directory. It may have been moved, renamed, or typed incorrectly.",
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
