import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";
import { getSharedTimetable, downloadStandaloneTimetableHtml } from "../js/services/timetable.service.js";
import { triggerBlobDownload } from "../js/services/pdf.util.js";
import { sharedTimetableDisplay } from "../js/services/timetable-layout.js";
import { renderTimetableChart } from "../js/components/timetable-grid.js";
import { renderTimetablePdf } from "../js/services/timetable-pdf.js";

/**
 * Public standalone shared timetable view.
 * Accessible with zero login via secure unguessable link: #/shared-timetable?id=sec_...
 * Automatically caches locally so teachers and staff can access it offline.
 */
export async function render({ params = {} }) {
  const container = el("div", { class: "shared-timetable-view", style: "max-width:1240px; margin:0 auto; padding:16px 20px 48px;" });

  const shareId = params.id || params.token || "";

  if (!shareId) {
    container.append(
      el("div", { class: "card", style: "max-width:480px; margin:60px auto; text-align:center; padding:32px 24px;" }, [
        icon("link_off", "text-lg", "style: font-size:48px; color:var(--color-ink-soft); margin-bottom:12px;"),
        el("h2", { style: "font-family:var(--font-heading); margin-bottom:8px; color:var(--color-primary-900);" }, "No Timetable Link Provided"),
        el("p", { class: "text-muted text-sm", style: "line-height:1.5; margin-bottom:20px;" }, "This link appears incomplete or missing its secure access key. Please ask your school administrator or timetable coordinator for the full link."),
        el("a", { href: "#/login", class: "btn btn--primary" }, [icon("login", "text-xs"), "Go to School Login"]),
      ])
    );
    return container;
  }

  // Loading skeleton
  const loadingWrap = el("div", { class: "card", style: "padding:24px; margin-top:20px;" }, [
    skeleton("skeleton--title", "40%"),
    el("div", { style: "height:14px;" }),
    skeleton("", "90%"),
    skeleton("", "85%"),
    skeleton("", "75%"),
    el("div", { style: "height:20px;" }),
    skeleton("", "100%"),
    skeleton("", "100%"),
    skeleton("", "100%"),
  ]);
  container.append(loadingWrap);

  let data = null;
  try {
    data = await getSharedTimetable(shareId);
  } catch (err) {
    loadingWrap.innerHTML = "";
    loadingWrap.append(
      el("div", { style: "text-align:center; padding:32px 16px;" }, [
        icon("error", "text-lg", "style: font-size:44px; color:var(--color-red); margin-bottom:12px;"),
        el("h3", { style: "margin:0 0 8px; color:var(--color-primary-900);" }, "Timetable Link Unavailable"),
        el("p", { class: "text-muted text-sm", style: "max-width:420px; margin:0 auto 20px; line-height:1.5;" },
          err.message || "This timetable link is invalid, expired, or has been revoked by the school."
        ),
        el("a", { href: "#/login", class: "btn btn--ghost" }, [icon("arrow_back", "text-xs"), "Return to Portal"]),
      ])
    );
    return container;
  }

  loadingWrap.remove();

  // If a PIN is required to unlock this timetable
  if (data.pin) {
    const pinCard = el("div", { class: "card", style: "max-width:420px; margin:60px auto; padding:28px 24px; text-align:center;" }, [
      icon("lock", "text-lg", "style: font-size:40px; color:var(--color-primary-700); margin-bottom:10px;"),
      el("h3", { style: "margin:0 0 6px; color:var(--color-primary-900);" }, "Protected School Timetable"),
      el("p", { class: "text-muted text-xs", style: "margin-bottom:18px; line-height:1.5;" },
        `Enter the 4-digit PIN provided by ${data.schoolInfo?.name || "your school"} to view this schedule.`
      ),
    ]);

    const pinForm = el("form", { style: "display:flex; flex-direction:column; gap:12px;" });
    const pinInput = el("input", {
      type: "password",
      inputmode: "numeric",
      maxlength: "8",
      placeholder: "Enter PIN code",
      style: "text-align:center; font-size:20px; font-weight:700; letter-spacing:0.2em; padding:10px;",
      required: "true",
      autofocus: "true",
    });
    const pinBtn = el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("key", "text-xs"), "Unlock Timetable"]);

    pinForm.append(pinInput, pinBtn);
    pinCard.append(pinForm);

    pinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (pinInput.value.trim() !== String(data.pin).trim()) {
        toast("Incorrect PIN. Please check and try again.", "error");
        pinInput.value = "";
        pinInput.focus();
        return;
      }
      pinCard.remove();
      renderTimetableContent(container, data);
    });

    container.append(pinCard);
    return container;
  }

  renderTimetableContent(container, data);
  return container;
}

