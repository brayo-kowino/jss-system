// ==========================================================================
// Account Recovery Edge Function - Super Admin Only
// Incident response tool allowing platform administrators to quarantine,
// wipe unauthorized 2FA/devices, and issue clean credentials to compromised admins.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import {
  getAccessToken,
  getFsDoc,
  patchFsDoc,
  addFsDoc,
  deleteFsDoc,
  listFsDocs,
  runFsQuery,
  verifyFirebaseIdToken,
  jsonResponse,
} from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

function generateSecurePassword(length = 14): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const syms = "!@#$%^&*()_+~=";
  const all = upper + lower + nums + syms;

  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);

  let out = "";
  // Ensure at least one from each class
  out += upper[arr[0] % upper.length];
  out += lower[arr[1] % lower.length];
  out += nums[arr[2] % nums.length];
  out += syms[arr[3] % syms.length];

  for (let i = 4; i < length; i++) {
    out += all[arr[i] % all.length];
  }

  // Shuffle
  return out.split("").sort(() => 0.5 - Math.random()).join("");
}

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const rl = await checkRateLimit(`recovery:${clientIp(request, context)}`, 30, 60);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const callerUid = await verifyFirebaseIdToken(idToken);
  if (!callerUid) return jsonResponse({ error: "You must be signed in." }, 401);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("account-recovery: service account auth failed", err);
    return jsonResponse({ error: "Recovery service unavailable." }, 500);
  }

  // Ensure caller is super_admin
  let caller: Record<string, any> | null;
  try {
    caller = await getFsDoc(accessToken, `users/${callerUid}`);
  } catch (err) {
    console.error("account-recovery: caller lookup failed", err);
    return jsonResponse({ error: "Authentication failed." }, 500);
  }
  if (!caller || caller.status === "suspended" || caller.role !== "super_admin") {
    return jsonResponse({ error: "Only platform administrators can perform account recovery." }, 403);
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const action = String(body.action || "").trim();
  let targetUid = String(body.uid || "").trim();
  const schoolId = String(body.schoolId || "").trim();

  // If uid not provided but schoolId is, find the admin user of this school
  let school: Record<string, any> | null = null;
  if (schoolId) {
    try {
      school = await getFsDoc(accessToken, `schools/${schoolId}`);
    } catch {}
  }

  if (!targetUid && schoolId) {
    try {
      const schoolAdmins = await runFsQuery(accessToken, "users", [
        ["schoolId", "EQUAL", schoolId],
        ["role", "EQUAL", "admin"],
      ]);
      if (schoolAdmins.length > 0) {
        targetUid = schoolAdmins[0].id;
      } else if (school?.adminEmail) {
        const byEmail = await runFsQuery(accessToken, "users", [
          ["email", "EQUAL", school.adminEmail],
        ]);
        if (byEmail.length > 0) targetUid = byEmail[0].id;
      }
    } catch (err) {
      console.warn("account-recovery: failed to query admin by schoolId", err);
    }
  }

  if (!targetUid) {
    return jsonResponse({ error: "Target administrator UID or valid school ID is required." }, 400);
  }

  let targetUser: Record<string, any> | null = null;
  try {
    targetUser = await getFsDoc(accessToken, `users/${targetUid}`);
  } catch (err) {
    console.error("account-recovery: target user lookup failed", err);
    return jsonResponse({ error: "Target account lookup failed." }, 500);
  }
  if (!targetUser) {
    return jsonResponse({ error: "Target account does not exist." }, 404);
  }

  // Action 1: Get Details
  if (action === "get_details") {
    let devicesCount = 0;
    try {
      const devices = await listFsDocs(accessToken, `users/${targetUid}/trusted_devices`);
      devicesCount = devices.length;
    } catch {}

    const resolvedSchoolId = targetUser.schoolId || schoolId;
    if (!school && resolvedSchoolId) {
      try {
        school = await getFsDoc(accessToken, `schools/${resolvedSchoolId}`);
      } catch {}
    }

    return jsonResponse({
      user: {
        uid: targetUid,
        email: targetUser.email,
        fullName: targetUser.fullName,
        role: targetUser.role,
        status: targetUser.status || "active",
        twoFactorEnabled: targetUser.twoFactorEnabled === true,
        mustChangePassword: targetUser.mustChangePassword === true,
        frozenAt: targetUser.frozenAt || null,
        freezeReason: targetUser.freezeReason || null,
      },
      trustedDevicesCount: devicesCount,
      pendingTransfer: school?.pendingTransfer || null,
      schoolName: school?.schoolName || school?.name || "School",
      schoolId: resolvedSchoolId,
    }, 200);
  }

  // Action 2: Toggle Quarantine (Suspend / Reinstate)
  if (action === "toggle_quarantine") {
    const nextStatus = body.status === "active" ? "active" : "suspended";
    const now = new Date();

    try {
      if (nextStatus === "suspended") {
        // Invalidate active sessions immediately
        await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            localId: targetUid,
            validSince: String(Math.floor(Date.now() / 1000)),
          }),
        });
      }

      await patchFsDoc(accessToken, `users/${targetUid}`, {
        status: nextStatus,
        freezeReason: nextStatus === "suspended" ? (body.reason || "Quarantined by Super Admin") : null,
        frozenAt: nextStatus === "suspended" ? now : null,
        updatedAt: now,
      });

      await addFsDoc(accessToken, "audit_logs", {
        userId: callerUid,
        action: nextStatus === "suspended" ? "quarantine_user_account" : "reinstate_user_account",
        entity: "users",
        entityId: targetUid,
        timestamp: now,
        details: { targetEmail: targetUser.email },
      });

      return jsonResponse({ success: true, status: nextStatus }, 200);
    } catch (err: any) {
      console.error("account-recovery: toggle quarantine failed", err);
      return jsonResponse({ error: err.message || "Failed to update quarantine status." }, 500);
    }
  }

  // Action 3: Wipe Security (Clear 2FA, trusted devices, and pending transfer)
  if (action === "wipe_security") {
    try {
      // 1. Delete all trusted devices
      const devices = await listFsDocs(accessToken, `users/${targetUid}/trusted_devices`);
      for (const d of devices) {
        await deleteFsDoc(accessToken, `users/${targetUid}/trusted_devices/${d.id}`);
      }

      // 2. Clear 2FA
      await patchFsDoc(accessToken, `users/${targetUid}`, {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorEnabledAt: null,
        updatedAt: new Date(),
      });

      // 3. Clear pending ownership transfer on school
      const resolvedSchoolId = targetUser.schoolId || schoolId;
      if (resolvedSchoolId) {
        await patchFsDoc(accessToken, `schools/${resolvedSchoolId}`, {
          pendingTransfer: null,
          updatedAt: new Date(),
        });
      }

      // 4. Invalidate sessions
      await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          localId: targetUid,
          validSince: String(Math.floor(Date.now() / 1000)),
        }),
      });

      await addFsDoc(accessToken, "audit_logs", {
        userId: callerUid,
        action: "wipe_user_security_credentials",
        entity: "users",
        entityId: targetUid,
        timestamp: new Date(),
        details: { targetEmail: targetUser.email, clearedDevices: devices.length },
      });

      return jsonResponse({ success: true, clearedDevicesCount: devices.length }, 200);
    } catch (err: any) {
      console.error("account-recovery: wipe security failed", err);
      return jsonResponse({ error: err.message || "Failed to wipe security setup." }, 500);
    }
  }

  // Action 4: Issue Secure Temporary Password & Restore Access
  if (action === "issue_temp_credentials") {
    const tempPassword = generateSecurePassword(14);
    const now = new Date();

    try {
      // 1. Update Firebase Auth password and revoke all existing sessions
      const authRes = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          localId: targetUid,
          password: tempPassword,
          validSince: String(Math.floor(Date.now() / 1000)),
          returnSecureToken: false,
        }),
      });

      if (!authRes.ok) {
        const errData = await authRes.json();
        throw new Error(errData?.error?.message || "Failed to update auth password.");
      }

      // 2. Wipe trusted devices & 2FA
      const devices = await listFsDocs(accessToken, `users/${targetUid}/trusted_devices`);
      for (const d of devices) {
        await deleteFsDoc(accessToken, `users/${targetUid}/trusted_devices/${d.id}`);
      }

      // 3. Mark user mustChangePassword, active, and clean 2FA
      await patchFsDoc(accessToken, `users/${targetUid}`, {
        status: "active",
        mustChangePassword: true,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorEnabledAt: null,
        freezeReason: null,
        frozenAt: null,
        updatedAt: now,
      });

      // 4. Clear pending ownership transfer
      const resolvedSchoolId = targetUser.schoolId || schoolId;
      if (resolvedSchoolId) {
        await patchFsDoc(accessToken, `schools/${resolvedSchoolId}`, {
          pendingTransfer: null,
          updatedAt: now,
        });
      }

      // 5. Audit log
      await addFsDoc(accessToken, "audit_logs", {
        userId: callerUid,
        action: "issue_recovery_temp_password",
        entity: "users",
        entityId: targetUid,
        timestamp: now,
        details: { targetEmail: targetUser.email },
      });

      return jsonResponse({
        success: true,
        tempPassword,
        email: targetUser.email,
        fullName: targetUser.fullName,
      }, 200);
    } catch (err: any) {
      console.error("account-recovery: issue temp credentials failed", err);
      return jsonResponse({ error: err.message || "Failed to issue temporary credentials." }, 500);
    }
  }

  return jsonResponse({ error: `Unknown action "${action}".` }, 400);
};

export const config = {
  path: "/account-recovery",
};
