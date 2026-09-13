import {
  CATEGORIES,
  CHANNELS,
  categoryMeta,
  listNotifications,
  createNotification,
  setNotificationStatus,
  deleteNotification,
  resolveRecipients,
  buildTemplate,
  markNotificationsAsSeen,
} from "../js/services/notification.service.js";
import {
  listNewsletters,
  createNewsletter,
  updateNewsletter,
  setNewsletterStatus,
  deleteNewsletter,
  uploadNewsletterImage,
} from "../js/services/newsletter.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listClasses } from "../js/services/academic.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listParents } from "../js/services/parent.service.js";
import { getFeeSummary } from "../js/services/fee.service.js";
import { downloadElementAsPdf, prewarmPdfLibs } from "../js/services/pdf.util.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, formatDate, busyButton, spinner } from "../js/utils.js";

const CAN_MANAGE = ["admin", "principal", "deputy_principal", "academic_master", "class_teacher", "bursar", "registrar"];

let activeTab = "notifications";
let notifications = [];
let newsletters = [];
let settings = null;
let classes = [];
let students = [];
let parents = [];

/**
 * Contextual help tooltip using dark-slate bubble styling.
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
 * Dynamic Academic Communications Officer mascot with broadcast horn and verified delivery envelope.
 */
export function buildNotificationsMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="notifications-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Notifications Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Delivery Envelope -->
        <g class="notifications-mascot__envelope">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Mail Envelope -->
          <rect x="54" y="126" width="30" height="22" rx="2" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" transform="rotate(-8 69 137)" />
          <path d="M54,126 L69,139 L84,126" stroke="#14538A" stroke-width="1.2" fill="none" transform="rotate(-8 69 137)" />
          <!-- Green Verified Delivery Badge -->
          <circle cx="78" cy="142" r="5" fill="#059669" />
          <polyline points="76,142 77.5,143.5 80.5,140.5" stroke="#FFFFFF" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <!-- Hand Holding Envelope -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Broadcast Megaphone / Horn (Animated) -->
        <g class="notifications-mascot__horn">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Megaphone Handle -->
          <line x1="150" y1="110" x2="158" y2="120" stroke="#14538A" stroke-width="4" stroke-linecap="round" />
          <!-- Megaphone Body Cone -->
          <path d="M152,102 L176,90 L176,120 L152,112 Z" fill="#F59E0B" stroke="#B45309" stroke-width="1.2" />
          <ellipse cx="176" cy="105" rx="4" ry="15" fill="#FDE68A" stroke="#B45309" stroke-width="1" />
          <!-- Megaphone Rear Cap -->
          <rect x="146" y="104" width="7" height="6" rx="1.5" fill="#0D3559" />
          <!-- Acoustic Broadcast Waves -->
          <path d="M185,97 C190,102 190,108 185,113" stroke="#F59E0B" stroke-width="1.8" fill="none" stroke-linecap="round" />
          <path d="M190,92 C198,100 198,110 190,118" stroke="#D97706" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.8" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

