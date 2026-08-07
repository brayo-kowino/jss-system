import {
  listAssessments,
  addAssessment,
  updateAssessment,
  deleteAssessment,
  setAssessmentStatus,
  ASSESSMENT_TYPES,
  DEFAULT_ASSESSMENT_MAX_SCORE,
  CONTRIBUTION_MODES,
} from "../js/services/assessment.service.js";
import { listClasses, listSubjects, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listAllMarks } from "../js/services/marks.service.js";
import { gradeFor } from "../js/services/grading.service.js";
import { openModal } from "../js/components/modal.js";
import { navigate } from "../js/router.js";
import { el, icon, toast, formatDate, busyButton } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];

// --- module state -----------------------------------------------------
let assessments = [];
let classes = [];
let subjects = [];
let students = [];
let allMarks = [];
let settings = null;
let statsById = new Map();

let filters = { search: "", type: "all", term: "all", year: "all", status: "all", grade: "all", subject: "all" };
let sort = { key: "date", dir: "desc" };

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [assessments, classes, subjects, students, allMarks, settings] = await Promise.all([
    listAssessments(),
    listClasses(),
    listSubjects(),
    listStudents(),
    listAllMarks(),
    getSchoolSettings(),
  ]);
  statsById = buildStatsIndex();
  // Filters may reference a term/year/grade that no longer exists - that's fine,
  // it'll just show 0 results until cleared.
  const canManage = CAN_MANAGE.includes(profile.role);

  const wrap = el("div", {});

  const header = el("div", { class: "page-header" }, [
    el("div", {}, [el("h1", {}, ""), el("p", {}, summaryLine())]),
  ]);
  if (canManage) {
    header.append(
      el("button", { class: "btn btn--primary", id: "new-assessment-btn" }, [
        el("span", { class: "material-symbols-rounded" }, "add"),
        " Add Assessment",
      ])
    );
  }
  wrap.append(header);

  const kpiMount = el("div", {});
  wrap.append(kpiMount);
  renderKpis(kpiMount);

  const filterMount = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(filterMount);
  renderFilters(filterMount, profile);

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap, profile, canManage);

  setTimeout(() => {
    document.getElementById("new-assessment-btn")?.addEventListener("click", () => openAssessmentForm(profile));
  });

  return wrap;
}

// ------------------------------------------------------------ analytics --

// Groups the whole marks collection by assessment so every row's "students
// sat" / mean-score stats are ready without extra Firestore round-trips.
function buildStatsIndex() {
  const map = new Map();
  const activeStudents = students.filter((s) => s.status === "active");

  for (const a of assessments) {
    const marksForA = allMarks.filter((m) => m.assessmentId === a.id);
    const studentIds = new Set(marksForA.map((m) => m.studentId));
    const eligible = activeStudents.filter((s) => !a.grades?.length || a.grades.includes(s.grade));

    const bySubject = new Map();
    let sumPct = 0;
    for (const m of marksForA) {
      const pct = m.maxScore ? (Number(m.score) / Number(m.maxScore)) * 100 : 0;
      sumPct += pct;
      const rec = bySubject.get(m.subjectCode) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
      rec.count += 1;
      rec.sum += pct;
      rec.min = Math.min(rec.min, pct);
      rec.max = Math.max(rec.max, pct);
      bySubject.set(m.subjectCode, rec);
    }

    map.set(a.id, {
      sat: studentIds.size,
      expected: eligible.length,
      meanPercent: marksForA.length ? sumPct / marksForA.length : null,
      subjectsCovered: bySubject.size,
      bySubject,
      entries: marksForA.length,
    });
  }
  return map;
}

function uniqueYears() {
  return Array.from(new Set(assessments.map((a) => a.academicYear).filter(Boolean))).sort().reverse();
}

