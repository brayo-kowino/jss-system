import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import { getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import {
  STATUSES,
  todayStr,
  getAttendanceForClassDate,
  saveAttendance,
  listAttendanceForClassPeriod,
  summarizeForRoster,
} from "../js/services/attendance.service.js";
import { el, icon, toast, formatDate, skeleton, busyButton } from "../js/utils.js";
import { datePickerInput } from "../js/components/datepicker.js";
import { getCurrentSchool } from "../js/services/auth.service.js";
import { isStarterPlan } from "../js/services/subscription.service.js";
import { renderModuleUpgrade } from "../js/components/module-upgrade.js";
import { buildAttendanceMascotSvg } from "../js/components/mascot.js";
import { copyDeepLink, buildDeepLink } from "../js/services/deep-link.service.js";

export { buildAttendanceMascotSvg };

const CAN_MARK_ANY_CLASS = ["admin", "principal"];

const STATUS_ICONS = {
  present: "check_circle",
  absent: "cancel",
  late: "schedule",
  excused: "event_available",
};

let classes = [];
let settings = null;
let allowedClassKeys = null; // null = unrestricted
let selection = { classKey: "", date: "" };
let roster = [];
let currentStatuses = {}; // studentId -> status

export async function render({ profile, params = {} }) {
  if (isStarterPlan(getCurrentSchool())) {
    return renderModuleUpgrade({
      profile,
      title: "This module is not available for this plan",
      description: "Attendance tracking is reserved for schools on Growth and District plans. Please upgrade your plan to unlock class registers, daily rolls, and term attendance statistics.",
      perks: [
        "Daily Class Registers (Present, Absent, Late, Excused)",
        "Term-wide Student Attendance % & Roster Summaries",
        "Automated Parent Absence Alerts & Dispute Logs",
      ],
      subject: "Upgrade Attendance Module to Growth Plan",
    });
  }

  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.date = selection.date || todayStr();

  // Resolve dynamic deep link parameters
  if (params.grade || params.class) {
    const g = params.grade || params.class;
    selection.classKey = params.stream ? `${g}|${params.stream}` : `${g}|`;
  }
  if (params.date) {
    selection.date = params.date;
  }

  allowedClassKeys = null;
  if (!CAN_MARK_ANY_CLASS.includes(profile.role)) {
    let teacher = null;
    try {
      teacher = await getTeacherByUserId(profile.uid);
    } catch (err) {
      console.warn("attendance: getTeacherByUserId failed:", err);
    }
    if (!teacher && profile.email) {
      try {
        teacher = await getTeacherByEmail(profile.email);
      } catch (err) {
        console.warn("attendance: getTeacherByEmail failed:", err);
      }
    }
    if (profile.role === "class_teacher" && teacher?.homeroom) {
      allowedClassKeys = new Set([teacher.homeroom]);
    } else {
      allowedClassKeys = new Set((teacher?.teachingAssignments || []).map((a) => `${a.grade}|${a.stream || ""}`));
    }
  }

  const wrap = el("div", { class: "attendance-page" });

  // 1. Executive Attendance Hero Banner
  const mascotWrap = el("div", {
    class: "attendance-hero__mascot-wrap",
    style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;",
    "aria-hidden": "true",
  });
  mascotWrap.innerHTML = buildAttendanceMascotSvg({ width: 125, height: 110 });

  const currentYear = settings.currentAcademicYear || new Date().getFullYear();
  const currentTerm = settings.currentTerm || "Term 3";

  const heroBanner = el("div", { class: "attendance-hero" }, [
    el("div", { class: "attendance-hero__content" }, [
      el("div", { class: "attendance-hero__status-row" }, [
        el("div", { class: "attendance-cycle-badge" }, [
          icon("calendar_today", "text-sm"),
          `Active Cycle: ${currentYear} · ${currentTerm}`,
        ]),
        el("div", { class: "attendance-cycle-badge", style: "background:var(--color-cream); color:var(--color-ink);" }, [
          icon("today", "text-sm"),
          `Register Date: ${formatDate(selection.date)}`,
        ]),
      ]),
      el("h1", { class: "attendance-hero__title" }, "Daily Attendance & Roll Call"),
      el("p", { class: "attendance-hero__desc" }, "Record classroom registers, audit learner presence patterns, and track official term attendance statistics."),
      el("div", { class: "attendance-hero__pills" }, [
        el("div", { class: "attendance-pill" }, [icon("school"), `${classes.length} Class Cohorts`]),
        el("div", { class: "attendance-pill" }, [icon("fact_check"), "Real-time Presence Metrics"]),
        el("div", { class: "attendance-pill" }, [icon("touch_app"), "Quick Roll Call Buttons"]),
      ]),
    ]),
    el("div", { class: "attendance-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Mark roll call or export term registers."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 2. Class & Date Selection Card
  const pickerCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  wrap.append(pickerCard);

  // Mounts for Roster Table and Term Summary
  const bodyMount = el("div", { id: "attendance-body-mount" });
  wrap.append(bodyMount);

  const summaryMount = el("div", { id: "attendance-summary-mount", style: "margin-top:var(--sp-4);" });
  wrap.append(summaryMount);

  renderPicker(pickerCard, profile, bodyMount, summaryMount);
  return wrap;
}

function classOptions() {
  const opts = [];
  for (const c of classes) {
    if (!c.streams || c.streams.length === 0) {
      const key = `${c.grade}|`;
      if (allowedClassKeys && !allowedClassKeys.has(key)) continue;
      opts.push({ value: key, label: c.grade });
    } else {
      for (const s of c.streams) {
        const key = `${c.grade}|${s}`;
        if (allowedClassKeys && !allowedClassKeys.has(key)) continue;
        opts.push({ value: key, label: `${c.grade} ${s}` });
      }
    }
  }
  return opts;
}

function renderPicker(container, profile, bodyMount, summaryMount) {
  container.innerHTML = "";
  const opts = classOptions();

  const header = el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;" }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("tune", "text-gold"),
      el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900); font-size:1.05rem;" }, "Roll Call Filter"),
    ]),
    el("div", { style: "display:flex; gap:6px; align-items:center;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm deep-link-btn",
        style: "font-size:11px; padding:2px 8px;",
        title: "Copy direct link to this register",
        onClick: () => {
          const p = {};
          if (selection.classKey) {
            const [g, s] = selection.classKey.split("|");
            p.grade = g;
            if (s) p.stream = s;
          }
          if (selection.date) p.date = selection.date;
          copyDeepLink("/attendance", p, "Attendance register link");
        },
      }, [icon("share", "text-xs"), "Share Link"]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        style: "font-size:11px; padding:2px 8px;",
        onClick: () => {
          selection.date = todayStr();
          const dInput = document.getElementById("a-date");
          if (dInput) dInput.value = selection.date;
          maybeLoad(profile, bodyMount, summaryMount);
        },
      }, "Today"),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        style: "font-size:11px; padding:2px 8px;",
        onClick: () => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          selection.date = d.toISOString().slice(0, 10);
          const dInput = document.getElementById("a-date");
          if (dInput) dInput.value = selection.date;
          maybeLoad(profile, bodyMount, summaryMount);
        },
      }, "Yesterday"),
    ]),
  ]);
  container.append(header);

  const row = el("div", { class: "filter-grid", style: "display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px;" });

  const classSelect = el("select", { id: "a-class" }, [
    el("option", { value: "" }, "Select Class / Stream"),
    ...opts.map((o) => el("option", { value: o.value, ...(o.value === selection.classKey ? { selected: "true" } : {}) }, o.label)),
  ]);

  const datePickerWrap = datePickerInput(
    { id: "a-date", value: selection.date },
    {
      maxDate: "today",
      onChange: (selectedDates, dateStr) => {
        selection.date = dateStr;
        maybeLoad(profile, bodyMount, summaryMount);
      },
    }
  );

  row.append(
    el("div", { class: "field" }, [
      el("label", { for: "a-class", style: "display:flex; align-items:center; gap:6px;" }, [icon("school", "text-xs"), "Class & Stream"]),
      classSelect,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "a-date", style: "display:flex; align-items:center; gap:6px;" }, [icon("event", "text-xs"), "Roll Call Date"]),
      datePickerWrap,
    ])
  );
  container.append(row);

  if (!opts.length) {
    if (!allowedClassKeys) {
      container.append(el("p", { class: "text-muted text-sm", style: "margin-top:8px;" }, "No classes have been set up yet. Go to Academics to add them."));
    } else {
      container.append(el("p", { class: "text-muted text-sm", style: "margin-top:8px;" }, "You have no class assigned. Contact the administrator."));
    }
  }

  if (selection.classKey && selection.date) {
    maybeLoad(profile, bodyMount, summaryMount);
  }

  classSelect.addEventListener("change", () => {
    selection.classKey = classSelect.value;
    maybeLoad(profile, bodyMount, summaryMount);
  });
}