export async function render({ profile }) {
  [notifications, newsletters, settings, classes, students, parents] = await Promise.all([
    listNotifications(),
    listNewsletters(),
    getSchoolSettings(),
    listClasses(),
    listStudents(),
    listParents(),
  ]);

  markNotificationsAsSeen(profile.uid);

  const wrap = el("div", { class: "notifications-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildNotificationsMascotSvg({ width: 125, height: 110 });

  // Executive Hero Banner (Clean & Modern)
  const heroBanner = el("div", { class: "notifications-hero" }, [
    el("div", { class: "notifications-hero__content" }, [
      el("div", { class: "notifications-hero__status-row" }, [
        el("span", { class: "academics-cycle-badge" }, [
          icon("campaign", "text-xs"),
          "Multi-Channel Dispatch",
        ]),
      ]),
      el("h1", { class: "notifications-hero__title" }, "Notifications & Newsletters"),
      el("p", { class: "notifications-hero__desc" }, "Broadcast parent SMS and email alerts, track delivery queues, and publish newsletters."),
      el("div", { class: "notifications-hero__pills" }, [
        el("div", { class: "notifications-pill" }, [icon("send"), `${notifications.length} Sent`]),
        el("div", { class: "notifications-pill" }, [icon("newspaper"), `${newsletters.length} Newsletters`]),
        el("div", { class: "notifications-pill" }, [icon("contacts"), `${parents.length} Parents`]),
      ]),
    ]),

    // Mascot & Speech Bubble
    el("div", { class: "notifications-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Dispatch alerts & news."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Segmented Tabs
  const tabNav = el("div", { class: "page-tabs no-print", style: "margin-bottom:var(--sp-4);" });
  const panelMount = el("div", { id: "notifications-panel-mount" });

  function renderTabs() {
    tabNav.innerHTML = "";
    const tabs = [
      { id: "notifications", label: `Broadcasts (${notifications.length})`, iconName: "notifications" },
      { id: "newsletters", label: `Newsletters (${newsletters.length})`, iconName: "newspaper" },
    ];
    tabs.forEach((tab) => {
      const btn = el(
        "button",
        {
          type: "button",
          class: `profile-tab ${activeTab === tab.id ? "profile-tab--active" : ""}`,
          onClick: () => {
            if (activeTab === tab.id) return;
            activeTab = tab.id;
            renderTabs();
            renderPanel(panelMount, profile);
          },
        },
        [icon(tab.iconName, "text-xs"), tab.label]
      );
      tabNav.append(btn);
    });
  }

  renderTabs();
  wrap.append(tabNav);
  wrap.append(panelMount);

  renderPanel(panelMount, profile);

  return wrap;
}

export function init() {
  prewarmPdfLibs();
}

function renderPanel(panel, profile) {
  panel.innerHTML = "";
  if (activeTab === "notifications") renderNotificationsTab(panel, profile);
  else renderNewslettersTab(panel, profile);
}

async function refresh(profile) {
  [notifications, newsletters] = await Promise.all([listNotifications(), listNewsletters()]);
  const panel = document.querySelector("#notifications-panel-mount");
  if (panel) renderPanel(panel, profile);
}

// =========================================================================
// Notifications tab
// =========================================================================

function renderNotificationsTab(panel, profile) {
  const canManage = CAN_MANAGE.includes(profile.role);

  const hasProvider = settings.notificationProviders?.gmail?.appPassword || settings.notificationProviders?.africasTalking?.apiKey;

  if (!hasProvider) {
    panel.append(
      el("div", { class: "notice-banner", style: "margin-bottom:var(--sp-4);" }, [
        el("span", { class: "material-symbols-rounded" }, "info"),
        el(
          "span",
          {},
          "No SMS or email provider connected yet. Configure Africa's Talking or Gmail in Settings -> Notifications."
        ),
      ])
    );
  }

  // 1. KPI Metrics Grid
  panel.append(renderNotificationKpis());

  // 2. Clean Quick Templates Toolbar
  if (canManage) {
    const templateBar = el("div", { class: "card", style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);" }, [
      el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;" }, [
        el("div", { style: "display:flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
          el("span", { style: "font-weight:700; font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:0.04em; color:var(--color-ink-soft); margin-right:4px;" }, "Quick Templates:"),
          ...[
            { category: "fees", label: "Fee Reminder", icon: "payments" },
            { category: "results", label: "Results Published", icon: "grading" },
            { category: "term_closing", label: "Term Closing", icon: "event_busy" },
            { category: "term_opening", label: "Term Opening", icon: "event_available" },
          ].map((t) => {
            const chip = el("button", { type: "button", class: "template-chip" }, [
              el("span", { class: "material-symbols-rounded" }, t.icon),
              t.label,
            ]);
            chip.addEventListener("click", () => openComposeModal(profile, { category: t.category }));
            return chip;
          }),
        ]),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => openComposeModal(profile, { category: "general" }),
        }, [icon("campaign"), "Custom Broadcast"]),
      ]),
    ]);
    panel.append(templateBar);
  }

  // 3. Table Card
  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const tableHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("history", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "Broadcast History"),
      el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${notifications.length} Sent`),
    ]),
  ]);
  tableCard.append(tableHeader);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  tableCard.append(tableWrap);
  renderNotificationsTable(tableWrap, profile, canManage);
  panel.append(tableCard);
}

function renderNotificationKpis() {
  const total = notifications.length;
  const delivered = notifications.filter((n) => n.status === "delivered").length;
  const queued = notifications.filter((n) => n.status === "queued").length;
  const contactable = parents.filter((p) => p.phone || p.email).length;

  const kpis = [
    { label: "Total Sent", value: total, icon: "send", color: "blue" },
    { label: "Delivered", value: delivered, icon: "mark_email_read", color: "green" },
    { label: "Queued", value: queued, icon: "schedule", color: "gold" },
    { label: "Reachable Parents", value: `${contactable}/${parents.length}`, icon: "contacts", color: "blue" },
  ];

  const grid = el("div", { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" });
  for (const k of kpis) {
    const chip = el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, k.label),
        el("div", { class: "md3-kpi-chip__value numeric" }, String(k.value)),
      ]),
    ]);
    grid.append(chip);
  }
  return grid;
}

function audienceLabel(n) {
  if (!n.audience || n.audience.type === "all") return "All Parents";
  if (n.audience.type === "grade") return n.audience.grade || "Grade";
  return n.audience.label || `${n.recipientCount} selected`;
}

function renderNotificationsTable(container, profile, canManage) {
  container.innerHTML = "";
  if (!notifications.length) {
    container.append(
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-symbols-rounded empty-state__icon" }, "notifications"),
        el("h3", {}, "No broadcasts sent yet"),
        el("p", {}, canManage ? "Use a quick template above or compose a custom announcement." : "No announcements have been broadcast to parents yet."),
      ])
    );
    return;
  }

  const table = el("table", { class: "reports-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "min-width:220px;" }, "Title"),
      el("th", { style: "width:140px;" }, "Category"),
      el("th", { style: "width:130px;" }, "Audience"),
      el("th", { class: "numeric", style: "width:100px;" }, "Recipients"),
      el("th", { style: "width:110px;" }, "Channel"),
      el("th", { style: "width:130px;" }, "Sent"),
      el("th", { style: "width:110px;" }, "Status"),
      canManage ? el("th", { class: "col-right", style: "width:90px;" }, "Actions") : "",
    ])),
  ]);
  const tbody = el("tbody", {});

  for (const n of notifications) {
    const meta = categoryMeta(n.category);
    const row = [
      el("td", { "data-label": "Title" }, [
        el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, n.title),
        el("div", { class: "text-xs text-muted" }, n.body ? `${n.body.slice(0, 60)}${n.body.length > 60 ? "…" : ""}` : ""),
      ]),
      el("td", { "data-label": "Category" }, [
        el("span", { class: "badge badge--muted" }, [
          el("span", { class: "material-symbols-rounded", style: "font-size:14px; vertical-align:-2px;" }, meta.icon),
          ` ${meta.label}`,
        ]),
      ]),
      el("td", { "data-label": "Audience" }, audienceLabel(n)),
      el("td", { class: "numeric", "data-label": "Recipients" }, String(n.recipientCount ?? 0)),
      el("td", { "data-label": "Channel" }, el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, (CHANNELS.find((c) => c.value === n.channel)?.label) || n.channel || "N/A")),
      el("td", { "data-label": "Sent" }, n.createdAt ? formatDate(n.createdAt) : "—"),
      el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${n.status === "delivered" ? "success" : "gold"}` }, n.status === "delivered" ? "Delivered" : "Queued")),
    ];

    if (canManage) {
      const actionsCell = el("td", { class: "col-right", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
          el(
            "button",
            {
              class: "btn btn--ghost btn--sm",
              title: n.status === "delivered" ? "Mark as queued" : "Mark as delivered",
              onClick: (ev) => toggleStatus(profile, n, ev.currentTarget),
            },
            [el("span", { class: "material-symbols-rounded", style: "font-size:18px;" }, n.status === "delivered" ? "undo" : "mark_email_read")]
          ),
          el(
            "button",
            { class: "btn btn--ghost btn--sm", title: "Delete", style: "padding:6px; color:var(--color-red); border-color:transparent;", onClick: () => confirmDeleteNotification(profile, n) },
            [el("span", { class: "material-symbols-rounded", style: "font-size:18px;" }, "delete")]
          ),
        ]),
      ]);
      row.push(actionsCell);
    }

    tbody.append(el("tr", {}, row));
  }
  table.append(tbody);
  container.append(table);
}

