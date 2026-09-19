import { describe, it, expect } from "vitest";
import {
  validateEditName,
  validateEditPrice,
} from "../src/bot/conversations/editFieldConversation.js";
import { validateDateInput } from "../src/bot/conversations/dateInput.js";
import { validateCurrencyCode } from "../src/utils/currency.js";

describe("editFieldConversation validators", () => {
  describe("validateEditName", () => {
    it("accepts a valid name", () => {
      expect(validateEditName("Netflix")).toBeNull();
    });
    it("rejects empty names", () => {
      expect(validateEditName("")).toBe("Subscription name cannot be empty.");
      expect(validateEditName("   ")).toBe(
        "Subscription name cannot be empty.",
      );
    });
  });

  describe("validateEditPrice", () => {
    it("accepts valid numbers", () => {
      const result = validateEditPrice("12.99");
      expect(result.price).toBe(12.99);
      expect(result.error).toBeUndefined();
    });
    it("accepts zero", () => {
      const result = validateEditPrice("0");
      expect(result.price).toBe(0);
      expect(result.error).toBeUndefined();
    });
    it("rejects negative numbers", () => {
      const result = validateEditPrice("-1");
      expect(result.error).toBe("Enter a non-negative number.");
    });
    it("rejects non-numeric input", () => {
      const result = validateEditPrice("abc");
      expect(result.error).toBe("Enter a non-negative number.");
    });
  });

  describe("validateEditCurrency", () => {
    it("accepts valid 3-letter codes", () => {
      const result = validateCurrencyCode("EUR");
      expect(result.currency).toBe("EUR");
      expect(result.error).toBeUndefined();
    });
    it("rejects invalid codes", () => {
      const result = validateCurrencyCode("EURO");
      expect(result.error).toBe(
        "Enter a 3-letter currency code, such as CNY or USD.",
      );
    });
    it("converts to uppercase", () => {
      const result = validateCurrencyCode("eur");
      expect(result.currency).toBe("EUR");
    });
  });

  describe("validateEditDate", () => {
    it("accepts valid YYYY-MM-DD", () => {
      const result = validateDateInput("2026-06-01");
      expect(result.date).toBe("2026-06-01");
      expect(result.error).toBeUndefined();
    });
    it("rejects invalid format", () => {
      const result = validateDateInput("not a date");
      expect(result.error).toBeDefined();
    });
    it("rejects invalid date", () => {
      const result = validateDateInput("2026-13-01");
      expect(result.error).toBeDefined();
    });
    it("rejects impossible calendar dates", () => {
      const result = validateDateInput("2026-02-31");
      expect(result.error).toBeDefined();
    });
    it("accepts Chinese date format", () => {
      const result = validateDateInput("2026年6月1日");
      expect(result.date).toBe("2026-06-01");
      expect(result.error).toBeUndefined();
    });
    it("accepts slash format", () => {
      const result = validateDateInput("2026/06/01");
      expect(result.date).toBe("2026-06-01");
      expect(result.error).toBeUndefined();
    });
  });
});
