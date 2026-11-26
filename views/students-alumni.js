import { openModal } from "../js/components/modal.js";
import { listAlumni, listAlumniCertificates, issueAlumniCertificate, CERTIFICATE_TYPES } from "../js/services/alumni.service.js";
import { downloadAlumniCertificate, downloadSavedAlumniReport, formatCertificateDate } from "../js/services/alumni-pdf.js";
import { getCurrentSchool } from "../js/services/auth.service.js";
import { listResultsForStudent, reportModeLabel } from "../js/services/grading.service.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { busyButton, el, icon, toast } from "../js/utils.js";

const PAGE_SIZE = 50;
const UNKNOWN_YEAR = "__unknown";

function button(label, onClick, primary = false) {
  return el("button", { type: "button", class: `btn btn--sm btn--${primary ? "primary" : "ghost"}`, onClick }, label);
}

function recordRow(title, detail, action) {
  return el("li", { class: "alumni-document-row" }, [
    el("div", {}, [el("strong", {}, title), el("p", { class: "text-muted text-sm" }, detail)]),
    action,
  ]);
}

async function download(button, work) {
  const restore = busyButton(button, "Preparing PDF…");
  try {
    await work();
  } catch {
    toast("Couldn’t prepare the PDF. Please try again.", "error");
  } finally {
    restore();
  }
}

function openDocuments(graduate, trigger) {
  const body = el("div", { class: "alumni-documents" });
  const status = el("p", { role: "status", class: "text-sm" });
  const view = el("div", { class: "alumni-documents" });
  body.append(status, view);
  const close = openModal({
    title: "Documents for " + (graduate.fullName || "graduate"), body, maxWidth: "720px",
    onClose: () => { if (trigger.isConnected) trigger.focus(); },
  });
  const modal = body.closest(".modal");
  const title = modal.querySelector("h3");
  title.id = "alumni-documents-title";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", title.id);
  title.tabIndex = -1;
  title.focus();
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll("button:not(:disabled)")];
    const focused = controls.indexOf(document.activeElement);
    if (event.shiftKey ? focused <= 0 : focused === controls.length - 1) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
    }
  });

  let reports = null;
  let certificates = null;
  const canExportReport = () => getCurrentSchool()?.canComputeOrGenerate !== false;
  const heading = (text) => el("h4", { tabindex: "-1" }, text);

  async function load() {
    status.textContent = "Loading documents…";
    const [result, documents] = await Promise.allSettled([
      listResultsForStudent(graduate.studentId), listAlumniCertificates(graduate.studentId),
    ]);
    if (!body.isConnected) return;
    reports = result.status === "fulfilled" ? result.value.sort((a, b) =>
      `${b.academicYear} ${b.term}`.localeCompare(`${a.academicYear} ${a.term}`, undefined, { numeric: true })) : null;
    certificates = documents.status === "fulfilled" ? documents.value : null;
    status.textContent = "";
    showDocuments();
  }

  function showDocuments() {
    const certificateList = Object.entries(CERTIFICATE_TYPES).map(([type, label]) => {
      const issued = certificates?.find((item) => item.type === type);
      const action = issued
        ? button("Reprint PDF", (event) => download(event.currentTarget, () => downloadAlumniCertificate(issued)))
        : button("Review & Issue", () => reviewCertificate(type));
      action.setAttribute("aria-label", (issued ? "Reprint " : "Review and issue ") + label);
      return recordRow(label, issued ? `${issued.number} · ${formatCertificateDate(issued.issuedAt)}` : "Available to issue", action);
    });
    const reportList = reports?.map((result) => {
      const action = button("Download PDF", (event) => {
        if (canExportReport()) download(event.currentTarget, async () => {
          const settings = await getSchoolSettings();
          if (canExportReport()) await downloadSavedAlumniReport(result, settings);
        });
      });
      action.disabled = !canExportReport();
      action.setAttribute("aria-label", `Download report card for ${result.term} ${result.academicYear}, ${reportModeLabel(result.reportMode)}`);
      return recordRow(`${result.term} ${result.academicYear} · ${reportModeLabel(result.reportMode)}`,
        [result.grade, result.stream].filter(Boolean).join(" · "), action);
    });
    view.replaceChildren(
      el("section", {}, [
        heading("Certificates"),
        certificates ? el("ul", { class: "alumni-document-list" }, certificateList)
          : el("p", { class: "text-muted text-sm" }, "Couldn’t load issued certificates."),
      ]),
      el("section", {}, [
        heading("Saved report cards"),
        !canExportReport() ? el("p", { class: "text-muted text-sm" }, "Report downloads require an active school subscription.") : null,
        reports?.length ? el("ul", { class: "alumni-document-list" }, reportList)
          : el("p", { class: "text-muted text-sm" }, reports ? "No saved report cards for this learner." : "Couldn’t load the saved reports."),
      ]),
      el("div", { class: "alumni-document-actions" }, [
        reports === null || certificates === null ? button("Retry", load) : null,
        button("Done", () => close()),
      ]),
    );
  }

  function reviewCertificate(type) {
    status.textContent = "";
    const reviewTitle = heading(CERTIFICATE_TYPES[type]);
    const fields = [
      ["Learner", graduate.fullName],
      ["Admission number", graduate.admissionNumber],
      ["Class at graduation", [graduate.grade, graduate.stream].filter(Boolean).join(" · ")],
      ["Graduation year", graduate.graduationYear],
    ];
    const back = button("Back to Documents", () => { showDocuments(); view.querySelector("h4").focus(); });
    const issue = button("Issue Certificate", async () => {
      const restore = busyButton(issue, "Issuing…");
      back.disabled = true;
      status.textContent = "";
      try {
        const certificate = await issueAlumniCertificate(graduate, type);
        if (!body.isConnected) return;
        certificates = [...certificates.filter(({ type: current }) => current !== type), certificate];
        showDocuments();
        status.textContent = `Certificate ${certificate.number} is ready to download and sign.`;
        status.tabIndex = -1;
        status.focus();
      } catch (error) {
        status.textContent = error.code === "permission-denied"
          ? "Your account couldn’t issue this certificate. Ask your school administrator to check access."
          : error.message || "Couldn’t issue the certificate. Please try again.";
      } finally {
        restore();
        back.disabled = false;
      }
    }, true);
    view.replaceChildren(
      reviewTitle,
      el("dl", { class: "alumni-certificate-review" }, fields.map(([label, value]) =>
        el("div", {}, [el("dt", {}, label), el("dd", {}, value == null || value === "" ? "Not recorded" : String(value))]))),
      el("p", { class: "text-sm" }, "Confirm the details before issuing. Reprints use this saved record. Sign and stamp the printed certificate."),
      el("div", { class: "alumni-document-actions" }, [back, issue]),
    );
    reviewTitle.focus();
  }

  load();
}

