// ==========================================================================
// Firebase bootstrap
// Replace firebaseConfig below with the values from your Firebase project:
// Console → Project Settings → General → "Your apps" → SDK setup snippet
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// Media (logos, student photos) now uploads to Cloudinary instead of
// Firebase Storage - see js/services/cloudinary.service.js.

const firebaseConfig = {
  apiKey: "AIzaSyCURCEhuxdsfVNqBLdHTLfzZ8mYn_yQsVQ",
  authDomain: "jss-management-system.firebaseapp.com",
  projectId: "jss-management-system",
  storageBucket: "jss-management-system.firebasestorage.app",
  messagingSenderId: "203154110445",
  appId: "1:203154110445:web:b66b659ce4f778a55d59e4",
  measurementId: "G-JC41066X2Y"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// Keep users logged in across refreshes/tabs
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.error("Auth persistence error:", err)
);

// Allow basic offline caching (marks entry, attendance can be taken with a
// flaky connection and will sync when back online).
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Offline persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser.");
  }
});