async function maybeLoad(profile, bodyMount, summaryMount) {
  if (!selection.classKey || !selection.date) {
    bodyMount.innerHTML = "";
    summaryMount.innerHTML = "";
    return;
  }
  const [grade, stream] = selection.classKey.split("|");
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows", style: "padding:var(--sp-4);" }, [
    skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "70%"),
  ]));
  summaryMount.innerHTML = "";

  try {
    const [students, existing] = await Promise.all([
      listStudents(),
      getAttendanceForClassDate(grade, stream, selection.date),
    ]);
    roster = students.filter((s) => s.grade === grade && (s.stream || "") === stream && s.status === "active")
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    currentStatuses = { ...(existing?.records || {}) };

    renderRoster(bodyMount, profile);
    renderSummary(summaryMount, grade, stream);
  } catch (err) {
    bodyMount.innerHTML = "";
    bodyMount.append(el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        icon("wifi_off"),
        el("h3", {}, "Could not load data"),
        el("p", { class: "text-muted" }, err.message || "Please check your internet connection and try again."),
      ]),
    ]));
  }
}

function computeKpiMetrics() {
  const total = roster.length;
  let present = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;

  for (const student of roster) {
    const st = currentStatuses[student.id];
    if (st === "present") present++;
    else if (st === "absent") absent++;
    else if (st === "late") late++;
    else if (st === "excused") excused++;
  }

  const attended = present + late;
  const rate = total > 0 ? ((attended / total) * 100).toFixed(1) : "0.0";
  return { total, present, absent, late, excused, rate };
}

