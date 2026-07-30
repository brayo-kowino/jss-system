import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import {
  listResultsByPeriod,
  listResultsForStudent,
  updateResultRemarks,
} from "../js/services/grading.service.js";
import { getFeeSummary, formatKES } from "../js/services/fee.service.js";
import { downloadElementAsPdf } from "../js/services/pdf.util.js";
import { el, toast, formatDate } from "../js/utils.js";

const CAN_EDIT_TEACHER_REMARK = ["admin", "academic_master", "class_teacher"];
const CAN_EDIT_PRINCIPAL_REMARK = ["admin", "principal", "deputy_principal"];
const NO_PORTAL_YET = ["parent", "student"];

let classes = [];
let settings = null;
let selection = { grade: "", stream: "", academicYear: "", term: "" };

export async function render({ profile }) {
  if (NO_PORTAL_YET.includes(profile.role)) {
    return el("div", { class: "empty-state" }, [
      el("h2", {}, "Report cards"),
      el("p", {}, "Self-service access is coming soon — please ask the school office for a printed or emailed copy in the meantime."),
    ]);
  }

  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, "Report Card Generator"),
        el("p", {}, "Pull up a class's saved results and print, download, or annotate each student's report card."),
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
  const row = el("div", { style: "display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; align-items:end;" });

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
    el("button", { class: "btn btn--primary", onClick: () => loadList(bodyMount, profile) }, "Load Report Cards")
  );
}

async function loadList(bodyMount, profile) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  bodyMount.innerHTML = `<div class="empty-state">Loading saved results…</div>`;
  const results = await listResultsByPeriod(selection);
  if (!results.length) {
    bodyMount.innerHTML = "";
    bodyMount.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No saved results for this period"),
      el("p", {}, "Compute and save results for this class under Grading & Positions first, then come back here."),
    ]));
    return;
  }
  renderList(bodyMount, results, profile);
}

