// Newsletters collection.
// newsletters/{id}: { schoolId, title, issue, body, heroImageUrl,
//   principalMessage, sections: [{ title, body, imageUrl }],
//   status: "draft"|"published", createdBy, createdAt, publishedAt }
//

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";
import { getCurrentSchoolId } from "./auth.service.js";
import { uploadToCloudinary } from "./cloudinary.service.js";

export async function listNewsletters() {
  const snap = await getDocs(query(collection(db, "newsletters"), where("schoolId", "==", getCurrentSchoolId())));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function createNewsletter(userId, { title, issue, body, heroImageUrl, principalMessage, sections }) {
  const ref_ = await addDoc(collection(db, "newsletters"), {
    schoolId: getCurrentSchoolId(),
    title,
    issue: issue || "",
    body: body || "",
    heroImageUrl: heroImageUrl || "",
    principalMessage: principalMessage || "",
    sections: sections || [],
    status: "draft",
    createdBy: userId,
    createdAt: serverTimestamp(),
    publishedAt: null,
  });
  await logAction(userId, "create_newsletter", "newsletters", ref_.id);
  return ref_.id;
}

export async function updateNewsletter(userId, id, { title, issue, body, heroImageUrl, principalMessage, sections }) {
  await updateDoc(doc(db, "newsletters", id), {
    title,
    issue: issue || "",
    body: body || "",
    heroImageUrl: heroImageUrl || "",
    principalMessage: principalMessage || "",
    sections: sections || [],
  });
  await logAction(userId, "update_newsletter", "newsletters", id);
}

// Uploads an image (hero photo or a section photo) for a newsletter and
// returns its hosted URL.
export function uploadNewsletterImage(file) {
  return uploadToCloudinary(file, `schools/${getCurrentSchoolId()}/newsletters`);
}

export async function setNewsletterStatus(userId, id, status) {
  await updateDoc(doc(db, "newsletters", id), {
    status,
    publishedAt: status === "published" ? serverTimestamp() : null,
  });
  await logAction(userId, status === "published" ? "publish_newsletter" : "unpublish_newsletter", "newsletters", id);
}

export async function deleteNewsletter(userId, id) {
  await deleteDoc(doc(db, "newsletters", id));
  await logAction(userId, "delete_newsletter", "newsletters", id);
}