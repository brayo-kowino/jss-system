import { getSchoolSettings, saveSchoolSettings, uploadSchoolLogo, isSlugAvailable, publishSchoolBranding, slugify, SLUG_PREFIX } from "../js/services/settings.service.js";
import { activateSubscription, getSubscriptionState, SUBSCRIPTION_PLANS, REVOKE_REASONS, isStarterPlan } from "../js/services/subscription.service.js";
import { invalidateSchoolSettingsCache, refreshSchoolChrome, updateThemeColor, showApprovalModal } from "../js/components/shell.js";
import { getCurrentSchoolId, refreshCurrentSchool, getCurrentProfile } from "../js/services/auth.service.js";
import { THEME_PRESETS, matchThemeId } from "../js/theme-presets.js";
import { el, icon, toast, busyButton, formatDate } from "../js/utils.js";
import { datePickerField } from "../js/components/datepicker.js";
import { listTrustedDevices, removeTrustedDevice, resetAllTrustedDevices } from "../js/services/device.service.js";
import { listRecentApprovals } from "../js/services/login-approval.service.js";
import { generate2FASetup, enable2FA, disable2FA, is2FAEnabled } from "../js/services/two-factor.service.js";
import { extractLogoPalette } from "../js/services/logo-palette.js";

let settings = null;
let activeThemeId = "custom";
let gradingRowSeq = 0;

const TABS = [
  { id: "profile", label: "Profile", icon: "domain" },
  { id: "branding", label: "Branding", icon: "palette" },
  { id: "leadership", label: "Leadership", icon: "badge" },
  { id: "calendar", label: "Calendar", icon: "event" },
  { id: "grading", label: "Grading", icon: "grading" },
  { id: "notifications", label: "Notifications", icon: "notifications_active" },
  { id: "security", label: "Security", icon: "shield" },
  { id: "subscription", label: "Subscription", icon: "workspace_premium" },
];

/**
 * Reusable professional tooltip component with dark backdrop and directional alignment.
 */
function infoTooltip(title, text, align = "center") {
  const alignClass = align === "right" ? " tooltip-bubble--right" : (align === "left" ? " tooltip-bubble--left" : "");
  return el("span", {
    class: "tooltip-wrap tooltip-wrap--inline",
    tabindex: "0",
    role: "button",
    "aria-label": title,
  }, [
    el("span", { class: "tooltip-trigger-icon material-symbols-rounded" }, "help"),
    el("span", { class: `tooltip-bubble tooltip-bubble--wide${alignClass}`, role: "tooltip" }, [
      el("span", { class: "tooltip-bubble__title" }, [
        icon("info"),
        title,
      ]),
      el("span", { class: "tooltip-bubble__text" }, text),
    ]),
  ]);
}

/**
 * Standard text or date field with optional informative tooltip.
 */
function field(id, label, value = "", type = "text", full = false, tooltip = null) {
  if (type === "date") {
    return datePickerField(id, label, value, {}, full);
  }
  const labelChildren = [label];
  if (tooltip) {
    labelChildren.push(infoTooltip(tooltip.title, tooltip.text, tooltip.align));
  }
  return el("div", { class: `field${full ? " field--full" : ""}` }, [
    el("label", { for: id }, labelChildren),
    el("input", { id, type, value: value || "" }),
  ]);
}

/**
 * Password field equipped with a show/hide toggle.
 */
function passwordField(id, label, value = "", tooltip = null, placeholder = "") {
  const labelChildren = [label];
  if (tooltip) {
    labelChildren.push(infoTooltip(tooltip.title, tooltip.text, tooltip.align));
  }
  const input = el("input", {
    id,
    type: "password",
    value: value || "",
    placeholder: placeholder || "",
    autocomplete: "off",
  });
  const toggleBtn = el("button", {
    type: "button",
    class: "input-with-action__btn",
    title: "Toggle visibility",
    tabindex: "-1",
    onClick: () => {
      const isPass = input.type === "password";
      input.type = isPass ? "text" : "password";
      toggleBtn.innerHTML = "";
      toggleBtn.append(icon(isPass ? "visibility_off" : "visibility"));
    },
  }, [icon("visibility")]);

  return el("div", { class: "field" }, [
    el("label", { for: id }, labelChildren),
    el("div", { class: "input-with-action" }, [input, toggleBtn]),
  ]);
}

export async function render({ profile }) {
  settings = await getSchoolSettings();
  activeThemeId = settings.themeId || matchThemeId(settings.themeColor, settings.secondaryColor);

  const wrap = el("div", { class: "settings-page" });

  // Refined header with institutional title and quick context badge
  wrap.append(
    el("div", { class: "settings-header" }, [
      el("div", {}, [
        el("p", { class: "settings-header__desc" }, "Configure your institution's profile, visual branding, academic schedule, CBC grading scale, and security controls."),
      ]),
      el("div", { class: "settings-header__badge" }, [
        icon("domain"),
        settings.schoolName || "My School",
      ]),
    ])
  );

  const panels = {};
  const tabsNav = el("div", { class: "profile-tabs" });

  for (const t of TABS) {
    panels[t.id] = el("div", { class: "settings-tab-panel", id: `panel-${t.id}` });
    tabsNav.append(
      el(
        "button",
        {
          type: "button",
          class: `profile-tab${t.id === "profile" ? " profile-tab--active" : ""}`,
          "data-tab": t.id,
          onClick: () => switchTab(t.id, tabsNav, panels),
        },
        [icon(t.icon), t.label]
      )
    );
  }

  panels.profile.style.display = "";
  for (const t of TABS.slice(1)) panels[t.id].style.display = "none";

  panels.profile.append(buildProfileTab());
  panels.branding.append(buildBrandingTab());
  panels.leadership.append(buildLeadershipTab());
  panels.calendar.append(buildCalendarTab());
  panels.grading.append(buildGradingTab());
  panels.notifications.append(buildNotificationsTab());

  // Security tab - only for admin/super_admin
  if (profile.role === "admin" || profile.role === "super_admin") {
    panels.security.append(buildSecurityPanel(profile));
  }

  panels.subscription.append(buildSubscriptionTab());

  wrap.append(tabsNav);
  for (const t of TABS) wrap.append(panels[t.id]);

  return wrap;
}

function switchTab(tabId, tabsNav, panels) {
  for (const btn of tabsNav.querySelectorAll(".profile-tab")) {
    btn.classList.toggle("profile-tab--active", btn.dataset.tab === tabId);
  }
  for (const t of TABS) panels[t.id].style.display = t.id === tabId ? "" : "none";
}

// ===========================================================================
// Profile tab
// ===========================================================================

