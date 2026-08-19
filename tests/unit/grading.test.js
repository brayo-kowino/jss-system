import { describe, it, expect } from "vitest";
import {
  gradeFor,
  reportModeLabel,
  positionScopeLabel,
  positionScopeTag,
  resultId,
  pickHeadlineResult,
} from "../../js/services/grading.service.js";
import { DEFAULT_GRADING_SCALE } from "../../js/services/settings.service.js";

describe("CBC Grading Engine & Position Calculations", () => {
  describe("gradeFor() score band mapping", () => {
    it("correctly evaluates maximum scores and high distinction (EE1)", () => {
      const result = gradeFor(95, DEFAULT_GRADING_SCALE);
      expect(result).not.toBeNull();
      expect(result.grade).toBe("EE1");
      expect(result.points).toBeGreaterThanOrEqual(7);
    });

    it("evaluates decimal scores accurately without falling into gap between integer bands", () => {
      // 69.61 falls between 69 and 70 if integer bounds are improperly coded
      const result = gradeFor(69.61, DEFAULT_GRADING_SCALE);
      expect(result).not.toBeNull();
      expect(["ME1", "ME2", "EE2"]).toContain(result.grade);
    });

    it("evaluates borderline scores at exact band thresholds", () => {
      const minEE1 = DEFAULT_GRADING_SCALE.find((b) => b.grade === "EE1")?.min || 90;
      const result = gradeFor(minEE1, DEFAULT_GRADING_SCALE);
      expect(result.grade).toBe("EE1");
    });

    it("returns lowest grade for scores below all passing bands", () => {
      const result = gradeFor(10, DEFAULT_GRADING_SCALE);
      expect(result).not.toBeNull();
      expect(["BE1", "BE2", "BE"]).toContain(result.grade);
    });

    it("handles null, undefined, and NaN values safely", () => {
      expect(gradeFor(null, DEFAULT_GRADING_SCALE)).toBeNull();
      expect(gradeFor(undefined, DEFAULT_GRADING_SCALE)).toBeNull();
      expect(gradeFor(NaN, DEFAULT_GRADING_SCALE)).toBeNull();
    });
  });

  describe("reportModeLabel() formatting", () => {
    it("returns standard official strings for modes", () => {
      expect(reportModeLabel("midterm")).toBe("MIDTERM");
      expect(reportModeLabel("endterm")).toBe("ENDTERM");
      expect(reportModeLabel("average")).toBe("ENDTERM AVG");
    });
  });

  describe("positionScopeLabel() & positionScopeTag()", () => {
    it("returns correct labels for class vs overall position", () => {
      expect(positionScopeLabel(true)).toBe("Class Position");
      expect(positionScopeLabel(false)).toBe("Overall Position");
      expect(positionScopeTag(true)).toBe("Class");
      expect(positionScopeTag(false)).toBe("Overall");
    });
  });

  describe("pickHeadlineResult() selection logic", () => {
    it("selects the latest term and prioritizes 'average' reportMode", () => {
      const results = [
        { academicYear: "2026", term: "Term 1", reportMode: "midterm", meanMarks: 70 },
        { academicYear: "2026", term: "Term 1", reportMode: "average", meanMarks: 75 },
        { academicYear: "2025", term: "Term 3", reportMode: "average", meanMarks: 80 },
      ];
      const headline = pickHeadlineResult(results);
      expect(headline).not.toBeNull();
      expect(headline.academicYear).toBe("2026");
      expect(headline.term).toBe("Term 1");
      expect(headline.reportMode).toBe("average");
      expect(headline.meanMarks).toBe(75);
    });

    it("returns null for empty or null array", () => {
      expect(pickHeadlineResult([])).toBeNull();
      expect(pickHeadlineResult(null)).toBeNull();
    });
  });
});
