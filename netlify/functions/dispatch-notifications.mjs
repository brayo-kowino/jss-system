import { webcrypto } from "node:crypto";
import nodemailer from "nodemailer";

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

async function getDoc(token, path) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get failed: ${res.status}`);
  return fsDocToObject(await res.json());
}

async function patchDoc(token, path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsEncode(v)])) };
  const res = await fetch(`${FIRESTORE_BASE}/${path}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firestore update failed: ${res.status}`);
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

function resolveRecipients(audience, students, parents) {
  let targetParentIds = new Set();
  if (audience.type === "all") {
    return parents;
  }
  if (audience.type === "grade") {
    const gradeStudents = students.filter((s) => s.grade === audience.grade);
    for (const s of gradeStudents) {
      (s.parentIds || []).forEach((pid) => targetParentIds.add(pid));
    }
  } else if (audience.type === "individual") {
    const specificStudents = students.filter((s) => (audience.studentIds || []).includes(s.id));
    for (const s of specificStudents) {
      (s.parentIds || []).forEach((pid) => targetParentIds.add(pid));
    }
  }
  return parents.filter((p) => targetParentIds.has(p.id));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { notificationId, schoolId } = body;
  if (!notificationId || !schoolId) {
    return new Response("Missing parameters", { status: 400 });
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error("dispatch-notifications: auth failed", err);
    return new Response("Auth failed", { status: 500 });
  }

  // 1. Fetch the notification
  const notification = await getDoc(token, `notifications/${notificationId}`);
  if (!notification || notification.schoolId !== schoolId || notification.status !== "queued") {
    return new Response("Notification not found or already processed", { status: 200 });
  }

  // 2. Fetch school settings to get credentials
  const school = await getDoc(token, `schools/${schoolId}`);
  const providers = school?.notificationProviders || {};

  // 3. Fetch students and parents to resolve audience
  const [students, parents] = await Promise.all([
    runQuery(token, "students", [["schoolId", "EQUAL", schoolId]]),
    runQuery(token, "parents", [["schoolId", "EQUAL", schoolId]])
  ]);

  const recipients = resolveRecipients(notification.audience || {}, students, parents);
  let deliveredCount = 0;

  try {
    if (notification.channel === "email" && providers.gmail?.address && providers.gmail?.appPassword) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: providers.gmail.address,
          pass: providers.gmail.appPassword
        }
      });

      const targets = recipients.filter(p => p.email).map(p => p.email);
      for (const email of targets) {
        try {
          await transporter.sendMail({
            from: providers.gmail.address,
            to: email,
            subject: notification.title,
            text: notification.body
          });
          deliveredCount++;
        } catch (err) {
          console.error(`Failed to send email to ${email}`, err);
        }
      }
    } else if (notification.channel === "sms" && providers.africasTalking?.username && providers.africasTalking?.apiKey) {
      const targets = recipients.filter(p => p.phone).map(p => p.phone);
      if (targets.length > 0) {
        // Prepare Africa's Talking request
        const atBody = new URLSearchParams();
        atBody.append("username", providers.africasTalking.username);
        atBody.append("to", targets.join(","));
        atBody.append("message", notification.body);
        if (providers.africasTalking.senderId) {
          atBody.append("from", providers.africasTalking.senderId);
        }

        const atRes = await fetch("https://api.africastalking.com/version1/messaging", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "apiKey": providers.africasTalking.apiKey
          },
          body: atBody
        });

        if (atRes.ok) {
          const atData = await atRes.json();
          deliveredCount = atData.SMSMessageData?.Recipients?.length || targets.length;
        } else {
          console.error("Africa's Talking API error:", await atRes.text());
        }
      }
    }
  } catch (err) {
    console.error("Error dispatching notification:", err);
  }

  // 4. Update notification status
  await patchDoc(token, `notifications/${notificationId}`, {
    status: "delivered",
    recipientCount: deliveredCount
  });

  return new Response(JSON.stringify({ success: true, deliveredCount }), { 
    status: 200, 
    headers: { "Content-Type": "application/json" } 
  });
};
