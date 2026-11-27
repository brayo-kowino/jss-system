import { listAllIssuesForSchool, resolveIssue, reopenIssue, raiseIssue, ISSUE_CATEGORIES, issueCategoryLabel } from "../js/services/student-issue.service.js";
import { listStudents } from "../js/services/student.service.js";
import { el, icon, formatDate, busyButton, toast, toDate } from "../js/utils.js";
import { caseStatus, caseStatusFilter, openRecordModal, recordEmpty, recordField } from "../js/components/records-workspace.js";

export { buildIssuesMascotSvg } from "../js/components/mascot.js";

export const CATEGORY_META = {
  score_dispute: { label: "Wrong / inaccurate score", short: "Score dispute", icon: "grading" },
  report_error: { label: "Report card error", short: "Report card", icon: "description" },
  admission_error: { label: "Wrong admission details", short: "Admission details", icon: "badge" },
  fee_discrepancy: { label: "Fee / payment discrepancy", short: "Fee dispute", icon: "payments" },
  attendance_dispute: { label: "Attendance dispute", short: "Attendance", icon: "event_busy" },
  other: { label: "Other", short: "Other", icon: "help_outline" },
};

const RESOLUTION_NOTES = [
  "Corrected score in gradebook & recalculated position",
  "Regenerated report card with verified scores",
  "Verified fee payment receipt and updated ledger",
  "Adjusted attendance register & notified class teacher",
  "Confirmed student admission details and updated profile",
];

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0]?.slice(0, 2).toUpperCase() || "ST";
  return (parts[0][0] + parts.at(-1)[0]).toUpperCase();
}

function studentUrl(issue) {
  return issue.studentId
    ? `#/students?id=${encodeURIComponent(issue.studentId)}`
    : `#/students?q=${encodeURIComponent(issue.admissionNumber || issue.studentName || "")}`;
}

function studentIdentity(name, admissionNumber, link, detail) {
  const label = name || "Unknown student";
  return el("div", { class: "records-identity student-issue-identity" }, [
    el("span", { class: "records-avatar", "aria-hidden": "true" }, initials(name)),
    el("div", {}, [
      link ? el("a", { href: link, class: "records-title-link" }, label) : el("strong", {}, label),
      el("div", { class: "records-muted" }, [admissionNumber || "No admission number", detail].filter(Boolean).join(" · ")),
    ]),
  ]);
}

function categoryTag(category) {
  const data = CATEGORY_META[category];
  return el("span", { class: "records-tag" }, [
    icon(data?.icon || "help_outline", { "aria-hidden": "true" }), data?.short || issueCategoryLabel(category),
  ]);
}

function contextLabel(context) {
  return [context?.academicYear, context?.term, context?.subjectCode].filter(Boolean).join(" · ");
}

