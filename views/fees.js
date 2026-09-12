import { listClasses } from "../js/services/academic.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { listStudents } from "../js/services/student.service.js";
import {
  PAYMENT_METHODS,
  listFeeStructures,
  saveFeeStructure,
  deleteFeeStructure,
  recordPayment,
  listPaymentsForClassPeriod,
  getFeeSummary,
  syncStudentFeeStatus,
  backfillAllFeeStatuses,
  formatKES,
} from "../js/services/fee.service.js";
import { downloadElementAsPdf, downloadPdfsAsZip, prewarmPdfLibs } from "../js/services/pdf.util.js";
import { openModal } from "../js/components/modal.js";
import { datePickerInput } from "../js/components/datepicker.js";
import { el, icon, toast, formatDate, skeleton, busyButton } from "../js/utils.js";

let classes = [];
let settings = null;
let structures = [];
let selection = { grade: "", stream: "", academicYear: "", term: "" };
let balanceRows = []; // [{ student, expected, paid, balance }]
let searchQuery = "";
let statusFilter = "all"; // "all" | "pending" | "cleared"

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
 * Animated Scholar Accountant mascot with ledger, waving gold coin, and swaying tassel.
 */
export function buildFinanceMascotSvg({ width = 165, height = 150 } = {}) {
  return `
    <svg class="fees-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Finance Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Financial Ledgers Stack -->
        <g class="support-mascot__books">
          <rect x="56" y="174" width="108" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="60" y="177" width="100" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="62" y="162" width="96" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="66" y="165" width="88" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="68" y="150" width="84" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="72" y="153" width="76" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Open Ledger -->
        <g class="fees-mascot__ledger">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="60" y="128" width="26" height="32" rx="3" fill="#FAF6F0" stroke="#14538A" stroke-width="1.4" transform="rotate(-10 73 144)" />
          <line x1="64" y1="134" x2="80" y2="131" stroke="#059669" stroke-width="1.5" />
          <line x1="65" y1="140" x2="81" y2="137" stroke="#94A3B8" stroke-width="1.2" />
          <line x1="66" y1="146" x2="82" y2="143" stroke="#94A3B8" stroke-width="1.2" />
          <line x1="67" y1="152" x2="77" y2="150" stroke="#059669" stroke-width="1.2" />
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Gold Coin -->
        <g class="fees-mascot__arm-coin">
          <path d="M136,128 C148,132 154,120 150,108" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="108" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Eyes (Animated Blink) -->
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

        <!-- Warm Cheerful Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap -->
        <g transform="rotate(-6 110 58)">
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
  [classes, settings, structures] = await Promise.all([listClasses(), getSchoolSettings(), listFeeStructures()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", { class: "fees-page" });

  // 1. Executive Finance Hero Banner
  const mascotWrap = el("div", {
    class: "fees-hero__mascot-wrap",
    style: "width:165px; height:150px; display:flex; align-items:center; justify-content:center; flex-shrink:0;",
    "aria-hidden": "true",
  });
  mascotWrap.innerHTML = buildFinanceMascotSvg({ width: 165, height: 150 });

  const currentYear = settings.currentAcademicYear || new Date().getFullYear();
  const currentTerm = settings.currentTerm || "Term 3";

  const heroBanner = el("div", { class: "fees-hero" }, [
    el("div", { class: "fees-hero__content" }, [
      el("div", { class: "fees-hero__status-row" }, [
        el("div", { class: "fees-cycle-badge" }, [
          icon("calendar_today", "text-sm"),
          `Active Cycle: ${currentYear} · ${currentTerm}`,
        ]),
      ]),
      el("h1", { class: "fees-hero__title" }, "Fee Accounts & Balances"),
      el("p", { class: "fees-hero__desc" }, "Fee structures, student balances, and tuition collection records for your school."),
      el("div", { class: "fees-hero__pills" }, [
        el("div", { class: "fees-pill" }, [icon("price_change"), `${structures.length} Fee Structures Configured`]),
        el("div", { class: "fees-pill" }, [icon("account_balance"), "KES Tuition Ledgers"]),
      ]),
    ]),

    // Animated Mascot & Comic Speech Bubble
    el("div", { class: "fees-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Manage fees, track balances, and generate receipts."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  const structuresCard = el("div", { class: "card", style: "margin-bottom:var(--sp-4);" });
  wrap.append(structuresCard);
  renderStructures(structuresCard, profile);

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const balancesMount = el("div", { style: "margin-top:var(--sp-4);" });
  wrap.append(balancesMount);
  const paymentsMount = el("div", { style: "margin-top:var(--sp-4);" });
  wrap.append(paymentsMount);
  const receiptMount = el("div", { style: "margin-top:var(--sp-4);" });
  wrap.append(receiptMount);

  renderPicker(pickerCard, profile, balancesMount, paymentsMount, receiptMount);
  return wrap;
}

// -------------------------------------------------------- Fee Structures --

function renderStructures(container, profile) {
  container.innerHTML = "";

  const header = el("div", {
    style: "display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:var(--sp-4); flex-wrap:wrap; gap:12px;",
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("price_change", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, "Fee Structures"),
        el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${structures.length} Configured`),
        infoTooltip("Fee Structures", "Defines the standard baseline tuition billed to every active student enrolled in that grade for the specified term."),
      ]),
      el("p", { class: "text-muted text-sm", style: "margin:4px 0 0 0;" }, "Baseline tuition amounts per grade and academic term."),
    ]),
    el("div", { style: "display:flex; gap:8px; align-items:center; flex-wrap:wrap;" }, [
      el("button", {
        type: "button",
        class: "btn btn--ghost btn--sm",
        title: "Sync fee balances across all active student records",
        onClick: (e) => handleBackfillFeeStatus(e.currentTarget),
      }, [icon("sync"), "Sync Fee Balances"]),
      infoTooltip("Fee Status Sync", "Recalculates cached balances for all enrolled students against current fee structures so dashboard counters reflect recent fee edits.", "right"),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => openStructureModal(profile, null, container),
      }, [icon("add"), "Set Fee Structure"]),
    ]),
  ]);
  container.append(header);

  if (!structures.length) {
    const emptyBox = el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
      icon("price_change", "text-muted", "style: font-size:42px;"),
      el("h4", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No fee structures configured yet"),
      el("p", { class: "text-muted text-sm", style: "max-width:380px; margin:0 auto var(--sp-4);" }, "Set standard tuition fees for each grade to calculate student balances and generate fee invoices."),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => openStructureModal(profile, null, container),
      }, [icon("add"), "Set First Fee Structure"]),
    ]);
    container.append(emptyBox);
    return;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", { class: "fees-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:130px;" }, "Grade"),
      el("th", { style: "width:150px;" }, "Academic Year"),
      el("th", { style: "width:130px;" }, "Term"),
      el("th", { class: "col-num", style: "width:160px;" }, "Term Fee"),
      el("th", { class: "col-action-head", style: "width:160px;" }, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of structures) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Grade" }, [
        el("span", {
          class: "badge badge--primary",
          style: "font-weight:700; padding:3px 10px;",
        }, s.grade),
      ]),
      el("td", { "data-label": "Academic Year", style: "font-weight:500;" }, s.academicYear),
      el("td", { "data-label": "Term", style: "font-weight:500;" }, s.term),
      el("td", { class: "col-num", "data-label": "Term Fee" }, [
        el("strong", {
          style: "color:var(--color-primary-900); font-family:var(--font-mono, monospace); font-size:var(--fs-sm);",
        }, formatKES(s.amount)),
      ]),
      el("td", { class: "col-action", "data-label": "Actions" }, [
        el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            title: "Edit this structure",
            onClick: () => openStructureModal(profile, s, container),
          }, [icon("edit", "text-xs"), "Edit"]),
          el("button", {
            type: "button",
            class: "btn btn--ghost btn--xs",
            style: "color:var(--color-danger);",
            title: "Delete this structure",
            onClick: () => handleDeleteStructure(profile, s, container),
          }, [icon("delete", "text-xs"), "Delete"]),
        ]),
      ]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function openStructureModal(profile, existing, structuresContainer) {
  const isEdit = !!existing;
  const body = el("form", {});
  const gradeSelect = el(
    "select",
    { ...(isEdit ? { disabled: "true" } : {}) },
    [el("option", { value: "" }, "Select grade"), ...classes.map((c) =>
      el("option", { value: c.grade, ...(c.grade === existing?.grade ? { selected: "true" } : {}) }, c.grade)
    )]
  );
  const yearInput = el("input", { type: "text", value: existing?.academicYear || settings.currentAcademicYear || "", placeholder: "2026", ...(isEdit ? { disabled: "true" } : {}) });
  const termSelect = el(
    "select",
    { ...(isEdit ? { disabled: "true" } : {}) },
    (settings.terms || []).map((t) => el("option", { value: t, ...(t === (existing?.term || settings.currentTerm) ? { selected: "true" } : {}) }, t))
  );
  const amountInput = el("input", { type: "number", min: "0", step: "1", value: existing?.amount ?? "", placeholder: "e.g. 15000" });

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect]),
    el("div", { class: "field" }, [el("label", {}, "Amount (KES)"), amountInput]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "price_change"), isEdit ? "Save Changes" : "Set Fee Structure"])
  );

  const close = openModal(isEdit ? `Edit Fee Structure: ${existing.grade}` : "Set Fee Structure", body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      await saveFeeStructure(profile.uid, {
        grade: isEdit ? existing.grade : gradeSelect.value,
        academicYear: isEdit ? existing.academicYear : yearInput.value.trim(),
        term: isEdit ? existing.term : termSelect.value,
        amount: amountInput.value,
      });
      structures = await listFeeStructures();
      renderStructures(structuresContainer, profile);
      toast("Fee structure saved.", "success");
      close();
    } catch (err) {
      toast(err.message || "Could not save fee structure.", "error");
      restore();
    }
  });
}

