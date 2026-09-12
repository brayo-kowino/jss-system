import {
  listClasses,
  addClass,
  addStreamToClass,
  renameStream,
  removeStreamFromClass,
  deleteClass,
  seedDefaultsIfEmpty,
} from "../js/services/academic.service.js";
import { listStudents } from "../js/services/student.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

let classes = [];
let students = [];
let searchQuery = "";

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
 * Dynamic Academic Scholar mascot with chalkboard slate, teaching pointer, and textbooks.
 */
export function buildAcademicsMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="academics-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Academics Assistant">
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

        <!-- Left Hand Holding CBC Chalkboard Slate -->
        <g class="academics-mascot__slate">
          <path d="M84,128 C72,134 70,146 80,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- Slate Frame -->
          <rect x="50" y="122" width="34" height="28" rx="3" fill="#1E293B" stroke="#8C6F12" stroke-width="1.6" transform="rotate(-6 67 136)" />
          <!-- Chalk Writing -->
          <text x="67" y="136" fill="#F8FAFC" font-size="8.5" font-weight="bold" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" transform="rotate(-6 67 136)">CBC</text>
          <line x1="56" y1="142" x2="78" y2="139.5" stroke="#FDE68A" stroke-width="1" stroke-dasharray="2,2" />
          <!-- Holding Hand -->
          <circle cx="80" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Holding Teaching Pointer Wand -->
        <g class="academics-mascot__pointer">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <line x1="150" y1="110" x2="168" y2="78" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Star Tip -->
          <polygon class="academics-mascot__star" points="168,73 170,77 175,77 171,80 173,85 168,82 163,85 165,80 161,77 166,77" fill="#F59E0B" />
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

/**
 * Determine curriculum cohort badge for Kenya CBC framework.
 */
function getCbcLevel(grade) {
  const g = (grade || "").toLowerCase();
  if (g.includes("7") || g.includes("8") || g.includes("9")) {
    return { name: "Junior School", badge: "badge--primary" };
  }
  if (g.includes("4") || g.includes("5") || g.includes("6")) {
    return { name: "Upper Primary", badge: "badge--neutral" };
  }
  if (g.includes("1") || g.includes("2") || g.includes("3")) {
    return { name: "Lower Primary", badge: "badge--neutral" };
  }
  if (g.includes("pp") || g.includes("pre")) {
    return { name: "Pre-Primary", badge: "badge--neutral" };
  }
  if (g.includes("10") || g.includes("11") || g.includes("12")) {
    return { name: "Senior School", badge: "badge--warning" };
  }
  return { name: "Basic Education", badge: "badge--neutral" };
}

