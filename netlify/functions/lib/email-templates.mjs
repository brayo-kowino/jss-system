// ==========================================================================
// Eeskia Email Engine - Responsive HTML Email Template Builder
// Produces clean, modern, Google / Stripe-style transactional & announcement emails.
// Optimized for all email clients (Gmail, iOS Mail, Outlook, Android).
// ==========================================================================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const TONES = {
  emerald: {
    bg: "#ecfdf5",
    text: "#065f46",
    border: "#a7f3d0",
    dot: "#10b981",
    btn: "#059669",
  },
  amber: {
    bg: "#fffbeb",
    text: "#92400e",
    border: "#fde68a",
    dot: "#f59e0b",
    btn: "#d97706",
  },
  blue: {
    bg: "#eff6ff",
    text: "#1e40af",
    border: "#bfdbfe",
    dot: "#3b82f6",
    btn: "#14538a",
  },
  rose: {
    bg: "#fef2f2",
    text: "#991b1b",
    border: "#fecaca",
    dot: "#ef4444",
    btn: "#dc2626",
  },
  neutral: {
    bg: "#f1f5f9",
    text: "#334155",
    border: "#cbd5e1",
    dot: "#64748b",
    btn: "#1e293b",
  },
};

/**
 * Core Google-inspired email layout.
 */
