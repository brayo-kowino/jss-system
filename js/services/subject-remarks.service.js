// Subject Performance Level Remarks Service
// Allows teachers and admins to configure customized remarks per subject
// for the 4 CBC performance levels (EE, ME, AE, BE).
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { cached, invalidate } from "./query-cache.js";

export const DEFAULT_CBC_REMARKS = {
  EE: "Consistently demonstrates exceptional mastery and application of subject concepts.",
  ME: "Demonstrates commendable understanding and proficiency in core subject skills.",
  AE: "Shows steady progress; encouraged to practice more to attain full competency.",
  BE: "Requires targeted support and remedial guidance to grasp key concepts.",
};

function remarksCacheKey() {
  return `subject_remarks:${getCurrentSchoolId()}`;
}

function makeDocId(schoolId, subjectCode) {
  return `${schoolId}_${subjectCode}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function listSchoolSubjectRemarks(forceRefresh = false) {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) return {};
  if (forceRefresh) invalidate(remarksCacheKey());

  return cached(remarksCacheKey(), 5 * 60_000, async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "subject_remarks"), where("schoolId", "==", schoolId))
      );
      const map = {};
      snap.forEach((d) => {
        const data = d.data();
        if (data.subjectCode) {
          map[data.subjectCode] = data.remarks || {};
        }
      });
      return map;
    } catch (err) {
      console.warn("Could not list subject remarks:", err);
      return {};
    }
  });
}

export async function getSubjectRemarks(subjectCode) {
  const all = await listSchoolSubjectRemarks();
  return all[subjectCode] || null;
}

export async function saveSubjectRemarks(userId, subjectCode, remarks, subjectName = "") {
  const schoolId = getCurrentSchoolId();
  if (!schoolId) throw new Error("No active school session.");
  if (!subjectCode) throw new Error("Subject code is required.");

  const docId = makeDocId(schoolId, subjectCode);
  const cleanRemarks = {
    EE: (remarks?.EE || "").trim() || DEFAULT_CBC_REMARKS.EE,
    ME: (remarks?.ME || "").trim() || DEFAULT_CBC_REMARKS.ME,
    AE: (remarks?.AE || "").trim() || DEFAULT_CBC_REMARKS.AE,
    BE: (remarks?.BE || "").trim() || DEFAULT_CBC_REMARKS.BE,
  };

  await setDoc(doc(db, "subject_remarks", docId), {
    schoolId,
    subjectCode,
    subjectName: subjectName || subjectCode,
    remarks: cleanRemarks,
    updatedBy: userId,
    updatedAt: serverTimestamp(),
  });

  invalidate(remarksCacheKey());
  return cleanRemarks;
}