// ------------------------------------------------------------------ Render --

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  [classes, students] = await Promise.all([
    listClasses(),
    listStudents().catch(() => []),
  ]);

  const wrap = el("div", { class: "academics-view-wrap" });

  const totalStreams = classes.reduce((sum, c) => sum + (c.streams || []).length, 0);
  const activeStudentsCount = students.filter((s) => s.status === "active").length;
  const avgStreams = classes.length ? (totalStreams / classes.length).toFixed(1) : "0";

  // Mascot container
  const mascotWrap = el("div", { class: "academics-hero__mascot-wrap" });
  mascotWrap.innerHTML = buildAcademicsMascotSvg({ width: 165, height: 150 });

  // Executive Hero Banner
  const heroBanner = el("div", { class: "academics-hero" }, [
    el("div", { class: "academics-hero__content" }, [
      el("div", { class: "academics-hero__status-row" }, [
        el("div", { class: "academics-cycle-badge" }, [
          icon("account_tree", "text-sm"),
          "Curriculum Architecture · CBC Structure",
        ]),
        infoTooltip(
          "Classes & Streams",
          "Classes and streams form the structural foundation of your school. Enrolled learners, teacher timetables, attendance registers, and CBC assessment rubrics all bind directly to these sections.",
          "right"
        ),
      ]),
      el("h1", { class: "academics-hero__title" }, "Classes & Learning Streams"),
      el(
        "p",
        { class: "academics-hero__desc" },
        "Configure grade cohorts, learning streams, and class sections to structure student enrollments, timetable scheduling, and CBC assessment rubrics."
      ),
      el("div", { class: "academics-hero__pills" }, [
        el("div", { class: "academics-pill" }, [icon("school"), `${classes.length} Grade Cohorts`]),
        el("div", { class: "academics-pill" }, [icon("meeting_room"), `${totalStreams} Active Streams`]),
        el("div", { class: "academics-pill" }, [icon("groups"), `${activeStudentsCount} Active Learners`]),
        el("div", { class: "academics-pill" }, [icon("verified"), "CBC Structure Aligned"]),
      ]),
      el("div", { class: "academics-hero__actions" }, [
        el(
          "button",
          {
            type: "button",
            class: "btn btn--primary",
            id: "new-grade-btn",
            onClick: () => openGradeForm(profile),
          },
          [icon("add"), "Add Grade"]
        ),
      ]),
    ]),

    // Animated Academic Scholar Mascot & Speech Bubble
    el("div", { class: "academics-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Organize your classes, grade levels, and learning streams."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // KPI Analytics Metric Strip
  const kpiGrid = el("div", { class: "academics-kpi-grid" }, [
    el("div", { class: "academics-kpi-card" }, [
      el("div", { class: "academics-kpi-icon" }, [icon("school")]),
      el("div", { class: "academics-kpi-info" }, [
        el("span", { class: "academics-kpi-val" }, `${classes.length}`),
        el("span", { class: "academics-kpi-label" }, "Grade Cohorts"),
        el("span", { class: "academics-kpi-sub" }, "Enrolled grade levels"),
      ]),
    ]),
    el("div", { class: "academics-kpi-card" }, [
      el("div", { class: "academics-kpi-icon", style: "background:rgba(201,162,39,0.15); color:var(--color-gold-700,#8c6f12);" }, [icon("meeting_room")]),
      el("div", { class: "academics-kpi-info" }, [
        el("span", { class: "academics-kpi-val" }, `${totalStreams}`),
        el("span", { class: "academics-kpi-label" }, "Active Streams"),
        el("span", { class: "academics-kpi-sub" }, `${avgStreams} avg per grade`),
      ]),
    ]),
    el("div", { class: "academics-kpi-card" }, [
      el("div", { class: "academics-kpi-icon", style: "background:rgba(5,150,105,0.12); color:#059669;" }, [icon("groups")]),
      el("div", { class: "academics-kpi-info" }, [
        el("span", { class: "academics-kpi-val" }, `${activeStudentsCount}`),
        el("span", { class: "academics-kpi-label" }, "Enrolled Learners"),
        el("span", { class: "academics-kpi-sub" }, "Active on class rosters"),
      ]),
    ]),
    el("div", { class: "academics-kpi-card" }, [
      el("div", { class: "academics-kpi-icon", style: "background:rgba(99,102,241,0.12); color:#4f46e5;" }, [icon("verified")]),
      el("div", { class: "academics-kpi-info" }, [
        el("span", { class: "academics-kpi-val", style: "font-size:var(--fs-md);" }, "CBC Standard"),
        el("span", { class: "academics-kpi-label" }, "Curriculum Format"),
        el("span", { class: "academics-kpi-sub" }, "Pre-Primary to JSS"),
      ]),
    ]),
  ]);
  wrap.append(kpiGrid);

  // Search & Hint Toolbar
  const searchInput = el("input", {
    type: "search",
    class: "academics-search-input",
    placeholder: "Filter grades or streams (e.g. Grade 7, Blue)...",
    value: searchQuery,
  });

  const toolbar = el("div", { class: "academics-toolbar" }, [
    el("div", { class: "academics-search-wrap" }, [
      icon("search"),
      searchInput,
    ]),
    el("div", { class: "academics-hint-pill" }, [
      icon("lightbulb"),
      "Click any stream pill to rename · Click × to remove empty stream",
    ]),
  ]);
  wrap.append(toolbar);

  // Grid mount point
  const gridWrap = el("div", { id: "academics-grid-wrap" });
  wrap.append(gridWrap);
  renderGrid(gridWrap, profile);

  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderGrid(gridWrap, profile);
  });

  return wrap;
}

// ------------------------------------------------------------------ Grid --

function renderGrid(container, profile) {
  container.innerHTML = "";

  if (!classes.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("school", "text-muted", "style: font-size:48px;"),
        el("h3", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No grades configured yet"),
        el("p", { class: "text-muted text-sm", style: "max-width:380px; margin:0 auto var(--sp-4);" }, "Set up your school's grades and streams to enroll students, generate class attendance registers, and record assessment marks."),
        el("button", {
          type: "button",
          class: "btn btn--primary btn--sm",
          onClick: () => openGradeForm(profile),
        }, [icon("add"), "Add First Grade"]),
      ])
    );
    return;
  }

  const filtered = classes.filter((c) => {
    if (!searchQuery) return true;
    const gMatch = (c.grade || "").toLowerCase().includes(searchQuery);
    const sMatch = (c.streams || []).some((s) => s.toLowerCase().includes(searchQuery));
    return gMatch || sMatch;
  });

  if (!filtered.length) {
    container.append(
      el("div", { class: "empty-state", style: "padding:var(--sp-5);" }, [
        icon("search_off", "text-muted", "style: font-size:40px;"),
        el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No matching grades or streams"),
        el("p", { class: "text-muted text-sm" }, `No results matched "${searchQuery}". Try a different search term.`),
      ])
    );
    return;
  }

  const grid = el("div", { class: "academics-grid" });

  for (const c of filtered) {
    const gradeStudents = students.filter((s) => s.grade === c.grade && s.status === "active");
    const cbcInfo = getCbcLevel(c.grade);

    const card = el("div", { class: "academics-card" });

    // Card Header
    const cardHeader = el("div", { class: "academics-card__header" }, [
      el("div", { class: "academics-card__title-group" }, [
        el("div", { class: "academics-card__icon-box" }, [icon("school")]),
        el("div", { class: "academics-card__title-meta" }, [
          el("div", { class: "academics-card__title-row" }, [
            el("h3", { class: "academics-card__title" }, c.grade),
            el("span", { class: `badge ${cbcInfo.badge}`, style: "font-size:10px; font-weight:700;" }, cbcInfo.name),
          ]),
          el("span", { class: "academics-card__subtitle" }, [
            icon("groups", "text-xs"),
            `${(c.streams || []).length} stream${(c.streams || []).length === 1 ? "" : "s"} · ${gradeStudents.length} enrolled learner${gradeStudents.length === 1 ? "" : "s"}`,
          ]),
        ]),
      ]),
      el("div", { class: "academics-card__actions" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs",
          style: "color:var(--color-danger);",
          title: `Delete ${c.grade}`,
          onClick: () => openDeleteConfirm(profile, c, gradeStudents.length),
        }, [icon("delete", "text-xs"), "Delete"]),
      ]),
    ]);
    card.append(cardHeader);

    // Streams Header Label
    const streamLabel = el("div", { class: "academics-streams-label" }, [
      el("span", {}, "Streams & Sections"),
      el("span", { style: "font-variant-numeric:tabular-nums;" }, `${(c.streams || []).length} configured`),
    ]);
    card.append(streamLabel);

    // Interactive Stream Chips List
    const streamList = el("div", { class: "academics-stream-list" });

    for (const stream of c.streams || []) {
      const streamStudentCount = gradeStudents.filter((s) => s.stream === stream).length;

      const chip = el("div", { class: "academics-stream-chip" }, [
        el("span", { class: "academics-stream-dot" }),
        el("span", {
          class: "academics-stream-name",
          title: `Click to rename stream "${stream}"`,
          onClick: () => openRenameStream(profile, c, stream, streamStudentCount),
        }, [
          stream,
          icon("edit", "text-xs", "style: font-size:12px; opacity:0.6; margin-left:2px;"),
        ]),
        el("span", {
          class: "academics-stream-count",
          title: `${streamStudentCount} enrolled students in ${stream}`,
        }, `${streamStudentCount}`),
        el("button", {
          type: "button",
          class: "academics-stream-remove",
          title: streamStudentCount > 0 ? `Cannot remove: ${streamStudentCount} student(s) enrolled` : `Remove ${stream}`,
          onClick: (ev) => {
            ev.stopPropagation();
            confirmRemoveStream(profile, c, stream, streamStudentCount);
          },
        }, "×"),
      ]);
      streamList.append(chip);
    }

    if (!(c.streams || []).length) {
      streamList.append(
        el("span", { class: "text-muted text-xs", style: "font-style:italic;" }, "No streams configured yet. Add your first stream below.")
      );
    }
    card.append(streamList);

    // Quick stream preset suggestions if low count
    if ((c.streams || []).length < 3) {
      const commonPresets = ["Blue", "Green", "Red", "Yellow", "East", "West"];
      const missingPresets = commonPresets.filter((p) => !(c.streams || []).some((s) => s.toLowerCase() === p.toLowerCase())).slice(0, 3);

      if (missingPresets.length) {
        const presetsRow = el("div", { class: "academics-stream-presets" }, [
          el("span", { style: "color:var(--color-ink-soft); font-weight:600;" }, "Quick Add:"),
          ...missingPresets.map((preset) =>
            el("button", {
              type: "button",
              class: "academics-preset-btn",
              title: `Add ${preset} stream to ${c.grade}`,
              onClick: async (ev) => {
                const restore = busyButton(ev.currentTarget, "+");
                try {
                  await addStreamToClass(profile.uid, c.id, preset);
                  toast(`Stream "${preset}" added to ${c.grade}.`, "success");
                  await refresh(profile);
                } catch (err) {
                  toast(err.message || "Could not add stream.", "error");
                  restore();
                }
              },
            }, `+ ${preset}`)
          ),
        ]);
        card.append(presetsRow);
      }
    }

    // Inline Add Stream Form
    const addStreamForm = el("form", { class: "academics-add-stream-form" });
    const input = el("input", {
      type: "text",
      class: "academics-input-field",
      placeholder: "New stream name (e.g. Yellow, East)...",
    });
    const submitBtn = el("button", {
      type: "submit",
      class: "btn btn--primary btn--sm",
      style: "flex-shrink:0;",
    }, [icon("add", "text-xs"), "Stream"]);

    addStreamForm.append(
      el("div", { class: "academics-input-group" }, [
        el("div", { class: "academics-input-wrap" }, [
          icon("meeting_room"),
          input,
        ]),
        submitBtn,
      ])
    );

    addStreamForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const restore = busyButton(submitBtn, "Adding…");
      try {
        await addStreamToClass(profile.uid, c.id, name);
        toast(`Stream "${name}" added to ${c.grade}.`, "success");
        input.value = "";
        await refresh(profile);
      } catch (err) {
        toast(err.message || "Could not add stream.", "error");
      } finally {
        restore();
      }
    });

    card.append(addStreamForm);
    grid.append(card);
  }

  container.append(grid);
}

