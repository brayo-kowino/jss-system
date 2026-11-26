import { getSchoolSettings, saveSchoolSettings, uploadSchoolLogo, isSlugAvailable, publishSchoolBranding, slugify, SLUG_PREFIX } from "../js/services/settings.service.js";
import { activateSubscription, getSubscriptionState, SUBSCRIPTION_PLANS, REVOKE_REASONS, isStarterPlan } from "../js/services/subscription.service.js";
import { invalidateSchoolSettingsCache, refreshSchoolChrome, updateThemeColor, showApprovalModal, applyBranding } from "../js/components/shell.js";
import { getEffectiveTheme } from "../js/theme.js";
import { deriveDarkPalette } from "../js/theme-engine.js";
import { getCurrentSchoolId, refreshCurrentSchool, getCurrentProfile } from "../js/services/auth.service.js";
import { THEME_PRESETS, matchThemeId } from "../js/theme-presets.js";
import { el, icon, toast, busyButton, formatDate } from "../js/utils.js";
import { datePickerField } from "../js/components/datepicker.js";
import { listTrustedDevices, removeTrustedDevice, resetAllTrustedDevices } from "../js/services/device.service.js";
import { listRecentApprovals } from "../js/services/login-approval.service.js";
import { generate2FASetup, enable2FA, disable2FA, is2FAEnabled } from "../js/services/two-factor.service.js";
import { extractLogoPalette } from "../js/services/logo-palette.js";
import { openSignaturePadModal } from "../js/components/signature-pad-modal.js";

let settings = null;
let activeThemeId = "custom";
const SETTINGS_GROUPS = [
  { label: "School", sections: [
    { id: "profile", label: "School profile", icon: "domain", description: "Manage school details, contact information and the sign-in link.", terms: "identity institution name address email phone motto stationery letterhead portal URL slug code" },
    { id: "branding", label: "Appearance", icon: "palette", description: "Set the school logo and preview your workspace colors.", terms: "branding theme presets palette crest emblem primary accent colors" },
    { id: "leadership", label: "Leadership & signatures", icon: "badge", description: "Manage leadership details and signatures for school documents.", terms: "principal head teacher deputy designations signatories report cards signature upload" },
  ] },
  { label: "Academics", sections: [
    { id: "calendar", label: "Academic calendar", icon: "event", description: "Set the active academic period and term dates.", terms: "year term opening closing reopening school dates schedule" },
    { id: "grading", label: "Grading scale", icon: "grading", description: "Set percentage bands, points and remarks used in saved results.", terms: "CBC grade range minimum maximum levels competency marks assessment points remarks" },
  ] },
  { label: "Administration", sections: [
    { id: "notifications", label: "Email & SMS", icon: "notifications_active", description: "Configure the email and SMS providers used for school messages.", terms: "notifications communication Gmail Google Workspace SMTP password Africa's Talking api key sender" },
    { id: "security", label: "Security & access", icon: "shield", description: "Manage sign-in protection, trusted devices and administrator access.", terms: "2FA two-factor authenticator device approvals trusted login requests revoke ownership transfer" },
    { id: "subscription", label: "Subscription", icon: "workspace_premium", description: "Check your plan and activate a renewal token.", terms: "billing license expiry payment renewal pricing token activation plan support" },
  ] },
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
  return el("div", { class: `field${full ? " field--full" : ""}` }, [
    el("div", { class: "settings-field-label" }, [
      el("label", { for: id }, label),
      tooltip ? infoTooltip(tooltip.title, tooltip.text, tooltip.align) : null,
    ]),
    el("input", { id, type, value: value || "", ...(type === "tel" ? { autocomplete: "tel" } : {}) }),
  ]);
}

/**
 * Password field equipped with a show/hide toggle.
 */
function passwordField(id, label, value = "", tooltip = null, placeholder = "") {
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
    title: "Show value",
    "aria-label": "Show " + label,
    onClick: () => {
      const isPass = input.type === "password";
      input.type = isPass ? "text" : "password";
      toggleBtn.title = isPass ? "Hide value" : "Show value";
      toggleBtn.setAttribute("aria-label", (isPass ? "Hide " : "Show ") + label);
      toggleBtn.innerHTML = "";
      toggleBtn.append(icon(isPass ? "visibility_off" : "visibility"));
    },
  }, [icon("visibility")]);

  return el("div", { class: "field" }, [
    el("div", { class: "settings-field-label" }, [
      el("label", { for: id }, label),
      tooltip ? infoTooltip(tooltip.title, tooltip.text, tooltip.align) : null,
    ]),
    el("div", { class: "input-with-action" }, [input, toggleBtn]),
  ]);
}

