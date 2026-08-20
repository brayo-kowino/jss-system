import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import {
  listResultsByPeriod,
  listResultsForStudent,
  listSavedModesForPeriod,
  updateResultRemarks,
  reportModeLabel,
  positionScopeLabel,
  positionScopeTag,
} from "../js/services/grading.service.js";
import { getFeeSummary, formatKES } from "../js/services/fee.service.js";
import { downloadElementAsPdf, downloadPdfsAsZip } from "../js/services/pdf.util.js";
import { savedModesPanel } from "../js/components/saved-modes-panel.js";
import { el, icon, toast, formatDate, skeleton, spinner, busyButton } from "../js/utils.js";

const CAN_EDIT_TEACHER_REMARK = ["admin", "academic_master", "class_teacher"];
const CAN_EDIT_PRINCIPAL_REMARK = ["admin", "principal", "deputy_principal"];
const NO_PORTAL_YET = ["parent", "student"];

let classes = [];
let settings = null;
let selection = { grade: "", stream: "", academicYear: "", term: "" };
let activeMode = null; // which saved report mode is currently being viewed

export async function render({ profile }) {
  if (NO_PORTAL_YET.includes(profile.role)) {
    return el("div", { class: "empty-state" }, [
      el("h2", {}, "Report cards"),
      el("p", {}, "Self-service access is coming soon please ask the school office for a printed or emailed copy in the meantime."),
    ]);
  }

  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
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
function streamOptions(grade) {
  return classes.find((c) => c.grade === grade)?.streams || [];
}

function renderPicker(container, bodyMount, profile) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const gradeSelect = el("select", {}, [
    el("option", { value: "" }, "Select grade"),
    ...gradeOptions().map((g) => el("option", { value: g, ...(g === selection.grade ? { selected: "true" } : {}) }, g)),
  ]);
  const streamSelect = el("select", {}, [el("option", { value: "" }, "All streams")]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, (settings.terms || []).map((t) =>
    el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)
  ));

  function refreshStreams() {
    streamSelect.innerHTML = "";
    streamSelect.append(el("option", { value: "" }, "All streams"));
    for (const s of streamOptions(gradeSelect.value)) {
      streamSelect.append(el("option", { value: s, ...(s === selection.stream ? { selected: "true" } : {}) }, s));
    }
  }
  refreshStreams();

  gradeSelect.addEventListener("change", () => { selection.grade = gradeSelect.value; selection.stream = ""; refreshStreams(); });
  streamSelect.addEventListener("change", () => { selection.stream = streamSelect.value; });
  yearInput.addEventListener("change", () => { selection.academicYear = yearInput.value.trim(); });
  termSelect.addEventListener("change", () => { selection.term = termSelect.value; });

  row.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect])
  );
  container.append(row);
  container.append(
    el("div", { class: "filter-actions" }, [
      el("button", { class: "btn btn--primary", onClick: () => loadList(bodyMount, profile) }, [icon("description"), "Load Report Cards"]),
    ])
  );
}

async function loadList(bodyMount, profile) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
  ]));
  const savedModes = await listSavedModesForPeriod(selection);
  if (!savedModes.length) {
    bodyMount.innerHTML = "";
    bodyMount.append(el("div", { class: "empty-state" }, [
      icon("description", "empty-state__icon"),
      el("h3", {}, "No saved results for this period"),
      el("p", {}, "Compute and save results for this class under Grading & Positions first, then come back here."),
    ]));
    return;
  }
  // Keep whichever mode is already selected if it's still valid (e.g.
  // returning here after viewing a card); otherwise default to Average
  // (the closest thing to a "final" report), falling back to whichever
  // mode was most recently saved.
  if (!activeMode || !savedModes.some((m) => m.reportMode === activeMode)) {
    activeMode = savedModes.find((m) => m.reportMode === "average")?.reportMode
      || [...savedModes].sort((a, b) => (b.latestComputedAt || 0) - (a.latestComputedAt || 0))[0].reportMode;
  }
  renderPeriodBody(bodyMount, profile, savedModes);
}

