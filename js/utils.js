// Shared helpers used across views/components.

export function toast(message, type = "info", ms = 4000) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast${type !== "info" ? ` toast--${type}` : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Swaps the browser tab icon to a school's logo (or back to the default
// Eeskia mark when no school is resolved). Reuses the existing <link
// rel="icon"> tag if the page has one, otherwise creates it, so this is
// safe to call from any view.
export function setFavicon(url = "/assets/logo.png") {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

// Material Symbols icon helper. Usage: icon("edit") or icon("edit", "text-gold")
export function icon(name, extraClass = "") {
  return el("span", { class: `material-symbols-rounded icon${extraClass ? ` ${extraClass}` : ""}` }, name);
}

// Honest heads-up for views whose layout (wide grids, side-by-side charts,
// multi-column pickers) genuinely doesn't work well on a phone. Only shown
// on small screens (see .mobile-only-notice in css/components.css) - on
// desktop this renders nothing visible. Doesn't block or hide the content
// underneath, it just sets expectations before the person scrolls into it.
export function mobileOnlyNotice(body = "This screen is built for a larger display. It'll still work, but for the full layout it's best on a tablet or desktop.") {
  return el("div", { class: "alert alert--info mobile-only-notice" }, [
    icon("desktop_windows"),
    el("div", {}, [
      el("div", { class: "alert__title" }, "Best on a bigger screen"),
      el("div", { class: "alert__body" }, body),
    ]),
  ]);
}

// Inline loading spinner. size: "sm" | "md" | "lg". tone: "light" (for use on
// colored/filled buttons) or "dark" (for use on light backgrounds).
export function spinner(size = "sm", tone = "light") {
  return el("span", { class: `spinner spinner--${size} spinner--${tone}` });
}

// Swaps a button into a disabled, spinning "busy" state and returns a
// restore() function that puts the original label/icon back.
export function busyButton(button, busyLabel = "") {
  if (!button) return () => {};
  const originalHTML = button.innerHTML;
  const originalDisabled = button.disabled;
  const tone = button.classList.contains("btn--primary") || button.classList.contains("btn--tonal") ? "light" : "dark";
  button.disabled = true;
  button.innerHTML = "";
  button.append(spinner("sm", tone));
  if (busyLabel) button.append(document.createTextNode(` ${busyLabel}`));
  return function restore() {
    button.innerHTML = originalHTML;
    button.disabled = originalDisabled;
  };
}

// A single shimmering placeholder block. Pass a CSS width/height (e.g. "60%",
// "18px") or rely on the defaults plus a modifier class like "skeleton--circle".
export function skeleton(className = "", width, height) {
  const style = [width ? `width:${width};` : "", height ? `height:${height};` : ""].join("");
  return el("div", { class: `skeleton${className ? ` ${className}` : ""}`, ...(style ? { style } : {}) });
}

// Ready-made skeleton for a page's main content area: a title bar, a row of
// KPI/card placeholders, and a table-like block of shimmering rows. Used by
// the router while a view's async render() is still resolving, and can also
// be dropped into any view's own loading state.
export function skeletonPage({ cards = 3, rows = 6 } = {}) {
  const wrap = el("div", { class: "skeleton-page" });

  wrap.append(el("div", { class: "skeleton-page__header" }, [
    skeleton("skeleton--title", "38%"),
    skeleton("skeleton--button", "140px"),
  ]));

  if (cards > 0) {
    const cardRow = el("div", { class: "skeleton-page__cards" });
    for (let i = 0; i < cards; i++) {
      cardRow.append(el("div", { class: "skeleton-card" }, [
        skeleton("skeleton--circle"),
        el("div", { class: "skeleton-card__lines" }, [
          skeleton("", "60%"),
          skeleton("", "40%"),
        ]),
      ]));
    }
    wrap.append(cardRow);
  }

  const table = el("div", { class: "skeleton-table" });
  for (let i = 0; i < rows; i++) {
    table.append(el("div", { class: "skeleton-table__row" }, [
      skeleton("skeleton--circle skeleton--sm"),
      skeleton("", "22%"),
      skeleton("", "16%"),
      skeleton("", "12%"),
      skeleton("", "10%"),
    ]));
  }
  wrap.append(table);

  return wrap;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    // Callers commonly write conditional attributes like
    // `selected: cond ? "true" : undefined` intending "only set this when
    // cond is true." Without this guard, setAttribute(key, undefined)
    // stringifies to the literal text "undefined" and sets the attribute
    // anyway - for boolean attributes (selected, disabled, checked,
    // required, readonly) presence alone is what matters to the browser,
    // so EVERY option in a list built this way ends up "selected" and the
    // last one inserted silently wins, regardless of which one actually
    // matched the intended condition.
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp instance
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + (value.nanoseconds ? Math.floor(value.nanoseconds / 1e6) : 0));
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000 + (value._nanoseconds ? Math.floor(value._nanoseconds / 1e6) : 0));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(date) {
  const d = toDate(date);
  if (!d) return "N/A";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(date) {
  const d = toDate(date);
  if (!d) return "N/A";
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

// Namespaces a human-readable/deterministic doc ID (grade slug, subject
// code, composite keys, etc.) by school, so two schools using the same
// business key (e.g. both have a "Grade 7" or a "MATH" subject) never
// collide on the same Firestore doc.
export function scopedId(schoolId, ...parts) {
  return [schoolId, ...parts]
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map((p) => String(p).replace(/[\/\\]+/g, "-"))
    .join("__");
}

// Simple client-side guard against XSS when interpolating user text into
// innerHTML-built templates.
export function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Defense-in-depth for free-text form fields (names, remarks, notes) before
// they're saved. el() already renders text safely via textContent, so this
// isn't what stops XSS - it's here to strip stray markup/control characters
// a pasted or malicious input might carry, and to keep field lengths sane
// regardless of what a tampered client sends. Not a substitute for
// Firestore security rules, which remain the real access boundary.
export function sanitizeInput(str = "", { maxLength = 500 } = {}) {
  return String(str)
    .replace(/<[^>]*>/g, "") // strip any HTML tags entirely
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // strip control chars, keep \n \t
    .trim()
    .slice(0, maxLength);
}