function getFilteredSorted() {
  let list = assessments.filter((a) => {
    if (filters.search && !a.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.type !== "all" && a.type !== filters.type) return false;
    if (filters.term !== "all" && a.term !== filters.term) return false;
    if (filters.year !== "all" && a.academicYear !== filters.year) return false;
    if (filters.status !== "all" && (a.status || "open") !== filters.status) return false;
    if (filters.grade !== "all" && a.grades?.length && !a.grades.includes(filters.grade)) return false;
    if (filters.subject !== "all" && a.subjects?.length && !a.subjects.includes(filters.subject)) return false;
    return true;
  });

  const dir = sort.dir === "asc" ? 1 : -1;
  list = list.slice().sort((a, b) => {
    const sa = statsById.get(a.id) || {};
    const sb = statsById.get(b.id) || {};
    switch (sort.key) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "type":
        return (a.type || "").localeCompare(b.type || "") * dir;
      case "sat":
        return ((sa.sat || 0) - (sb.sat || 0)) * dir;
      case "mean":
        return ((sa.meanPercent ?? -1) - (sb.meanPercent ?? -1)) * dir;
      case "date":
      default:
        return (a.date || "").localeCompare(b.date || "") * dir;
    }
  });
  return list;
}

function summaryLine() {
  const filteredCount = getFilteredSorted().length;
  if (filteredCount === assessments.length) {
    return `${assessments.length} assessment(s) configured`;
  }
  return `Showing ${filteredCount} of ${assessments.length} assessment(s)`;
}

// ------------------------------------------------------------------ KPIs --

function renderKpis(container) {
  container.innerHTML = "";
  const today = new Date().toISOString().slice(0, 10);
  const open = assessments.filter((a) => (a.status || "open") === "open").length;
  const locked = assessments.filter((a) => a.status === "locked").length;
  const upcoming = assessments.filter((a) => a.date && a.date >= today).length;

  const withMarks = assessments.filter((a) => statsById.get(a.id)?.entries);
  const overallMean = withMarks.length
    ? withMarks.reduce((sum, a) => sum + statsById.get(a.id).meanPercent, 0) / withMarks.length
    : null;

  const kpis = [
    { label: "Total Assessments", value: assessments.length, icon: "assignment", color: "blue" },
    { label: "Open for Entry", value: open, icon: "edit_note", color: "green" },
    { label: "Locked", value: locked, icon: "lock", color: "purple" },
    { label: "Upcoming", value: upcoming, icon: "event_upcoming", color: "gold" },
    {
      label: "Overall Mean",
      value: overallMean != null ? `${overallMean.toFixed(1)}%` : "N/A",
      icon: "insights",
      color: "green",
    },
  ];

  const grid = el(
    "div",
    { class: "md3-kpi-grid" },
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
  container.append(grid);
}

// Per-assessment weight is no longer editable here - Grading & Positions
// derives it dynamically per compute from the Report Mode dropdown (Final/
// Average, Midterm Only, Endterm Only), overwriting whatever's stored the
// moment results are computed. A "does this add up to 100" check against
// the raw stored weight would therefore be checking a number nothing
// actually uses - see computeClassResults() in grading.service.js for the
// real, live weight logic and its own capacity-mismatch check, which runs
// against the *effective* weights instead.

// --------------------------------------------------------------- filters --

function selectField(label, id, options, current, labelFn) {
  return el("div", { class: "field" }, [
    el("label", {}, label),
    el(
      "select",
      { id },
      options.map((v) => el("option", { value: v, ...(v === current ? { selected: "true" } : {}) }, labelFn(v)))
    ),
  ]);
}

function renderFilters(container, profile) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-toolbar" });

  row.append(
    el("div", { class: "field" }, [
      el("label", {}, "Search"),
      el("input", { id: "f-search", placeholder: "Search by name…", value: filters.search }),
    ]),
    selectField("Type", "f-type", ["all", ...ASSESSMENT_TYPES], filters.type, (v) => (v === "all" ? "All Types" : v)),
    selectField(
      "Term",
      "f-term",
      ["all", ...(settings.terms || ["Term 1", "Term 2", "Term 3"])],
      filters.term,
      (v) => (v === "all" ? "All Terms" : v)
    ),
    selectField("Academic Year", "f-year", ["all", ...uniqueYears()], filters.year, (v) => (v === "all" ? "All Years" : v)),
    selectField(
      "Status",
      "f-status",
      ["all", "open", "locked"],
      filters.status,
      (v) => (v === "all" ? "All Statuses" : v[0].toUpperCase() + v.slice(1))
    ),
    selectField(
      "Class",
      "f-grade",
      ["all", ...classes.map((c) => c.grade)],
      filters.grade,
      (v) => (v === "all" ? "All Classes" : v)
    ),
    selectField(
      "Subject",
      "f-subject",
      ["all", ...subjects.map((s) => s.code)],
      filters.subject,
      (v) => (v === "all" ? "All Subjects" : subjectName(v))
    )
  );

  const actions = el("div", { class: "filter-actions" }, [
    el("button", { class: "btn btn--ghost btn--sm", id: "clear-filters" }, [icon("filter_alt_off"), "Clear filters"]),
    el("button", { class: "btn btn--ghost btn--sm", id: "export-csv" }, [
      el("span", { class: "material-symbols-rounded" }, "download"),
      " Export CSV",
    ]),
  ]);

  container.append(row, actions);

  setTimeout(() => {
    document.getElementById("f-search")?.addEventListener("input", (e) => {
      filters.search = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-type")?.addEventListener("change", (e) => {
      filters.type = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-term")?.addEventListener("change", (e) => {
      filters.term = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-year")?.addEventListener("change", (e) => {
      filters.year = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-status")?.addEventListener("change", (e) => {
      filters.status = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-grade")?.addEventListener("change", (e) => {
      filters.grade = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-subject")?.addEventListener("change", (e) => {
      filters.subject = e.target.value;
      rerender(profile);
    });
    document.getElementById("clear-filters")?.addEventListener("click", () => {
      filters = { search: "", type: "all", term: "all", year: "all", status: "all", grade: "all", subject: "all" };
      renderFilters(container, profile);
      rerender(profile);
    });
    document.getElementById("export-csv")?.addEventListener("click", () => exportCsv());
  });
}

