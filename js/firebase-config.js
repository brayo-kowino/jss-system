// ==========================================================================
// Firebase bootstrap
// Replace firebaseConfig below with the values from your Firebase project:
// Console → Project Settings → General → "Your apps" → SDK setup snippet
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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

// ==========================================================================
// App Check - proves to Firestore/Auth that a request is coming from this
// actual deployed app (verified via reCAPTCHA v3), not a script, a scraper,
// or somebody's clone of the frontend talking straight to our Firebase
// project. This is the piece that plays the same role WhatsApp's client
// attestation plays against modified clients: it doesn't stop someone from
// copying the code, but it stops the copy - or anything that isn't this
// app - from being able to use our backend once enforcement is turned on.
//
// SETUP (one-time, in Firebase Console):
//   1. Console -> App Check -> register this web app -> "reCAPTCHA v3" ->
//      it walks you through creating a reCAPTCHA v3 site key tied to your
//      real domain(s) (jss-management-system.firebaseapp.com, your custom
//      domain, etc). Paste that site key below in place of the placeholder.
//   2. Console -> App Check -> APIs -> turn on enforcement for Cloud
//      Firestore and Authentication. Leave both in "unenforced/monitoring"
//      mode for a few days first so you can watch the request metrics and
//      confirm nothing legitimate is getting flagged before you flip
//      enforcement to "Enforce". Enforcement is what actually rejects
//      requests without a valid token - until you flip it, App Check only
//      observes.
//
// LOCAL DEV: reCAPTCHA v3 only issues valid tokens for domains you've
// registered with it, so localhost will fail verification. The debug
// token below solves that WITHOUT weakening production: it only activates
// when running on localhost/127.0.0.1, and even then only lets that one
// browser through once you've registered its auto-generated debug token
// in Console -> App Check -> Apps -> (this app) -> Manage debug tokens.
// Never ship a real debug token to production; this code only sets one
// when the hostname literally is localhost.
// ==========================================================================
const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocalDev) {
  // Firebase looks for this exact global before initializeAppCheck runs.
  // Leaving it `true` on first run prints a fresh debug token to the
  // console - copy that into Firebase Console's debug token list once,
  // and future local runs will authenticate automatically.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

initializeAppCheck(firebaseApp, {
  // TODO: replace with the reCAPTCHA v3 site key from Console -> App Check
  // -> this app's registration (see step 1 above). App Check will not
  // function - and will fail silently into "no token" - until this is a
  // real site key rather than the placeholder.
  provider: new ReCaptchaV3Provider("6LcEUX0tAAAAAA_U1HH-0ci7DiVoND7z-pzdEz4J"),
  isTokenAutoRefreshEnabled: true,
});

export const auth = getAuth(firebaseApp);

export const db = initializeFirestore(firebaseApp, {
  cache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.error("Auth persistence error:", err)
);