// Renders the "saved so far" chip row for this grade/stream/year/term
// plus the student list for whichever mode is currently active, so
// clicking a different saved mode swaps the list in place without
// re-picking grade/stream/year/term.
function renderPeriodBody(bodyMount, profile, savedModes) {
  bodyMount.innerHTML = "";
  bodyMount.append(savedModesPanel(savedModes, {
    activeMode,
    onSelect: (mode) => { activeMode = mode; renderPeriodBody(bodyMount, profile, savedModes); },
  }));
  const listMount = el("div", { style: "margin-top:16px;" });
  bodyMount.append(listMount);
  listMount.append(el("div", { class: "skeleton-rows" }, [skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%")]));
  listResultsByPeriod({ ...selection, reportMode: activeMode }).then((results) => {
    listMount.innerHTML = "";
    renderList(listMount, results, profile, bodyMount);
  });
}

function renderList(container, results, profile, bodyMount) {
  container.innerHTML = "";
  const header = el("div", { class: "card", style: "margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
    el("div", {}, [
      el("h3", { style: "margin:0 0 4px;" }, [
        `${selection.grade}${selection.stream ? " " + selection.stream : ""}: ${selection.term} ${selection.academicYear}`,
        " ",
        el("span", { class: "badge badge--success" }, reportModeLabel(activeMode)),
      ]),
      el("p", { class: "text-muted", style: "margin:0;" }, `${results.length} saved report card(s) for this report.`),
    ]),
  ]);
  if (results.length) {
    const bulkBtn = el("button", { class: "btn btn--ghost btn--sm" }, [icon("folder_zip"), "Download All (ZIP)"]);
    bulkBtn.addEventListener("click", () => handleBulkDownload(bulkBtn, results, profile));
    header.append(bulkBtn);
  }
  container.append(header);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Pos"), el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Mean"), el("th", {}, "Grade"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody", {});
  const isStreamView = Boolean(selection.stream);
  for (const r of results) {
    const pos = isStreamView ? r.classPosition : r.overallPosition;
    const size = isStreamView ? r.streamClassSize : r.classSize;
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Pos" }, pos ? `${pos}/${size}` : "N/A"),
      el("td", { "data-label": "Adm No." }, r.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, r.fullName),
      el("td", { "data-label": "Mean" }, `${r.meanMarks?.toFixed(2) ?? "N/A"}%`),
      el("td", { "data-label": "Grade" }, el("span", { class: "badge badge--gold" }, r.meanGrade || "N/A")),
      el("td", { class: "row-actions", "data-label": "Report Card" }, el("button", { class: "btn btn--ghost btn--sm", onClick: () => openCard(bodyMount, r, profile) }, [icon("description"), "View Report Card"])),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

// Builds every report card for this list off-screen (one at a time - see
// downloadPdfsAsZip for why) and bundles them into a single .zip. Reuses
// the exact same buildCard() the single "View Report Card" flow uses, so
// a bulk card looks identical to one downloaded individually - just the
// fee/history lookups are re-fetched per student since they were never
// loaded for anyone but whoever was actively being viewed.
async function handleBulkDownload(button, results, profile) {
  if (!results.length) return;
  const original = button.textContent;
  button.disabled = true;
  const offscreen = el("div", { style: "position:fixed; left:-10000px; top:0; width:900px;" });
  document.body.appendChild(offscreen);
  try {
    // Fetch every student's fee summary + history up front, all in
    // parallel, instead of one pair of awaits per student interleaved into
    // the render loop below. The render loop itself stays sequential (see
    // downloadPdfsAsZip) to keep the browser from rasterizing 40+ report
    // cards at once, but there's no reason the *network* reads should be
    // serialized behind that - prefetching them concurrently means the
    // whole batch's Firestore round trips overlap instead of queuing up
    // one by one as each card is about to render.
    button.textContent = "Fetching data…";
    const prefetched = await Promise.all(
      results.map((r) =>
        Promise.all([
          getFeeSummary({ studentId: r.studentId, grade: r.grade, academicYear: r.academicYear, term: r.term }),
          listResultsForStudent(r.studentId),
        ])
      )
    );

    const items = results.map((r, i) => ({
      filename: `${(r.fullName || "student").replace(/\s+/g, "_")}_${r.admissionNumber || r.studentId}.pdf`,
      build: async () => {
        const [feeSummary, history] = prefetched[i];
        const priorHistory = history
          .filter((h) => !(h.academicYear === r.academicYear && h.term === r.term))
          .filter((h) => (h.reportMode || "average") === (r.reportMode || "average"))
          .sort((a, b) => (b.academicYear + b.term).localeCompare(a.academicYear + a.term))
          .slice(0, 4);
        offscreen.innerHTML = "";
        const card = buildCard(r, feeSummary, priorHistory, profile);
        offscreen.appendChild(card);
        return card;
      },
    }));
    await downloadPdfsAsZip(
      items,
      `ReportCards_${selection.grade}${selection.stream ? "_" + selection.stream : ""}_${selection.term}_${selection.academicYear}.zip`,
      { onProgress: (done, total) => { button.textContent = `Preparing ${done}/${total}…`; } }
    );
    toast(`Downloaded ${results.length} report card(s).`, "success");
  } catch (err) {
    toast(err.message || "Could not generate the ZIP.", "error");
  } finally {
    offscreen.remove();
    button.disabled = false;
    button.textContent = original;
  }
}

async function openCard(bodyMount, result, profile) {
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "spinner-overlay" }, [spinner("lg", "dark"), el("div", {}, "Building report card…")]));
  const [feeSummary, history] = await Promise.all([
    getFeeSummary({ studentId: result.studentId, grade: result.grade, academicYear: result.academicYear, term: result.term }),
    listResultsForStudent(result.studentId),
  ]);
  // "History" means a genuinely different term - not another saved mode
  // (Midterm/Endterm/Average), which now persists as a separate doc and
  // would otherwise show up here looking like a separate past term. Kept
  // to the same report mode as the card being viewed, so the trend is
  // apples-to-apples (e.g. Average-to-Average). Every saved doc carries
  // both class and overall positions now, so there's no stream-scope
  // filter needed here - buildCard picks whichever pair matches the
  // scope currently selected in the picker.
  const priorHistory = history
    .filter((h) => !(h.academicYear === result.academicYear && h.term === result.term))
    .filter((h) => (h.reportMode || "average") === (result.reportMode || "average"))
    .sort((a, b) => (b.academicYear + b.term).localeCompare(a.academicYear + a.term))
    .slice(0, 4);

  bodyMount.innerHTML = "";
  bodyMount.append(buildActionBar(bodyMount, result, profile));
  const card = buildCard(result, feeSummary, priorHistory, profile);
  bodyMount.append(card);
}

function buildActionBar(bodyMount, result, profile) {
  const bar = el("div", { class: "no-print", style: "display:flex; justify-content:space-between; margin-bottom:16px;" });
  bar.append(
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => loadList(bodyMount, profile) }, [icon("arrow_back"), "Back to list"]),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => window.print() }, [icon("print"), "Print"]),
      el("button", { class: "btn btn--primary btn--sm", onClick: (e) => handleDownload(e.target, result) }, [icon("download"), "Download PDF"]),
    ])
  );
  return bar;
}

