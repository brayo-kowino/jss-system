// ==========================================================================
// Platform announcement banner - mounted once by renderShell() (see
// shell.js), between the topbar and <main>, so it's visible on every page
// for every signed-in staff member regardless of which school they belong
// to. Backed by js/services/platform-announcement.service.js; authored
// from views/platform-announcements.js (super_admin only).
//
// Fetches in the background and stays empty (no layout shift, no
// placeholder) until/unless there's something live to show - most schools,
// most of the time, will have zero active announcements. Dismissing one is
// per-browser (localStorage) and per-version (see dismissKey()'s own
// comment) - it comes back if the super_admin edits or re-activates it,
// but not on every reload of an unchanged one.
// ==========================================================================
import { el } from "../utils.js";
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
    // Cap what we keep so this can't grow unbounded across months of
    // announcements - the banner only ever cares whether *today's* live
    // ones are in here, so trimming old entries is harmless.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-100)));
  } catch {
    // best-effort only, same as shell.js's tour-seen flag
  }
}

function bannerRow(announcement, onDismiss) {
  const meta = severityMeta(announcement.severity);
  const variantClass = announcement.severity === "critical" ? " notice-banner--warning" : announcement.severity === "warning" ? " notice-banner--caution" : "";
  return el("div", { class: `notice-banner${variantClass}` }, [
    el("span", { class: "material-symbols-rounded" }, meta.icon),
    el("div", {}, [
      el("span", { class: "announcement-banner__title" }, announcement.title),
      announcement.message,
    ]),
    el("button", {
      class: "announcement-banner__dismiss",
      "aria-label": "Dismiss",
      title: "Dismiss",
      onClick: onDismiss,
    }, [el("span", { class: "material-symbols-rounded" }, "close")]),
  ]);
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
      // A failed fetch here should never block the app shell from
      // rendering - same fail-quiet reasoning as the tour/install-prompt
      // helpers this sits next to in shell.js. Worst case: no banner
      // shows this load, same as before this feature existed.
      console.error("announcement-banner: failed to load", err);
    });

  return stack;
}
