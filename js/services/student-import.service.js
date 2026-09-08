// Bulk student import from a standardized CSV.
//
// Pipeline is deliberately three separate steps that never skip ahead of
// each other: parseStudentsCsv (text -> raw rows) -> validateStudentRows
// (raw rows -> annotated rows with per-field issues + a ready/warning/
// blocked status) -> commitStudentRows (only "ready" rows are ever
// written, in Firestore-batch-sized chunks). Nothing from an upload
// reaches the students collection without passing through validation.
import {
  collection,
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { sanitizeInput } from "../utils.js";
import { invalidateStudentsCache } from "./student.service.js";

// Column order doubles as the template's header row and the accepted
// (case/spacing-insensitive) input headers. Streamlined to focus on
// the essential fields needed for initial enrollment (other details can
// be edited later directly in the student profile).
export const IMPORT_COLUMNS = [
  { key: "admissionNumber", label: "Admission Number", required: false },
  { key: "fullName", label: "Full Name", required: true },
  { key: "gender", label: "Gender (Male/Female)", required: true },
  { key: "grade", label: "Grade", required: true },
  { key: "stream", label: "Stream", required: false },
  { key: "dob", label: "Date of Birth (YYYY-MM-DD)", required: false },
  { key: "kcpeNumber", label: "Assessment Number", required: false },
];

// Legacy / secondary columns preserved for backward compatibility if a user
// uploads an older or complete spreadsheet containing them.
export const LEGACY_COLUMNS = [
  { key: "address", label: "Address", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "previousSchool", label: "Previous School", required: false },
  { key: "medicalInfo", label: "Medical Information", required: false },
];

export const ALL_ACCEPTED_COLUMNS = [...IMPORT_COLUMNS, ...LEGACY_COLUMNS];

const FIELD_MAX_LENGTH = 300;

// Dynamic loader for SheetJS so the heavy library only loads when an Excel
// template is downloaded or an Excel file is parsed.
let xlsxPromise = null;
export async function loadXlsxLib() {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx/xlsx.mjs").then((m) => m.default || m);
  }
  return xlsxPromise;
}

// ---------------------------------------------------------------------
// Template (CSV & Excel)
// ---------------------------------------------------------------------

// A starter CSV with the exact streamlined headers we parse, plus a sample row.
export function buildTemplateCsv(classes = []) {
  const header = IMPORT_COLUMNS.map((c) => c.label);
  const sampleGrade = classes[0]?.grade || "Grade 7";
  const sampleStream = classes[0]?.streams?.[0] || "";
  const rows = [
    header,
    ["ADM1001", "Jane Wanjiru Kamau", "Female", sampleGrade, sampleStream, "2012-04-15", "1234567890"],
  ];
  const validGrades = classes.map((c) => `${c.grade}${c.streams?.length ? ` (streams: ${c.streams.join(", ")})` : ""}`);
  let csv = rows.map(toCsvRow).join("\r\n");
  if (validGrades.length) {
    csv += "\r\n\r\n# Valid grades for this school - Grade must match one of these exactly:\r\n";
    csv += validGrades.map((g) => `# ${g}`).join("\r\n");
  }
  return csv;
}