async function toggleStatus(profile, n, button) {
  const next = n.status === "delivered" ? "queued" : "delivered";
  const restore = busyButton(button);
  try {
    await setNotificationStatus(profile.uid, n.id, next);
    toast(`Marked as ${next}.`, "success");
    await refresh(profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
    restore();
  }
}

function confirmDeleteNotification(profile, n) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${n.title}"? This only removes it from the history - nothing further will be affected.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", {
        class: "btn btn--danger",
        onClick: async (ev) => {
          const restore = busyButton(ev.currentTarget, "Deleting…");
          try {
            await deleteNotification(profile.uid, n.id);
            toast("Notification deleted.", "success");
            close();
            await refresh(profile);
          } catch (err) {
            toast(err.message || "Could not delete.", "error");
            restore();
          }
        },
      }, "Delete"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Delete Notification", body);
}

// ---------------------------------------------------------- compose modal --

async function computeFeeBalanceAudience() {
  const active = students.filter((s) => s.status === "active");
  const withBalance = [];
  await Promise.all(
    active.map(async (s) => {
      if (!s.grade) return;
      try {
        const summary = await getFeeSummary({
          studentId: s.id,
          grade: s.grade,
          academicYear: settings.currentAcademicYear || "",
          term: settings.currentTerm || "",
        });
        if (summary.balance > 0) withBalance.push(s.id);
      } catch {
        // no fee structure set for this grade/term yet - skip
      }
    })
  );
  return withBalance;
}

