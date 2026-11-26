import {
  collection, doc, getDoc, getDocFromServer, getDocs, query, runTransaction, serverTimestamp, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { getCurrentProfile, getCurrentSchoolId } from "./auth.service.js";
import { toDate } from "../utils.js";

export const ALUMNI_ROLES = ["admin", "principal", "deputy_principal", "registrar"];
export const CERTIFICATE_TYPES = {
  leaving: "School Leaving Certificate",
  graduation: "Graduation Certificate",
};

function officeSchool() {
  const schoolId = getCurrentSchoolId();
  if (!schoolId || !ALUMNI_ROLES.includes(getCurrentProfile()?.role)) {
    throw new Error("Alumni records are available to the school office.");
  }
  return schoolId;
}

function certificateRef(schoolId, studentId, type) {
  return doc(db, "schools", schoolId, "alumni_certificates", studentId + "_" + type);
}

export function mergeGraduateRecords(alumni, graduates) {
  const records = new Map(graduates.map(({ id, ...record }) => [id, {
    ...record, studentId: id, alumniId: "",
  }]));
  const ordered = [...alumni].sort((a, b) =>
    String(b.graduationYear || "").localeCompare(String(a.graduationYear || ""), undefined, { numeric: true }) ||
    (toDate(b.graduatedAt)?.valueOf() || 0) - (toDate(a.graduatedAt)?.valueOf() || 0));
  const archived = new Set();
  for (const { id, originalStudentId, ...record } of ordered) {
    if (!originalStudentId || archived.has(originalStudentId)) continue;
    archived.add(originalStudentId);
    records.set(originalStudentId, { ...record, studentId: originalStudentId, alumniId: id });
  }
  return [...records.values()].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
}

export async function listAlumni() {
  const schoolId = officeSchool();
  const bySchool = where("schoolId", "==", schoolId);
  const [archive, roster] = await Promise.all([
    getDocs(query(collection(db, "alumni"), bySchool)),
    getDocs(query(collection(db, "students"), bySchool, where("status", "==", "graduated"))),
  ]);
  const rows = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
  return mergeGraduateRecords(rows(archive), rows(roster));
}

export async function listAlumniCertificates(studentId) {
  const schoolId = officeSchool();
  const certificates = await Promise.all(Object.keys(CERTIFICATE_TYPES).map((type) =>
    getDoc(certificateRef(schoolId, studentId, type))));
  return certificates.filter((snapshot) => snapshot.exists()).map((snapshot) => snapshot.data());
}

export async function issueAlumniCertificate(graduate, type) {
  const schoolId = officeSchool();
  const issuer = getCurrentProfile();
  if (!Object.hasOwn(CERTIFICATE_TYPES, type)) throw new Error("Choose a certificate type.");
  const { studentId, alumniId } = graduate;
  const reference = certificateRef(schoolId, studentId, type);
  const auditRef = doc(collection(db, "audit_logs"));
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) return;
    const [sourceSnapshot, schoolSnapshot] = await Promise.all([
      transaction.get(alumniId ? doc(db, "alumni", alumniId) : doc(db, "students", studentId)),
      transaction.get(doc(db, "schools", schoolId)),
    ]);
    const source = sourceSnapshot.data();
    const school = schoolSnapshot.data() || {};
    if (!source || source.schoolId !== schoolId || source.status !== "graduated" ||
        (alumniId && source.originalStudentId !== studentId)) {
      throw new Error("This graduate record is no longer available. Refresh Alumni and try again.");
    }
    if (!source.fullName) throw new Error("Add the learner’s full name before issuing a certificate.");
    if (source.fullName !== graduate.fullName || (source.admissionNumber ?? "") !== (graduate.admissionNumber ?? "") ||
        (source.grade ?? "") !== (graduate.grade ?? "") || (source.stream ?? "") !== (graduate.stream ?? "") ||
        (source.graduationYear ?? "") !== (graduate.graduationYear ?? "")) {
      throw new Error("The learner’s details changed after you opened the certificate. Refresh Alumni and review them again.");
    }
    const schoolName = school.schoolName || school.name || "";
    if (!schoolName) throw new Error("Set the school name in School Settings before issuing a certificate.");
    transaction.set(reference, {
      studentId, alumniId: alumniId || "", type, schoolName,
      fullName: source.fullName, admissionNumber: source.admissionNumber ?? "",
      grade: source.grade ?? "", stream: source.stream ?? "", graduationYear: source.graduationYear ?? "",
      number: (type === "leaving" ? "LC-" : "GC-") + auditRef.id.toUpperCase(),
      issuedBy: issuer.uid, issuedAt: serverTimestamp(),
    });
    transaction.set(auditRef, {
      schoolId, userId: issuer.uid, action: "issue_alumni_certificate",
      entity: "students", entityId: studentId, timestamp: serverTimestamp(),
    });
  });
  return (await getDocFromServer(reference)).data();
}
