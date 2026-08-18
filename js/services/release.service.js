// Release control for saved results.
//
// result_releases/{schoolId__academicYear_term_grade_reportMode}: one doc
// per grade+academicYear+term+reportMode - the exact same grouping
// saveResults() already writes under (see grading.service.js). Releasing a
// class's results is a single flip here, not N per-student writes, and it
// stays a completely separate collection from `results` on purpose: the
// public results-lookup edge function only ever needs to read this one
// small doc to decide what to say, never the full result set, and staff
// can compute/recompute results as many times as they like without ever
// accidentally re-exposing (or hiding) something a parent already saw.
//
// { schoolId, academicYear, term, grade, reportMode, published,
//   expiresAt (Timestamp | null), releasedBy, releasedAt, updatedAt }
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { slugify } from "./academic.service.js";
import { scopedId, toDate } from "../utils.js";
import { logAction } from "./audit.service.js";

function releaseId(academicYear, term, grade, reportMode = "average") {
  return scopedId(
    getCurrentSchoolId(),
    slugify(academicYear),
    slugify(term),
    slugify(grade),
    slugify(reportMode || "average")
  );
}

export async function getRelease({ academicYear, term, grade, reportMode = "average" }) {
  const id = releaseId(academicYear, term, grade, reportMode);
  const snap = await getDoc(doc(db, "result_releases", id));
  return snap.exists() ? { id, ...snap.data() } : null;
}

// expiresAtLocal is either a "YYYY-MM-DDTHH:mm" string straight from an
// <input type="datetime-local">, a Date, or null/empty for "never expires".
export async function setRelease(
  userId,
  { academicYear, term, grade, reportMode = "average" },
  { published, expiresAtLocal }
) {
  const id = releaseId(academicYear, term, grade, reportMode);
  const expiresAt = expiresAtLocal ? Timestamp.fromDate(new Date(expiresAtLocal)) : null;
  const existing = await getDoc(doc(db, "result_releases", id));
  const wasPublished = existing.exists() && existing.data().published;

  await setDoc(
    doc(db, "result_releases", id),
    {
      schoolId: getCurrentSchoolId(),
      academicYear,
      term,
      grade,
      reportMode,
      published: !!published,
      expiresAt,
      ...(published && !wasPublished ? { releasedBy: userId, releasedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await logAction(userId, published ? "release_results" : "unrelease_results", "result_releases", id);
}

export function isExpired(release) {
  if (!release?.expiresAt) return false;
  const d = toDate(release.expiresAt);
  return d ? d.getTime() < Date.now() : false;
}

export function releaseStatusLabel(release) {
  if (!release || !release.published) return "Not released";
  if (isExpired(release)) return "Expired";
  return release.expiresAt ? "Released - expires" : "Released";
}
