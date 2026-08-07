// Shared helpers used across views/components.

export function toast(message, type = "info", ms = 4000) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast${type !== "info" ? ` toast--${type}` : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
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

export function formatDate(date) {
  if (!date) return "N/A";
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Namespaces a human-readable/deterministic doc ID (grade slug, subject
// code, composite keys, etc.) by school, so two schools using the same
// business key (e.g. both have a "Grade 7" or a "MATH" subject) never
// collide on the same Firestore doc.
export function scopedId(schoolId, ...parts) {
  return [schoolId, ...parts].filter((p) => p !== undefined && p !== null && p !== "").join("__");
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