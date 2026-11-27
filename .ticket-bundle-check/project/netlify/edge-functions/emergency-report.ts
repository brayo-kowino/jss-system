// ==========================================================================
// Emergency Account Compromise Report Edge Function
// Allows locked-out or hacked administrators to submit an urgent security
// incident report directly to the Super Admin support desk without logging in.
// ==========================================================================

import type { Context } from "https://edge.netlify.com";
import {
  getAccessToken,
  runFsQuery,
  addFsDoc,
  jsonResponse,
} from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse, clientIp } from "./lib/rate-limit.ts";

export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  // Rate limit: 5 emergency reports per 5 minutes per IP
  const rl = await checkRateLimit(`emergency-report:${clientIp(request, context)}`, 5, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Malformed request." }, 400);
  }

  const email = String(body.email || "").trim();
  const contactPhone = String(body.contactPhone || "").trim();
  const schoolIdentifier = String(body.schoolCodeOrName || "").trim();
  const reporterName = String(body.reporterName || "").trim();
  const details = String(body.details || "").trim();

  if (!email || !contactPhone || !details) {
    return jsonResponse({ error: "Email, contact phone number, and incident details are required." }, 400);
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error("emergency-report: service account auth failed", err);
    return jsonResponse({ error: "Incident reporting is temporarily unavailable." }, 500);
  }

  // Attempt to resolve the school
  let schoolId = "unresolved";
  let schoolName = schoolIdentifier || "Unresolved School";

  try {
    if (schoolIdentifier) {
      const bySlug = await runFsQuery(accessToken, "schools", [["slug", "EQUAL", schoolIdentifier.toLowerCase()]]);
      if (bySlug.length > 0) {
        schoolId = bySlug[0].id;
        schoolName = bySlug[0].schoolName || bySlug[0].name || schoolName;
      }
    }

    if (schoolId === "unresolved" && email) {
      const byEmail = await runFsQuery(accessToken, "schools", [["adminEmail", "EQUAL", email.toLowerCase()]]);
      if (byEmail.length > 0) {
        schoolId = byEmail[0].id;
        schoolName = byEmail[0].schoolName || byEmail[0].name || schoolName;
      }
    }
  } catch (err) {
    console.warn("emergency-report: school lookup failed, proceeding as unresolved", err);
  }

  let ticketId = "";
  try {
    const ticketDoc = await addFsDoc(accessToken, "support_tickets", {
      schoolId,
      schoolName,
      subject: `🚨 CRITICAL: Account Compromised / Locked Out Report (${email})`,
      message: `[EMERGENCY INCIDENT REPORT]\nAffected Account: ${email}\nReporter Name: ${reporterName || "Administrator"}\nVerified Contact Phone: ${contactPhone}\nSchool Indicated: ${schoolIdentifier}\n\nIncident Description:\n${details}`,
      category: "account_compromise",
      priority: "critical",
      status: "open",
      contactEmail: email,
      contactPhone,
      reporterName: reporterName || "Administrator",
      raisedBy: "public_emergency_portal",
      raisedAt: new Date(),
    });
    ticketId = ticketDoc?.name ? ticketDoc.name.split("/").pop() : `INC-${Date.now().toString(36).toUpperCase()}`;

    // Audit log
    await addFsDoc(accessToken, "audit_logs", {
      userId: "public_emergency_reporter",
      action: "emergency_compromise_reported",
      entity: "support_tickets",
      entityId: ticketId,
      timestamp: new Date(),
      details: { affectedEmail: email, schoolId },
    });
  } catch (err) {
    console.error("emergency-report: failed to create incident ticket", err);
    return jsonResponse({ error: "Could not file emergency incident. Please reach out via phone support." }, 500);
  }

  return jsonResponse({
    success: true,
    ticketId,
    schoolName,
    message: "Emergency report successfully lodged.",
  }, 200);
};

export const config = {
  path: "/emergency-report",
};