export async function render({ profile, params = {} }) {
  settings = await getSchoolSettings();
  activeThemeId = settings.themeId || matchThemeId(settings.themeColor, settings.secondaryColor);

  const canManageSecurity = ["admin", "super_admin"].includes(profile.role);
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group, sections: group.sections.filter(({ id }) => id !== "security" || canManageSecurity),
  }));
  const sections = groups.flatMap(({ sections }) => sections);
  const urlTab = new URLSearchParams(location.hash.split("?")[1]).get("tab");
  const active = sections.find(({ id }) => id === (params.tab || urlTab))?.id || "profile";
  const builders = {
    profile: buildProfileTab,
    branding: buildBrandingTab,
    leadership: () => buildLeadershipTab(profile),
    calendar: buildCalendarTab,
    grading: buildGradingTab,
    notifications: buildNotificationsTab,
    security: () => buildSecurityPanel(profile),
    subscription: buildSubscriptionTab,
  };

  const workspace = el("div", { class: "settings-workspace" });
  const navigation = el("aside", { class: "settings-navigation no-print" });
  const content = el("div", { class: "settings-content" });
  const panels = new Map();
  const search = el("input", { type: "search", placeholder: "Search settings", "aria-label": "Search settings" });
  const feedback = el("p", { class: "settings-search-feedback", role: "status", hidden: "" });
  const sectionPicker = el("select", { class: "settings-section-picker", "aria-label": "Settings section" },
    groups.map(({ label, sections }) => el("optgroup", { label },
      sections.map(({ id, label }) => el("option", { value: id }, label)))));
  const menu = el("nav", { class: "settings-menu", "aria-label": "Settings sections" });

  for (const group of groups) {
    const groupNode = el("div", { class: "settings-menu-group" }, el("p", {}, group.label));
    for (const section of group.sections) {
      const { id, label, description, terms } = section;
      const button = el("button", {
        type: "button", class: "settings-menu-button", "data-tab": id, "aria-controls": `panel-${id}`,
        onClick: () => selectSection(id),
      }, [icon(section.icon, "", { "aria-hidden": "true" }), el("span", {}, label)]);
      const heading = el("h2", { id: `settings-heading-${id}`, tabindex: "-1" }, label);
      const panel = el("section", { class: "settings-tab-panel", id: `panel-${id}`, "aria-labelledby": heading.id }, [
        el("header", { class: "settings-section-header" }, [heading, el("p", {}, description)]),
        builders[id](),
      ]);
      panels.set(id, { button, panel, heading, keywords: `${group.label} ${label} ${description} ${terms}`.toLowerCase() });
      groupNode.append(button);
      content.append(panel);
    }
    menu.append(groupNode);
  }

  function filterMenu() {
    const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matching = [];
    for (const [id, { button, keywords }] of panels) {
      button.hidden = !words.every((word) => keywords.includes(word));
      if (!button.hidden) matching.push(id);
    }
    for (const group of menu.children) group.hidden = !group.querySelector("button:not([hidden])");
    navigation.classList.toggle("settings-navigation--searching", words.length > 0);
    feedback.hidden = !words.length;
    feedback.textContent = matching.length ? `${matching.length} matching ${matching.length === 1 ? "section" : "sections"}` : "No matching settings";
    return matching;
  }

  function selectSection(id, initial = false) {
    for (const [key, { button, panel }] of panels) {
      panel.hidden = key !== id;
      if (key === id) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
    sectionPicker.value = id;
    if (initial) return;
    search.value = "";
    filterMenu();
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("tab", id);
    const hash = "#/settings?" + query.toString();
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
    panels.get(id).heading.focus();
  }

  search.addEventListener("input", filterMenu);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      filterMenu();
    }
    if (event.key !== "Enter" || !search.value.trim()) return;
    const [first] = filterMenu();
    if (first) selectSection(first);
  });
  sectionPicker.addEventListener("change", () => selectSection(sectionPicker.value));
  navigation.append(el("div", { class: "settings-navigation-search" },
    [icon("search", "", { "aria-hidden": "true" }), search]), sectionPicker, feedback, menu);
  workspace.append(navigation, content);
  selectSection(active, true);
  return el("div", { class: "settings-page" }, workspace);
}

// ===========================================================================
// Profile tab
// ===========================================================================

function buildStationeryPreviewCard() {
  const card = el("div", { class: "card settings-card settings-preview-card" });
  card.append(
    el("h3", {}, [
      icon("badge"),
      "Letterhead preview",
    ]),
    el("p", { class: "settings-card__sub" }, "See how your school details will appear on a letterhead.")
  );

  const preview = el("div", { class: "stationery-preview" }, [
    el("div", { class: "stationery-preview__header" }, [
      el("div", { id: "letterhead-logo" }, letterheadLogo(settings.logoUrl)),
      el("div", {}, [
        el("div", { class: "stationery-preview__name", id: "preview-school-name" }, settings.schoolName || "School name"),
        el("div", { class: "stationery-preview__motto", id: "preview-school-motto", hidden: settings.motto ? null : "" }, settings.motto || ""),
      ]),
    ]),
    el("div", { class: "stationery-preview__meta", id: "preview-school-contacts", hidden: settings.address || settings.phone || settings.email ? null : "" }, [
      el("span", { id: "preview-school-address", hidden: settings.address ? null : "" }, [icon("location_on", "text-xs"), ` ${settings.address || ""}`]),
      el("span", { id: "preview-school-phone", hidden: settings.phone ? null : "" }, [icon("call", "text-xs"), ` ${settings.phone || ""}`]),
      el("span", { id: "preview-school-email", hidden: settings.email ? null : "" }, [icon("mail", "text-xs"), ` ${settings.email || ""}`]),
    ]),
  ]);

  card.append(preview);
  return card;
}

function letterheadLogo(url) {
  return url
    ? el("img", { src: url, alt: "School logo", class: "stationery-preview__logo" })
    : el("div", { class: "stationery-preview__logo settings-letterhead-placeholder" }, icon("school", "text-xl"));
}