// ----------------------------------------------------------------- Refresh --

async function refresh(profile) {
  [classes, students] = await Promise.all([
    listClasses(true),
    listStudents(true).catch(() => []),
  ]);
  const container = document.getElementById("academics-grid-wrap");
  if (container) renderGrid(container, profile);
}

// ------------------------------------------------------------------ Modals --

function openGradeForm(profile) {
  const body = el("form", {});
  const streamsPreview = el("div", { class: "chip-list", style: "margin-bottom:12px; min-height:32px;" });
  const pendingStreams = [];

  function redrawPreview() {
    streamsPreview.innerHTML = "";
    if (!pendingStreams.length) {
      streamsPreview.append(el("span", { class: "text-muted text-xs", style: "font-style:italic;" }, "No streams added yet."));
      return;
    }
    pendingStreams.forEach((s, idx) => {
      streamsPreview.append(
        el("span", { class: "academics-stream-chip" }, [
          el("span", { class: "academics-stream-dot" }),
          s,
          el("button", {
            type: "button",
            class: "academics-stream-remove",
            title: `Remove ${s}`,
            onClick: () => {
              pendingStreams.splice(idx, 1);
              redrawPreview();
            },
          }, "×"),
        ])
      );
    });
  }
  redrawPreview();

  const gradePresets = [
    "Grade 1", "Grade 2", "Grade 3",
    "Grade 4", "Grade 5", "Grade 6",
    "Grade 7", "Grade 8", "Grade 9",
    "PP1", "PP2",
  ];
  const streamPresets = ["Blue", "Green", "Red", "Yellow", "East", "West", "North", "South"];

  const gradeInput = el("input", {
    id: "g-grade",
    placeholder: "e.g. Grade 9, Grade 7, PP2",
    autocomplete: "off",
  });

  const gradePresetPicker = el("div", { class: "preset-tag-picker" }, [
    el("span", { class: "text-muted text-xs", style: "align-self:center; margin-right:4px;" }, "Quick Select:"),
    ...gradePresets.map((gp) =>
      el("button", {
        type: "button",
        class: "preset-tag-pill",
        onClick: () => { gradeInput.value = gp; },
      }, gp)
    ),
  ]);

  const streamInput = el("input", {
    id: "g-stream-input",
    placeholder: "e.g. Blue, Green",
    style: "flex:1;",
  });

  const streamPresetPicker = el("div", { class: "preset-tag-picker" }, [
    el("span", { class: "text-muted text-xs", style: "align-self:center; margin-right:4px;" }, "Quick Add Stream:"),
    ...streamPresets.map((sp) =>
      el("button", {
        type: "button",
        class: "preset-tag-pill",
        onClick: () => {
          if (!pendingStreams.includes(sp)) {
            pendingStreams.push(sp);
            redrawPreview();
          }
        },
      }, `+ ${sp}`)
    ),
  ]);

  body.append(
    el("div", { class: "field" }, [
      el("label", {}, "Grade Name"),
      gradeInput,
      gradePresetPicker,
    ]),
    el("div", { class: "field" }, [
      el("label", {}, "Streams & Sections"),
      streamsPreview,
      el("div", { style: "display:flex; gap:8px;" }, [
        streamInput,
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--sm",
          onClick: () => {
            const v = streamInput.value.trim();
            if (!v) return;
            if (!pendingStreams.includes(v)) {
              pendingStreams.push(v);
              streamInput.value = "";
              redrawPreview();
            }
          },
        }, [icon("add"), "Add"]),
      ]),
      streamPresetPicker,
    ]),
    el("button", {
      type: "submit",
      class: "btn btn--primary btn--block",
      style: "margin-top:var(--sp-2);",
    }, [icon("add_circle"), "Create Grade Cohort"])
  );

  const close = openModal("Add New Grade", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const grade = gradeInput.value.trim();
    if (!grade) return toast("Grade name is required.", "error");

    const pendingInput = streamInput.value.trim();
    if (pendingInput && !pendingStreams.includes(pendingInput)) {
      pendingStreams.push(pendingInput);
    }

    const restore = busyButton(e.submitter, "Creating…");
    try {
      await addClass(profile.uid, grade, pendingStreams);
      toast(`${grade} created successfully.`, "success");
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not create grade.", "error");
      restore();
    }
  });
}