async function handleDownload(button, result) {
  const card = document.querySelector(".report-card");
  if (!card) return;
  const original = button.textContent;
  button.textContent = "Preparing…";
  button.disabled = true;
  try {
    await downloadElementAsPdf(card, `${result.fullName.replace(/\s+/g, "_")}_${result.term}_${result.academicYear}.pdf`);
  } catch (err) {
    toast("Could not generate PDF - check your connection and try again.", "error");
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

function buildCard(result, feeSummary, priorHistory, profile) {
  const card = el("div", { class: "report-card" });

  // Header: logo + school details + banner
  card.append(
    el("div", { class: "report-card__header" }, [
      settings.logoUrl
        ? el("img", { class: "report-card__logo", src: settings.logoUrl })
        : el("img", { class: "report-card__logo", src: "/assets/logo.png", alt: "logo" }),
      el("div", {}, [
        el("h2", { class: "report-card__school-name" }, settings.schoolName || "School Name"),
        el("p", { class: "report-card__motto" }, settings.motto || ""),
      ]),
      el("p", { class: "report-card__address" }, [settings.address, settings.phone].filter(Boolean).join(" · ")),
    ])
  );
  card.append(el("div", { class: "report-card__banner" }, `${result.term} ${result.academicYear}: ${reportModeLabel(result.reportMode)}`));

  // Student identity row - a real table so labels/values line up in even
  // columns across the full width, the way a printed official record
  // would, rather than a loose two-column list.
  card.append(
    el("div", { class: "report-card__student" }, [
      result.photoUrl
        ? el("img", { class: "report-card__photo", src: result.photoUrl })
        : el("div", { class: "report-card__photo" }),
      infoTable([
        ["Name", result.fullName, "Adm No", result.admissionNumber || "N/A"],
        ["Class", `${result.grade}${result.stream ? " " + result.stream : ""}`, "Gender", result.gender || "N/A"],
        ["Exam", reportModeLabel(result.reportMode), "Assessment No", result.kcpeNumber || "N/A"],
      ]),
    ])
  );

  // Summary stats - a real table (header row of labels, one row of
  // values) so it reads as part of the same tabular record as the rest
  // of the card, instead of a separate boxed stat grid.
  const isStreamView = Boolean(selection.stream);
  const cardPos = isStreamView ? result.classPosition : result.overallPosition;
  const cardSize = isStreamView ? result.streamClassSize : result.classSize;
  card.append(el("h4", { class: "report-card__section-title" }, "Performance Summary"));
  card.append(summaryTable([
    ["Total Marks", `${result.totalMarks.toFixed(1)}/${result.totalOutOf}`],
    ["Mean Marks", `${result.meanMarks.toFixed(2)}%`],
    ["Mean Grade", result.meanGrade ?? "N/A"],
    ["Total Points", String(result.totalPoints)],
    [positionScopeLabel(isStreamView), `${cardPos}/${cardSize}`],
  ]));

  // Pathway breakdown
  card.append(el("h4", { class: "report-card__section-title" }, "Pathway Performance"));
  card.append(
    el("div", { class: "report-card__pathways" }, result.pathwayBreakdown.map((p) =>
      el("div", { class: "report-card__pathway" }, [
        el("div", { class: "report-card__pathway-name" }, p.pathway),
        el("div", { class: "report-card__pathway-value" }, `${p.percentage.toFixed(1)}%`),
        el("div", { class: "text-sm text-muted" }, `${p.points} pts`),
      ])
    ))
  );

  card.append(el("h4", { class: "report-card__section-title" }, "Subject Performance"));
  // Subject table - only show the Midt/End reference columns when the
  // report is an average of both; a Midterm-only or Endterm-only report
  // is a single exam's results, so a second reference column would just
  // repeat (or worse, imply an exam that isn't part of this report at all).
  const showBothColumns = (result.reportMode || "average") === "average";
  const tableWrap = el("div", { class: "table-wrap", style: "margin-bottom:16px;" });
  const table = el("table", { class: "report-card__subject-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject"),
      ...(showBothColumns ? [el("th", {}, "Midt"), el("th", {}, "End")] : []),
      el("th", {}, "Score"), el("th", {}, "Grade"), el("th", {}, "Points"), el("th", {}, "Rank"), el("th", {}, "Remarks"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of [...result.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    tbody.append(el("tr", {}, [
      el("td", {}, [s.name, s.incomplete ? el("span", { class: "badge badge--warning", style: "margin-left:6px;", title: `Only ${s.weightUsed}% of ${s.weightExpected}% assessment weight marked` }, "Partial") : ""]),
      ...(showBothColumns ? [
        el("td", {}, s.midtScore == null ? el("span", { class: "text-muted" }, "—") : s.midtScore.toFixed(1)),
        el("td", {}, s.endScore == null ? el("span", { class: "text-muted" }, "—") : s.endScore.toFixed(1)),
      ] : []),
      el("td", {}, s.average.toFixed(1)),
      el("td", {}, s.grade),
      el("td", {}, String(s.points)),
      el("td", {}, isStreamView ? `${s.classPosition}/${cardSize}` : `${s.position}/${cardSize}`),
      el("td", {}, s.remark),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);

  // Performance history
  if (priorHistory.length) {
    card.append(el("h4", { class: "report-card__section-title" }, "Performance History"));
    const histWrap = el("div", { class: "table-wrap", style: "margin-bottom:16px;" });
    const histTable = el("table", {}, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Term"), el("th", {}, "Class"), el("th", {}, "Mean"), el("th", {}, "Points"), el("th", {}, "Grade"), el("th", {}, "Position"), el("th", {}, "Scope")])),
    ]);
    const histBody = el("tbody", {});
    for (const h of priorHistory) {
      const hPos = isStreamView ? h.classPosition : h.overallPosition;
      const hSize = isStreamView ? h.streamClassSize : h.classSize;
      histBody.append(el("tr", {}, [
        el("td", {}, `${h.term} '${String(h.academicYear).slice(-2)}`),
        el("td", {}, `${h.grade}${h.stream ? " " + h.stream : ""}`),
        el("td", {}, `${h.meanMarks?.toFixed(2) ?? "N/A"}%`),
        el("td", {}, String(h.totalPoints ?? "N/A")),
        el("td", {}, h.meanGrade || "N/A"),
        el("td", {}, hPos ? `${hPos}/${hSize}` : "N/A"),
        el("td", {}, positionScopeTag(isStreamView)),
      ]));
    }
    histTable.append(histBody);
    histWrap.append(histTable);
    card.append(histWrap);
  }

  // Remarks
  const canEditTeacher = CAN_EDIT_TEACHER_REMARK.includes(profile.role);
  const canEditPrincipal = CAN_EDIT_PRINCIPAL_REMARK.includes(profile.role);
  const teacherBox = remarkBox("Class Teacher Remarks", result.teacherRemark, canEditTeacher);
  const principalBox = remarkBox("Principal Remarks", result.principalRemark, canEditPrincipal, {
    name: settings.principalName,
    title: settings.principalTitle || "Principal",
  });
  card.append(el("div", { class: "report-card__remarks" }, [teacherBox.node, principalBox.node]));

  if (canEditTeacher || canEditPrincipal) {
    card.append(
      el("div", { class: "no-print", style: "text-align:right; margin-bottom:16px;" }, [
        el("button", {
          class: "btn btn--ghost btn--sm",
          onClick: async (e) => {
            const restore = busyButton(e.currentTarget, "Saving…");
            try {
              await updateResultRemarks(profile.uid, result.id, {
                ...(canEditTeacher ? { teacherRemark: teacherBox.getValue() } : {}),
                ...(canEditPrincipal ? { principalRemark: principalBox.getValue() } : {}),
              });
              toast("Remarks saved.", "success");
            } catch (err) {
              toast(err.message || "Could not save remarks.", "error");
            } finally {
              restore();
            }
          },
        }, [icon("save"), "Save Remarks"]),
      ])
    );
  }

  // Approved-by signatures - only show a block for whichever of the
  // principal/deputy principal actually has a name set in School Settings
  // (Settings -> Leadership), so an unfilled field doesn't print a blank
  // "Principal: " line on a card that goes home to a parent.
  const signers = [
    settings.principalName ? { name: settings.principalName, title: settings.principalTitle || "Principal" } : null,
    settings.deputyPrincipalName ? { name: settings.deputyPrincipalName, title: settings.deputyPrincipalTitle || "Deputy Principal" } : null,
  ].filter(Boolean);
  if (signers.length) {
    card.append(
      el("div", { class: "report-card__signatures" }, signers.map((s) =>
        el("div", { class: "report-card__signature" }, [
          el("div", { class: "report-card__signature-line" }),
          el("div", { class: "report-card__signature-name" }, s.name),
          el("div", { class: "report-card__signature-title" }, s.title),
        ])
      ))
    );
  }

  // Fee balance
  card.append(el("div", { class: "report-card__fee-balance" }, `Fee Balance: ${formatKES(feeSummary.balance)}`));

  // Term dates
  card.append(
    el("div", { class: "report-card__dates" }, [
      el("span", {}, `School Closes On: ${settings.closingDate ? formatDate(settings.closingDate) : "N/A"}`),
      el("span", {}, `Next Term Begins: ${settings.openingDate ? formatDate(settings.openingDate) : "N/A"}`),
    ])
  );

  return card;
}

// Performance summary as a table: one header row of labels, one row of
// values, so it lines up as columns rather than a grid of boxed stats.
function summaryTable(pairs) {
  const headRow = el("tr", {}, pairs.map(([label]) => el("th", {}, label)));
  const valueRow = el("tr", {}, pairs.map(([, value]) => el("td", {}, value ?? "N/A")));
  return el("div", { class: "table-wrap", style: "margin-bottom:16px;" }, [
    el("table", { class: "report-card__summary-table" }, [
      el("thead", {}, headRow),
      el("tbody", {}, valueRow),
    ]),
  ]);
}

// Student identity as a real table: two label/value pairs per row, four
// even columns across the full width, matching how the printed record is
// laid out (rows = [label, value, label, value]).
function infoTable(rows) {
  const tbody = el("tbody", {});
  for (const [l1, v1, l2, v2] of rows) {
    tbody.append(el("tr", {}, [
      el("th", {}, l1), el("td", {}, v1 || "N/A"),
      el("th", {}, l2), el("td", {}, v2 || "N/A"),
    ]));
  }
  return el("table", { class: "report-card__info-table" }, [tbody]);
}

function remarkBox(title, value, editable, signer) {
  const box = el("div", { class: "report-card__remark-box" });
  box.append(el("h4", {}, title));
  let control;
  if (editable) {
    control = el("textarea", {}, value || "");
    control.value = value || "";
  } else {
    control = el("p", { class: "text-sm" }, value || "No remarks yet.");
  }
  box.append(control, el("div", { class: "report-card__sign-line" }, "Sign: ……………………………………"));
  // Printed name/title under the sign-line, when School Settings ->
  // Leadership has one on file (e.g. the Principal for the Principal
  // Remarks box), so it's clear whose signature the line is for.
  if (signer?.name) {
    box.append(el("div", { class: "report-card__signer" }, `${signer.name}, ${signer.title}`));
  }
  return { node: box, getValue: () => (editable ? control.value.trim() : value || "") };
}

export function init() {}