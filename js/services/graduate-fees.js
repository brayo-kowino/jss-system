const periodKey = ({ academicYear, term }) => JSON.stringify([String(academicYear), term]);

// null means the legacy record does not establish whether the term preceded graduation.
export function isGraduatePeriod(period, graduation, terms) {
  const year = String(period.academicYear || "");
  if (!year || !graduation.year || !period.term) return null;
  if (year !== graduation.year) {
    return /^\d{4}$/.test(year) && /^\d{4}$/.test(graduation.year) ? Number(year) < Number(graduation.year) : null;
  }
  if (!graduation.term) return null;
  if (period.term === graduation.term) return true;
  const periodIndex = terms.indexOf(period.term);
  const exitIndex = terms.indexOf(graduation.term);
  return periodIndex === -1 || exitIndex === -1 ? null : periodIndex < exitIndex;
}

export function buildGraduateFeeHistory({ graduation, summaries, payments, reports, terms }) {
  const evidence = new Set(reports.map(periodKey));
  const paidByPeriod = new Map();
  for (const payment of payments) {
    const key = periodKey(payment);
    const paid = Number(payment.amount) || 0;
    paidByPeriod.set(key, (paidByPeriod.get(key) || 0) + paid);
    const date = new Date(payment.date || "");
    if (graduation.date && date <= graduation.date) evidence.add(key);
  }

  const charges = new Map(summaries.filter((row) => row.academicYear && row.term).map((row) => [periodKey(row), row]));
  if (graduation.year && graduation.term && Number.isFinite(graduation.feeExpected)) {
    const exitPeriod = { academicYear: graduation.year, term: graduation.term, grade: graduation.grade, stream: graduation.stream };
    const key = periodKey(exitPeriod);
    const existing = charges.get(key);
    charges.set(key, { ...existing, ...exitPeriod, expected: graduation.feeExpected });
  }

  const rows = [];
  for (const [key, charge] of charges) {
    const beforeExit = isGraduatePeriod(charge, graduation, terms);
    if (beforeExit === false) continue;
    const expected = Math.max(Number(charge.expected) || 0, 0);
    const paid = Math.max(Number(charge.paid) || 0, paidByPeriod.get(key) || 0, 0);
    rows.push({ ...charge, expected, paid, balance: Math.max(expected - paid, 0), needsReview: beforeExit === null && !evidence.has(key) });
  }
  rows.sort((a, b) => String(b.academicYear).localeCompare(String(a.academicYear), undefined, { numeric: true }) ||
    terms.indexOf(b.term) - terms.indexOf(a.term) || b.term.localeCompare(a.term, undefined, { numeric: true }));
  return {
    rows, payments,
    totalBalance: rows.reduce((sum, row) => sum + (row.needsReview ? 0 : row.balance), 0),
    hasUnverifiedBalance: rows.some((row) => row.needsReview && row.balance > 0),
  };
}