async function openComposeModal(profile, opts = {}) {
  const category = opts.category || "general";
  const isFees = category === "fees";

  let presetStudentIds = null;
  if (isFees) {
    toast("Working out who has a fee balance…", "info", 2000);
    presetStudentIds = await computeFeeBalanceAudience();
  }

  const ctx = {
    term: settings.currentTerm,
    academicYear: settings.currentAcademicYear,
    closingDate: settings.closingDate ? formatDate(settings.closingDate) : "",
    openingDate: settings.openingDate ? formatDate(settings.openingDate) : "",
    grade: opts.grade || (classes[0]?.grade ?? ""),
  };
  const tpl = buildTemplate(category, ctx);

  const body = el("form", {});

  const categorySelect = el(
    "select",
    { id: "n-category" },
    CATEGORIES.map((c) => el("option", { value: c.value, ...(c.value === category ? { selected: "true" } : {}) }, c.label))
  );
  const titleInput = el("input", { id: "n-title", value: tpl.title, placeholder: "e.g. Term 2 Closing Notice" });
  const bodyTextarea = el("textarea", { id: "n-body", rows: "6" }, tpl.body);
  const channelSelect = el(
    "select",
    { id: "n-channel" },
    CHANNELS.map((c) => el("option", { value: c.value }, c.label))
  );

  const initialAudienceType = category === "fees" ? "individual" : category === "results" ? "grade" : "all";
  const audienceOptions = [
    { value: "all", label: "All Parents" },
    { value: "grade", label: "Specific Grade" },
  ];
  if (isFees) audienceOptions.push({ value: "individual", label: `Students with a fee balance (${presetStudentIds.length})` });

  const audienceSelect = el(
    "select",
    { id: "n-audience" },
    audienceOptions.map((o) => el("option", { value: o.value, ...(o.value === initialAudienceType ? { selected: "true" } : {}) }, o.label))
  );
  const gradeSelect = el(
    "select",
    { id: "n-grade" },
    classes.map((c) => el("option", { value: c.grade, ...(c.grade === ctx.grade ? { selected: "true" } : {}) }, c.grade))
  );
  const gradeField = el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]);
  gradeField.style.display = initialAudienceType === "grade" ? "" : "none";

  const recipientPreview = el("p", { class: "text-muted", style: "margin:4px 0 16px;" });

  function currentAudience() {
    const type = audienceSelect.value;
    if (type === "grade") return { type: "grade", grade: gradeSelect.value };
    if (type === "individual") return { type: "individual", studentIds: presetStudentIds || [] };
    return { type: "all" };
  }

  function refreshPreview() {
    gradeField.style.display = audienceSelect.value === "grade" ? "" : "none";
    const recipients = resolveRecipients(currentAudience(), { students, parents });
    recipientPreview.textContent = `${recipients.length} parent(s) will receive this.`;
  }

  audienceSelect.addEventListener("change", refreshPreview);
  gradeSelect.addEventListener("change", refreshPreview);

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Category"), categorySelect]),
    el("div", { class: "field" }, [el("label", {}, "Title"), titleInput]),
    el("div", { class: "field" }, [el("label", {}, "Message"), bodyTextarea]),
    el("div", { class: "field" }, [el("label", {}, "Audience"), audienceSelect]),
    gradeField,
    recipientPreview,
    el("div", { class: "field" }, [el("label", {}, "Intended channel"), channelSelect]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("send"), "Send Notification"])
  );

  refreshPreview();
  const close = openModal(categoryMeta(category).label, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const title = titleInput.value.trim();
    const text = bodyTextarea.value.trim();
    if (!title || !text) {
      toast("Title and message are required.", "error");
      restore();
      return;
    }
    const audience = currentAudience();
    const recipients = resolveRecipients(audience, { students, parents });
    if (!recipients.length) {
      toast("No parents match this audience yet.", "error");
      restore();
      return;
    }
    try {
      await createNotification(profile.uid, {
        title,
        body: text,
        category: categorySelect.value,
        channel: channelSelect.value,
        audience: {
          ...audience,
          label: audience.type === "all" ? "All Parents" : audience.type === "grade" ? audience.grade : `${recipients.length} selected parent(s)`,
        },
        recipients,
      });
      toast("Notification recorded and queued.", "success");
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save notification.", "error");
      restore();
    }
  });
}

