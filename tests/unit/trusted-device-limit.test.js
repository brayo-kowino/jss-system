import { describe, expect, it } from "vitest";
import { TRUSTED_DEVICE_LIMIT, shouldBlockNewDevice } from "../../js/services/trusted-device-limit.js";

describe("Trusted Device Limit", () => {
  it("allows registration below the five-device limit", () => {
    expect(shouldBlockNewDevice(4, false, TRUSTED_DEVICE_LIMIT)).toBe(false);
  });

  it("blocks a new device at the five-device limit", () => {
    expect(shouldBlockNewDevice(5, false, TRUSTED_DEVICE_LIMIT)).toBe(true);
  });

  it("allows an already-trusted device even at the limit", () => {
    expect(shouldBlockNewDevice(5, true, TRUSTED_DEVICE_LIMIT)).toBe(false);
  });

  it("defaults to a limit of five devices", () => {
    expect(TRUSTED_DEVICE_LIMIT).toBe(5);
  });
});