function rerender(profile) {
  const canManage = CAN_MANAGE.includes(profile.role);
  const tableWrap = document.querySelector(".table-wrap");
  if (tableWrap) renderTable(tableWrap, profile, canManage);
  const countEl = document.querySelector(".page-header p");
  if (countEl) countEl.textContent = summaryLine();
}

async function refresh(profile) {
  [assessments, allMarks] = await Promise.all([listAssessments(), listAllMarks()]);
  statsById = buildStatsIndex();
  const kpiMount = document.querySelector(".md3-kpi-grid")?.parentElement;
  if (kpiMount) renderKpis(kpiMount);
  rerender(profile);
}

function exportCsv() {
  const list = getFilteredSorted();
  if (!list.length) return toast("Nothing to export with current filters.", "error");
  const header = ["Name", "Type", "Term", "Academic Year", "Date", "Out Of", "Out Of Overrides", "Mode", "Classes", "Subjects", "Students Sat", "Expected", "Mean %", "Status"];
  const rows = list.map((a) => {
    const s = statsById.get(a.id) || {};
    return [
      a.name,
      a.type,
      a.term || "",
      a.academicYear || "",
      a.date || "",
      a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE,
      Object.keys(a.subjectMaxScores || {}).length
        ? Object.entries(a.subjectMaxScores).map(([code, v]) => `${subjectName(code)}: ${v}`).join(" / ")
        : "",
      (a.contributionMode || "weighted") === "direct" ? "Direct add" : "Weighted",
      (a.grades || []).join(" / ") || "All",
      (a.subjects || []).map(subjectName).join(" / ") || "All",
      s.sat ?? 0,
      s.expected ?? 0,
      s.meanPercent != null ? s.meanPercent.toFixed(1) : "",
      a.status || "open",
    ];
  });
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `assessments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${list.length} assessment(s).`, "success");
}

// -------------------------------------------------------------- table ui --

function emptyState(title, message) {
  return el("div", { class: "empty-state" }, [el("h3", {}, title), el("p", {}, message)]);
}

function sortableTh(label, key, profile) {
  const active = sort.key === key;
  const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  return el(
    "th",
    {
      style: "cursor:pointer; user-select:none;",
      onClick: () => {
        sort.dir = active && sort.dir === "asc" ? "desc" : "asc";
        if (!active) sort.dir = "desc";
        sort.key = key;
        rerender(profile);
      },
    },
    `${label}${arrow}`
  );
}