function renderList(container, results, profile) {
  container.innerHTML = "";
  const header = el("div", { class: "card", style: "margin-bottom:16px;" }, [
    el("h3", { style: "margin:0 0 4px;" }, `${selection.grade}${selection.stream ? " " + selection.stream : ""} — ${selection.term} ${selection.academicYear}`),
    el("p", { class: "text-muted", style: "margin:0;" }, `${results.length} saved report card(s).`),
  ]);
  container.append(header);

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Pos"), el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Mean"), el("th", {}, "Grade"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const r of results) {
    tbody.append(el("tr", {}, [
      el("td", {}, r.overallPosition ? `${r.overallPosition}/${r.classSize}` : "—"),
      el("td", {}, r.admissionNumber || "—"),
      el("td", {}, r.fullName),
      el("td", {}, `${r.meanMarks?.toFixed(2) ?? "—"}%`),
      el("td", {}, el("span", { class: "badge badge--gold" }, r.meanGrade || "—")),
      el("td", {}, el("button", { class: "btn btn--ghost btn--sm", onClick: () => openCard(container, r, profile) }, "View Report Card")),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

async function openCard(container, result, profile) {
  container.innerHTML = `<div class="empty-state">Building report card…</div>`;
  const [feeSummary, history] = await Promise.all([
    getFeeSummary({ studentId: result.studentId, grade: result.grade, academicYear: result.academicYear, term: result.term }),
    listResultsForStudent(result.studentId),
  ]);
  const priorHistory = history
    .filter((h) => h.id !== result.id)
    .sort((a, b) => (b.academicYear + b.term).localeCompare(a.academicYear + a.term))
    .slice(0, 4);

  container.innerHTML = "";
  container.append(buildActionBar(container, result, profile));
  const card = buildCard(result, feeSummary, priorHistory, profile);
  container.append(card);
}

function buildActionBar(container, result, profile) {
  const bar = el("div", { class: "no-print", style: "display:flex; justify-content:space-between; margin-bottom:16px;" });
  bar.append(
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => { container.innerHTML = ""; loadList(container, profile); } }, "← Back to list"),
    el("div", { style: "display:flex; gap:8px;" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => window.print() }, "Print"),
      el("button", { class: "btn btn--primary btn--sm", onClick: (e) => handleDownload(e.target, result) }, "Download PDF"),
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
    toast("Could not generate PDF — check your connection and try again.", "error");
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
        : el("div", { class: "seal seal--lg" }, "JS"),
      el("div", {}, [
        el("h2", { class: "report-card__school-name" }, settings.schoolName || "School Name"),
        el("p", { class: "report-card__motto" }, settings.motto || ""),
      ]),
      el("p", { class: "report-card__address" }, [settings.address, settings.phone].filter(Boolean).join(" · ")),
    ])
  );
  card.append(el("div", { class: "report-card__banner" }, `${result.term} ${result.academicYear} — Progress Report`));

  // Student identity row
  card.append(
    el("div", { class: "report-card__student" }, [
      result.photoUrl
        ? el("img", { class: "report-card__photo", src: result.photoUrl })
        : el("div", { class: "report-card__photo" }),
      el("div", { class: "report-card__student-grid" }, [
        el("div", {}, [el("b", {}, "Name: "), result.fullName]),
        el("div", {}, [el("b", {}, "Adm No: "), result.admissionNumber || "—"]),
        el("div", {}, [el("b", {}, "Class: "), `${result.grade}${result.stream ? " " + result.stream : ""}`]),
        el("div", {}, [el("b", {}, "Gender: "), result.gender || "—"]),
      ]),
      el("div", {}),
    ])
  );

  // Summary stats
  card.append(
    el("div", { class: "report-card__summary" }, [
      stat("Total Marks", `${result.totalMarks.toFixed(1)}/${result.totalOutOf}`),
      stat("Mean Marks", `${result.meanMarks.toFixed(2)}%`),
      stat("Mean Grade", result.meanGrade),
      stat("Total Points", String(result.totalPoints)),
      stat("Overall Position", `${result.overallPosition}/${result.classSize}`),
    ])
  );

  // Pathway breakdown
  card.append(
    el("div", { class: "report-card__pathways" }, result.pathwayBreakdown.map((p) =>
      el("div", { class: "report-card__pathway" }, [
        el("div", { class: "report-card__pathway-name" }, p.pathway),
        el("div", { class: "report-card__pathway-value" }, `${p.percentage.toFixed(1)}%`),
        el("div", { class: "text-sm text-muted" }, `${p.points} pts`),
      ])
    ))
  );

  // Subject table
  const tableWrap = el("div", { class: "table-wrap", style: "margin-bottom:16px;" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Subject"), el("th", {}, "Score"), el("th", {}, "Grade"), el("th", {}, "Points"), el("th", {}, "Position"), el("th", {}, "Remarks"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of [...result.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    tbody.append(el("tr", {}, [
      el("td", {}, s.name),
      el("td", {}, s.average.toFixed(1)),
      el("td", {}, s.grade),
      el("td", {}, String(s.points)),
      el("td", {}, `${s.position}/${result.classSize}`),
      el("td", {}, s.remark),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);

  // Performance history
  if (priorHistory.length) {
    card.append(el("h4", { style: "margin:0 0 8px;" }, "Performance History"));
    const histWrap = el("div", { class: "table-wrap", style: "margin-bottom:16px;" });
    const histTable = el("table", {}, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Term"), el("th", {}, "Class"), el("th", {}, "Mean"), el("th", {}, "Points"), el("th", {}, "Grade"), el("th", {}, "Position")])),
    ]);
    const histBody = el("tbody", {});
    for (const h of priorHistory) {
      histBody.append(el("tr", {}, [
        el("td", {}, `${h.term} '${String(h.academicYear).slice(-2)}`),
        el("td", {}, `${h.grade}${h.stream ? " " + h.stream : ""}`),
        el("td", {}, `${h.meanMarks?.toFixed(2) ?? "—"}%`),
        el("td", {}, String(h.totalPoints ?? "—")),
        el("td", {}, h.meanGrade || "—"),
        el("td", {}, h.overallPosition ? `${h.overallPosition}/${h.classSize}` : "—"),
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
  const principalBox = remarkBox("Principal Remarks", result.principalRemark, canEditPrincipal);
  card.append(el("div", { class: "report-card__remarks" }, [teacherBox.node, principalBox.node]));

  if (canEditTeacher || canEditPrincipal) {
    card.append(
      el("div", { class: "no-print", style: "text-align:right; margin-bottom:16px;" }, [
        el("button", {
          class: "btn btn--ghost btn--sm",
          onClick: async () => {
            try {
              await updateResultRemarks(profile.uid, result.id, {
                ...(canEditTeacher ? { teacherRemark: teacherBox.getValue() } : {}),
                ...(canEditPrincipal ? { principalRemark: principalBox.getValue() } : {}),
              });
              toast("Remarks saved.", "success");
            } catch (err) {
              toast(err.message || "Could not save remarks.", "error");
            }
          },
        }, "Save Remarks"),
      ])
    );
  }

  // Fee balance
  card.append(el("div", { class: "report-card__fee-balance" }, `Fee Balance: ${formatKES(feeSummary.balance)}`));

  // Term dates
  card.append(
    el("div", { class: "report-card__dates" }, [
      el("span", {}, `School Closes On: ${settings.closingDate ? formatDate(settings.closingDate) : "—"}`),
      el("span", {}, `Next Term Begins: ${settings.openingDate ? formatDate(settings.openingDate) : "—"}`),
    ])
  );

  return card;
}

function stat(label, value) {
  return el("div", { class: "report-card__stat" }, [
    el("div", { class: "report-card__stat-label" }, label),
    el("div", { class: "report-card__stat-value" }, value ?? "—"),
  ]);
}

function remarkBox(title, value, editable) {
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
  return { node: box, getValue: () => (editable ? control.value.trim() : value || "") };
}

export function init() {}
