import { listClasses, listSubjects, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { listAssessments, setAssessmentStatus, getAssessmentMaxScore } from "../js/services/assessment.service.js";
import { getTeacherByUserId, getTeacherByEmail } from "../js/services/teacher.service.js";
import { listStudents } from "../js/services/student.service.js";
import { listMarks, bulkUpsertMarks } from "../js/services/marks.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, skeleton, busyButton } from "../js/utils.js";

const CAN_MANAGE = ["admin", "academic_master"];

let classes = [];
let allSubjects = [];
let allAssessments = [];
let allowedSubjectCodes = null; // null = unrestricted (admin/academic_master)
let selection = { classKey: "", subjectCode: "", assessmentId: "" };
let loadedSelection = { classKey: "", subjectCode: "", assessmentId: "" };
let roster = []; // students in the selected class
let marksByStudent = {}; // studentId -> mark doc
let dirty = new Set();
let pendingValues = {};
let currentProfile = null;

const AUTO_SAVE_INTERVAL_MS = 7000;
let autoSaveTimer = null;
let autoSaveToastShown = false;

/**
 * Contextual help tooltip using dark-slate bubble styling.
 */
function infoTooltip(title, text, align = "center") {
  const alignClass = align === "right" ? " tooltip-bubble--right" : (align === "left" ? " tooltip-bubble--left" : "");
  return el("span", {
    class: "tooltip-wrap tooltip-wrap--inline",
    tabindex: "0",
    role: "button",
    "aria-label": title,
  }, [
    el("span", { class: "tooltip-trigger-icon material-symbols-rounded" }, "help"),
    el("span", { class: `tooltip-bubble tooltip-bubble--wide${alignClass}`, role: "tooltip" }, [
      el("span", { class: "tooltip-bubble__title" }, [
        icon("info"),
        title,
      ]),
      el("span", { class: "tooltip-bubble__text" }, text),
    ]),
  ]);
}

/**
 * Dynamic Teacher / Grading Master mascot with scorecard clipboard and red grading pen.
 */
export function buildMarksMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="marks-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Marks Entry Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Scorecard Clipboard -->
        <g class="marks-mascot__clipboard">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Clipboard Backing -->
          <rect x="54" y="122" width="30" height="36" rx="3" fill="#9A3412" stroke="#7C2D12" stroke-width="1.2" transform="rotate(-6 69 140)" />
          <!-- Paper Sheet -->
          <rect x="57" y="125" width="24" height="30" rx="2" fill="#FFFFFF" transform="rotate(-6 69 140)" />
          <!-- Clip on top -->
          <rect x="63" y="121" width="12" height="5" rx="1.5" fill="#C9A227" transform="rotate(-6 69 140)" />
          <!-- Checklist Items with Green Ticks -->
          <line x1="60" y1="131" x2="74" y2="129.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <line x1="60" y1="137" x2="75" y2="135.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <line x1="60" y1="143" x2="72" y2="141.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <line x1="60" y1="149" x2="76" y2="147.5" stroke="#64748B" stroke-width="1.2" stroke-linecap="round" />
          <!-- Hand Holding Clipboard -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Floating A+ Grade Badge (Animated) -->
        <g class="marks-mascot__badge">
          <circle cx="68" cy="116" r="10" fill="#059669" stroke="#FFFFFF" stroke-width="1.5" />
          <text x="68" y="120" fill="#FFFFFF" font-size="9" font-weight="900" font-family="system-ui, sans-serif" text-anchor="middle">A+</text>
        </g>

        <!-- Right Arm Holding Red Grading Pen (Animated) -->
        <g class="marks-mascot__pen">
          <path d="M136,128 C146,132 152,122 148,112" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="148" cy="112" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Red Pen -->
          <line x1="148" y1="112" x2="166" y2="82" stroke="#DC2626" stroke-width="3" stroke-linecap="round" />
          <polygon points="166,82 168,78 163,80" fill="#C9A227" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

// ------------------------------------------------------------------ Render --

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  currentProfile = profile;
  startAutoSaveLoop();
  [classes, allSubjects, allAssessments] = await Promise.all([listClasses(), listSubjects(), listAssessments()]);

  allowedSubjectCodes = null;
  if (!CAN_MANAGE.includes(profile.role)) {
    const teacher = (await getTeacherByUserId(profile.uid)) || (await getTeacherByEmail(profile.email));
    allowedSubjectCodes = new Set(teacher?.subjectCodes || []);
  }

  const wrap = el("div", { class: "marks-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildMarksMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "marks-hero" }, [
    el("div", { class: "marks-hero__content" }, [
      el("h1", { class: "marks-hero__title" }, "Student Marks Entry"),
      el("p", { class: "marks-hero__desc" }, "Record and audit student assessment marks with real-time validation and background auto-save."),
      el("div", { class: "marks-hero__pills" }, [
        el("div", { class: "marks-pill" }, [icon("school"), `${classes.length} Classes Available`]),
        el("div", { class: "marks-pill" }, [icon("assignment"), `${allAssessments.length} Assessments Configured`]),
      ]),
    ]),

    // Mascot & Speech Bubble
    el("div", { class: "marks-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Select class, subject, and assessment to record marks."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Picker Filter Card
  const pickerCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  wrap.append(pickerCard);

  // Mount point for roster or welcome disclaimers
  const bodyMount = el("div", { id: "marks-body-mount" });
  wrap.append(bodyMount);

  renderPicker(pickerCard, profile, bodyMount);
  return wrap;
}

function classOptions() {
  const opts = [];
  for (const c of classes) {
    if (!c.streams || c.streams.length === 0) {
      opts.push({ value: `${c.grade}|`, label: c.grade });
    } else {
      for (const s of c.streams) {
        opts.push({ value: `${c.grade}|${s}`, label: `${c.grade} ${s}` });
      }
    }
  }
  return opts;
}

function renderPicker(container, profile, bodyMount) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-grid" });

  const classSelect = el("select", { id: "m-class" }, [
    el("option", { value: "" }, "Select class"),
    ...classOptions().map((o) => el("option", { value: o.value, ...(o.value === selection.classKey ? { selected: "true" } : {}) }, o.label)),
  ]);

  const subjectChoices = allSubjects.filter((s) => !allowedSubjectCodes || allowedSubjectCodes.has(s.code));
  const subjectSelect = el("select", { id: "m-subject" }, [
    el("option", { value: "" }, "Select subject"),
    ...subjectChoices.map((s) => el("option", { value: s.code, ...(s.code === selection.subjectCode ? { selected: "true" } : {}) }, s.name)),
  ]);

  const assessmentSelect = el("select", { id: "m-assessment" }, [el("option", { value: "" }, "Select assessment")]);

  row.append(
    el("div", { class: "field" }, [
      el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("school", "text-xs"), "Class & Stream"]),
      classSelect,
    ]),
    el("div", { class: "field" }, [
      el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("menu_book", "text-xs"), "Subject"]),
      subjectSelect,
    ]),
    el("div", { class: "field" }, [
      el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("assignment", "text-xs"), "Assessment"]),
      assessmentSelect,
    ])
  );
  container.append(row);

  if (!subjectChoices.length) {
    const emptyNotice = el("div", {
      class: "callout callout--warning",
      style: "margin-top:var(--sp-3); padding:10px 14px; font-size:var(--fs-xs);",
    }, [
      icon("warning", "text-amber"),
      el("span", {}, !allowedSubjectCodes
        ? "No subjects have been configured yet. Visit Academics > Subjects to add them."
        : "You currently have no subjects assigned to your teaching account. Contact the school administrator to assign your classes and subjects."),
    ]);
    container.append(emptyNotice);
  }

  function refreshAssessmentOptions() {
    const grade = classSelect.value.split("|")[0] || "";
    const subjectCode = subjectSelect.value || "";
    assessmentSelect.innerHTML = "";
    assessmentSelect.append(el("option", { value: "" }, "Select assessment"));
    const relevant = allAssessments.filter(
      (a) =>
        (!grade || !a.grades?.length || a.grades.includes(grade)) &&
        (!subjectCode || !a.subjects?.length || a.subjects.includes(subjectCode))
    );
    if (selection.assessmentId && !relevant.some((a) => a.id === selection.assessmentId)) {
      selection.assessmentId = "";
    }
    for (const a of relevant) {
      assessmentSelect.append(
        el("option", { value: a.id, ...(a.id === selection.assessmentId ? { selected: "true" } : {}) },
          `${a.name} (${a.term || "N/A"} ${a.academicYear || ""})${a.status === "locked" ? " [Locked]" : ""}`)
      );
    }
  }
  refreshAssessmentOptions();

  // If selection is already complete, load roster; otherwise show welcome disclaimers
  if (selection.classKey && selection.subjectCode && selection.assessmentId) {
    maybeLoad(profile, bodyMount);
  } else {
    renderWelcomeDisclaimers(bodyMount);
  }

  classSelect.addEventListener("change", () => {
    selection.classKey = classSelect.value;
    refreshAssessmentOptions();
    maybeLoad(profile, bodyMount);
  });
  subjectSelect.addEventListener("change", () => {
    selection.subjectCode = subjectSelect.value;
    refreshAssessmentOptions();
    maybeLoad(profile, bodyMount);
  });
  assessmentSelect.addEventListener("change", () => {
    selection.assessmentId = assessmentSelect.value;
    maybeLoad(profile, bodyMount);
  });
}