async function handleDeleteStructure(profile, structure, container) {
  if (!confirm(`Delete the ${structure.grade} · ${structure.term} ${structure.academicYear} fee structure?`)) return;
  try {
    await deleteFeeStructure(profile.uid, structure.id);
    structures = await listFeeStructures();
    renderStructures(container, profile);
    toast("Fee structure deleted.", "success");
  } catch (err) {
    toast(err.message || "Could not delete fee structure.", "error");
  }
}

// One-off (or occasional) full resync of student_fee_status for the
// school's current term - the dashboard's "students with balances" count
// only reflects students who've had a payment recorded or a fee structure
// resaved since that summary collection was introduced, so this catches
// everyone else up in one go.
async function handleBackfillFeeStatus(button) {
  const restore = busyButton(button, "Syncing…");
  try {
    const count = await backfillAllFeeStatuses(settings.currentAcademicYear, settings.currentTerm);
    toast(`Synced fee balances for ${count} student(s).`, "success");
  } catch (err) {
    toast(err.message || "Could not sync fee balances.", "error");
  } finally {
    restore();
  }
}

// ------------------------------------------------------ Balances Picker --

function streamOptions(grade) {
  return classes.find((c) => c.grade === grade)?.streams || [];
}

function renderPicker(container, profile, balancesMount, paymentsMount, receiptMount) {
  container.innerHTML = "";

  const header = el("div", { style: "margin-bottom:var(--sp-4);" }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("account_balance_wallet", "text-gold"),
      el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, "Class Fee Balances"),
      infoTooltip("Class Roster Reconciliation", "Select an enrolled class to inspect live tuition collection stats, filter students by balance status, and record payments."),
    ]),
    el("p", { class: "text-muted text-sm", style: "margin:4px 0 0 0;" }, "Select an enrolled class and term to view student balances, fee records, and collection rates."),
  ]);
  container.append(header);

  const form = el("form", { class: "filter-grid", style: "margin-bottom:var(--sp-3);" });

  const gradeSelect = el("select", { "aria-label": "Select Grade" }, [
    el("option", { value: "" }, "Select grade"),
    ...classes.map((c) => el("option", { value: c.grade, ...(c.grade === selection.grade ? { selected: "true" } : {}) }, c.grade)),
  ]);
  const streamSelect = el("select", { "aria-label": "Select Stream" }, [el("option", { value: "" }, "Select stream")]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026", "aria-label": "Academic Year" });
  const termSelect = el("select", { "aria-label": "Select Term" }, (settings.terms || []).map((t) =>
    el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)
  ));

  function refreshStreams() {
    streamSelect.innerHTML = "";
    const opts = streamOptions(gradeSelect.value);
    if (!opts.length && gradeSelect.value) {
      streamSelect.append(el("option", { value: "" }, "No streams"));
      streamSelect.disabled = true;
    } else {
      streamSelect.disabled = false;
      streamSelect.append(el("option", { value: "" }, "Select stream"));
      for (const s of opts) {
        streamSelect.append(el("option", { value: s, ...(s === selection.stream ? { selected: "true" } : {}) }, s));
      }
    }
  }
  refreshStreams();

  gradeSelect.addEventListener("change", () => {
    selection.grade = gradeSelect.value;
    selection.stream = "";
    refreshStreams();
  });
  streamSelect.addEventListener("change", () => { selection.stream = streamSelect.value; });
  yearInput.addEventListener("change", () => { selection.academicYear = yearInput.value.trim(); });
  termSelect.addEventListener("change", () => { selection.term = termSelect.value; });

  form.append(
    el("div", { class: "field" }, [el("label", {}, "Grade"), gradeSelect]),
    el("div", { class: "field" }, [el("label", {}, "Stream"), streamSelect]),
    el("div", { class: "field" }, [el("label", {}, "Academic Year"), yearInput]),
    el("div", { class: "field" }, [el("label", {}, "Term"), termSelect])
  );
  container.append(form);

  const actions = el("div", { class: "filter-actions", style: "display:flex; justify-content:flex-end; gap:8px;" }, [
    el("button", {
      type: "button",
      class: "btn btn--primary btn--sm",
      onClick: () => loadBalances(profile, balancesMount, paymentsMount, receiptMount),
    }, [icon("search"), "Load Balances & Records"]),
  ]);
  container.append(actions);
}