// Builds a starter Excel (.xlsx) workbook with a Students sheet and a
// Classes & Streams reference guide sheet.
export async function buildTemplateXlsx(classes = []) {
  const XLSX = await loadXlsxLib();
  const wb = XLSX.utils.book_new();

  const header = IMPORT_COLUMNS.map((c) => c.label);
  const sampleGrade = classes[0]?.grade || "Grade 7";
  const sampleStream = classes[0]?.streams?.[0] || "";
  const rows = [
    header,
    ["ADM1001", "Jane Wanjiru Kamau", "Female", sampleGrade, sampleStream, "2012-04-15", "1234567890"],
    ["ADM1002", "John Omondi Otieno", "Male", sampleGrade, sampleStream, "2012-08-20", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 }, // Admission Number
    { wch: 28 }, // Full Name
    { wch: 24 }, // Gender (Male/Female)
    { wch: 15 }, // Grade
    { wch: 15 }, // Stream
    { wch: 26 }, // Date of Birth (YYYY-MM-DD)
    { wch: 22 }, // Assessment Number
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  const guideRows = [
    ["Grade / Class", "Configured Streams", "Instructions"],
    ...classes.map((c) => [
      c.grade,
      (c.streams && c.streams.length) ? c.streams.join(", ") : "None (no stream needed)",
      "When filling in 'Grade' on the Students sheet, match this name exactly.",
    ]),
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 22 }, { wch: 30 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, "Classes & Streams Guide");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export async function downloadTemplateXlsx(filename, classes = []) {
  const buffer = await buildTemplateXlsx(classes);
  downloadExcel(filename, buffer);
}

// ---------------------------------------------------------------------
// Parsing (text / workbook -> raw rows)
// ---------------------------------------------------------------------

// Small RFC4180-ish CSV parser (handles quoted fields, escaped quotes,
// commas inside quotes, and \r\n or \n line endings) so we don't need an
// external library just to read a spreadsheet export.
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, ""); // strip BOM from Excel exports
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function normalizeHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Common shorthand a teacher might retype instead of the exact template
// label (e.g. "DOB" instead of "Date of Birth (YYYY-MM-DD)", "Adm No"
// instead of "Admission Number", "UPI" or "Assessment No" instead of "Assessment Number").
const HEADER_ALIASES = {
  admissionNumber: ["admno", "admissionno", "admission", "regno", "registrationnumber", "index"],
  fullName: ["name", "studentname", "student"],
  gender: ["sex"],
  grade: ["class", "form", "gradeclass"],
  stream: ["section", "arm"],
  dob: ["dateofbirth", "birthdate", "birthday"],
  kcpeNumber: ["kcpe", "assessmentnumber", "examno", "assessment", "assessmentno", "upi", "upinumber", "kcpenumber"],
  phone: ["telephone", "mobile", "contact", "phonenumber"],
  address: ["residence", "homeaddress", "location"],
  previousSchool: ["priorschool", "formerschool"],
  medicalInfo: ["medical", "medicalnotes", "healthinfo"],
};

function matchColumn(normalizedHeader) {
  const exact = ALL_ACCEPTED_COLUMNS.find(
    (c) => normalizeHeader(c.label) === normalizedHeader || normalizeHeader(c.key) === normalizedHeader
  );
  if (exact) return exact;
  const aliasKey = Object.keys(HEADER_ALIASES).find((key) => HEADER_ALIASES[key].includes(normalizedHeader));
  return aliasKey ? ALL_ACCEPTED_COLUMNS.find((c) => c.key === aliasKey) : undefined;
}

// Core table processor: converts 2D array of rows -> annotated raw rows.
// Shared by both CSV and Excel parsers.
export function parseStudentTable(table) {
  const filteredTable = (table || []).filter(
    (r) => Array.isArray(r) && !(String(r[0] || "")).trim().startsWith("#")
  );
  if (!filteredTable.length) return { rows: [], error: "The file is empty." };

  const headerRow = filteredTable[0].map(normalizeHeader);
  const columnForIndex = headerRow.map((h) => matchColumn(h));
  const matched = columnForIndex.filter(Boolean).length;
  if (matched < 2) {
    return { rows: [], error: "Column headers weren't recognized. Please use the downloaded template's headers." };
  }

  const rows = [];
  for (let i = 1; i < filteredTable.length; i++) {
    const cells = filteredTable[i];
    if (!cells || !cells.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) continue;
    const raw = {};
    for (const col of ALL_ACCEPTED_COLUMNS) raw[col.key] = "";
    columnForIndex.forEach((col, idx) => {
      if (col && cells[idx] !== undefined && cells[idx] !== null) {
        if (cells[idx] instanceof Date) {
          raw[col.key] = cells[idx];
        } else {
          raw[col.key] = String(cells[idx]).trim();
        }
      }
    });
    rows.push({ rowNumber: i + 1, raw });
  }
  return { rows, error: null };
}

// text -> { rows: [{ rowNumber, raw: {key: value} }], error }
export function parseStudentsCsv(text) {
  const table = parseCsvText(text);
  return parseStudentTable(table);
}

// arrayBuffer -> { rows: [{ rowNumber, raw: {key: value} }], error }
export async function parseStudentsWorkbook(buffer) {
  try {
    const XLSX = await loadXlsxLib();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    if (!wb.SheetNames || !wb.SheetNames.length) {
      return { rows: [], error: "The Excel file has no worksheets." };
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawTable = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    return parseStudentTable(rawTable);
  } catch (err) {
    return { rows: [], error: `Failed to read Excel file: ${err.message || "Invalid or corrupt format"}` };
  }
}

// file -> { rows: [{ rowNumber, raw: {key: value} }], error }
// Automatically dispatches based on filename / MIME type.
export async function parseStudentsFile(file) {
  if (!file) return { rows: [], error: "No file selected." };
  const isExcel = /\.(xlsx|xls)$/i.test(file.name) ||
    (file.type && (file.type.includes("spreadsheet") || file.type.includes("excel")));
  if (isExcel) {
    const buffer = await file.arrayBuffer();
    return parseStudentsWorkbook(buffer);
  }
  const text = await file.text();
  return parseStudentsCsv(text);
}

// ---------------------------------------------------------------------
// Validation (raw rows -> annotated rows)
// ---------------------------------------------------------------------

const GENDER_MAP = { male: "Male", m: "Male", female: "Female", f: "Female" };

function parseDob(value) {
  if (!value) return { value: "", ok: true };
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return { value: `${y}-${m}-${d}`, ok: true };
  }
  const v = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { value: v, ok: true };
  const dmy = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); // DD/MM/YYYY or DD-MM-YYYY
  if (dmy) {
    const [, d, m, y] = dmy;
    return { value: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, ok: true };
  }
  const num = Number(v);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    // Excel epoch offset
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const jsDate = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(jsDate.getTime())) {
      const y = jsDate.getUTCFullYear();
      const m = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
      const d = String(jsDate.getUTCDate()).padStart(2, "0");
      return { value: `${y}-${m}-${d}`, ok: true };
    }
  }
  return { value: "", ok: false };
}