function updateKpiBar() {
  const { total, present, absent, late, excused, rate } = computeKpiMetrics();
  const elTotal = document.getElementById("kpi-att-total");
  const elPresent = document.getElementById("kpi-att-present");
  const elAbsent = document.getElementById("kpi-att-absent");
  const elLateExcused = document.getElementById("kpi-att-late-excused");
  const elRate = document.getElementById("kpi-att-rate");

  if (elTotal) elTotal.textContent = `${total} Learners`;
  if (elPresent) elPresent.textContent = `${present}`;
  if (elAbsent) elAbsent.textContent = `${absent}`;
  if (elLateExcused) elLateExcused.textContent = `${late + excused}`;
  if (elRate) elRate.textContent = `${rate}%`;
}

function renderRoster(container, profile) {
  container.innerHTML = "";
  const [grade, stream] = selection.classKey.split("|");

  if (!roster.length) {
    container.append(el("div", { class: "card empty-state", style: "padding:var(--sp-6);" }, [
      icon("school", "text-muted", "style: font-size:42px;"),
      el("h3", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No active learners enrolled in this class"),
      el("p", { class: "text-muted text-sm", style: "margin:0 auto var(--sp-4);" }, "Verify the class assignment and student enrolment under the Students directory."),
    ]));
    return;
  }

  // 1. Live Roll Call KPI Grid
  const { total, present, absent, late, excused, rate } = computeKpiMetrics();
  const kpiGrid = el("div", { class: "attendance-kpi-grid" }, [
    el("div", { class: "attendance-kpi-card" }, [
      el("div", { class: "attendance-kpi-card__head" }, [
        el("span", { class: "attendance-kpi-card__label" }, "Enrolled"),
        icon("groups", "text-primary text-xs"),
      ]),
      el("div", { class: "attendance-kpi-card__val", id: "kpi-att-total" }, `${total} Learners`),
    ]),
    el("div", { class: "attendance-kpi-card" }, [
      el("div", { class: "attendance-kpi-card__head" }, [
        el("span", { class: "attendance-kpi-card__label" }, "Present"),
        icon("check_circle", "text-xs", "style:color:var(--color-green);"),
      ]),
      el("div", { class: "attendance-kpi-card__val attendance-kpi-card__val--green", id: "kpi-att-present" }, `${present}`),
    ]),
    el("div", { class: "attendance-kpi-card" }, [
      el("div", { class: "attendance-kpi-card__head" }, [
        el("span", { class: "attendance-kpi-card__label" }, "Absent"),
        icon("cancel", "text-xs", "style:color:var(--color-red);"),
      ]),
      el("div", { class: "attendance-kpi-card__val attendance-kpi-card__val--red", id: "kpi-att-absent" }, `${absent}`),
    ]),
    el("div", { class: "attendance-kpi-card" }, [
      el("div", { class: "attendance-kpi-card__head" }, [
        el("span", { class: "attendance-kpi-card__label" }, "Late / Excused"),
        icon("schedule", "text-xs", "style:color:var(--color-gold);"),
      ]),
      el("div", { class: "attendance-kpi-card__val attendance-kpi-card__val--amber", id: "kpi-att-late-excused" }, `${late + excused}`),
    ]),
    el("div", { class: "attendance-kpi-card" }, [
      el("div", { class: "attendance-kpi-card__head" }, [
        el("span", { class: "attendance-kpi-card__label" }, "Daily Presence"),
        icon("monitoring", "text-primary text-xs"),
      ]),
      el("div", { class: "attendance-kpi-card__val attendance-kpi-card__val--green", id: "kpi-att-rate" }, `${rate}%`),
    ]),
  ]);
  container.append(kpiGrid);

  // 2. Roster Register Card
  const rosterCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });

  const rosterHeader = el("div", {
    class: "roster-header",
    style: "padding:var(--sp-4); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--color-line);",
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("co_present", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, `${grade} ${stream || ""}`),
        el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${roster.length} Learners`),
      ]),
      el("p", { class: "text-muted text-xs", style: "margin:4px 0 0 0;" }, `${formatDate(selection.date)} · Daily attendance roll`),
    ]),
    el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => markAll(container, "present"),
      }, [icon("done_all", "text-xs"), "Mark All Present"]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => markAll(container, ""),
      }, [icon("restart_alt", "text-xs"), "Clear All"]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: (ev) => handleSave(profile, container, ev.currentTarget),
      }, [icon("save", "text-xs"), "Save Attendance"]),
    ]),
  ]);
  rosterCard.append(rosterHeader);

  // Table
  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "border:none; border-radius:0;" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:130px;" }, "Adm No."),
      el("th", { style: "min-width:200px;" }, "Learner Name"),
      el("th", { class: "col-center", style: "min-width:320px;" }, "Attendance Status"),
    ])),
  ]);

  const tbody = el("tbody", {});
  for (const student of roster) {
    tbody.append(el("tr", { "data-row-for": student.id }, [
      el("td", { "data-label": "Adm No." }, [
        el("span", { class: "text-muted font-mono text-xs", style: "font-weight:600;" }, student.admissionNumber || "—"),
      ]),
      el("td", { "data-label": "Learner Name" }, [
        el("strong", { style: "color:var(--color-primary-900);" }, student.fullName),
      ]),
      el("td", { class: "status-cell", "data-label": "Status" }, buildStatusPills(student.id)),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  rosterCard.append(tableWrap);
  container.append(rosterCard);
}

function buildStatusPills(studentId) {
  const wrap = el("div", { class: "status-pill-group", role: "radiogroup", "data-status-for": studentId });

  for (const s of STATUSES) {
    const isChecked = currentStatuses[studentId] === s.value;
    const input = el("input", {
      type: "radio",
      name: `status-${studentId}`,
      value: s.value,
      ...(isChecked ? { checked: "true" } : {}),
    });

    const pill = el("label", {
      class: `status-pill status-pill--${s.value}${isChecked ? " is-active" : ""}`,
    }, [
      input,
      icon(STATUS_ICONS[s.value] || "check", "text-xs"),
      s.label,
    ]);

    pill.addEventListener("click", () => {
      currentStatuses[studentId] = s.value;
      input.checked = true;

      // Update active classes across all sibling pills in this row
      const siblings = wrap.querySelectorAll(".status-pill");
      siblings.forEach((sib) => sib.classList.remove("is-active"));
      pill.classList.add("is-active");

      // Update KPI strip in real-time
      updateKpiBar();
    });

    wrap.append(pill);
  }
  return wrap;
}

function markAll(container, status) {
  for (const student of roster) {
    if (status) currentStatuses[student.id] = status;
    else delete currentStatuses[student.id];
  }

  const rows = container.querySelectorAll("[data-status-for]");
  for (const wrap of rows) {
    const pills = wrap.querySelectorAll(".status-pill");
    pills.forEach((p) => p.classList.remove("is-active"));

    if (status) {
      const activePill = wrap.querySelector(`.status-pill--${status}`);
      if (activePill) {
        activePill.classList.add("is-active");
        const radio = activePill.querySelector("input[type=radio]");
        if (radio) radio.checked = true;
      }
    } else {
      const radios = wrap.querySelectorAll("input[type=radio]");
      radios.forEach((r) => { r.checked = false; });
    }
  }

  updateKpiBar();

  if (status) {
    toast(`Marked all ${roster.length} learner(s) ${status}. Click Save to commit.`, "info", 2500);
  } else {
    toast(`Cleared attendance status for all learners.`, "info", 2500);
  }
}

async function handleSave(profile, container, button) {
  const [grade, stream] = selection.classKey.split("|");
  const missing = roster.filter((s) => !currentStatuses[s.id]);
  if (missing.length) {
    return toast(`${missing.length} learner(s) still have no status selected. Mark them before saving.`, "error");
  }

  const restore = busyButton(button, "Saving…");
  try {
    await saveAttendance(profile.uid, {
      grade,
      stream,
      date: selection.date,
      academicYear: settings.currentAcademicYear || "",
      term: settings.currentTerm || "",
      records: currentStatuses,
    });
    toast("Attendance successfully saved.", "success");
  } catch (err) {
    toast(err.message || "Could not save attendance.", "error");
  } finally {
    restore();
  }
}

function exportAttendanceCsv(grade, stream, term, academicYear, daysMarked, perStudent) {
  const headers = ["Admission No", "Student Name", "Present Days", "Late Days", "Absent Days", "Excused Days", "Attendance Rate %"];
  const rows = roster.map((student) => {
    const s = perStudent[student.id] || {};
    return [
      `"${student.admissionNumber || "N/A"}"`,
      `"${(student.fullName || "").replace(/"/g, '""')}"`,
      s.present ?? 0,
      s.late ?? 0,
      s.absent ?? 0,
      s.excused ?? 0,
      `"${s.percentage === null || s.percentage === undefined ? "N/A" : s.percentage + "%"}"`,
    ];
  });

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `attendance_${grade}_${stream || "all"}_${term}_${academicYear}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast("Attendance CSV downloaded.", "success");
}

async function renderSummary(container, grade, stream) {
  container.innerHTML = "";
  const academicYear = settings.currentAcademicYear || "";
  const term = settings.currentTerm || "";
  const days = await listAttendanceForClassPeriod(grade, stream, academicYear, term);
  if (!days.length) return;

  const studentIds = roster.map((s) => s.id);
  const { daysMarked, perStudent, classAveragePercentage } = summarizeForRoster(days, studentIds);

  const card = el("div", { class: "card", style: "padding:0; overflow:hidden;" });

  const header = el("div", {
    style: "padding:var(--sp-4); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--color-line);",
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("analytics", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, `${term} ${academicYear} Attendance Summary`),
      ]),
      el("p", { class: "text-muted text-xs", style: "margin:4px 0 0 0;" },
        `${daysMarked} day(s) marked so far · Class Average ${classAveragePercentage ?? "N/A"}%`),
    ]),
    el("div", { style: "display:flex; gap:8px; align-items:center;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => window.print(),
      }, [icon("print", "text-xs"), "Print Register"]),
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        onClick: () => exportAttendanceCsv(grade, stream, term, academicYear, daysMarked, perStudent),
      }, [icon("download", "text-xs"), "Export CSV"]),
    ]),
  ]);
  card.append(header);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive", style: "border:none; border-radius:0;" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Learner Name"),
      el("th", { class: "col-num", style: "width:100px;" }, "Present"),
      el("th", { class: "col-num", style: "width:100px;" }, "Late"),
      el("th", { class: "col-num", style: "width:100px;" }, "Absent"),
      el("th", { class: "col-num", style: "width:100px;" }, "Excused"),
      el("th", { class: "col-num", style: "width:110px;" }, "Rate %"),
    ])),
  ]);

  const tbody = el("tbody", {});
  for (const student of roster) {
    const s = perStudent[student.id] || {};
    const pct = s.percentage;
    const isGood = pct !== null && pct !== undefined && pct >= 80;
    const isWarning = pct !== null && pct !== undefined && pct < 80;

    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Learner Name" }, [
        el("strong", { style: "color:var(--color-primary-900);" }, student.fullName),
      ]),
      el("td", { class: "col-num", "data-label": "Present" }, String(s.present ?? 0)),
      el("td", { class: "col-num", "data-label": "Late" }, String(s.late ?? 0)),
      el("td", { class: "col-num", "data-label": "Absent" }, String(s.absent ?? 0)),
      el("td", { class: "col-num", "data-label": "Excused" }, String(s.excused ?? 0)),
      el("td", { class: "col-num", "data-label": "Rate %" }, [
        el("span", {
          class: `badge ${isGood ? "badge--success" : (isWarning ? "badge--warning" : "badge--neutral")}`,
          style: "font-weight:700; font-size:11px;",
        }, pct === null || pct === undefined ? "N/A" : `${pct}%`),
      ]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  container.append(card);
}

export function init() {}
