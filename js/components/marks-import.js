import { el, toast } from "../utils.js";
import { parseDelimitedText } from "../services/delimited-text.js";
import { openModal } from "./modal.js";

const admissionKey = (value) => String(value ?? "").trim().toLowerCase();
const headerKey = (value) => value.toLowerCase().replace(/[^a-z]/g, "");
const admissionHeaders = new Set(["admissionnumber", "admissionno", "admission", "admno", "admnumber"]);
const scoreHeaders = /^(?:score|scores|mark|marks)(?:outof|max)?$/;

function previewScores(text, students, maxScore, getCurrentScore) {
  const roster = new Map();
  for (const student of students) {
    const key = admissionKey(student.admissionNumber);
    if (key) roster.set(key, roster.has(key) ? null : student);
  }

  const rows = text.replace(/^\uFEFF/, "").split(/\r\n|[\n\r]/).flatMap((line, index) => {
    if (!line.trim()) return [];
    let cells = [line];
    if (line.includes("\t")) {
      [cells] = parseDelimitedText(line, "\t");
    } else if (line.includes(",")) {
      [cells] = parseDelimitedText(line);
    } else if (!roster.has(admissionKey(line))) {
      // Previous imports also accepted an admission number and score separated by spaces.
      cells = line.trim().match(/^(.+?)\s+(\S+)$/)?.slice(1) || cells;
    }
    const [admission = "", pasted = "", ...extra] = cells;
    if (![admission, pasted, ...extra].some((cell) => cell.trim())) return [];
    return [{ line: index + 1, admission: admission.trim(), pasted: pasted.trim(), extra: extra.some((cell) => cell.trim()) }];
  });
  const first = rows[0];
  if (first && admissionHeaders.has(headerKey(first.admission)) && scoreHeaders.test(headerKey(first.pasted))) {
    rows.shift();
  }

  const occurrences = new Map();
  for (const { admission } of rows) {
    const key = admissionKey(admission);
    if (key) occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }

  return rows.map((row) => {
    const key = admissionKey(row.admission);
    const student = roster.get(key);
    const current = student ? getCurrentScore(student.id) : "";
    const score = Number(row.pasted);
    const result = { ...row, student, current, score, status: "skipped" };
    if (!key) return { ...result, issue: "Missing admission number" };
    if (occurrences.get(key) > 1) return { ...result, issue: "Duplicate admission number in paste" };
    if (student === null) return { ...result, issue: "Admission number matches multiple students" };
    if (!student) return { ...result, issue: "Admission number isn’t in this class" };
    if (row.extra) return { ...result, issue: "Copy only the admission number and score columns" };
    if (!row.pasted) return { ...result, issue: "Blank score" };
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(row.pasted) || !Number.isFinite(score)) {
      return { ...result, issue: "Enter a numeric score" };
    }
    if (score < 0) return { ...result, issue: "Score is below 0" };
    if (score > maxScore) return { ...result, issue: `Score exceeds ${maxScore}` };
    if (current === "") return { ...result, status: "ready" };
    return { ...result, status: Number(current) === score ? "unchanged" : "replace" };
  });
}

