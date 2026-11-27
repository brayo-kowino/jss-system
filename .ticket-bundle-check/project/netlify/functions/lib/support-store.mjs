import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function supportStore() {
  const name = "support-workflow";
  const app = getApps().find((entry) => entry.name === name) || initializeApp({
    credential: cert(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)),
  }, name);
  return { db: getFirestore(app), auth: getAuth(app) };
}

export function supportTicketUrl(ticketId, slug, platform = false) {
  const url = new URL("/app/", process.env.SUPPORT_APP_URL || process.env.URL || "https://eeskia.iskify360.tech");
  if (!platform && slug) url.searchParams.set("school", slug);
  url.hash = `${platform ? "/platform-tickets" : "/support"}?${new URLSearchParams({ ticket: ticketId })}`;
  return url.href;
}
