// Shared helpers used across views/components.

export function toast(message, type = "info", ms = 4000) {
  let root = document.getElementById("toast-root");
  if (!root) {
    if (typeof document === "undefined" || !document.body) return;
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = `toast${type !== "info" ? ` toast--${type}` : ""}`;
  el.textContent = message;
  root.appendChild(el);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add("toast--hiding");
    setTimeout(() => el.remove(), 200);
  };

  const timer = setTimeout(dismiss, ms);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
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
export function icon(name, extraClass = "", attrs = {}) {
  if (typeof extraClass === "object" && extraClass !== null) {
    attrs = extraClass;
    extraClass = "";
  }
  let finalAttrs = { class: `material-symbols-rounded icon${extraClass ? (extraClass.startsWith('style') ? '' : ` ${extraClass}`) : ""}` };
  if (typeof extraClass === 'string' && (extraClass.startsWith('style=') || extraClass.startsWith('style:'))) {
    finalAttrs.style = extraClass.replace(/^style[=:]\s*/, '').replace(/^['"]|['"]$/g, '');
  }
  if (typeof attrs === 'string' && (attrs.startsWith('style=') || attrs.startsWith('style:'))) {
    finalAttrs.style = (finalAttrs.style ? finalAttrs.style + ';' : '') + attrs.replace(/^style[=:]\s*/, '').replace(/^['"]|['"]$/g, '');
  } else if (typeof attrs === 'object') {
    finalAttrs = { ...finalAttrs, ...attrs };
  }
  return el("span", finalAttrs, name);
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
export function skeletonPage({ cards = 3, rows = 6, bigCards = 0 } = {}) {
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

  if (rows > 0) {
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
  }

  if (bigCards > 0) {
    const mainGrid = el("div", { class: "md3-main-grid", style: "margin-top: var(--sp-5);" });
    for (let i = 0; i < bigCards; i++) {
      mainGrid.append(el("div", { class: "md3-col md3-card" }, [
        skeleton("", "40%", "24px"),
        skeleton("", "100%", "200px")
      ]));
    }
    wrap.append(mainGrid);
  }

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
    else if (key === "html" || key === "innerHTML") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
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

export function getBrandColors() {
  if (typeof document === "undefined") {
    return { primary: "#14538A", accent: "#C9A227" };
  }
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--color-primary-700").trim() || "#14538A";
  const accent = styles.getPropertyValue("--color-gold").trim() || "#C9A227";
  return { primary, accent };
}

export function hexToRgba(hex, alpha = 0.1) {
  let cleanHex = hex || getBrandColors().primary;
  let clean = cleanHex.replace("#", "").trim();
  let n = parseInt(clean, 16);
  if (isNaN(n) || (clean.length !== 6 && clean.length !== 3)) {
    // If even the fallback fails, return hardcoded blue
    clean = "14538A";
    n = parseInt(clean, 16);
  }
  let r, g, b;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --------------------------------------------------------------------------
// attachSearchClear: Adds an inline clear ('✕') button to search fields
// --------------------------------------------------------------------------
export function attachSearchClear(input, options = {}) {
  if (!input || input.__hasSearchClear) return input;
  input.__hasSearchClear = true;

  const onClear = typeof options === "function" ? options : options.onClear;
  const showHotkey = options.showHotkey !== undefined ? options.showHotkey : true;
  const parent = input.parentElement;
  if (parent && typeof window !== "undefined" && window.getComputedStyle) {
    const pos = window.getComputedStyle(parent).position;
    if (pos === "static" || !pos) {
      parent.style.position = "relative";
    }
  }

  // Ensure right padding so input text doesn't flow under the clear icon
  const currentPad = parseInt(input.style.paddingRight || "0", 10);
  if (!currentPad || currentPad < 32) {
    input.style.paddingRight = "34px";
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "search-clear-btn";
  clearBtn.setAttribute("aria-label", "Clear search");
  clearBtn.setAttribute("title", "Clear search (Esc)");
  clearBtn.tabIndex = -1;
  clearBtn.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  let hintEl = null;
  if (showHotkey && typeof document !== "undefined") {
    hintEl = document.createElement("kbd");
    hintEl.className = "search-hotkey-hint";
    hintEl.setAttribute("aria-hidden", "true");
    hintEl.textContent = "/";
  }

  function update() {
    const val = input.value || "";
    const isFocused = typeof document !== "undefined" && document.activeElement === input;
    if (val.length > 0) {
      clearBtn.classList.add("is-visible");
      clearBtn.style.display = "flex";
      if (hintEl) hintEl.classList.add("is-hidden");
    } else {
      clearBtn.classList.remove("is-visible");
      clearBtn.style.display = "none";
      if (hintEl) {
        if (isFocused) {
          hintEl.classList.add("is-hidden");
        } else {
          hintEl.classList.remove("is-hidden");
        }
      }
    }
  }

  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = "";
    update();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof onClear === "function") {
      onClear();
    }
    input.focus();
  });

  input.addEventListener("input", update);
  input.addEventListener("change", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", update);

  update();

  const mountElements = (targetParent) => {
    if (!targetParent) return;
    if (hintEl && !hintEl.parentElement) targetParent.appendChild(hintEl);
    if (!clearBtn.parentElement) targetParent.appendChild(clearBtn);
  };

  if (parent) {
    mountElements(parent);
  } else if (typeof setTimeout === "function") {
    setTimeout(() => {
      if (input.parentElement) {
        if (window.getComputedStyle && window.getComputedStyle(input.parentElement).position === "static") {
          input.parentElement.style.position = "relative";
        }
        mountElements(input.parentElement);
      }
      update();
    }, 0);
  }

  return { clearBtn, hintEl, update };
}

// --------------------------------------------------------------------------
// createPasswordField: Reusable password input with show/hide eye toggle
// --------------------------------------------------------------------------
export function createPasswordField({
  id = "password",
  name,
  label = "Password",
  placeholder = "Enter password",
  required = false,
  value = "",
  autocomplete = "current-password",
  initialVisible = false,
  helpText = "",
} = {}) {
  const input = el("input", {
    id,
    ...(name ? { name } : {}),
    type: initialVisible ? "text" : "password",
    placeholder,
    ...(required ? { required: "true" } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    value,
  });

  const toggle = el(
    "button",
    {
      type: "button",
      class: "field__toggle",
      "aria-label": initialVisible ? "Hide password" : "Show password",
      tabindex: "-1",
    },
    [icon(initialVisible ? "visibility_off" : "visibility")]
  );

  toggle.addEventListener("click", () => {
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    toggle.innerHTML = "";
    toggle.append(icon(isVisible ? "visibility" : "visibility_off"));
    toggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
    input.focus();
  });

  const pwWrap = el("div", { class: "field--password" }, [input, toggle]);
  const children = [];
  if (label) {
    children.push(el("label", { for: id }, label));
  }
  children.push(pwWrap);
  if (helpText) {
    children.push(el("div", { class: "field-hint text-xs text-muted", style: "margin-top:4px;" }, helpText));
  }

  const field = el("div", { class: "field" }, children);

  return { field, input, toggle };
}

// --------------------------------------------------------------------------
// attachCurrencyInput: Auto-formats currency/numbers on blur with live preview
// --------------------------------------------------------------------------
export function attachCurrencyInput(input, options = {}) {
  if (!input || input.__hasCurrencyFormatting) return input;
  input.__hasCurrencyFormatting = true;

  const prefix = options.prefix !== undefined ? options.prefix : "KES ";
  const decimals = options.decimals !== undefined ? options.decimals : 2;
  const showLivePreview = options.showLivePreview !== undefined ? options.showLivePreview : true;

  input.inputMode = "decimal";

  const cleanNumeric = (val) => {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[^0-9.]/g, "");
  };

  const normalizeRaw = (val) => {
    const clean = cleanNumeric(val);
    if (!clean) return "";
    const n = Number(clean);
    if (Number.isNaN(n)) return clean;
    if (clean.includes(".") && !clean.endsWith(".00") && !clean.endsWith(".0")) {
      return clean;
    }
    return n % 1 === 0 ? String(Math.round(n)) : String(n);
  };

  const formatNumber = (numStr) => {
    const clean = cleanNumeric(numStr);
    if (!clean) return "";
    const n = Number(clean);
    if (Number.isNaN(n)) return "";
    return `${prefix}${n.toLocaleString("en-KE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  };

  // Preview element
  let previewEl = null;
  if (showLivePreview && typeof document !== "undefined") {
    previewEl = document.createElement("div");
    previewEl.className = "currency-live-preview is-empty";
    const updatePreview = () => {
      const formatted = formatNumber(input.value);
      if (formatted) {
        previewEl.textContent = `Formatted: ${formatted}`;
        previewEl.classList.remove("is-empty");
      } else {
        previewEl.textContent = "";
        previewEl.classList.add("is-empty");
      }
    };
    input.addEventListener("input", updatePreview);

    const attachPreview = () => {
      if (input.parentElement && !previewEl.parentElement) {
        input.parentElement.appendChild(previewEl);
      }
      updatePreview();
    };
    if (input.parentElement) {
      attachPreview();
    } else if (typeof setTimeout === "function") {
      setTimeout(attachPreview, 0);
    }
  }

  // Initialize data-raw-value if input already has a value
  if (input.value) {
    const raw = normalizeRaw(input.value);
    input.dataset.rawValue = raw;
    input.value = formatNumber(raw);
  }

  // Focus: show clean digits for straightforward editing
  input.addEventListener("focus", () => {
    const raw = input.dataset.rawValue || normalizeRaw(input.value);
    if (raw) {
      input.value = raw;
    }
  });

  // Blur: format nicely
  input.addEventListener("blur", () => {
    const raw = normalizeRaw(input.value);
    input.dataset.rawValue = raw;
    if (raw) {
      input.value = formatNumber(raw);
    } else {
      input.value = "";
    }
  });

  // Input event: track raw value
  input.addEventListener("input", () => {
    input.dataset.rawValue = normalizeRaw(input.value);
  });

  // Intercept form submit to ensure raw numeric string is read
  const attachFormHandler = () => {
    const form = input.form || input.closest?.("form");
    if (form && !form.__hasCurrencySubmitInterceptors) {
      form.__hasCurrencySubmitInterceptors = true;
      form.addEventListener("submit", () => {
        const allCurr = form.querySelectorAll("[data-raw-value]");
        allCurr.forEach((el) => {
          if (el.dataset.rawValue !== undefined) {
            el.value = el.dataset.rawValue;
          }
        });
      }, true);
    }
  };

  if (input.form || input.closest?.("form")) {
    attachFormHandler();
  } else if (typeof setTimeout === "function") {
    setTimeout(attachFormHandler, 0);
  }

  Object.defineProperty(input, "numericValue", {
    get: () => {
      const raw = input.dataset.rawValue || cleanNumeric(input.value);
      return raw ? Number(raw) || 0 : 0;
    },
    configurable: true,
  });

  return {
    previewEl,
    getCleanValue: () => input.dataset.rawValue || cleanNumeric(input.value),
  };
}

// --------------------------------------------------------------------------
// makeCopyable: Attaches click-to-copy with spring-animated micro-tooltip
// --------------------------------------------------------------------------
export function makeCopyable(elOrSelector, textToCopy, options = {}) {
  const target = typeof elOrSelector === "string" && typeof document !== "undefined"
    ? document.querySelector(elOrSelector)
    : elOrSelector;
  if (!target || typeof target.addEventListener !== "function") return null;

  target.classList.add("copyable-text");
  target.setAttribute("title", options.title || "Click to copy");
  target.setAttribute("role", "button");
  target.tabIndex = 0;

  // Add copy icon if not already present
  if (typeof document !== "undefined" && !target.querySelector(".copyable-text__icon")) {
    const iconSpan = document.createElement("span");
    iconSpan.className = "material-symbols-rounded copyable-text__icon";
    iconSpan.textContent = "content_copy";
    target.appendChild(iconSpan);
  }

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const text = typeof textToCopy === "function"
      ? textToCopy()
      : (textToCopy !== undefined && textToCopy !== null ? String(textToCopy) : target.textContent.trim());

    if (!text) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const temp = document.createElement("textarea");
        temp.value = text;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }

      if (typeof document !== "undefined") {
        target.querySelectorAll(".copied-tooltip").forEach((t) => t.remove());

        const tooltip = document.createElement("div");
        tooltip.className = "copied-tooltip";
        tooltip.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>${options.successText || "Copied!"}</span>
        `;
        target.appendChild(tooltip);

        setTimeout(() => {
          tooltip.remove();
        }, 1500);
      }

      if (typeof options.onCopied === "function") {
        options.onCopied(text);
      }
    } catch (err) {
      console.warn("[Copyable] Failed to copy:", err);
      toast("Could not copy to clipboard", "error");
    }
  };

  target.addEventListener("click", handleCopy);
  target.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      handleCopy(e);
    }
  });

  return target;
}

// --------------------------------------------------------------------------
// renderEmptyState: Renders smart, actionable empty states with reset button
// --------------------------------------------------------------------------
export function renderEmptyState({
  iconName = "search_off",
  title = "No matching records found",
  message = "Try adjusting your search query or active filters.",
  onReset,
  resetText = "Clear filters & search",
  actionBtn,
} = {}) {
  const card = el("div", { class: "empty-state--smart card" }, [
    el("div", { class: "empty-state--smart__halo" }, [icon(iconName)]),
    el("h3", { class: "empty-state--smart__title" }, title),
    el("p", { class: "empty-state--smart__msg" }, message),
  ]);

  if (typeof onReset === "function") {
    const btn = el(
      "button",
      {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: (e) => {
          e.preventDefault();
          onReset();
          toast("Filters cleared", "info", 1800);
        },
      },
      [icon("restart_alt"), resetText]
    );
    card.appendChild(btn);
  } else if (actionBtn) {
    card.appendChild(actionBtn);
  }

  return card;
}

// --------------------------------------------------------------------------
// animateNumber: Metric count-up tween for dashboard KPI numbers
// --------------------------------------------------------------------------
export function animateNumber(element, target, options = {}) {
  if (!element) return;
  const targetNum = Number(target);
  if (Number.isNaN(targetNum)) {
    element.textContent = String(target ?? "");
    return;
  }

  const duration = options.duration !== undefined ? options.duration : 450;
  const decimals = options.decimals !== undefined ? options.decimals : 0;
  const prefix = options.prefix || "";
  const suffix = options.suffix || "";

  const format = options.formatNumber || ((n) => {
    return `${prefix}${n.toLocaleString("en-KE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;
  });

  // Respect user preference for reduced motion
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    element.textContent = format(targetNum);
    return;
  }

  const start = 0;
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Cubic ease-out: 1 - (1 - t)^3
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + (targetNum - start) * easeOut;

    element.textContent = format(current);

    if (progress < 1) {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(step);
      } else {
        element.textContent = format(targetNum);
      }
    } else {
      element.textContent = format(targetNum);
    }
  }

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(step);
  } else {
    element.textContent = format(targetNum);
  }
}