function openRenameStream(profile, cls, streamName, enrolledCount = 0) {
  const body = el("form", {});
  const nameInput = el("input", { id: "rs-name", value: streamName, required: "true" });

  if (enrolledCount > 0) {
    body.append(
      el("div", {
        class: "callout callout--warning",
        style: "margin-bottom:var(--sp-3); padding:10px 14px; font-size:var(--fs-xs);",
      }, [
        icon("warning", "text-amber", "style: font-size:16px;"),
        el("span", {}, `Notice: ${enrolledCount} active student(s) are currently enrolled in ${cls.grade} ${streamName}. In order to rename a stream, enrolled students must first be re-assigned.`),
      ])
    );
  }

  body.append(
    el("div", { class: "field" }, [
      el("label", {}, `Stream Name in ${cls.grade}`),
      nameInput,
    ]),
    el("button", {
      type: "submit",
      class: "btn btn--primary btn--block",
      disabled: enrolledCount > 0 ? "true" : undefined,
    }, [icon("save"), "Save Changes"])
  );

  const close = openModal(`Rename Stream: ${cls.grade} ${streamName}`, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    if (!newName || newName === streamName) return close();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await renameStream(profile.uid, cls.id, streamName, newName);
      toast(`Stream renamed to "${newName}".`, "success");
      close();
      await refresh(profile);
    } catch (err) {
      toast(err.message || "Could not rename stream.", "error");
      restore();
    }
  });
}

