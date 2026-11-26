import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ save: vi.fn(), twoFactor: vi.fn() }));

vi.mock("../../js/services/settings.service.js", () => ({
  getSchoolSettings: async () => ({
    schoolName: "Example Academy", currentTerm: "Term 2", currentAcademicYear: "2026",
    gradingScale: [{ min: 80, max: 100, grade: "EE", points: 4, remark: "Excellent" }],
  }),
  saveSchoolSettings: services.save,
  isSlugAvailable: async () => true,
  uploadSchoolLogo: vi.fn(), publishSchoolBranding: vi.fn(), slugify: (value) => value,
  SLUG_PREFIX: "ees-",
}));
vi.mock("../../js/services/subscription.service.js", () => ({
  activateSubscription: vi.fn(), getSubscriptionState: () => ({ active: true, daysRemaining: 30 }),
  SUBSCRIPTION_PLANS: [], REVOKE_REASONS: [], isStarterPlan: () => false,
}));
vi.mock("../../js/components/shell.js", () => ({
  invalidateSchoolSettingsCache: vi.fn(), refreshSchoolChrome: vi.fn(),
  updateThemeColor: vi.fn(), showApprovalModal: vi.fn(), applyBranding: vi.fn(),
}));
vi.mock("../../js/services/auth.service.js", () => ({
  getCurrentSchoolId: () => "example", refreshCurrentSchool: vi.fn(), getCurrentProfile: () => admin,
}));
vi.mock("../../js/services/device.service.js", () => ({
  listTrustedDevices: async () => [], removeTrustedDevice: vi.fn(), resetAllTrustedDevices: vi.fn(),
}));
vi.mock("../../js/services/login-approval.service.js", () => ({ listRecentApprovals: async () => [] }));
vi.mock("../../js/services/two-factor.service.js", () => ({
  is2FAEnabled: services.twoFactor, generate2FASetup: vi.fn(), disable2FA: vi.fn(), enable2FA: vi.fn(),
}));
vi.mock("../../js/components/signature-pad-modal.js", () => ({ openSignaturePadModal: vi.fn() }));

import { init, render } from "../../views/school-settings.js";

const admin = { uid: "admin", role: "admin" };
const find = (selector) => document.querySelector(selector);
const activeSection = () => find(".settings-tab-panel:not([hidden])").id;

async function openSettings(hash = "#/settings", profile = admin) {
  history.replaceState(null, "", hash);
  document.body.append(await render({ profile }));
  init({ profile });
}

function edit(selector, value, eventName = "input") {
  const control = find(selector);
  control.value = value;
  control.dispatchEvent(new Event(eventName, { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  services.save.mockReset().mockResolvedValue();
  services.twoFactor.mockReset().mockResolvedValue(false);
});

describe("School Settings", () => {
  it("retains all settings routes and preserves drafts while switching by search or section picker", async () => {
    await openSettings("#/settings?tab=branding&source=dashboard");
    expect(activeSection()).toBe("panel-branding");
    expect([...document.querySelectorAll(".settings-section-picker option")].map((option) => option.value))
      .toEqual(["profile", "branding", "leadership", "calendar", "grading", "notifications", "security", "subscription"]);

    find('[data-tab="profile"]').click();
    edit("#motto", "A draft motto");
    expect(find("#preview-school-motto").textContent).toBe("A draft motto");
    expect(find("#preview-school-motto").hidden).toBe(false);

    edit('[type="search"]', "CBC points");
    expect(find(".settings-search-feedback").textContent).toBe("1 matching section");
    find('[type="search"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(activeSection()).toBe("panel-grading");
    expect(location.hash).toContain("source=dashboard");
    expect(location.hash).toContain("tab=grading");
    expect(document.activeElement.id).toBe("settings-heading-grading");
    expect(find('[data-tab="grading"]').getAttribute("aria-current")).toBe("location");

    edit(".settings-section-picker", "profile", "change");
    expect(activeSection()).toBe("panel-profile");
    expect(find("#motto").value).toBe("A draft motto");
    edit("#motto", "");
    expect(find("#preview-school-motto").hidden).toBe(true);
    expect(services.save).not.toHaveBeenCalled();
  });

  it("previews the academic period and keeps the existing explicit calendar save", async () => {
    await openSettings("#/settings?tab=calendar");
    expect(find(".settings-calendar-period").textContent).toBe("Term 2 · 2026");
    edit("#currentAcademicYear", "2027");
    edit("#currentTerm", "Term 3", "change");
    edit("#termBegins", "2027-09-01", "change");
    expect(find(".settings-calendar-period").textContent).toBe("Term 3 · 2027");
    expect(find(".settings-calendar-list dd").textContent).toContain("2027");
    expect(services.save).not.toHaveBeenCalled();

    find("#calendar-form").requestSubmit(find('#calendar-form button[type="submit"]'));
    await vi.waitFor(() => expect(services.save).toHaveBeenCalledExactlyOnceWith("admin", {
      currentAcademicYear: "2027", currentTerm: "Term 3", termBegins: "2027-09-01", closingDate: "", openingDate: "",
    }));
  });

  it("retains editable grading values and saves added bands in the existing format", async () => {
    await openSettings("#/settings?tab=grading");
    find("#add-grading-row").click();
    edit("#grading-tbody tr:last-child .grade-min", "60");
    edit("#grading-tbody tr:last-child .grade-max", "79");
    edit("#grading-tbody tr:last-child .grade-code", "ME");
    edit("#grading-tbody tr:last-child .grade-points", "3");
    find("#save-grading").click();
    await vi.waitFor(() => expect(services.save).toHaveBeenCalledExactlyOnceWith("admin", { gradingScale: [
      { min: 80, max: 100, grade: "EE", points: 4, remark: "Excellent" },
      { min: 60, max: 79, grade: "ME", points: 3, remark: "" },
    ] }));
  });

  it("keeps the security section restricted and allows admins to retry a failed status check", async () => {
    await openSettings("#/settings?tab=security", { uid: "teacher", role: "teacher" });
    expect(activeSection()).toBe("panel-profile");
    expect(find('[data-tab="security"]')).toBeNull();
    expect(services.twoFactor).not.toHaveBeenCalled();

    document.body.replaceChildren();
    services.twoFactor.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(true);
    await openSettings("#/settings?tab=security");
    await vi.waitFor(() => expect(find("#tfa-content button").textContent).toBe("Retry"));
    find("#tfa-content button").click();
    await vi.waitFor(() => expect(find("#tfa-content button").textContent).toBe("Disable 2FA"));
    expect(find(".settings-ownership").open).toBe(false);
  });
});