function buildProfileTab() {
  const wrap = el("div", { class: "settings-stack" });
  const form = el("form", { id: "settings-form" });

  // 1. General Institution Details Card
  const infoCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [icon("account_balance"), "Institution Profile"]),
    el("p", { class: "settings-card__sub" }, "Official school identity and contact details printed on terminal report cards, fee receipts, and newsletters."),
    el("div", { class: "settings-form-grid" }, [
      field("schoolName", "School Name", settings.schoolName, "text", false, {
        title: "Official Name",
        text: "The full legal name of your institution as recognized by educational authorities.",
      }),
      field("motto", "Motto / Slogan", settings.motto, "text", false, {
        title: "School Motto",
        text: "Featured on report card letterheads, student newsletters, and certificates.",
      }),
      field("address", "Physical & Postal Address", settings.address, "text", true, {
        title: "Official Address",
        text: "P.O. Box, county, town, or street address displayed on official documents.",
      }),
      field("phone", "Telephone Contact", settings.phone, "text", false, {
        title: "Administrative Phone",
        text: "Primary contact phone number for parent communications.",
      }),
      field("email", "Official Email", settings.email, "email", false, {
        title: "Administrative Email",
        text: "Official email address used for administrative dispatches and parent replies.",
      }),
    ]),
  ]);

  // 2. Branded Sign-in Portal Card
  const portalCard = buildLoginLinkCard();

  form.append(
    infoCard,
    portalCard,
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Profile"]),
    ])
  );

  wrap.append(form);
  return wrap;
}

// ===========================================================================
// Login link card - the school's own branded sign-in link/code, so staff
// don't land on the generic "Eeskia" login screen every time.
// ===========================================================================

// Strips the fixed SLUG_PREFIX off a full saved slug, leaving just the part
// the school actually chose (what the input field shows/edits).
function slugSuffix(fullSlug) {
  const clean = slugify(fullSlug || "");
  const withDash = `${SLUG_PREFIX}-`;
  return clean.startsWith(withDash) ? clean.slice(withDash.length) : clean;
}

// Rebuilds the full, prefixed slug from whatever the school typed into the
// editable part of the field.
function buildFullSlug(suffixRaw) {
  const cleanSuffix = slugify(suffixRaw || "");
  return cleanSuffix ? `${SLUG_PREFIX}-${cleanSuffix}` : "";
}

// Exposes the login-link card's live state to the profile form's submit
// handler, so a save can (a) read the real full slug and (b) tell the card
// its pending edit is now persisted, clearing the "not saved yet" warning.
let loginLinkUI = null;

function buildLoginLinkCard() {
  const card = el("div", { class: "card settings-card" });

  card.append(
    el("h3", {}, [
      icon("link"),
      "School Sign-In Portal URL",
      infoTooltip(
        "Custom Sign-in URL",
        "Provides a direct link with your school's branding preloaded. Staff and parents skip generic login pages and land immediately on your branded portal."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Share this custom address with staff and parents. Each code starts with “ees-” to guarantee unique global identification.")
  );

  const initialSuffix = settings.slug ? slugSuffix(settings.slug) : slugify(settings.schoolName || "");
  const prefixBadge = el("span", { class: "slug-input__prefix" }, `${SLUG_PREFIX}-`);
  const codeInput = el("input", {
    id: "school-slug",
    type: "text",
    value: initialSuffix,
    placeholder: "e.g. greenhill-jss",
    maxlength: "36",
  });
  const inputGroup = el("div", { class: "slug-input-group" }, [prefixBadge, codeInput]);

  const availabilityMsg = el("div", { class: "text-sm", id: "slug-availability", style: "min-height:20px;margin-top:4px;" });
  const unsavedMsg = el("div", { class: "text-sm", id: "slug-unsaved", style: "min-height:20px;color:var(--color-gold);display:none;" }, [
    icon("info", "text-sm"), " Code changed — click “Save Profile” below to activate this URL.",
  ]);
  const linkPreview = el("div", { class: "slug-preview-chip", id: "slug-link-preview", style: "margin-top:8px;" });
  const copyBtn = el("button", { type: "button", class: "btn btn--ghost btn--sm", id: "copy-login-link" }, [icon("content_copy"), "Copy URL"]);

  function loginLinkFor(slug) {
    return `${location.origin}${location.pathname}?school=${slug}`;
  }
  function currentFullSlug() {
    return buildFullSlug(codeInput.value);
  }
  function isDirty() {
    return currentFullSlug() !== (settings.slug || "");
  }
  function refreshPreview() {
    const full = currentFullSlug();
    linkPreview.textContent = full ? loginLinkFor(full) : "Enter a school code above to generate your portal URL.";
  }
  function refreshDirtyState() {
    unsavedMsg.style.display = isDirty() && currentFullSlug() ? "" : "none";
  }
  refreshPreview();
  refreshDirtyState();

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toLowerCase().replace(/[^a-z0-9-\s]/g, "");
    refreshPreview();
    refreshDirtyState();
    availabilityMsg.textContent = "";
  });

  codeInput.addEventListener("blur", async () => {
    const full = currentFullSlug();
    if (!full) return;
    if (full === settings.slug) {
      availabilityMsg.textContent = "";
      return;
    }
    availabilityMsg.textContent = "Checking code availability…";
    availabilityMsg.style.color = "var(--color-ink-soft)";
    const available = await isSlugAvailable(full, getCurrentSchoolId()).catch(() => false);
    availabilityMsg.textContent = available ? "Code is available." : "That code is already claimed by another institution.";
    availabilityMsg.style.color = available ? "var(--color-green)" : "var(--color-red)";
  });

  copyBtn.addEventListener("click", async () => {
    const full = currentFullSlug() || settings.slug;
    if (!full) {
      toast("Set a school code first, then save.", "error");
      return;
    }
    if (isDirty()) {
      toast("Save your profile first so this link becomes active.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(loginLinkFor(full));
      toast("Sign-in portal link copied to clipboard.", "success");
    } catch {
      toast("Could not copy automatically — copy the link text manually.", "error");
    }
  });

  card.append(
    el("div", { class: "field" }, [
      el("label", { for: "school-slug" }, [
        "Unique School Code",
        infoTooltip("School Code Prefix", "The prefix 'ees-' is automatically prepended to ensure conflict-free global routing across all schools."),
      ]),
      inputGroup,
      availabilityMsg,
      unsavedMsg,
    ]),
    el("div", { style: "display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:8px;" }, [
      linkPreview,
      copyBtn,
    ])
  );

  loginLinkUI = { refreshPreview, refreshDirtyState };
  return card;
}

// ===========================================================================
// Branding & Themes tab
// ===========================================================================

function buildBrandingTab() {
  const wrap = el("div", { class: "settings-stack" });
  const form = el("form", { id: "branding-form" });

  const grid = el("div", { class: "settings-studio-grid" });

  // ---------------------------------------------------------------------------
  // Left Column: Identity & Palette Controls
  // ---------------------------------------------------------------------------
  const leftCol = el("div", { class: "settings-stack" });

  // 1. School Crest / Logo Card
  const logoCard = el("div", { class: "card settings-card" });
  logoCard.append(
    el("h3", {}, [
      icon("photo_camera"),
      "School Crest & Logo",
      infoTooltip("Official Emblem", "Appears in high-resolution on the navigation sidebar, student report cards, leaving certificates, and official receipts."),
    ]),
    el("p", { class: "settings-card__sub" }, "PNG or JPG with transparent or light background recommended (min 200×200px).")
  );

  const logoRow = el("div", { class: "brand-logo-row" });
  const logoPreview = el(
    "div",
    { class: "brand-logo-preview", id: "logo-preview" },
    settings.logoUrl
      ? el("img", { src: settings.logoUrl, alt: "School Crest" })
      : el("span", { class: "material-symbols-rounded" }, "photo_camera")
  );
  logoRow.append(
    logoPreview,
    el("div", { style: "flex:1; min-width:200px;" }, [
      el("input", { type: "file", id: "logo-input", accept: "image/*" }),
      el("p", { class: "text-sm text-muted", style: "margin-top:6px;" }, "Select an image file from your computer."),
    ])
  );
  logoCard.append(logoRow);

  // Smart Theme box embedded inside Logo card
  const hasLogoNow = !!settings.logoUrl;
  const smartThemeBox = el("div", { class: "smart-theme-box" }, [
    el("div", { style: "flex:1; min-width:180px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:6px; font-weight:600; font-size:var(--fs-sm); color:var(--color-primary-900);" }, [
        el("span", { class: "material-symbols-rounded", style: "font-size:18px; color:var(--color-gold);" }, "auto_awesome"),
        "Smart Theme Extractor",
        infoTooltip("Color Extraction", "Uses color clustering to sample the primary hue and matching accent tone directly from your school emblem."),
      ]),
      el("p", { class: "text-sm text-muted", style: "margin:2px 0 0;" }, "Detect dominant brand colors from your crest."),
    ]),
    el("button", {
      type: "button",
      id: "smart-theme-btn",
      class: "btn btn--ghost btn--sm",
      ...(hasLogoNow ? {} : { disabled: true, title: "Upload a logo first, then extract palette." }),
    }, [
      icon("colorize"),
      "Extract Palette",
    ]),
  ]);
  logoCard.append(smartThemeBox);
  leftCol.append(logoCard);

  // 2. Custom Colors Fine-Tuning Card
  const customCard = el("div", { class: "card settings-card" });
  customCard.append(
    el("h3", {}, [
      icon("tune"),
      "Color Palette",
      infoTooltip("Theme Colors", "Primary color is applied to the main navigation, headers, and major buttons. Accent color provides high-contrast badges, chips, and progress indicators."),
    ]),
    el("p", { class: "settings-card__sub" }, "Fine-tune specific hex shades to match your institution's official brand guidelines.")
  );

  const brandingRow = el("div", { style: "display:flex; gap:16px; flex-wrap:wrap;" }, [
    el("div", { class: "field", style: "flex:1; min-width:140px;" }, [
      el("label", { for: "themeColor" }, "Primary Color"),
      el("input", { id: "themeColor", type: "color", value: settings.themeColor || "#14538A" }),
    ]),
    el("div", { class: "field", style: "flex:1; min-width:140px;" }, [
      el("label", { for: "secondaryColor" }, "Accent Color"),
      el("input", { id: "secondaryColor", type: "color", value: settings.secondaryColor || "#C9A227" }),
    ]),
  ]);
  customCard.append(brandingRow);
  leftCol.append(customCard);

  // ---------------------------------------------------------------------------
  // Right Column: Live Interactive Preview & Preset Gallery
  // ---------------------------------------------------------------------------
  const rightCol = el("div", { class: "settings-stack" });

  // 3. Live Preview Card
  const previewCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [
      icon("visibility"),
      "Live Dashboard Preview",
      infoTooltip("Theme Simulation", "A live simulation of your dashboard UI, topbar accents, and button styles responding dynamically to your color choices."),
    ]),
    el("p", { class: "settings-card__sub" }, "Real-time preview of how your brand colors appear across the system."),
    buildThemePreview(),
  ]);
  rightCol.append(previewCard);

  // 4. Presets Gallery Card
  const galleryCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [icon("style"), "Curated Theme Presets"]),
    el("p", { class: "settings-card__sub" }, "Pre-tuned institutional palettes. Click any preset to apply it immediately."),
  ]);
  const gallery = el("div", { class: "theme-gallery", id: "theme-gallery" });
  for (const t of THEME_PRESETS) gallery.append(themeCard(t));
  galleryCard.append(gallery);
  rightCol.append(galleryCard);

  grid.append(leftCol, rightCol);
  form.append(grid);

  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Branding"]),
    ])
  );

  wrap.append(form);
  return wrap;
}

