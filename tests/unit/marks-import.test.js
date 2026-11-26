import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const marks = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn() }));

vi.mock("../../js/services/marks.service.js", () => ({
  listMarks: marks.list,
  bulkUpsertMarks: marks.save,
  listMarksByAssessment: vi.fn(),
  upsertMark: vi.fn(),
}));
vi.mock("../../js/services/academic.service.js", () => ({
  seedDefaultsIfEmpty: async () => {},
  listClasses: async () => [{ grade: "Grade 5", streams: ["Blue"] }],
  listSubjects: async () => [{ code: "MATH", name: "Mathematics" }],
}));
vi.mock("../../js/services/assessment.service.js", () => ({
  getAssessmentMaxScore: (assessment, subjectCode) => assessment.subjectMaxScores[subjectCode],
  listAssessments: async () => [{
    id: "exam", name: "Main Exam", term: "Term 3", academicYear: 2026, status: "open",
    maxScore: 100, subjectMaxScores: { MATH: 50 },
  }],
  setAssessmentStatus: vi.fn(),
}));
vi.mock("../../js/services/student.service.js", () => ({
  listStudents: async () => [
    ["new", "001", "Amina New"], ["existing", "ADM002", "Joy Existing"], ["duplicate", "ADM003", "Lee Duplicate"],
    ["invalid", "ADM004", "Eli Invalid"], ["blank", "ADM005", "Sam Blank"], ["quoted", "ADM,006", "Kim Quoted"],
    ["same", "ADM007", "Tess Same"],
  ].map(([id, admissionNumber, fullName]) => ({ id, admissionNumber, fullName, grade: "Grade 5", stream: "Blue", status: "active" })),
}));

import { render } from "../../views/marks.js";

const button = (label, root = document) => [...root.querySelectorAll("button")].find((node) =>
  [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim() === label
);
const dialog = () => document.querySelector('[role="dialog"]');
const scoreInput = (studentId) => document.querySelector(`input[data-student-id="${studentId}"]`);

function paste(text) {
  const area = dialog().querySelector("textarea");
  area.value = text;
  area.dispatchEvent(new Event("input"));
  button("Review Scores", dialog()).click();
}

let renderCount = 0;
beforeEach(async () => {
  document.body.replaceChildren();
  marks.save.mockReset().mockResolvedValue({ failed: [] });
  marks.list.mockReset().mockResolvedValue([{ studentId: "existing", score: 0 }, { studentId: "same", score: 20 }]);
  document.body.append(await render({ profile: { uid: `teacher-${++renderCount}`, schoolId: "school", role: "admin" } }));
  await vi.waitFor(() => expect(button("Import Scores")).toBeDefined());
});

afterEach(() => {
  document.querySelector(".modal__close")?.click();
  window.dispatchEvent(new Event("eeskia-platform-lockdown"));
});

describe("Import Scores from the Marks Entry sheet", () => {
  it("reviews spreadsheet rows and skips invalid entries without applying before confirmation", async () => {
    button("Import Scores").click();
    expect(dialog().textContent).toMatch(/Grade 5 Blue.*Mathematics.*Main Exam \(Term 3 2026\).*Maximum score50/);
    paste([
      "Admission Number\tScore",
      "001\t0",
      "adm002\t37.5",
      "ADM003\t20",
      "adm003\t21",
      "ADM004\t51",
      "ADM005\t",
      "UNKNOWN\t8",
      "ADM007\t20",
      "",
    ].join("\r\n"));

    expect(dialog().querySelector(".marks-import__summary").textContent).toBe("1 to apply · 1 existing kept · 5 skipped · 1 unchanged");
    expect(dialog().textContent).toContain("Duplicate admission number in paste");
    expect(dialog().textContent).toContain("Score exceeds 50");
    expect(dialog().textContent).toContain("Blank score");
    expect(dialog().textContent).toContain("Admission number isn’t in this class");
    expect(dialog().querySelector('input[type="checkbox"]').checked).toBe(false);
    expect(scoreInput("new").value).toBe("");
    expect(scoreInput("existing").value).toBe("0");
    expect(marks.save).not.toHaveBeenCalled();

    button("Apply 1 Score", dialog()).click();
    await vi.waitFor(() => expect(dialog().textContent).toContain("1 score saved."));
    expect(marks.save).toHaveBeenCalledExactlyOnceWith(expect.any(String), "exam", "MATH", [
      { studentId: "new", grade: "Grade 5", stream: "Blue", score: "0", maxScore: 50 },
    ]);
    expect(scoreInput("existing").value).toBe("0");
  });

  it("keeps the paste when editing and leaves the sheet unchanged on cancel", () => {
    const trigger = button("Import Scores");
    trigger.click();
    const text = 'ADM002, 14\n"ADM,006", 31.25';
    paste(text);
    expect(dialog().textContent).toContain("Kim Quoted");
    button("Edit Paste", dialog()).click();
    expect(dialog().querySelector("textarea").value).toBe(text);
    button("Cancel", dialog()).click();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(scoreInput("quoted").value).toBe("");
    expect(scoreInput("existing").value).toBe("0");
    expect(marks.save).not.toHaveBeenCalled();
  });

  it("applies only selected replacements and reports confirmed and pending saves", async () => {
    let finishSave;
    marks.save.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    button("Import Scores").click();
    paste("001\t22\nADM002\t12.5");
    const replace = dialog().querySelector('input[type="checkbox"]');
    replace.checked = true;
    replace.dispatchEvent(new Event("change"));

    button("Apply 2 Scores", dialog()).click();
    expect(dialog().textContent).toContain("Saving scores");
    expect(dialog().textContent).not.toContain("Scores saved");
    expect(marks.save.mock.calls[0][3]).toEqual([
      expect.objectContaining({ studentId: "new", score: "22" }),
      expect.objectContaining({ studentId: "existing", score: "12.5" }),
    ]);
    finishSave({ failed: [{ studentId: "existing" }] });
    await vi.waitFor(() => expect(dialog().textContent).toContain("1 score saved. 1 score is pending."));
    expect(document.getElementById("status-existing").textContent).toBe("Retry pending");
  });

  it("requires a new review when the underlying score changes after preview", () => {
    button("Import Scores").click();
    paste("001\t30");
    const input = scoreInput("new");
    input.value = "15";
    input.dispatchEvent(new Event("input"));
    button("Apply 1 Score", dialog()).click();

    expect(dialog().textContent).toContain("Scores changed while this window was open.");
    expect(button("Apply 0 Scores", dialog()).disabled).toBe(true);
    expect(input.value).toBe("15");
    expect(marks.save).not.toHaveBeenCalled();
  });

  it("saves the import after an in-progress save finishes without losing the replacement", async () => {
    let finishSave;
    marks.save.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const input = scoreInput("existing");
    input.value = "18";
    input.dispatchEvent(new Event("input"));
    button("Save All Now").click();

    button("Import Scores").click();
    paste("ADM002\t29");
    const replace = dialog().querySelector('input[type="checkbox"]');
    replace.checked = true;
    replace.dispatchEvent(new Event("change"));
    button("Apply 1 Score", dialog()).click();
    expect(marks.save).toHaveBeenCalledTimes(1);

    finishSave({ failed: [] });
    await vi.waitFor(() => expect(dialog().textContent).toContain("1 score saved."));
    expect(marks.save.mock.calls.map(([, , , [entry]]) => entry.score)).toEqual(["18", "29"]);
    expect(input.value).toBe("29");
    expect(document.getElementById("status-existing").textContent).toBe("Saved");
  });
});
