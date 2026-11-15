import { el, icon, toast, skeleton, busyButton, escapeHtml } from "../js/utils.js";
import { DAYS, getSharedTimetable, downloadStandaloneTimetableHtml, isDoubleAllowed } from "../js/services/timetable.service.js";
import { downloadElementAsPdf, prewarmPdfLibs } from "../js/services/pdf.util.js";

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
  prewarmPdfLibs();
  const school = data.schoolInfo || {};
  const periods = data.periods || [];
  const slots = data.slots || [];
  const schoolName = school.name || "School Timetable";
  const motto = school.motto || "";
  const currentYear = school.academicYear || new Date().getFullYear();
  const currentTerm = school.term || "Term 1";

  // Header Card
  const header = el("div", {
    class: "card",
    style: "background:var(--color-primary-900, #0f2744); color:#ffffff; padding:20px 24px; margin-bottom:16px; border-radius:var(--radius-lg); box-shadow:0 2px 10px rgba(0,0,0,0.12);",
  }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;" }, [
      el("div", {}, [
        school.logoUrl ? el("img", {
          src: school.logoUrl,
          alt: "Logo",
          style: "max-height:48px; max-width:90px; object-fit:contain; margin-bottom:8px; background:#fff; border-radius:4px; padding:2px;",
        }) : null,
        el("h1", { style: "font-family:var(--font-heading); font-size:22px; font-weight:800; letter-spacing:0.03em; margin:0; text-transform:uppercase; color:#fff;" }, schoolName),
        motto ? el("div", { style: "font-size:12px; font-style:italic; opacity:0.85; margin-top:2px;" }, `"${motto}"`) : null,
        el("div", { style: "font-size:14px; font-weight:700; color:var(--color-gold, #f59e0b); margin-top:8px;" }, data.title),
        data.subTitle ? el("div", { style: "font-size:12px; opacity:0.9; margin-top:2px;" }, data.subTitle) : null,
      ].filter(Boolean)),
      el("div", {
        style: "background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.25); border-radius:var(--radius-md); padding:10px 16px; text-align:right;",
      }, [
        el("div", { style: "font-size:13px; font-weight:700;" }, currentTerm),
        el("div", { style: "font-size:11px; opacity:0.85;" }, `Academic Year ${currentYear}`),
        el("div", { style: "font-size:10px; opacity:0.75; margin-top:4px; text-transform:uppercase; letter-spacing:0.04em;" }, "Official Verified Schedule"),
      ]),
    ]),
  ]);

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
        title: "Download official A4 landscape PDF",
        onClick: async (e) => {
          const btn = e.currentTarget;
          const restore = busyButton(btn, "Preparing PDF…");
          try {
            const filename = `${(data.title || "Timetable").replace(/[^a-zA-Z0-9_\-]/g, "_")}_${data.schoolInfo?.academicYear || new Date().getFullYear()}.pdf`;
            await downloadElementAsPdf(container, filename, { orientation: "landscape" });
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

  // Timetable Grid
  const gridCard = el("div", { class: "card", style: "padding:0; overflow:hidden; border:1px solid var(--color-line); border-radius:var(--radius-lg); margin-bottom:20px;" });
  const scrollWrap = el("div", { class: "tt-scroll", style: "overflow-x:auto;" });

  const table = el("table", { class: "tt-wall-chart", style: "width:100%; border-collapse:collapse; min-width:840px;" });

  // Map slots
  const slotMap = new Map();
  for (const s of slots) {
    const key = `${s.grade || ""}_${s.stream || ""}_${s.day}_${s.periodId}`;
    slotMap.set(key, s);
  }

  const isMaster = data.type === "master";

  // Derive unique cohorts (only needed for institutional master timetable)
  const cohortKeys = new Set();
  const cohorts = [];
  if (isMaster) {
    for (const s of slots) {
      const key = `${s.grade || ""}|${s.stream || ""}`;
      if (!cohortKeys.has(key)) {
        cohortKeys.add(key);
        const label = `${s.grade || ""}${s.stream ? " " + s.stream : ""}`.trim() || "All Classes";
        cohorts.push({ grade: s.grade || "", stream: s.stream || "", label });
      }
    }
    if (!cohorts.length) {
      cohorts.push({ grade: "", stream: "", label: "All Classes" });
    }
  }

  // Table Thead
  const thead = el("thead", {});
  const headRow = el("tr", {});
  headRow.append(
    el("th", { class: "tt-wall-th-day", style: "width:60px;" }, "DAY")
  );
  if (isMaster && cohorts.length > 1) {
    headRow.append(el("th", { class: "tt-wall-th-class", style: "width:110px;" }, "CLASS"));
  }

  for (const p of periods) {
    if (p.isBreak) {
      headRow.append(
        el("th", { class: "tt-wall-th-break" }, [
          el("div", { class: "tt-wall-p-name" }, p.name),
          el("div", { class: "tt-wall-p-time" }, `${p.startTime}–${p.endTime}`),
        ])
      );
    } else {
      headRow.append(
        el("th", { class: "tt-wall-th-period" }, [
          el("div", { class: "tt-wall-p-name" }, p.name),
          el("div", { class: "tt-wall-p-time" }, `${p.startTime}–${p.endTime}`),
        ])
      );
    }
  }
  thead.append(headRow);
  table.append(thead);

  // Table Tbody
  const tbody = el("tbody", {});

  if (isMaster && cohorts.length > 1) {
    // Multi-cohort Master Matrix: Grouped by day with a row per class cohort
    for (const day of DAYS) {
      for (let cIdx = 0; cIdx < cohorts.length; cIdx++) {
        const cohort = cohorts[cIdx];
        const isFirst = cIdx === 0;
        const isLast = cIdx === cohorts.length - 1;

        const row = el("tr", { class: `tt-wall-row ${isLast ? "tt-wall-row--last-in-day" : ""}` });

        if (isFirst) {
          row.append(
            el("td", { rowspan: String(cohorts.length), class: "tt-wall-day-cell", style: "width:60px;" }, [
              el("div", { class: "tt-wall-day-label" }, [
                el("span", {}, day.substring(0, 4).toUpperCase()),
              ]),
            ])
          );
        }

        row.append(
          el("td", { class: "tt-wall-class-cell", style: "width:110px;" }, [
            el("span", { class: "tt-wall-class-name" }, cohort.label),
          ])
        );

        for (let pIdx = 0; pIdx < periods.length; pIdx++) {
          const p = periods[pIdx];

          if (p.isBreak) {
            if (isFirst) {
              row.append(
                el("td", { rowspan: String(cohorts.length), class: "tt-wall-break-cell" }, [
                  el("div", { class: "tt-wall-break-text" }, [
                    icon("coffee", "text-xs"),
                    `${p.name} (${p.startTime}–${p.endTime})`,
                  ]),
                ])
              );
            }
            continue;
          }

          const slot = slotMap.get(`${cohort.grade}_${cohort.stream}_${day}_${p.id}`) || null;

          // Double lesson check
          let isMerged = false;
          if (slot && isDoubleAllowed(slot) && pIdx + 1 < periods.length) {
            const nextP = periods[pIdx + 1];
            if (!nextP.isBreak) {
              const nextSlot = slotMap.get(`${cohort.grade}_${cohort.stream}_${day}_${nextP.id}`);
              if (nextSlot && nextSlot.subjectCode === slot.subjectCode && nextSlot.teacherId === slot.teacherId) {
                isMerged = true;
              }
            }
          }

          if (isMerged) {
            const td = el("td", { colspan: "2", class: "tt-wall-slot-cell tt-wall-slot-cell--merged" }, [
              el("div", { class: "tt-wall-subj-line" }, [
                el("span", { class: "tt-wall-subj" }, slot.subjectName || slot.subjectCode),
                el("span", { class: "tt-wall-tag-double" }, "Double"),
              ]),
              el("div", { class: "tt-wall-teacher" }, slot.teacherName || "—"),
              el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
            ]);
            row.append(td);
            pIdx++;
            continue;
          }

          if (slot) {
            const td = el("td", { class: "tt-wall-slot-cell" }, [
              el("div", { class: "tt-wall-subj-line" }, [
                el("span", { class: "tt-wall-subj" }, slot.subjectName || slot.subjectCode),
              ]),
              el("div", { class: "tt-wall-teacher" }, slot.teacherName || "—"),
              el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
            ]);
            row.append(td);
          } else {
            const td = el("td", { class: "tt-wall-slot-cell" }, [
              el("div", {
                style: "height:100%; min-height:48px; display:flex; align-items:center; justify-content:center; background:var(--color-cream-dim); border-radius:4px; border:1px solid var(--color-line); color:var(--color-ink-soft); font-size:10px; font-weight:600; font-style:italic;",
              }, "—"),
            ]);
            row.append(td);
          }
        }

        tbody.append(row);
      }
    }
  } else {
    // Individual Schedule (Teacher or Single Class): Exactly 1 clean row per Day!
    for (let dIdx = 0; dIdx < DAYS.length; dIdx++) {
      const day = DAYS[dIdx];
      const isFirst = dIdx === 0;
      const isLast = dIdx === DAYS.length - 1;

      const row = el("tr", { class: `tt-wall-row ${isLast ? "tt-wall-row--last-in-day" : ""}` });

      // Day column (1 row per day)
      row.append(
        el("td", { class: "tt-wall-day-cell", style: "width:60px;" }, [
          el("div", { class: "tt-wall-day-label" }, [
            el("span", {}, day.substring(0, 4).toUpperCase()),
          ]),
        ])
      );

      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        const p = periods[pIdx];

        if (p.isBreak) {
          if (isFirst) {
            row.append(
              el("td", { rowspan: String(DAYS.length), class: "tt-wall-break-cell" }, [
                el("div", { class: "tt-wall-break-text" }, [
                  icon("coffee", "text-xs"),
                  `${p.name} (${p.startTime}–${p.endTime})`,
                ]),
              ])
            );
          }
          continue;
        }

        // Find the slot for this teacher/class on this day and period
        const slot = slots.find((s) => s.day === day && s.periodId === p.id) || null;

        // Check for double lesson
        let isMerged = false;
        if (slot && isDoubleAllowed(slot) && pIdx + 1 < periods.length) {
          const nextP = periods[pIdx + 1];
          if (!nextP.isBreak) {
            const nextSlot = slots.find((s) => s.day === day && s.periodId === nextP.id) || null;
            if (nextSlot && nextSlot.subjectCode === slot.subjectCode) {
              if (data.type === "teacher") {
                if (nextSlot.grade === slot.grade && (nextSlot.stream || "") === (slot.stream || "")) {
                  isMerged = true;
                }
              } else {
                if (nextSlot.teacherId === slot.teacherId) {
                  isMerged = true;
                }
              }
            }
          }
        }

        if (isMerged) {
          const topLabel = data.type === "teacher"
            ? `${slot.grade} ${slot.stream || ""}`.trim()
            : (slot.subjectName || slot.subjectCode);
          const subLabel = data.type === "teacher"
            ? (slot.subjectName || slot.subjectCode)
            : (slot.teacherName || "—");

          const td = el("td", { colspan: "2", class: "tt-wall-slot-cell tt-wall-slot-cell--merged" }, [
            el("div", { class: "tt-wall-subj-line" }, [
              el("span", { class: "tt-wall-subj", style: data.type === "teacher" ? "font-weight:800; color:var(--color-primary-900);" : "" }, topLabel),
              el("span", { class: "tt-wall-tag-double" }, "Double"),
            ]),
            el("div", { class: "tt-wall-teacher", style: data.type === "teacher" ? "font-weight:600; color:var(--color-ink);" : "" }, subLabel),
            el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
          ]);
          row.append(td);
          pIdx++;
          continue;
        }

        if (slot) {
          const topLabel = data.type === "teacher"
            ? `${slot.grade} ${slot.stream || ""}`.trim()
            : (slot.subjectName || slot.subjectCode);
          const subLabel = data.type === "teacher"
            ? (slot.subjectName || slot.subjectCode)
            : (slot.teacherName || "—");

          const td = el("td", { class: "tt-wall-slot-cell" }, [
            el("div", { class: "tt-wall-subj-line" }, [
              el("span", { class: "tt-wall-subj", style: data.type === "teacher" ? "font-weight:800; color:var(--color-primary-900);" : "" }, topLabel),
            ]),
            el("div", { class: "tt-wall-teacher", style: data.type === "teacher" ? "font-weight:600; color:var(--color-ink);" : "" }, subLabel),
            el("div", { class: "tt-wall-room" }, slot.room || "Classroom"),
          ]);
          row.append(td);
        } else {
          const td = el("td", { class: "tt-wall-slot-cell" }, [
            el("div", {
              style: "height:100%; min-height:48px; display:flex; align-items:center; justify-content:center; background:var(--color-cream-dim); border-radius:4px; border:1px solid var(--color-line); color:var(--color-ink-soft); font-size:10px; font-weight:600; font-style:italic;",
            }, data.type === "teacher" ? "FREE / PREP" : "—"),
          ]);
          row.append(td);
        }
      }

      tbody.append(row);
    }
  }

  table.append(tbody);
  scrollWrap.append(table);
  gridCard.append(scrollWrap);

  // Footer & Institutional Verification
  const footerCard = el("div", {
    class: "card",
    style: "padding:16px 22px; font-size:12px; color:var(--color-ink-soft); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;",
  }, [
    el("div", {}, [
      el("strong", { style: "color:var(--color-primary-900);" }, `${schoolName} · ${currentTerm} Academic Year ${currentYear}`),
      el("div", { style: "font-size:11px; margin-top:2px;" }, "Compiled & certified in accordance with Kenya MOE guidelines and TSC workload standards."),
    ]),
    el("div", { style: "font-size:11px; text-align:right;" }, [
      el("span", { class: "badge badge--outline", style: "font-size:10.5px;" }, "Official CBC Timetable"),
    ]),
  ]);

  container.append(header, actionsBar, gridCard, footerCard);
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

export function init() {
  prewarmPdfLibs();
}