/**
 * Renders guided step instructions and essential disclaimers when no class is selected yet.
 */
function renderWelcomeDisclaimers(container) {
  container.innerHTML = "";

  const welcomeCard = el("div", { class: "marks-welcome-card" }, [
    el("div", { class: "marks-welcome-header" }, [
      icon("edit_note", "text-gold", "style: font-size:36px;"),
      el("h3", {}, "Ready to Enter Student Marks?"),
      el("p", {}, "Use the 3 dropdowns above to select a Class, Subject, and Assessment to populate the active student roster."),
    ]),

    // 3 Step Guide
    el("div", { class: "marks-steps-row" }, [
      el("div", { class: "marks-step-item" }, [
        el("span", { class: "marks-step-number" }, "1"),
        el("div", { class: "marks-step-text" }, [
          el("strong", {}, "Select Class"),
          el("span", {}, "Pulls active enrolled learners"),
        ]),
      ]),
      el("div", { class: "marks-step-item" }, [
        el("span", { class: "marks-step-number" }, "2"),
        el("div", { class: "marks-step-text" }, [
          el("strong", {}, "Select Subject"),
          el("span", {}, "Filters assigned curriculum"),
        ]),
      ]),
      el("div", { class: "marks-step-item" }, [
        el("span", { class: "marks-step-number" }, "3"),
        el("div", { class: "marks-step-text" }, [
          el("strong", {}, "Select Assessment"),
          el("span", {}, "Applies test Max Score & weight"),
        ]),
      ]),
    ]),

    // Important Operational Disclaimers Grid
    el("div", { class: "marks-disclaimers-grid" }, [
      el("div", { class: "marks-disclaimer-card marks-disclaimer-card--info" }, [
        el("div", { class: "marks-disclaimer-title" }, [
          icon("rule", "text-primary"),
          "Score Range Validation",
        ]),
        el("p", { class: "marks-disclaimer-body" }, "Entered scores must be between 0 and the configured Max Score for the assessment. Decimal values (e.g. 27.5) are supported."),
      ]),
      el("div", { class: "marks-disclaimer-card marks-disclaimer-card--success" }, [
        el("div", { class: "marks-disclaimer-title" }, [
          icon("cloud_sync", "style: color:#059669;"),
          "7-Second Auto-Save Loop",
        ]),
        el("p", { class: "marks-disclaimer-body" }, "Marks auto-save in the background every 7 seconds. Unsaved edits display a gold badge. Ensure network connectivity before navigating away."),
      ]),
      el("div", { class: "marks-disclaimer-card marks-disclaimer-card--warning" }, [
        el("div", { class: "marks-disclaimer-title" }, [
          icon("lock", "style: color:#d97706;"),
          "Locked Assessments are Read-Only",
        ]),
        el("p", { class: "marks-disclaimer-body" }, "When an assessment is locked by school administrators, marks are frozen to safeguard report cards. Only administrators can unlock them."),
      ]),
      el("div", { class: "marks-disclaimer-card marks-disclaimer-card--danger" }, [
        el("div", { class: "marks-disclaimer-title" }, [
          icon("content_paste", "style: color:#dc2626;"),
          "Bulk Paste Formatting",
        ]),
        el("p", { class: "marks-disclaimer-body" }, "Paste scores in bulk as 'AdmissionNumber, Score' on each line. Verify admission numbers match enrolled students before saving."),
      ]),
    ]),
  ]);

  container.append(welcomeCard);
}