let placeholderCounter = 0;
function placeholderAdmissionNumber() {
  placeholderCounter += 1;
  return `PENDING-${Date.now().toString(36).toUpperCase()}-${placeholderCounter}`;
}

// rawRows: from parseStudentsCsv. classes: from listClasses(). existingStudents: from listStudents().
// Returns annotated rows; also resolves in-file duplicate admission numbers against each other,
// not just against what's already saved.
export function validateStudentRows(rawRows, { classes = [], existingStudents = [] } = {}) {
  const admissionIndex = new Map(existingStudents.map((s) => [String(s.admissionNumber || "").toLowerCase(), s]));
  const seenInFile = new Set();

  return rawRows.map(({ rowNumber, raw }) => {
    const issues = [];
    const data = {};

    // --- Full name (required) ---
    data.fullName = sanitizeInput(raw.fullName, { maxLength: FIELD_MAX_LENGTH });
    if (!data.fullName) issues.push({ field: "fullName", level: "blocked", message: "Full name is required." });

    // --- Gender (required, must map to Male/Female) ---
    const genderKey = String(raw.gender || "").trim().toLowerCase();
    data.gender = GENDER_MAP[genderKey] || "";
    if (!data.gender) issues.push({ field: "gender", level: "blocked", message: `Gender must be Male or Female (got "${raw.gender || "blank"}").` });

    // --- Grade (required, must match a real class) ---
    const rawGrade = String(raw.grade || "").trim();
    const cls = classes.find((c) => c.grade.toLowerCase() === rawGrade.toLowerCase());
    data.grade = cls?.grade || "";
    if (!classes.length) {
      issues.push({ field: "grade", level: "blocked", message: "No classes or streams have been set up yet. Please set up Classes & Streams under Academics first." });
    } else if (!rawGrade) {
      issues.push({ field: "grade", level: "blocked", message: "Grade is required." });
    } else if (!cls) {
      issues.push({ field: "grade", level: "blocked", message: `"${rawGrade}" doesn't match any class set up under Classes & Streams.` });
    }

    // --- Stream (required if the matched grade has streams defined) ---
    data.stream = String(raw.stream || "").trim();
    if (cls?.streams?.length) {
      const streamMatch = cls.streams.find((s) => s.toLowerCase() === data.stream.toLowerCase());
      if (streamMatch) {
        data.stream = streamMatch;
      } else if (!data.stream && cls.streams.length === 1) {
        data.stream = cls.streams[0]; // only one possible stream - safe to default
      } else if (!data.stream) {
        issues.push({ field: "stream", level: "blocked", message: `Stream is required for ${cls.grade}. Choose one of: ${cls.streams.join(", ")}.` });
      } else {
        issues.push({ field: "stream", level: "blocked", message: `"${raw.stream}" isn't a valid stream of ${cls.grade} (${cls.streams.join(", ")}).` });
        data.stream = "";
      }
    }

    // --- Date of birth (optional, best-effort parse) ---
    const dob = parseDob(raw.dob);
    data.dob = dob.value;
    if (raw.dob && String(raw.dob).trim() && !dob.ok) {
      issues.push({ field: "dob", level: "warning", message: `Couldn't read date "${raw.dob}" - left blank, expected YYYY-MM-DD.` });
    }

    // --- Admission number (optional, but flagged + placeholder if missing; duplicates flagged) ---
    data.admissionNumber = String(raw.admissionNumber || "").trim();
    let duplicateOf = null;
    let autoAssigned = false;
    if (!data.admissionNumber) {
      data.admissionNumber = placeholderAdmissionNumber();
      autoAssigned = true;
      issues.push({ field: "admissionNumber", level: "warning", message: "No admission number given - a placeholder was assigned; update it before printing records." });
    } else {
      const key = data.admissionNumber.toLowerCase();
      const existing = admissionIndex.get(key);
      if (existing) {
        duplicateOf = existing.id;
        issues.push({ field: "admissionNumber", level: "warning", message: `Admission number already belongs to ${existing.fullName}. Choose to update that record or skip this row.` });
      } else if (seenInFile.has(key)) {
        issues.push({ field: "admissionNumber", level: "blocked", message: "Admission number is duplicated elsewhere in this file." });
      }
      seenInFile.add(key);
    }

    // --- Free-text extras (optional, sanitized + length-capped) ---
    data.address = sanitizeInput(String(raw.address || ""), { maxLength: FIELD_MAX_LENGTH });
    data.phone = sanitizeInput(String(raw.phone || ""), { maxLength: 40 });
    data.previousSchool = sanitizeInput(String(raw.previousSchool || ""), { maxLength: FIELD_MAX_LENGTH });
    data.kcpeNumber = sanitizeInput(String(raw.kcpeNumber || ""), { maxLength: 60 });
    data.medicalInfo = sanitizeInput(String(raw.medicalInfo || ""), { maxLength: FIELD_MAX_LENGTH });

    const status = issues.some((i) => i.level === "blocked") ? "blocked" : issues.length ? "warning" : "ready";
    return {
      rowNumber,
      raw,
      data,
      issues,
      status,
      duplicateOf,
      autoAssigned,
      action: duplicateOf ? "skip" : "create", // duplicates default to "skip"; caller can flip to "update"
    };
  });
}