export async function renderAlumni(params = {}) {
  const wrap = el("div", { class: "students-alumni" });
  const search = el("input", { id: "alumni-search", type: "search", placeholder: "Name or admission number", value: params.q || "" });
  const year = el("select", { id: "alumni-year" });
  const results = el("div", { class: "card students-alumni__results" });
  let rows = [];
  let page = 0;

  function filterField(label, control) {
    return el("div", { class: "field" }, [el("label", { for: control.id }, label), control]);
  }

  wrap.append(el("div", { class: "card module-picker students-alumni__filters" }, [
    filterField("Search alumni", search), filterField("Graduation year", year),
  ]), results);

  async function load() {
    search.disabled = true;
    year.disabled = true;
    results.replaceChildren(el("p", { class: "text-muted", role: "status" }, "Loading alumni…"));
    try {
      rows = await listAlumni();
      const years = [...new Set(rows.flatMap(({ graduationYear }) => graduationYear ? [String(graduationYear)] : []))]
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      year.replaceChildren(el("option", { value: "" }, "All years"),
        ...years.map((value) => el("option", { value }, value)),
        ...(rows.some(({ graduationYear }) => !graduationYear) ? [el("option", { value: UNKNOWN_YEAR }, "Year not recorded")] : []));
      if (years.includes(params.year)) year.value = params.year;
      search.disabled = !rows.length;
      year.disabled = !rows.length;
      renderRows();
    } catch {
      results.replaceChildren(el("p", { class: "text-muted", role: "alert" }, "Couldn’t load alumni. Check your connection or ask your school administrator to check access."),
        button("Try Again", load));
    }
  }

  function renderRows() {
    const term = search.value.trim().toLocaleLowerCase();
    const filtered = rows.filter((record) => {
      const matchesName = [record.fullName, record.admissionNumber].some((value) =>
        String(value ?? "").toLocaleLowerCase().includes(term));
      return matchesName && (!year.value || (year.value === UNKNOWN_YEAR
        ? !record.graduationYear : String(record.graduationYear) === year.value));
    });
    if (!filtered.length) {
      results.replaceChildren(el("div", { class: "empty-state" }, [
        icon("school"), el("h3", {}, rows.length ? "No matching alumni" : "No graduates yet"),
        el("p", {}, rows.length ? "Try another name, admission number, or graduation year." : "Learners appear here after they graduate through Promotions."),
      ]));
      return;
    }

    const columns = ["Learner", "Admission number", "Final class", "Graduation year", "Records"];
    const first = page * PAGE_SIZE;
    const visible = filtered.slice(first, first + PAGE_SIZE);
    const tbody = el("tbody", {}, visible.map((graduate) => {
      const name = graduate.fullName || "Unnamed learner";
      const link = el("a", { class: "btn btn--sm btn--ghost", href: "#/students?" + new URLSearchParams({ id: graduate.studentId }) }, "Profile");
      const documents = button("Documents", (event) => openDocuments(graduate, event.currentTarget), true);
      link.setAttribute("aria-label", "View profile for " + name);
      documents.setAttribute("aria-label", "Open documents for " + name);
      const cells = [
        el("strong", {}, name), graduate.admissionNumber == null ? "—" : String(graduate.admissionNumber),
        [graduate.grade, graduate.stream].filter(Boolean).join(" · ") || "—",
        graduate.graduationYear ? String(graduate.graduationYear) : "Not recorded",
        el("div", { class: "alumni-document-actions" }, [link, documents]),
      ];
      return el("tr", {}, cells.map((value, index) => el("td", { "data-label": columns[index] }, value)));
    }));
    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, columns.map((label) => el("th", { scope: "col" }, label)))), tbody,
    ]);
    const previous = button("Previous", () => { page--; renderRows(); });
    const next = button("Next", () => { page++; renderRows(); });
    previous.disabled = page === 0;
    next.disabled = first + PAGE_SIZE >= filtered.length;
    results.replaceChildren(
      el("p", { class: "students-alumni__count text-sm text-muted", role: "status" },
        filtered.length + (filtered.length === 1 ? " graduate" : " graduates")),
      el("div", { class: "table-wrap table-wrap--responsive" }, table),
      ...(filtered.length > PAGE_SIZE ? [el("div", { class: "students-alumni__pagination alumni-document-actions" }, [previous, next])] : []),
    );
  }

  function applyFilters() { page = 0; renderRows(); }
  search.addEventListener("input", applyFilters);
  year.addEventListener("change", applyFilters);
  await load();
  return wrap;
}