function themeCard(t) {
  const isActive = activeThemeId === t.id;
  const card = el(
    "button",
    {
      type: "button",
      class: `theme-card${isActive ? " theme-card--active" : ""}`,
      "data-theme-id": t.id,
      onClick: () => applyThemePreset(t),
    },
    [
      el("div", { class: "theme-card__swatches" }, [
        el("span", { class: "theme-card__dot", style: `background:${t.primary};` }),
        el("span", { class: "theme-card__dot", style: `background:${t.secondary};` }),
      ]),
      el("div", { class: "theme-card__body" }, [
        el("div", { class: "theme-card__name" }, t.name),
        el("div", { class: "theme-card__desc" }, t.description),
      ]),
      el("span", { class: "theme-card__status" }, isActive ? [icon("check_circle"), "Installed"] : "Apply"),
    ]
  );
  return card;
}

function applyThemePreset(t) {
  activeThemeId = t.id;
  document.getElementById("themeColor").value = t.primary;
  document.getElementById("secondaryColor").value = t.secondary;
  for (const c of document.querySelectorAll(".theme-card")) {
    const active = c.dataset.themeId === t.id;
    c.classList.toggle("theme-card--active", active);
    const status = c.querySelector(".theme-card__status");
    status.innerHTML = "";
    status.append(...(active ? [icon("check_circle")] : []), active ? "Installed" : "Apply");
  }
  updateThemePreview(t.primary, t.secondary);
  updateThemeColor(t.primary);
  toast(`${t.name} theme ready to save.`, "info", 2500);
}

function buildThemePreview() {
  const preview = el("div", { class: "theme-preview", id: "theme-preview" }, [
    el("div", { class: "theme-preview__sidebar", id: "preview-sidebar" }, [
      el("div", { class: "theme-preview__logo-mark" }, [
        el("span", { class: "theme-preview__dot" }),
        el("span", { class: "theme-preview__brand-name" }),
      ]),
      el("div", { class: "theme-preview__nav-item theme-preview__nav-item--active" }, [
        el("span", { class: "theme-preview__line" }),
      ]),
      el("div", { class: "theme-preview__nav-item" }, [
        el("span", { class: "theme-preview__line", style: "width:50%;" }),
      ]),
      el("div", { class: "theme-preview__nav-item" }, [
        el("span", { class: "theme-preview__line", style: "width:65%;" }),
      ]),
    ]),
    el("div", { class: "theme-preview__main" }, [
      el("div", { class: "theme-preview__topbar" }, [
        el("span", { class: "theme-preview__topbar-title" }),
        el("span", { class: "theme-preview__topbar-chip", id: "preview-chip" }, "Term 1"),
      ]),
      el("div", { class: "theme-preview__body" }, [
        el("div", { class: "theme-preview__card" }, [
          el("span", { style: "font-size:11px; font-weight:600; color:var(--color-ink);" }, "Academic Portal"),
          el("span", { class: "theme-preview__btn", id: "preview-btn" }, "Action"),
        ]),
      ]),
    ]),
  ]);
  requestAnimationFrame(() => updateThemePreview(settings.themeColor, settings.secondaryColor));
  return preview;
}

function updateThemePreview(primary, secondary) {
  const sidebar = document.getElementById("preview-sidebar");
  const btn = document.getElementById("preview-btn");
  const chip = document.getElementById("preview-chip");
  if (sidebar) sidebar.style.background = primary;
  if (btn) btn.style.background = primary;
  if (chip) {
    chip.style.background = secondary;
    chip.style.color = "#3a2f0b";
  }
}

