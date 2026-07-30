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
  formatKES,
} from "../js/services/fee.service.js";
import { downloadElementAsPdf } from "../js/services/pdf.util.js";
import { openModal } from "../js/components/modal.js";
import { el, toast, formatDate } from "../js/utils.js";

let classes = [];
let settings = null;
let structures = [];
let selection = { grade: "", stream: "", academicYear: "", term: "" };
let balanceRows = []; // [{ student, expected, paid, balance }]

export async function render({ profile }) {
  [classes, settings, structures] = await Promise.all([listClasses(), getSchoolSettings(), listFeeStructures()]);
  selection.academicYear = selection.academicYear || settings.currentAcademicYear || "";
  selection.term = selection.term || settings.currentTerm || (settings.terms || [])[0] || "";

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, "Fee Management"), el("p", {}, "Set fee structures per grade and term, record payments, and print receipts.")]),
    ])
  );

  const structuresCard = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(structuresCard);
  renderStructures(structuresCard, profile);

  const pickerCard = el("div", { class: "card" });
  wrap.append(pickerCard);
  const balancesMount = el("div", { style: "margin-top:16px;" });
  wrap.append(balancesMount);
  const paymentsMount = el("div", { style: "margin-top:16px;" });
  wrap.append(paymentsMount);
  const receiptMount = el("div", { style: "margin-top:16px;" });
  wrap.append(receiptMount);

  renderPicker(pickerCard, profile, balancesMount, paymentsMount, receiptMount);
  return wrap;
}

// -------------------------------------------------------- Fee Structures --

