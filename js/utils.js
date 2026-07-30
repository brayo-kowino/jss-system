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
  if (!date) return "—";
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