// ===========================================================================
// Leadership tab
// ===========================================================================

function buildLeadershipTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [
      icon("badge"),
      "School Leadership & Signatories",
      infoTooltip(
        "Official Signatories",
        "Names and designated titles appear on terminal student report cards, certificates of completion, official newsletters, and disciplinary notices."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Designate the executive officers authorized to sign institutional documents and report cards.")
  );

  const form = el("form", { id: "leadership-form" });

  const grid = el("div", { class: "leadership-grid" });

  const principalGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [icon("military_tech"), "School Head / Principal"]),
    field("principalName", "Full Legal Name", settings.principalName, "text", false, {
      title: "Principal Name",
      text: "Full name as it should appear above the official signature line.",
    }),
    field("principalTitle", "Official Designation / Title", settings.principalTitle || "Principal", "text", false, {
      title: "Designation",
      text: "Title printed on official documents, e.g. 'Principal', 'Head Teacher', or 'Director'.",
    }),
  ]);

  const deputyGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [icon("school"), "Deputy Principal / Academic Head"]),
    field("deputyPrincipalName", "Full Legal Name", settings.deputyPrincipalName, "text", false, {
      title: "Deputy Name",
      text: "Full name of the Deputy Principal or Dean of Studies.",
    }),
    field("deputyPrincipalTitle", "Official Designation / Title", settings.deputyPrincipalTitle || "Deputy Principal", "text", false, {
      title: "Designation",
      text: "Title printed on academic transcripts and attendance notices.",
    }),
  ]);

  grid.append(principalGroup, deputyGroup);
  form.append(grid);

  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Leadership"]),
    ])
  );

  card.append(form);
  return card;
}

// ===========================================================================
// Academic calendar tab
// ===========================================================================

function buildCalendarTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [
      icon("event_note"),
      "Academic Schedule & Term Milestones",
      infoTooltip(
        "Reporting Term",
        "Configuring the active term controls where new marks, attendance records, and fee allocations are recorded. Reopening dates automatically appear on report cards."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Set the active operational term and schedule key milestone dates.")
  );

  const calForm = el("form", { id: "calendar-form" });

  // 1. Term Identification
  const termSelect = el("select", { id: "currentTerm" });
  for (const term of settings.terms || ["Term 1", "Term 2", "Term 3"]) {
    termSelect.append(el("option", { value: term, ...(term === settings.currentTerm ? { selected: "true" } : {}) }, term));
  }

  const topRow = el("div", { class: "settings-form-grid" }, [
    field("currentAcademicYear", "Academic Year", settings.currentAcademicYear || new Date().getFullYear().toString(), "text", false, {
      title: "Academic Year",
      text: "The current operational calendar year (e.g. 2026).",
    }),
    el("div", { class: "field" }, [
      el("label", { for: "currentTerm" }, [
        "Active Reporting Term",
        infoTooltip("Active Term", "All new marks entries, attendance sheets, and fee invoices default to this active term."),
      ]),
      termSelect,
    ]),
  ]);

  // 2. Timeline visualizer
  const timeline = el("div", { class: "settings-timeline" }, [
    el("div", { class: "settings-timeline__step" }, [
      el("span", { class: "settings-timeline__icon material-symbols-rounded" }, "login"),
      el("span", { class: "settings-timeline__label" }, "Term Begins"),
      el("span", { class: "settings-timeline__date" }, settings.termBegins ? formatDate(settings.termBegins) : "Not set"),
    ]),
    el("div", { class: "settings-timeline__connector" }),
    el("div", { class: "settings-timeline__step" }, [
      el("span", { class: "settings-timeline__icon material-symbols-rounded" }, "school"),
      el("span", { class: "settings-timeline__label" }, "School Closes"),
      el("span", { class: "settings-timeline__date" }, settings.closingDate ? formatDate(settings.closingDate) : "Not set"),
    ]),
    el("div", { class: "settings-timeline__connector" }),
    el("div", { class: "settings-timeline__step" }, [
      el("span", { class: "settings-timeline__icon material-symbols-rounded" }, "event_upcoming"),
      el("span", { class: "settings-timeline__label" }, "Next Term Opens"),
      el("span", { class: "settings-timeline__date" }, settings.openingDate ? formatDate(settings.openingDate) : "Not set"),
    ]),
  ]);

  // 3. Milestone Date Pickers
  const dateRow = el("div", { class: "settings-form-grid", style: "margin-top:16px;" }, [
    field("termBegins", "Current Term Begins", settings.termBegins, "date"),
    field("closingDate", "Term Closing Date", settings.closingDate, "date"),
    field("openingDate", "Next Term Begins", settings.openingDate, "date"),
  ]);

  calForm.append(topRow, timeline, dateRow);

  calForm.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Calendar"]),
    ])
  );

  card.append(calForm);
  return card;
}

// ===========================================================================
// Grading scale tab
// ===========================================================================

function buildGradingTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;" }, [
      el("div", {}, [
        el("h3", {}, [
          icon("grading"),
          "CBC Grading Scale & Evaluation Standards",
          infoTooltip(
            "CBC Evaluation Engine",
            "Maps student percentages to performance levels (EE: Exceeding Expectations, ME: Meeting Expectations, AE: Approaching Expectations, BE: Below Expectations). Points feed cumulative position calculations."
          ),
        ]),
        el("p", { class: "settings-card__sub" }, "Configure performance level thresholds, point weights, and official remarks for report cards."),
      ]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        id: "btn-reset-cbc",
        title: "Load standard Kenyan CBC 4-level performance bands",
        onClick: () => resetToCBCStandard(),
      }, [icon("restart_alt"), "Standard CBC Preset"]),
    ])
  );

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "margin-top:12px;" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, [
        "Min %",
        infoTooltip("Minimum Percentage", "Inclusive lower score bound for this grade band."),
      ]),
      el("th", {}, [
        "Max %",
        infoTooltip("Maximum Percentage", "Inclusive upper score bound for this grade band."),
      ]),
      el("th", {}, [
        "Grade Code",
        infoTooltip("Grade Code", "e.g. EE, ME, AE, BE or A, B, C, D."),
      ]),
      el("th", {}, [
        "Points",
        infoTooltip("Performance Points", "Point value summed to compute student total points and class positions."),
      ]),
      el("th", {}, [
        "Official Remark",
        infoTooltip("Teacher Remark", "Descriptive performance remark displayed on terminal report cards."),
      ]),
      el("th", { style: "width:44px;" }, ""),
    ])),
  ]);

  const tbody = el("tbody", { id: "grading-tbody" });
  for (const row of settings.gradingScale || []) tbody.append(gradingRow(row));
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);

  card.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "button", id: "add-grading-row", class: "btn btn--ghost btn--sm" }, [icon("add"), "Add Grade Band"]),
      el("button", { type: "button", id: "save-grading", class: "btn btn--primary" }, [icon("save"), "Save Grading Scale"]),
    ])
  );

  return card;
}