export function openMarksImport({ classLabel, subjectLabel, assessmentLabel, maxScore, students, getCurrentScore, applyScores, trigger }) {
  const body = el("div", { class: "marks-import" });
  const step = el("div", { class: "marks-import__step" });
  const context = [
    ["Class & stream", classLabel], ["Subject", subjectLabel],
    ["Assessment", assessmentLabel], ["Maximum score", String(maxScore)],
  ];
  body.append(el("dl", { class: "marks-import__context" }, context.map(([label, value]) =>
    el("div", {}, [el("dt", {}, label), el("dd", {}, value)])
  )), step);

  const close = openModal({
    title: "Import Scores",
    body,
    extraClass: "modal--marks-import",
    onClose: () => trigger.focus(),
  });
  const dialog = body.closest(".modal");
  const modalTitle = dialog.querySelector("h3");
  modalTitle.id = "marks-import-title";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", modalTitle.id);
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.querySelectorAll("button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex='0']"));
    const index = controls.indexOf(document.activeElement);
    if (event.shiftKey ? index <= 0 : index === controls.length - 1) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
    }
  });

  const button = (label, onClick, variant = "ghost") =>
    el("button", { type: "button", class: `btn btn--${variant}`, onClick }, label);
  const actions = (...buttons) => el("div", { class: "marks-import__actions" }, buttons);
  const heading = (title) => el("h4", { tabindex: "-1", class: "marks-import__heading" }, title);
  const cancel = () => button("Cancel", () => close());
  const pasteArea = el("textarea", {
    id: "marks-import-paste", rows: "4",
    placeholder: "Paste your two columns here",
    "aria-describedby": "marks-import-help",
    spellcheck: "false",
  });
  const pasteError = el("p", { class: "marks-import__error text-sm", role: "alert", hidden: "" });
  const reviewButton = button("Review Scores", () => showReview(), "primary");
  pasteArea.addEventListener("input", () => {
    reviewButton.disabled = !pasteArea.value.trim();
    pasteError.hidden = true;
  });

  function showPaste() {
    step.className = "marks-import__step";
    reviewButton.disabled = !pasteArea.value.trim();
    step.replaceChildren(
      el("p", { id: "marks-import-help", class: "text-sm" },
        "Copy the Admission Number and Score columns from Excel or Google Sheets and paste them below. Column headings are optional."),
      el("div", { class: "marks-import__example" }, [
        el("span", {}, "Admission Number"), el("span", {}, "Score"),
        el("strong", {}, "ADM001"), el("strong", {}, String(Number((maxScore * 0.7).toPrecision(3)))),
      ]),
      el("div", { class: "field marks-import__paste" }, [
        el("label", { for: pasteArea.id }, "Scores to import"),
        pasteArea,
        pasteError,
      ]),
      actions(cancel(), reviewButton),
    );
    pasteArea.focus();
  }

  function showReview(message = "") {
    const rows = previewScores(pasteArea.value, students, maxScore, getCurrentScore);
    if (!rows.length) {
      pasteError.textContent = "Paste at least one student row with an admission number and score.";
      pasteError.hidden = false;
      pasteArea.focus();
      return;
    }

    const title = heading("Review scores");
    const included = new Set(rows.filter(({ status }) => status === "ready"));
    const replacements = rows.filter(({ status }) => status === "replace");
    const skipped = rows.filter(({ status }) => status === "skipped").length;
    const unchanged = rows.filter(({ status }) => status === "unchanged").length;
    const summary = el("p", { class: "marks-import__summary text-sm", role: "status" });
    const applyButton = button("", async () => {
      const selected = [...included];
      if (!selected.length) return;
      if (selected.some(({ student, current }) => getCurrentScore(student.id) !== current)) {
        showReview("Scores changed while this window was open. Review the updated scores before applying.");
        return;
      }

      const saving = heading("Saving scores…");
      step.replaceChildren(saving, el("p", { class: "text-sm", role: "status" }, `Saving ${selected.length} selected scores to this marks sheet.`));
      saving.focus();
      try {
        const saved = await applyScores(selected.map(({ student, score }) => ({ studentId: student.id, score })));
        const pending = selected.length - saved;
        const result = heading(pending ? "Scores pending" : "Scores saved");
        const savedMessage = saved === 1 ? "1 score saved." : `${saved} scores saved.`;
        const pendingMessage = pending
          ? ` ${pending} ${pending === 1 ? "score is" : "scores are"} pending. Check the marks sheet for save status.`
          : "";
        if (!body.isConnected || dialog.classList.contains("modal--closing")) {
          toast(savedMessage + pendingMessage, pending ? "info" : "success");
          return;
        }
        step.className = "marks-import__step";
        step.replaceChildren(result, el("p", { class: "text-sm", role: "status" }, savedMessage + pendingMessage),
          actions(button("Done", () => close(), "primary")));
        result.focus();
      } catch (error) {
        const message = error.message || "Could not apply these scores. Review the marks sheet and try again.";
        if (body.isConnected && !dialog.classList.contains("modal--closing")) showReview(message);
        else toast(message, "error");
      }
    }, "primary");

    function refreshSummary() {
      const kept = replacements.filter((row) => !included.has(row)).length;
      summary.textContent = [
        `${included.size} to apply`, kept && `${kept} existing kept`,
        skipped && `${skipped} skipped`, unchanged && `${unchanged} unchanged`,
      ].filter(Boolean).join(" · ");
      applyButton.textContent = `Apply ${included.size} ${included.size === 1 ? "Score" : "Scores"}`;
      applyButton.disabled = included.size === 0;
    }

    const columns = ["Admission Number", "Student", "Current Score", "Pasted Score", "Action"];
    const table = el("table", {}, [
      el("thead", {}, el("tr", {}, columns.map((label) => el("th", { scope: "col" }, label)))),
      el("tbody", {}, rows.map((row) => {
        let action;
        if (row.status === "replace") {
          const replace = el("input", { type: "checkbox", "aria-label": `Replace score for ${row.student.fullName} (${row.admission})` });
          replace.addEventListener("change", () => {
            if (replace.checked) included.add(row);
            else included.delete(row);
            refreshSummary();
          });
          action = el("label", { class: "marks-import__replace" }, [replace, "Replace"]);
        } else {
          action = el("span", { class: row.issue ? "marks-import__error" : "text-muted" }, row.issue ||
            (row.status === "ready" ? "Add score" : "Already matches"));
        }
        return el("tr", {}, [
          el("td", { "data-label": columns[0] }, row.admission || `Row ${row.line}`),
          el("td", { "data-label": columns[1] }, row.student?.fullName || "—"),
          el("td", { "data-label": columns[2] }, row.current === "" ? "—" : row.current),
          el("td", { "data-label": columns[3] }, row.pasted || "—"),
          el("td", { "data-label": columns[4] }, action),
        ]);
      })),
    ]);
    refreshSummary();
    step.className = "marks-import__step marks-import__review";
    step.replaceChildren(
      title,
      ...(message ? [el("p", { class: "callout callout--warning text-sm", role: "alert" }, message)] : []),
      el("p", { class: "text-sm" }, replacements.length
        ? "Check Replace beside any existing score you want to change."
        : "Check the student matches and scores before applying."),
      summary,
      el("div", { class: "table-wrap table-wrap--responsive marks-import__table", role: "region", "aria-label": "Score matches", tabindex: "0" }, table),
      actions(button("Edit Paste", showPaste), applyButton),
    );
    title.focus();
  }

  showPaste();
}
