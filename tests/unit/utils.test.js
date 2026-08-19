import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeInput,
  scopedId,
  toDate,
  formatDate,
  formatDateTime,
} from "../../js/utils.js";

describe("Utils Security & Helper Functions", () => {
  describe("escapeHtml() - XSS Prevention", () => {
    it("escapes special characters that could enable HTML injection", () => {
      const input = '<script>alert("xss")</script>';
      const result = escapeHtml(input);
      expect(result).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    });

    it("escapes ampersands properly", () => {
      const input = "Tom & Jerry";
      expect(escapeHtml(input)).toBe("Tom &amp; Jerry");
    });

    it("handles null, undefined, and empty string inputs gracefully", () => {
      expect(escapeHtml("")).toBe("");
      expect(escapeHtml(null)).toBe("null");
      expect(escapeHtml(undefined)).toBe("");
    });
  });

  describe("sanitizeInput() - Defense-in-Depth Form Sanitizer", () => {
    it("strips HTML tags completely from input strings", () => {
      const dirty = "<b>Hello</b> <a href='javascript:void(0)'>Click</a>";
      const clean = sanitizeInput(dirty);
      expect(clean).toBe("Hello Click");
    });

    it("strips dangerous ASCII control characters while preserving valid formatting", () => {
      const withControlChars = "Hello\u0000World\u0007\tNew\nLine";
      const cleaned = sanitizeInput(withControlChars);
      expect(cleaned).toBe("HelloWorld\tNew\nLine");
    });

    it("enforces maximum string length limit", () => {
      const longString = "A".repeat(600);
      const capped = sanitizeInput(longString, { maxLength: 100 });
      expect(capped.length).toBe(100);
    });
  });

  describe("scopedId() - Multi-Tenant Composite Key Generator", () => {
    it("generates deterministic, double-underscore separated doc IDs", () => {
      const id = scopedId("school-123", "2026", "term-1", "grade-7");
      expect(id).toBe("school-123__2026__term-1__grade-7");
    });

    it("sanitizes forward and backward slashes to prevent Firestore subcollection path injection", () => {
      const malicious = scopedId("school/1", "term\\2/special");
      expect(malicious).toBe("school-1__term-2-special");
    });

    it("filters out undefined, null, and empty string components", () => {
      const cleaned = scopedId("school-1", null, "grade-8", undefined, "");
      expect(cleaned).toBe("school-1__grade-8");
    });
  });

  describe("toDate() & Date Formatting", () => {
    it("converts standard Date instances", () => {
      const now = new Date(2026, 7, 19, 15, 30);
      const d = toDate(now);
      expect(d).toBeInstanceOf(Date);
      expect(d.getTime()).toBe(now.getTime());
    });

    it("converts Firestore Timestamp objects with seconds & nanoseconds", () => {
      const ts = { seconds: 1787140800, nanoseconds: 500000000 };
      const d = toDate(ts);
      expect(d).toBeInstanceOf(Date);
      expect(d.getTime()).toBe(1787140800500);
    });

    it("converts Firestore SDK Timestamp instances having toDate() method", () => {
      const targetDate = new Date("2026-08-19T12:00:00Z");
      const mockTimestamp = { toDate: () => targetDate };
      expect(toDate(mockTimestamp)).toBe(targetDate);
    });

    it("returns null for invalid or null inputs", () => {
      expect(toDate(null)).toBeNull();
      expect(toDate(undefined)).toBeNull();
      expect(toDate("invalid-date-string")).toBeNull();
    });

    it("formats dates consistently", () => {
      const d = new Date("2026-08-19T10:30:00Z");
      const formatted = formatDate(d);
      expect(formatted).toMatch(/19.*Aug.*2026/i);
    });
  });
});