function resetToCBCStandard() {
  const standardCBC = [
    { min: 80, max: 100, grade: "EE", points: 4, remark: "Exceeding Expectations" },
    { min: 60, max: 79, grade: "ME", points: 3, remark: "Meeting Expectations" },
    { min: 40, max: 59, grade: "AE", points: 2, remark: "Approaching Expectations" },
    { min: 0, max: 39, grade: "BE", points: 1, remark: "Below Expectations" },
  ];
  const tbody = document.getElementById("grading-tbody");
  tbody.innerHTML = "";
  for (const row of standardCBC) tbody.append(gradingRow(row));
  toast("Standard CBC performance scale loaded. Click 'Save Grading Scale' to apply.", "info", 3500);
}

function gradingRow(row = {}) {
  const tr = el("tr", {}, [
    el("td", { "data-label": "Min %" }, el("input", { type: "number", value: row.min ?? "", class: "grade-min", style: "width:72px;" })),
    el("td", { "data-label": "Max %" }, el("input", { type: "number", value: row.max ?? "", class: "grade-max", style: "width:72px;" })),
    el("td", { "data-label": "Grade" }, el("input", { type: "text", value: row.grade ?? "", class: "grade-code", style: "width:72px;" })),
    el("td", { "data-label": "Points" }, el("input", { type: "number", value: row.points ?? "", class: "grade-points", style: "width:72px;" })),
    el("td", { "data-label": "Remark" }, el("input", { type: "text", value: row.remark ?? "", class: "grade-remark" })),
    el("td", { class: "row-actions", "data-label": "Remove" }, el("button", {
      type: "button", class: "btn btn--ghost btn--sm", title: "Remove row",
      onClick: (e) => e.currentTarget.closest("tr").remove(),
    }, icon("delete"))),
  ]);
  return tr;
}

// ===========================================================================
// Notifications tab
// ===========================================================================

function buildNotificationsTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [
      icon("notifications_active"),
      "Messaging Gateways",
      infoTooltip(
        "Communication Gateways",
        "Used for dispatching student report cards, fee payment alerts, attendance notifications, and event announcements directly to parents."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Configure automated email and SMS gateways for seamless parent communication.")
  );

  const form = el("form", { id: "notifications-form" });
  const p = settings.notificationProviders || { gmail: {}, africasTalking: {} };

  const grid = el("div", { class: "settings-grid-2col" });

  // 1. Email Gateway (Gmail)
  const emailGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [
      icon("mail"),
      "Email Service (Google Workspace / Gmail)",
    ]),
    el("p", { class: "text-sm text-muted", style: "margin:-8px 0 12px;" }, "Sends digital report cards and official receipts via SMTP."),
    field("gmail-address", "Gmail Sender Address", p.gmail?.address, "email", false, {
      title: "Sender Email",
      text: "The official Google email address sending messages to parents.",
    }),
    passwordField("gmail-app-password", "Google App Password (16 chars)", p.gmail?.appPassword, {
      title: "Google App Password",
      text: "Requires a 16-character Google App Password created under Google Account > Security > 2-Step Verification > App Passwords. Do NOT use your standard account password.",
    }, "•••• •••• •••• ••••"),
  ]);

  // 2. SMS Gateway (Africa's Talking)
  const smsGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [
      icon("sms"),
      "SMS Gateway (Africa's Talking)",
    ]),
    el("p", { class: "text-sm text-muted", style: "margin:-8px 0 12px;" }, "Dispatches real-time SMS alerts and exam results to parent phones."),
    field("at-username", "API Username", p.africasTalking?.username, "text", false, {
      title: "Africa's Talking Username",
      text: "Your registered Africa's Talking application username (default is 'sandbox' for testing).",
    }),
    passwordField("at-apikey", "Live API Key", p.africasTalking?.apiKey, {
      title: "Africa's Talking API Key",
      text: "Generated from the Africa's Talking developer console under Settings > API Key.",
    }, "Paste API key"),
    field("at-senderid", "Alphanumeric Sender ID (Optional)", p.africasTalking?.senderId, "text", false, {
      title: "Custom Sender ID",
      text: "Approved 11-character telecom sender name (e.g. 'GREENHILL'). Leave empty to use Africa's Talking shared shortcode.",
    }),
  ]);

  grid.append(emailGroup, smsGroup);
  form.append(grid);

  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Notifications"]),
    ])
  );

  card.append(form);
  return card;
}

// ===========================================================================
// Subscription tab
// ===========================================================================

function buildSubscriptionTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [icon("workspace_premium"), "License & Subscription"]),
    el("p", { class: "settings-card__sub" }, "Review your institution's subscription status and activate new license keys.")
  );

  const { active, daysRemaining, revoked, revokeReason } = getSubscriptionState(settings);
  const planLabel = SUBSCRIPTION_PLANS.find((p) => p.value === settings.subscriptionPlan)?.label || settings.subscriptionPlan;

  const statusBanner = el("div", { class: `notice-banner${active ? "" : " notice-banner--warning"}` });
  if (revoked) {
    const reasonLabel = REVOKE_REASONS.find((r) => r.value === revokeReason)?.label || "unspecified reason";
    statusBanner.append(icon("error"), el("span", {}, `Your subscription was revoked (${reasonLabel}). The system is locked until a new license token is issued.`));
  } else if (settings.subscriptionStatus === "inactive" || !settings.subscriptionExpiresAt) {
    statusBanner.append(icon("info"), el("span", {}, "No active subscription detected. Contact support at iskify360.tech@gmail.com to request an activation key."));
  } else if (active) {
    const isStarter = isStarterPlan(settings);
    const bannerContent = el("span", { style: "display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
      el("strong", {}, `${planLabel} Plan`),
      el("span", {}, `· ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining (valid through ${formatDate(settings.subscriptionExpiresAt)}).`),
    ]);
    if (isStarter) {
      bannerContent.append(
        el("span", {
          class: "tooltip-wrap",
          tabindex: "0",
          role: "button",
          "aria-label": "Starter plan module availability",
        }, [
          el("span", { class: "tooltip-trigger-badge" }, [
            icon("info"),
            "Module availability",
          ]),
          el("span", { class: "tooltip-bubble", role: "tooltip" }, [
            el("span", { class: "tooltip-bubble__title" }, [
              icon("info"),
              "Starter Plan Scope",
            ]),
            el("span", { class: "tooltip-bubble__text" },
              "Advanced capabilities like Automated Attendance tracking, Public Exam Results Portal, and Biometric/Photo cards are enabled on Growth and District tiers."
            ),
          ]),
        ])
      );
    }
    statusBanner.append(icon("check_circle"), bannerContent);
  } else {
    statusBanner.append(icon("error"), el("span", {}, `Your license expired on ${formatDate(settings.subscriptionExpiresAt)}. Renew by pasting a new activation token below.`));
  }
  card.append(statusBanner);

  const form = el("form", { id: "subscription-form", class: "settings-form-grid", style: "margin-top:20px;" }, [
    el("div", { class: "field field--full" }, [
      el("label", { for: "sub-token" }, [
        "License Activation Token",
        infoTooltip("Activation Key", "Cryptographically signed license token provided by the platform administrator."),
      ]),
      el("textarea", {
        id: "sub-token",
        rows: "3",
        placeholder: "Paste your signed activation token here…",
        style: "font-family:var(--font-mono); font-size:0.85rem; padding:10px;",
      }),
    ]),
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("key"), "Activate Subscription"]),
    ]),
  ]);
  card.append(form);
  return card;
}