function renderTimetableContent(container, data) {
  const { grid, letterhead } = sharedTimetableDisplay(data);
  const format = grid.kind === "master" ? "a3" : "a4";

  // Actions & Offline Status Bar
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  const offlinePill = el("div", {
    class: "badge",
    style: "display:inline-flex; align-items:center; gap:6px; font-size:11.5px; padding:4px 10px; background:#dcfce7; color:#166534; border:1px solid #bbf7d0; font-weight:600;",
  }, [
    icon("offline_pin", "text-xs"),
    "Saved on this device · Available Offline",
  ]);

  const liveOfflineWatcher = el("span", {}, [
    isOffline ? el("span", { class: "badge badge--warning", style: "margin-left:6px;" }, "Offline Mode") : null,
  ]);

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      liveOfflineWatcher.innerHTML = "";
      toast("Back online.", "success");
    });
    window.addEventListener("offline", () => {
      liveOfflineWatcher.innerHTML = `<span class="badge badge--warning" style="margin-left:6px;">Offline Mode</span>`;
      toast("You are currently offline. Viewing locally cached timetable.", "info");
    });
  }

  const actionsBar = el("div", {
    class: "card no-print",
    style: "padding:12px 18px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px; flex-wrap:wrap;" }, [
      offlinePill,
      liveOfflineWatcher,
    ]),
    el("div", { style: "display:flex; gap:8px; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        title: "Download landscape timetable PDF",
        onClick: async (e) => {
          const btn = e.currentTarget;
          const restore = busyButton(btn, "Preparing PDF…");
          try {
            const filename = `${(data.title || "Timetable").replace(/[^a-zA-Z0-9_\-]/g, "_")}_${data.schoolInfo?.academicYear || new Date().getFullYear()}.pdf`;
            triggerBlobDownload(await renderTimetablePdf(grid, letterhead, { format }), filename);
            toast("Timetable PDF downloaded.", "success");
          } catch (err) {
            console.error("Shared timetable PDF error:", err);
            toast("Could not generate PDF.", "error");
          } finally {
            restore();
          }
        },
      }, [icon("download", "text-xs"), "Download PDF"]),

      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        title: "Download a self-contained single-file HTML timetable that opens anywhere offline forever",
        onClick: () => {
          downloadStandaloneTimetableHtml(data);
          toast("Standalone offline timetable file downloaded!", "success");
        },
      }, [icon("download", "text-xs"), "Download Offline HTML"]),

      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        title: "Instructions to install as 1-tap app icon on phone",
        onClick: () => showAddToHomeScreenDialog(),
      }, [icon("smartphone", "text-xs"), "Add to Phone"]),
    ]),
  ]);

  container.append(actionsBar, renderTimetableChart(grid, letterhead));
}

function showAddToHomeScreenDialog() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const isAndroid = /android/i.test(navigator.userAgent || "");

  const msg = isIos
    ? "On your iPhone/iPad: Tap the Share button (square with arrow pointing up) at the bottom of Safari, then tap 'Add to Home Screen'."
    : isAndroid
    ? "On Android: Tap the 3 dots menu in Chrome (top right), then tap 'Add to Home screen' or 'Install App'."
    : "You can bookmark this page (Ctrl+D or Cmd+D) or save it to your desktop for quick 1-tap offline access.";

  alert(`Save to Your Phone Screen:\n\n${msg}\n\nThe timetable will open instantly without needing a login!`);
}

export function init() {}
