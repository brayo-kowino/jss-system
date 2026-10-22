import { describe, it, expect } from "vitest";
import {
  renderBaseEmail,
  buildServiceAnnouncementEmail,
  buildSubscriptionReminderEmail,
  buildFeeReminderEmail,
  buildGeneralNotificationEmail,
} from "../../netlify/functions/lib/email-templates.mjs";

describe("Eeskia Email Engine - Google-Style Templates", () => {
  it("renders base email with proper card structure, typography, and escaping", () => {
    const html = renderBaseEmail({
      brandName: "Eeskia",
      schoolName: "Sirandumb Primary & Junior School",
      badgeText: "Operational",
      badgeTone: "emerald",
      title: "System Restored Successfully",
      preheader: "All grading systems are back online.",
      bodyHtml: "<p>Core services have resumed normal operations.</p>",
      keyDetails: [
        { label: "Status", value: "Online" },
        { label: "Uptime", value: "99.9%" },
      ],
      calloutBox: {
        title: "Security Verified",
        text: "Zero records were affected.",
        tone: "emerald",
      },
      ctaButton: {
        label: "Open Dashboard",
        url: "https://eeskia.iskify360.tech",
        tone: "emerald",
      },
      footerText: "Official notification from Eeskia.",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Eeskia");
    expect(html).toContain("Sirandumb Primary &amp; Junior School");
    expect(html).toContain("System Restored Successfully");
    expect(html).toContain("All grading systems are back online.");
    expect(html).toContain("Open Dashboard");
    expect(html).toContain("https://eeskia.iskify360.tech");
    expect(html).toContain("Security Verified");
    expect(html).toContain("Status");
    expect(html).toContain("99.9%");
    expect(html).toContain("max-width: 600px");
  });

  it("builds professional Service Restored announcements with green pill badge", () => {
    const email = buildServiceAnnouncementEmail({
      serviceName: "CBC Grading & Positions Engine",
      status: "Restored",
      headline: "Grading Engine Restored",
      summary: "The ranking engine has completed scheduled cloud optimization.",
      resolution: "Server cluster scaling updated.",
      restoredAt: "22 Oct 2026, 13:45 EAT",
      incidentDuration: "12 minutes",
    });

    expect(email.subject).toContain("[Status Update] Grading Engine Restored");
    expect(email.html).toContain("CBC Grading &amp; Positions Engine");
    expect(email.html).toContain("Operational");
    expect(email.html).toContain("12 minutes");
    expect(email.html).toContain("100% Data Integrity Guaranteed");
  });

  it("builds subscription expiry reminders with countdown", () => {
    const email = buildSubscriptionReminderEmail({
      schoolName: "St. Jude Academy",
      planName: "Pro Annual",
      daysRemaining: 3,
      expiresAt: "25 Oct 2026",
      adminName: "Principal Mary",
    });

    expect(email.subject).toContain("3 Days remaining for St. Jude Academy");
    expect(email.html).toContain("Dear Principal Mary");
    expect(email.html).toContain("3 Days Remaining");
    expect(email.html).toContain("Pro Annual");
    expect(email.html).toContain("Manage Subscription");
  });

  it("builds personalized parent fee balance reminders", () => {
    const email = buildFeeReminderEmail({
      schoolName: "Milimani Academy",
      parentName: "John Doe",
      studentName: "Grace Doe",
      grade: "Grade 7",
      balanceAmount: "KES 14,500",
      termInfo: "Term 3 2026",
      paybillNumber: "522522",
      accountRef: "MIL-701",
    });

    expect(email.subject).toContain("Fee Balance Notice: Grace Doe");
    expect(email.html).toContain("Dear John Doe");
    expect(email.html).toContain("KES 14,500");
    expect(email.html).toContain("522522");
    expect(email.html).toContain("MIL-701");
    expect(email.html).toContain("Fee Reminder");
  });

  it("builds general announcements with clean paragraph layout", () => {
    const email = buildGeneralNotificationEmail({
      schoolName: "Sirandumb Primary",
      title: "End of Term Assembly",
      bodyText: "First paragraph notice.\n\nSecond paragraph details.",
      category: "general",
    });

    expect(email.subject).toContain("End of Term Assembly");
    expect(email.html).toContain("First paragraph notice.");
    expect(email.html).toContain("Second paragraph details.");
    expect(email.html).toContain("Official Notice");
  });
});
