import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listSavedModesForPeriod, reportModeLabel } from "../js/services/grading.service.js";
import { getRelease, setRelease, isExpired, releaseStatusLabel } from "../js/services/release.service.js";
import { el, icon, toast, formatDateTime, busyButton, toDate } from "../js/utils.js";
import { getCurrentSchool } from "../js/services/auth.service.js";
import { isStarterPlan } from "../js/services/subscription.service.js";
import { renderModuleUpgrade } from "../js/components/module-upgrade.js";
import { rememberWorkspaceSelection, restoreWorkspaceSelection, workspaceOption, workspacePeriod } from "../js/services/workspace-selection.js";
import { workspaceResults } from "../js/components/workspace-results.js";

let classes = [];
let settings = null;
let selection = { grade: "", academicYear: "", term: "" };
let releaseRequest = 0;

export async function render({ profile, params = {} }) {
  releaseRequest++;
  if (isStarterPlan(getCurrentSchool())) {
    return renderModuleUpgrade({
      profile,
      title: "This module is not available for this plan",
      description: "The Public Results Release portal is reserved for schools on Growth and District plans. Please upgrade your plan to publish student results online, control visibility windows, and automate parent access expiry.",
      perks: [
        "Public Parent Results Lookup Portal",
        "Custom Results Release Windows & Automated Expiry",
        "Direct Parent Result Link Sharing",
      ],
      subject: "Upgrade Release Results Module to Growth Plan",
    });
  }

  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  const remembered = restoreWorkspaceSelection(profile, "release-results");
  const linkedGrade = params.grade ?? params.class;
  const { academicYear, term, terms } = workspacePeriod(settings, params);
  selection = {
    grade: workspaceOption(gradeOptions(), linkedGrade ?? remembered.grade, linkedGrade == null && remembered.grade !== ""),
    academicYear, term,
  };

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", { class: "text-muted" }, "Control when saved results become visible on the public results portal, and set an expiry after which parents are told to contact the school."),
      ]),
    ])
  );

  const pickerCard = el("div", { class: "card module-picker" });
  wrap.append(pickerCard);
  const bodyMount = el("div");
  wrap.append(bodyMount);

  renderPicker(pickerCard, bodyMount, profile, terms);
  loadModes(bodyMount, profile);
  return wrap;
}

function gradeOptions() {
  return classes.map((c) => c.grade);
}

function renderPicker(container, bodyMount, profile, terms) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const gradeSelect = el("select", {}, [
    el("option", { value: "" }, "Select grade"),
    ...gradeOptions().map((g) => el("option", { value: g, ...(g === selection.grade ? { selected: "true" } : {}) }, g)),
  ]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, [
    el("option", { value: "" }, "Select term"),
    ...terms.map((t) => el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)),
  ]);

  function updateSelection() {
    selection = { grade: gradeSelect.value, academicYear: yearInput.value.trim(), term: termSelect.value };
    rememberWorkspaceSelection(profile, "release-results", { grade: selection.grade });
    loadModes(bodyMount, profile);
  }
  for (const control of [gradeSelect, yearInput, termSelect]) control.addEventListener("change", updateSelection);

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect])
  );
  container.append(row);
  container.append(
    el("div", { class: "module-actions module-picker__footer" }, [
      el("button", { class: "btn btn--outline btn--sm", onClick: () => loadModes(bodyMount, profile) }, [icon("refresh"), "Refresh Status"]),
    ])
  );
}

async function loadModes(bodyMount, profile) {
  const request = ++releaseRequest;
  const context = { ...selection };
  if (!context.grade || !context.academicYear || !context.term) {
    bodyMount.replaceChildren(workspaceResults("Release Status", !context.grade ? "Select a grade to see which results are available to release."
      : "Choose the academic year and term for the results.", { symbol: "visibility" }));
    return;
  }
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [el("div", { class: "skeleton", style: "height:80px;" })]));

  try {
    const savedModes = await listSavedModesForPeriod(context);
    if (request !== releaseRequest) return;
    if (!savedModes.length) {
      const params = new URLSearchParams(context);
      bodyMount.replaceChildren(workspaceResults("Release Status",
        `No results saved for ${context.grade} · ${context.term} ${context.academicYear}. Save them in Grading & Positions before release.`,
        { symbol: "visibility_off", action: el("a", { class: "btn btn--outline btn--sm", href: `#/grading?${params}` }, "Open Grading") }));
      return;
    }
    const cards = await Promise.all(savedModes.map(async (mode) => {
      const key = { ...context, reportMode: mode.reportMode };
      return renderModeCard(profile, key, mode, await getRelease(key));
    }));
    if (request === releaseRequest) bodyMount.replaceChildren(...cards);
  } catch {
    if (request !== releaseRequest) return;
    bodyMount.replaceChildren(workspaceResults("Release Status", "Could not load release status for this period.", {
      action: el("button", { type: "button", class: "btn btn--outline btn--sm", onClick: () => loadModes(bodyMount, profile) }, "Retry"),
    }));
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