export function init({ profile }) {
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const previousSlug = settings.slug;
      const cleanSlug = buildFullSlug(val("school-slug"));
      if (cleanSlug && cleanSlug !== previousSlug) {
        const available = await isSlugAvailable(cleanSlug, getCurrentSchoolId());
        if (!available) throw new Error("That school code is already taken - choose a different one.");
      }
      const schoolName = val("schoolName");
      const motto = val("motto");
      await saveSchoolSettings(profile.uid, {
        schoolName,
        motto,
        address: val("address"),
        phone: val("phone"),
        email: val("email"),
        slug: cleanSlug,
      });
      settings.schoolName = schoolName;
      settings.motto = motto;
      settings.slug = cleanSlug;
      if (cleanSlug) {
        await publishSchoolBranding(getCurrentSchoolId(), {
          slug: cleanSlug,
          previousSlug,
          schoolName,
          motto,
          logoUrl: settings.logoUrl,
          themeColor: settings.themeColor,
          secondaryColor: settings.secondaryColor,
          status: settings.status,
        });
      }
      await refreshSchoolChrome();
      loginLinkUI?.refreshDirtyState();
      toast("School profile saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save school profile.", "error");
    } finally {
      restore();
    }
  });

  const themeInput = document.getElementById("themeColor");
  const secondaryInput = document.getElementById("secondaryColor");
  if (themeInput && secondaryInput) {
    const onColorChange = () => {
      updateThemePreview(themeInput.value, secondaryInput.value);
      updateThemeColor(themeInput.value);
    };
    themeInput.addEventListener("input", onColorChange);
    secondaryInput.addEventListener("input", onColorChange);
  }

  // Enable Smart Theme button when a new logo file is selected
  const logoInput = document.getElementById("logo-input");
  if (logoInput) {
    logoInput.addEventListener("change", () => {
      const btn = document.getElementById("smart-theme-btn");
      if (btn && logoInput.files[0]) {
        btn.disabled = false;
        btn.title = "";
      }
    });
  }

  // Smart Theme: extract palette from logo and fill in the color pickers
  const smartBtn = document.getElementById("smart-theme-btn");
  if (smartBtn) {
    smartBtn.addEventListener("click", async () => {
      const logoFile = document.getElementById("logo-input")?.files[0];
      const source = logoFile || settings.logoUrl;
      if (!source) {
        toast("Upload a logo first, then use Smart Theme.", "error");
        return;
      }
      const originalContent = smartBtn.innerHTML;
      smartBtn.disabled = true;
      smartBtn.innerHTML = `<span class="material-symbols-rounded" style="animation:spin 1s linear infinite;">autorenew</span> Scanning…`;
      try {
        const { primary, accent } = await extractLogoPalette(source);
        const themeEl = document.getElementById("themeColor");
        const accentEl = document.getElementById("secondaryColor");
        if (themeEl) themeEl.value = primary;
        if (accentEl) accentEl.value = accent;
        updateThemePreview(primary, accent);
        updateThemeColor(primary);
        // Deselect any active preset — colors are now "custom"
        for (const c of document.querySelectorAll(".theme-card")) {
          c.classList.remove("theme-card--active");
          const status = c.querySelector(".theme-card__status");
          if (status) { status.innerHTML = "Apply"; }
        }
        activeThemeId = "custom";
        toast("Colors extracted from your logo — click Save branding to apply.", "success", 4000);
      } catch (err) {
        toast(err.message || "Could not extract colors from logo.", "error");
      } finally {
        smartBtn.disabled = false;
        smartBtn.innerHTML = originalContent;
      }
    });
  }

  document.getElementById("branding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const logoFile = document.getElementById("logo-input").files[0];
      let logoUrl = settings.logoUrl;
      if (logoFile) logoUrl = await uploadSchoolLogo(logoFile);
      const themeColor = document.getElementById("themeColor").value;
      const secondaryColor = document.getElementById("secondaryColor").value;
      const themeId = matchThemeId(themeColor, secondaryColor);
      await saveSchoolSettings(profile.uid, { logoUrl, themeColor, secondaryColor, themeId });
      settings.logoUrl = logoUrl;
      settings.themeColor = themeColor;
      settings.secondaryColor = secondaryColor;
      settings.themeId = themeId;
      if (settings.slug) {
        await publishSchoolBranding(getCurrentSchoolId(), {
          slug: settings.slug,
          schoolName: settings.schoolName,
          motto: settings.motto,
          logoUrl,
          themeColor,
          secondaryColor,
          status: settings.status,
        });
      }
      await refreshSchoolChrome();
      toast("Branding saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save branding.", "error");
    } finally {
      restore();
    }
  });


  document.getElementById("leadership-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await saveSchoolSettings(profile.uid, {
        principalName: val("principalName"),
        principalTitle: val("principalTitle") || "Principal",
        deputyPrincipalName: val("deputyPrincipalName"),
        deputyPrincipalTitle: val("deputyPrincipalTitle") || "Deputy Principal",
      });
      invalidateSchoolSettingsCache();
      toast("Leadership details saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save leadership details.", "error");
    } finally {
      restore();
    }
  });

  document.getElementById("calendar-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await saveSchoolSettings(profile.uid, {
        currentAcademicYear: val("currentAcademicYear"),
        currentTerm: document.getElementById("currentTerm").value,
        termBegins: val("termBegins"),
        closingDate: val("closingDate"),
        openingDate: val("openingDate"),
      });
      invalidateSchoolSettingsCache();
      toast("Academic calendar saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save academic calendar.", "error");
    } finally {
      restore();
    }
  });

  document.getElementById("add-grading-row").addEventListener("click", () => {
    document.getElementById("grading-tbody").append(gradingRow());
  });

  document.getElementById("save-grading").addEventListener("click", async (e) => {
    const restore = busyButton(e.currentTarget, "Saving…");
    try {
      const rows = Array.from(document.querySelectorAll("#grading-tbody tr"))
        .map((tr) => ({
          min: Number(tr.querySelector(".grade-min").value),
          max: Number(tr.querySelector(".grade-max").value),
          grade: tr.querySelector(".grade-code").value.trim(),
          points: Number(tr.querySelector(".grade-points").value) || 0,
          remark: tr.querySelector(".grade-remark").value.trim(),
        }))
        .filter((r) => r.grade || r.remark || r.min || r.max);
      await saveSchoolSettings(profile.uid, { gradingScale: rows });
      invalidateSchoolSettingsCache();
      toast("Grading scale saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save grading scale.", "error");
    } finally {
      restore();
    }
  });
  document.getElementById("notifications-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const notificationProviders = {
        gmail: {
          address: val("gmail-address"),
          appPassword: val("gmail-app-password")
        },
        africasTalking: {
          username: val("at-username"),
          apiKey: val("at-apikey"),
          senderId: val("at-senderid")
        }
      };
      await saveSchoolSettings(profile.uid, { notificationProviders });
      settings.notificationProviders = notificationProviders;
      invalidateSchoolSettingsCache();
      toast("Notification providers saved.", "success");
    } catch (err) {
      toast(err.message || "Could not save notification providers.", "error");
    } finally {
      restore();
    }
  });


  document.getElementById("subscription-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Activating…");
    try {
      const token = document.getElementById("sub-token").value.trim();
      if (!token) throw new Error("Paste the token you were given first.");
      const result = await activateSubscription(token);
      settings.subscriptionStatus = result.subscriptionStatus;
      settings.subscriptionPlan = result.subscriptionPlan;
      settings.subscriptionExpiresAt = result.subscriptionExpiresAt;
      invalidateSchoolSettingsCache();
      await refreshCurrentSchool();
      toast("Subscription activated.", "success");
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't activate that token.", "error");
      restore();
    }
  });
}