function buildProfileTab() {
  const form = el("form", { id: "settings-form" });
  const grid = el("div", { class: "settings-main-and-preview" });

  // 1. General Institution Details Card (Left Column)
  const infoCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [icon("account_balance"), "School details"]),
    el("p", { class: "settings-card__sub" }, "These details appear on school documents and communications."),
    el("div", { class: "settings-form-grid" }, [
      field("schoolName", "School name", settings.schoolName, "text", true, {
        title: "Official Name",
        text: "The full legal name of your institution as recognized by educational authorities.",
      }),
      field("motto", "Motto", settings.motto, "text", true, {
        title: "School Motto",
        text: "Featured on report card letterheads, student newsletters, and certificates.",
      }),
      field("address", "Physical or postal address", settings.address, "text", true, {
        title: "Official Address",
        text: "P.O. Box, county, town, or street address displayed on official documents.",
      }),
      field("phone", "Phone", settings.phone, "tel", false, {
        title: "Administrative Phone",
        text: "Primary contact phone number for parent communications.",
      }),
      field("email", "School email", settings.email, "email", false, {
        title: "Administrative Email",
        text: "Official email address used for administrative dispatches and parent replies.",
      }),
    ]),
  ]);

  grid.append(el("div", { class: "settings-stack" }, [infoCard, buildLoginLinkCard()]), buildStationeryPreviewCard());

  form.append(
    grid,
    el("div", { class: "settings-form-actions settings-save-bar" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Profile"]),
    ])
  );

  return form;
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
      "School sign-in link",
    ]),
    el("p", { class: "settings-card__sub" }, "Share this link with staff and parents so they land on your school’s sign-in page.")
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

  const availabilityMsg = el("div", { class: "text-sm settings-slug-feedback", id: "slug-availability", role: "status" });
  const unsavedMsg = el("div", { class: "text-sm text-muted", id: "slug-unsaved", hidden: "" }, [
    "Save your profile to activate this link.",
  ]);
  const linkPreview = el("div", { class: "slug-preview-chip", id: "slug-link-preview" });
  const copyBtn = el("button", { type: "button", class: "btn btn--ghost btn--sm", id: "copy-login-link" }, [icon("content_copy"), "Copy Link"]);

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
    unsavedMsg.hidden = !isDirty() || !currentFullSlug();
    copyBtn.disabled = !currentFullSlug() || isDirty();
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
    const available = await isSlugAvailable(full, getCurrentSchoolId()).catch(() => null);
    if (full !== currentFullSlug() || full === settings.slug) return;
    availabilityMsg.textContent = available === null ? "Couldn’t check availability. Try saving again."
      : available ? "Code is available." : "This code is already in use.";
    availabilityMsg.style.color = available === null ? "var(--color-ink-soft)" : available ? "var(--color-green)" : "var(--color-red)";
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
      el("label", { for: "school-slug" }, "School code"),
      inputGroup,
      availabilityMsg,
      unsavedMsg,
    ]),
    el("div", { class: "settings-portal-actions" }, [
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
  const form = el("form", { id: "branding-form", class: "settings-stack" });

  const topGrid = el("div", { class: "settings-main-and-preview" });

  // 1. School Crest / Logo Card (Left Column)
  const logoCard = el("div", { class: "card settings-card" });
  logoCard.append(
    el("h3", {}, [
      icon("photo_camera"),
      "School logo",
    ]),
    el("p", { class: "settings-card__sub" }, "Use a clear PNG or JPEG. A square image of at least 200 × 200 pixels works best.")
  );

  const logoRow = el("div", { class: "brand-logo-row" });
  const logoPreview = el(
    "div",
    { class: "brand-logo-preview", id: "logo-preview" },
    brandingLogo(settings.logoUrl)
  );
  logoRow.append(
    logoPreview,
    el("div", { class: "field settings-logo-field" }, [
      el("label", { for: "logo-input" }, "Choose a logo"),
      el("input", { type: "file", id: "logo-input", accept: "image/*" }),
    ])
  );
  logoCard.append(logoRow);

  // Smart Theme box embedded inside Logo card
  const hasLogoNow = !!settings.logoUrl;
  const smartThemeBox = el("div", { class: "smart-theme-box" }, [
    el("div", { style: "flex:1; min-width:180px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:6px; font-weight:600; font-size:var(--fs-sm); color:var(--color-primary-900);" }, [
        el("span", { class: "material-symbols-rounded", style: "font-size:18px; color:var(--color-gold);" }, "auto_awesome"),
        "Colors from your logo",
      ]),
      el("p", { class: "text-sm text-muted", style: "margin:2px 0 0;" }, "Use your logo to suggest a primary and accent color."),
    ]),
    el("button", {
      type: "button",
      id: "smart-theme-btn",
      class: "btn btn--ghost btn--sm",
      ...(hasLogoNow ? {} : { disabled: true, title: "Upload a logo first, then extract palette." }),
    }, [
      icon("colorize"),
      "Suggest Colors",
    ]),
  ]);
  logoCard.append(smartThemeBox);

  // 2. Color Palette & Live Interactive Simulation Card (Right Column)
  const paletteCard = el("div", { class: "card settings-card" });
  paletteCard.append(
    el("h3", {}, [
      icon("tune"),
      "Theme colors",
    ]),
    el("p", { class: "settings-card__sub" }, "Choose colors for navigation, buttons, and highlights.")
  );

  const brandingRow = el("div", { class: "settings-form-grid" }, [
    el("div", { class: "field" }, [
      el("label", { for: "themeColor" }, "Primary color"),
      el("input", { id: "themeColor", type: "color", value: settings.themeColor || "#14538A" }),
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "secondaryColor" }, "Accent color"),
      el("input", { id: "secondaryColor", type: "color", value: settings.secondaryColor || "#C9A227" }),
    ]),
  ]);
  paletteCard.append(brandingRow);
  topGrid.append(el("div", { class: "settings-stack" }, [logoCard, paletteCard]),
    el("div", { class: "card settings-card settings-preview-card" }, [
      el("h3", {}, [icon("desktop_windows"), "Workspace preview"]),
      el("p", { class: "settings-card__sub" }, "Colors update here as you make changes."),
      buildThemePreview(),
    ]));

  // 3. Full-width Curated Theme Presets Gallery Card (Spanning whole width)
  const galleryCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [
      icon("style"),
      "Color presets",
    ]),
    el("p", { class: "settings-card__sub" }, "Select a palette and save it when you’re ready."),
  ]);
  const gallery = el("div", { class: "theme-gallery", id: "theme-gallery" });
  for (const t of THEME_PRESETS) gallery.append(themeCard(t));
  galleryCard.append(gallery);

  form.append(
    topGrid,
    galleryCard,
    el("div", { class: "settings-form-actions settings-save-bar" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save Branding"]),
    ])
  );

  return form;
}

function themeCard(t) {
  const isActive = activeThemeId === t.id;
  const card = el(
    "button",
    {
      type: "button",
      class: `theme-card${isActive ? " theme-card--active" : ""}`,
      "data-theme-id": t.id,
      "aria-pressed": String(isActive),
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
      el("span", { class: "theme-card__status", hidden: isActive ? null : "" }, [icon("check_circle"), "Selected"]),
    ]
  );
  return card;
}

function applyThemePreset(t) {
  document.getElementById("themeColor").value = t.primary;
  document.getElementById("secondaryColor").value = t.secondary;
  selectThemeCard(t.id);
  updateThemePreview(t.primary, t.secondary);
  applyBranding({ themeColor: t.primary, secondaryColor: t.secondary });
}

function brandingLogo(url) {
  return url ? el("img", { src: url, alt: "School logo" }) : icon("photo_camera");
}

function selectThemeCard(themeId) {
  activeThemeId = themeId;
  for (const c of document.querySelectorAll(".theme-card")) {
    const active = c.dataset.themeId === themeId;
    c.classList.toggle("theme-card--active", active);
    c.setAttribute("aria-pressed", String(active));
    c.querySelector(".theme-card__status").hidden = !active;
  }
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
  const isDark = getEffectiveTheme() === "dark";
  if (isDark) {
    const dark = deriveDarkPalette(primary, secondary);
    if (sidebar) sidebar.style.background = dark.sidebarBg;
    if (btn) btn.style.background = dark.primary700;
    if (chip) {
      chip.style.background = dark.gold;
      chip.style.color = "#0F172A";
    }
  } else {
    if (sidebar) sidebar.style.background = primary;
    if (btn) btn.style.background = primary;
    if (chip) {
      chip.style.background = secondary;
      chip.style.color = "var(--color-ink)";
    }
  }
}

