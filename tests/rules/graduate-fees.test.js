import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { doc, getDoc } from "firebase/firestore";
import { SCHOOL_A_ID, authedDb, getTestEnv, seedDoc, userFactory } from "./helpers.js";

const fixture = vi.hoisted(() => ({ db: null }));
vi.mock("../../js/firebase-config.js", () => ({ get db() { return fixture.db; } }));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchoolId: () => "school-a",
  getCurrentProfile: () => ({ uid: "admin-a", role: "admin" }),
}));
vi.mock("../../js/services/settings.service.js", () => ({
  getSchoolSettings: async () => ({ terms: ["Term 1", "Term 2", "Term 3"] }),
}));
vi.mock("../../js/services/grading.service.js", () => ({ listResultsForStudent: async () => [] }));

import { getGraduateFeeHistory, getStudentsWithBalancesCount, listPaymentsForStudent, recordPayment } from "../../js/services/fee.service.js";
import { loadGraduationRecord } from "../../js/services/alumni.service.js";

describe("Graduate fee and payment lifecycle against Firestore Rules", () => {
  let env;
  beforeAll(async () => { env = await getTestEnv(); });
  afterAll(async () => { if (env) await env.cleanup(); });

  it("excludes graduates from current balance counts and only books payments to confirmed past terms", async () => {
    await env.clearFirestore();
    const graduate = {
      id: "graduate", schoolId: SCHOOL_A_ID, fullName: "Sample Graduate", status: "graduated",
      grade: "Grade 9", stream: "Blue", graduationYear: "2026", graduationTerm: "Term 2", graduationFeeExpected: 9000,
    };
    const active = { id: "active", schoolId: SCHOOL_A_ID, fullName: "Sample Learner", status: "active", grade: "Grade 9" };
    const fee = (studentId, academicYear, term) => ({
      schoolId: SCHOOL_A_ID, studentId, academicYear, term, grade: "Grade 9", expected: 15000, balance: 15000, paid: 0,
    });
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        seedDoc(db, "users", "admin-a", userFactory("admin", SCHOOL_A_ID)),
        seedDoc(db, "students", graduate.id, graduate),
        seedDoc(db, "students", active.id, active),
        seedDoc(db, "student_fee_status", "past", fee(graduate.id, "2026", "Term 2")),
        seedDoc(db, "student_fee_status", "future", fee(graduate.id, "2026", "Term 3")),
        seedDoc(db, "student_fee_status", "current-graduate", fee(graduate.id, "2027", "Term 1")),
        seedDoc(db, "student_fee_status", "current-active", fee(active.id, "2027", "Term 1")),
      ]);
    });
    fixture.db = authedDb(env, "admin-a");
    const terms = ["Term 1", "Term 2", "Term 3"];
    const exit = await loadGraduationRecord(graduate);
    expect((await getStudentsWithBalancesCount("2027", "Term 1", [graduate, active])).value).toBe(1);
    const payment = { studentId: graduate.id, amount: 2500, grade: "Grade 9", academicYear: "2026", term: "Term 2" };
    await expect(recordPayment("admin-a", payment)).rejects.toThrow("Fees History");
    await expect(recordPayment("admin-a", { ...payment, term: "Term 3", pastCharge: true })).rejects.toThrow("no confirmed past balance");
    expect(await listPaymentsForStudent(graduate.id)).toEqual([]);

    await recordPayment("admin-a", { ...payment, pastCharge: true });
    const history = await getGraduateFeeHistory(graduate.id, exit, [], terms);
    expect(history.rows).toMatchObject([{ academicYear: "2026", term: "Term 2", expected: 9000, paid: 2500, balance: 6500 }]);
    expect(history.totalBalance).toBe(6500);
    expect(history.payments).toMatchObject([{ studentName: graduate.fullName, stream: "Blue", amount: 2500 }]);
    expect((await getDoc(doc(fixture.db, "student_fee_status", "past"))).data().expected).toBe(15000);
  });
});
