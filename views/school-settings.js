import { getSchoolSettings, saveSchoolSettings, uploadSchoolLogo, isSlugAvailable, publishSchoolBranding, slugify, SLUG_PREFIX } from "../js/services/settings.service.js";
import { activateSubscription, getSubscriptionState, SUBSCRIPTION_PLANS } from "../js/services/subscription.service.js";
import { invalidateSchoolSettingsCache, refreshSchoolChrome } from "../js/components/shell.js";
import { getCurrentSchoolId, refreshCurrentSchool } from "../js/services/auth.service.js";
import { THEME_PRESETS, matchThemeId } from "../js/theme-presets.js";
import { el, icon, toast, busyButton, formatDate } from "../js/utils.js";

let settings = null;
let activeThemeId = "custom";
let gradingRowSeq = 0;

const TABS = [
  { id: "profile", label: "Profile", icon: "domain" },
  { id: "branding", label: "Branding & Themes", icon: "palette" },
  { id: "leadership", label: "Leadership", icon: "badge" },
  { id: "calendar", label: "Academic Calendar", icon: "event" },
  { id: "grading", label: "Grading Scale", icon: "grading" },
  { id: "subscription", label: "Subscription", icon: "workspace_premium" },
];

export async function render({ profile }) {
  settings = await getSchoolSettings();
  activeThemeId = settings.themeId || matchThemeId(settings.themeColor, settings.secondaryColor);

  const wrap = el("div", { class: "settings-page" });
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", {}, "These details feed report cards, receipts, newsletters, and the rest of the dashboard - review each tab below."),
      ]),
    ])
  );

  const panels = {};
  const tabsNav = el("div", { class: "page-tabs" });

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
  const card = el("div", { class: "card settings-card" });
  card.append(
    el("h3", {}, "School Profile"),
    el("p", { class: "text-sm text-muted" }, "Your school's name, motto and contact details, as they should appear on official documents.")
  );
  const form = el("form", { id: "settings-form", class: "settings-form-grid" });
  form.append(
    field("schoolName", "School Name", settings.schoolName),
    field("motto", "Motto", settings.motto),
    field("address", "Address", settings.address, "text", true),
    field("phone", "Phone", settings.phone),
    field("email", "Email", settings.email, "email"),
  );
  // The login link card lives inside this same form, above the Save
  // button, so it's visually obvious that saving covers the school code
  // too - not just the fields above it.
  form.append(buildLoginLinkCard());
  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save profile"]),
    ])
  );
  card.append(form);
  return card;
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
  const card = el("div", { class: "card settings-card settings-login-link" });
  card.append(
    el("h3", {}, "Your School Login Link"),
    el("p", { class: "text-sm text-muted" }, "Share this link with your staff and parents so they land on your school's own branded sign-in page instead of the generic one. Every code starts with \u201cees-\u201d so it's recognizable as an Eeskia link."),
    el("p", { class: "text-sm text-muted" }, "Changing the code changes the link - anyone still using the old link or code (bookmarked, saved, shared earlier) won't be able to use it anymore, so only change it if you really need to.")
  );

  // Suggest a code from the school name for schools that haven't set one
  // yet, instead of handing them a blank field to figure out themselves.
  const initialSuffix = settings.slug ? slugSuffix(settings.slug) : slugify(settings.schoolName || "");

  const prefixBadge = el("span", { class: "slug-input__prefix" }, `${SLUG_PREFIX}-`);
  const codeInput = el("input", {
    id: "school-slug",
    type: "text",
    value: initialSuffix,
    placeholder: "e.g. greenhill-jss",
    maxlength: "36", // 40 total minus the "ees-" prefix
  });
  const inputGroup = el("div", { class: "slug-input-group" }, [prefixBadge, codeInput]);

  const availabilityMsg = el("div", { class: "text-sm", id: "slug-availability", style: "min-height:18px;margin-top:4px;" });
  const unsavedMsg = el("div", { class: "text-sm", id: "slug-unsaved", style: "min-height:18px;color:var(--color-gold);display:none;" }, [
    icon("info", "text-sm"), " Not saved yet - click \u201cSave profile\u201d below for this link to work.",
  ]);
  const linkPreview = el("div", { class: "text-sm text-muted", id: "slug-link-preview", style: "margin-top:8px;word-break:break-all;" });
  const copyBtn = el("button", { type: "button", class: "btn btn--ghost btn--sm", id: "copy-login-link" }, [icon("content_copy"), "Copy link"]);

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
    linkPreview.textContent = full ? loginLinkFor(full) : "Enter a code above to see your link.";
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
    availabilityMsg.textContent = "Checking availability…";
    availabilityMsg.style.color = "var(--color-ink-soft)";
    const available = await isSlugAvailable(full, getCurrentSchoolId()).catch(() => false);
    availabilityMsg.textContent = available ? "Available." : "That code is already taken - try another.";
    availabilityMsg.style.color = available ? "var(--color-green)" : "var(--color-red)";
  });

  copyBtn.addEventListener("click", async () => {
    const full = currentFullSlug() || settings.slug;
    if (!full) {
      toast("Set a school code first, then save.", "error");
      return;
    }
    if (isDirty()) {
      toast("Save your profile first so this link actually works.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(loginLinkFor(full));
      toast("Login link copied.", "success");
    } catch {
      toast("Couldn't copy automatically - copy the link text manually.", "error");
    }
  });

  card.append(
    el("div", { class: "field" }, [
      el("label", { for: "school-slug" }, "School Code"),
      inputGroup,
      availabilityMsg,
      unsavedMsg,
    ]),
    linkPreview,
    el("div", { class: "settings-form-actions" }, [copyBtn])
  );

  loginLinkUI = { refreshPreview, refreshDirtyState };

  return card;
}

