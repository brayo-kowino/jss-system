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
import { navigate } from "../js/router.js";

const CAN_MARK_ANY_CLASS = ["admin", "principal"];

let classes = [];
let settings = null;
let allowedClassKeys = null; // null = unrestricted
let selection = { classKey: "", date: "" };
let roster = [];
let currentStatuses = {}; // studentId -> status

function buildSadMascotSvg() {
  return `
    <svg class="sad-mascot-svg" viewBox="0 0 240 220" width="220" height="200" xmlns="http://www.w3.org/2000/svg">
      <ellipse class="sad-mascot__shadow" cx="120" cy="208" rx="60" ry="8" fill="rgba(20, 83, 138, 0.15)" />
      <g class="sad-mascot__body">
        <g class="sad-mascot__books">
          <rect x="62" y="186" width="116" height="15" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="66" y="189" width="108" height="2" fill="#93C5FD" opacity="0.8" />
          <rect x="68" y="172" width="104" height="15" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="72" y="175" width="96" height="2" fill="#FDE68A" opacity="0.9" />
          <rect x="74" y="158" width="92" height="15" rx="3" fill="#B91C1C" stroke="#7F1D1D" stroke-width="1.2" />
          <rect x="78" y="161" width="84" height="2" fill="#FECACA" opacity="0.8" />
        </g>
        <path class="sad-mascot__robe" d="M92,126 C86,145 84,158 88,164 L152,164 C156,158 154,145 148,126 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <path d="M106,126 L120,154 L134,126 L127,126 L120,142 L113,126 Z" fill="#C9A227" />
        <path d="M92,130 C82,142 82,154 98,158" stroke="#14538A" stroke-width="7" stroke-linecap="round" fill="none" />
        <path d="M148,130 C158,142 158,154 142,158" stroke="#14538A" stroke-width="7" stroke-linecap="round" fill="none" />
        <circle cx="98" cy="158" r="5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        <circle cx="142" cy="158" r="5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        <circle class="sad-mascot__head" cx="120" cy="95" r="33" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="97" cy="103" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
        <ellipse cx="143" cy="103" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
        <path d="M98,78 Q106,83 113,81" stroke="#8C6F12" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <path d="M142,78 Q134,83 127,81" stroke="#8C6F12" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <ellipse cx="107" cy="94" rx="7.5" ry="9" fill="#FFFFFF" stroke="#14538A" stroke-width="1.5" />
        <ellipse cx="133" cy="94" rx="7.5" ry="9" fill="#FFFFFF" stroke="#14538A" stroke-width="1.5" />
        <circle cx="107" cy="96" r="4.8" fill="#1F2937" />
        <circle cx="133" cy="96" r="4.8" fill="#1F2937" />
        <circle cx="105.5" cy="93.5" r="2" fill="#FFFFFF" />
        <circle cx="108.5" cy="98" r="0.9" fill="#FFFFFF" />
        <circle cx="131.5" cy="93.5" r="2" fill="#FFFFFF" />
        <circle cx="134.5" cy="98" r="0.9" fill="#FFFFFF" />
        <path d="M99,90 Q107,87 115,93" stroke="#C9A227" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M141,90 Q133,87 125,93" stroke="#C9A227" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path class="sad-mascot__mouth" d="M112,114 Q120,107 128,114" stroke="#8C6F12" stroke-width="2.6" stroke-linecap="round" fill="none" />
        <path class="sad-mascot__tear" d="M138,100 C138,100 142,107 142,110 C142,112.2 140.2,114 138,114 C135.8,114 134,112.2 134,110 C134,107 138,100 138,100 Z" fill="#60A5FA" opacity="0.95" />
        <g class="sad-mascot__cap" transform="rotate(-9 120 62)">
          <rect x="104" y="60" width="32" height="15" rx="5" fill="#8C6F12" />
          <polygon points="120,38 168,54 120,66 72,54" fill="#C9A227" stroke="#8C6F12" stroke-width="1.6" />
          <circle cx="120" cy="52" r="3.5" fill="#FAF6F0" />
          <path d="M120,52 C138,56 150,70 146,88" stroke="#FAF6F0" stroke-width="2" fill="none" />
          <circle cx="146" cy="89" r="3" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

function renderStarterUpgrade(profile) {
  const wrap = el("div", { class: "attendance-locked-view" });
  
  const mascotWrap = el("div", { class: "sad-mascot-wrap", "aria-hidden": "true" });
  mascotWrap.innerHTML = buildSadMascotSvg();

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const perks = el("div", { class: "upgrade-perks" }, [
    el("div", { class: "upgrade-perk" }, [icon("check_circle"), el("span", {}, "Daily Class Registers (Present, Absent, Late, Excused)")]),
    el("div", { class: "upgrade-perk" }, [icon("check_circle"), el("span", {}, "Term-wide Student Attendance % & Roster Summaries")]),
    el("div", { class: "upgrade-perk" }, [icon("check_circle"), el("span", {}, "Automated Parent Absence Alerts & Dispute Logs")]),
  ]);

  const actions = el("div", { class: "upgrade-actions" });
  if (isAdmin) {
    actions.append(
      el("button", {
        class: "btn btn--primary",
        onClick: () => navigate("/school-settings")
      }, [icon("upgrade"), "Upgrade to Growth Plan"]),
      el("a", {
        class: "btn btn--ghost",
        href: "mailto:iskify360.tech@gmail.com?subject=Upgrade%20Attendance%20Module%20to%20Growth%20Plan",
        target: "_blank"
      }, [icon("mail"), "Contact Us to Upgrade"])
    );
  } else {
    actions.append(
      el("button", {
        class: "btn btn--ghost",
        onClick: () => navigate("/dashboard")
      }, [icon("dashboard"), "Back to Dashboard"])
    );
  }

  const card = el("div", { class: "module-upgrade-card" }, [
    mascotWrap,
    el("span", { class: "badge badge--warning", style: "margin-bottom:12px; font-size:11px;" }, "Starter Plan"),
    el("h2", { style: "margin: 0 0 10px; font-size: var(--fs-xl); color: var(--color-primary-900);" }, "This module is not available for this plan"),
    el("p", { class: "text-muted", style: "max-width: 480px; margin: 0 auto 16px; font-size: var(--fs-sm); line-height: 1.6;" },
      "Attendance tracking is reserved for schools on Growth and District plans. Please upgrade your plan to unlock class registers, daily rolls, and term attendance statistics."
    ),
    perks,
    !isAdmin ? el("p", { class: "text-xs text-muted", style: "font-style:italic; margin-bottom:16px;" }, "Please contact your school administrator to upgrade your school's plan.") : "",
    actions
  ]);

  wrap.append(card);
  return wrap;
}

export async function render({ profile }) {
  if (isStarterPlan(getCurrentSchool())) {
    return renderStarterUpgrade(profile);
  }

  [classes, settings] = await Promise.all([listClasses(), getSchoolSettings()]);
  selection.date = selection.date || todayStr();

  allowedClassKeys = null;
  if (!CAN_MARK_ANY_CLASS.includes(profile.role)) {
    const teacher = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    allowedClassKeys = new Set((teacher?.classAssignments || []).map((a) => `${a.grade}|${a.stream || ""}`));
  }

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
    ])
  );

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const bodyMount = el("div", { style: "margin-top:16px;" });
  wrap.append(bodyMount);
  const summaryMount = el("div", { style: "margin-top:16px;" });
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
  const row = el("div", { class: "field-row" });

  const classSelect = el("select", { id: "a-class" }, [
    el("option", { value: "" }, "Select class"),
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
    el("div", { class: "field" }, [el("label", {}, "Class"), classSelect]),
    el("div", { class: "field" }, [el("label", {}, "Date"), datePickerWrap])
  );
  container.append(row);

  if (!opts.length) {
    if (!allowedClassKeys) {
      container.append(el("p", { class: "text-muted" }, "No classes with streams have been set up yet. Go to Academics to add them."));
    } else {
      container.append(el("p", { class: "text-muted" }, "You have no class assigned. Contact the administrator."));
    }
  }

  // Same reasoning as Marks Entry: a retained class/date from a previous
  // visit pre-fills the controls above via `selected`/`value`, but that
  // alone never fires a `change` event, so maybeLoad() (only ever called
  // from the listeners below) never ran on return - leaving the roster
  // blank until you picked a genuinely different value. Load once here
  // when the selection is already complete.
  if (selection.classKey && selection.date) {
    maybeLoad(profile, bodyMount, summaryMount);
  }

  classSelect.addEventListener("change", () => { selection.classKey = classSelect.value; maybeLoad(profile, bodyMount, summaryMount); });
}

async function maybeLoad(profile, bodyMount, summaryMount) {
  if (!selection.classKey || !selection.date) {
    bodyMount.innerHTML = "";
    summaryMount.innerHTML = "";
    return;
  }
  const [grade, stream] = selection.classKey.split("|");
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
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
        el("p", { class: "text-muted" }, err.message || "Please check your internet connection and try again.")
      ])
    ]));
  }
}

function renderRoster(container, profile) {
  container.innerHTML = "";
  const [grade, stream] = selection.classKey.split("|");

  const infoCard = el("div", { class: "card roster-header" });
  infoCard.append(
    el("div", {}, [
      el("h3", { style: "margin:0 0 4px;" }, `${grade} ${stream}`),
      el("p", { class: "text-muted", style: "margin:0;" }, `${formatDate(selection.date)} · ${roster.length} student(s)`),
    ]),
    el("div", { class: "roster-header__actions" }, [
      el("button", { class: "btn btn--ghost btn--sm", onClick: () => markAll(container, "present") }, [icon("done_all"), "Mark all present"]),
      el("button", { class: "btn btn--primary btn--sm", onClick: (ev) => handleSave(profile, container, ev.currentTarget) }, [icon("save"), "Save Attendance"]),
    ])
  );
  container.append(infoCard);

  if (!roster.length) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No active students in this class"),
      el("p", {}, "Check the class roster under Students."),
    ]));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Status")])),
  ]);
  const tbody = el("tbody", {});
  for (const student of roster) {
    tbody.append(el("tr", { "data-row-for": student.id }, [
      el("td", { "data-label": "Adm No." }, student.admissionNumber || "N/A"),
      el("td", { "data-label": "Name" }, student.fullName),
      el("td", { class: "status-cell", "data-label": "Status" }, buildStatusRadios(student.id)),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function buildStatusRadios(studentId) {
  const wrap = el("div", { class: "status-options", role: "radiogroup", "data-status-for": studentId });
  for (const s of STATUSES) {
    const input = el("input", {
      type: "radio",
      name: `status-${studentId}`,
      value: s.value,
      ...(currentStatuses[studentId] === s.value ? { checked: "true" } : {}),
    });
    input.addEventListener("change", () => {
      currentStatuses[studentId] = s.value;
    });
    const label = el("label", { class: `status-option status-option--${s.value}` }, [input, s.label]);
    wrap.append(label);
  }
  return wrap;
}

function markAll(container, status) {
  for (const student of roster) currentStatuses[student.id] = status;
  const rows = container.querySelectorAll("[data-status-for]");
  for (const wrap of rows) {
    for (const input of wrap.querySelectorAll("input[type=radio]")) {
      input.checked = input.value === status;
    }
  }
  toast(`Marked all ${roster.length} student(s) present. Click Save to store it.`, "info");
}

async function handleSave(profile, container, button) {
  const [grade, stream] = selection.classKey.split("|");
  const missing = roster.filter((s) => !currentStatuses[s.id]);
  if (missing.length) {
    return toast(`${missing.length} student(s) still have no status selected.`, "error");
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
    toast("Attendance saved.", "success");
  } catch (err) {
    toast(err.message || "Could not save attendance.", "error");
  } finally {
    restore();
  }
}

async function renderSummary(container, grade, stream) {
  container.innerHTML = "";
  const academicYear = settings.currentAcademicYear || "";
  const term = settings.currentTerm || "";
  const days = await listAttendanceForClassPeriod(grade, stream, academicYear, term);
  if (!days.length) return;

  const studentIds = roster.map((s) => s.id);
  const { daysMarked, perStudent, classAveragePercentage } = summarizeForRoster(days, studentIds);

  const card = el("div", { class: "card" });
  card.append(
    el("h3", { style: "margin:0 0 4px;" }, `${term} ${academicYear} Attendance Summary`),
    el("p", { class: "text-muted", style: "margin:0 0 16px;" },
      `${daysMarked} day(s) marked so far · class average ${classAveragePercentage ?? "N/A"}%`)
  );

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Name"), el("th", {}, "Present"), el("th", {}, "Late"), el("th", {}, "Absent"), el("th", {}, "Excused"), el("th", {}, "%"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const student of roster) {
    const s = perStudent[student.id] || {};
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Name" }, student.fullName),
      el("td", { "data-label": "Present" }, String(s.present ?? 0)),
      el("td", { "data-label": "Late" }, String(s.late ?? 0)),
      el("td", { "data-label": "Absent" }, String(s.absent ?? 0)),
      el("td", { "data-label": "Excused" }, String(s.excused ?? 0)),
      el("td", { "data-label": "%" }, s.percentage === null || s.percentage === undefined ? "N/A" : `${s.percentage}%`),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  container.append(card);
}

export function init() {}
