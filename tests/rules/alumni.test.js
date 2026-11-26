import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertFails } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { SCHOOL_A_ID, SCHOOL_B_ID, authedDb, getTestEnv, seedDoc, userFactory } from "./helpers.js";

const session = vi.hoisted(() => ({ db: null }));
vi.mock("../../js/firebase-config.js", () => ({ get db() { return session.db; } }));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchoolId: () => "school-a",
  getCurrentProfile: () => ({ uid: "registrar-a", role: "registrar" }),
}));

import { issueAlumniCertificate, listAlumni, listAlumniCertificates } from "../../js/services/alumni.service.js";

const graduate = { schoolId: SCHOOL_A_ID, fullName: "Demo Graduate", admissionNumber: "016/25", grade: "Grade 9", stream: "Blue", status: "graduated" };
const savedCertificate = (db, id = "graduate", type = "leaving") =>
  doc(db, "schools", SCHOOL_A_ID, "alumni_certificates", id + "_" + type);

describe("Alumni and certificate issuance against Firestore Rules", () => {
  let env;
  beforeAll(async () => { env = await getTestEnv(); });
  afterAll(async () => { if (env) await env.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        seedDoc(db, "users", "admin-a", userFactory("admin", SCHOOL_A_ID)),
        seedDoc(db, "users", "registrar-a", userFactory("registrar", SCHOOL_A_ID)),
        seedDoc(db, "users", "teacher-a", userFactory("class_teacher", SCHOOL_A_ID)),
        seedDoc(db, "users", "admin-b", userFactory("admin", SCHOOL_B_ID)),
        seedDoc(db, "schools", SCHOOL_A_ID, { schoolName: "Demo School" }),
        seedDoc(db, "students", "graduate", graduate),
        seedDoc(db, "students", "older", { ...graduate, fullName: "Legacy Graduate", admissionNumber: "008" }),
        seedDoc(db, "students", "active", { ...graduate, status: "active" }),
        seedDoc(db, "alumni", "legacy-alumni-id", { ...graduate, originalStudentId: "graduate", graduationYear: "2026" }),
        seedDoc(db, "alumni", "foreign", { ...graduate, schoolId: SCHOOL_B_ID, originalStudentId: "foreign" }),
      ]);
    });
    session.db = authedDb(env, "registrar-a");
  });

  it("finds archived and legacy graduates and reuses the same immutable certificate on retry", async () => {
    const records = await listAlumni();
    expect(records).toMatchObject([
      { studentId: "graduate", alumniId: "legacy-alumni-id", graduationYear: "2026" },
      { studentId: "older", alumniId: "" },
    ]);
    expect(await listAlumniCertificates("graduate")).toEqual([]);

    const [first, retry] = await Promise.all([
      issueAlumniCertificate(records[0], "leaving"),
      issueAlumniCertificate(records[0], "leaving"),
    ]);
    expect(first).toMatchObject({
      schoolName: "Demo School", fullName: "Demo Graduate", issuedBy: "registrar-a", admissionNumber: "016/25",
      graduationYear: "2026", number: expect.stringMatching(/^LC-[A-Z0-9]{20}$/),
    });
    expect(retry).toEqual(first);
    const admin = authedDb(env, "admin-a");
    const logs = await getDocs(query(collection(admin, "audit_logs"), where("schoolId", "==", SCHOOL_A_ID)));
    expect(logs.docs.map((entry) => entry.data().action)).toEqual(["issue_alumni_certificate"]);
    await updateDoc(doc(admin, "schools", SCHOOL_A_ID), { schoolName: "Renamed School" });
    expect(await listAlumniCertificates("graduate")).toEqual([first]);
    const legacyCertificate = await issueAlumniCertificate(records[1], "graduation");
    expect(legacyCertificate).toMatchObject({ graduationYear: "", number: expect.stringMatching(/^GC-/) });
    await assertFails(updateDoc(savedCertificate(admin), { fullName: "Changed Name" }));
  });

  it("denies cross-school reads, teachers and certificates forged for active learners", async () => {
    const record = (await listAlumni())[0];
    await issueAlumniCertificate(record, "leaving");
    await assertFails(getDoc(savedCertificate(authedDb(env, "admin-b"))));
    await assertFails(getDoc(savedCertificate(authedDb(env, "teacher-a"))));
    await assertFails(setDoc(savedCertificate(session.db, "active"), {
      studentId: "active", alumniId: "", type: "leaving", schoolName: "Demo School", fullName: graduate.fullName,
      admissionNumber: graduate.admissionNumber, grade: graduate.grade, stream: graduate.stream, graduationYear: "",
      number: "LC-AAAAAAAAAAAAAAAAAAAA", issuedBy: "registrar-a", issuedAt: serverTimestamp(),
    }));
  });
});
