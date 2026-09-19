import { describe, it, expect } from "vitest";
import {
  COMMON_CURRENCIES,
  currencyKeyboard,
  validateCurrencyInput,
  validateCurrencyCode,
} from "../../src/utils/currency.js";

describe("currency utils", () => {
  describe("COMMON_CURRENCIES", () => {
    it("contains 8 common currencies", () => {
      expect(COMMON_CURRENCIES.length).toBe(8);
      expect(COMMON_CURRENCIES).toContain("CNY");
      expect(COMMON_CURRENCIES).toContain("USD");
      expect(COMMON_CURRENCIES).toContain("EUR");
    });
  });

  describe("validateCurrencyInput", () => {
    it("accepts skip when no price", () => {
      const result = validateCurrencyInput("skip", false);
      expect(result.currency).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("requires currency when price exists", () => {
      const result = validateCurrencyInput("skip", true);
      expect(result.error).toBe("A currency is required when a price is set.");
    });

    it("accepts valid 3-letter codes", () => {
      const result = validateCurrencyInput("EUR", true);
      expect(result.currency).toBe("EUR");
      expect(result.error).toBeUndefined();
    });

    it("rejects invalid codes", () => {
      const result = validateCurrencyInput("EURO", true);
      expect(result.error).toBe(
        "Enter a 3-letter currency code, such as CNY or USD.",
      );
    });

    it("uppercases lowercase input", () => {
      const result = validateCurrencyInput("cny", false);
      expect(result.currency).toBe("CNY");
    });
  });

  describe("validateCurrencyCode", () => {
    it("accepts valid 3-letter codes", () => {
      const result = validateCurrencyCode("EUR");
      expect(result.currency).toBe("EUR");
      expect(result.error).toBeUndefined();
    });

    it("rejects codes that are not 3 letters", () => {
      const result = validateCurrencyCode("EURO");
      expect(result.currency).toBe("");
      expect(result.error).toBe(
        "Enter a 3-letter currency code, such as CNY or USD.",
      );
    });

    it("uppercases lowercase input", () => {
      const result = validateCurrencyCode("cny");
      expect(result.currency).toBe("CNY");
    });
  });

  describe("currencyKeyboard", () => {
    it("returns an inline keyboard", () => {
      const kb = currencyKeyboard(true);
      expect(kb).toBeDefined();
    });

    it("does not include skip button when hasPrice is true", () => {
      const kb = currencyKeyboard(true);
      const json = kb.inline_keyboard;
      const allTexts = json.flat().map((b) => b.text);
      expect(allTexts).not.toContain("Leave unset");
    });

    it("includes skip button when hasPrice is false", () => {
      const kb = currencyKeyboard(false);
      const json = kb.inline_keyboard;
      const allTexts = json.flat().map((b) => b.text);
      expect(allTexts).toContain("Leave unset");
    });
  });
});