// ------------------------------------------------------------------ Loading --

async function maybeLoad(profile, bodyMount) {
  await flushDirtyMarks();

  const { classKey, subjectCode, assessmentId } = selection;
  if (!classKey || !subjectCode || !assessmentId) {
    renderWelcomeDisclaimers(bodyMount);
    return;
  }
  const [grade, stream] = classKey.split("|");
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows", style: "padding:var(--sp-4);" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
  ]));

  try {
    const [students, marks] = await Promise.all([listStudents(), listMarks(assessmentId, subjectCode)]);
    roster = students.filter((s) => s.grade === grade && (s.stream || "") === stream && s.status === "active")
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
    marksByStudent = {};
    for (const m of marks) marksByStudent[m.studentId] = m;
    dirty.clear();
    pendingValues = {};
    loadedSelection = { classKey, subjectCode, assessmentId };

    renderRoster(bodyMount, profile);
  } catch (err) {
    bodyMount.innerHTML = "";
    bodyMount.append(el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        icon("wifi_off"),
        el("h3", {}, "Could not load data"),
        el("p", { class: "text-muted text-sm" }, err.message || "Please check your internet connection and try again.")
      ])
    ]));
  }
}

// ------------------------------------------------------------------ Roster --

function renderRoster(container, profile) {
  container.innerHTML = "";
  const assessment = allAssessments.find((a) => a.id === selection.assessmentId);
  const subject = allSubjects.find((s) => s.code === selection.subjectCode);
  const locked = assessment?.status === "locked";
  const canManage = CAN_MANAGE.includes(profile.role);

  const maxScore = getAssessmentMaxScore(assessment, selection.subjectCode);
  const isDirect = (assessment?.contributionMode || "weighted") === "direct";

  // Card wrapper
  const rosterCard = el("div", { class: "marks-roster-card" });

  // Roster Header
  const header = el("div", { class: "marks-roster-header" }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("assignment_turned_in", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, `${assessment?.name || ""}: ${subject?.name || ""}`),
        el("span", { class: `badge badge--${locked ? "danger" : "success"}`, style: "font-weight:700; font-size:11px;" }, locked ? "Locked (Read-Only)" : "Open for Entry"),
      ]),
      el("p", { class: "text-muted text-xs", style: "margin:4px 0 0 0;" }, [
        `Marked out of ${maxScore} · `,
        isDirect ? "Direct score addition" : `Weight ${assessment?.weight ?? "N/A"}%`,
        ` · ${roster.length} student(s) in roster`,
      ]),
    ]),
    el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap;" }, [
      el("span", {
        style: "display:inline-flex; align-items:center; gap:4px; font-size:11px; color:#059669; font-weight:600; margin-right:4px;",
      }, [
        el("span", { style: "width:8px; height:8px; border-radius:50%; background:#10b981; display:inline-block;" }),
        "Auto-Save Protected",
      ]),
      ...(canManage ? [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: () => toggleLock(profile, assessment, container),
        }, [icon(locked ? "lock_open" : "lock", "text-xs"), locked ? "Reopen" : "Lock"]),
      ] : []),
      ...(!locked ? [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: () => openBulkPaste(container),
        }, [icon("content_paste", "text-xs"), "Paste Bulk Scores"]),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: (e) => saveAllDirty(profile, e.currentTarget),
        }, [icon("save", "text-xs"), "Save All Now"]),
      ] : []),
    ]),
  ]);
  rosterCard.append(header);

  // Active Disclaimer / Warning Callout Banner
  const disclaimerBanner = el("div", {
    style: "padding:10px 16px; font-size:var(--fs-xs); display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--color-line);",
    class: locked ? "callout--danger" : "callout--info",
  }, [
    icon(locked ? "lock" : "info", locked ? "text-red" : "text-primary"),
    el("span", {}, locked
      ? "Notice: This assessment is LOCKED. All scores are frozen for report card generation and cannot be modified without administrator reopen."
      : `Instructions: Enter scores between 0 and ${maxScore}. The table auto-saves pending changes every 7 seconds. Click 'Save All Now' anytime to save immediately.`),
  ]);
  rosterCard.append(disclaimerBanner);

  if (!roster.length) {
    rosterCard.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("groups", "empty-state__icon"),
      el("h4", { style: "color:var(--color-primary-900);" }, "No active students enrolled in this class"),
      el("p", { class: "text-muted text-sm" }, "Check student enrollments under Students to register learners for this class."),
    ]));
    container.append(rosterCard);
    return;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", { class: "marks-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:130px;" }, "Adm No."),
      el("th", { style: "min-width:200px;" }, "Student Name"),
      el("th", { class: "col-num", style: "width:160px;" }, `Score (Max ${maxScore})`),
      el("th", { class: "col-num", style: "width:110px;" }, isDirect ? "Added" : "Score %"),
      el("th", { class: "col-center", style: "width:130px;" }, "Save Status"),
    ])),
  ]);

  const formatHint = (score) => (isDirect ? `+${Number(score).toFixed(1)}` : `${((Number(score) / maxScore) * 100).toFixed(1)}%`);
  const tbody = el("tbody", {});

  let enteredCount = 0;
  let scoreSum = 0;
  let topScore = 0;

  for (const student of roster) {
    const existing = marksByStudent[student.id];
    if (existing?.score != null && existing?.score !== "") {
      enteredCount++;
      const num = Number(existing.score);
      if (!Number.isNaN(num)) {
        scoreSum += num;
        if (num > topScore) topScore = num;
      }
    }

    const input = el("input", {
      type: "number",
      min: "0",
      max: String(maxScore),
      step: "0.5",
      "data-student-id": student.id,
      value: existing?.score ?? "",
      class: "marks-score-input",
      placeholder: "—",
      ...(locked ? { disabled: "true" } : {}),
    });

    const pctCell = el(
      "span",
      {
        style: "font-family:var(--font-mono, monospace); font-weight:600; color:var(--color-primary-900);",
        id: `pct-${student.id}`,
      },
      existing != null && existing?.score !== "" ? formatHint(existing.score) : "—"
    );

    const statusCell = el(
      "span",
      {
        class: `badge badge--${existing ? "success" : "muted"}`,
        id: `status-${student.id}`,
        style: "font-size:11px; font-weight:600;",
      },
      existing ? "Saved" : "Not entered"
    );

    input.addEventListener("input", () => {
      const rawVal = input.value.trim();
      const n = Number(rawVal);

      // Over-max validation check & disclaimer
      if (rawVal !== "" && !Number.isNaN(n) && (n > maxScore || n < 0)) {
        input.classList.add("marks-score-input--invalid");
        statusCell.className = "badge badge--danger";
        statusCell.textContent = n > maxScore ? `Exceeds ${maxScore}` : "Below 0";
        pctCell.textContent = "Invalid";
        return;
      }

      input.classList.remove("marks-score-input--invalid");
      dirty.add(student.id);
      pendingValues[student.id] = rawVal;
      statusCell.className = "badge badge--gold";
      statusCell.textContent = "Unsaved";
      pctCell.textContent = rawVal !== "" && !Number.isNaN(n) ? formatHint(n) : "—";
    });

    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Adm No." }, [
        el("span", {
          style: "font-family:var(--font-mono, monospace); font-weight:600; font-size:var(--fs-xs); color:var(--color-ink-soft); background:var(--color-cream-dim); padding:2px 8px; border-radius:var(--radius-sm);",
        }, student.admissionNumber || "—"),
      ]),
      el("td", { "data-label": "Student Name" }, [
        el("strong", { style: "color:var(--color-primary-900);" }, student.fullName),
      ]),
      el("td", { class: "col-num", "data-label": `Score / ${maxScore}` }, [
        el("div", { class: "marks-score-input-wrap", style: "justify-content:flex-end;" }, [
          input,
          el("span", { class: "text-muted text-xs", style: "font-family:var(--font-mono, monospace);" }, `/${maxScore}`),
        ]),
      ]),
      el("td", { class: "col-num", "data-label": isDirect ? "Added" : "%" }, pctCell),
      el("td", { class: "col-center", "data-label": "Status" }, statusCell),
    ]));
  }

  table.append(tbody);
  tableWrap.append(table);
  rosterCard.append(tableWrap);

  // Statistics Footer Bar
  const classAvgPct = enteredCount > 0 ? ((scoreSum / (enteredCount * maxScore)) * 100).toFixed(1) : "0.0";
  const summaryBar = el("div", { class: "marks-roster-summary-bar" }, [
    el("div", {}, [
      el("strong", { style: "color:var(--color-primary-900);" }, `Recorded: ${enteredCount} of ${roster.length} students`),
      el("span", { class: "text-muted text-xs", style: "margin-left:8px;" }, `(${roster.length ? Math.round((enteredCount / roster.length) * 100) : 0}% complete)`),
    ]),
    el("div", { style: "display:flex; gap:16px;" }, [
      el("span", {}, [
        el("span", { class: "text-muted" }, "Class Average: "),
        el("strong", { style: "color:var(--color-primary-900); font-family:var(--font-mono, monospace);" }, `${classAvgPct}%`),
      ]),
      el("span", {}, [
        el("span", { class: "text-muted" }, "Highest Score: "),
        el("strong", { style: "color:#059669; font-family:var(--font-mono, monospace);" }, `${topScore} / ${maxScore}`),
      ]),
    ]),
  ]);
  rosterCard.append(summaryBar);

  container.append(rosterCard);
}

