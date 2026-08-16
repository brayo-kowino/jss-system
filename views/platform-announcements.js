// Platform-level status announcements - super_admin only.
// Compose a banner every signed-in staff member sees, at every school,
// regardless of subscription state - scheduled maintenance, a degraded
// SMS/email provider, a survey, anything the platform operator needs to
// say to everyone at once. Rendered by js/components/announcement-banner.js
// (mounted in shell.js above every page's content); this view is just the
// compose/manage side. See js/services/platform-announcement.service.js
// for the data model and firestore.rules for why this collection isn't
// scoped by schoolId like everything else in this app.
import {
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  setAnnouncementActive,
  deleteAnnouncement,
  severityMeta,
  isCurrentlyLive,
  SEVERITIES,
} from "../js/services/platform-announcement.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, formatDateTime, busyButton } from "../js/utils.js";

let announcements = [];

export async function render({ profile }) {
  announcements = await listAllAnnouncements();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", {}, "Broadcast a banner to every signed-in staff member across every school - maintenance windows, degraded-service notices, surveys, anything platform-wide. Not visible to parents; the public results portal doesn't show these."),
      ]),
      el("button", { class: "btn btn--primary", onClick: () => openComposeModal(profile) }, [
        icon("campaign"),
        " New Announcement",
      ]),
    ])
  );

  if (!announcements.length) {
    wrap.append(
      el("div", { class: "card empty-state" }, [
        icon("campaign", "empty-state__icon"),
        el("h3", {}, "No announcements yet"),
        el("p", {}, "Nothing has ever been broadcast to schools. Create one when you need to."),
      ])
    );
    return wrap;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive card" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Announcement"), el("th", {}, "Severity"), el("th", {}, "Status"), el("th", {}, "Posted"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody");
  for (const a of announcements) {
    const live = isCurrentlyLive(a);
    const meta = severityMeta(a.severity);
    tbody.append(
      el("tr", {}, [
        el("td", { "data-label": "Announcement" }, [
          el("strong", {}, a.title),
          el("div", { class: "text-sm text-muted" }, a.message),
        ]),
        el("td", { "data-label": "Severity" }, el("span", { class: `badge badge--${severityBadgeTone(a.severity)}` }, meta.label)),
        el("td", { "data-label": "Status" }, statusCell(a, live)),
        el("td", { "data-label": "Posted" }, a.createdAt ? formatDateTime(a.createdAt) : "N/A"),
        el("td", { class: "row-actions", "data-label": "Actions", style: "white-space:nowrap;" }, [
          el("button", { class: "btn btn--sm btn--ghost", onClick: () => openComposeModal(profile, a) }, [icon("edit"), "Edit"]),
          el("button", {
            class: "btn btn--sm btn--ghost",
            onClick: (e) => toggleActive(profile, a, e.currentTarget),
          }, [icon(a.active ? "pause_circle" : "play_circle"), a.active ? "End" : "Resume"]),
          el("button", {
            class: "btn btn--sm btn--danger",
            onClick: (e) => confirmDelete(profile, a, e.currentTarget),
          }, [icon("delete"), "Delete"]),
        ]),
      ])
    );
  }
  table.append(tbody);
  tableWrap.append(table);
  wrap.append(tableWrap);

  return wrap;
}

function severityBadgeTone(severity) {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "muted";
}

function statusCell(a, live) {
  if (live) {
    const expiry = a.expiresAt ? ` · expires ${formatDateTime(a.expiresAt)}` : "";
    return el("span", {}, [el("span", { class: "badge badge--success" }, "Live"), expiry]);
  }
  if (a.active && a.expiresAt) return el("span", { class: "badge badge--muted" }, "Expired");
  return el("span", { class: "badge badge--muted" }, "Ended");
}

async function toggleActive(profile, a, button) {
  const restore = busyButton(button, a.active ? "Ending…" : "Resuming…");
  try {
    await setAnnouncementActive(profile.uid, a.id, !a.active);
    toast(a.active ? "Announcement ended - it will no longer show for anyone." : "Announcement resumed.", "success");
    const { renderRoute } = await import("../js/router.js");
    renderRoute();
  } catch (err) {
    toast(err.message || "Couldn't update that announcement.", "error");
    restore();
  }
}

async function confirmDelete(profile, a, button) {
  if (!confirm(`Delete "${a.title}" permanently? This can't be undone - if you just want to stop showing it, use End instead.`)) return;
  const restore = busyButton(button, "Deleting…");
  try {
    await deleteAnnouncement(profile.uid, a.id);
    toast("Announcement deleted.", "success");
    const { renderRoute } = await import("../js/router.js");
    renderRoute();
  } catch (err) {
    toast(err.message || "Couldn't delete that announcement.", "error");
    restore();
  }
}

function openComposeModal(profile, existing = null) {
  const body = el("form", {});

  const severitySelect = el(
    "select",
    { id: "a-severity" },
    SEVERITIES.map((s) => el("option", { value: s.value, ...(existing?.severity === s.value ? { selected: "true" } : {}) }, s.label))
  );
  const severityHint = el("p", { class: "text-sm text-muted", style: "margin: 4px 0 0;" });
  function refreshHint() {
    severityHint.textContent = severityMeta(severitySelect.value).description;
  }
  severitySelect.addEventListener("change", refreshHint);

  const titleInput = el("input", { id: "a-title", value: existing?.title || "", placeholder: "e.g. Scheduled maintenance, Saturday 11pm-1am" });
  const messageTextarea = el("textarea", { id: "a-message", rows: "5", placeholder: "What's happening, and what should staff expect?" }, existing?.message || "");
  const expiresInput = el("input", {
    id: "a-expires",
    type: "datetime-local",
    value: existing?.expiresAt ? toDatetimeLocalValue(existing.expiresAt) : "",
  });

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Severity"), severitySelect, severityHint]),
    el("div", { class: "field" }, [el("label", {}, "Title"), titleInput]),
    el("div", { class: "field" }, [el("label", {}, "Message"), messageTextarea]),
    el("div", { class: "field" }, [
      el("label", {}, "Auto-hide at (optional)"),
      expiresInput,
      el("p", { class: "text-sm text-muted", style: "margin: 4px 0 0;" }, "Leave blank to keep it up until you End it yourself."),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [
      icon(existing ? "save" : "campaign"),
      existing ? "Save Changes" : "Post Announcement",
    ])
  );
  refreshHint();

  const close = openModal(existing ? "Edit Announcement" : "New Announcement", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    const payload = {
      title: titleInput.value,
      message: messageTextarea.value,
      severity: severitySelect.value,
      expiresAt: expiresInput.value || null,
    };
    try {
      if (existing) {
        await updateAnnouncement(profile.uid, existing.id, payload);
        toast("Announcement updated.", "success");
      } else {
        await createAnnouncement(profile.uid, payload);
        toast("Announcement posted - it'll show up for staff on their next page load.", "success");
      }
      close();
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't save that announcement.", "error");
      restore();
    }
  });
}

function toDatetimeLocalValue(timestamp) {
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
