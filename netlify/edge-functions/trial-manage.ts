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

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    // Super Admin check
    const uid = decodedToken.sub;
    const accessToken = await getAccessToken();
    const userDoc = await getFsDoc(`users/${uid}`, accessToken);
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
      await patchFsDoc(`platform_settings/trial`, configDoc, accessToken);
      return jsonResponse({ success: true });
    }

    if (!schoolId) {
      return jsonResponse({ error: "Missing schoolId" }, 400);
    }

    const schoolDoc = await getFsDoc(`schools/${schoolId}`, accessToken);
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

      await patchFsDoc(`schools/${schoolId}`, updates, accessToken);
      await syncSubscriptionClaims(schoolId, "trial", expiresAt.toISOString());

      // Add to audit logs
      const auditLog = {
        schoolId,
        action: "trial_assigned",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { days: trialDays, reason: reason || "Manual assignment" }
      };
      await putFsDoc(`audit_logs/${crypto.randomUUID()}`, auditLog, accessToken);

      return jsonResponse({ trialExpiresAt: expiresAt.toISOString() });
    }

    if (action === "extend") {
      if (schoolDoc.subscriptionStatus !== "trial") {
        return jsonResponse({ error: "School is not currently on a trial" }, 400);
      }

      // Fetch config to check max extensions and extension days
      const config = await getFsDoc(`platform_settings/trial`, accessToken);
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

      await patchFsDoc(`schools/${schoolId}`, {
        trialExpiresAt: newExpiry.toISOString(),
        trialExtensions: extensions
      }, accessToken);

      await syncSubscriptionClaims(schoolId, "trial", newExpiry.toISOString());

      const auditLog = {
        schoolId,
        action: "trial_extended",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { extensionDays: extDays, newExpiry: newExpiry.toISOString(), reason }
      };
      await putFsDoc(`audit_logs/${crypto.randomUUID()}`, auditLog, accessToken);

      return jsonResponse({ newExpiresAt: newExpiry.toISOString() });
    }

    if (action === "end") {
      if (schoolDoc.subscriptionStatus !== "trial") {
        return jsonResponse({ error: "School is not currently on a trial" }, 400);
      }

      const now = new Date();
      await patchFsDoc(`schools/${schoolId}`, {
        subscriptionStatus: "inactive",
        trialEndedAt: now.toISOString(),
        trialEndReason: "ended_by_admin"
      }, accessToken);

      // Force claims update immediately
      await syncSubscriptionClaims(schoolId, "inactive", now.toISOString());

      const auditLog = {
        schoolId,
        action: "trial_ended",
        actorId: uid,
        timestamp: now.toISOString(),
        details: { reason: reason || "Ended manually by admin" }
      };
      await putFsDoc(`audit_logs/${crypto.randomUUID()}`, auditLog, accessToken);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);

  } catch (err: any) {
    console.error("Trial manage error:", err);
    return jsonResponse({ error: "Internal server error: " + (err.message || String(err)) }, 500);
  }
}
