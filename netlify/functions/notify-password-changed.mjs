// ==========================================================================
// Eeskia Security Alert: Notify Password Changed
// Triggered whenever an admin or staff member changes their account password.
// Dispatches an email alert with device info and an instant emergency freeze link.
// ==========================================================================

import { randomUUID, webcrypto } from "node:crypto";
import nodemailer from "nodemailer";
import { buildPasswordChangedSecurityEmail } from "./lib/email-templates.mjs";
import { verifyFirebaseIdToken } from "./lib/auth-helper.mjs";

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
  if (!rawKey) return null;
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

function fsEncode(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value == null) return { nullValue: null };
  return { stringValue: String(value) };
}

async function putDoc(token, path, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fsEncode(value)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore write failed: ${res.status}`);
}

async function signFreezeToken(secret, payload) {
  if (!secret || !secret.trim()) {
    throw new Error("STEP_UP_TOKEN_SECRET is not configured");
  }
  const enc = new TextEncoder();
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await webcrypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await webcrypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const idToken = authHeader.split(" ")[1];
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified?.sub) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const uid = verified.sub;

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const deviceSummary = String(body.deviceSummary || "Web Browser");
  const defaultOrigin = "https://eeskia.iskify360.tech";
  const trustedOrigins = new Set([
    defaultOrigin,
    "https://eeskia.netlify.app",
    "https://beta--eeskia.netlify.app",
  ]);
  let origin = defaultOrigin;
  try {
    const requestedOrigin = new URL(String(body.origin || defaultOrigin)).origin;
    if (trustedOrigins.has(requestedOrigin)) origin = requestedOrigin;
  } catch {
    console.warn("notify-password-changed: invalid alert origin, using production origin");
  }

  let accessToken = null;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("notify-password-changed: failed to get access token", err);
  }

  let user = null;
  let school = null;
  let emailSettings = null;

  if (accessToken) {
    try {
      user = await getDoc(accessToken, `users/${uid}`);
      if (user?.schoolId) {
        school = await getDoc(accessToken, `schools/${user.schoolId}`);
      }
      emailSettings = await getDoc(accessToken, `platform_settings/email`);
    } catch (err) {
      console.warn("notify-password-changed: failed to read profile/settings", err);
    }
  }

  const recipientEmail = user?.email || verified.email;
  const fullName = user?.fullName || "Administrator";
  const schoolName = school?.schoolName || school?.name || "";

  if (!recipientEmail) {
    return new Response(JSON.stringify({ error: "No recipient email found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Generate 48-hour emergency freeze token
  const freezeSecret = process.env.STEP_UP_TOKEN_SECRET;
  if (!freezeSecret || !freezeSecret.trim()) {
    console.error("notify-password-changed: STEP_UP_TOKEN_SECRET not set");
    return new Response(JSON.stringify({ error: "Emergency freeze service is temporarily unavailable." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const freezeTokenPayload = {
    jti: randomUUID(),
    uid,
    email: recipientEmail,
    schoolId: user?.schoolId || null,
    purpose: "emergency_freeze",
    exp: Date.now() + 48 * 60 * 60 * 1000,
  };

  const freezeToken = await signFreezeToken(freezeSecret, freezeTokenPayload);
  const freezeUrl = `${origin}/#/emergency-freeze?token=${encodeURIComponent(freezeToken)}`;

  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Security service temporarily unavailable.", emailSent: false }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    await putDoc(accessToken, `emergency_freeze_tokens/${freezeTokenPayload.jti}`, {
      uid,
      exp: freezeTokenPayload.exp,
      purpose: freezeTokenPayload.purpose,
    });
  } catch (err) {
    console.error("notify-password-changed: failed to store freeze token", err);
    return new Response(JSON.stringify({ error: "Security service temporarily unavailable.", emailSent: false }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build the email
  const emailContent = buildPasswordChangedSecurityEmail({
    fullName,
    email: recipientEmail,
    schoolName,
    deviceSummary,
    changedAt: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    freezeUrl,
  });

  // Resolve SMTP configuration
  const smtpUser = emailSettings?.smtpUser || process.env.SMTP_USER;
  const smtpPass = emailSettings?.smtpPass || process.env.SMTP_PASS;
  const senderName = emailSettings?.senderName || "Eeskia Platform Security";
  const replyTo = emailSettings?.replyTo || "support@eeskia.iskify360.tech";

  // If no platform SMTP, check school-level provider
  const schoolProviders = school?.notificationProviders || {};
  let transporter = null;
  let fromAddress = `"${senderName}" <support@eeskia.iskify360.tech>`;

  if (smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });
    fromAddress = `"${senderName}" <${smtpUser}>`;
  } else if (schoolProviders.gmail?.address && schoolProviders.gmail?.appPassword) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: schoolProviders.gmail.address,
        pass: schoolProviders.gmail.appPassword,
      },
    });
    fromAddress = `"${senderName}" <${schoolProviders.gmail.address}>`;
  }

  let emailSent = false;
  if (transporter) {
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: recipientEmail,
        replyTo,
        subject: emailContent.subject,
        text: `Security Alert: The password for your Eeskia account (${recipientEmail}) was just changed.\nDevice: ${deviceSummary}\n\nIf you did not make this change, freeze your account immediately:\n${freezeUrl}`,
        html: emailContent.html,
      });
      emailSent = true;
      console.log(`notify-password-changed: alert email delivered to ${recipientEmail}`);
    } catch (err) {
      console.error(`notify-password-changed: failed to send email to ${recipientEmail}:`, err);
    }
  } else {
    console.warn("notify-password-changed: no SMTP gateway configured, email skipped");
  }

  return new Response(JSON.stringify({
    success: emailSent,
    emailSent,
    error: emailSent ? undefined : "Password-change alert could not be delivered.",
  }), {
    status: emailSent ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
};