function val(id) {
  return document.getElementById(id).value.trim();
}

// ===========================================================================
// Security tab: 2FA, trusted devices, login activity
// ===========================================================================

function buildSecurityPanel(profile) {
  const wrap = el("div", { class: "settings-stack" });
  const grid = el("div", { class: "settings-grid-2col" });

  // ---------------------------------------------------------------------------
  // Column 1: Authentication & Access Control
  // ---------------------------------------------------------------------------
  const authCol = el("div", { class: "settings-stack" });

  // 1. Two-Factor Authentication Card
  const tfaCard = el("div", { class: "card settings-card" });
  tfaCard.append(
    el("h3", {}, [
      icon("lock"),
      "Two-Factor Authentication (2FA)",
      infoTooltip(
        "TOTP Authentication",
        "Adds an extra layer of defense by requiring a 6-digit verification code from authenticator apps (Google Authenticator, Microsoft Authenticator, Authy) on every login."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Protect your administrative account with time-based verification codes.")
  );
  const tfaContent = el("div", { id: "tfa-content" });
  tfaCard.append(tfaContent);
  authCol.append(tfaCard);

  // Load 2FA state
  (async () => {
    const enabled = await is2FAEnabled(profile.uid).catch(() => false);
    if (enabled) {
      tfaContent.innerHTML = "";
      const badge = el("div", { class: "badge badge--success", style: "margin-bottom:12px;display:inline-flex;align-items:center;gap:6px;" }, [
        icon("verified_user"), "2FA is active and protecting this account",
      ]);
      const disableBtn = el("button", { class: "btn btn--outline btn--sm", style: "margin-left:12px;" }, "Disable 2FA");
      disableBtn.addEventListener("click", () => {
        const codeInput = el("input", { type: "text", placeholder: "6-digit code", maxlength: "6", style: "width:140px;text-align:center;font-family:monospace;font-size:16px;" });
        const confirmBtn = el("button", { class: "btn btn--danger btn--sm" }, "Confirm Disable");
        const row = el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:12px;" }, [codeInput, confirmBtn]);
        tfaContent.append(row);
        codeInput.focus();
        confirmBtn.addEventListener("click", async () => {
          const code = codeInput.value.trim();
          if (!code) return;
          const restore = busyButton(confirmBtn, "Disabling…");
          try {
            await disable2FA(profile.uid, code);
            toast("Two-factor authentication disabled.", "success");
            tfaContent.innerHTML = "";
            renderSetup2FA(tfaContent, profile);
          } catch (err) {
            toast(err.message || "Invalid code.", "error");
            restore();
          }
        });
      });
      tfaContent.append(badge, disableBtn);
    } else {
      renderSetup2FA(tfaContent, profile);
    }
  })();

  // 2. Device Approval Policy Card
  const policyCard = el("div", { class: "card settings-card" });
  policyCard.append(
    el("h3", {}, [
      icon("policy"),
      "Device Authorization Policy",
      infoTooltip(
        "Strict Device Verification",
        "When enabled, unrecognized browsers or computers cannot log in with just passwords alone — an active trusted device must first approve the access request."
      ),
    ]),
    el("p", { class: "settings-card__sub" }, "Require existing devices to authorize any sign-in from new browsers.")
  );

  let requireApproval = settings.requireDeviceApproval !== false;
  const toggleRow = el("div", { style: "display:flex;align-items:flex-start;gap:14px;margin-top:4px;" });
  const toggleLabel = el("label", { style: "display:flex;align-items:flex-start;gap:12px;cursor:pointer;" });
  const toggleInput = el("input", { type: "checkbox", style: "width:20px;height:20px;cursor:pointer;flex-shrink:0;margin-top:2px;" });
  if (requireApproval) toggleInput.checked = true;

  const toggleText = el("div", {});
  const toggleTitle = el("span", { style: "font-weight:600;display:block;font-size:var(--fs-sm);" }, "Require authorization for new browsers");
  const toggleSub = el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" }, requireApproval
    ? "Active: Logins from unrecognized browsers remain pending until approved by an existing authorized device."
    : "Disabled: New devices can sign in immediately upon providing valid credentials."
  );
  toggleText.append(toggleTitle, toggleSub);
  toggleLabel.append(toggleInput, toggleText);
  toggleRow.append(toggleLabel);
  policyCard.append(toggleRow);

  toggleInput.addEventListener("change", async () => {
    const newValue = toggleInput.checked;
    toggleInput.disabled = true;
    try {
      await saveSchoolSettings(profile.uid, { requireDeviceApproval: newValue });
      settings.requireDeviceApproval = newValue;
      requireApproval = newValue;
      toggleSub.textContent = newValue
        ? "Active: Logins from unrecognized browsers remain pending until approved by an existing authorized device."
        : "Disabled: New devices can sign in immediately upon providing valid credentials.";
      toast(
        newValue
          ? "Device approval enabled. New logins will require approval."
          : "Device approval disabled. New devices can sign in directly with password.",
        "success"
      );
    } catch {
      toast("Failed to save device approval setting.", "error");
      toggleInput.checked = requireApproval;
    }
    toggleInput.disabled = false;
  });
  authCol.append(policyCard);

  // ---------------------------------------------------------------------------
  // Column 2: Trusted Devices & Audit Activity
  // ---------------------------------------------------------------------------
  const devicesCol = el("div", { class: "settings-stack" });

  // 3. Trusted Devices Card
  const devicesCard = el("div", { class: "card settings-card" });
  devicesCard.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;" }, [
      el("div", {}, [
        el("h3", {}, [
          icon("devices"),
          "Authorized Devices",
          infoTooltip("Authorized Sessions", "Browsers and workstations authenticated and trusted to access your school workspace without secondary prompts."),
        ]),
        el("p", { class: "settings-card__sub", style: "margin-bottom:0;" }, "Registered hardware sessions."),
      ]),
      el("button", { class: "btn btn--outline btn--sm", id: "btn-reset-devices" }, [icon("delete_sweep"), "Revoke All"]),
    ])
  );

  const devicesList = el("div", { class: "device-list", id: "devices-list", style: "margin-top:12px;" });
  devicesCard.append(devicesList);
  devicesCol.append(devicesCard);

  const resetAllBtn = devicesCard.querySelector("#btn-reset-devices");
  resetAllBtn.addEventListener("click", async () => {
    if (!confirm("Revoke all trusted devices? You will need to re-verify on your next login.")) return;
    const restore = busyButton(resetAllBtn, "Revoking…");
    try {
      await resetAllTrustedDevices(profile.uid);
      toast("All trusted devices revoked.", "success");
      loadDevices();
    } catch {
      toast("Failed to revoke devices.", "error");
    }
    restore();
  });

  async function loadDevices() {
    devicesList.innerHTML = "";
    try {
      const devices = await listTrustedDevices(profile.uid);
      if (devices.length === 0) {
        devicesList.append(el("p", { class: "text-muted text-sm", style: "padding:8px 0;" }, "No trusted devices registered yet."));
        return;
      }
      for (const d of devices) {
        const lastSeen = d.lastSeenAt?.toDate ? d.lastSeenAt.toDate().toLocaleDateString() : "—";
        const registered = d.registeredAt?.toDate ? d.registeredAt.toDate().toLocaleDateString() : "—";
        const card = el("div", { class: "device-card" }, [
          el("span", { class: "material-symbols-rounded device-card__icon" }, d.isPrimary ? "smartphone" : "computer"),
          el("div", { class: "device-card__info" }, [
            el("div", { class: "device-card__name" }, [
              d.deviceName || "Authorized Device",
              d.isPrimary ? el("span", { class: "device-card__badge", style: "margin-left:8px;" }, "Primary") : "",
            ]),
            el("div", { class: "device-card__detail" }, `${d.screenRes || ""} · ${d.timezone || ""} · Last active: ${lastSeen} · Added: ${registered}`),
          ]),
          el("div", { class: "device-card__actions" }, [
            el("button", {
              class: "btn btn--outline btn--sm",
              title: "Revoke device",
              onClick: async () => {
                if (!confirm(`Revoke device "${d.deviceName}"?`)) return;
                await removeTrustedDevice(profile.uid, d.id);
                toast("Device revoked.", "success");
                loadDevices();
              },
            }, [icon("delete")]),
          ]),
        ]);
        devicesList.append(card);
      }
    } catch {
      devicesList.append(el("p", { class: "text-muted text-sm" }, "Failed to load trusted devices."));
    }
  }
  loadDevices();

  // 4. Recent Login Activity Card
  const activityCard = el("div", { class: "card settings-card" });
  activityCard.append(
    el("h3", {}, [
      icon("history"),
      "Recent Login Requests",
      infoTooltip("Access Audit", "Log of browser login attempts, including incoming device verification requests and outcomes."),
    ]),
    el("p", { class: "settings-card__sub" }, "Recent sign-in attempts and authorization outcomes.")
  );
  const activityTable = el("div", { id: "login-activity" });
  activityCard.append(activityTable);
  devicesCol.append(activityCard);

  (async () => {
    try {
      const approvals = await listRecentApprovals(profile.uid);
      if (approvals.length === 0) {
        activityTable.append(el("p", { class: "text-muted text-sm", style: "padding:8px 0;" }, "No recent login requests recorded."));
        return;
      }
      const table = el("table", { class: "login-activity" });
      table.append(
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Device"),
            el("th", {}, "Timestamp"),
            el("th", {}, "Status"),
          ]),
        ])
      );
      const tbody = el("tbody", {});
      for (const a of approvals) {
        const time = a.requestedAt?.toDate ? a.requestedAt.toDate().toLocaleString() : (a.requestedAt?.seconds ? new Date(a.requestedAt.seconds * 1000).toLocaleString() : "—");
        const statusClass = a.status === "approved" ? "status-badge--approved" : a.status === "denied" ? "status-badge--denied" : "status-badge--pending";
        const statusContent = [el("span", { class: `status-badge ${statusClass}` }, a.status || "unknown")];
        if (a.status === "pending") {
          statusContent.push(
            el("button", {
              class: "btn btn--xs btn--primary",
              style: "margin-left: 8px; font-size: 11px; padding: 2px 8px;",
              onClick: () => showApprovalModal(a, profile),
            }, "Review")
          );
        }
        tbody.append(
          el("tr", {}, [
            el("td", {}, a.deviceName || "Browser Session"),
            el("td", {}, time),
            el("td", {}, statusContent),
          ])
        );
      }
      table.append(tbody);
      activityTable.append(table);
    } catch {
      activityTable.append(el("p", { class: "text-muted text-sm" }, "Failed to load activity logs."));
    }
  })();

  grid.append(authCol, devicesCol);
  wrap.append(grid);
  return wrap;
}

