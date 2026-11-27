import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ transport: vi.fn(), send: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.transport } }));

import { createGmailSender, createPlatformEmailDispatcher } from "../../netlify/functions/lib/email-dispatch.mjs";

beforeEach(() => {
  vi.clearAllMocks();
  mail.transport.mockReturnValue({ sendMail: mail.send });
  for (const key of ["PLATFORM_EMAIL_USER", "PLATFORM_EMAIL_PASS", "GMAIL_USER", "GMAIL_PASS"]) vi.stubEnv(key, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Platform email dispatch", () => {
  it("uses the configured Platform Email Settings for SMTP and sender identity", async () => {
    vi.stubEnv("PLATFORM_EMAIL_USER", "environment@example.test");
    vi.stubEnv("PLATFORM_EMAIL_PASS", "fixture-password");
    const { send } = createPlatformEmailDispatcher({
      smtpUser: "configured@example.test", smtpPass: "configured-fixture", senderName: "Platform Desk", replyTo: "desk@example.test",
    }, { socketTimeout: 5000 });
    await send({ to: "school@example.test", subject: "Example update", messageId: "<id@example.test>" });
    expect(mail.transport).toHaveBeenCalledExactlyOnceWith({ service: "gmail", auth: { user: "configured@example.test", pass: "configured-fixture" }, socketTimeout: 5000 });
    expect(mail.send).toHaveBeenCalledExactlyOnceWith({
      to: "school@example.test", subject: "Example update", messageId: "<id@example.test>",
      from: { name: "Platform Desk", address: "configured@example.test" }, replyTo: "desk@example.test",
    });
  });

  it.each(["PLATFORM_EMAIL", "GMAIL"])("supports the existing %s environment fallback", async (prefix) => {
    vi.stubEnv(`${prefix}_USER`, "environment@example.test");
    vi.stubEnv(`${prefix}_PASS`, "fixture-password");
    const { send } = createPlatformEmailDispatcher(null);
    await send({ to: "school@example.test" });
    expect(mail.send).toHaveBeenCalledExactlyOnceWith({
      to: "school@example.test", from: { name: "Eeskia Notifications", address: "environment@example.test" }, replyTo: "environment@example.test",
    });
  });

  it("keeps the school fallback available to broadcasts when platform mail is unconfigured", async () => {
    const platform = createPlatformEmailDispatcher(null);
    expect(platform.send).toBeNull();
    expect(mail.transport).not.toHaveBeenCalled();
    await createGmailSender({ user: "school@example.test", pass: "school-fixture", senderName: platform.senderName, replyTo: platform.replyTo })({ to: "staff@example.test" });
    expect(mail.send).toHaveBeenCalledExactlyOnceWith({
      to: "staff@example.test", from: { name: "Eeskia Notifications", address: "school@example.test" }, replyTo: "support@eeskia.iskify360.tech",
    });
  });
});