export function renderBaseEmail({
  brandName = "Eeskia",
  schoolName = "",
  badgeText = "",
  badgeTone = "blue",
  title = "",
  preheader = "",
  bodyHtml = "",
  keyDetails = [],
  calloutBox = null, // { title, text, tone }
  ctaButton = null, // { label, url, tone }
  secondaryNote = "",
  footerText = "",
}) {
  const tone = TONES[badgeTone] || TONES.blue;
  const safeBrand = escapeHtml(brandName);
  const safeSchool = escapeHtml(schoolName);
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || title);

  // Key details table rows
  let detailsHtml = "";
  if (Array.isArray(keyDetails) && keyDetails.length > 0) {
    detailsHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #fafbfc; border-collapse: separate;">
        ${keyDetails
          .map(
            (item, index) => `
          <tr>
            <td style="padding: 12px 16px; font-size: 13px; color: #64748b; font-weight: 500; border-bottom: ${
              index < keyDetails.length - 1 ? "1px solid #edf2f7" : "none"
            }; width: 40%;">
              ${escapeHtml(item.label)}
            </td>
            <td style="padding: 12px 16px; font-size: 13px; color: #0f172a; font-weight: 600; text-align: right; border-bottom: ${
              index < keyDetails.length - 1 ? "1px solid #edf2f7" : "none"
            };">
              ${escapeHtml(item.value)}
            </td>
          </tr>`
          )
          .join("")}
      </table>
    `;
  }

  // Callout box
  let calloutHtml = "";
  if (calloutBox) {
    const cTone = TONES[calloutBox.tone] || tone;
    calloutHtml = `
      <div style="background-color: ${cTone.bg}; border: 1px solid ${cTone.border}; border-radius: 8px; padding: 16px; margin: 20px 0;">
        ${
          calloutBox.title
            ? `<div style="font-size: 14px; font-weight: 700; color: ${cTone.text}; margin-bottom: 4px;">${escapeHtml(
                calloutBox.title
              )}</div>`
            : ""
        }
        <div style="font-size: 13px; line-height: 1.5; color: ${cTone.text};">
          ${calloutBox.text || ""}
        </div>
      </div>
    `;
  }

  // CTA Button
  let ctaHtml = "";
  if (ctaButton && ctaButton.url && ctaButton.label) {
    const btnColor = (TONES[ctaButton.tone] || tone).btn;
    ctaHtml = `
      <div style="margin: 28px 0; text-align: center;">
        <a href="${escapeHtml(ctaButton.url)}" target="_blank" style="display: inline-block; background-color: ${btnColor}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 13px 32px; border-radius: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); letter-spacing: 0.2px;">
          ${escapeHtml(ctaButton.label)}
        </a>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${safeTitle}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      color: #0f172a;
    }
    img { border: 0; outline: none; text-decoration: none; }
    table { border-collapse: collapse; }
    a { color: #14538a; }
  </style>
</head>
<body style="margin: 0; padding: 30px 10px; background-color: #f8fafc;">
  <!-- Preheader text (hidden in body, visible in inbox preview) -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #ffffff; opacity: 0;">
    ${safePreheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 auto; max-width: 600px;">
    <tr>
      <td>
        <!-- Main Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);">
          <!-- Brand Header -->
          <tr>
            <td style="padding: 24px 32px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="vertical-align: middle;">
                    <div style="display: inline-flex; align-items: center; gap: 8px;">
                      <span style="font-size: 19px; font-weight: 800; color: #14538a; letter-spacing: -0.5px; text-transform: uppercase;">
                        ${safeBrand}
                      </span>
                      ${
                        safeSchool
                          ? `<span style="color: #cbd5e1; font-size: 18px; margin: 0 4px;">|</span>
                             <span style="font-size: 13px; font-weight: 600; color: #475569;">${safeSchool}</span>`
                          : ""
                      }
                    </div>
                  </td>
                  ${
                    badgeText
                      ? `<td align="right" style="vertical-align: middle;">
                          <span style="display: inline-block; background-color: ${tone.bg}; border: 1px solid ${tone.border}; color: ${tone.text}; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.5px;">
                            <span style="display: inline-block; width: 6px; height: 6px; background-color: ${tone.dot}; border-radius: 50%; margin-right: 5px; vertical-align: middle;"></span>
                            ${escapeHtml(badgeText)}
                          </span>
                        </td>`
                      : ""
                  }
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 32px 28px;">
              ${
                safeTitle
                  ? `<h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.35; letter-spacing: -0.3px;">
                      ${safeTitle}
                    </h1>`
                  : ""
              }

              <div style="font-size: 14px; line-height: 1.65; color: #334155;">
                ${bodyHtml}
              </div>

              ${calloutHtml}
              ${detailsHtml}
              ${ctaHtml}

              ${
                secondaryNote
                  ? `<p style="margin: 20px 0 0; font-size: 12px; line-height: 1.5; color: #64748b; font-style: italic;">
                      ${escapeHtml(secondaryNote)}
                    </p>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer Inside Card -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: left;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 12px; color: #64748b; line-height: 1.5;">
                    ${
                      footerText
                        ? escapeHtml(footerText)
                        : "This is an official communication dispatched from the Eeskia School Management Platform."
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Outer Footer (Google style) -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
          <tr>
            <td align="center" style="font-size: 11px; color: #94a3b8; line-height: 1.6;">
              <div>&copy; ${new Date().getFullYear()} Eeskia. All rights reserved.</div>
              <div style="margin-top: 4px;">
                Secure CBC School Management Platform &bull; Kenya Curriculum Compliant
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Specialized Template: Service News & Restored Services
// --------------------------------------------------------------------------

export function buildServiceAnnouncementEmail({
  serviceName = "Eeskia Platform Services",
  status = "Restored", // "Restored" | "Maintenance" | "Update"
  headline = "Services Fully Operational",
  summary = "",
  resolution = "",
  restoredAt = "",
  incidentDuration = "",
  actionUrl = "https://eeskia.iskify360.tech",
}) {
  const isRestored = status.toLowerCase() === "restored";
  const tone = isRestored ? "emerald" : "blue";
  const badgeText = isRestored ? "Operational" : status;

  const keyDetails = [];
  if (serviceName) keyDetails.push({ label: "Affected Service", value: serviceName });
  if (restoredAt) keyDetails.push({ label: "Restored At", value: restoredAt });
  if (incidentDuration) keyDetails.push({ label: "Outage Duration", value: incidentDuration });
  keyDetails.push({ label: "Platform Status", value: "All Systems Operational" });

  const bodyHtml = `
    <p style="margin: 0 0 14px;">
      We are pleased to inform you that <strong>${escapeHtml(serviceName)}</strong> has been fully restored and all core systems are operating normally.
    </p>
    ${
      summary
        ? `<p style="margin: 0 0 14px;">${escapeHtml(summary)}</p>`
        : ""
    }
    ${
      resolution
        ? `<p style="margin: 0 0 14px;"><strong>Resolution Summary:</strong> ${escapeHtml(resolution)}</p>`
        : ""
    }
    <p style="margin: 0 0 14px;">
      You and your staff can now resume normal operations, including marks entry, grading computations, fee collections, and report card generation.
    </p>
  `;

  const calloutBox = {
    title: "100% Data Integrity Guaranteed",
    text: "All school records, saved marks, fee receipts, and student profiles remained secure and intact throughout.",
    tone: "emerald",
  };

  return {
    subject: `[Status Update] ${headline} - ${serviceName}`,
    html: renderBaseEmail({
      brandName: "Eeskia",
      badgeText,
      badgeTone: tone,
      title: headline,
      preheader: `${serviceName} has been fully restored and is operational.`,
      bodyHtml,
      keyDetails,
      calloutBox,
      ctaButton: {
        label: "Open Eeskia Dashboard",
        url: actionUrl,
        tone: "emerald",
      },
      secondaryNote: "If you notice any lingering issues, please reach out directly to platform support.",
      footerText: "You are receiving this system service update as an authorized administrator of Eeskia.",
    }),
  };
}

// --------------------------------------------------------------------------
// Specialized Template: Subscription & Trial Expiry Reminders
// --------------------------------------------------------------------------

export function buildSubscriptionReminderEmail({
  schoolName = "Your School",
  planName = "Standard Subscription",
  daysRemaining = 7,
  expiresAt = "",
  adminName = "",
  renewalUrl = "https://eeskia.iskify360.tech/app/#/settings?tab=subscription",
}) {
  const dayWord = daysRemaining === 1 ? "Day" : "Days";
  const isUrgent = daysRemaining <= 3;
  const tone = isUrgent ? "rose" : "amber";
  const badgeText = `${daysRemaining} ${dayWord} Remaining`;

  const greeting = adminName ? `Dear ${escapeHtml(adminName)},` : "Dear School Administrator,";

  const bodyHtml = `
    <p style="margin: 0 0 14px;">${greeting}</p>
    <p style="margin: 0 0 14px;">
      This is a scheduled reminder that the active subscription for <strong>${escapeHtml(schoolName)}</strong> is set to expire in <strong>${daysRemaining} ${dayWord.toLowerCase()}</strong>.
    </p>
    <p style="margin: 0 0 14px;">
      To prevent any disruption to your teachers' daily marks entry, parent fee collections, and student report card generation, please ensure your renewal token is activated before the term date passes.
    </p>
  `;

  const keyDetails = [
    { label: "Institution", value: schoolName },
    { label: "Current Plan", value: planName },
    { label: "Time Remaining", value: `${daysRemaining} ${dayWord}` },
    ...(expiresAt ? [{ label: "Expiration Date", value: expiresAt }] : []),
  ];

  const calloutBox = {
    title: "Seamless Renewal",
    text: "Renewing takes under 30 seconds: obtain a renewal token from your platform administrator and enter it under Settings &gt; Subscription.",
    tone,
  };

  return {
    subject: `Subscription Notice: ${daysRemaining} ${dayWord} remaining for ${schoolName}`,
    html: renderBaseEmail({
      brandName: "Eeskia",
      schoolName,
      badgeText,
      badgeTone: tone,
      title: `Subscription Expiring in ${daysRemaining} ${dayWord}`,
      preheader: `Your ${planName} subscription expires in ${daysRemaining} ${dayWord}. Activate renewal to maintain access.`,
      bodyHtml,
      keyDetails,
      calloutBox,
      ctaButton: {
        label: "Manage Subscription",
        url: renewalUrl,
        tone,
      },
      footerText: "This automated reminder was sent to school administration regarding active platform licensing.",
    }),
  };
}

// --------------------------------------------------------------------------
// Specialized Template: Fee Reminders to Parents
// --------------------------------------------------------------------------

export function buildFeeReminderEmail({
  schoolName = "",
  parentName = "",
  studentName = "",
  grade = "",
  balanceAmount = "",
  termInfo = "",
  paybillNumber = "",
  accountRef = "",
  closingDate = "",
}) {
  const greeting = parentName ? `Dear ${escapeHtml(parentName)},` : "Dear Parent / Guardian,";

  const bodyHtml = `
    <p style="margin: 0 0 14px;">${greeting}</p>
    <p style="margin: 0 0 14px;">
      We hope this finds you well. This is a gentle reminder regarding the outstanding school fee balance for <strong>${escapeHtml(
        studentName
      )}</strong>${grade ? ` (${escapeHtml(grade)})` : ""}${termInfo ? ` for ${escapeHtml(termInfo)}` : ""}.
    </p>
    <p style="margin: 0 0 14px;">
      Prompt settlement ensures uninterrupted access to learning materials, school assessments, and terminal CBC evaluation report cards.
    </p>
  `;

  const keyDetails = [
    { label: "Student Name", value: studentName },
    ...(grade ? [{ label: "Class / Grade", value: grade }] : []),
    ...(termInfo ? [{ label: "Academic Term", value: termInfo }] : []),
    ...(balanceAmount ? [{ label: "Outstanding Balance", value: balanceAmount }] : []),
    ...(paybillNumber ? [{ label: "M-PESA Paybill", value: paybillNumber }] : []),
    ...(accountRef ? [{ label: "Account Number", value: accountRef }] : []),
    ...(closingDate ? [{ label: "Due By", value: closingDate }] : []),
  ];

  return {
    subject: `Fee Balance Notice: ${studentName}${termInfo ? ` - ${termInfo}` : ""}`,
    html: renderBaseEmail({
      brandName: "Eeskia",
      schoolName,
      badgeText: "Fee Reminder",
      badgeTone: "amber",
      title: "School Fee Balance Reminder",
      preheader: `Fee reminder for ${studentName}: Outstanding balance ${balanceAmount || ""}.`,
      bodyHtml,
      keyDetails,
      secondaryNote: "If you have already settled this balance within the last 24 hours, kindly ignore this notice or contact the school bursar with your payment reference.",
      footerText: `Sent on behalf of ${schoolName || "your school administration"}.`,
    }),
  };
}

// --------------------------------------------------------------------------
// Specialized Template: General Announcement / Notification
// --------------------------------------------------------------------------

export function buildGeneralNotificationEmail({
  schoolName = "",
  title = "Notice from School Administration",
  bodyText = "",
  category = "general",
  ctaButton = null,
}) {
  const toneMap = {
    results: "emerald",
    fees: "amber",
    term_closing: "blue",
    term_opening: "blue",
    general: "neutral",
  };
  const badgeMap = {
    results: "Results Published",
    fees: "Fee Notice",
    term_closing: "Term Closing",
    term_opening: "Term Opening",
    general: "Official Notice",
  };

  const paragraphs = (bodyText || "")
    .split(/\n\n+/)
    .map((p) => `<p style="margin: 0 0 14px;">${escapeHtml(p.trim())}</p>`)
    .join("");

  return {
    subject: `${title}${schoolName ? ` - ${schoolName}` : ""}`,
    html: renderBaseEmail({
      brandName: "Eeskia",
      schoolName,
      badgeText: badgeMap[category] || "School Announcement",
      badgeTone: toneMap[category] || "blue",
      title,
      preheader: title,
      bodyHtml: paragraphs,
      ctaButton,
      footerText: `Dispatched by ${schoolName || "School Administration"} via Eeskia.`,
    }),
  };
}