// ===========================================================================
// Branding & Themes tab
// ===========================================================================

function buildBrandingTab() {
  const wrap = el("div", { class: "settings-stack" });

  // --- Logo card ---
  const logoCard = el("div", { class: "card settings-card" });
  logoCard.append(el("h3", {}, "School Logo"));
  const logoRow = el("div", { class: "brand-logo-row" });
  const logoPreview = el(
    "div",
    { class: "brand-logo-preview", id: "logo-preview" },
    settings.logoUrl
      ? el("img", { src: settings.logoUrl })
      : el("span", { class: "material-symbols-rounded" }, "photo_camera")
  );
  logoRow.append(
    logoPreview,
    el("div", {}, [
      el("input", { type: "file", id: "logo-input", accept: "image/*" }),
      el("p", { class: "text-sm text-muted", style: "margin-top:6px;" }, "PNG or JPG, shown on the sidebar, report cards and receipts."),
    ])
  );
  logoCard.append(logoRow);
  wrap.append(logoCard);

  // --- Theme gallery card ---
  const galleryCard = el("div", { class: "card settings-card" });
  galleryCard.append(
    el("h3", {}, "Theme Gallery"),
    el("p", { class: "text-sm text-muted" }, "Pick a preset theme to install it instantly, then fine-tune the exact shades below if you like.")
  );
  const gallery = el("div", { class: "theme-gallery", id: "theme-gallery" });
  for (const t of THEME_PRESETS) gallery.append(themeCard(t));
  galleryCard.append(gallery);
  wrap.append(galleryCard);

  // --- Custom colors + live preview card ---
  const customCard = el("div", { class: "card settings-card" });
  customCard.append(el("h3", {}, "Fine-Tune Colors"));
  const form = el("form", { id: "branding-form" });

  const brandingRow = el("div", { style: "display:flex; gap:16px; flex-wrap:wrap;" }, [
    el("div", { class: "field", style: "flex:1; min-width:160px;" }, [
      el("label", { for: "themeColor" }, "Primary Brand Color"),
      el("input", { id: "themeColor", type: "color", value: settings.themeColor || "#14538A" }),
    ]),
    el("div", { class: "field", style: "flex:1; min-width:160px;" }, [
      el("label", { for: "secondaryColor" }, "Accent Color"),
      el("input", { id: "secondaryColor", type: "color", value: settings.secondaryColor || "#C9A227" }),
    ]),
  ]);
  form.append(brandingRow);
  form.append(
    el("p", { class: "text-sm text-muted" }, "These colors theme your sidebar, buttons, and report card letterhead.")
  );
  form.append(buildThemePreview());
  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save branding"]),
    ])
  );
  customCard.append(form);
  wrap.append(customCard);

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
  toast(`${t.name} theme ready to save.`, "info", 2500);
}

