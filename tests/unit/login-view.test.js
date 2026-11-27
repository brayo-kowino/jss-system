import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(), reset: vi.fn(), school: vi.fn(), navigate: vi.fn(), persistence: vi.fn(),
}));

vi.mock("../../js/services/auth.service.js", () => ({ login: mocks.login, requestPasswordReset: mocks.reset }));
vi.mock("../../js/components/auth-gate.js", () => ({
  renderApprovalGate: vi.fn(), renderTwoFactorGate: vi.fn(), renderDeviceLimitGate: vi.fn(), renderRegistrationErrorGate: vi.fn(),
}));
vi.mock("../../js/firebase-config.js", () => ({ auth: {} }));
vi.mock("firebase/auth", () => ({
  setPersistence: mocks.persistence, browserLocalPersistence: "local", browserSessionPersistence: "session",
}));
vi.mock("../../js/router.js", () => ({ navigate: mocks.navigate, getDefaultRoute: vi.fn(), routes: {} }));
vi.mock("../../js/services/deep-link.service.js", () => ({ resolvePostLoginDestination: () => "/dashboard" }));
vi.mock("../../js/services/settings.service.js", () => ({
  getSchoolBySlug: mocks.school, SLUG_PREFIX: "ees", slugify: (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
}));
vi.mock("../../js/services/branding.service.js", () => ({ applyBranding: vi.fn() }));

import { init, render } from "../../views/login.js";

const select = (selector) => document.querySelector(selector);

async function mount(search = "") {
  history.replaceState(null, "", `/app/${search}#/login`);
  document.body.append(await render());
  init();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true });
  localStorage.clear();
  mocks.school.mockResolvedValue(null);
  mocks.login.mockResolvedValue({ role: "teacher" });
});

afterEach(() => {
  select(".modal__close")?.click();
  document.body.replaceChildren();
  window.dispatchEvent(new Event("online"));
  vi.restoreAllMocks();
});

describe("Login screen", () => {
  it("shows the school identity once, puts sign-in first, and keeps the learner's eyes", async () => {
    mocks.school.mockResolvedValueOnce({ slug: "ees-example", schoolName: "Example Academy", motto: "Learn with purpose", logoUrl: "/example.png" });
    await mount("?school=ees-example");
    expect(select(".login-screen").firstElementChild.tagName).toBe("MAIN");
    expect(select("h1").textContent).toBe("Sign in");
    expect(select(".login-screen").textContent.match(/Example Academy/g)).toHaveLength(1);
    expect(select(".login-identity img").getAttribute("src")).toBe("/example.png");
    expect(select("#login-school-picker").textContent).toBe("Switch school");
    expect(select(".login-art__motto").textContent).toBe("Learn with purpose");
    expect(select(".login-identity__motto").textContent).toBe("Learn with purpose");
    expect(select("#learner-pupil-l")).not.toBeNull();
    expect(select("#learner-pupil-r")).not.toBeNull();
    expect(select(".auth-rotator")).toBeNull();
  });

  it("reveals the single school picker, checks a prefixed code, and returns focus on cancel", async () => {
    await mount();
    expect(select(".login-art__motto").textContent).toBe("School management system");
    const picker = select("#login-school-picker");
    expect(picker.textContent).toBe("Enter school code");
    picker.click();
    const input = select("#school-code-input");
    expect(document.activeElement).toBe(input);
    expect(picker.getAttribute("aria-expanded")).toBe("true");
    input.value = "ees-green-academy";
    const codeForm = select("#school-code-form");
    codeForm.requestSubmit(codeForm.querySelector('[type="submit"]'));
    await vi.waitFor(() => expect(select("#school-code-error").textContent).toContain("wasn't recognized"));
    expect(mocks.school).toHaveBeenCalledExactlyOnceWith("ees-green-academy");
    input.value = "a".repeat(45);
    codeForm.requestSubmit(codeForm.querySelector('[type="submit"]'));
    await vi.waitFor(() => expect(mocks.school).toHaveBeenLastCalledWith(`ees-${"a".repeat(36)}`));
    select("#school-code-cancel").click();
    expect(codeForm.hidden).toBe(true);
    expect(document.activeElement).toBe(picker);
  });

  it("guides password recovery to the email field and prefills emergency help", async () => {
    await mount();
    const email = select("#email");
    const forgot = select("#forgot-link");
    forgot.click();
    expect(document.activeElement).toBe(email);
    expect(select("#login-error").textContent).toContain("Enter a valid email");
    expect(mocks.reset).not.toHaveBeenCalled();
    email.value = "staff@example.test";
    forgot.click();
    await vi.waitFor(() => expect(mocks.reset).toHaveBeenCalledExactlyOnceWith("staff@example.test"));
    select("#emergency-support-link").click();
    expect(select("#em-email").value).toBe("staff@example.test");
  });

  it("keeps the password toggle and Remember me sign-in behavior", async () => {
    await mount();
    select("#email").value = "staff@example.test";
    const password = select("#password");
    password.value = "synthetic-password";
    const toggle = select(".field__toggle");
    toggle.click();
    expect(password.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("Hide password");
    toggle.click();
    expect(password.type).toBe("password");
    select("#remember-me").checked = true;
    const form = select("#login-form");
    form.requestSubmit(form.querySelector('[type="submit"]'));
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/dashboard"));
    expect(mocks.persistence).toHaveBeenCalledWith({}, "local");
    expect(mocks.login).toHaveBeenCalledExactlyOnceWith("staff@example.test", "synthetic-password");
  });
});
