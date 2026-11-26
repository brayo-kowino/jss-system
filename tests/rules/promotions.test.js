import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertFails } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { SCHOOL_A_ID, SCHOOL_B_ID, authedDb, getTestEnv, seedDoc, userFactory } from "./helpers.js";

const session = vi.hoisted(() => ({ db: null }));
vi.mock("../../js/firebase-config.js", () => ({ get db() { return session.db; } }));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchoolId: () => "school-a",
  getCurrentProfile: () => ({ uid: "admin-a", role: "admin" }),
}));
vi.mock("../../js/services/settings.service.js", () => ({
  DEFAULT_SETTINGS: { currentAcademicYear: "2026", currentTerm: "Term 1", terms: ["Term 1", "Term 2", "Term 3"] },
}));

import { commitPromotionPlan, generatePromotionPlan, loadPromotionWorkspace } from "../../js/services/promotion.service.js";

const checkpoint = (db, schoolId = SCHOOL_A_ID) => doc(db, "schools", schoolId, "promotion_runs", "current");

describe("Promotions against Firestore Rules", () => {
  let env;
  beforeAll(async () => { env = await getTestEnv(); });
  afterAll(async () => { if (env) await env.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        seedDoc(db, "users", "admin-a", userFactory("admin", SCHOOL_A_ID)),
        seedDoc(db, "users", "admin-b", userFactory("admin", SCHOOL_B_ID)),
        seedDoc(db, "users", "principal-a", userFactory("principal", SCHOOL_A_ID)),
        seedDoc(db, "schools", SCHOOL_A_ID, { currentAcademicYear: "2026", currentTerm: "Term 3" }),
        seedDoc(db, "classes", "grade-8", { schoolId: SCHOOL_A_ID, grade: "Grade 8", streams: ["Blue"] }),
        seedDoc(db, "classes", "grade-9", { schoolId: SCHOOL_A_ID, grade: "Grade 9", streams: [] }),
        seedDoc(db, "fees", "exit-fee", { schoolId: SCHOOL_A_ID, grade: "Grade 9", academicYear: "2026", term: "Term 3", amount: 9000 }),
        seedDoc(db, "students", "move", { schoolId: SCHOOL_A_ID, status: "active", grade: "Grade 8", stream: "Blue", fullName: "Demo A" }),
        seedDoc(db, "students", "graduate", { schoolId: SCHOOL_A_ID, status: "active", grade: "Grade 9", stream: "", fullName: "Demo B" }),
        seedDoc(db, "results", "archived-result", { schoolId: SCHOOL_A_ID, grade: "Grade 9", academicYear: "2026", studentId: "graduate" }),
      ]);
    });
    session.db = authedDb(env, "admin-a");
  });

  it("saves the reviewed plan, graduation, audit and calendar without altering historical results", async () => {
    const workspace = await loadPromotionWorkspace();
    const plan = generatePromotionPlan(workspace.students, workspace.classes);
    const result = await commitPromotionPlan("admin-a", plan, { ...workspace, runId: "run", mode: "auto" });

    expect(result).toMatchObject({ promoted: 1, graduated: 1, status: "complete" });
    expect((await getDoc(doc(session.db, "students", "move"))).data()).toMatchObject({ grade: "Grade 9", stream: "" });
    expect((await getDoc(doc(session.db, "students", "graduate"))).data()).toMatchObject({
      status: "graduated", graduationYear: "2026", graduationTerm: "Term 3", graduationFeeExpected: 9000,
    });
    expect((await getDoc(doc(session.db, "alumni", "graduate"))).data()).toMatchObject({
      originalStudentId: "graduate", graduationYear: "2026", graduationTerm: "Term 3", graduationFeeExpected: 9000,
    });
    expect((await getDoc(doc(session.db, "schools", SCHOOL_A_ID))).data()).toMatchObject({ currentAcademicYear: "2027", currentTerm: "Term 1" });
    expect((await getDoc(doc(session.db, "audit_logs", "run"))).data()).toMatchObject({ action: "bulk_promote" });
    expect((await getDoc(doc(session.db, "results", "archived-result"))).data()).toMatchObject({ grade: "Grade 9", academicYear: "2026" });
    await assertFails(updateDoc(doc(session.db, "alumni", "graduate"), { graduationYear: "2027" }));
  });

  it("keeps the resumable plan private to the school's admin", async () => {
    await setDoc(checkpoint(session.db), { status: "pending", entries: [{ studentId: "move" }] });
    expect((await getDoc(checkpoint(session.db))).exists()).toBe(true);
    const principal = authedDb(env, "principal-a");
    const otherAdmin = authedDb(env, "admin-b");
    await assertFails(getDoc(checkpoint(principal)));
    await assertFails(getDoc(checkpoint(otherAdmin)));
    await assertFails(setDoc(checkpoint(principal), { status: "complete" }));
    await assertFails(setDoc(checkpoint(otherAdmin), { status: "complete" }));
    await assertFails(getDocs(collection(session.db, "schools", SCHOOL_A_ID, "promotion_runs")));
  });

  it("resumes a large interrupted run from its committed checkpoint", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = writeBatch(db);
      for (let index = 0; index < 202; index++) {
        const id = "demo-" + String(index).padStart(3, "0");
        batch.set(doc(db, "students", id), {
          schoolId: SCHOOL_A_ID, status: "active", grade: "Grade 8", stream: "Blue", fullName: id,
        });
      }
      await batch.commit();
    });

    const workspace = await loadPromotionWorkspace();
    const plan = generatePromotionPlan(workspace.students, workspace.classes);
    const options = { ...workspace, runId: "large-run", mode: "auto" };
    await expect(commitPromotionPlan("admin-a", plan, {
      ...options,
      onProgress: () => { throw new Error("Simulated browser close"); },
    })).rejects.toThrow("Simulated browser close");
    expect((await loadPromotionWorkspace()).pendingRun).toMatchObject({ id: "large-run", done: 200, status: "pending" });
    expect((await getDoc(doc(session.db, "schools", SCHOOL_A_ID))).data().currentAcademicYear).toBe("2026");
    await expect(commitPromotionPlan("admin-a", null, options)).resolves.toMatchObject({ promoted: 203, graduated: 1, status: "complete" });
    expect((await getDoc(doc(session.db, "students", "demo-000"))).data()).toMatchObject({ status: "active", grade: "Grade 9" });
  });
});
