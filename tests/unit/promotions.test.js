import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  docs: new Map(), commits: 0, failCommit: 0, profile: null, writes: [],
}));

vi.mock("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js", () => {
  const snapshot = (ref) => ({
    id: ref.split("/").at(-1),
    ref,
    exists: () => store.docs.has(ref),
    data: () => structuredClone(store.docs.get(ref)),
  });
  return {
    arrayUnion: (value) => ({ union: value }),
    collection: (_, ...path) => path.join("/"),
    doc: (_, ...path) => path.join("/"),
    getDocFromServer: async (ref) => snapshot(ref),
    getDocsFromServer: async ({ path, filters }) => ({
      docs: [...store.docs].filter(([ref, data]) => ref.startsWith(path + "/") &&
        filters.every(([field, value]) => data[field] === value)).map(([ref]) => snapshot(ref)),
    }),
    query: (path, ...filters) => ({ path, filters }),
    serverTimestamp: () => "server timestamp",
    where: (field, operator, value) => [field, value],
    runTransaction: async (_, operation) => {
      const writes = [];
      const result = await operation({
        get: async (ref) => {
          if (writes.length) throw new Error("Read after write");
          return snapshot(ref);
        },
        set: (ref, value) => writes.push(["set", ref, value]),
        update: (ref, value) => writes.push(["update", ref, value]),
      });
      if (!writes.length) return result;
      if (++store.commits === store.failCommit) throw new Error("Connection interrupted");
      for (const [method, ref, value] of writes) {
        const previous = store.docs.get(ref);
        const updated = structuredClone(value);
        for (const [key, field] of Object.entries(updated)) {
          if (field?.union) updated[key] = [...(previous?.[key] || []), field.union];
        }
        if (ref.startsWith("alumni/") && previous) throw new Error("Alumni record cannot be updated");
        store.docs.set(ref, method === "update" ? { ...previous, ...updated } : updated);
        store.writes.push(ref);
      }
      return result;
    },
  };
});

vi.mock("../../js/firebase-config.js", () => ({ db: {} }));
vi.mock("../../js/services/settings.service.js", () => ({
  DEFAULT_SETTINGS: { currentAcademicYear: "2026", currentTerm: "Term 1", terms: ["Term 1", "Term 2", "Term 3"] },
}));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchoolId: () => "school",
  getCurrentProfile: () => store.profile,
}));

import {
  buildGradeProgression, commitPromotionPlan, generatePromotionPlan, loadPromotionWorkspace,
  promotionRollover,
} from "../../js/services/promotion.service.js";
import { render } from "../../views/promotions.js";

const school = "schools/school";
const checkpoint = school + "/promotion_runs/current";
const calendar = (overrides = {}) => ({
  currentAcademicYear: "2026", currentTerm: "Term 3", terms: ["Term 1", "Term 2", "Term 3"],
  termBegins: "2026-09-01", closingDate: "2026-11-27", openingDate: "2027-01-10", ...overrides,
});
const student = (id, grade, stream = "", overrides = {}) => ({
  id, schoolId: "school", fullName: "Learner " + id, admissionNumber: id, status: "active", grade, stream, ...overrides,
});
const add = (record) => {
  const { id, ...data } = record;
  store.docs.set("students/" + id, data);
};
const addClass = (id, grade, streams = []) => store.docs.set("classes/" + id, { schoolId: "school", grade, streams });
const found = (label, root = document) => [...root.querySelectorAll("button")].find((button) =>
  [...button.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim() === label
);

function select(id, value) {
  const node = document.querySelector(id);
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  store.docs.clear();
  store.commits = 0;
  store.failCommit = 0;
  store.writes.length = 0;
  store.profile = { uid: "admin", role: "admin" };
  addClass("grade5", "Grade 5", ["Blue", "Green"]);
  addClass("grade6", "Grade 6", ["Blue", "Green"]);
  addClass("grade7", "Grade 7");
  store.docs.set(school, calendar());
});

async function planFor(mode = "auto", options = {}) {
  const workspace = await loadPromotionWorkspace();
  return {
    plan: generatePromotionPlan(workspace.students, workspace.classes, options),
    options: { ...workspace, runId: "run", mode },
  };
}