function renderTable(container, profile, canManage) {
  container.innerHTML = "";

  if (!assessments.length) {
    container.append(
      emptyState(
        "No assessments yet",
        canManage ? "Click '+ Add Assessment' to set up your first CAT, assignment, or exam." : "Nothing has been scheduled yet."
      )
    );
    return;
  }

  const list = getFilteredSorted();
  if (!list.length) {
    container.append(emptyState("No matches", "Try adjusting or clearing your filters."));
    return;
  }

// 1. Update headers (removed the separate Term / Year column)
  const headCells = [
    sortableTh("Assessment", "name", profile),
    sortableTh("Type", "type", profile),
    sortableTh("Date", "date", profile),
    el("th", {}, "Out Of"),
    el("th", {}, "Mode"),
    el("th", {}, "Classes"),
    el("th", {}, "Subjects"),
    el("th", {}, "Status"),
    el("th", {}, "Actions"),
  ];

  const table = el("table", {}, [el("thead", {}, el("tr", {}, headCells))]);
  const tbody = el("tbody", {});

  for (const a of list) {
    // 2. Rich Assessment Name Cell (combines Name, Icon, and Term/Year)
    const nameCell = el("td", {}, [
      el("div", { style: "display:flex; align-items:center; gap:12px;" }, [
        el("div", { style: "background:var(--color-primary-100); color:var(--color-primary-700); border-radius:8px; width:40px; height:40px; display:grid; place-items:center;" }, [
           el("span", { class: "material-symbols-rounded" }, "assignment")
        ]),
        el("div", {}, [
          el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, a.name),
          el("div", { class: "text-xs text-muted" }, `${a.term || "N/A"} ${a.academicYear || ""}`)
        ])
      ])
    ]);

    const cells = [
      nameCell,
      el("td", {}, el("span", { class: "badge badge--muted" }, a.type)),
      el("td", {}, a.date ? formatDate(a.date) : "N/A"),
      el("td", { class: "numeric" }, Object.keys(a.subjectMaxScores || {}).length
          ? el("span", { title: Object.entries(a.subjectMaxScores).map(([code, v]) => `${subjectName(code)}: ${v}`).join(", ") }, `${a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE} (varies)`)
          : (a.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE)
      ),
      el("td", {}, el("span", { class: `badge badge--${(a.contributionMode || "weighted") === "direct" ? "gold" : "muted"}` }, (a.contributionMode || "weighted") === "direct" ? "Direct add" : "Weighted")),
      el("td", {}, (a.grades || []).length
          ? el("div", { class: "chip-list" }, a.grades.map((g) => el("span", { class: "chip" }, g)))
          : el("span", { class: "text-muted" }, "All")
      ),
      el("td", {}, (a.subjects || []).length
          ? el("div", { class: "chip-list" }, a.subjects.map((code) => el("span", { class: "chip" }, subjectName(code))))
          : el("span", { class: "text-muted" }, "All")
      ),
      el("td", {}, el("span", { class: `badge badge--${a.status === "locked" ? "danger" : "success"}` }, a.status || "open")),
    ];

    // 3. Slim actions cell: the one thing everyone needs (Results) stays
    // visible; anything more advanced (edit/duplicate/lock/delete) lives
    // behind a single "More" button that opens an action-list modal.
    const actionsCell = el("td", { class: "row-actions" }, [
      el("button", { class: "btn btn--tonal btn--sm", title: "View Results", onClick: () => openResultsModal(a) }, [
        el("span", { class: "material-symbols-rounded", style: "font-size:18px;" }, "analytics"),
        " Results"
      ]),
    ]);

    if (canManage) {
      actionsCell.append(
        el("button", { class: "btn btn--ghost btn--sm", title: "More actions", style: "padding:6px;", onClick: () => openActionsMenu(profile, a) }, [
          el("span", { class: "material-symbols-rounded", style: "font-size:18px;" }, "more_vert"),
        ])
      );
    }

    cells.push(actionsCell);
    tbody.append(el("tr", {}, cells));
  }
  table.append(tbody);
  container.append(table);
}

// ------------------------------------------------------------- more menu --

function actionMenuItem({ icon: iconName, label, desc, danger = false, onClick }) {
  return el(
    "button",
    {
      class: `action-menu__item${danger ? " action-menu__item--danger" : ""}`,
      onClick,
    },
    [
      el("span", { class: "material-symbols-rounded" }, iconName),
      el("div", { class: "action-menu__item-text" }, [
        el("div", { class: "action-menu__item-label" }, label),
        desc ? el("div", { class: "action-menu__item-desc" }, desc) : "",
      ]),
    ]
  );
}

