// ==========================================================================
// Eeskia Platform Service Announcement & Restoration Email Broadcaster
// Dispatches platform announcements and service updates to all school administrators,
// or sends a test email to a specific admin.
// Supports both clean executive letters (no tables/status pills) and system status reports.
// ==========================================================================

import { webcrypto } from "node:crypto";
import nodemailer from "nodemailer";
import { buildServiceAnnouncementEmail, buildPlatformBroadcastEmail } from "./lib/email-templates.mjs";

const PROJECT_ID = "jss-management-system";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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
    ["sign"]
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

async function getDoc(token, path) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  return fsDocToObject(await res.json());
}

async function runQuery(token, collectionId, filters = []) {
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

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const {
    serviceName = "Eeskia Platform Services",
    status = "Notice",
    headline = "Announcement from Eeskia Platform",
    summary = "",
    message = "",
    emailStyle = "letter", // "letter" (clean executive format) | "status_report" (technical outage table)
    resolution = "",
    restoredAt = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    incidentDuration = "Resolved",
    actionUrl = "https://eeskia.iskify360.tech",
    targetSchools = "all", // "all" | string[] of school IDs
    testRecipient = null,
  } = body;

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error("broadcast-service-announcement: auth failed", err);
    return new Response("Auth failed", { status: 500 });
  }

  // 1. Fetch platform email settings from Firestore if available
  let platformEmailSettings = null;
  try {
    platformEmailSettings = await getDoc(token, "platform_settings/email");
  } catch (err) {
    console.warn("broadcast-service-announcement: platform_settings/email fetch skipped", err);
  }

  // Determine platform SMTP credentials (from Firestore or environment variables)
  const platformUser = platformEmailSettings?.smtpUser || process.env.PLATFORM_EMAIL_USER || process.env.GMAIL_USER;
  const platformPass = platformEmailSettings?.smtpPass || process.env.PLATFORM_EMAIL_PASS || process.env.GMAIL_PASS;
  const platformSenderName = platformEmailSettings?.senderName || "Eeskia Notifications";
  const platformReplyTo = platformEmailSettings?.replyTo || platformUser || "support@eeskia.iskify360.tech";

  // Build the email template according to selected style
  const emailContent = emailStyle === "status_report"
    ? buildServiceAnnouncementEmail({
        serviceName,
        status,
        headline,
        summary: summary || message,
        resolution,
        restoredAt,
        incidentDuration,
        actionUrl,
      })
    : buildPlatformBroadcastEmail({
        title: headline,
        message: message || summary,
        ctaLabel: "Open Eeskia Portal",
        ctaUrl: actionUrl,
      });

  const plainMessage = message || summary || headline;

  // Handle direct test email dispatch
  if (testRecipient) {
    if (!platformUser || !platformPass) {
      return new Response(
        JSON.stringify({
          success: false,
          broadcastCount: 0,
          error: "No platform SMTP gateway configured. Please enter your Gmail address and 16-character Google App Password in Platform Email Settings.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      const testTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: platformUser, pass: platformPass },
      });

      await testTransporter.sendMail({
        from: `"${platformSenderName}" <${platformUser}>`,
        to: testRecipient,
        replyTo: platformReplyTo,
        subject: emailContent.subject,
        text: `${headline}\n\n${plainMessage}\n\nEeskia Platform: ${actionUrl}`,
        html: emailContent.html,
      });

      return new Response(
        JSON.stringify({
          success: true,
          broadcastCount: 1,
          dispatchedTo: [testRecipient],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (testErr) {
      console.error("broadcast-service-announcement test delivery error:", testErr);
      return new Response(
        JSON.stringify({
          success: false,
          broadcastCount: 0,
          error: `SMTP delivery failed: ${testErr.message || "Unknown error"}. Check that your 16-character Google App Password is correct.`,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 2. Fetch schools and admin users in parallel for broadcasts
  let schools = [];
  let schoolAdminMap = new Map();
  try {
    const [schoolsResult, adminUsersResult] = await Promise.all([
      runQuery(token, "schools"),
      runQuery(token, "users", [["role", "EQUAL", "admin"]]),
    ]);
    schools = schoolsResult;
    for (const u of adminUsersResult) {
      if (u.schoolId && u.email && !schoolAdminMap.has(u.schoolId)) {
        schoolAdminMap.set(u.schoolId, u.email);
      }
    }
  } catch (err) {
    console.error("broadcast-service-announcement: fetch failed", err);
    return new Response("Failed to fetch schools or admin accounts", { status: 500 });
  }

  const targetList = targetSchools === "all"
    ? schools
    : schools.filter((s) => Array.isArray(targetSchools) && targetSchools.includes(s.id));

  if (targetList.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        broadcastCount: 0,
        targetSchoolsCount: 0,
        dispatchedTo: [],
        error: "No target schools matched the criteria.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let platformTransporter = null;
  if (platformUser && platformPass) {
    platformTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: platformUser, pass: platformPass },
    });
  }

  let broadcastCount = 0;
  const dispatchedTo = [];

  for (const school of targetList) {
    const adminEmail = school.adminEmail || schoolAdminMap.get(school.id) || school.email;
    const schoolProviders = school.notificationProviders || {};

    let transporter = platformTransporter;
    let senderAddress = platformUser || "support@eeskia.iskify360.tech";

    if (!transporter && schoolProviders.gmail?.address && schoolProviders.gmail?.appPassword) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: schoolProviders.gmail.address,
          pass: schoolProviders.gmail.appPassword,
        },
      });
      senderAddress = schoolProviders.gmail.address;
    }

    if (adminEmail && transporter) {
      try {
        await transporter.sendMail({
          from: `"${platformSenderName}" <${senderAddress}>`,
          to: adminEmail,
          replyTo: platformReplyTo,
          subject: emailContent.subject,
          text: `${headline}\n\n${plainMessage}\n\nEeskia Platform: ${actionUrl}`,
          html: emailContent.html,
        });
        broadcastCount++;
        dispatchedTo.push(adminEmail);
      } catch (err) {
        console.error(`broadcast-service-announcement: failed to send to ${adminEmail}`, err);
      }
    }

    // In-app notification doc for the school's admin notifications dashboard
    try {
      await addDoc(token, "notifications", {
        schoolId: school.id,
        title: headline,
        body: `${serviceName}: ${plainMessage.slice(0, 200)}...`,
        category: "general",
        channel: "email",
        audience: { type: "staff", label: "School Administration" },
        recipientCount: 1,
        status: "delivered",
        createdAt: new Date(),
      });
      await addDoc(token, "audit_logs", {
        schoolId: school.id,
        userId: "system",
        action: "service_announcement_broadcast",
        entity: "schools",
        entityId: school.id,
        timestamp: new Date(),
      });
    } catch (docErr) {
      console.warn("broadcast-service-announcement: doc write skipped", docErr);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      broadcastCount,
      targetSchoolsCount: targetList.length,
      dispatchedTo,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
