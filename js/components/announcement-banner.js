// ==========================================================================
// Platform announcement banner - mounted once by renderShell() (see
// shell.js), between the topbar and <main>, so it's visible on every page
// for every signed-in staff member regardless of which school they belong
// to. Backed by js/services/platform-announcement.service.js; authored
// from views/platform-announcements.js (super_admin only).
//
// Fetches in the background and stays empty (no layout shift, no
// placeholder) until/unless there's something live to show.
// Renders as a sleek 1-line top banner with an icon, title, snippet,
// and a "Read More" button that opens the full formatted letter in an
// elegant reading modal (using Lora editorial typography and narrow measure).
// Dismissing one is per-browser (localStorage) and per-version.
// ==========================================================================
import { el, icon } from "../utils.js";
import { openModal } from "./modal.js";
import { listActiveAnnouncements, severityMeta, dismissKey } from "../services/platform-announcement.service.js";

const DISMISSED_KEY = "jss_dismissed_announcements";

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistDismissed(set) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-100)));
  } catch {
    // best-effort only
  }
}

function bannerRow(announcement, onDismiss) {
  const meta = severityMeta(announcement.severity);
  const isCritical = announcement.severity === "critical";
  const isWarning = announcement.severity === "warning";
  const variantClass = isCritical
    ? " announcement-banner--critical"
    : isWarning
    ? " announcement-banner--warning"
    : " announcement-banner--info";

  // Clean single-line snippet
  const cleanSnippet = (announcement.message || "")
    .replace(/\r?\n+/g, " ")
    .trim();

  const titleEl = el("strong", { class: "announcement-banner__headline" }, announcement.title);
  const snippetEl = el("span", { class: "announcement-banner__snippet" }, cleanSnippet);

  const textWrap = el("div", {
    class: "announcement-banner__content",
    title: "Click to read full announcement",
    onClick: () => openAnnouncementModal(announcement, onDismiss),
  }, [
    titleEl,
    cleanSnippet ? el("span", { class: "announcement-banner__separator" }, "—") : "",
    cleanSnippet ? snippetEl : "",
  ]);

  const readMoreBtn = el("button", {
    type: "button",
    class: "announcement-banner__read-more",
    title: "Read full announcement",
    onClick: (e) => {
      e.stopPropagation();
      openAnnouncementModal(announcement, onDismiss);
    },
  }, [
    "Read More",
    el("span", { class: "material-symbols-rounded", style: "font-size: 14px; margin-left: 2px;" }, "arrow_forward"),
  ]);

  const dismissBtn = el("button", {
    type: "button",
    class: "announcement-banner__dismiss",
    "aria-label": "Dismiss",
    title: "Dismiss announcement",
    onClick: onDismiss,
  }, [el("span", { class: "material-symbols-rounded" }, "close")]);

  const iconEl = el("div", { class: "announcement-banner__icon-wrap" }, [
    el("span", { class: "material-symbols-rounded" }, meta.icon || "campaign"),
  ]);

  return el("div", { class: `announcement-banner${variantClass}` }, [
    iconEl,
    textWrap,
    readMoreBtn,
    dismissBtn,
  ]);
}

function openAnnouncementModal(announcement, onDismiss) {
  const isCritical = announcement.severity === "critical";
  const isWarning = announcement.severity === "warning";
  const badgeTone = isCritical ? "danger" : isWarning ? "warning" : "primary";
  const badgeLabel = isCritical ? "Critical Notice" : isWarning ? "Important Update" : "Platform Announcement";

  // Split message into natural paragraphs
  const paragraphs = (announcement.message || "")
    .split(/\r?\n\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  let closeFn = null;

  const body = el("div", { style: "display: flex; flex-direction: column; gap: 14px; padding: 2px 0 0;" }, [
    // Top meta bar with Eeskia identity
    el("div", { style: "display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-line); padding-bottom: 12px;" }, [
      el("div", { style: "display: flex; align-items: center; gap: 8px;" }, [
        el("img", {
          src: "https://eeskia.iskify360.tech/assets/logo.png",
          alt: "Eeskia",
          style: "width: 24px; height: 24px; border-radius: 6px; display: block;",
        }),
        el("span", { style: "font-weight: 700; font-size: 13px; color: var(--color-primary-900);" }, "Eeskia Platform Operations"),
      ]),
      el("span", { class: `badge badge--${badgeTone}`, style: "font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;" }, badgeLabel),
    ]),

    // Formatted reading body using Lora font with comfortable line-height
    el("div", {
      class: "announcement-reading-content",
      style: "max-height: 58vh; overflow-y: auto; padding-right: 6px;",
    }, paragraphs.length > 0 ? paragraphs.map((p) => el("p", {}, p)) : [el("p", {}, announcement.message)]),

    // Action buttons footer
    el("div", { style: "display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-line); padding-top: 14px; margin-top: 6px;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => {
          if (onDismiss) onDismiss();
          if (closeFn) closeFn();
        },
      }, [
        el("span", { class: "material-symbols-rounded text-xs" }, "visibility_off"),
        " Dismiss from Dashboard",
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => {
          if (closeFn) closeFn();
        },
      }, "Close"),
    ]),
  ]);

  // Open with narrow reading width (580px max) and Lora typography
  closeFn = openModal("Platform Announcement", body, "modal--reading");
}

// Returns an (initially empty) container. Populates itself asynchronously
// once the fetch resolves - callers just need to mount the returned node
// wherever the banner should appear and can otherwise ignore this.
export function mountAnnouncementBanner() {
  const stack = el("div", { class: "announcement-banner-stack" });

  listActiveAnnouncements()
    .then((announcements) => {
      const dismissed = readDismissed();
      const toShow = announcements.filter((a) => !dismissed.has(dismissKey(a)));
      for (const a of toShow) {
        const row = bannerRow(a, () => {
          const set = readDismissed();
          set.add(dismissKey(a));
          persistDismissed(set);
          row.remove();
        });
        stack.append(row);
      }
    })
    .catch((err) => {
      console.error("announcement-banner: failed to load", err);
    });

  return stack;
}
