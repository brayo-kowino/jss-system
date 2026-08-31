// ==========================================================================
// Firebase Cloud Messaging (Web Push) Service
// ==========================================================================
// Handles requesting Notification permission, generating an FCM token,
// saving it to Firestore, and calling the edge function to broadcast pushes.

import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseApp, db, auth } from "../firebase-config.js";

const VAPID_KEY = "BGjdTQLc6c47J66FeUC81aDh7QwIlil5oeUkmU_4KLboZxXIps971eAT8a1gDdqY942KdMwERbDuQCjpiJAQG34";

// Requests permission and registers the current device's FCM token in
// the fcm_tokens root collection, keyed by the token itself.
export async function registerFCMToken(uid, schoolId) {
  if (!uid) return;
  if (typeof Notification === "undefined") return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });

    if (token) {
      await setDoc(doc(db, "fcm_tokens", token), {
        uid,
        schoolId: schoolId || null,
        token,
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    console.warn("FCM registration failed:", err);
  }
}

// Calls the backend Edge Function to broadcast a push notification to all
// tokens matching the schoolId (or all tokens globally if isPlatformAnnouncement is true).
export async function dispatchPush({ title, message, schoolId, isPlatformAnnouncement = false }) {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;

    fetch("/api/dispatch-push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + idToken
      },
      body: JSON.stringify({ title, message, schoolId, isPlatformAnnouncement })
    }).catch(err => console.warn("Push dispatch call failed", err));
  } catch (err) {
    console.warn("Failed to get ID token for push dispatch", err);
  }
}
