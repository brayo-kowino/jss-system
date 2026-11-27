import nodemailer from "nodemailer";

export function createGmailSender({ user, pass, senderName, replyTo }, transportOptions = {}) {
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({ ...transportOptions, service: "gmail", auth: { user, pass } });
  return (message) => transport.sendMail({ ...message, from: { name: senderName, address: user }, replyTo });
}

export function createPlatformEmailDispatcher(settings, transportOptions) {
  const user = settings?.smtpUser || process.env.PLATFORM_EMAIL_USER || process.env.GMAIL_USER;
  const pass = settings?.smtpPass || process.env.PLATFORM_EMAIL_PASS || process.env.GMAIL_PASS;
  const senderName = settings?.senderName || "Eeskia Notifications";
  const replyTo = settings?.replyTo || user || "support@eeskia.iskify360.tech";
  return { senderName, replyTo, send: createGmailSender({ user, pass, senderName, replyTo }, transportOptions) };
}
