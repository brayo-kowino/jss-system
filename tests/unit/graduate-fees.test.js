import { describe, expect, it } from "vitest";
import { buildGraduateFeeHistory } from "../../js/services/graduate-fees.js";

const terms = ["Term 1", "Term 2", "Term 3"];
const charge = (academicYear, term, expected, paid = 0) =>
  ({ academicYear, term, grade: "Grade 9", expected, paid });

describe("Graduate fee history", () => {
  it("keeps the captured exit charge, records later receipts against it, and excludes future terms", () => {
    const history = buildGraduateFeeHistory({
      graduation: { year: "2026", term: "Term 2", grade: "Grade 9", stream: "Blue", feeExpected: 9000 },
      summaries: [charge("2026", "Term 1", 7000, 7000), charge("2026", "Term 2", 15000), charge("2026", "Term 3", 15000), charge("2027", "Term 1", 15000)],
      payments: [{ academicYear: "2026", term: "Term 2", grade: "Grade 8", amount: 2500, date: "2027-02-01" }],
      reports: [], terms,
    });
    expect(history.rows.map(({ term, expected, paid, balance }) => [term, expected, paid, balance]))
      .toEqual([["Term 2", 9000, 2500, 6500], ["Term 1", 7000, 7000, 0]]);
    expect(history.totalBalance).toBe(6500);
    expect(history.payments).toHaveLength(1);
  });

  it("does not guess an exit term or treat unverified legacy charges as debt", () => {
    const history = buildGraduateFeeHistory({
      graduation: { year: "2026", date: new Date("2026-08-01T00:00:00Z") },
      summaries: [charge("2026", "Term 1", 5000), charge("2026", "Term 2", 9000), charge("2026", "Term 3", 15000), charge("2027", "Term 1", 15000)],
      payments: [{ academicYear: "2026", term: "Term 2", amount: 2500, date: "2026-07-04" }],
      reports: [{ academicYear: "2026", term: "Term 1" }], terms,
    });
    expect(history.rows.map(({ term, needsReview }) => [term, needsReview]))
      .toEqual([["Term 3", true], ["Term 2", false], ["Term 1", false]]);
    expect(history.totalBalance).toBe(11500);
    expect(history.hasUnverifiedBalance).toBe(true);
  });

  it("keeps receipts when there is no recorded fee charge", () => {
    const payment = { academicYear: "2026", term: "Term 2", amount: 3000 };
    expect(buildGraduateFeeHistory({
      graduation: { year: "2026", term: "Term 2", grade: "Grade 9", feeExpected: null },
      summaries: [], payments: [payment], reports: [], terms,
    })).toEqual({ rows: [], payments: [payment], totalBalance: 0, hasUnverifiedBalance: false });
  });
});
