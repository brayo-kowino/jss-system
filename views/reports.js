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
import { downloadElementAsPdf, downloadPdfsAsZip, prewarmPdfLibs } from "../js/services/pdf.util.js";
import { savedModesPanel } from "../js/components/saved-modes-panel.js";
import { el, icon, toast, formatDate, skeleton, spinner, busyButton } from "../js/utils.js";
import { getCurrentSchool } from "../js/services/auth.service.js";
import { isStarterPlan } from "../js/services/subscription.service.js";

const CAN_EDIT_TEACHER_REMARK = ["admin", "academic_master", "class_teacher"];
const CAN_EDIT_PRINCIPAL_REMARK = ["admin", "principal", "deputy_principal"];
const NO_PORTAL_YET = ["parent", "student"];

let classes = [];
let settings = null;
let selection = { grade: "", stream: "", academicYear: "", term: "" };
let activeMode = null; // which saved report mode is currently being viewed
let studentSearchQuery = "";
let selectedStreamFilter = "All";

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
 * Dynamic Academic Registrar mascot with official report card folio and sparkling rosette ribbon.
 */
export function buildReportsMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="reports-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Report Cards Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks & Records Stack Base -->
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

        <!-- Left Arm Holding Report Card Folio / Booklet -->
        <g class="reports-mascot__card">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Official Report Card Binder / Sheet -->
          <rect x="54" y="122" width="30" height="36" rx="3" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" transform="rotate(-6 69 140)" />
          <!-- Header Bar of Report -->
          <rect x="57" y="125" width="24" height="6" rx="1.5" fill="#14538A" transform="rotate(-6 69 140)" />
          <!-- Performance Bar Lines -->
          <line x1="59" y1="135" x2="75" y2="133.5" stroke="#059669" stroke-width="1.6" stroke-linecap="round" />
          <line x1="59" y1="140" x2="73" y2="138.5" stroke="#14538A" stroke-width="1.4" stroke-linecap="round" />
          <line x1="59" y1="145" x2="77" y2="143.5" stroke="#14538A" stroke-width="1.4" stroke-linecap="round" />
          <line x1="59" y1="150" x2="71" y2="148.5" stroke="#C9A227" stroke-width="1.4" stroke-linecap="round" />
          <!-- Official Circular Stamp / Seal -->
          <circle cx="74" cy="149" r="4" fill="none" stroke="#DC2626" stroke-width="0.8" />
          <polygon points="74,146 75,148 77,148 75.5,149.5 76,151.5 74,150.5 72,151.5 72.5,149.5 71,148 73,148" fill="#DC2626" />
          <!-- Hand Holding Report Card -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Golden Rosette Ribbon (Animated) -->
        <g class="reports-mascot__rosette">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Twin Ribbon Streamers -->
          <path d="M154,106 L151,122 L155,119 L159,122 L156,106 Z" fill="#DC2626" />
          <path d="M157,106 L161,121 L164,118 L167,121 L163,106 Z" fill="#B91C1C" />
          <!-- Rosette Outer Petals / Scallop -->
          <circle cx="157" cy="100" r="11" fill="#F59E0B" stroke="#B45309" stroke-width="1" />
          <!-- Rosette Inner Disc -->
          <circle cx="157" cy="100" r="7.5" fill="#FDE68A" />
          <!-- Star Sparkle on Rosette -->
          <polygon points="157,94 159,98 163,98 160,101 161,105 157,103 153,105 154,101 151,98 155,98" fill="#D97706" />
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

  const wrap = el("div", { class: "reports-view-wrap" });

  // Mascot container
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildReportsMascotSvg({ width: 155, height: 140 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "reports-hero" }, [
    el("div", { class: "reports-hero__content" }, [
      el("h1", { class: "reports-hero__title" }, "Student Report Cards"),
      el("p", { class: "reports-hero__desc" }, "Student report cards with CBC performance levels, teacher remarks, and exportable PDF cards for printing."),
      el("div", { class: "reports-hero__pills" }, [
        el("div", { class: "reports-pill" }, [icon("school"), `${classes.length} Grade Cohorts`]),
        el("div", { class: "reports-pill" }, [icon("calendar_today"), `${selection.academicYear} · ${selection.term}`]),
      ]),
    ]),

    // Mascot & Speech Bubble
    el("div", { class: "reports-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Review student performance reports and batch download PDF cards."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // Configuration & Filter Card
  const pickerCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  wrap.append(pickerCard);
  const bodyMount = el("div", { id: "reports-body-mount", style: "margin-top:16px;" });
  wrap.append(bodyMount);

  renderPicker(pickerCard, bodyMount, profile);
  renderWelcomeDisclaimers(bodyMount);
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
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("school", "text-xs"), "Grade"]), gradeSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("meeting_room", "text-xs"), "Stream"]), streamSelect]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("calendar_today", "text-xs"), "Academic Year"]), yearInput]),
    el("div", { class: "field" }, [el("label", { style: "display:flex; align-items:center; gap:4px;" }, [icon("date_range", "text-xs"), "Term"]), termSelect])
  );
  container.append(row);

  container.append(
    el("p", { class: "text-muted text-xs", style: "margin:10px 0 14px; display:flex; align-items:center; gap:6px;" }, [
      icon("info", "text-xs", "style: color:var(--color-primary-600);"),
      "Select cohort parameters to load saved merit assessments and report cards.",
    ])
  );

  container.append(
    el("div", { class: "filter-actions", style: "display:flex; justify-content:flex-end;" }, [
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => loadList(bodyMount, profile)
      }, [
        icon("description", "text-xs"),
        "Load Report Cards"
      ]),
    ])
  );
}