describe("Promotion planning", () => {
  it("orders pre-primary and numbered grades, keeps Forms separate, and flags missing classes or gaps", () => {
    const classes = ["PP2", "Form 1", "Grade 3", "Grade 1", "PP1", "Form 2", "Custom"]
      .map((grade) => ({ grade }));
    expect(buildGradeProgression(classes)).toStrictEqual({
      PP1: "PP2", PP2: "Grade 1", "Grade 1": undefined, "Grade 3": null, "Form 1": "Form 2", "Form 2": null,
    });
    const people = [
      student("gap", "Grade 1"), student("custom", "Custom"), student("missing", "Grade 2"),
      student("inactive", "PP1", "", { status: "transferred" }),
    ];
    expect(generatePromotionPlan(people, classes).map(({ action }) => action)).toEqual(["unassigned", "unassigned", "unassigned"]);
    expect(generatePromotionPlan(people, classes, { sourceGrade: "Grade 1", destinationGrade: null })[0].action).toBe("graduate");
  });

  it("keeps streams where available and clears the stream when the destination has none", async () => {
    add(student("keep", "Grade 5", "Green"));
    add(student("assign", "Grade 5", "Red"));
    add(student("clear", "Grade 6", "Blue"));
    const { plan } = await planFor();
    expect(plan).toMatchObject([
      { toGrade: "Grade 6", toStream: "Blue", warning: "Current stream is unavailable in this grade." },
      { toGrade: "Grade 6", toStream: "Green", warning: "" },
      { toGrade: "Grade 7", toStream: "", warning: "" },
    ]);
    expect(store.writes).toEqual([]);
  });

  it("requires the configured final term and a valid school year", () => {
    expect(promotionRollover(calendar({ currentTerm: "Term 2" }))).toBeNull();
    expect(promotionRollover(calendar({ currentAcademicYear: "2026/27" }))).toBeNull();
    expect(promotionRollover(calendar({ terms: [], currentTerm: "" }))).toBeNull();
    expect(promotionRollover(calendar())).toEqual({ year: "2027", term: "Term 1" });
  });
});

describe("Promotion saves", () => {
  it("saves a manual early graduation and is idempotent without rolling the calendar", async () => {
    store.docs.set(school, calendar({ currentTerm: "Term 2" }));
    add(student("graduate", "Grade 5", "Green"));
    const { plan, options } = await planFor("manual", { sourceGrade: "Grade 5", destinationGrade: null });
    await expect(commitPromotionPlan("admin", plan, options)).resolves.toMatchObject({ graduated: 1, promoted: 0, rollover: null });
    await expect(commitPromotionPlan("admin", plan, options)).resolves.toMatchObject({ graduated: 1, done: 1 });
    expect(store.docs.get("students/graduate")).toMatchObject({ status: "graduated", statusHistory: [{ status: "graduated" }] });
    expect(store.docs.get("alumni/graduate")).toMatchObject({ schoolId: "school", originalStudentId: "graduate", graduationYear: "2026" });
    expect(store.docs.get(school)).toEqual(calendar({ currentTerm: "Term 2" }));
    expect(store.writes.filter((path) => path === "alumni/graduate")).toHaveLength(1);
  });

  it("advances the configured calendar once and keeps excluded and other-school learners in place", async () => {
    store.docs.set(school, calendar({ terms: ["Semester 1", "Semester 2"], currentTerm: "Semester 2" }));
    add(student("move", "Grade 5", "Blue"));
    add(student("retain", "Grade 6", "Blue"));
    add(student("graduate", "Grade 7"));
    add(student("foreign", "Grade 5", "Blue", { schoolId: "other" }));
    const { plan, options } = await planFor();
    plan.find(({ student }) => student.id === "retain").excluded = true;
    await expect(commitPromotionPlan("admin", plan, options)).resolves.toMatchObject({ promoted: 1, graduated: 1, retained: 1 });
    expect(store.docs.get("students/move")).toMatchObject({ grade: "Grade 6", stream: "Blue" });
    expect(store.docs.get("students/retain")).toMatchObject({ grade: "Grade 6", stream: "Blue" });
    expect(store.docs.get("students/foreign")).toMatchObject({ grade: "Grade 5", schoolId: "other" });
    expect(store.docs.get(school)).toMatchObject({
      currentAcademicYear: "2027", currentTerm: "Semester 1", lastCompletedPromotionYear: "2026",
      termBegins: "2026-09-01", openingDate: "2027-01-10", closingDate: "2026-11-27",
    });
    await expect(commitPromotionPlan("admin", plan, { ...options, runId: "other-tab" })).rejects.toThrow("calendar changed");
    store.docs.set(school, calendar({ terms: ["Semester 1", "Semester 2"], currentTerm: "Semester 2", lastCompletedPromotionYear: "2026" }));
    await expect(commitPromotionPlan("admin", plan, { ...options, runId: "restored-year" })).rejects.toThrow("already completed");
    expect(store.writes.filter((path) => path.startsWith("audit_logs/"))).toEqual(["audit_logs/run"]);
  });

  it("resumes a large run at the saved checkpoint without moving the first group again", async () => {
    for (let i = 0; i < 202; i++) add(student(String(i).padStart(3, "0"), "Grade 5", "Blue"));
    add(student("graduate", "Grade 7"));
    const { plan, options } = await planFor();
    store.failCommit = 2;
    const progress = vi.fn();
    await expect(commitPromotionPlan("admin", plan, { ...options, onProgress: progress })).rejects.toThrow("Connection interrupted");
    expect(progress).toHaveBeenCalledTimes(1);
    expect(store.docs.get(school).currentAcademicYear).toBe("2026");
    const { pendingRun } = await loadPromotionWorkspace();
    expect(pendingRun).toMatchObject({ id: "run", done: 200, promoted: 200, status: "pending" });
    await expect(commitPromotionPlan("admin", plan, { ...options, runId: "another-admin" })).rejects.toThrow("Another promotion");
    await expect(commitPromotionPlan("admin", null, options)).resolves.toMatchObject({ done: 203, promoted: 202, graduated: 1, status: "complete" });
    expect(store.writes.filter((ref) => ref === "students/000")).toHaveLength(1);
    expect(store.docs.get("students/000").grade).toBe("Grade 6");
    expect(store.docs.get(school).currentAcademicYear).toBe("2027");
  });

  it("stops before saving if a learner or destination changes and continues only after approved skips", async () => {
    add(student("transferred", "Grade 5", "Blue"));
    add(student("removed-destination", "Grade 6", "Blue"));
    add(student("graduate", "Grade 7"));
    const { plan, options } = await planFor();
    store.docs.get("students/transferred").status = "transferred";
    store.docs.delete("classes/grade7");
    await expect(commitPromotionPlan("admin", plan, options)).rejects.toMatchObject({
      conflicts: [{ id: "transferred" }, { id: "removed-destination" }],
    });
    expect(store.writes).toEqual([]);
    await expect(commitPromotionPlan("admin", plan, { ...options, approvedSkips: ["transferred", "removed-destination"] }))
      .resolves.toMatchObject({ skipped: 2, graduated: 1 });
    expect(store.docs.get("students/transferred")).toMatchObject({ status: "transferred", grade: "Grade 5" });
    expect(store.docs.get("students/removed-destination").grade).toBe("Grade 6");
  });

  it("rejects duplicate learners, no-op plans, and non-admin saves", async () => {
    add(student("move", "Grade 5", "Blue"));
    const { plan, options } = await planFor();
    await expect(commitPromotionPlan("admin", [...plan, plan[0]], options)).rejects.toThrow("duplicate");
    await expect(commitPromotionPlan("admin", [{ ...plan[0], toGrade: "Grade 5" }], options)).rejects.toThrow("at least one learner");
    store.profile = { uid: "principal", role: "principal" };
    await expect(commitPromotionPlan("principal", plan, options)).rejects.toThrow("Only an administrator");
    expect(store.writes).toEqual([]);
  });
});

