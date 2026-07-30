import { getSchoolSettings, saveSchoolSettings, uploadSchoolLogo } from "../js/services/settings.service.js";
import { el, toast } from "../js/utils.js";

let settings = null;

export async function render({ profile }) {
  settings = await getSchoolSettings();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, "School Settings"), el("p", {}, "Core details used across report cards, receipts, and the dashboard.")]),
    ])
  );

  const grid = el("div", { style: "display:grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items:start;" });

  // --- Profile card ---
  const profileCard = el("div", { class: "card" });
  profileCard.append(el("h3", {}, "School Profile"));
  const form = el("form", { id: "settings-form" });
  form.append(
    field("schoolName", "School Name", settings.schoolName),
    field("motto", "Motto", settings.motto),
    field("address", "Address", settings.address),
    field("phone", "Phone", settings.phone),
    field("email", "Email", settings.email, "email"),
  );

  const logoField = el("div", { class: "field" }, [
    el("label", {}, "School Logo"),
    settings.logoUrl
      ? el("img", { src: settings.logoUrl, style: "height:56px;display:block;margin-bottom:8px;border-radius:8px;" })
      : el("p", { class: "text-sm text-muted" }, "No logo uploaded yet."),
    el("input", { type: "file", id: "logo-input", accept: "image/*" }),
  ]);
  form.append(logoField);
  form.append(el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:8px;" }, "Save profile"));
  profileCard.append(form);

  // --- Academic calendar card ---
  const calendarCard = el("div", { class: "card" });
  calendarCard.append(el("h3", {}, "Academic Calendar"));
  const calForm = el("form", { id: "calendar-form" });
  calForm.append(
    field("currentAcademicYear", "Current Academic Year", settings.currentAcademicYear),
  );
  const termSelect = el("select", { id: "currentTerm" });
  for (const term of settings.terms || ["Term 1", "Term 2", "Term 3"]) {
    termSelect.append(el("option", { value: term, ...(term === settings.currentTerm ? { selected: "true" } : {}) }, term));
  }
  calForm.append(el("div", { class: "field" }, [el("label", {}, "Current Term"), termSelect]));
  calForm.append(
    field("closingDate", "School Closes On", settings.closingDate, "date"),
    field("openingDate", "Next Term Begins", settings.openingDate, "date"),
  );
  calForm.append(el("button", { type: "submit", class: "btn btn--primary" }, "Save calendar"));
  calendarCard.append(calForm);

  grid.append(profileCard, calendarCard);
  wrap.append(grid);

  // --- Grading scale card ---
  const gradingCard = el("div", { class: "card", style: "margin-top:24px;" });
  gradingCard.append(
    el("h3", {}, "CBC Grading Scale"),
    el("p", { class: "text-sm text-muted" }, "Used to auto-grade marks entries and feed the Grading & Position engine. Ranges should not overlap; Points is what gets summed into a student's total/mean points.")
  );
  const tableWrap = el("div", { class: "table-wrap" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [el("th", {}, "Min %"), el("th", {}, "Max %"), el("th", {}, "Grade"), el("th", {}, "Points"), el("th", {}, "Remark")])),
  ]);
  const tbody = el("tbody", { id: "grading-tbody" });
  for (const row of settings.gradingScale) {
    tbody.append(gradingRow(row));
  }
  table.append(tbody);
  tableWrap.append(table);
  gradingCard.append(tableWrap);
  gradingCard.append(
    el("button", { type: "button", id: "save-grading", class: "btn btn--primary", style: "margin-top:16px;" }, "Save grading scale")
  );
  wrap.append(gradingCard);

  return wrap;
}

function field(id, label, value = "", type = "text") {
  return el("div", { class: "field" }, [
    el("label", { for: id }, label),
    el("input", { id, type, value: value || "" }),
  ]);
}

function gradingRow(row) {
  return el("tr", {}, [
    el("td", {}, el("input", { type: "number", value: row.min, class: "grade-min", style: "width:70px;" })),
    el("td", {}, el("input", { type: "number", value: row.max, class: "grade-max", style: "width:70px;" })),
    el("td", {}, el("input", { type: "text", value: row.grade, class: "grade-code", style: "width:70px;" })),
    el("td", {}, el("input", { type: "number", value: row.points ?? "", class: "grade-points", style: "width:70px;" })),
    el("td", {}, el("input", { type: "text", value: row.remark, class: "grade-remark" })),
  ]);
}

export function init({ profile }) {
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const logoFile = document.getElementById("logo-input").files[0];
    let logoUrl = settings.logoUrl;
    if (logoFile) logoUrl = await uploadSchoolLogo(logoFile);
    await saveSchoolSettings(profile.uid, {
      schoolName: val("schoolName"),
      motto: val("motto"),
      address: val("address"),
      phone: val("phone"),
      email: val("email"),
      logoUrl,
    });
    toast("School profile saved.", "success");
  });

  document.getElementById("calendar-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveSchoolSettings(profile.uid, {
      currentAcademicYear: val("currentAcademicYear"),
      currentTerm: document.getElementById("currentTerm").value,
      closingDate: val("closingDate"),
      openingDate: val("openingDate"),
    });
    toast("Academic calendar saved.", "success");
  });

  document.getElementById("save-grading").addEventListener("click", async () => {
    const rows = Array.from(document.querySelectorAll("#grading-tbody tr")).map((tr) => ({
      min: Number(tr.querySelector(".grade-min").value),
      max: Number(tr.querySelector(".grade-max").value),
      grade: tr.querySelector(".grade-code").value.trim(),
      points: Number(tr.querySelector(".grade-points").value) || 0,
      remark: tr.querySelector(".grade-remark").value.trim(),
    }));
    await saveSchoolSettings(profile.uid, { gradingScale: rows });
    toast("Grading scale saved.", "success");
  });
}

function val(id) {
  return document.getElementById(id).value.trim();
}