/**
 * Renders guided instructions and 4 operational disclaimers before report cards are loaded.
 */
function renderWelcomeDisclaimers(container) {
  container.innerHTML = "";

  const welcomeCard = el("div", { class: "reports-welcome-card" }, [
    el("div", { class: "reports-welcome-header" }, [
      icon("description", "text-primary", "style: font-size:36px;"),
      el("h3", {}, "Ready to Review Student Report Cards?"),
      el("p", {}, "Select a Grade Cohort, Stream, Academic Year, and Term above, then click 'Load Report Cards' to review student performance and export batch PDFs."),
    ]),

    // Important Operational Disclaimers Grid
    el("div", { class: "reports-disclaimers-grid" }, [
      el("div", { class: "reports-disclaimer-card reports-disclaimer-card--info" }, [
        el("div", { class: "reports-disclaimer-title" }, [
          icon("analytics", "text-primary"),
          "Grading & Computation Prerequisite",
        ]),
        el("p", { class: "reports-disclaimer-body" }, "Report cards pull directly from computed rankings saved in Grading & Positions (#/grading). If student marks or weights were recently updated, re-compute and save in Grading first."),
      ]),
      el("div", { class: "reports-disclaimer-card reports-disclaimer-card--warning" }, [
        el("div", { class: "reports-disclaimer-title" }, [
          icon("account_tree", "text-amber"),
          "Multi-Stream & Cohort Ranking Scope",
        ]),
        el("p", { class: "reports-disclaimer-body" }, "Selecting 'All streams' displays Overall Cohort positions (1/N) across all learners in the grade. Selecting a specific stream displays that stream's localized class positions (1/n)."),
      ]),
      el("div", { class: "reports-disclaimer-card reports-disclaimer-card--danger" }, [
        el("div", { class: "reports-disclaimer-title" }, [
          icon("folder_zip", "text-red"),
          "Client-Side Sequential PDF Generation",
        ]),
        el("p", { class: "reports-disclaimer-body" }, "'Download All (ZIP)' compiles high-resolution print-ready PDFs one student at a time directly in your browser to avoid memory bottlenecks. Keep this browser tab active and in focus during export."),
      ]),
      el("div", { class: "reports-disclaimer-card reports-disclaimer-card--success" }, [
        el("div", { class: "reports-disclaimer-title" }, [
          icon("verified", "text-green"),
          "Qualitative Remarks & Signatures",
        ]),
        el("p", { class: "reports-disclaimer-body" }, "Click 'View Report Card' on any student to record class teacher and principal remarks. Remarks save directly to the student's record and appear on printed copies and PDF exports."),
      ]),
    ]),
  ]);

  container.append(welcomeCard);
}