// ===========================================================================
// Leadership tab
// ===========================================================================

function buildLeadershipTab(profile) {
  const wrap = el("div", { class: "settings-stack" });

  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [
      icon("badge"),
      "Leadership details",
    ]),
    el("p", { class: "settings-card__sub" }, "Use the names and titles you want shown on school documents.")
  );

  const form = el("form", { id: "leadership-form" });

  const grid = el("div", { class: "leadership-grid" });

  const principalGroup = el("div", { class: "leadership-group" }, [
    el("h4", { class: "leadership-group__title" }, "Principal"),
    field("principalName", "Full name", settings.principalName, "text", false, {
      title: "Principal Name",
      text: "Full name as it should appear above the official signature line.",
    }),
    field("principalTitle", "Official title", settings.principalTitle || "Principal", "text", false, {
      title: "Designation",
      text: "Title printed on official documents, e.g. 'Principal', 'Head Teacher', or 'Director'.",
    }),
  ]);

  const deputyGroup = el("div", { class: "leadership-group" }, [
    el("h4", { class: "leadership-group__title" }, "Deputy principal"),
    field("deputyPrincipalName", "Full name", settings.deputyPrincipalName, "text", false, {
      title: "Deputy Name",
      text: "Full name of the Deputy Principal or Dean of Studies.",
    }),
    field("deputyPrincipalTitle", "Official title", settings.deputyPrincipalTitle || "Deputy Principal", "text", false, {
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

  // Digital Signature Studio Card
  const sigCard = el("div", { class: "card settings-card" }, [
    el("h3", {}, [
      icon("draw"),
      "Report card signatures",
    ]),
    el("p", { class: "settings-card__sub" }, "Draw or upload the principal’s signature and a default class teacher signature."),
    buildSignatureStudioGrid(profile),
  ]);

  wrap.append(card, sigCard);
  return wrap;
}

function buildSignatureStudioGrid(profile) {
  const signers = [
    { role: "principal", key: "principalSignatureUrl", label: "Principal" },
    { role: "teacher", key: "teacherSignatureUrl", label: "Default class teacher" },
  ];
  return el("div", { class: "leadership-grid" }, signers.map(({ role, key, label }) => {
    const preview = el("div", { class: "settings-signature-image" });
    const edit = el("button", {
      type: "button", class: "btn btn--outline btn--sm",
      onClick: () => openSignaturePadModal({
        settings, profile, activeRole: role,
        onSaved: ({ dataUrl }) => {
          settings[key] = dataUrl;
          refresh();
        },
      }),
    }, [icon("draw", "text-xs"), "Draw or Upload"]);
    const clear = el("button", {
      type: "button", class: "btn btn--ghost btn--sm",
      onClick: async () => {
        if (!confirm("Remove this uploaded signature and use the automatic name signature?")) return;
        const restore = busyButton(clear, "Removing…");
        try {
          await saveSchoolSettings(profile.uid, { [key]: "" });
          settings[key] = "";
          invalidateSchoolSettingsCache();
          toast("Signature removed.", "success");
        } catch (error) {
          toast(error.message || "Could not remove the signature.", "error");
        } finally {
          restore();
          refresh();
        }
      },
    }, "Remove");

    function refresh() {
      const image = settings[key];
      preview.replaceChildren(image
        ? el("img", { src: image, alt: label + " signature" })
        : el("span", { class: "text-sm text-muted" }, "Automatic name signature"));
      clear.disabled = !image;
    }
    refresh();
    return el("div", { class: "leadership-group settings-signature-tile" }, [
      el("h4", { class: "leadership-group__title" }, label),
      preview,
      el("div", { class: "settings-inline-actions" }, [edit, clear]),
    ]);
  }));
}

// ===========================================================================
// Academic calendar tab
// ===========================================================================

function buildCalendarTab() {
  const form = el("form", { id: "calendar-form" });
  const terms = settings.terms || ["Term 1", "Term 2", "Term 3"];
  const activeTerm = el("select", { id: "currentTerm" }, terms.map((term) =>
    el("option", { value: term, selected: term === settings.currentTerm ? "" : null }, term)));
  const yearField = field("currentAcademicYear", "Academic year", settings.currentAcademicYear || new Date().getFullYear().toString());
  const milestones = [
    ["termBegins", "Current term begins"],
    ["closingDate", "School closes"],
    ["openingDate", "Next term begins"],
  ];
  const dates = milestones.map(([id, label]) => field(id, label, settings[id], "date"));
  const dateInputs = dates.map((date) => date.querySelector("input"));
  const dateLabels = dates.map(() => el("dd"));
  const period = el("p", { class: "settings-calendar-period" });
  const controls = el("div", { class: "card settings-card" }, [
    el("h3", {}, [icon("event_note"), "Active period"]),
    el("p", { class: "settings-card__sub" }, "New marks, attendance, and fee records default to this period."),
    el("div", { class: "settings-form-grid" }, [
      yearField,
      el("div", { class: "field" }, [el("label", { for: activeTerm.id }, "Active term"), activeTerm]),
    ]),
    el("div", { class: "settings-dates" }, [
      el("h4", {}, "Term dates"),
      el("div", { class: "settings-form-grid" }, dates),
    ]),
  ]);
  const preview = el("div", { class: "card settings-card settings-preview-card" }, [
    el("h3", {}, [icon("calendar_month"), "Calendar preview"]),
    period,
    el("dl", { class: "settings-calendar-list" }, milestones.map(([, label], index) =>
      el("div", {}, [el("dt", {}, label), dateLabels[index]]))),
  ]);

  function updatePreview() {
    period.textContent = [activeTerm.value, yearField.querySelector("input").value.trim()].filter(Boolean).join(" · ") || "Period not set";
    dateLabels.forEach((label, index) => {
      label.textContent = dateInputs[index].value ? formatDate(dateInputs[index].value) : "Not set";
    });
  }
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  updatePreview();
  form.append(
    el("div", { class: "settings-main-and-preview" }, [controls, preview]),
    el("div", { class: "settings-form-actions settings-save-bar" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save calendar"]),
    ]),
  );
  return form;
}

// ===========================================================================
// Grading scale tab
// ===========================================================================

function buildGradingTab() {
  const grid = el("div", { class: "settings-grading-grid" });

  // 1. CBC Grading Scale Card (Left Column)
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, [
      icon("grading"),
      "Grade bands",
    ]),
    el("p", { class: "settings-card__sub" }, "Each band assigns a grade, points, and a report card remark to a percentage range.")
  );

  const tableWrap = el("div", { class: "grading-table-wrap" });
  const table = el("table", { class: "grading-scale-table" }, [
    el("colgroup", {}, [
      el("col", { style: "width:62px;" }),
      el("col", { style: "width:62px;" }),
      el("col", { style: "width:76px;" }),
      el("col", { style: "width:60px;" }),
      el("col", { style: "width:auto;" }),
      el("col", { style: "width:42px;" }),
    ]),
    el("thead", {}, el("tr", {}, [
      el("th", { class: "col-min" }, "Min %"),
      el("th", { class: "col-max" }, "Max %"),
      el("th", { class: "col-grade" }, "Grade"),
      el("th", { class: "col-points" }, "Points"),
      el("th", { class: "col-remark" }, "Official Remark"),
      el("th", { class: "col-action", "aria-label": "Remove grade band" }, ""),
    ])),
  ]);

  const tbody = el("tbody", { id: "grading-tbody" });
  for (const row of settings.gradingScale || []) tbody.append(gradingRow(row));
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);

  card.append(
    el("div", { class: "settings-form-actions settings-save-bar" }, [
      el("button", { type: "button", id: "add-grading-row", class: "btn btn--ghost btn--sm" }, [icon("add"), "Add grade band"]),
      el("button", { type: "button", id: "save-grading", class: "btn btn--primary" }, [icon("save"), "Save grading scale"]),
    ])
  );

  const reference = el("details", { class: "card settings-card settings-reference" }, [
    el("summary", {}, "CBC performance levels"),
    el("ul", {}, [
      "EE · Exceeding Expectations",
      "ME · Meeting Expectations",
      "AE · Approaching Expectations",
      "BE · Below Expectations",
    ].map((label) => el("li", {}, label))),
  ]);
  grid.append(card, reference);

  return grid;
}

