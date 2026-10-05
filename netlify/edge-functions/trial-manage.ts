import { Context } from "https://edge.netlify.com";
import {
  getAccessToken,
  getFsDoc,
  patchFsDoc,
  putFsDoc,
  verifyFirebaseIdToken,
  jsonResponse,
  syncSubscriptionClaims
} from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async function trialManage(req: Request, context: Context) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ip = clientIp(req, context);
    if (!checkRateLimit(ip, "trial_manage", 20, 60)) {
      return rateLimitedResponse();
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const idToken = authHeader.split(" ")[1];

    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) return jsonResponse({ error: "Invalid token" }, 401);

    // Super Admin check
    const accessToken = await getAccessToken();
    const userDoc = await getFsDoc(accessToken, `users/${uid}`);
    if (!userDoc || userDoc.role !== "super_admin" || userDoc.status === "suspended") {
      return jsonResponse({ error: "Forbidden: Super Admin only" }, 403);
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const { action, schoolId, reason, days, settings } = body;

    if (action === "configure") {
      if (!settings) return jsonResponse({ error: "Missing settings" }, 400);
      
      const configDoc = {
        defaultTrialDays: settings.defaultTrialDays ?? 30,
        maxExtensions: settings.maxExtensions ?? 2,
        extensionDays: settings.extensionDays ?? 7,
        gracePeriodDays: settings.gracePeriodDays ?? 3,
        autoTrialOnCreate: settings.autoTrialOnCreate ?? true,
        trialFeatureTier: settings.trialFeatureTier ?? "growth",
        enableTrialBanner: settings.enableTrialBanner ?? true,
        warningThresholds: settings.warningThresholds ?? [7, 3, 1],
        updatedAt: new Date().toISOString(),
        updatedBy: uid
      };

      // Ensure platform_settings document exists or patch it
      await patchFsDoc(accessToken, `platform_settings/trial`, configDoc);
      return jsonResponse({ success: true });
    }

    if (!schoolId) {
      return jsonResponse({ error: "Missing schoolId" }, 400);
    }

    const schoolDoc = await getFsDoc(accessToken, `schools/${schoolId}`);
    if (!schoolDoc) {
      return jsonResponse({ error: "School not found" }, 404);
    }

    if (action === "assign") {
      const trialDays = days !== undefined ? days : 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

      const updates = {
        subscriptionStatus: "trial",
        trialStartedAt: now.toISOString(),
        trialExpiresAt: expiresAt.toISOString(),
        trialEndedAt: null,
        trialEndReason: null,
        trialExtensions: []
      };

      await patchFsDoc(accessToken, `schools/${schoolId}`, updates);
      await syncSubscriptionClaims(accessToken, schoolId);

      // Add to audit logs
      const auditLog = {
        schoolId,
        action: "trial_assigned",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { days: trialDays, reason: reason || "Manual assignment" }
      };
      await putFsDoc(accessToken, `audit_logs/${crypto.randomUUID()}`, auditLog);

      return jsonResponse({ trialExpiresAt: expiresAt.toISOString() });
    }

    if (action === "extend") {
      if (schoolDoc.subscriptionStatus !== "trial") {
        return jsonResponse({ error: "School is not currently on a trial" }, 400);
      }

      // Fetch config to check max extensions and extension days
      const config = await getFsDoc(accessToken, `platform_settings/trial`);
      const maxExt = config?.maxExtensions ?? 2;
      const extDays = config?.extensionDays ?? 7;

      const extensions = Array.isArray(schoolDoc.trialExtensions) ? schoolDoc.trialExtensions : [];
      if (extensions.length >= maxExt) {
        return jsonResponse({ error: "Max extensions reached" }, 400);
      }

      const prevExpiry = schoolDoc.trialExpiresAt ? new Date(schoolDoc.trialExpiresAt) : new Date();
      const newExpiry = new Date(prevExpiry.getTime() + extDays * 24 * 60 * 60 * 1000);
      const now = new Date();

      extensions.push({
        extendedBy: uid,
        extendedAt: now.toISOString(),
        previousExpiry: prevExpiry.toISOString(),
        newExpiry: newExpiry.toISOString(),
        reason: reason || "Extended by admin"
      });

      await patchFsDoc(accessToken, `schools/${schoolId}`, {
        trialExpiresAt: newExpiry.toISOString(),
        trialExtensions: extensions
      });

      await syncSubscriptionClaims(accessToken, schoolId);

      const auditLog = {
        schoolId,
        action: "trial_extended",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { extensionDays: extDays, newExpiry: newExpiry.toISOString(), reason }
      };
      await putFsDoc(accessToken, `audit_logs/${crypto.randomUUID()}`, auditLog);

      return jsonResponse({ newExpiresAt: newExpiry.toISOString() });
    }

    if (action === "end") {
      if (schoolDoc.subscriptionStatus !== "trial") {
        return jsonResponse({ error: "School is not currently on a trial" }, 400);
      }

      const now = new Date();
      await patchFsDoc(accessToken, `schools/${schoolId}`, {
        subscriptionStatus: "inactive",
        trialEndedAt: now.toISOString(),
        trialEndReason: "ended_by_admin"
      });

      // Force claims update immediately
      await syncSubscriptionClaims(accessToken, schoolId);

      const auditLog = {
        schoolId,
        action: "trial_ended",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { reason: reason || "Ended manually by admin" }
      };
      await putFsDoc(accessToken, `audit_logs/${crypto.randomUUID()}`, auditLog);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);

  } catch (err: any) {
    console.error("Trial manage error:", err);
    return jsonResponse({ error: "Internal server error: " + (err.message || String(err)) }, 500);
  }
}