async function loadList(bodyMount, profile) {
  if (!selection.grade || !selection.academicYear || !selection.term) {
    return toast("Choose grade, academic year, and term first.", "error");
  }
  studentSearchQuery = "";
  selectedStreamFilter = selection.stream || "All";
  bodyMount.innerHTML = "";
  bodyMount.append(el("div", { class: "skeleton-rows" }, [
    skeleton("", "90%"), skeleton("", "90%"), skeleton("", "90%"), skeleton("", "60%"),
  ]));
  try {
    const savedModes = await listSavedModesForPeriod(selection);
    if (!savedModes.length) {
      bodyMount.innerHTML = "";
      bodyMount.append(el("div", { class: "card", style: "padding:var(--sp-6);" }, [
        el("div", { class: "empty-state" }, [
          icon("description", "empty-state__icon", "style: font-size:48px; color:var(--color-ink-soft);"),
          el("h3", { style: "color:var(--color-primary-900); margin:8px 0 4px;" }, "No saved results for this period"),
          el("p", { class: "text-muted text-sm", style: "max-width:440px; margin:0 auto 16px;" },
            `No computed rankings have been saved for ${selection.grade} (${selection.academicYear} · ${selection.term}) yet. Compute rankings in Grading & Positions first.`),
          el("a", { class: "btn btn--primary btn--sm", href: "#/grading" }, [
            icon("analytics", "text-xs"),
            "Go to Grading & Positions",
          ]),
        ]),
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

  // Executive Header Card
  const header = el("div", {
    class: "card",
    style: "margin-bottom:var(--sp-4); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;"
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("description", "text-primary"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, [
          `${selection.grade}${selection.stream ? " " + selection.stream : ""}: ${selection.term} ${selection.academicYear}`,
        ]),
        el("span", { class: `badge ${activeMode === "average" ? "badge--success" : "badge--gold"}` }, reportModeLabel(activeMode)),
      ]),
      el("p", { class: "text-muted text-xs", style: "margin:4px 0 0 0;" }, `${results.length} saved report card(s) available for export.`),
    ]),
  ]);

  if (results.length) {
    const bulkBtn = el("button", {
      type: "button",
      class: "btn btn--primary btn--sm hide-on-mobile"
    }, [
      icon("folder_zip", "text-xs"),
      "Download All (ZIP)"
    ]);
    bulkBtn.addEventListener("click", () => handleBulkDownload(bulkBtn, results, profile));
    header.append(bulkBtn);
  }
  container.append(header);

  // Table Card with Toolbar
  const resultsCard = el("div", { class: "reports-results-card table-wrap table-wrap--responsive" });

  // Stream options for quick filtering (if "All streams" selected in top picker)
  const isAllStreams = !selection.stream;
  const streamsSet = new Set(results.map((r) => r.stream).filter(Boolean));
  const streamOptionsList = ["All", ...Array.from(streamsSet)];

  const searchInput = el("input", {
    type: "search",
    class: "subjects-search-input",
    placeholder: "Filter by student name or admission number...",
    value: studentSearchQuery,
    style: "max-width:320px;",
  });

  const streamFilterButtons = el("div", { style: "display:flex; gap:6px; flex-wrap:wrap; align-items:center;" });
  function renderStreamPills() {
    streamFilterButtons.innerHTML = "";
    if (isAllStreams && streamOptionsList.length > 2) {
      streamOptionsList.forEach((stream) => {
        const btn = el("button", {
          type: "button",
          class: `subjects-dept-btn ${selectedStreamFilter === stream ? "subjects-dept-btn--active" : ""}`,
          onClick: () => {
            selectedStreamFilter = stream;
            renderStreamPills();
            renderFilteredRoster(tableBody);
          },
        }, stream === "All" ? "All Streams" : stream);
        streamFilterButtons.append(btn);
      });
    }
  }
  renderStreamPills();

  const toolbar = el("div", { class: "reports-toolbar" }, [
    el("div", { class: "subjects-search-wrap" }, [
      icon("search"),
      searchInput,
    ]),
    streamFilterButtons,
  ]);
  resultsCard.append(toolbar);

  const table = el("table", { class: "reports-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:90px;" }, "Pos"),
      el("th", { style: "width:130px;" }, "Adm No."),
      el("th", { style: "min-width:180px;" }, "Student Name"),
      el("th", { class: "col-num", style: "width:110px;" }, "Mean"),
      el("th", { class: "col-center", style: "width:120px;" }, "Grade"),
      el("th", { class: "col-right", style: "width:160px;" }, "Action"),
    ])),
  ]);

  const tableBody = el("tbody", {});
  const isStreamView = Boolean(selection.stream);

  function renderFilteredRoster(targetTbody) {
    targetTbody.innerHTML = "";

    const sorted = [...results].sort((a, b) => {
      const posA = isStreamView ? a.classPosition : a.overallPosition;
      const posB = isStreamView ? b.classPosition : b.overallPosition;
      if (posA == null) return 1;
      if (posB == null) return -1;
      return posA - posB;
    });

    const filtered = sorted.filter((r) => {
      const query = (studentSearchQuery || "").toLowerCase();
      const matchesSearch = !query ||
        (r.fullName || "").toLowerCase().includes(query) ||
        (r.admissionNumber || "").toLowerCase().includes(query);
      const matchesStream = !isAllStreams || selectedStreamFilter === "All" || r.stream === selectedStreamFilter;
      return matchesSearch && matchesStream;
    });

    if (!filtered.length) {
      targetTbody.append(el("tr", {}, [
        el("td", { colspan: "6", style: "text-align:center; padding:var(--sp-5); color:var(--color-ink-soft);" }, "No report cards match the current search or stream filter."),
      ]));
      return;
    }

    for (const r of filtered) {
      const pos = isStreamView ? r.classPosition : r.overallPosition;
      const size = isStreamView ? r.streamClassSize : r.classSize;
      const isTop3 = pos && pos <= 3;

      targetTbody.append(el("tr", {}, [
        el("td", { "data-label": "Pos" }, [
          el("span", { class: `reports-pos-badge ${isTop3 ? "reports-pos-badge--top" : ""}` }, [
            isTop3 ? icon("emoji_events", "text-gold", "style: font-size:13px;") : null,
            pos ? `${pos}/${size}` : "N/A",
          ].filter(Boolean)),
        ]),
        el("td", { "data-label": "Adm No." }, [
          el("span", {
            style: "font-family:var(--font-mono, monospace); font-weight:600; font-size:11px; background:var(--color-cream-dim, #f8fafc); padding:2px 7px; border-radius:4px; border:1px solid var(--color-line);",
          }, r.admissionNumber || "N/A"),
        ]),
        el("td", { "data-label": "Name" }, [
          el("span", { style: "font-weight:600; color:var(--color-ink);" }, r.fullName || "Unnamed Learner"),
          (!isStreamView && r.stream) ? el("span", { class: "badge badge--outline", style: "margin-left:6px; font-size:10px;" }, r.stream) : null,
        ].filter(Boolean)),
        el("td", { class: "col-num", "data-label": "Mean" }, [
          el("span", { style: "font-weight:600; font-variant-numeric:tabular-nums;" }, `${r.meanMarks?.toFixed(2) ?? "N/A"}%`),
        ]),
        el("td", { class: "col-center", "data-label": "Grade" }, [
          el("span", { class: "badge badge--gold" }, r.meanGrade || "N/A"),
        ]),
        el("td", { class: "col-right", "data-label": "Action" }, [
          el("div", { style: "display:inline-flex; justify-content:flex-end;" }, [
            el("button", {
              type: "button",
              class: "btn btn--ghost btn--sm",
              onClick: () => openCard(bodyMount, r, profile),
            }, [
              icon("visibility", "text-xs"),
              "View Report Card",
            ]),
          ]),
        ]),
      ]));
    }
  }

  searchInput.addEventListener("input", (e) => {
    studentSearchQuery = e.target.value.trim();
    renderFilteredRoster(tableBody);
  });

  renderFilteredRoster(tableBody);
  table.append(tableBody);
  resultsCard.append(table);
  container.append(resultsCard);
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
  
  const wrapper = el("div", { class: "report-card-wrapper", style: "width: 100%; overflow-x: auto; overflow-y: hidden; display: flex; justify-content: center;" });
  wrapper.append(card);

  const applyScale = () => {
    if (!wrapper.isConnected) {
      window.removeEventListener("resize", applyScale);
      return;
    }
    const width = wrapper.clientWidth;
    if (width > 0 && width < 840) {
      card.style.zoom = width / 840;
    } else {
      card.style.zoom = 1;
    }
  };
  
  window.addEventListener("resize", applyScale);
  setTimeout(applyScale, 0);

  bodyMount.append(wrapper);
}