function buildThemePreview() {
  const preview = el("div", { class: "theme-preview", id: "theme-preview" }, [
    el("div", { class: "theme-preview__sidebar", id: "preview-sidebar" }, [
      el("span", { class: "theme-preview__dot" }),
      el("span", { class: "theme-preview__line" }),
      el("span", { class: "theme-preview__line", style: "width:60%;" }),
    ]),
    el("div", { class: "theme-preview__main" }, [
      el("span", { class: "theme-preview__btn", id: "preview-btn" }, "Save"),
      el("span", { class: "theme-preview__chip", id: "preview-chip" }, "Accent"),
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
    el("h3", {}, "School Leadership"),
    el("div", { class: "notice-banner" }, [
      icon("info"),
      el("span", {}, "These names appear on newsletters and can be used to sign off report cards and official notices."),
    ])
  );
  const form = el("form", { id: "leadership-form", class: "settings-form-grid" });

  const principalGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [icon("badge"), "Principal"]),
    field("principalName", "Full Name", settings.principalName),
    field("principalTitle", "Title shown on documents", settings.principalTitle || "Principal"),
  ]);
  const deputyGroup = el("div", { class: "leadership-group" }, [
    el("div", { class: "leadership-group__title" }, [icon("badge"), "Deputy Principal"]),
    field("deputyPrincipalName", "Full Name", settings.deputyPrincipalName),
    field("deputyPrincipalTitle", "Title shown on documents", settings.deputyPrincipalTitle || "Deputy Principal"),
  ]);

  form.append(principalGroup, deputyGroup);
  form.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save leadership"]),
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
  card.append(el("h3", {}, "Academic Calendar"));
  const calForm = el("form", { id: "calendar-form", class: "settings-form-grid" });
  calForm.append(field("currentAcademicYear", "Current Academic Year", settings.currentAcademicYear));
  const termSelect = el("select", { id: "currentTerm" });
  for (const term of settings.terms || ["Term 1", "Term 2", "Term 3"]) {
    termSelect.append(el("option", { value: term, ...(term === settings.currentTerm ? { selected: "true" } : {}) }, term));
  }
  calForm.append(el("div", { class: "field" }, [el("label", {}, "Current Term"), termSelect]));
  calForm.append(
    field("closingDate", "School Closes On", settings.closingDate, "date"),
    field("openingDate", "Next Term Begins", settings.openingDate, "date"),
  );
  calForm.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("save"), "Save calendar"]),
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
    el("h3", {}, "CBC Grading Scale"),
    el("div", { class: "notice-banner" }, [
      icon("info"),
      el("span", {}, "Used to auto-grade marks entries and feed the Grading & Position engine. Ranges should not overlap; Points is what gets summed into a student's total/mean points."),
    ])
  );
  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Min %"), el("th", {}, "Max %"), el("th", {}, "Grade"),
      el("th", {}, "Points"), el("th", {}, "Remark"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody", { id: "grading-tbody" });
  for (const row of settings.gradingScale) tbody.append(gradingRow(row));
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  card.append(
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "button", id: "add-grading-row", class: "btn btn--ghost btn--sm" }, [icon("add"), "Add row"]),
      el("button", { type: "button", id: "save-grading", class: "btn btn--primary" }, [icon("save"), "Save grading scale"]),
    ])
  );
  return card;
}