function openActionsMenu(profile, a) {
  const menu = el("div", { class: "action-menu" }, [
    actionMenuItem({
      icon: "edit",
      label: "Edit assessment",
      desc: "Change name, date, weighting, classes or subjects.",
      onClick: () => {
        close();
        openAssessmentForm(profile, a);
      },
    }),
    actionMenuItem({
      icon: "content_copy",
      label: "Duplicate",
      desc: "Create a copy to reuse for another term or class.",
      onClick: () => {
        close();
        duplicateAssessment(profile, a);
      },
    }),
    actionMenuItem({
      icon: a.status === "locked" ? "lock_open" : "lock",
      label: a.status === "locked" ? "Reopen" : "Lock",
      desc: a.status === "locked" ? "Allow marks to be edited again." : "Prevent further changes to marks.",
      onClick: (ev) => {
        close();
        toggleLock(profile, a, ev.currentTarget);
      },
    }),
    el("div", { class: "action-menu__divider" }),
    actionMenuItem({
      icon: "delete",
      label: "Delete assessment",
      desc: "This can't be undone.",
      danger: true,
      onClick: () => {
        close();
        confirmDelete(profile, a);
      },
    }),
  ]);
  const close = openModal(a.name, menu);
}

// ------------------------------------------------------------ lock/unlock --

async function toggleLock(profile, a, button) {
  const next = a.status === "locked" ? "open" : "locked";
  const restore = busyButton(button, next === "locked" ? "Locking…" : "Reopening…");
  try {
    await setAssessmentStatus(profile.uid, a.id, next);
    toast(`${a.name} ${next === "locked" ? "locked" : "reopened"}.`, "success");
    await refresh(profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
    restore();
  }
}

// ------------------------------------------------------------- duplicate --

async function duplicateAssessment(profile, a) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Create a copy of "${a.name}"? You can rename it and adjust the date afterwards.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el(
        "button",
        {
          class: "btn btn--primary",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Duplicating…");
            try {
              await addAssessment(profile.uid, {
                name: `${a.name} (Copy)`,
                type: a.type,
                contributionMode: a.contributionMode || "weighted",
                maxScore: a.maxScore,
                date: a.date,
                academicYear: a.academicYear,
                term: a.term,
                grades: a.grades || [],
                subjects: a.subjects || [],
                subjectMaxScores: a.subjectMaxScores || {},
              });
              toast("Assessment duplicated.", "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not duplicate assessment.", "error");
              restore();
            }
          },
        },
        "Duplicate"
      ),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Duplicate Assessment", body);
}

// -------------------------------------------------------------- results --

function subjectName(code) {
  return subjects.find((s) => s.code === code)?.name || code;
}

function openResultsModal(a) {
  const s = statsById.get(a.id) || { sat: 0, expected: 0, meanPercent: null, bySubject: new Map(), subjectsCovered: 0 };
  const body = el("div", {});

  const meanGrade = s.meanPercent != null ? gradeFor(s.meanPercent, settings.gradingScale) : null;
  const completionPct = s.expected ? Math.round((s.sat / s.expected) * 100) : s.sat ? 100 : 0;

  const summary = el("div", { class: "results-summary" }, [
    summaryItem("Students Sat", s.expected ? `${s.sat}/${s.expected}` : `${s.sat}`),
    summaryItem("Completion", `${completionPct}%`),
    summaryItem("Subjects Entered", `${s.subjectsCovered}/${subjects.length}`),
    summaryItem("Mean Score", s.meanPercent != null ? `${s.meanPercent.toFixed(1)}%` : "N/A"),
    summaryItem("Mean Grade", meanGrade?.grade || "N/A"),
  ]);
  body.append(summary);

  if (!s.bySubject.size) {
    body.append(
      emptyState("No marks entered yet", "Once marks are captured for this assessment, per-subject performance will appear here.")
    );
  } else {
    const rows = Array.from(s.bySubject.entries())
      .map(([code, rec]) => ({
        code,
        name: subjectName(code),
        count: rec.count,
        mean: rec.sum / rec.count,
        min: rec.min,
        max: rec.max,
      }))
      .sort((x, y) => y.mean - x.mean);

    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {}, "Subject"),
        el("th", {}, "Entries"),
        el("th", {}, "Mean %"),
        el("th", {}, "Highest"),
        el("th", {}, "Lowest"),
        el("th", {}, "Grade"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const r of rows) {
      const g = gradeFor(r.mean, settings.gradingScale);
      tbody.append(
        el("tr", {}, [
          el("td", {}, r.name),
          el("td", { class: "numeric" }, String(r.count)),
          el("td", { class: "numeric" }, `${r.mean.toFixed(1)}%`),
          el("td", { class: "numeric" }, `${r.max.toFixed(1)}%`),
          el("td", { class: "numeric" }, `${r.min.toFixed(1)}%`),
          el("td", {}, el("span", { class: "badge badge--muted" }, g?.grade || "N/A")),
        ])
      );
    }
    table.append(tbody);
    body.append(el("div", { class: "table-wrap", style: "margin-bottom:16px;" }, table));
  }

  body.append(
    el("div", { style: "display:flex; gap:8px;" }, [
      el(
        "button",
        {
          class: "btn btn--primary",
          onClick: () => {
            navigate("/marks");
          },
        },
        "Go to Marks Entry"
      ),
    ])
  );

  openModal(`Results: ${a.name}`, body);
}