async function loadBalances(profile, balancesMount, paymentsMount, receiptMount) {
  const { grade, stream, academicYear, term } = selection;
  const hasStreams = streamOptions(grade).length > 0;
  if (!grade || (hasStreams && !stream) || !academicYear || !term) {
    return toast("Pick grade, stream, academic year, and term first.", "error");
  }

  balancesMount.innerHTML = "";
  balancesMount.append(el("div", { class: "skeleton-rows", style: "padding:var(--sp-4);" }, [
    skeleton("", "30%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "95%"), skeleton("", "80%"),
  ]));
  paymentsMount.innerHTML = "";
  receiptMount.innerHTML = "";

  try {
    const students = (await listStudents()).filter((s) => s.grade === grade && (s.stream || "") === stream && s.status === "active")
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

    balanceRows = (
      await Promise.all(
        students.map(async (student) => ({
          student,
          ...(await getFeeSummary({ studentId: student.id, grade, academicYear, term })),
        }))
      )
    );
  } catch (err) {
    balancesMount.innerHTML = "";
    balancesMount.append(el("div", { class: "card" }, [
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("wifi_off", "text-muted", "style: font-size:42px;"),
        el("h3", { style: "margin:8px 0 4px;" }, "Could not load data"),
        el("p", { class: "text-muted text-sm" }, err.message || "Please check your internet connection and try again.")
      ])
    ]));
    return;
  }

  // Background fire-and-forget sync
  Promise.all(
    balanceRows.map(({ student, expected, paid, balance }) =>
      syncStudentFeeStatus({ studentId: student.id, grade, academicYear, term, summary: { expected, paid, balance } }).catch(() => {})
    )
  );

  renderBalances(balancesMount, profile, paymentsMount, receiptMount);
  await renderPaymentsHistory(paymentsMount, profile, receiptMount);
}