function buildActionBar(bodyMount, result, profile) {
  const bar = el("div", { class: "no-print", style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;" });
  bar.append(
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => loadList(bodyMount, profile) }, [icon("arrow_back", "text-xs"), "Back to list"]),
    el("div", { style: "display:flex; gap:8px; align-items:center;" }, [
      el("button", { class: "btn btn--ghost btn--sm hide-on-mobile", onClick: () => window.print() }, [icon("print", "text-xs"), "Print"]),
      el("button", { class: "btn btn--primary btn--sm hide-on-mobile", onClick: (e) => handleDownload(e.currentTarget, result) }, [icon("download", "text-xs"), "Download PDF"]),
    ])
  );
  return bar;
}

async function handleDownload(btn, result) {
  const button = btn?.closest?.("button") || btn;
  const card = document.querySelector(".report-card");
  if (!card || !button) return;
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "";
  const statusSpan = document.createElement("span");
  statusSpan.textContent = " Loading…";
  button.append(spinner("sm", "light"), statusSpan);
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    await downloadElementAsPdf(card, `${result.fullName.replace(/\s+/g, "_")}_${result.term}_${result.academicYear}.pdf`, {
      onStatus: (status) => {
        if (status === "rendering_canvas") statusSpan.textContent = " Rendering…";
        else if (status === "building_pdf") statusSpan.textContent = " Building PDF…";
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    toast("Could not generate PDF - check your connection and try again.", "error");
  } finally {
    button.innerHTML = originalHTML;
    button.disabled = false;
  }
}

function buildCard(result, feeSummary, priorHistory, profile) {
  const card = el("div", { class: "report-card" });

  // Header: logo + school details + banner
  card.append(
    el("div", { class: "report-card__header" }, [
      settings.logoUrl
        ? el("img", { class: "report-card__logo", src: settings.logoUrl, crossorigin: "anonymous" })
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
  // Student photos are reserved for Growth/District plans - Starter schools
  // see a person-icon placeholder, which also avoids a Cloudinary network
  // fetch during PDF rendering.
  const starterPlan = isStarterPlan(getCurrentSchool());
  card.append(
    el("div", { class: "report-card__student" }, [
      starterPlan
        ? el("div", { class: "report-card__photo report-card__photo--placeholder" }, [el("span", { class: "material-symbols-rounded" }, "person")])
        : result.photoUrl
          ? el("img", { class: "report-card__photo", src: result.photoUrl, crossorigin: "anonymous" })
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
    ["Total Pts", String(result.totalPoints)],
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
      el("th", {}, "Score"), el("th", {}, "Grade"), el("th", {}, "Pts"), el("th", {}, "Rank"), el("th", {}, "Remarks"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of [...result.subjects].sort((a, b) => a.name.localeCompare(b.name))) {
    tbody.append(el("tr", {}, [
      el("td", {}, [s.name, s.incomplete ? el("span", { class: "badge badge--warning", style: "margin-left:2px;", title: `Only ${s.weightUsed}% of ${s.weightExpected}% assessment weight marked` }, "") : ""]),
      ...(showBothColumns ? [
        el("td", {}, s.midtScore == null ? el("span", { class: "text-muted" }, "") : s.midtScore.toFixed(1)),
        el("td", {}, s.endScore == null ? el("span", { class: "text-muted" }, "") : s.endScore.toFixed(1)),
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

export function init() {
  prewarmPdfLibs();
}