// -------------------------------------------------------------- Auto-save --

function startAutoSaveLoop() {
  if (autoSaveTimer) return;
  autoSaveTimer = setInterval(() => {
    flushDirtyMarks().catch(() => {});
  }, AUTO_SAVE_INTERVAL_MS);
}

async function flushDirtyMarks() {
  if (!dirty.size || !currentProfile) return;
  const { classKey, subjectCode, assessmentId } = loadedSelection;
  if (!classKey || !subjectCode || !assessmentId) return;

  const assessment = allAssessments.find((a) => a.id === assessmentId);
  if (assessment?.status === "locked") return;

  const [grade, stream] = classKey.split("|");
  const maxScore = getAssessmentMaxScore(assessment, subjectCode);
  const ids = Array.from(dirty).filter((id) => pendingValues[id] !== undefined);
  if (!ids.length) return;

  // Verify none exceed max score before bulk saving
  const validIds = [];
  for (const id of ids) {
    const val = Number(pendingValues[id]);
    if (!Number.isNaN(val) && (val > maxScore || val < 0)) {
      markBadge(id, "badge--danger", val > maxScore ? `Exceeds ${maxScore}` : "Below 0");
    } else {
      validIds.push(id);
      markBadge(id, "badge--muted", "Saving…");
    }
  }
  if (!validIds.length) return;

  try {
    const entries = validIds.map((studentId) => ({ studentId, grade, stream, score: pendingValues[studentId], maxScore }));
    const results = await bulkUpsertMarks(currentProfile.uid, assessmentId, subjectCode, entries);
    const failedIds = new Set((results.failed || []).map((f) => f.studentId));
    for (const id of validIds) {
      if (failedIds.has(id)) {
        markBadge(id, "badge--danger", "Retry pending");
        continue;
      }
      dirty.delete(id);
      delete pendingValues[id];
      markBadge(id, "badge--success", "Saved");
    }
    autoSaveToastShown = false;
  } catch (err) {
    for (const id of validIds) markBadge(id, "badge--danger", "Retry pending");
    if (!autoSaveToastShown) {
      autoSaveToastShown = true;
      toast(err.message || "Could not save some scores — will retry automatically.", "error");
    }
  }
}

