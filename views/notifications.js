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
import { downloadElementAsPdf } from "../js/services/pdf.util.js";
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

export async function render({ profile }) {
  [notifications, newsletters, settings, classes, students, parents] = await Promise.all([
    listNotifications(),
    listNewsletters(),
    getSchoolSettings(),
    listClasses(),
    listStudents(),
    listParents(),
  ]);

  const wrap = el("div", {});
  wrap.append(el("div", { class: "page-header" }, [el("div", {}, [el("h1", {}, "")])]));

  const tabs = el("div", { class: "page-tabs" }, [
    tabButton("notifications", "notifications", "Notifications", profile),
    tabButton("newsletters", "newspaper", "Newsletters", profile),
  ]);
  wrap.append(tabs);

  const panel = el("div", {});
  wrap.append(panel);
  renderPanel(panel, profile);

  return wrap;
}

export function init() {}

function tabButton(id, iconName, label, profile) {
  const btn = el(
    "button",
    { class: `profile-tab${activeTab === id ? " profile-tab--active" : ""}` },
    [el("span", { class: "material-symbols-rounded" }, iconName), label]
  );
  btn.addEventListener("click", () => {
    if (activeTab === id) return;
    activeTab = id;
    rerenderShell(profile);
  });
  return btn;
}

function rerenderShell(profile) {
  const main = document.querySelector(".page-tabs")?.parentElement;
  if (!main) return;
  main.innerHTML = "";
  main.append(el("div", { class: "page-header" }, [el("div", {}, [el("h1", {}, "")])]));
  const tabs = el("div", { class: "page-tabs" }, [
    tabButton("notifications", "notifications", "Notifications", profile),
    tabButton("newsletters", "newspaper", "Newsletters", profile),
  ]);
  main.append(tabs);
  const panel = el("div", {});
  main.append(panel);
  renderPanel(panel, profile);
}

function renderPanel(panel, profile) {
  panel.innerHTML = "";
  if (activeTab === "notifications") renderNotificationsTab(panel, profile);
  else renderNewslettersTab(panel, profile);
}

async function refresh(profile) {
  [notifications, newsletters] = await Promise.all([listNotifications(), listNewsletters()]);
  const panel = document.querySelector(".page-tabs")?.nextElementSibling;
  if (panel) renderPanel(panel, profile);
}

// =========================================================================
// Notifications tab
// =========================================================================

function renderNotificationsTab(panel, profile) {
  const canManage = CAN_MANAGE.includes(profile.role);

  panel.append(
    el("div", { class: "notice-banner" }, [
      el("span", { class: "material-symbols-rounded" }, "info"),
      el(
        "span",
        {},
        "No SMS/email/WhatsApp provider is connected yet, so sending here records the message and its audience for tracking. It'll dispatch automatically as soon as a delivery provider is chosen - mark items delivered in the meantime if you send them another way."
      ),
    ])
  );

  if (canManage) {
    const templateGrid = el("div", { class: "template-grid" });
    const templates = [
      { category: "fees", label: "Fee Balance Reminder", icon: "payments" },
      { category: "results", label: "Results Published", icon: "grading" },
      { category: "term_closing", label: "Term Closing", icon: "event_busy" },
      { category: "term_opening", label: "Term Opening", icon: "event_available" },
      { category: "general", label: "Custom Announcement", icon: "campaign" },
    ];
    for (const t of templates) {
      const chip = el("button", { type: "button", class: "template-chip" }, [
        el("span", { class: "material-symbols-rounded" }, t.icon),
        t.label,
      ]);
      chip.addEventListener("click", () => openComposeModal(profile, { category: t.category }));
      templateGrid.append(chip);
    }
    panel.append(templateGrid);
  }

  panel.append(renderNotificationKpis());

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  panel.append(tableWrap);
  renderNotificationsTable(tableWrap, profile, canManage);
}

function renderNotificationKpis() {
  const total = notifications.length;
  const delivered = notifications.filter((n) => n.status === "delivered").length;
  const queued = notifications.filter((n) => n.status === "queued").length;
  const contactable = parents.filter((p) => p.phone || p.email).length;

  const kpis = [
    { label: "Sent This History", value: total, icon: "notifications", color: "blue" },
    { label: "Delivered", value: delivered, icon: "mark_email_read", color: "green" },
    { label: "Queued", value: queued, icon: "hourglass_top", color: "gold" },
    { label: "Parents Reachable", value: `${contactable}/${parents.length}`, icon: "contact_phone", color: "gold" },
  ];

  return el(
    "div",
    { class: "md3-kpi-grid", style: "margin-bottom:16px;" },
    kpis.map((k) =>
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, k.icon)]),
        el("div", {}, [
          el("div", { class: "md3-kpi-chip__label" }, k.label),
          el("div", { class: "md3-kpi-chip__value" }, String(k.value)),
        ]),
      ])
    )
  );
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
        el("h3", {}, "Nothing sent yet"),
        el("p", {}, canManage ? "Use a quick template above, or send a custom announcement." : "Nothing has been sent to parents yet."),
      ])
    );
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Title"),
      el("th", {}, "Category"),
      el("th", {}, "Audience"),
      el("th", {}, "Recipients"),
      el("th", {}, "Channel"),
      el("th", {}, "Sent"),
      el("th", {}, "Status"),
      canManage ? el("th", {}, "Actions") : "",
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
      el("td", { "data-label": "Channel" }, (CHANNELS.find((c) => c.value === n.channel)?.label) || n.channel || "N/A"),
      el("td", { "data-label": "Sent" }, n.createdAt ? formatDate(n.createdAt) : "N/A"),
      el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${n.status === "delivered" ? "success" : "gold"}` }, n.status === "delivered" ? "Delivered" : "Queued")),
    ];

    if (canManage) {
      const actionsCell = el("td", { class: "row-actions", "data-label": "Actions" });
      actionsCell.append(
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
        )
      );
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
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("send"), "Record & Queue"])
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

  const header = el("div", { class: "page-header", style: "padding:0 0 16px;" }, [
    el("div", {}, [el("p", {}, `${newsletters.length} newsletter(s)`)]),
  ]);
  if (canManage) {
    header.append(
      el("button", { class: "btn btn--primary", onClick: () => openNewsletterForm(profile) }, [icon("add"), "New Newsletter"])
    );
  }
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