// =========================================================================
// Newsletters tab
// =========================================================================

function renderNewslettersTab(panel, profile) {
  const canManage = CAN_MANAGE.includes(profile.role);

  const header = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--sp-4); flex-wrap:wrap; gap:8px;",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("newspaper", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "School Newsletters"),
      el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${newsletters.length} Published`),
    ]),
    canManage
      ? el("button", { class: "btn btn--primary btn--sm", onClick: () => openNewsletterForm(profile) }, [icon("add"), "New Newsletter"])
      : "",
  ]);
  panel.append(header);

  if (!newsletters.length) {
    panel.append(
      el("div", { class: "card empty-state" }, [
        el("span", { class: "material-symbols-rounded empty-state__icon" }, "newspaper"),
        el("h3", {}, "No newsletters yet"),
        el("p", {}, canManage ? "Click '+ New Newsletter' to draft your first one." : "Nothing has been published yet."),
      ])
    );
    return;
  }

  for (const nl of newsletters) {
    const card = el("div", { class: "newsletter-card" }, [
      el("div", { style: "display:flex; gap:12px; flex:1; min-width:220px; align-items:center;" }, [
        nl.heroImageUrl ? el("img", { class: "newsletter-card__thumb", src: nl.heroImageUrl, alt: "" }) : "",
        el("div", {}, [
          el("div", { class: "newsletter-card__title" }, nl.title),
          el("div", { class: "newsletter-card__meta" }, [
            nl.issue ? `${nl.issue} · ` : "",
            nl.status === "published" ? `Published ${nl.publishedAt ? formatDate(nl.publishedAt) : ""}` : "Draft",
          ]),
        ]),
      ]),
      el("div", { style: "display:flex; align-items:center; gap:6px;" }, [
        el("span", { class: `badge badge--${nl.status === "published" ? "success" : "muted"}` }, nl.status === "published" ? "Published" : "Draft"),
        el("button", { class: "btn btn--tonal btn--sm", onClick: () => openNewsletterViewer(panel, profile, nl) }, [icon("visibility"), "View"]),
        canManage
          ? el("button", { class: "btn btn--ghost btn--sm", title: "More actions", style: "padding:6px;", onClick: () => openNewsletterActionsMenu(profile, nl) }, [
              el("span", { class: "material-symbols-rounded", style: "font-size:18px;" }, "more_vert"),
            ])
          : "",
      ]),
    ]);
    panel.append(card);
  }
}

// Renders the full templated newsletter (banner header, hero photo,
// principal's message, content sections, footer) in place of the list,
// with Back / Print / Download PDF actions - the same pattern used for
// report cards and fee receipts elsewhere in the app.
function openNewsletterViewer(panel, profile, nl) {
  panel.innerHTML = "";

  const bar = el("div", { class: "no-print", style: "display:flex; justify-content:space-between; margin-bottom:16px;" }, [
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => renderPanel(panel, profile) }, [icon("arrow_back"), "Back to list"]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => window.print() }, [icon("print"), "Print"]),
      el("button", { class: "btn btn--primary btn--sm", onClick: (e) => handleDownload(e.currentTarget, nl) }, [icon("download"), "Download PDF"]),
    ]),
  ]);
  panel.append(bar);
  panel.append(buildNewsletterDoc(nl));
}

async function handleDownload(button, nl) {
  const doc_ = document.querySelector(".newsletter-doc");
  if (!doc_) return;
  const restore = busyButton(button, "Preparing…");
  try {
    await downloadElementAsPdf(doc_, `${(nl.title || "newsletter").replace(/\s+/g, "_")}.pdf`);
  } catch (err) {
    toast("Could not generate PDF - check your connection and try again.", "error");
  } finally {
    restore();
  }
}

// Builds the styled newsletter document itself, themed with the school's
// brand color. Falls back to rendering `body` as a single plain section for
// newsletters saved before the sections/hero-image layout existed.
function buildNewsletterDoc(nl) {
  // Use a fallback green if no theme color is set
  const primaryColor = settings?.themeColor || "#1b5e40"; 
  const secondaryColor = settings?.secondaryColor || "#2ea664";

  // The main wrapper needs an ID so the PDF generator grabs exactly this
  const doc_ = el("div", { 
    class: "newsletter-doc", 
    id: "newsletter-export-target",
    style: `--primary:${primaryColor}; --secondary:${secondaryColor};` 
  });

  // 1. HERO SECTION (Overlapping Title & Logo)
  const heroSection = el("div", { class: "nl-hero" });
  
  if (nl.heroImageUrl) {
    heroSection.append(el("img", { class: "nl-hero-img", src: nl.heroImageUrl, alt: "Hero" }));
  }

  // Top-left branding (Logo + School Name)
  heroSection.append(
    el("div", { class: "nl-brand-overlay" }, [
      settings?.logoUrl
        ? el("img", { class: "nl-logo", src: settings.logoUrl, alt: "Logo" })
        : el("span", { class: "material-symbols-rounded" }, "language"),
      el("div", { class: "nl-school-name" }, settings?.schoolName || "School Name"),
    ])
  );

  // Top-right overlapping title blocks (like the template)
  heroSection.append(
    el("div", { class: "nl-title-wrapper" }, [
      el("div", { class: "nl-issue-badge" }, nl.issue || "High School"),
      el("div", { class: "nl-title-badge" }, nl.title || "NEWSLETTER"),
    ])
  );
  
  doc_.append(heroSection);

  // 2. PRINCIPAL'S MESSAGE (Solid background)
  const message = nl.principalMessage || (!nl.sections?.length ? nl.body : "");
  if (message) {
    doc_.append(
      el("div", { class: "nl-message-block" }, [
        el("h2", { class: "nl-heading" }, "Principal's Message"),
        el("p", { class: "nl-text" }, message),
        el("div", { class: "nl-signoff" }, [
          "Warm regards,",
          el("br", {}),
          settings?.principalName || "[Principal's Name]"
        ])
      ])
    );
  }

  // 3. CONTENT SECTIONS (Split layout: Image Left, Text Right)
  const sections = nl.sections?.length ? nl.sections : [];
  if (sections.length) {
    const sectionsWrap = el("div", { class: "nl-sections" });
    for (const s of sections) {
      sectionsWrap.append(
        el("div", { class: `nl-section ${s.imageUrl ? "nl-section--split" : "nl-section--full"}` }, [
          s.imageUrl ? el("div", { class: "nl-section-img-wrap" }, [
              el("img", { class: "nl-section-img", src: s.imageUrl, alt: "" })
          ]) : "",
          el("div", { class: "nl-section-content" }, [
            el("h3", { class: "nl-heading-small" }, s.title || ""),
            el("p", { class: "nl-text" }, s.body || ""),
          ]),
        ])
      );
    }
    doc_.append(sectionsWrap);
  }

  // 4. FOOTER
  doc_.append(
    el("div", { class: "nl-footer" }, [
      [settings?.address, settings?.phone, settings?.email].filter(Boolean).join(" • ") || "",
    ])
  );

  return doc_;
}

function actionMenuItem({ icon: iconName, label, desc, danger = false, onClick }) {
  return el(
    "button",
    { class: `action-menu__item${danger ? " action-menu__item--danger" : ""}`, onClick },
    [
      el("span", { class: "material-symbols-rounded" }, iconName),
      el("div", { class: "action-menu__item-text" }, [
        el("div", { class: "action-menu__item-label" }, label),
        desc ? el("div", { class: "action-menu__item-desc" }, desc) : "",
      ]),
    ]
  );
}

function openNewsletterActionsMenu(profile, nl) {
  const menu = el("div", { class: "action-menu" }, [
    actionMenuItem({
      icon: "edit",
      label: "Edit",
      desc: "Change the title, issue or content.",
      onClick: () => {
        close();
        openNewsletterForm(profile, nl);
      },
    }),
    actionMenuItem({
      icon: nl.status === "published" ? "unpublish" : "publish",
      label: nl.status === "published" ? "Unpublish" : "Publish",
      desc: nl.status === "published" ? "Move back to draft." : "Make this visible as published.",
      onClick: async () => {
        close();
        try {
          await setNewsletterStatus(profile.uid, nl.id, nl.status === "published" ? "draft" : "published");
          toast(nl.status === "published" ? "Moved back to draft." : "Newsletter published.", "success");
          await refresh(profile);
        } catch (err) {
          toast(err.message || "Could not update newsletter.", "error");
        }
      },
    }),
    el("div", { class: "action-menu__divider" }),
    actionMenuItem({
      icon: "delete",
      label: "Delete newsletter",
      desc: "This can't be undone.",
      danger: true,
      onClick: () => {
        close();
        confirmDeleteNewsletter(profile, nl);
      },
    }),
  ]);
  const close = openModal(nl.title, menu);
}

function confirmDeleteNewsletter(profile, nl) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${nl.title}"? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el("button", {
        class: "btn btn--danger",
        onClick: async (ev) => {
          const restore = busyButton(ev.currentTarget, "Deleting…");
          try {
            await deleteNewsletter(profile.uid, nl.id);
            toast("Newsletter deleted.", "success");
            close();
            await refresh(profile);
          } catch (err) {
            toast(err.message || "Could not delete.", "error");
            restore();
          }
        },
      }, "Delete"),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Delete Newsletter", body);
}

// A section in the editor holds either an already-uploaded imageUrl (when
// editing) or a pending File to upload on submit - never both at once.
function openNewsletterForm(profile, existing = null) {
  const isEdit = !!existing;
  let heroFile = null;
  let heroUrl = existing?.heroImageUrl || "";
  const sections = existing?.sections?.length
    ? existing.sections.map((s) => ({ title: s.title || "", body: s.body || "", imageUrl: s.imageUrl || "", file: null }))
    : [];

  const body = el("form", {});
  body.append(
    el("div", { class: "field" }, [
      el("label", {}, "Title"),
      el("input", { id: "nl-title", value: existing?.title || "", placeholder: "e.g. Mid-Term Highlights" }),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "Issue / edition (optional)"),
      el("input", { id: "nl-issue", value: existing?.issue || "", placeholder: "e.g. Term 2 2026" }),
    ])
  );

  // --- Hero photo ---
  const heroField = el("div", { class: "field" }, [el("label", {}, "Hero photo (top banner image, optional)")]);
  const heroPreviewWrap = el("div", {});
  function renderHeroPreview() {
    heroPreviewWrap.innerHTML = "";
    if (heroUrl) heroPreviewWrap.append(el("img", { class: "newsletter-form__thumb", src: heroUrl, alt: "" }));
  }
  renderHeroPreview();
  const heroInput = el("input", { type: "file", accept: "image/*" });
  heroInput.addEventListener("change", () => {
    heroFile = heroInput.files[0] || null;
    if (heroFile) {
      heroUrl = URL.createObjectURL(heroFile);
      renderHeroPreview();
    }
  });
  heroField.append(heroPreviewWrap, heroInput);
  body.append(heroField);

  body.append(
    el("div", { class: "field" }, [
      el("label", {}, "Principal's message"),
      el("textarea", { id: "nl-message", rows: "6", placeholder: "Dear Families and Students, …" }, existing?.principalMessage || existing?.body || ""),
    ])
  );

  // --- Content sections ---
  body.append(el("label", {}, "Content sections"));
  const sectionsWrap = el("div", {});
  body.append(sectionsWrap);
  body.append(
    el("button", { type: "button", class: "btn btn--tonal btn--sm", style: "margin-bottom:16px;", onClick: () => { sections.push({ title: "", body: "", imageUrl: "", file: null }); renderSections(); } }, [icon("add"), "Add section"])
  );

  function renderSections() {
    sectionsWrap.innerHTML = "";
    sections.forEach((s, i) => {
      const box = el("div", { class: "newsletter-form__section" }, [
        el("button", { type: "button", class: "btn btn--ghost btn--sm newsletter-form__section-remove", title: "Remove section", onClick: () => { sections.splice(i, 1); renderSections(); } }, [icon("close")]),
        el("div", { class: "field" }, [el("label", {}, "Heading"), el("input", { value: s.title, placeholder: "e.g. Academics in Focus", onInput: (e) => (s.title = e.target.value) })]),
        el("div", { class: "field" }, [el("label", {}, "Text"), el("textarea", { rows: "4", onInput: (e) => (s.body = e.target.value) }, s.body)]),
      ]);
      const photoField = el("div", { class: "field" }, [el("label", {}, "Photo (optional)")]);
      const thumbWrap = el("div", {});
      if (s.imageUrl) thumbWrap.append(el("img", { class: "newsletter-form__thumb", src: s.imageUrl, alt: "" }));
      const fileInput = el("input", { type: "file", accept: "image/*" });
      fileInput.addEventListener("change", () => {
        s.file = fileInput.files[0] || null;
        if (s.file) {
          s.imageUrl = URL.createObjectURL(s.file);
          thumbWrap.innerHTML = "";
          thumbWrap.append(el("img", { class: "newsletter-form__thumb", src: s.imageUrl, alt: "" }));
        }
      });
      photoField.append(thumbWrap, fileInput);
      box.append(photoField);
      sectionsWrap.append(box);
    });
  }
  renderSections();

  body.append(el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save changes" : "Save as draft"]));

  const close = openModal(isEdit ? `Edit: ${existing.title}` : "New Newsletter", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const title = document.getElementById("nl-title").value.trim();
    const issue = document.getElementById("nl-issue").value.trim();
    const principalMessage = document.getElementById("nl-message").value.trim();
    if (!title || (!principalMessage && !sections.length)) {
      toast("Title and either a principal's message or at least one section are required.", "error");
      restore();
      return;
    }
    try {
      const finalHeroUrl = heroFile ? await uploadNewsletterImage(heroFile) : heroUrl;
      const finalSections = [];
      for (const s of sections) {
        if (!s.title.trim() && !s.body.trim() && !s.file && !s.imageUrl) continue;
        finalSections.push({
          title: s.title.trim(),
          body: s.body.trim(),
          imageUrl: s.file ? await uploadNewsletterImage(s.file) : s.imageUrl,
        });
      }

      const payload = { title, issue, body: principalMessage, principalMessage, heroImageUrl: finalHeroUrl, sections: finalSections };
      if (isEdit) {
        await updateNewsletter(profile.uid, existing.id, payload);
        toast("Newsletter updated.", "success");
      } else {
        await createNewsletter(profile.uid, payload);
        toast("Newsletter saved as draft.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save newsletter.", "error");
      restore();
    }
  });
}