function exportClassFeeSheetCsv() {
  const { grade, stream, academicYear, term } = selection;
  const header = ["Adm No.", "Student Name", "Grade", "Stream", "Academic Year", "Term", "Expected (KES)", "Paid (KES)", "Balance (KES)", "Status"].join(",");
  const rows = balanceRows.map((r) => {
    const status = (r.balance || 0) <= 0 ? "Cleared" : ((r.paid || 0) > 0 ? "Partial" : "Unpaid");
    return [
      `"${r.student.admissionNumber || ""}"`,
      `"${(r.student.fullName || "").replace(/"/g, '""')}"`,
      `"${grade}"`,
      `"${stream}"`,
      `"${academicYear}"`,
      `"${term}"`,
      r.expected || 0,
      r.paid || 0,
      r.balance || 0,
      `"${status}"`,
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fee_balances_${grade}_${stream}_${term}_${academicYear}.csv`.replace(/\s+/g, "_");
  a.click();
  URL.revokeObjectURL(url);
  toast("Fee balance sheet exported.", "success");
}

function renderBalances(container, profile, paymentsMount, receiptMount) {
  container.innerHTML = "";
  const { grade, stream, academicYear, term } = selection;

  if (!balanceRows.length) {
    container.append(el("div", { class: "card" }, [
      el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("group_off", "text-muted", "style: font-size:42px;"),
        el("h3", { style: "margin:8px 0 4px; color:var(--color-primary-900);" }, "No active students in this class"),
        el("p", { class: "text-muted text-sm" }, "Check the active student roster under the Students module."),
      ])
    ]));
    return;
  }

  // 1. KPI Summary Calculations
  const totalStudents = balanceRows.length;
  const totalExpected = balanceRows.reduce((sum, r) => sum + (r.expected || 0), 0);
  const totalPaid = balanceRows.reduce((sum, r) => sum + (r.paid || 0), 0);
  const totalBalance = balanceRows.reduce((sum, r) => sum + (r.balance || 0), 0);
  const clearedCount = balanceRows.filter((r) => (r.balance || 0) <= 0).length;
  const pendingCount = balanceRows.filter((r) => (r.balance || 0) > 0).length;
  const collectionRate = totalExpected > 0 ? Math.round((totalPaid / totalExpected) * 100) : (totalStudents ? 100 : 0);

  // 2. Render KPI Summary Grid
  const kpiGrid = el("div", { class: "fees-kpi-grid" }, [
    // KPI 1: Total Expected
    el("div", { class: "fees-kpi-card" }, [
      el("div", { class: "fees-kpi-card__head" }, [
        el("span", { class: "fees-kpi-card__label" }, "Total Expected"),
        el("div", { class: "fees-kpi-card__icon fees-kpi-card__icon--blue" }, [icon("account_balance")]),
      ]),
      el("div", { class: "fees-kpi-card__value" }, formatKES(totalExpected)),
      el("div", { class: "fees-kpi-card__sub" }, `${totalStudents} students × standard fee rate`),
    ]),

    // KPI 2: Total Collected
    el("div", { class: "fees-kpi-card" }, [
      el("div", { class: "fees-kpi-card__head" }, [
        el("span", { class: "fees-kpi-card__label" }, "Total Collected"),
        el("div", { class: "fees-kpi-card__icon fees-kpi-card__icon--green" }, [icon("payments")]),
      ]),
      el("div", { class: "fees-kpi-card__value fees-kpi-card__value--success" }, formatKES(totalPaid)),
      el("div", { class: "fees-kpi-card__sub" }, `Payments recorded in ${term}`),
    ]),

    // KPI 3: Outstanding Balance
    el("div", { class: "fees-kpi-card" }, [
      el("div", { class: "fees-kpi-card__head" }, [
        el("span", { class: "fees-kpi-card__label" }, "Outstanding Balance"),
        el("div", { class: "fees-kpi-card__icon fees-kpi-card__icon--amber" }, [icon("receipt_long")]),
      ]),
      el("div", {
        class: `fees-kpi-card__value ${totalBalance > 0 ? "fees-kpi-card__value--danger" : "fees-kpi-card__value--success"}`,
      }, formatKES(totalBalance)),
      el("div", { class: "fees-kpi-card__sub" }, `${pendingCount} student(s) with pending balances`),
    ]),

    // KPI 4: Collection Rate
    el("div", { class: "fees-kpi-card" }, [
      el("div", { class: "fees-kpi-card__head" }, [
        el("span", { class: "fees-kpi-card__label" }, "Collection Rate"),
        el("div", { class: "fees-kpi-card__icon fees-kpi-card__icon--purple" }, [icon("donut_large")]),
      ]),
      el("div", { class: "fees-kpi-card__value" }, `${collectionRate}%`),
      el("div", { class: "fees-kpi-card__sub" }, `${clearedCount} of ${totalStudents} students cleared`),
      el("div", { class: "fees-progress-track" }, [
        el("div", { class: "fees-progress-fill", style: `width:${Math.min(100, Math.max(0, collectionRate))}%;` }),
      ]),
    ]),
  ]);
  container.append(kpiGrid);

  // 3. Render Student Roster Card
  const rosterCard = el("div", { class: "card" });

  const rosterHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:var(--sp-4);",
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("groups", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, `${grade} ${stream}`),
        el("span", { class: "badge badge--neutral" }, `${term} ${academicYear}`),
      ]),
      el("p", { class: "text-muted text-sm", style: "margin:4px 0 0 0;" }, `${totalStudents} active student records in this class roster.`),
    ]),
    el("button", {
      type: "button",
      class: "btn btn--ghost btn--sm",
      onClick: () => exportClassFeeSheetCsv(),
    }, [icon("download"), "Export Sheet (CSV)"]),
  ]);
  rosterCard.append(rosterHeader);

  // 4. Toolbar: Search + Status Filter Tabs
  const searchInput = el("input", {
    type: "text",
    placeholder: "Search by student name or admission no…",
    value: searchQuery,
  });

  const filterTabsContainer = el("div", { class: "fees-status-filter" });
  const filterOptions = [
    { id: "all", label: `All (${totalStudents})` },
    { id: "pending", label: `With Balance (${pendingCount})` },
    { id: "cleared", label: `Cleared (${clearedCount})` },
  ];

  function updateStatusButtons() {
    filterTabsContainer.innerHTML = "";
    for (const opt of filterOptions) {
      const btn = el("button", {
        type: "button",
        class: `fees-status-btn ${statusFilter === opt.id ? "fees-status-btn--active" : ""}`,
        onClick: () => {
          statusFilter = opt.id;
          updateStatusButtons();
          renderRosterRows(tbody);
        },
      }, opt.label);
      filterTabsContainer.append(btn);
    }
  }
  updateStatusButtons();

  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderRosterRows(tbody);
  });

  const toolbar = el("div", { class: "fees-roster-toolbar" }, [
    el("div", { class: "fees-search-wrap" }, [
      icon("search"),
      searchInput,
    ]),
    filterTabsContainer,
  ]);
  rosterCard.append(toolbar);

  // 5. Roster Table
  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", { class: "fees-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:115px;" }, "Adm No."),
      el("th", { style: "min-width:170px;" }, "Student Name"),
      el("th", { class: "col-num", style: "width:130px;" }, "Expected"),
      el("th", { class: "col-num", style: "width:130px;" }, "Paid"),
      el("th", { class: "col-num", style: "width:130px;" }, "Balance"),
      el("th", { class: "col-center", style: "width:105px;" }, "Status"),
      el("th", { class: "col-action-head", style: "width:155px;" }, "Action"),
    ])),
  ]);
  const tbody = el("tbody", {});

  function renderRosterRows(targetTbody) {
    targetTbody.innerHTML = "";
    const query = searchQuery;
    const filtered = balanceRows.filter((row) => {
      const matchSearch =
        !query ||
        (row.student.fullName || "").toLowerCase().includes(query) ||
        (row.student.admissionNumber || "").toLowerCase().includes(query);
      if (!matchSearch) return false;

      const bal = row.balance || 0;
      if (statusFilter === "pending") return bal > 0;
      if (statusFilter === "cleared") return bal <= 0;
      return true;
    });

    if (!filtered.length) {
      targetTbody.append(
        el("tr", {}, [
          el("td", { colspan: "7", style: "text-align:center; padding:var(--sp-5); color:var(--color-ink-soft);" }, [
            icon("search_off", "", "style: vertical-align:middle; margin-right:4px;"),
            "No students match the active search or filter criteria.",
          ]),
        ])
      );
      return;
    }

    for (const row of filtered) {
      const { student, expected, paid, balance } = row;
      const isCleared = (balance || 0) <= 0;
      const isPartial = (paid || 0) > 0 && !isCleared;

      let statusPill;
      if (isCleared) {
        statusPill = el("span", { class: "badge badge--success", style: "display:inline-flex; align-items:center; gap:4px; font-weight:600;" }, [
          icon("check_circle", "text-xs"), "Cleared",
        ]);
      } else if (isPartial) {
        statusPill = el("span", { class: "badge badge--warning", style: "display:inline-flex; align-items:center; gap:4px; font-weight:600;" }, [
          icon("schedule", "text-xs"), "Partial",
        ]);
      } else {
        statusPill = el("span", { class: "badge badge--danger", style: "display:inline-flex; align-items:center; gap:4px; font-weight:600;" }, [
          icon("error_outline", "text-xs"), "Unpaid",
        ]);
      }

      const paidColor = (paid || 0) > 0 ? "#059669" : "var(--color-ink-soft)";
      const paidWeight = (paid || 0) > 0 ? "600" : "400";
      const balColor = isCleared ? "#059669" : "#dc2626";

      targetTbody.append(el("tr", {}, [
        el("td", { "data-label": "Adm No." }, [
          el("span", { style: "font-family:var(--font-mono, monospace); font-weight:600; color:var(--color-ink-soft); font-size:var(--fs-xs);" }, student.admissionNumber || "—"),
        ]),
        el("td", { "data-label": "Student Name" }, [
          el("strong", { style: "color:var(--color-primary-900); font-size:var(--fs-sm);" }, student.fullName),
        ]),
        el("td", { class: "col-num", "data-label": "Expected", style: "font-family:var(--font-mono, monospace); font-size:var(--fs-xs); color:var(--color-ink); font-weight:500;" }, formatKES(expected)),
        el("td", { class: "col-num", "data-label": "Paid", style: `font-family:var(--font-mono, monospace); font-size:var(--fs-xs); color:${paidColor}; font-weight:${paidWeight};` }, formatKES(paid)),
        el("td", { class: "col-num", "data-label": "Balance" }, [
          el("strong", {
            style: `font-family:var(--font-mono, monospace); font-size:var(--fs-xs); color:${balColor};`,
          }, formatKES(balance)),
        ]),
        el("td", { class: "col-center", "data-label": "Status" }, statusPill),
        el("td", { class: "col-action", "data-label": "Action" }, [
          el("button", {
            type: "button",
            class: `btn ${isCleared ? "btn--ghost" : "btn--primary"} btn--xs fees-pay-btn`,
            title: isCleared ? `Record additional payment for ${student.fullName}` : `Record payment for ${student.fullName}`,
            onClick: () => openPaymentModal(profile, row, container, paymentsMount, receiptMount),
          }, [icon(isCleared ? "receipt_long" : "payments", "text-xs"), isCleared ? "Add Payment" : "Record Payment"]),
        ]),
      ]));
    }
  }

  renderRosterRows(tbody);
  table.append(tbody);
  tableWrap.append(table);
  rosterCard.append(tableWrap);
  container.append(rosterCard);
}

function openPaymentModal(profile, rowData, balancesContainer, paymentsMount, receiptMount) {
  const { student, balance, expected } = rowData;
  const { grade, stream, academicYear, term } = selection;

  const body = el("form", {});

  // Context card with balance indicator
  const contextCard = el("div", { class: "modal-student-context" }, [
    el("div", {}, [
      el("strong", { style: "color:var(--color-primary-900); font-size:var(--fs-sm); display:block;" }, student.fullName),
      el("span", { class: "text-muted text-xs" }, `Adm No: ${student.admissionNumber || "—"} · ${grade} ${stream} · ${term} ${academicYear}`),
    ]),
    el("div", { style: "text-align:right;" }, [
      el("span", { class: "text-muted text-xs", style: "display:block;" }, "Outstanding Balance"),
      el("span", {
        class: `badge badge--${(balance || 0) > 0 ? "danger" : "success"}`,
        style: "font-weight:700; font-family:var(--font-mono, monospace);",
      }, formatKES(balance)),
    ]),
  ]);

  const amountInput = el("input", {
    type: "number",
    min: "1",
    step: "1",
    placeholder: "e.g. 5000",
    required: "true",
  });

  const methodSelect = el("select", {}, PAYMENT_METHODS.map((m) => el("option", { value: m }, m)));
  const referenceInput = el("input", { type: "text", placeholder: "e.g. QKH782GH19 / Receipt ref" });

  let paymentDate = new Date().toISOString().slice(0, 10);
  const datePickerWrap = datePickerInput(
    { value: paymentDate },
    {
      onChange: (selectedDates, dateStr) => {
        paymentDate = dateStr;
      },
    }
  );

  // Quick fill remaining balance chip
  const quickFillRow = el("div", { style: "margin-bottom:8px; display:flex; gap:6px; flex-wrap:wrap;" });
  if ((balance || 0) > 0) {
    const fillBtn = el("button", {
      type: "button",
      class: "btn btn--ghost btn--xs",
      style: "font-size:11px; padding:2px 8px;",
      onClick: () => {
        amountInput.value = balance;
      },
    }, [icon("paid", "text-xs"), `Fill Remaining: ${formatKES(balance)}`]);
    quickFillRow.append(fillBtn);
  }

  body.append(
    contextCard,
    el("div", { class: "field" }, [
      el("label", {}, "Amount to Pay (KES)"),
      quickFillRow,
      amountInput,
    ]),
    el("div", { class: "field" }, [el("label", {}, "Payment Channel"), methodSelect]),
    el("div", { class: "field" }, [el("label", {}, "Reference Code (Optional)"), referenceInput]),
    el("div", { class: "field" }, [el("label", {}, "Transaction Date"), datePickerWrap]),
    el("button", { type: "submit", class: "btn btn--primary btn--block", style: "margin-top:var(--sp-3);" }, [
      icon("payments"),
      "Record & Issue Receipt",
    ])
  );

  const close = openModal(`Record Payment: ${student.fullName}`, body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Recording…");
    let paymentId;
    try {
      paymentId = await recordPayment(profile.uid, {
        studentId: student.id,
        studentName: student.fullName,
        grade,
        stream,
        academicYear,
        term,
        amount: amountInput.value,
        method: methodSelect.value,
        reference: referenceInput.value.trim(),
        date: paymentDate,
      });
    } catch (err) {
      toast(err.message || "Could not record payment.", "error");
      restore();
      return;
    }

    toast("Payment recorded successfully.", "success");
    close();

    try {
      await loadBalances(profile, balancesContainer, paymentsMount, receiptMount);
      const payment = (await listPaymentsForClassPeriod(grade, stream, academicYear, term)).find((p) => p.id === paymentId);
      if (payment) renderReceipt(receiptMount, payment);
    } catch (refreshErr) {
      console.warn("Post-payment view refresh skipped:", refreshErr);
    }
  });
}

function renderPaymentMethodBadge(method) {
  const m = (method || "").toLowerCase();
  let mod = "cash";
  let iconName = "payments";
  if (m.includes("mpesa") || m.includes("m-pesa")) {
    mod = "mpesa";
    iconName = "phone_android";
  } else if (m.includes("bank") || m.includes("transfer")) {
    mod = "bank";
    iconName = "account_balance";
  } else if (m.includes("cheque")) {
    mod = "cheque";
    iconName = "receipt";
  }
  return el("span", { class: `payment-method-chip payment-method-chip--${mod}` }, [
    icon(iconName, "text-xs"),
    method || "Cash",
  ]);
}

// -------------------------------------------------------- Payment History --

async function renderPaymentsHistory(container, profile, receiptMount) {
  container.innerHTML = "";
  const { grade, stream, academicYear, term } = selection;
  const payments = await listPaymentsForClassPeriod(grade, stream, academicYear, term);
  if (!payments.length) return;

  const card = el("div", { class: "card" });
  const headerRow = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:var(--sp-4);",
  }, [
    el("div", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        icon("receipt_long", "text-gold"),
        el("h3", { style: "margin:0; font-family:var(--font-display); color:var(--color-primary-900);" }, "Recent Class Receipts"),
        el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${payments.length} Payments`),
      ]),
      el("p", { class: "text-muted text-sm", style: "margin:4px 0 0 0;" }, `Audited payment transactions recorded for ${grade} ${stream} in ${term} ${academicYear}.`),
    ]),
  ]);

  const bulkBtn = el("button", {
    type: "button",
    class: "btn btn--ghost btn--sm",
    title: "Download all payment receipts for this class as a ZIP archive",
  }, [icon("folder_zip"), `Download All Receipts (ZIP)`]);
  bulkBtn.addEventListener("click", () => handleBulkReceiptDownload(bulkBtn, payments));
  headerRow.append(bulkBtn);
  card.append(headerRow);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  const table = el("table", { class: "fees-table" }, [
    el("thead", {}, el("tr", {}, [
      el("th", { style: "width:130px;" }, "Date"),
      el("th", { style: "min-width:160px;" }, "Student"),
      el("th", { class: "col-num", style: "width:130px;" }, "Amount"),
      el("th", { style: "width:130px;" }, "Channel"),
      el("th", { style: "width:140px;" }, "Reference"),
      el("th", { class: "col-action-head", style: "width:120px;" }, "Action"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const p of payments.slice(0, 30)) {
    tbody.append(el("tr", {}, [
      el("td", { "data-label": "Date", style: "font-size:var(--fs-xs); color:var(--color-ink-soft);" }, [
        el("span", { style: "display:inline-flex; align-items:center; gap:4px;" }, [
          icon("calendar_today", "text-xs"),
          formatDate(p.date),
        ]),
      ]),
      el("td", { "data-label": "Student" }, [
        el("strong", { style: "color:var(--color-primary-900);" }, p.studentName || "N/A"),
      ]),
      el("td", { class: "col-num", "data-label": "Amount" }, [
        el("strong", { style: "color:var(--color-primary-900); font-family:var(--font-mono, monospace); font-size:var(--fs-xs);" }, formatKES(p.amount)),
      ]),
      el("td", { "data-label": "Channel" }, renderPaymentMethodBadge(p.method)),
      el("td", { "data-label": "Reference" }, [
        p.reference
          ? el("span", { style: "font-family:var(--font-mono, monospace); font-size:var(--fs-xs); background:var(--color-cream-dim); padding:2px 6px; border-radius:var(--radius-sm);" }, p.reference)
          : el("span", { class: "text-muted text-xs" }, "—"),
      ]),
      el("td", { class: "col-action", "data-label": "Action" }, [
        el("button", {
          type: "button",
          class: "btn btn--ghost btn--xs fees-pay-btn",
          title: "View printable receipt",
          onClick: () => renderReceipt(receiptMount, p),
        }, [icon("receipt_long", "text-xs"), "Receipt"]),
      ]),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  container.append(card);
}

// -------------------------------------------------------------- Receipt --

async function handleBulkReceiptDownload(button, payments) {
  if (!payments.length) return;
  const original = button.textContent;
  button.disabled = true;
  const offscreen = el("div", { style: "position:fixed; left:-10000px; top:0; width:420px;" });
  document.body.appendChild(offscreen);
  try {
    const { grade, stream, academicYear, term } = selection;
    const items = payments.map((p) => ({
      filename: `receipt_${(p.studentName || "student").replace(/\s+/g, "_")}_${p.date}_${p.id.slice(0, 6)}.pdf`,
      build: () => {
        offscreen.innerHTML = "";
        const card = buildReceiptCard(p);
        offscreen.appendChild(card);
        return card;
      },
    }));
    await downloadPdfsAsZip(
      items,
      `Receipts_${grade}_${stream}_${term}_${academicYear}.zip`,
      { onProgress: (done, total) => { button.textContent = `Preparing ${done}/${total}…`; } }
    );
    toast(`Downloaded ${payments.length} receipt(s).`, "success");
  } catch (err) {
    toast(err.message || "Could not generate the ZIP.", "error");
  } finally {
    offscreen.remove();
    button.disabled = false;
    button.textContent = original;
  }
}

function buildReceiptCard(payment) {
  const card = el("div", { class: "receipt" });
  card.append(
    el("div", { class: "receipt__header" }, [
      el("img", { class: "receipt__logo", src: settings.logoUrl || "/assets/logo.png", alt: "logo" }),
      el("div", {}, [
        el("h3", { class: "receipt__school-name" }, settings.schoolName || "School Name"),
        el("p", { class: "receipt__address" }, settings.address || ""),
      ]),
    ]),
    el("div", { class: "receipt__banner" }, "FEE PAYMENT RECEIPT"),
    el("div", { class: "receipt__row" }, [el("span", {}, "Receipt No."), el("b", {}, payment.id.slice(0, 10).toUpperCase())]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Date"), el("b", {}, formatDate(payment.date))]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Student"), el("b", {}, payment.studentName || "N/A")]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Class"), el("b", {}, `${payment.grade} ${payment.stream}`)]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Term"), el("b", {}, `${payment.term} ${payment.academicYear}`)]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Method"), el("b", {}, payment.method || "N/A")]),
    ...(payment.reference ? [el("div", { class: "receipt__row" }, [el("span", {}, "Reference"), el("b", {}, payment.reference)])] : []),
    el("div", { class: "receipt__amount" }, formatKES(payment.amount)),
    el("div", { class: "receipt__footer" }, "Thank you. Keep this receipt for your records.")
  );
  return card;
}

function renderReceipt(container, payment) {
  container.innerHTML = "";
  const card = buildReceiptCard(payment);

  const actions = el("div", { class: "no-print", style: "display:flex; gap:8px; justify-content:center; margin-top:12px;" }, [
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => window.print() }, [icon("print"), "Print"]),
    el("button", { class: "btn btn--primary btn--sm", onClick: (e) => handleDownload(e.currentTarget, card, payment) }, [icon("download"), "Download PDF"]),
  ]);

  container.append(card, actions);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function handleDownload(btn, node, payment) {
  const button = btn?.closest?.("button") || btn;
  if (!button) return;
  const restore = busyButton(button, "Preparing…");
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    await downloadElementAsPdf(node, `receipt_${(payment.studentName || "student").replace(/\s+/g, "_")}_${payment.date}.pdf`);
  } catch {
    toast("Could not generate the PDF.", "error");
  } finally {
    restore();
  }
}

export function init() {
  prewarmPdfLibs();
}