// Renders the 2FA setup flow (QR code + verification)
function renderSetup2FA(container, profile) {
  const setupBtn = el("button", { class: "btn btn--primary btn--sm" }, [icon("lock"), "Enable 2FA"]);
  container.append(setupBtn);

  setupBtn.addEventListener("click", async () => {
    const restore = busyButton(setupBtn, "Configuring…");
    try {
      const email = profile.email || "admin";
      const setup = await generate2FASetup(profile.uid, email);

      container.innerHTML = "";
      const setupDiv = el("div", { class: "totp-setup" });

      const qrDiv = el("div", { class: "totp-setup__qr" });
      const qrImg = el("img", {
        src: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauthUri)}`,
        alt: "Scan this QR code with your authenticator app",
        style: "width:180px;height:180px;border-radius:8px;box-shadow:var(--shadow-sm);",
      });
      qrDiv.append(
        el("p", { class: "text-sm text-muted", style: "margin-bottom:12px;" }, "1. Scan this QR code with Google Authenticator or Microsoft Authenticator:"),
        qrImg,
        el("p", { class: "text-sm text-muted", style: "margin-top:12px;" }, "Or enter the secret key manually:"),
        el("div", { class: "totp-setup__secret" }, setup.secret)
      );

      const verifyInput = el("input", { type: "text", placeholder: "6-digit code", maxlength: "6", style: "width:150px;text-align:center;font-family:monospace;font-size:18px;letter-spacing:4px;" });
      const verifyBtn = el("button", { class: "btn btn--primary btn--sm" }, "Verify & Activate");
      const verifyError = el("div", { class: "field-error", style: "margin-top:6px;" });
      const cancelBtn = el("button", { class: "btn btn--outline btn--sm" }, "Cancel");

      const verifyRow = el("div", { class: "totp-setup__verify" }, [verifyInput, verifyBtn, cancelBtn]);

      setupDiv.append(
        qrDiv,
        el("p", { class: "text-sm", style: "margin:12px 0 6px; font-weight:600;" }, "2. Enter the 6-digit code generated by your app:"),
        verifyRow,
        verifyError
      );
      container.append(setupDiv);
      verifyInput.focus();

      verifyBtn.addEventListener("click", async () => {
        verifyError.textContent = "";
        const code = verifyInput.value.trim();
        if (code.length < 6) {
          verifyError.textContent = "Enter the full 6-digit code.";
          return;
        }
        const r = busyButton(verifyBtn, "Verifying…");
        try {
          const backupCodes = await enable2FA(profile.uid, setup.secret, code);
          container.innerHTML = "";
          container.append(
            el("div", { class: "badge badge--success", style: "margin-bottom:12px;display:inline-flex;align-items:center;gap:6px;" }, [
              icon("verified_user"), "2FA has been successfully activated!",
            ]),
            el("p", { class: "text-sm" }, "Save these one-time backup codes in a safe location:"),
            el("div", { class: "backup-codes" }, backupCodes.map(c => el("div", { class: "backup-codes__code" }, c))),
            el("p", { class: "backup-codes__warning" }, "⚠ Keep these codes secure. They will not be displayed again."),
          );
          toast("Two-factor authentication enabled.", "success");
        } catch (err) {
          verifyError.textContent = err.message || "Invalid code. Try again.";
          r();
        }
      });

      cancelBtn.addEventListener("click", () => {
        container.innerHTML = "";
        renderSetup2FA(container, profile);
      });
    } catch {
      toast("Could not initialize 2FA setup. Please try again.", "error");
      restore();
    }
  });
}