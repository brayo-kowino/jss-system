// ==========================================================================
// Emergency Account Freeze Edge Function
// Allows an admin to instantly quarantine their account via a signed link
// if their credentials were changed without their consent.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import {
  getAccessToken,
  getFsDoc,
  patchFsDoc,
  addFsDoc,
  deleteFsDoc,
  listFsDocs,
  jsonResponse,
} from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyFreezeToken(secret: string, token: string): Promise<any | null> {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expectedSigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
    const expectedSig = base64UrlEncode(new Uint8Array(expectedSigBuf));

    if (!safeEqual(sigB64, expectedSig)) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson);

    if (payload.purpose !== "emergency_freeze") return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (!payload.uid) return null;

    return payload;
  } catch {
    return null;
  }
}

export default async (request: Request, context: Context) => {
  const rl = await checkRateLimit(`freeze:${clientIp(request, context)}`, 10, 60);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let token = "";
  const url = new URL(request.url);
  token = url.searchParams.get("token") || "";

  if (!token && request.method === "POST") {
    try {
      const body = await request.json();
      token = String(body.token || "");
    } catch {}
  }

  if (!token) {
    return jsonResponse({ error: "Missing emergency freeze token." }, 400);
  }

  const secret = Netlify.env.get("STEP_UP_TOKEN_SECRET") || "eeskia-freeze-default-secret";
  const payload = await verifyFreezeToken(secret, token);
  if (!payload) {
    return jsonResponse({ error: "This emergency freeze link is invalid or has expired." }, 400);
  }

  const uid = payload.uid;

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("emergency-freeze: service account auth failed", err);
    return jsonResponse({ error: "Security service temporarily unavailable." }, 500);
  }

  // 1. Revoke all active Firebase Auth sessions
  try {
    await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        localId: uid,
        validSince: String(Math.floor(Date.now() / 1000)),
      }),
    });
  } catch (err) {
    console.error("emergency-freeze: failed to revoke tokens", err);
  }

  // 2. Quarantine account in Firestore
  try {
    await patchFsDoc(accessToken, `users/${uid}`, {
      status: "suspended",
      freezeReason: "User self-quarantined via security alert link",
      frozenAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error("emergency-freeze: failed to suspend user", err);
    return jsonResponse({ error: "Could not quarantine account." }, 500);
  }

  // 3. Clear trusted devices & 2FA
  try {
    const devices = await listFsDocs(accessToken, `users/${uid}/trusted_devices`);
    for (const d of devices) {
      await deleteFsDoc(accessToken, `users/${uid}/trusted_devices/${d.id}`);
    }
    await patchFsDoc(accessToken, `users/${uid}`, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      twoFactorEnabledAt: null,
    });
  } catch (err) {
    console.error("emergency-freeze: failed to clear devices/2FA", err);
  }

  // 4. Cancel pending ownership transfer on school if present
  let schoolName = "School";
  if (payload.schoolId) {
    try {
      const school = await getFsDoc(accessToken, `schools/${payload.schoolId}`);
      if (school) {
        schoolName = school.schoolName || school.name || "School";
      }
      await patchFsDoc(accessToken, `schools/${payload.schoolId}`, {
        pendingTransfer: null,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.warn("emergency-freeze: school update failed", err);
    }
  }

  // 5. Raise critical incident ticket
  let ticketId = "";
  try {
    const ticketRes = await addFsDoc(accessToken, "support_tickets", {
      schoolId: payload.schoolId || "unassigned",
      schoolName,
      subject: "🚨 EMERGENCY: Admin Account Quarantined (Reported Password Compromise)",
      message: `Administrator ${payload.email} clicked the emergency freeze link after an unauthorized password change. The account has been immediately suspended, active login sessions terminated, and trusted devices wiped. Please verify identity and re-issue clean credentials.`,
      status: "open",
      priority: "critical",
      category: "security_breach",
      raisedBy: uid,
      raisedAt: new Date(),
    });
    ticketId = ticketRes?.name ? ticketRes.name.split("/").pop() : "";
  } catch (err) {
    console.error("emergency-freeze: ticket creation failed", err);
  }

  // 6. Log audit action
  try {
    await addFsDoc(accessToken, "audit_logs", {
      userId: uid,
      action: "emergency_account_freeze",
      entity: "users",
      entityId: uid,
      timestamp: new Date(),
    });
  } catch {}

  return jsonResponse({
    success: true,
    frozen: true,
    email: payload.email,
    schoolName,
    ticketId,
    timestamp: new Date().toISOString(),
  }, 200);
};

export const config = {
  path: "/emergency-freeze",
};
