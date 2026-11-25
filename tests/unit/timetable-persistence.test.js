import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({
  docs: new Map(),
  commits: 0,
  failAt: -1,
}));

vi.mock("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js", () => {
  const snapshot = (path) => ({
    id: path.split("/").at(-1), ref: path,
    data: () => firestore.docs.get(path),
  });
  const batch = () => {
    const writes = [];
    return {
      set: (path, data, options) => writes.push(() =>
        firestore.docs.set(path, options?.merge ? { ...firestore.docs.get(path), ...data } : data)),
      delete: (path) => writes.push(() => firestore.docs.delete(path)),
      commit: async () => {
        if (++firestore.commits === firestore.failAt) throw new Error("Interrupted write");
        writes.forEach((write) => write());
      },
    };
  };
  const getDocs = async ({ collection, filters }) => ({
    docs: [...firestore.docs].filter(([path, record]) => path.startsWith(`${collection}/`) &&
      filters.every(([key, value]) => record[key] === value)).map(([path]) => snapshot(path)),
  });
  return {
    collection: (_, name) => name,
    doc: (_, ...segments) => segments.join("/"),
    where: (field, op, value) => [field, value],
    query: (collection, ...filters) => ({ collection, filters }),
    getDocs,
    getDocsFromServer: getDocs,
    getDoc: async (path) => snapshot(path),
    getDocFromServer: async (path) => snapshot(path),
    setDoc: async (path, data) => { firestore.docs.set(path, data); },
    serverTimestamp: () => 1,
    writeBatch: batch,
    runTransaction: async (_, callback) => {
      const transaction = { ...batch(), get: async (path) => snapshot(path) };
      await callback(transaction);
      await transaction.commit();
    },
  };
});

vi.mock("../../js/firebase-config.js", () => ({ db: {} }));
vi.mock("../../js/services/auth.service.js", () => ({ getCurrentSchoolId: () => "school" }));
vi.mock("../../js/services/audit.service.js", () => ({ logAction: vi.fn() }));
vi.mock("../../js/services/academic.service.js", () => ({
  slugify: (value) => value.replace(/\s+/g, "_"),
  listClasses: async () => [{ grade: "Grade 7", streams: ["Blue"] }],
  listSubjects: async () => [{ code: "MATH", name: "Mathematics" }],
}));
vi.mock("../../js/services/teacher.service.js", () => ({
  listTeachers: async () => [{
    id: "teacher", fullName: "A. Mwangi",
    teachingAssignments: [{ grade: "Grade 7", stream: "Blue", subjectCode: "MATH" }],
  }],
}));
vi.mock("../../js/services/settings.service.js", () => ({
  getSchoolSettings: async () => ({ schoolName: "Kilimani Junior School" }),
}));
vi.mock("../../js/services/pdf.util.js", async (importOriginal) => ({
  ...await importOriginal(), triggerBlobDownload: vi.fn(),
}));

import {
  assignDoubleSlot, assignSlot, clearClassTimetableSlots, clearDoubleSlot, createSharedTimetable, getMasterTimetable,
  getTeacherTimetable, getTimetableRoomMode, listPeriods, loadTimetableDraftInputs, publishTimetableDraft, setTimetableRoomMode,
} from "../../js/services/timetable.service.js";
import { triggerBlobDownload } from "../../js/services/pdf.util.js";
import * as timetableView from "../../views/timetable.js";

const legacy = {
  schoolId: "school", grade: "Grade 7", stream: "Blue", day: "Monday", periodId: "p1", subjectCode: "ENG",
};
const createDraft = (size, subjectCode) => ({
  slots: Array.from({ length: size }, (_, index) => ({
    grade: `Grade ${index + 7}`, stream: "Blue", day: "Monday", periodId: "p1", subjectCode,
  })),
  issues: [], plan: [],
});

