// ==========================================================================
// Daily subscription-expiry reminder - the one piece of the subscription
// system that's a standard Netlify Function rather than an edge function.
// ==========================================================================
// Netlify's cron scheduling (the `schedule` config below) only exists for
// standard Functions - edge functions have no equivalent, which is why
// this one file lives in netlify/functions instead of
// netlify/edge-functions alongside subscription-issue.ts/
// subscription-activate.ts. It deliberately stays in the same
// fetch-Firestore-REST-directly style as those two rather than pulling in
// the Firebase Admin SDK, so the three server-side subscription pieces
// read the same way even though this one runs on a different runtime.
//
// What it does: once a day, lists every school with an active subscription,
// and for any whose subscriptionExpiresAt is EXACTLY 7, 3, or 1 day(s) away,
// writes a notifications/{id} doc that school's admin will see on their
// Notifications page (js/services/notification.service.js's existing
// "notifications" collection - see the "app" channel/"subscription"
// category added there for this). Checking for an exact day-count rather
// than "<= 7" means each threshold fires once as the countdown crosses it,
// not once a day for the entire last week - assuming this runs at a
// consistent time daily, which Netlify's scheduler guarantees.
//
// REQUIRED SETUP (Netlify Console -> Site configuration -> Environment
// variables - already documented in netlify/edge-functions/lib/firestore-rest.ts,
// nothing new to add here):
//   GOOGLE_SERVICE_ACCOUNT_KEY - same service-account JSON key.
// ==========================================================================

import { webcrypto } from "node:crypto";

const PROJECT_ID = "jss-management-system";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const REMINDER_THRESHOLDS = [7, 3, 1];

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const serviceAccount = JSON.parse(rawKey);

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = new TextEncoder();
  const unsigned = base64UrlEncode(enc.encode(JSON.stringify(header))) + "." + base64UrlEncode(enc.encode(JSON.stringify(claims)));

  const cryptoKey = await webcrypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

function fsDecode(value) {
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fsDecode);
  if ("mapValue" in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fsDecode(v);
    return out;
  }
  return null;
}

function fsEncode(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value == null) return { nullValue: null };
  return { stringValue: String(value) };
}

function fsDocToObject(doc) {
  const out = { id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fsDecode(v);
  return out;
}

async function runQuery(token, collectionId, filters) {
  const structuredQuery = { from: [{ collectionId }], limit: 1000 };
  if (filters.length === 1) {
    const [field, op, value] = filters[0];
    structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op, value: fsEncode(value) } };
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: { op: "AND", filters: filters.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: fsEncode(value) } })) },
    };
  }
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => fsDocToObject(r.document));
}

async function addDoc(token, collectionId, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${collectionId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore create failed: ${res.status}`);
}

function daysUntil(isoString) {
  const ms = new Date(isoString).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export default async () => {
  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error("subscription-expiry-check: service account auth failed", err);
    return new Response("auth failed", { status: 500 });
  }

  let schools;
  try {
    schools = await runQuery(token, "schools", [["subscriptionStatus", "EQUAL", "active"]]);
  } catch (err) {
    console.error("subscription-expiry-check: school query failed", err);
    return new Response("query failed", { status: 500 });
  }

  let remindersSent = 0;
  for (const school of schools) {
    if (!school.subscriptionExpiresAt) continue;
    const daysRemaining = daysUntil(school.subscriptionExpiresAt);
    if (!REMINDER_THRESHOLDS.includes(daysRemaining)) continue;

    const dayWord = daysRemaining === 1 ? "day" : "days";
    try {
      await addDoc(token, "notifications", {
        schoolId: school.id,
        title: `Subscription expiring in ${daysRemaining} ${dayWord}`,
        body: `${school.schoolName || "Your school"}'s ${school.subscriptionPlan || ""} subscription expires in ${daysRemaining} ${dayWord} (${new Date(school.subscriptionExpiresAt).toDateString()}). Contact the platform administrator for a renewal token before it lapses.`,
        category: "subscription",
        channel: "app",
        audience: { type: "staff", label: "School Administrator" },
        recipientCount: 0,
        status: "delivered",
        createdAt: new Date(),
      });
      await addDoc(token, "audit_logs", {
        schoolId: school.id,
        userId: "system",
        action: "subscription_expiry_reminder",
        entity: "schools",
        entityId: school.id,
        timestamp: new Date(),
      });
      remindersSent++;
    } catch (err) {
      // One school's write failing shouldn't stop the rest from being checked.
      console.error(`subscription-expiry-check: failed to notify school ${school.id}`, err);
    }
  }

  return new Response(JSON.stringify({ checked: schools.length, remindersSent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  // Once a day, 06:00 UTC - comfortably outside any Kenyan school's working
  // hours either side, so the resulting notification is waiting for the
  // admin when they next log in rather than appearing mid-day.
  schedule: "0 6 * * *",
};