// ---------------------------------------------------------------------
// Commit (annotated rows -> Firestore, batched)
// ---------------------------------------------------------------------

const BATCH_LIMIT = 450; // stay under Firestore's 500-write-per-batch cap

// Only rows the caller has decided are importable should be passed in
// (status !== "blocked", and action !== "skip"). Rows with action
// "update" overwrite the matching existing student instead of creating
// a new one.
export async function commitStudentRows(userId, rows) {
  const schoolId = getCurrentSchoolId();
  const toCreate = rows.filter((r) => r.action !== "update");
  const toUpdate = rows.filter((r) => r.action === "update" && r.duplicateOf);
  const chunks = [];
  const all = [...toCreate, ...toUpdate];
  for (let i = 0; i < all.length; i += BATCH_LIMIT) chunks.push(all.slice(i, i + BATCH_LIMIT));

  let created = 0;
  let updated = 0;
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const row of chunk) {
      const fields = row.data;
      if (row.action === "update" && row.duplicateOf) {
        batch.update(doc(db, "students", row.duplicateOf), { ...fields });
        updated++;
      } else {
        const ref = doc(collection(db, "students"));
        batch.set(ref, {
          ...fields,
          schoolId,
          status: "active",
          admissionDate: new Date().toISOString().slice(0, 10),
          createdAt: serverTimestamp(),
        });
        created++;
      }
    }
    await batch.commit();
  }

  invalidateStudentsCache();
  await logAction(userId, "bulk_import_students", "students", null);
  return { created, updated, total: created + updated };
}

// ---------------------------------------------------------------------
// Error report (for rows the admin chose not to / couldn't import)
// ---------------------------------------------------------------------

export function buildErrorReportCsv(rows) {
  const header = ["Row", "Status", "Full Name", "Admission Number", "Grade", "Issues"];
  const lines = [header, ...rows.map((r) => [
    String(r.rowNumber),
    r.status,
    r.raw.fullName,
    r.raw.admissionNumber,
    r.raw.grade,
    r.issues.map((i) => i.message).join(" | "),
  ])];
  return lines.map(toCsvRow).join("\r\n");
}

function toCsvRow(cells) {
  return cells.map((c) => {
    const v = String(c ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",");
}

export function downloadCsv(filename, csvText) {
  downloadBlob(filename, new Blob([csvText], { type: "text/csv;charset=utf-8;" }));
}

export function downloadExcel(filename, arrayBuffer) {
  downloadBlob(
    filename,
    new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