describe("Promotions workflow", () => {
  it("keeps a manual destination through review, Keep and Restore, and shows the saved result", async () => {
    store.docs.set(school, calendar({ currentTerm: "Term 2" }));
    add(student("first", "Grade 5", "Blue"));
    add(student("second", "Grade 6", "Green"));
    document.body.append(await render({ profile: store.profile }));
    expect(document.querySelector('input[value="auto"]').disabled).toBe(true);
    expect([...document.querySelector("#promotion-source").options].map(({ value }) => value)).toEqual(["Grade 5", "Grade 6"]);
    select("#promotion-destination", "Grade 7");
    found("Review Plan").click();
    expect(document.querySelector("tbody").textContent).toContain("Grade 7");
    found("Keep").click();
    expect(found("Continue to Confirmation").disabled).toBe(true);
    found("Restore").click();
    expect(document.querySelector("tbody").textContent).toContain("Grade 7");
    found("Continue to Confirmation").click();
    expect(document.body.textContent).toContain("Term 2 2026 stays active");
    expect(found("Save Learner Changes").disabled).toBe(true);
    expect(store.writes).toHaveLength(0);
    document.querySelector("#promotion-confirm").click();
    found("Save Learner Changes").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Promotions saved"));
    expect(store.docs.get("students/first")).toMatchObject({ grade: "Grade 7", stream: "" });
    expect(store.docs.get("students/second").grade).toBe("Grade 6");
    expect(store.docs.get(school).currentTerm).toBe("Term 2");
  });

  it("blocks automatic confirmation until an unknown grade is handled and shows preview-only access", async () => {
    store.profile = { uid: "principal", role: "principal" };
    add(student("unknown", "Unconfigured"));
    add(student("move", "Grade 5", "Blue"));
    document.body.append(await render({ profile: store.profile }));
    expect(document.body.textContent).toContain("A school administrator can save promotions.");
    found("Review Plan").click();
    expect(document.querySelector("#promotion-filter").value).toBe("attention");
    expect(document.querySelector("tbody").textContent).toContain("Current grade is missing");
    expect(found("Continue to Confirmation").disabled).toBe(true);
    found("Keep").click();
    found("Continue to Confirmation").click();
    expect(document.body.textContent).toContain("Term 3 2026 → Term 1 2027");
    expect(found("Save Promotions and Start New Year")).toBeUndefined();
    expect(store.writes).toHaveLength(0);
  });
});
