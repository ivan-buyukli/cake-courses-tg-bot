import { describe, it, expect } from "vitest";
import { parseFlexibleDate } from "../../src/utils/parseDate.js";

const ERROR_MESSAGE = "Invalid date. Use YYYY-MM-DD, YYYY/MM/DD, or YYYY.M.D.";

describe("parseFlexibleDate", () => {
  describe("YYYY-MM-DD (ISO)", () => {
    it("accepts a valid date", () => {
      expect(parseFlexibleDate("2026-06-01")).toEqual({
        date: "2026-06-01",
      });
      expect(parseFlexibleDate("2026-01-01")).toEqual({
        date: "2026-01-01",
      });
    });

    it("rejects invalid month", () => {
      expect(parseFlexibleDate("2026-13-01")).toEqual({
        error: ERROR_MESSAGE,
      });
    });

    it("rejects impossible calendar dates", () => {
      expect(parseFlexibleDate("2026-02-31")).toEqual({
        error: ERROR_MESSAGE,
      });
    });

    it("rejects non-date input", () => {
      expect(parseFlexibleDate("not a date")).toEqual({
        error: ERROR_MESSAGE,
      });
    });

    it("rejects empty string", () => {
      expect(parseFlexibleDate("").error).toBe(ERROR_MESSAGE);
    });

    it("handles whitespace around valid date", () => {
      expect(parseFlexibleDate("  2026-06-01  ")).toEqual({
        date: "2026-06-01",
      });
    });

    it("accepts without leading zeros", () => {
      expect(parseFlexibleDate("2026-6-1")).toEqual({
        date: "2026-06-01",
      });
      expect(parseFlexibleDate("2026-6-01")).toEqual({
        date: "2026-06-01",
      });
      expect(parseFlexibleDate("2026-06-1")).toEqual({
        date: "2026-06-01",
      });
    });
  });

  describe("YYYY/MM/DD (slash)", () => {
    it("accepts a valid date", () => {
      expect(parseFlexibleDate("2026/06/01")).toEqual({
        date: "2026-06-01",
      });
    });

    it("accepts without leading zeros", () => {
      expect(parseFlexibleDate("2026/6/1")).toEqual({
        date: "2026-06-01",
      });
    });

    it("rejects impossible dates", () => {
      expect(parseFlexibleDate("2026/02/31")).toEqual({
        error: ERROR_MESSAGE,
      });
    });
  });

  describe("YYYY.MM.DD (dot)", () => {
    it("accepts a valid date", () => {
      expect(parseFlexibleDate("2026.06.01")).toEqual({
        date: "2026-06-01",
      });
    });

    it("accepts without leading zeros", () => {
      expect(parseFlexibleDate("2026.1.2")).toEqual({
        date: "2026-01-02",
      });
      expect(parseFlexibleDate("2026.1.02")).toEqual({
        date: "2026-01-02",
      });
      expect(parseFlexibleDate("2026.01.2")).toEqual({
        date: "2026-01-02",
      });
    });
  });

  describe("DD/MM/YYYY", () => {
    it("accepts a valid date", () => {
      expect(parseFlexibleDate("01/06/2026")).toEqual({
        date: "2026-06-01",
      });
    });
  });

  describe("MM/DD/YYYY", () => {
    it("accepts a valid date where day > 12", () => {
      // 06/13/2026 → month=06, day=13 → only valid as MM/DD/YYYY
      // (DD/MM/YYYY would give month=13 which is invalid)
      expect(parseFlexibleDate("06/13/2026")).toEqual({
        date: "2026-06-13",
      });
    });
  });

  describe("Chinese format: YYYY年MM月DD日", () => {
    it("accepts full Chinese date", () => {
      expect(parseFlexibleDate("2026年06月01日")).toEqual({
        date: "2026-06-01",
      });
    });

    it("accepts Chinese date without leading zeros", () => {
      expect(parseFlexibleDate("2026年6月1日")).toEqual({
        date: "2026-06-01",
      });
    });

    it("accepts mixed leading zeros", () => {
      expect(parseFlexibleDate("2026年06月1日")).toEqual({
        date: "2026-06-01",
      });
      expect(parseFlexibleDate("2026年6月01日")).toEqual({
        date: "2026-06-01",
      });
    });

    it("rejects impossible Chinese date", () => {
      expect(parseFlexibleDate("2026年2月31日")).toEqual({
        error: ERROR_MESSAGE,
      });
    });
  });

  describe("first-match priority", () => {
    it("parses ambiguous 01/02/2026 as DD/MM/YYYY (first match)", () => {
      // DD/MM/YYYY comes before MM/DD/YYYY in the supported formats list
      const result = parseFlexibleDate("01/02/2026");
      expect(result.date).toBe("2026-02-01");
    });
  });
});