// ===========================================================================
// Subscription tab
// ===========================================================================
// Shows the school's current subscription state (read-only - it can only
// change via the activate call below, never via a normal settings save;
// firestore.rules blocks a direct write to these fields on purpose) and a
// field to redeem a token handed over by the platform administrator.
// ===========================================================================

function buildSubscriptionTab() {
  const card = el("div", { class: "card settings-card" });
  card.append(el("h3", {}, "Subscription"));

  const { active, daysRemaining } = getSubscriptionState(settings);
  const planLabel = SUBSCRIPTION_PLANS.find((p) => p.value === settings.subscriptionPlan)?.label || settings.subscriptionPlan;

  const statusBanner = el("div", { class: `notice-banner${active ? "" : " notice-banner--warning"}` });
  if (settings.subscriptionStatus === "inactive" || !settings.subscriptionExpiresAt) {
    statusBanner.append(icon("info"), el("span", {}, "No active subscription. Contact the platform administrator to get a subscription token, then paste it below."));
  } else if (active) {
    statusBanner.append(icon("check_circle"), el("span", {}, `${planLabel} plan is active - ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining (expires ${formatDate(settings.subscriptionExpiresAt)}).`));
  } else {
    statusBanner.append(icon("error"), el("span", {}, `Your subscription expired on ${formatDate(settings.subscriptionExpiresAt)}. The system is locked until it's renewed - contact the platform administrator for a new token.`));
  }
  card.append(statusBanner);

  const form = el("form", { id: "subscription-form", class: "settings-form-grid", style: "margin-top:16px;" }, [
    el("div", { class: "field field--full" }, [
      el("label", { for: "sub-token" }, "Subscription token"),
      el("textarea", { id: "sub-token", rows: "3", placeholder: "Paste the token from the platform administrator here", style: "font-family:monospace;font-size:0.85rem;" }),
    ]),
    el("div", { class: "settings-form-actions" }, [
      el("button", { type: "submit", class: "btn btn--primary" }, [icon("key"), "Activate subscription"]),
    ]),
  ]);
  card.append(form);
  return card;
}

function field(id, label, value = "", type = "text", full = false) {
  return el("div", { class: `field${full ? " field--full" : ""}` }, [
    el("label", { for: id }, label),
    el("input", { id, type, value: value || "" }),
  ]);
}

function gradingRow(row = {}) {
  const tr = el("tr", {}, [
    el("td", {}, el("input", { type: "number", value: row.min ?? "", class: "grade-min", style: "width:70px;" })),
    el("td", {}, el("input", { type: "number", value: row.max ?? "", class: "grade-max", style: "width:70px;" })),
    el("td", {}, el("input", { type: "text", value: row.grade ?? "", class: "grade-code", style: "width:70px;" })),
    el("td", {}, el("input", { type: "number", value: row.points ?? "", class: "grade-points", style: "width:70px;" })),
    el("td", {}, el("input", { type: "text", value: row.remark ?? "", class: "grade-remark" })),
    el("td", {}, el("button", {
      type: "button", class: "btn btn--ghost btn--sm", title: "Remove row",
      onClick: (e) => e.currentTarget.closest("tr").remove(),
    }, icon("delete"))),
  ]);
  return tr;
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
      await saveSchoolSettings(profile.uid, {
        schoolName,
        motto: val("motto"),
        address: val("address"),
        phone: val("phone"),
        email: val("email"),
        slug: cleanSlug,
      });
      settings.schoolName = schoolName;
      settings.slug = cleanSlug;
      if (cleanSlug) {
        await publishSchoolBranding(getCurrentSchoolId(), {
          slug: cleanSlug,
          previousSlug,
          schoolName,
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