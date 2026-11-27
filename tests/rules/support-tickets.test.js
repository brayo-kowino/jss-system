import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { authedDb, getTestEnv, SCHOOL_A_ID, SCHOOL_B_ID, schoolFactory, seedDoc, userFactory } from "./helpers.js";

describe("Support ticket permissions", () => {
  let env;
  const ticket = {
    schoolId: SCHOOL_A_ID, schoolName: "Example Academy", raisedBy: "school-admin", status: "open",
    subject: "Report card export", message: "The export returned a blank page.",
  };

  beforeAll(async () => { env = await getTestEnv(); });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        seedDoc(db, "schools", SCHOOL_A_ID, schoolFactory()),
        seedDoc(db, "schools", SCHOOL_B_ID, schoolFactory()),
        seedDoc(db, "users", "school-admin", userFactory("admin", SCHOOL_A_ID)),
        seedDoc(db, "users", "other-school", userFactory("registrar", SCHOOL_B_ID)),
        seedDoc(db, "users", "platform-support", userFactory("super_admin", null)),
        seedDoc(db, "support_tickets", "existing", ticket),
      ]);
    });
  });

  it("allows staff to submit open tickets and read support updates from their school", async () => {
    const db = authedDb(env, "school-admin");
    await assertSucceeds(setDoc(doc(db, "support_tickets", "new"), { ...ticket, raisedAt: serverTimestamp() }));
    const tickets = await assertSucceeds(getDocs(query(collection(db, "support_tickets"), where("schoolId", "==", SCHOOL_A_ID))));
    expect(tickets.size).toBe(2);
    await assertFails(getDoc(doc(authedDb(env, "other-school"), "support_tickets", "existing")));
  });

  it("rejects school-side resolution on create and update", async () => {
    const db = authedDb(env, "school-admin");
    await assertFails(updateDoc(doc(db, "support_tickets", "existing"), { status: "resolved", resolutionNote: "Closed by school" }));
    await assertFails(setDoc(doc(db, "support_tickets", "closed"), { ...ticket, status: "resolved", raisedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "support_tickets", "reply"), { ...ticket, resolutionNote: "Forged support reply", raisedAt: serverTimestamp() }));
  });

  it("allows platform support to read across schools and reserves status writes for the server", async () => {
    const platformTicket = doc(authedDb(env, "platform-support"), "support_tickets", "existing");
    const schoolTicket = doc(authedDb(env, "school-admin"), "support_tickets", "existing");
    await assertSucceeds(getDoc(platformTicket));
    await assertFails(updateDoc(platformTicket, { status: "resolved" }));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "support_tickets", "existing"), { status: "resolved", resolutionNote: "Template corrected" });
      await setDoc(doc(context.firestore(), "support_tickets", "existing", "events", "resolution"), { message: "Template corrected" });
    });
    const resolved = await assertSucceeds(getDoc(schoolTicket));
    expect(resolved.data().resolutionNote).toBe("Template corrected");
    await assertFails(updateDoc(schoolTicket, { status: "open" }));
    await assertSucceeds(getDoc(doc(schoolTicket, "events", "resolution")));
    const otherSchool = authedDb(env, "other-school");
    await assertFails(getDoc(doc(otherSchool, "support_tickets", "existing", "events", "resolution")));
  });
});