describe("Publishing a timetable draft", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    firestore.docs.clear();
    firestore.docs.set("timetable_slots/legacy-slot", legacy);
    firestore.commits = 0;
    firestore.failAt = -1;
  });

  it("keeps the published timetable readable when a staged batch fails", async () => {
    const base = await loadTimetableDraftInputs();
    firestore.failAt = 2;
    await expect(publishTimetableDraft("admin", createDraft(451, "MATH"), base)).rejects.toThrow("Interrupted write");
    expect(await getMasterTimetable(true)).toEqual([{ ...legacy, id: "legacy-slot" }]);
    expect(firestore.docs.size).toBe(1);
  });

  it("switches all batches together and rejects another draft based on the old revision", async () => {
    const base = await loadTimetableDraftInputs();
    await publishTimetableDraft("admin", createDraft(451, "MATH"), base);
    await expect(publishTimetableDraft("admin", createDraft(1, "SCI"), base)).rejects.toThrow("changed while you were working");
    const active = await getMasterTimetable(true);
    expect(active).toHaveLength(451);
    expect(active.every((slot) => slot.subjectCode === "MATH")).toBe(true);
    expect(firestore.docs.size).toBe(452);
  });

  it("stores the approved lessons as one weekly document per stream", async () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const slots = Array.from({ length: 7 }, (_, index) => days.flatMap((day) =>
      Array.from({ length: 8 }, (_, period) => ({
        ...legacy, stream: `Stream ${index + 1}`, day, periodId: `p${period + 1}`,
      })))).flat();
    await publishTimetableDraft("admin", { slots, issues: [], plan: [] }, await loadTimetableDraftInputs());
    const weeks = [...firestore.docs.values()].filter((record) => record.kind === "class_week");
    expect(weeks).toHaveLength(7);
    expect(weeks.every(({ lessons }) => lessons.length === 40 && lessons.every((slot) => !("stream" in slot)))).toBe(true);
    expect(firestore.docs.size).toBe(8);
    const active = await getMasterTimetable(true);
    expect(active).toHaveLength(280);
    expect(new Set(active.map(({ id }) => id)).size).toBe(280);
    expect(active.some((slot) => slot.stream === "Stream 7" && slot.day === "Friday")).toBe(true);
  });

  it("edits legacy generations by migrating just the affected class and keeps double lessons editable", async () => {
    const generation = "existing";
    firestore.docs.set("timetable_slots/school__timetable_state", { schoolId: "school", generation, revision: "before" });
    firestore.docs.set("timetable_slots/legacy-slot", { ...legacy, generation });
    const unrelated = { ...legacy, grade: "Grade 8", generation };
    firestore.docs.set("timetable_slots/unrelated", unrelated);
    firestore.docs.set("periods/p1", { schoolId: "school", name: "Period 1", startTime: "08:00", endTime: "08:40" });
    firestore.docs.set("periods/p2", { schoolId: "school", name: "Period 2", startTime: "08:40", endTime: "09:20" });
    await listPeriods(true);
    expect(await getMasterTimetable(true)).toHaveLength(2);

    await assignDoubleSlot("admin", {
      ...legacy, period1Id: "p1", period2Id: "p2", subjectCode: "SCI", teacherId: "science",
    });
    const week = [...firestore.docs.values()].find((record) => record.kind === "class_week");
    expect(week).toMatchObject({ grade: "Grade 7", stream: "Blue", generation, lessons: [
      { periodId: "p1", isDouble: true }, { periodId: "p2", isDouble: true },
    ] });
    expect(firestore.docs.has("timetable_slots/legacy-slot")).toBe(false);
    expect(firestore.docs.get("timetable_slots/unrelated")).toBe(unrelated);
    expect(Object.keys(await getTeacherTimetable("science"))).toEqual(["Monday_p1", "Monday_p2"]);

    await clearDoubleSlot("admin", "Grade 7", "Blue", "Monday", "p1", "p2");
    expect(await getMasterTimetable()).toEqual([{ ...unrelated, id: "unrelated" }]);
    await clearClassTimetableSlots("admin", "Grade 8", "Blue");
    expect(await getMasterTimetable()).toEqual([]);
  });

  it("previews a draft from the module and replaces the old lessons only on save", async () => {
    firestore.docs.set("periods/p1", { schoolId: "school", name: "Period 1", startTime: "08:00", endTime: "08:40" });
    await getMasterTimetable(true);
    const context = { profile: { role: "admin", uid: "admin" }, params: { tab: "master" } };
    document.body.append(await timetableView.render(context));
    await timetableView.init?.(context);
    const button = (label) => [...document.querySelectorAll("button")].find((node) => node.textContent.includes(label));
    button("Generate timetable").click();
    await vi.waitFor(() => expect(button("Preview timetable")).toBeDefined());
    expect(document.querySelector('input[aria-label="Room for Mathematics"]')).toBeNull();
    button("Preview timetable").closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(button("Replace saved timetable")).toBeDefined());
    expect(document.querySelector(".tt-draft-chart").textContent).toContain("Mathematics");
    const commits = firestore.commits;
    button("Download draft PDF").click();
    await vi.waitFor(() => expect(triggerBlobDownload).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/pdf" }), "Draft_Master_Timetable.pdf",
    ));
    expect(firestore.commits).toBe(commits);
    expect((await getMasterTimetable(true))[0].subjectCode).toBe("ENG");
    button("Replace saved timetable").click();
    await vi.waitFor(async () => {
      const active = await getMasterTimetable(true);
      expect(active).toHaveLength(5);
      expect(active.every((slot) => slot.subjectCode === "MATH" && slot.teacherId === "teacher")).toBe(true);
    });
  });

  it("persists the room switch and brings back room names in the master view", async () => {
    firestore.docs.set("periods/p1", { schoolId: "school", name: "Period 1", startTime: "08:00", endTime: "08:40" });
    firestore.docs.set("timetable_slots/legacy-slot", { ...legacy, room: "Science Lab" });
    await getMasterTimetable(true);
    document.body.append(await timetableView.render({ profile: { role: "admin", uid: "admin" }, params: { tab: "periods" } }));
    const toggle = document.querySelector('[role="switch"]');
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(async () => {
      expect(toggle.disabled).toBe(false);
      expect(await getTimetableRoomMode()).toBe(true);
    });
    document.querySelector('[data-tab="master"]').click();
    await vi.waitFor(() => expect(document.querySelector(".tt-chart").textContent).toContain("Science Lab"));
    await setTimetableRoomMode("admin", false);
    document.body.replaceChildren(await timetableView.render({ profile: { role: "admin", uid: "admin" }, params: { tab: "master" } }));
    expect(document.querySelector(".tt-chart").textContent).not.toContain("Science Lab");
    expect((await getMasterTimetable())[0].room).toBe("Science Lab");
  });

  it("checks named room bookings only when enabled and preserves rooms during ordinary edits", async () => {
    firestore.docs.set("periods/p1", { schoolId: "school", name: "Period 1", startTime: "08:00", endTime: "08:40" });
    firestore.docs.set("timetable_slots/legacy-slot", { ...legacy, room: "Science Lab" });
    const parallel = { ...legacy, stream: "East", subjectCode: "SCI", room: "Science Lab" };
    await assignSlot("admin", parallel);
    await assignSlot("admin", { ...legacy, teacherId: "english", room: "" });
    const active = await getMasterTimetable(true);
    expect(active.find(({ stream }) => stream === "East").room).toBe("");
    expect(active.find(({ stream }) => stream === "Blue").room).toBe("Science Lab");
    await setTimetableRoomMode("admin", true);
    await expect(assignSlot("admin", parallel)).rejects.toThrow('Room "Science Lab" is already booked');
    await setTimetableRoomMode("admin", false);
  });

  it("takes new share snapshots using the saved room setting", async () => {
    const slots = [{ ...legacy, room: "Science Lab" }];
    const implicit = await createSharedTimetable("admin", { slots });
    expect(implicit.payload.useNamedRooms).toBe(false);
    expect(implicit.payload.slots[0].room).toBe("");
    await setTimetableRoomMode("admin", true);
    const named = await createSharedTimetable("admin", { slots });
    expect(named.payload.useNamedRooms).toBe(true);
    expect(named.payload.slots[0].room).toBe("Science Lab");
    await setTimetableRoomMode("admin", false);
  });
});