function gradingRow(row = {}) {
  const tr = el("tr", {}, [
    el("td", { class: "col-min", "data-label": "Min %" }, el("input", { type: "number", value: row.min ?? "", class: "grade-min", min: "0", max: "100", "aria-label": "Minimum percentage" })),
    el("td", { class: "col-max", "data-label": "Max %" }, el("input", { type: "number", value: row.max ?? "", class: "grade-max", min: "0", max: "100", "aria-label": "Maximum percentage" })),
    el("td", { class: "col-grade", "data-label": "Grade" }, el("input", { type: "text", value: row.grade ?? "", class: "grade-code", maxlength: "6", "aria-label": "Grade code" })),
    el("td", { class: "col-points", "data-label": "Points" }, el("input", { type: "number", value: row.points ?? "", class: "grade-points", min: "0", "aria-label": "Points" })),
    el("td", { class: "col-remark", "data-label": "Remark" }, el("input", { type: "text", value: row.remark ?? "", class: "grade-remark", "aria-label": "Official remark" })),
    el("td", { class: "col-action", "data-label": "Remove", style: "text-align:center;" }, el("button", {
      type: "button", class: "btn btn--ghost btn--sm grade-del-btn", title: "Remove grade band", "aria-label": "Remove grade band",
      onClick: (e) => e.currentTarget.closest("tr").remove(),
    }, icon("delete", "text-sm"))),
  ]);
  return tr;
}

// ===========================================================================
// Notifications tab
// ===========================================================================

function buildNotificationsTab() {
  const form = el("form", { id: "notifications-form" });
  const p = settings.notificationProviders || { gmail: {}, africasTalking: {} };

  const grid = el("div", { class: "settings-grid-2col" });

  // 1. Email Service Card (Gmail)
  const emailCard = el("div", { class: "card settings-card" });
  emailCard.append(
    el("h3", {}, [
      icon("mail"),
      "Email provider",
    ]),
    el("p", { class: "settings-card__sub" }, "Use a Google Workspace or Gmail account to send school email."),
    field("gmail-address", "Sender email", p.gmail?.address, "email", false, {
      title: "Sender Email",
      text: "The official Google email address sending messages to parents.",
    }),
    passwordField("gmail-app-password", "Google app password", p.gmail?.appPassword, {
      title: "Google App Password",
      text: "Create a 16-character app password in your Google Account security settings after enabling 2-Step Verification.",
    }, "•••• •••• •••• ••••")
  );

  // 2. SMS Gateway Card (Africa's Talking)
  const smsCard = el("div", { class: "card settings-card" });
  smsCard.append(
    el("h3", {}, [
      icon("sms"),
      "SMS provider",
    ]),
    el("p", { class: "settings-card__sub" }, "Use Africa's Talking to send school SMS messages."),
    field("at-username", "API username", p.africasTalking?.username, "text", false, {
      title: "Africa's Talking Username",
      text: "Your registered Africa's Talking application username (default is 'sandbox' for testing).",
    }),
    passwordField("at-apikey", "API key", p.africasTalking?.apiKey, {
      title: "Africa's Talking API Key",
      text: "Generated from the Africa's Talking developer console under Settings > API Key.",
    }, "Paste API key"),
    field("at-senderid", "Sender ID (optional)", p.africasTalking?.senderId, "text", false, {
      title: "Custom Sender ID",
      text: "Approved 11-character telecom sender name (e.g. 'GREENHILL'). Leave empty to use Africa's Talking shared shortcode.",
    })
  );

  grid.append(emailCard, smsCard);
  form.append(
    grid,
    el("div", { class: "settings-form-actions settings-save-bar" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save providers"]),
    ])
  );

  return form;
}

// ===========================================================================
// Subscription tab
// ===========================================================================