function markBadge(studentId, className, text) {
  const badge = document.getElementById(`status-${studentId}`);
  if (!badge) return;
  badge.className = `badge ${className}`;
  badge.textContent = text;
}

async function saveAllDirty(profile, button) {
  if (!dirty.size) return toast("All scores are already saved.", "info");
  const restore = button ? busyButton(button, "Saving…") : () => {};
  const before = dirty.size;
  try {
    await flushDirtyMarks();
    const saved = before - dirty.size;
    toast(
      saved === before
        ? `Saved ${saved} score(s) successfully.`
        : `Saved ${saved} of ${before} score(s) — remaining will retry automatically.`,
      saved === before ? "success" : "error"
    );
  } finally {
    restore();
  }
}

// ------------------------------------------------------------- Bulk Paste --

function openBulkPaste(container) {
  const assessment = allAssessments.find((a) => a.id === selection.assessmentId);
  const maxScore = getAssessmentMaxScore(assessment, selection.subjectCode);
  const isDirect = (assessment?.contributionMode || "weighted") === "direct";

  const body = el("form", {});
  body.append(
    el("div", {
      class: "callout callout--info",
      style: "margin-bottom:var(--sp-3); font-size:var(--fs-xs);",
    }, [
      icon("info", "text-primary"),
      el("span", {}, `Paste two columns: Admission Number, then Score (out of ${maxScore}). Decimal scores supported.`),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "Raw Scores (Copy & Paste from Excel/Sheets)"),
      el("textarea", {
        id: "bulk-text",
        rows: "8",
        style: "width:100%; padding:8px 10px; border:1px solid var(--color-line); border-radius:6px; font-family:var(--font-mono, monospace); font-size:var(--fs-xs);",
        placeholder: "ADM001, 85.5\nADM002, 92\nADM003, 78",
      }),
    ]),
    el("div", {
      class: "callout callout--warning",
      style: "margin-bottom:var(--sp-4); font-size:11px; padding:8px 12px;",
    }, [
      icon("warning", "text-amber"),
      el("span", {}, "Notice: Mismatched admission numbers or scores exceeding max score will be flagged and skipped."),
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("table_chart"), "Populate Table"])
  );

  const close = openModal("Paste Bulk Scores", body);

  body.addEventListener("submit", (e) => {
    e.preventDefault();
    const lines = document.getElementById("bulk-text").value.split("\n").map((l) => l.trim()).filter(Boolean);
    let filled = 0;
    let overMaxCount = 0;
    let notFoundCount = 0;

    for (const line of lines) {
      const parts = line.split(/[, \t]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const [admNo, rawScore] = parts;
      const scoreNum = Number(rawScore);

      const student = roster.find((s) => (s.admissionNumber || "").toLowerCase() === admNo.toLowerCase());
      if (!student) {
        notFoundCount++;
        continue;
      }

      if (!Number.isNaN(scoreNum) && scoreNum > maxScore) {
        overMaxCount++;
      }

      const input = container.querySelector(`input[data-student-id="${student.id}"]`);
      if (input) {
        input.value = rawScore;
        input.dispatchEvent(new Event("input"));
        filled += 1;
      }
    }

    if (overMaxCount > 0) {
      toast(`Filled ${filled} row(s), but ${overMaxCount} score(s) exceed Max Score (${maxScore}).`, "error");
    } else {
      toast(`Filled ${filled} of ${lines.length} student row(s). Review and click 'Save All' to store.`, filled ? "success" : "info");
    }
    close();
  });
}

async function toggleLock(profile, assessment, container) {
  const next = assessment.status === "locked" ? "open" : "locked";
  try {
    await setAssessmentStatus(profile.uid, assessment.id, next);
    assessment.status = next;
    toast(`${assessment.name} ${next === "locked" ? "locked successfully" : "reopened for editing"}.`, "success");
    allAssessments = await listAssessments();
    renderRoster(container, profile);
  } catch (err) {
    toast(err.message || "Could not update status.", "error");
  }
}

export function init() {}