function renderStructures(container, profile) {
  container.innerHTML = "";
  container.append(
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;" }, [
      el("h3", { style: "margin:0;" }, "Fee Structures"),
      el("button", { class: "btn btn--primary btn--sm", onClick: () => openStructureModal(profile, null, container) }, "Set Fee Structure"),
    ])
  );

  if (!structures.length) {
    container.append(el("p", { class: "text-muted" }, "No fee structures set yet — add one per grade per term."));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Grade"), el("th", {}, "Academic Year"), el("th", {}, "Term"), el("th", {}, "Amount"), el("th", {}, "Actions"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const s of structures) {
    tbody.append(el("tr", {}, [
      el("td", {}, s.grade),
      el("td", {}, s.academicYear),
      el("td", {}, s.term),
      el("td", {}, formatKES(s.amount)),
      el("td", {}, [
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => openStructureModal(profile, s, container) }, "Edit"),
        " ",
        el("button", { class: "btn btn--ghost btn--sm", onClick: () => handleDeleteStructure(profile, s, container) }, "Delete"),
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
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, isEdit ? "Save Changes" : "Set Fee Structure")
  );

  const close = openModal(isEdit ? `Edit Fee Structure — ${existing.grade}` : "Set Fee Structure", body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
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

// ------------------------------------------------------ Balances Picker --

function streamOptions(grade) {
  return classes.find((c) => c.grade === grade)?.streams || [];
}

function renderPicker(container, profile, balancesMount, paymentsMount, receiptMount) {
  container.innerHTML = "";
  container.append(el("h3", { style: "margin:0 0 16px;" }, "Class Fee Balances"));
  const row = el("div", { style: "display:grid; grid-template-columns: repeat(4, 1fr); gap:16px; align-items:end;" });

  const gradeSelect = el("select", {}, [
    el("option", { value: "" }, "Select grade"),
    ...classes.map((c) => el("option", { value: c.grade, ...(c.grade === selection.grade ? { selected: "true" } : {}) }, c.grade)),
  ]);
  const streamSelect = el("select", {}, [el("option", { value: "" }, "Select stream")]);
  const yearInput = el("input", { type: "text", value: selection.academicYear, placeholder: "2026" });
  const termSelect = el("select", {}, (settings.terms || []).map((t) =>
    el("option", { value: t, ...(t === selection.term ? { selected: "true" } : {}) }, t)
  ));

  function refreshStreams() {
    streamSelect.innerHTML = "";
    streamSelect.append(el("option", { value: "" }, "Select stream"));
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
    el("button", {
      class: "btn btn--primary", style: "margin-top:16px;",
      onClick: () => loadBalances(profile, balancesMount, paymentsMount, receiptMount),
    }, "Load Balances")
  );
}

async function loadBalances(profile, balancesMount, paymentsMount, receiptMount) {
  const { grade, stream, academicYear, term } = selection;
  if (!grade || !stream || !academicYear || !term) {
    return toast("Pick grade, stream, academic year, and term first.", "error");
  }
  balancesMount.innerHTML = `<div class="empty-state">Loading roster…</div>`;
  paymentsMount.innerHTML = "";
  receiptMount.innerHTML = "";

  const students = (await listStudents()).filter((s) => s.grade === grade && s.stream === stream && s.status === "active")
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  balanceRows = [];
  for (const student of students) {
    const summary = await getFeeSummary({ studentId: student.id, grade, academicYear, term });
    balanceRows.push({ student, ...summary });
  }

  renderBalances(balancesMount, profile, paymentsMount, receiptMount);
  await renderPaymentsHistory(paymentsMount, profile, receiptMount);
}

function renderBalances(container, profile, paymentsMount, receiptMount) {
  container.innerHTML = "";
  const { grade, stream, academicYear, term } = selection;

  container.append(el("h3", { style: "margin:0 0 4px;" }, `${grade} ${stream} — ${term} ${academicYear}`));

  if (!balanceRows.length) {
    container.append(el("div", { class: "empty-state" }, [
      el("h3", {}, "No active students in this class"),
      el("p", {}, "Check the class roster under Students."),
    ]));
    return;
  }

  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Adm No."), el("th", {}, "Name"), el("th", {}, "Expected"), el("th", {}, "Paid"), el("th", {}, "Balance"), el("th", {}, "Action"),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const row of balanceRows) {
    const { student, expected, paid, balance } = row;
    tbody.append(el("tr", {}, [
      el("td", {}, student.admissionNumber || "—"),
      el("td", {}, student.fullName),
      el("td", {}, formatKES(expected)),
      el("td", {}, formatKES(paid)),
      el("td", {}, [
        el("span", { class: `badge badge--${balance > 0 ? "danger" : "success"}` }, formatKES(balance)),
      ]),
      el("td", {}, el("button", {
        class: "btn btn--primary btn--sm",
        onClick: () => openPaymentModal(profile, student, container, paymentsMount, receiptMount),
      }, "Record Payment")),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);
}

function openPaymentModal(profile, student, balancesContainer, paymentsMount, receiptMount) {
  const { grade, stream, academicYear, term } = selection;
  const body = el("form", {});
  const amountInput = el("input", { type: "number", min: "1", step: "1", placeholder: "e.g. 5000" });
  const methodSelect = el("select", {}, PAYMENT_METHODS.map((m) => el("option", { value: m }, m)));
  const referenceInput = el("input", { type: "text", placeholder: "M-Pesa code / receipt ref (optional)" });
  const dateInput = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });

  body.append(
    el("p", { class: "text-muted" }, `${student.fullName} · ${grade} ${stream} · ${term} ${academicYear}`),
    el("div", { class: "field" }, [el("label", {}, "Amount (KES)"), amountInput]),
    el("div", { class: "field" }, [el("label", {}, "Method"), methodSelect]),
    el("div", { class: "field" }, [el("label", {}, "Reference"), referenceInput]),
    el("div", { class: "field" }, [el("label", {}, "Date"), dateInput]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, "Record Payment")
  );

  const close = openModal("Record Payment", body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const paymentId = await recordPayment(profile.uid, {
        studentId: student.id,
        studentName: student.fullName,
        grade, stream, academicYear, term,
        amount: amountInput.value,
        method: methodSelect.value,
        reference: referenceInput.value.trim(),
        date: dateInput.value,
      });
      toast("Payment recorded.", "success");
      close();
      await loadBalances(profile, balancesContainer, paymentsMount, receiptMount);
      const payment = (await listPaymentsForClassPeriod(grade, stream, academicYear, term)).find((p) => p.id === paymentId);
      if (payment) renderReceipt(receiptMount, payment);
    } catch (err) {
      toast(err.message || "Could not record payment.", "error");
    }
  });
}

// -------------------------------------------------------- Payment History --

async function renderPaymentsHistory(container, profile, receiptMount) {
  container.innerHTML = "";
  const { grade, stream, academicYear, term } = selection;
  const payments = await listPaymentsForClassPeriod(grade, stream, academicYear, term);
  if (!payments.length) return;

  const card = el("div", { class: "card" });
  card.append(el("h3", { style: "margin:0 0 16px;" }, "Recent Payments"));
  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Date"), el("th", {}, "Student"), el("th", {}, "Amount"), el("th", {}, "Method"), el("th", {}, "Reference"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody", {});
  for (const p of payments.slice(0, 25)) {
    tbody.append(el("tr", {}, [
      el("td", {}, formatDate(p.date)),
      el("td", {}, p.studentName || "—"),
      el("td", {}, formatKES(p.amount)),
      el("td", {}, p.method || "—"),
      el("td", {}, p.reference || "—"),
      el("td", {}, el("button", { class: "btn btn--ghost btn--sm", onClick: () => renderReceipt(receiptMount, p) }, "View Receipt")),
    ]));
  }
  table.append(tbody);
  tableWrap.append(table);
  card.append(tableWrap);
  container.append(card);
}

