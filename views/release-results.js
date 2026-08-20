import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listSavedModesForPeriod, reportModeLabel } from "../js/services/grading.service.js";
import { getRelease, setRelease, isExpired, releaseStatusLabel } from "../js/services/release.service.js";
import { el, icon, toast, formatDateTime, busyButton, toDate } from "../js/utils.js";

let classes = [];
let settings = null;
let selection = { grade: "", academicYear: "", term: "" };

export async function render({ profile }) {
  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", { class: "text-muted" }, "Control when saved results become visible on the public results portal, and set an expiry after which parents are told to contact the school."),
      ]),
    ])
  );

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const bodyMount = el("div", { style: "margin-top:16px;" });
  wrap.append(bodyMount);

  renderPicker(pickerCard, bodyMount, profile);
  return wrap;
}

function gradeOptions() {
  return classes.map((c) => c.grade);
}

function renderPicker(container, bodyMount, profile) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const gradeSelect = el("select", {}, [
    el("option", { value: "" }, "Select grade"),
    ...gradeOptions().map((g) => el("option", { value: g, ...(g === selection.grade ? { selected: "true" } : {}) }, g)),
  ]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, (settings.terms || []).map((t) =>
    el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)
  ));

  gradeSelect.addEventListener("change", () => { selection.grade = gradeSelect.value; });
  yearInput.addEventListener("change", () => { selection.academicYear = yearInput.value.trim(); });
  termSelect.addEventListener("change", () => { selection.term = termSelect.value; });

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect])
  );
  container.append(row);
  container.append(
    el("div", { class: "filter-actions" }, [
      el("button", { class: "btn btn--primary", onClick: () => loadModes(bodyMount, profile) }, [icon("visibility"), "Load saved results"]),
    ])
  );
}

async function loadModes(bodyMount, profile) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [el("div", { class: "skeleton", style: "height:80px;" })]));

  const savedModes = await listSavedModesForPeriod(selection);
  if (!savedModes.length) {
    bodyMount.innerHTML = "";
    bodyMount.append(el("div", { class: "empty-state" }, [
      icon("visibility_off", "empty-state__icon"),
      el("h3", {}, "No saved results for this period"),
      el("p", {}, "Compute and save results for this class under Grading & Positions first, then come back here to release them."),
    ]));
    return;
  }

  bodyMount.innerHTML = "";
  for (const mode of savedModes) {
    const key = { grade: selection.grade, academicYear: selection.academicYear, term: selection.term, reportMode: mode.reportMode };
    const release = await getRelease(key);
    bodyMount.append(renderModeCard(profile, key, mode, release));
  }
}

function renderModeCard(profile, key, mode, release) {
  const published = !!release?.published;
  const expired = isExpired(release);
  const statusLabel = releaseStatusLabel(release);
  const statusColor = !published ? "muted" : expired ? "danger" : "success";

  const card = el("div", { class: "card", style: "margin-bottom:12px;" });

  const header = el("div", { style: "display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;" }, [
    el("div", {}, [
      el("div", { style: "font-weight:600;" }, `${reportModeLabel(mode.reportMode)} - ${mode.count} students`),
      el("div", { class: "text-muted", style: "font-size:13px;" }, mode.latestComputedAt ? `Computed ${formatDateTime(mode.latestComputedAt)} by ${mode.computedBy || "unknown"}` : ""),
    ]),
    el("span", { class: `badge badge--${statusColor}` }, statusLabel),
  ]);
  card.append(header);

  const controls = el("div", { style: "display:flex; align-items:end; gap:16px; margin-top:14px; flex-wrap:wrap;" });

  const expiryInput = el("input", {
    type: "datetime-local",
    value: release?.expiresAt ? toLocalInputValue(release.expiresAt) : "",
  });

  const toggleBtn = el("button", {
    class: `btn ${published ? "btn--danger" : "btn--primary"}`,
    onClick: async (ev) => {
      const restore = busyButton(ev.currentTarget, published ? "Unpublishing..." : "Releasing...");
      try {
        await setRelease(profile.uid, key, {
          published: !published,
          expiresAtLocal: expiryInput.value || (release?.expiresAt ? toLocalInputValue(release.expiresAt) : ""),
        });
        toast(published ? "Results unpublished." : "Results released.", "success");
        card.replaceWith(renderModeCard(profile, key, mode, await getRelease(key)));
      } catch (err) {
        toast(err.message || "Couldn't update release status.", "error");
      } finally {
        restore();
      }
    },
  }, [icon(published ? "visibility_off" : "visibility"), published ? "Unpublish" : "Release now"]);

  const saveExpiryBtn = el("button", {
    class: "btn btn--ghost",
    onClick: async (ev) => {
      const restore = busyButton(ev.currentTarget, "Saving...");
      try {
        await setRelease(profile.uid, key, { published, expiresAtLocal: expiryInput.value });
        toast(expiryInput.value ? "Expiry saved." : "Expiry cleared - results won't expire.", "success");
        card.replaceWith(renderModeCard(profile, key, mode, await getRelease(key)));
      } catch (err) {
        toast(err.message || "Couldn't save expiry.", "error");
      } finally {
        restore();
      }
    },
  }, [icon("schedule"), "Save expiry"]);

  controls.append(
    el("div", { class: "field" }, [el("label", {}, "Expires (leave blank for never)"), expiryInput]),
    saveExpiryBtn,
    toggleBtn
  );
  card.append(controls);

  if (published && !expired) {
    card.append(el("p", { class: "text-muted", style: "font-size:12px; margin-top:10px;" },
      "Parents can look up this student's results now on the public results page."));
  } else if (expired) {
    card.append(el("p", { class: "text-muted", style: "font-size:12px; margin-top:10px;" },
      "The expiry date has passed - the portal now tells parents to contact the school. Release again or push the expiry back to restore access."));
  }

  return card;
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local
// time - Firestore Timestamps come back as UTC instants, so this converts
// for display only; setRelease() re-interprets whatever the input holds as
// local time on save via `new Date(expiresAtLocal)`.
function toLocalInputValue(timestamp) {
  const d = toDate(timestamp);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