function summaryItem(label, value) {
  return el("div", { class: "results-summary__item" }, [
    el("div", { class: "results-summary__value" }, String(value)),
    el("div", { class: "results-summary__label" }, label),
  ]);
}

// --------------------------------------------------------------- editing --

function openAssessmentForm(profile, existing = null) {
  const isEdit = !!existing;
  if (isEdit && existing.status === "locked") {
    return toast("This assessment is locked. Reopen it first to edit.", "error");
  }
  const body = el("form", {});

  const typeSelect = el(
    "select",
    { id: "a-type" },
    ASSESSMENT_TYPES.map((t) => el("option", { value: t, ...(t === existing?.type ? { selected: "true" } : {}) }, t))
  );

  const termSelect = el(
    "select",
    { id: "a-term" },
    (settings.terms || ["Term 1", "Term 2", "Term 3"]).map((t) =>
      el("option", { value: t, ...(t === (existing?.term || settings.currentTerm) ? { selected: "true" } : {}) }, t)
    )
  );

  const gradeChecklist = el("div", { class: "checklist" });
  const selectedGrades = new Set(existing?.grades || []);
  for (const c of classes) {
    const checkbox = el("input", { type: "checkbox", value: c.grade, ...(selectedGrades.has(c.grade) ? { checked: "true" } : {}) });
    gradeChecklist.append(el("label", { class: "checklist-item" }, [checkbox, c.grade]));
  }

  // Leave unchecked = every subject gets this assessment. Check specific
  // subjects when only some of them sit it (e.g. no Assignment for CRE, no
  // Practical outside the sciences) - Marks Entry and Compute Results will
  // then only expect it for the subjects checked here.
  const subjectChecklist = el("div", { class: "checklist" });
  const selectedSubjects = new Set(existing?.subjects || []);
  for (const s of subjects) {
    const checkbox = el("input", { type: "checkbox", value: s.code, ...(selectedSubjects.has(s.code) ? { checked: "true" } : {}) });
    subjectChecklist.append(el("label", { class: "checklist-item" }, [checkbox, s.name]));
  }

  // Same occasion (name/date), different Marks Out Of per subject - e.g.
  // Agriculture out of 60, Maths out of 50, all languages out of 70. Blank
  // = use the default Marks Out Of above. Only offered for subjects this
  // assessment actually applies to (all of them, if none are checked above).
  // Rows can be bulk-set: check a group of subjects (or use a department
  // quick-select chip) then type one value and apply it to all of them at
  // once, instead of typing the same number into every subject separately.
  const existingOverrides = existing?.subjectMaxScores || {};
  const overrideRows = el("div", { class: "field-list" });
  const bulkToolbar = el("div", { style: "margin-bottom:10px;" });
  const bulkValueInput = el("input", { type: "number", min: "1", step: "0.5", placeholder: "value", style: "width:90px;" });

  function checkedOverrideCodes() {
    return Array.from(overrideRows.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.dataset.subjectCode);
  }

  function refreshOverrideRows() {
    const checkedSubjectAssessment = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const applicable = checkedSubjectAssessment.length ? subjects.filter((s) => checkedSubjectAssessment.includes(s.code)) : subjects;

    // Department quick-select chips - only shown for departments that
    // actually appear among the applicable subjects, and only when more
    // than one subject shares a department (a chip for a lone subject
    // wouldn't save any typing over just checking it directly).
    const deptCounts = {};
    for (const s of applicable) {
      if (!s.department) continue;
      deptCounts[s.department] = (deptCounts[s.department] || 0) + 1;
    }
    const chips = Object.keys(deptCounts).filter((d) => deptCounts[d] > 1);

    bulkToolbar.innerHTML = "";
    bulkToolbar.append(
      el("div", { style: "display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:8px;" }, [
        el("span", { class: "text-muted", style: "font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:0.04em;" }, "Quick select:"),
        ...chips.map((dept) =>
          el("button", {
            type: "button", class: "btn btn--ghost btn--sm",
            onClick: () => {
              const codesInDept = new Set(applicable.filter((s) => s.department === dept).map((s) => s.code));
              for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) {
                cb.checked = codesInDept.has(cb.dataset.subjectCode);
              }
            },
          }, dept)
        ),
        el("button", {
          type: "button", class: "btn btn--ghost btn--sm",
          onClick: () => { for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) cb.checked = true; },
        }, "All"),
        el("button", {
          type: "button", class: "btn btn--ghost btn--sm",
          onClick: () => { for (const cb of overrideRows.querySelectorAll("input[type=checkbox]")) cb.checked = false; },
        }, "None"),
      ]),
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        el("span", { class: "text-muted", style: "font-size:var(--fs-sm);" }, "Set checked subjects to"),
        bulkValueInput,
        el("button", {
          type: "button", class: "btn btn--tonal btn--sm",
          onClick: () => {
            const v = bulkValueInput.value.trim();
            if (v === "" || Number(v) <= 0) return toast("Enter a value to apply first.", "error");
            const codes = checkedOverrideCodes();
            if (!codes.length) return toast("Check at least one subject (or use a Quick select chip) first.", "error");
            for (const code of codes) {
              const input = overrideRows.querySelector(`input[type=number][data-subject-code="${code}"]`);
              if (input) input.value = v;
            }
            toast(`Applied ${v} to ${codes.length} subject(s).`, "success");
          },
        }, "Apply"),
      ])
    );

    overrideRows.innerHTML = "";
    for (const s of applicable) {
      const checkbox = el("input", { type: "checkbox", "data-subject-code": s.code });
      const input = el("input", {
        type: "number", min: "1", step: "0.5", "data-subject-code": s.code,
        placeholder: "default",
        value: existingOverrides[s.code] != null ? existingOverrides[s.code] : "",
        style: "width:100px;",
      });
      overrideRows.append(
        el("div", { style: "display:flex; align-items:center; gap:8px; margin-bottom:6px;" }, [
          checkbox,
          el("span", { style: "flex:1;" }, s.name),
          input,
        ])
      );
    }
  }
  refreshOverrideRows();
  subjectChecklist.addEventListener("change", refreshOverrideRows);
  const overridesDetails = el("details", {}, [
    el("summary", { style: "cursor:pointer; color:var(--color-primary-700); font-weight:600; font-size:var(--fs-sm); margin-bottom:8px;" },
      "Different Marks Out Of for some subjects? (optional)"),
    el("p", { class: "text-muted", style: "margin:0 0 8px; font-size:var(--fs-sm);" },
      "Leave a subject blank to use the default Marks Out Of above. Check subjects below (or use a department chip) and apply one value to all of them at once."),
    bulkToolbar,
    overrideRows,
  ]);

  const modeSelect = el(
    "select",
    { id: "a-mode" },
    CONTRIBUTION_MODES.map((m) => el("option", { value: m.value, ...(m.value === (existing?.contributionMode || "weighted") ? { selected: "true" } : {}) }, m.label))
  );

  const modeHint = el("p", { id: "a-mode-hint", class: "text-muted", style: "margin:-8px 0 4px; font-size:var(--fs-sm);" });

  function refreshModeHint() {
    if (modeSelect.value === "direct") {
      modeHint.textContent = "The raw score (bounded by Marks Out Of) is added straight onto the subject total - no % conversion, and it always counts, regardless of Report Mode. If it's meant to be part of the /100 total (e.g. an Exam marked out of 70), leave enough room for the weighted assessments' share, set via Report Mode in Grading & Positions. If it's a true bonus on top, that's fine too.";
    } else {
      modeHint.textContent = "Teachers enter raw scores against \"Marks Out Of\"; the system converts to a percentage automatically. How much this exam counts toward the final mark - e.g. Midterm 50% + Endterm 50%, or either one alone - is chosen once per compute using the Report Mode dropdown on the Grading & Positions page, not set per assessment here.";
    }
  }

  body.append(
    el("div", { class: "field" }, [
      el("label", {}, "Assessment Name"),
      el("input", { id: "a-name", value: existing?.name || "", placeholder: "e.g. CAT 1" }),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Type"), typeSelect]),
    el("div", { class: "field" }, [el("label", {}, "How should this count towards the final mark?"), modeSelect]),
    el("div", { class: "field" }, [
      el("label", {}, "Marks Out Of"),
      el("input", { id: "a-maxscore", type: "number", min: "1", step: "0.5", value: existing?.maxScore ?? DEFAULT_ASSESSMENT_MAX_SCORE, placeholder: "e.g. 30" }),
    ]),
    modeHint,
    el("div", { class: "field" }, [el("label", {}, "Date"), el("input", { id: "a-date", type: "date", value: existing?.date || "" })]),
    el("div", { class: "field" }, [
      el("label", {}, "Academic Year"),
      el("input", { id: "a-year", value: existing?.academicYear || settings.currentAcademicYear || "" }),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [el("label", {}, "Classes (leave all unchecked to apply to every grade)"), gradeChecklist]),
    el("div", { class: "field" }, [el("label", {}, "Subjects (leave all unchecked to apply to every subject)"), subjectChecklist]),
    overridesDetails,
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "add"), isEdit ? "Save changes" : "Add assessment"])
  );
  refreshModeHint();
  modeSelect.addEventListener("change", refreshModeHint);

  const close = openModal(isEdit ? `Edit: ${existing.name}` : "Add Assessment", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grades = Array.from(gradeChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const subjectCodes = Array.from(subjectChecklist.querySelectorAll("input:checked")).map((c) => c.value);
    const subjectMaxScores = {};
    for (const input of overrideRows.querySelectorAll("input[type=number][data-subject-code]")) {
      const v = input.value.trim();
      if (v !== "" && Number(v) > 0) subjectMaxScores[input.dataset.subjectCode] = Number(v);
    }
    const data = {
      name: document.getElementById("a-name").value.trim(),
      type: document.getElementById("a-type").value,
      contributionMode: modeSelect.value,
      maxScore: document.getElementById("a-maxscore").value,
      date: document.getElementById("a-date").value,
      academicYear: document.getElementById("a-year").value.trim(),
      term: document.getElementById("a-term").value,
      grades,
      subjects: subjectCodes,
      subjectMaxScores,
    };
    if (!data.name) return toast("Assessment name is required.", "error");
    if (!data.maxScore || Number(data.maxScore) <= 0) return toast("Marks Out Of must be a positive number.", "error");
    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    try {
      if (isEdit) {
        await updateAssessment(profile.uid, existing.id, data);
        toast("Assessment updated.", "success");
      } else {
        await addAssessment(profile.uid, data);
        toast("Assessment added.", "success");
      }
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not save assessment.", "error");
      restore();
    }
  });
}

function confirmDelete(profile, a) {
  const body = el("div", {});
  body.append(
    el("p", {}, `Delete "${a.name}"? This can't be undone.`),
    el("div", { style: "display:flex; gap:8px; margin-top:16px;" }, [
      el(
        "button",
        {
          class: "btn btn--danger",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Deleting…");
            try {
              await deleteAssessment(profile.uid, a.id);
              toast("Assessment deleted.", "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not delete assessment.", "error");
              restore();
            }
          },
        },
        "Delete"
      ),
      el("button", { class: "btn btn--ghost", onClick: () => close() }, [icon("close"), "Cancel"]),
    ])
  );
  const close = openModal("Delete Assessment", body);
}

export function init() {}