function confirmRemoveStream(profile, cls, streamName, enrolledCount = 0) {
  const body = el("div", {});

  if (enrolledCount > 0) {
    body.append(
      el("div", {
        class: "callout callout--danger",
        style: "margin-bottom:var(--sp-4); padding:12px 14px;",
      }, [
        icon("error", "text-red", "style: font-size:18px;"),
        el("div", {}, [
          el("strong", { style: "display:block; margin-bottom:2px;" }, "Cannot Remove Stream"),
          el("p", { class: "text-xs", style: "margin:0;" }, `There are currently ${enrolledCount} active student(s) assigned to ${cls.grade} ${streamName}. Please reassign them to another stream before deleting this stream.`),
        ]),
      ]),
      el("div", { style: "display:flex; justify-content:flex-end; margin-top:16px;" }, [
        el("button", { class: "btn btn--primary btn--sm", onClick: () => close() }, "Understood"),
      ])
    );
  } else {
    body.append(
      el("p", { class: "text-sm", style: "margin-bottom:var(--sp-4);" }, `Are you sure you want to remove the stream "${streamName}" from ${cls.grade}? This stream has no enrolled students.`),
      el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => close() }, "Cancel"),
        el("button", {
          class: "btn btn--danger btn--sm",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Removing…");
            try {
              await removeStreamFromClass(profile.uid, cls.id, streamName);
              toast(`Stream "${streamName}" removed from ${cls.grade}.`, "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not remove stream.", "error");
              restore();
            }
          },
        }, [icon("delete"), "Remove Stream"]),
      ])
    );
  }

  const close = openModal(`Remove Stream: ${cls.grade} ${streamName}`, body);
}

