import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCurrentVersion,
  isAppOutdated,
  fetchServerVersion,
  forceHardRefresh,
  checkVersionAtBoot,
} from "../../js/services/version.service.js";

describe("Version Service", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns current build metadata", () => {
    const meta = getCurrentVersion();
    expect(meta).toBeDefined();
    expect(typeof meta.version).toBe("string");
    expect(typeof meta.buildId).toBe("string");
  });

  it("accurately detects when app is outdated", () => {
    const meta = getCurrentVersion();
    // Identical buildId should not be outdated
    expect(isAppOutdated({ buildId: meta.buildId })).toBe(false);

    // Different buildId should be outdated
    expect(isAppOutdated({ buildId: "newer-build-999" })).toBe(true);

    // Missing or invalid remote metadata should not trigger outdated
    expect(isAppOutdated(null)).toBe(false);
    expect(isAppOutdated({})).toBe(false);
    expect(isAppOutdated({ buildId: "" })).toBe(false);
    expect(isAppOutdated({ buildId: 123 })).toBe(false);
  });

  it("fetches server version bypassing caches", async () => {
    const mockVersion = { version: "1.0.0", buildId: "server-build-123" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockVersion,
    });

    const result = await fetchServerVersion();
    expect(result).toEqual(mockVersion);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toContain("/version.json?_t=");
    expect(callArgs[1].cache).toBe("no-store");
  });

  it("handles network failure or 404 gracefully without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchServerVersion();
    expect(result).toBeNull();
  });

  it("handles offline navigator without fetching", async () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    global.fetch = vi.fn();
    const result = await fetchServerVersion();
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
  });

  it("clears caches and triggers reload on forceHardRefresh", async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    window.caches = {
      keys: vi.fn().mockResolvedValue(["cache-v1", "cache-v2"]),
      delete: mockDelete,
    };

    const replaceSpy = vi.fn();
    delete window.location;
    window.location = {
      href: "https://eeskia.iskify360.tech/app/#/login",
      replace: replaceSpy,
      reload: vi.fn(),
    };

    const refreshed = await forceHardRefresh({ reason: "test", targetVersion: "v2" });
    expect(refreshed).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith("cache-v1");
    expect(mockDelete).toHaveBeenCalledWith("cache-v2");
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0][0]).toContain("_v=");
  });

  it("prevents infinite reload loops when attempts exceed maximum", async () => {
    delete window.location;
    window.location = {
      href: "https://eeskia.iskify360.tech/app/",
      replace: vi.fn(),
      reload: vi.fn(),
    };

    const targetVersion = "stuck-version-1";

    // First attempt -> succeeds
    const first = await forceHardRefresh({ reason: "test", targetVersion });
    expect(first).toBe(true);

    // Second attempt -> succeeds
    const second = await forceHardRefresh({ reason: "test", targetVersion });
    expect(second).toBe(true);

    // Third attempt within 30s -> blocked by loop guard
    const third = await forceHardRefresh({ reason: "test", targetVersion });
    expect(third).toBe(false);
  });

  it("checks version at boot and triggers hard refresh when outdated", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.0", buildId: "new-server-build" }),
    });

    delete window.location;
    window.location = {
      href: "https://eeskia.iskify360.tech/app/",
      replace: vi.fn(),
      reload: vi.fn(),
    };

    const shouldAbortBoot = await checkVersionAtBoot();
    expect(shouldAbortBoot).toBe(true);
  });
});
