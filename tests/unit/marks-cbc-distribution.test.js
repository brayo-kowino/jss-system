import { describe, it, expect } from "vitest";
import { getCbcLevel } from "../../views/marks.js";

describe("CBC Performance Level & Marks Distribution", () => {
  it("accurately classifies scores into standard 4-tier CBC levels", () => {
    const maxScore = 50;

    // EE: >= 80% (score >= 40 / 50)
    const eeHigh = getCbcLevel(50, maxScore);
    expect(eeHigh).toEqual({
      level: "EE",
      label: "Exceeding Expectations",
      badgeClass: "badge--cbc-ee",
    });

    const eeBoundary = getCbcLevel(40, maxScore);
    expect(eeBoundary.level).toBe("EE");

    // ME: 65% - 79.9% (score 32.5 - 39.5 / 50)
    const meHigh = getCbcLevel(39.5, maxScore);
    expect(meHigh).toEqual({
      level: "ME",
      label: "Meeting Expectations",
      badgeClass: "badge--cbc-me",
    });

    const meBoundary = getCbcLevel(32.5, maxScore);
    expect(meBoundary.level).toBe("ME");

    // AE: 50% - 64.9% (score 25 - 32 / 50)
    const aeScore = getCbcLevel(27.5, maxScore);
    expect(aeScore).toEqual({
      level: "AE",
      label: "Approaching Expectations",
      badgeClass: "badge--cbc-ae",
    });

    // BE: 0% - 49.9% (score 0 - 24.5 / 50)
    const beScore = getCbcLevel(18, maxScore);
    expect(beScore).toEqual({
      level: "BE",
      label: "Below Expectations",
      badgeClass: "badge--cbc-be",
    });

    const beZero = getCbcLevel(0, maxScore);
    expect(beZero.level).toBe("BE");
  });

  it("handles out of range or negative scores with Invalid level flag", () => {
    const maxScore = 100;

    // Over maximum score
    const overMax = getCbcLevel(105, maxScore);
    expect(overMax).toEqual({
      level: "INV",
      label: "Invalid",
      badgeClass: "badge--danger",
    });

    // Negative score
    const negative = getCbcLevel(-5, maxScore);
    expect(negative).toEqual({
      level: "INV",
      label: "Invalid",
      badgeClass: "badge--danger",
    });
  });

  it("returns null for empty, null, or non-numeric inputs", () => {
    expect(getCbcLevel("", 50)).toBeNull();
    expect(getCbcLevel(null, 50)).toBeNull();
    expect(getCbcLevel(undefined, 50)).toBeNull();
    expect(getCbcLevel("abc", 50)).toBeNull();
  });

  it("calculates accurate CBC percentage for direct score scale (out of 100)", () => {
    const max100 = 100;
    expect(getCbcLevel(85, max100).level).toBe("EE");
    expect(getCbcLevel(72, max100).level).toBe("ME");
    expect(getCbcLevel(55, max100).level).toBe("AE");
    expect(getCbcLevel(35, max100).level).toBe("BE");
  });
});