// -------------------------------------------------------------- Receipt --

function renderReceipt(container, payment) {
  container.innerHTML = "";
  const card = el("div", { class: "receipt" });
  card.append(
    el("div", { class: "receipt__header" }, [
      ...(settings.logoUrl ? [el("img", { class: "receipt__logo", src: settings.logoUrl, alt: "logo" })] : []),
      el("div", {}, [
        el("h3", { class: "receipt__school-name" }, settings.schoolName || "School Name"),
        el("p", { class: "receipt__address" }, settings.address || ""),
      ]),
    ]),
    el("div", { class: "receipt__banner" }, "FEE PAYMENT RECEIPT"),
    el("div", { class: "receipt__row" }, [el("span", {}, "Receipt No."), el("b", {}, payment.id.slice(0, 10).toUpperCase())]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Date"), el("b", {}, formatDate(payment.date))]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Student"), el("b", {}, payment.studentName || "—")]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Class"), el("b", {}, `${payment.grade} ${payment.stream}`)]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Term"), el("b", {}, `${payment.term} ${payment.academicYear}`)]),
    el("div", { class: "receipt__row" }, [el("span", {}, "Method"), el("b", {}, payment.method || "—")]),
    ...(payment.reference ? [el("div", { class: "receipt__row" }, [el("span", {}, "Reference"), el("b", {}, payment.reference)])] : []),
    el("div", { class: "receipt__amount" }, formatKES(payment.amount)),
    el("div", { class: "receipt__footer" }, "Thank you. Keep this receipt for your records.")
  );

  const actions = el("div", { class: "no-print", style: "display:flex; gap:8px; justify-content:center; margin-top:12px;" }, [
    el("button", { class: "btn btn--ghost btn--sm", onClick: () => window.print() }, "Print"),
    el("button", { class: "btn btn--primary btn--sm", onClick: (e) => handleDownload(e.target, card, payment) }, "Download PDF"),
  ]);

  container.append(card, actions);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function handleDownload(button, node, payment) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await downloadElementAsPdf(node, `receipt_${(payment.studentName || "student").replace(/\s+/g, "_")}_${payment.date}.pdf`);
  } catch {
    toast("Could not generate the PDF.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Download PDF";
  }
}

export function init() {}