function dateLabel(value) {
  const date = toDate(value);
  return date ? `${formatDate(date)}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Date unavailable";
}

export async function render({ profile }) {
  let issues = [];
  let status = "all";
  let state = "loading";
  let requestVersion = 0;
  let studentsRequest;

  const workspace = el("div", { class: "records-workspace" });
  const search = el("input", { id: "student-issue-search", type: "search", placeholder: "Search by student, admission number or issue" });
  const category = el("select", { id: "student-issue-category" }, [el("option", { value: "" }, "All categories"),
    ...ISSUE_CATEGORIES.map(({ value, label }) => el("option", { value }, label))]);
  const results = el("p", { class: "records-muted", role: "status" });
  const list = el("div", { class: "records-list" });
  const statusFilter = caseStatusFilter((next) => {
    status = next;
    update();
  });
  const clear = el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => {
    search.value = category.value = "";
    status = "all";
    update();
    search.focus();
  } }, [icon("filter_alt_off"), "Clear filters"]);
  const create = el("button", { type: "button", class: "btn btn--primary btn--sm", onClick: () => showLogIssue(profile, loadStudents, afterCreate) }, [icon("add"), "Log issue"]);

  function loadStudents() {
    studentsRequest ??= listStudents().catch((error) => {
      studentsRequest = undefined;
      throw error;
    });
    return studentsRequest;
  }

  function update() {
    const query = search.value.trim().toLowerCase();
    const open = issues.filter((issue) => issue.status === "open").length;
    const resolved = issues.filter((issue) => issue.status === "resolved").length;
    statusFilter.update(status, { all: issues.length, open, resolved });
    clear.hidden = !query && !category.value && status === "all";
    const matching = issues.filter((issue) => {
      if (status !== "all" && issue.status !== status) return false;
      if (category.value && issue.category !== category.value) return false;
      return [issue.studentName, issue.admissionNumber, issue.description, issue.resolutionNote,
        CATEGORY_META[issue.category]?.short, issueCategoryLabel(issue.category), contextLabel(issue.context)]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    results.textContent = state === "ready" && issues.length && !clear.hidden ? `${matching.length} of ${issues.length} issues` : "";
    if (state === "loading") {
      list.replaceChildren(el("p", { class: "records-pending", role: "status" }, "Loading student issues…"));
    } else if (state === "error") {
      list.replaceChildren(recordEmpty("error_outline", "Student issues couldn’t load", "Try loading the issue register again.",
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: reload }, "Retry")));
    } else if (!issues.length) {
      list.replaceChildren(recordEmpty("assignment_turned_in", "No student issues logged", "Use Log issue to record a concern about a student’s marks, fees, or other school records."));
    } else if (!matching.length) {
      list.replaceChildren(recordEmpty("search_off", "No matching issues", "Adjust your search or clear the filters to see more issues."));
    } else {
      list.replaceChildren(renderIssues(matching, profile, reload));
    }
  }

  async function reload() {
    const request = ++requestVersion;
    state = "loading";
    list.setAttribute("aria-busy", "true");
    update();
    try {
      const nextIssues = await listAllIssuesForSchool();
      if (request !== requestVersion) return;
      issues = nextIssues;
      state = "ready";
    } catch (error) {
      if (request !== requestVersion) return;
      console.error("Could not load student issues", error);
      issues = [];
      state = "error";
    }
    list.removeAttribute("aria-busy");
    update();
  }

  function afterCreate() {
    search.value = category.value = "";
    status = "open";
    return reload();
  }

  search.addEventListener("input", update);
  category.addEventListener("change", update);
  workspace.append(el("section", { class: "records-card", "aria-labelledby": "student-issues-list" }, [
    el("div", { class: "records-toolbar records-card-head" }, [el("h2", { id: "student-issues-list" }, "Issue register"), create]),
    el("div", { class: "records-controls records-controls--issues" }, [
      recordField("Search issues", search), recordField("Category", category),
    ]),
    el("div", { class: "records-toolbar records-filter-row" }, [statusFilter.group, clear]),
    el("div", { class: "records-result" }, results),
    list,
  ]));
  await reload();
  return workspace;
}

function renderIssues(issues, profile, onUpdated) {
  return el("table", { class: "records-table records-table--issues", "aria-labelledby": "student-issues-list" }, [
    el("thead", {}, el("tr", {}, ["Student", "Issue", "Status", "Actions"].map((heading) => el("th", { scope: "col" }, heading)))),
    el("tbody", {}, issues.map((issue) => {
      const isOpen = issue.status === "open";
      const details = el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => showDetails(issue, profile, onUpdated), "aria-label": `Details for ${issue.studentName || "student"}` }, "Details");
      const action = el("button", { type: "button", class: "btn btn--ghost btn--sm", "aria-label": `${isOpen ? "Resolve" : "Reopen"} issue for ${issue.studentName || "student"}`, onClick: (event) => {
        if (isOpen) showResolve(issue, profile, onUpdated);
        else reopen(issue, profile, onUpdated, event.currentTarget);
      } }, isOpen ? "Resolve" : "Reopen");
      const context = contextLabel(issue.context);
      return el("tr", {}, [
        el("td", { "data-label": "Student", class: "records-table-lead" }, studentIdentity(issue.studentName, issue.admissionNumber, studentUrl(issue))),
        el("td", { "data-label": "Issue" }, [
          categoryTag(issue.category),
          el("p", { class: "records-excerpt" }, issue.description || "No description recorded."),
          context ? el("p", { class: "records-muted records-meta" }, context) : null,
        ]),
        el("td", { "data-label": "Status" }, [
          caseStatus(isOpen),
          el("div", { class: "records-muted records-meta" }, issue.raisedAt ? `Reported ${formatDate(issue.raisedAt)}` : "Report date unavailable"),
          !isOpen && issue.resolvedAt ? el("div", { class: "records-muted" }, `Resolved ${formatDate(issue.resolvedAt)}`) : null,
        ]),
        el("td", { "data-label": "Actions", class: "records-table-actions" }, el("div", { class: "records-actions" }, [details, action])),
      ]);
    })),
  ]);
}

function showLogIssue(profile, loadStudents, onCreated) {
  let selected = null;
  let students;
  const search = el("input", { id: "issue-student", type: "search", autocomplete: "off", placeholder: "Student name or admission number" });
  const matches = el("div", { class: "records-student-picker", hidden: "" });
  const selection = el("div", { class: "records-selected-student", hidden: "" });
  const category = el("select", { id: "issue-category", required: "" }, [el("option", { value: "" }, "Select category"),
    ...ISSUE_CATEGORIES.map(({ value, label }) => el("option", { value }, label))]);
  const description = el("textarea", { id: "issue-description", required: "", rows: 4, placeholder: "Describe what’s wrong and what you’ve verified." });
  const year = el("input", { type: "number", id: "issue-context-year", value: String(new Date().getFullYear()) });
  const term = el("select", { id: "issue-context-term" }, [el("option", { value: "" }, "Select term"),
    ...["Term 1", "Term 2", "Term 3"].map((value) => el("option", { value }, value))]);
  const subject = el("input", { id: "issue-context-subject", placeholder: "e.g. Mathematics" });
  const cancel = el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Cancel");
  const submit = el("button", { type: "submit", class: "btn btn--primary" }, [icon("add"), "Log issue"]);

  function selectStudent(student) {
    selected = student;
    search.hidden = matches.hidden = true;
    selection.replaceChildren(studentIdentity(student.fullName, student.admissionNumber, null, [student.grade, student.stream].filter(Boolean).join(" ")),
      el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: () => {
        selected = null;
        selection.hidden = true;
        search.hidden = false;
        search.value = "";
        search.focus();
      } }, "Change student"));
    selection.hidden = false;
    category.focus();
  }

  function refreshMatches() {
    const query = search.value.trim().toLowerCase();
    matches.hidden = !query || !!selected;
    if (matches.hidden) return;
    const found = students?.filter((student) => [student.fullName, student.admissionNumber].filter(Boolean).join(" ").toLowerCase().includes(query)).slice(0, 7);
    matches.replaceChildren(found?.length
      ? el("ul", {}, found.map((student) => el("li", {}, el("button", { type: "button", onClick: () => selectStudent(student) },
        studentIdentity(student.fullName, student.admissionNumber, null, [student.grade, student.stream].filter(Boolean).join(" "))))))
      : el("p", { class: "records-muted", role: "status" }, students ? "No matching students." : "Loading students…"));
  }

  const form = el("form", { class: "records-dialog-body" }, [
    el("div", { class: "field" }, [el("label", { for: search.id }, "Student"), search, selection, matches]),
    recordField("Category", category),
    recordField("Issue description", description),
    el("details", { class: "records-details" }, [el("summary", {}, "Academic context (optional)"),
      el("div", { class: "records-dialog-grid" }, [recordField("Academic year", year), recordField("Term", term), recordField("Subject or paper", subject)])]),
    el("div", { class: "records-dialog-actions" }, [cancel, submit]),
  ]);
  const close = openRecordModal("Log student issue", form, search);
  const studentError = el("p", { class: "records-muted", role: "status", hidden: "" }, "Student records couldn’t load. Close this form and try again.");
  search.after(studentError);
  search.addEventListener("input", refreshMatches);
  loadStudents().then((data) => { students = data; refreshMatches(); }).catch(() => {
    matches.hidden = true;
    search.disabled = true;
    submit.disabled = true;
    studentError.hidden = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    if (!selected) {
      toast("Select a student from the search results.", "error");
      search.focus();
      return;
    }
    if (!description.value.trim()) {
      toast("Describe the issue before logging it.", "error");
      description.focus();
      return;
    }
    const restore = busyButton(submit, "Logging…");
    try {
      const context = Object.fromEntries(Object.entries({ academicYear: year.value.trim(), term: term.value, subjectCode: subject.value.trim() }).filter(([, value]) => value));
      await raiseIssue(profile.uid, { studentId: selected.id, studentName: selected.fullName, admissionNumber: selected.admissionNumber || "",
        category: category.value, description: description.value.trim(), context });
      toast(`Issue logged for ${selected.fullName}.`, "success");
      close();
      await onCreated();
    } catch (error) {
      toast(error.message || "Couldn’t log this issue.", "error");
      restore();
    }
  });
}

function showResolve(issue, profile, onUpdated) {
  const note = el("textarea", { id: "resolution-note", rows: 4, placeholder: "Describe the action you took." });
  const useNote = el("select", { id: "issue-resolution-template" }, [el("option", { value: "" }, "Choose a starting point"),
    ...RESOLUTION_NOTES.map((value) => el("option", { value }, value))]);
  useNote.addEventListener("change", () => {
    if (!useNote.value) return;
    note.value = [note.value.trim(), useNote.value].filter(Boolean).join("\n");
    useNote.value = "";
    note.focus();
  });
  const cancel = el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Cancel");
  const submit = el("button", { type: "submit", class: "btn btn--primary" }, [icon("check"), "Mark resolved"]);
  const form = el("form", { class: "records-dialog-body" }, [
    el("div", { class: "records-detail" }, [studentIdentity(issue.studentName, issue.admissionNumber),
      el("p", { class: "records-meta" }, issue.description || "No description recorded.")]),
    recordField("Resolution note", note),
    recordField("Insert a suggested note (optional)", useNote),
    el("div", { class: "records-dialog-actions" }, [cancel, submit]),
  ]);
  const close = openRecordModal("Resolve student issue", form, note);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const restore = busyButton(submit, "Resolving…");
    try {
      await resolveIssue(profile.uid, issue.id, note.value.trim());
      toast("Student issue resolved.", "success");
      close();
      await onUpdated();
    } catch (error) {
      toast(error.message || "Couldn’t resolve this issue.", "error");
      restore();
    }
  });
}

function showDetails(issue, profile, onUpdated) {
  const isOpen = issue.status === "open";
  const dismiss = el("button", { type: "button", class: "btn btn--ghost", onClick: () => close() }, "Close");
  const update = el("button", { type: "button", class: "btn btn--primary", onClick: async (event) => {
    if (isOpen) {
      close({ immediate: true });
      showResolve(issue, profile, onUpdated);
    } else if (await reopen(issue, profile, onUpdated, event.currentTarget)) {
      close();
    }
  } }, isOpen ? "Resolve issue" : "Reopen issue");
  const student = studentIdentity(issue.studentName, issue.admissionNumber, studentUrl(issue));
  student.querySelector("a").addEventListener("click", () => close());
  const context = contextLabel(issue.context);
  const body = el("div", { class: "records-dialog-body" }, [
    el("div", { class: "records-toolbar" }, [student, caseStatus(isOpen)]),
    el("div", { class: "records-actions" }, [categoryTag(issue.category), el("span", { class: "records-muted" }, `Reported ${dateLabel(issue.raisedAt)}`)]),
    context ? el("p", { class: "records-muted" }, `Academic context · ${context}`) : null,
    el("section", { class: "records-detail" }, [el("h4", {}, "Issue description"), el("p", {}, issue.description || "No description recorded.")]),
    !isOpen ? el("section", { class: "records-detail" }, [el("h4", {}, "Resolution"), el("p", {}, issue.resolutionNote || "No resolution note recorded."),
      issue.resolvedAt ? el("div", { class: "records-muted" }, dateLabel(issue.resolvedAt)) : null]) : null,
    el("div", { class: "records-dialog-actions" }, [dismiss, update]),
  ]);
  const close = openRecordModal("Student issue details", body);
}

async function reopen(issue, profile, onUpdated, button) {
  if (!confirm(`Reopen the issue for ${issue.studentName || "this student"}?`)) return false;
  const restore = busyButton(button, "Reopening…");
  try {
    await reopenIssue(profile.uid, issue.id);
    toast("Student issue reopened.", "success");
    await onUpdated();
    return true;
  } catch (error) {
    toast(error.message || "Couldn’t reopen this issue.", "error");
    restore();
    return false;
  }
}
