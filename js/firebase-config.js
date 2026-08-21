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
  enableNetwork,
  disableNetwork,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const isLocalDev = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocalDev && typeof self !== "undefined") {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const RECAPTCHA_SITE_KEY = "6LcEUX0tAAAAAA_U1HH-0ci7DiVoND7z-pzdEz4J";

let mainAppCheck = null;

export function attachAppCheck(app) {
  if (typeof window === "undefined" || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return null;
  }
  if (app === firebaseApp && mainAppCheck) {
    return mainAppCheck;
  }
  try {
    const instance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    if (app === firebaseApp) {
      mainAppCheck = instance;
    }
    return instance;
  } catch (err) {
    return null;
  }
}

if (typeof window !== "undefined") {
  if (navigator.onLine) {
    attachAppCheck(firebaseApp);
  }
  window.addEventListener("online", () => {
    attachAppCheck(firebaseApp);
  });
}

export const auth = getAuth(firebaseApp);

export const db = initializeFirestore(firebaseApp, {
  cache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.error("Auth persistence error:", err)
);

// ==========================================================================
// Keep Firestore's network layer in sync with the browser's own online/
// offline signal, instead of leaving every read to discover a dead
// connection on its own. Left alone, getDoc()/getDocs() always attempt a
// server round-trip first (see query-cache.js's header comment) and only
// fall back to persistentLocalCache once the SDK's internal connection
// probe gives up - which isn't instant, especially for a connection that
// dies mid-session rather than a clean "airplane mode" toggle. Aggregate
// reads (getCountFromServer/getAggregateFromServer, used on the dashboard)
// have no cache fallback at all and just hang the same way until that
// probe resolves.
//
// disableNetwork() short-circuits that: every subsequent read is served
// straight from the local cache with no server attempt, so a view that's
// already fetched its data once doesn't sit on a spinner waiting to
// discover what navigator.onLine already told us. enableNetwork() reverses
// it the moment we're back. Writes queued while disabled still flush
// automatically once network is re-enabled, same as Firestore's normal
// offline queueing - this only changes how fast reads notice we're offline.
if (typeof window !== "undefined") {
  const syncNetworkState = () => {
    const op = navigator.onLine ? enableNetwork(db) : disableNetwork(db);
    op.catch(() => {}); 
  };
  window.addEventListener("online", syncNetworkState);
  window.addEventListener("offline", syncNetworkState);
  syncNetworkState();
}