function buildSubscriptionTab() {
  const grid = el("div", { class: "settings-main-and-preview" });

  // Column 1: Current License Status Card
  const statusCard = el("div", { class: "card settings-card" });
  statusCard.append(
    el("h3", {}, [icon("workspace_premium"), "Current plan"])
  );

  const { active, daysRemaining, revoked, revokeReason, trial } = getSubscriptionState(settings);
  const planLabel = trial ? "Trial License" : (SUBSCRIPTION_PLANS.find((p) => p.value === settings.subscriptionPlan)?.label || settings.subscriptionPlan);

  const statusBanner = el("div", { class: `notice-banner${active ? "" : " notice-banner--warning"}` });
  if (revoked) {
    const reasonLabel = REVOKE_REASONS.find((r) => r.value === revokeReason)?.label || "unspecified reason";
    statusBanner.append(icon("error"), el("span", {}, `Your subscription was revoked (${reasonLabel}). The system is locked until a new license token is issued.`));
  } else if (settings.subscriptionStatus === "inactive" && !trial) {
    statusBanner.append(icon("info"), el("span", {}, "No active subscription detected. Contact support at iskify360.tech@gmail.com to request an activation key."));
  } else if (active) {
    const isStarter = isStarterPlan(settings) && !trial;
    const bannerContent = el("span", { style: "display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
      el("strong", {}, trial ? "Trial" : `${planLabel || "School"} plan`),
      el("span", {}, `· ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining (valid through ${formatDate(trial ? settings.trialExpiresAt : settings.subscriptionExpiresAt)}).`),
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
    statusBanner.append(icon("error"), el("span", {}, `Your license expired on ${formatDate(trial ? settings.trialExpiresAt : settings.subscriptionExpiresAt)}. Renew by pasting a new activation token below.`));
  }
  statusCard.append(statusBanner);

  const activationCard = el("div", { class: "card settings-card" });
  activationCard.append(
    el("h3", {}, [icon("key"), "Activate or renew"]),
    el("p", { class: "settings-card__sub" }, "Paste the activation token you received from support.")
  );

  const form = el("form", { id: "subscription-form", style: "display:flex; flex-direction:column; gap:16px;" }, [
    el("div", { class: "field" }, [
      el("label", { for: "sub-token" }, "Activation token"),
      el("textarea", {
        id: "sub-token",
        rows: "4",
        spellcheck: "false",
        style: "font-family:var(--font-mono); font-size:0.85rem; padding:10px; resize:vertical;",
      }),
    ]),
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:4px;" }, [
      el("a", {
        href: "mailto:iskify360.tech@gmail.com?subject=License%20Renewal%20Inquiry",
        class: "btn btn--ghost btn--sm",
      }, [icon("help"), "Contact support"]),
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("key"), "Activate subscription"]),
    ]),
  ]);

  activationCard.append(form);
  grid.append(statusCard, activationCard);

  return grid;
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
      const updatedProfile = {
        schoolName,
        motto,
        address: val("address"),
        phone: val("phone"),
        email: val("email"),
        slug: cleanSlug,
      };
      await saveSchoolSettings(profile.uid, updatedProfile);
      Object.assign(settings, updatedProfile);
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

  const updateStationeryPreview = () => {
    document.getElementById("preview-school-name").textContent = val("schoolName") || "School name";
    for (const [id, symbol] of [["motto"], ["address", "location_on"], ["phone", "call"], ["email", "mail"]]) {
      const value = val(id);
      const preview = document.getElementById(`preview-school-${id}`);
      preview.hidden = !value;
      if (symbol) preview.replaceChildren(icon(symbol, "text-xs"), ` ${value}`);
      else preview.textContent = value;
    }
    const contacts = document.getElementById("preview-school-contacts");
    contacts.hidden = !contacts.querySelector("span:not([hidden])");
  };

  ["schoolName", "motto", "address", "phone", "email"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateStationeryPreview);
  });

  const themeInput = document.getElementById("themeColor");
  const secondaryInput = document.getElementById("secondaryColor");
  if (themeInput && secondaryInput) {
    const onColorChange = () => {
      updateThemePreview(themeInput.value, secondaryInput.value);
      selectThemeCard(matchThemeId(themeInput.value, secondaryInput.value));
      applyBranding({ themeColor: themeInput.value, secondaryColor: secondaryInput.value });
    };
    themeInput.addEventListener("input", onColorChange);
    secondaryInput.addEventListener("input", onColorChange);
  }

  const logoInput = document.getElementById("logo-input");
  const logoPreview = document.getElementById("logo-preview");
  const smartBtn = document.getElementById("smart-theme-btn");
  let extractingPalette = false;
  const refreshPaletteButton = () => {
    const hasLogo = !!(logoInput.files[0] || settings.logoUrl);
    smartBtn.disabled = extractingPalette || !hasLogo;
    smartBtn.title = hasLogo ? "" : "Choose a logo first";
  };
  logoInput.addEventListener("change", () => {
    const file = logoInput.files[0];
    refreshPaletteButton();
    logoPreview.replaceChildren(brandingLogo(settings.logoUrl));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (logoInput.files[0] === file) logoPreview.replaceChildren(brandingLogo(reader.result));
    };
    reader.readAsDataURL(file);
  });

  if (smartBtn) {
    smartBtn.addEventListener("click", async () => {
      const logoFile = logoInput.files[0];
      const source = logoFile || settings.logoUrl;
      if (!source) {
        toast("Upload a logo first, then use Smart Theme.", "error");
        return;
      }
      const originalContent = smartBtn.innerHTML;
      extractingPalette = true;
      refreshPaletteButton();
      smartBtn.innerHTML = `<span class="material-symbols-rounded" style="animation:spin 1s linear infinite;">autorenew</span> Scanning…`;
      try {
        const { primary, accent } = await extractLogoPalette(source);
        if ((logoInput.files[0] || settings.logoUrl) !== source) return;
        const themeEl = document.getElementById("themeColor");
        const accentEl = document.getElementById("secondaryColor");
        if (themeEl) themeEl.value = primary;
        if (accentEl) accentEl.value = accent;
        updateThemePreview(primary, accent);
        applyBranding({ themeColor: primary, secondaryColor: accent });
        selectThemeCard(matchThemeId(primary, accent));
        toast("Colors extracted from your logo — click Save branding to apply.", "success", 4000);
      } catch (err) {
        toast(err.message || "Could not extract colors from logo.", "error");
      } finally {
        extractingPalette = false;
        refreshPaletteButton();
        smartBtn.innerHTML = originalContent;
      }
    });
  }

  document.getElementById("branding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      const logoFile = logoInput.files[0];
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
      if (logoInput.files[0] === logoFile) {
        logoInput.value = "";
        logoPreview.replaceChildren(brandingLogo(logoUrl));
      }
      document.getElementById("letterhead-logo")?.replaceChildren(letterheadLogo(logoUrl));
      refreshPaletteButton();
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

  const transferForm = document.getElementById("transfer-ownership-form");
  if (transferForm) {
    transferForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fullName = val("transferFullName");
      const email = val("transferEmail");
      const tempPassword = val("transferPassword");
      if (!fullName || !email || !tempPassword) {
        toast("Please fill in all fields to transfer ownership.", "error");
        return;
      }
      
      const { openModal } = await import("../js/components/modal.js");
      const modalBody = el("form", { class: "settings-form-grid" }, [
        el("p", { style: "color: var(--color-ink); margin-bottom: 12px; line-height: 1.5;" }, [
          "You are initiating a transfer of administrative control to ",
          el("strong", {}, fullName),
          " (",
          el("strong", {}, email),
          ")."
        ]),
        el("div", { class: "notice-banner notice-banner--warning", style: "margin-bottom: 16px;" }, [
          icon("hourglass_empty"),
          el("span", {}, "This will begin a 24-hour cooling-off period. Once 24 hours pass, Platform Support can approve it and you will lose access.")
        ]),
        field("confirm-transfer-text", "Type 'CONFIRM' below to proceed", "", "text", true, null, "CONFIRM"),
        el("div", { class: "settings-form-actions field--full", style: "justify-content: flex-end;" }, [
          el("button", { type: "submit", class: "btn btn--danger" }, [icon("warning"), "Initiate Transfer"])
        ])
      ]);

      const closeModal = openModal("Confirm Transfer Request", modalBody);
      
      modalBody.addEventListener("submit", async (eModal) => {
        eModal.preventDefault();
        const check = val("confirm-transfer-text");
        if (check !== "CONFIRM") {
          toast("You must type exactly 'CONFIRM'.", "error");
          return;
        }
        
        const btn = eModal.submitter;
        const { busyButton } = await import("../js/utils.js");
        const restore = busyButton(btn, "Initiating…");
        
        try {
          const { requestOwnershipTransfer } = await import("../js/services/settings.service.js");
          await requestOwnershipTransfer(profile.uid, { fullName, email, tempPassword });
          settings.pendingTransfer = { newAdmin: { fullName, email }, requestedAt: new Date().toISOString() };
          toast("Transfer requested. 24-hour cooling-off period has begun.", "success");
          closeModal();
          // We can use DOM reload or router navigation safely now!
          const { navigate } = await import("../js/router.js");
          navigate("/settings?tab=security");
        } catch (err) {
          toast(err.message || "Failed to initiate transfer.", "error");
          restore();
        }
      });
    });
  }
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
      "Two-factor authentication",
    ]),
    el("p", { class: "settings-card__sub" }, "Use an authenticator app to verify sign-ins to your account.")
  );
  const tfaContent = el("div", { id: "tfa-content", "aria-live": "polite" });
  tfaCard.append(tfaContent);
  authCol.append(tfaCard);

  async function loadTwoFactorStatus() {
    tfaContent.replaceChildren(el("p", { class: "settings-quiet" }, "Checking two-factor authentication…"));
    let enabled;
    try {
      enabled = await is2FAEnabled(profile.uid);
    } catch {
      tfaContent.replaceChildren(el("div", { class: "settings-inline-actions" }, [
        el("p", { class: "settings-quiet" }, "Could not check two-factor authentication."),
        el("button", { type: "button", class: "btn btn--outline btn--sm", onClick: loadTwoFactorStatus }, "Retry"),
      ]));
      return;
    }
    tfaContent.replaceChildren();
    if (enabled) {
      const badge = el("span", { class: "badge badge--success" }, "Enabled");
      const disableBtn = el("button", { type: "button", class: "btn btn--outline btn--sm" }, "Disable 2FA");
      disableBtn.addEventListener("click", () => {
        disableBtn.disabled = true;
        const codeInput = el("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", placeholder: "6-digit code", maxlength: "6", "aria-label": "Verification code", class: "settings-code-input" });
        const confirmBtn = el("button", { type: "button", class: "btn btn--danger btn--sm" }, "Confirm disable");
        const cancelBtn = el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => {
          row.remove();
          disableBtn.disabled = false;
          disableBtn.focus();
        } }, "Cancel");
        const row = el("div", { class: "settings-inline-actions settings-security-actions" }, [codeInput, confirmBtn, cancelBtn]);
        tfaContent.append(row);
        codeInput.focus();
        confirmBtn.addEventListener("click", async () => {
          const code = codeInput.value.trim();
          if (!code) return;
          const restore = busyButton(confirmBtn, "Disabling…");
          cancelBtn.disabled = true;
          try {
            await disable2FA(profile.uid, code);
            toast("Two-factor authentication disabled.", "success");
            tfaContent.innerHTML = "";
            renderSetup2FA(tfaContent, profile);
          } catch (err) {
            toast(err.message || "Invalid code.", "error");
            restore();
            cancelBtn.disabled = false;
          }
        });
      });
      tfaContent.append(el("div", { class: "settings-inline-actions" }, [badge, disableBtn]));
    } else {
      renderSetup2FA(tfaContent, profile);
    }
  }
  loadTwoFactorStatus();

  // 2. Device Approval Policy Card
  const policyCard = el("div", { class: "card settings-card" });
  policyCard.append(
    el("h3", {}, [
      icon("policy"),
      "New device approval",
    ]),
  );

  let requireApproval = settings.requireDeviceApproval !== false;
  const toggleRow = el("div", { style: "display:flex;align-items:flex-start;gap:14px;margin-top:4px;" });
  const toggleLabel = el("label", { style: "display:flex;align-items:flex-start;gap:12px;cursor:pointer;" });
  const toggleInput = el("input", { type: "checkbox", style: "width:20px;height:20px;cursor:pointer;flex-shrink:0;margin-top:2px;" });
  if (requireApproval) toggleInput.checked = true;

  const toggleText = el("div", {});
  const toggleTitle = el("span", { style: "font-weight:600;display:block;font-size:var(--fs-sm);" }, "Require approval for new browsers");
  const toggleSub = el("p", { class: "text-muted text-sm", style: "margin:4px 0 0;" }, requireApproval
    ? "A trusted device must approve each new browser."
    : "New browsers can sign in with valid credentials."
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
        ? "A trusted device must approve each new browser."
        : "New browsers can sign in with valid credentials.";
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

  // 5. Transfer Administrator Ownership Card
  const transferCard = el("details", { class: "card settings-card settings-ownership", open: settings.pendingTransfer ? "" : null });
  transferCard.append(
    el("summary", {}, "Transfer school ownership")
  );

  if (settings.pendingTransfer) {
    const pt = settings.pendingTransfer;
    transferCard.append(
      el("p", { class: "settings-card__sub" }, `A transfer to ${pt.newAdmin?.fullName} is currently pending. The 24-hour cooling-off period is active.`),
      el("div", { class: "notice-banner notice-banner--warning", style: "margin-top: 16px;" }, [
        icon("hourglass_empty"),
        el("span", {}, "Awaiting Platform Admin approval. See dashboard for countdown.")
      ]),
      el("div", { class: "settings-form-actions", style: "justify-content: flex-start; margin-top: 16px;" }, [
        el("button", { 
          class: "btn btn--outline btn--sm",
          onClick: async (e) => {
            if (!confirm("Cancel this transfer?")) return;
            const restore = busyButton(e.currentTarget, "Canceling…");
            try {
              const { cancelOwnershipTransfer } = await import("../js/services/settings.service.js");
              await cancelOwnershipTransfer(profile.uid);
              settings.pendingTransfer = null;
              toast("Transfer cancelled.", "success");
              // Quick reload to show the form again
              const { navigate } = await import("../js/router.js");
              navigate("/settings?tab=security");
            } catch (err) {
              toast("Failed to cancel transfer.", "error");
              restore();
            }
          }
        }, "Cancel Transfer")
      ])
    );
  } else {
    transferCard.append(
      el("p", { class: "settings-card__sub" }, "Transfer full administrative control to someone else. Requests have a 24-hour waiting period and require platform approval.")
    );
    const transferForm = el("form", { id: "transfer-ownership-form", class: "settings-form-grid", style: "margin-top:16px;" }, [
      field("transferFullName", "New Admin Full Name", "", "text", true, { title: "Full Name", text: "Name of the new administrator." }),
      field("transferEmail", "New Admin Email", "", "email", true, { title: "Email Address", text: "They will log in with this email." }),
      passwordField("transferPassword", "Temporary Password", "", { title: "Temporary Password", text: "Provide this to the new admin. They will be forced to change it on their first login." }, "••••••••"),
      el("div", { class: "settings-form-actions field--full", style: "justify-content:flex-start; margin-top:8px;" }, [
        el("button", { type: "submit", class: "btn btn--danger" }, [icon("warning"), "Initiate Transfer Request"])
      ])
    ]);
    transferCard.append(transferForm);
  }

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
          "Trusted devices",
        ]),
      ]),
      el("button", { type: "button", class: "btn btn--outline btn--sm", id: "btn-reset-devices", disabled: "" }, [icon("delete_sweep"), "Revoke all"]),
    ])
  );

  const devicesList = el("div", { class: "device-list settings-device-list", id: "devices-list", "aria-live": "polite" });
  devicesCard.append(devicesList);
  devicesCol.append(devicesCard);

  const resetAllBtn = devicesCard.querySelector("#btn-reset-devices");
  resetAllBtn.addEventListener("click", async () => {
    if (!confirm("Revoke all trusted devices? You will need to re-verify on your next login.")) return;
    const restore = busyButton(resetAllBtn, "Revoking…");
    try {
      await resetAllTrustedDevices(profile.uid);
      toast("All trusted devices revoked.", "success");
    } catch {
      toast("Failed to revoke devices.", "error");
      restore();
      return;
    }
    restore();
    await loadDevices();
  });

  async function loadDevices() {
    resetAllBtn.disabled = true;
    devicesList.replaceChildren(el("p", { class: "settings-quiet" }, "Loading trusted devices…"));
    try {
      const devices = await listTrustedDevices(profile.uid);
      devicesList.replaceChildren();
      if (devices.length === 0) {
        devicesList.append(el("p", { class: "text-muted text-sm", style: "padding:8px 0;" }, "No trusted devices registered yet."));
        return;
      }
      resetAllBtn.disabled = false;
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
            el("div", { class: "device-card__detail" }, [d.screenRes, d.timezone, `Last active ${lastSeen}`, `Added ${registered}`].filter(Boolean).join(" · ")),
          ]),
          el("div", { class: "device-card__actions" }, [
            el("button", {
              type: "button",
              class: "btn btn--outline btn--sm",
              title: "Revoke device",
              "aria-label": `Revoke ${d.deviceName || "trusted device"}`,
              onClick: async (event) => {
                if (!confirm(`Revoke device "${d.deviceName}"?`)) return;
                const restore = busyButton(event.currentTarget, "Revoking…");
                try {
                  await removeTrustedDevice(profile.uid, d.id);
                  toast("Device revoked.", "success");
                  await loadDevices();
                } catch (err) {
                  toast(err.message || "Could not revoke this device.", "error");
                  restore();
                }
              },
            }, [icon("delete")]),
          ]),
        ]);
        devicesList.append(card);
      }
    } catch {
      devicesList.replaceChildren(el("p", { class: "settings-quiet" }, "Could not load trusted devices."));
    }
  }
  loadDevices();

  // 4. Recent Login Activity Card
  const activityCard = el("div", { class: "card settings-card" });
  activityCard.append(
    el("h3", {}, [
      icon("history"),
      "Recent sign-in requests",
    ]),
  );
  const activityTable = el("div", { id: "login-activity", class: "table-wrap table-wrap--responsive", style: "border:none;" });
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
            el("td", { "data-label": "Device" }, a.deviceName || "Browser session"),
            el("td", { "data-label": "Time" }, time),
            el("td", { "data-label": "Status" }, statusContent),
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
  wrap.append(grid, transferCard);
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
            el("p", { class: "backup-codes__warning" }, "Keep these backup codes secure. They will not be displayed again."),
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