function openDeleteConfirm(profile, cls, enrolledCount = 0) {
  const body = el("div", {});

  if (enrolledCount > 0) {
    body.append(
      el("div", {
        class: "callout callout--danger",
        style: "margin-bottom:var(--sp-4); padding:12px 14px;",
      }, [
        icon("error", "text-red", "style: font-size:18px;"),
        el("div", {}, [
          el("strong", { style: "display:block; margin-bottom:2px;" }, "Cannot Delete Grade"),
          el("p", { class: "text-xs", style: "margin:0;" }, `There are currently ${enrolledCount} active student(s) enrolled in ${cls.grade}. To protect academic records, attendance logs, and fee balances, you must reassign or graduate all students before deleting this grade cohort.`),
        ]),
      ]),
      el("div", { style: "display:flex; justify-content:flex-end; margin-top:16px;" }, [
        el("button", { class: "btn btn--primary btn--sm", onClick: () => close() }, "Understood"),
      ])
    );
  } else {
    body.append(
      el("p", { class: "text-sm", style: "margin-bottom:var(--sp-4);" }, `Are you sure you want to delete ${cls.grade} and all its streams? This action cannot be undone.`),
      el("div", { style: "display:flex; justify-content:flex-end; gap:8px;" }, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => close() }, "Cancel"),
        el("button", {
          class: "btn btn--danger btn--sm",
          onClick: async (ev) => {
            const restore = busyButton(ev.currentTarget, "Deleting…");
            try {
              await deleteClass(profile.uid, cls.id);
              toast(`${cls.grade} deleted successfully.`, "success");
              close();
              await refresh(profile);
            } catch (err) {
              toast(err.message || "Could not delete grade.", "error");
              restore();
            }
          },
        }, [icon("delete_forever"), "Delete Grade"]),
      ])
    );
  }

  const close = openModal(`Delete Grade: ${cls.grade}`, body);
}

export function init() {}
