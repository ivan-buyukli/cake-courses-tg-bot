import { InlineKeyboard } from "grammy";

export const COMMON_CURRENCIES = [
  "CNY",
  "USD",
  "HKD",
  "TWD",
  "EUR",
  "JPY",
  "GBP",
  "SGD",
] as const;

export function currencyKeyboard(hasPrice: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  COMMON_CURRENCIES.forEach((currency, index) => {
    keyboard.text(currency, `addcurrency:${currency}`);
    if (index % 4 === 3) keyboard.row();
  });

  keyboard.text("Other", "addcurrency:other");
  if (!hasPrice) {
    keyboard.text("Leave unset", "addcurrency:skip");
  }
  keyboard.row().text("Cancel", "addcurrency:cancel");
  return keyboard;
}

export function validateCurrencyInput(
  currencyStr: string,
  hasPrice: boolean,
): { currency?: string; error?: string } {
  const trimmed = currencyStr.trim().toUpperCase();
  if (trimmed === "SKIP" || trimmed === "") {
    if (hasPrice) {
      return { error: "A currency is required when a price is set." };
    }
    return { currency: undefined };
  }
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    return {
      error: "Enter a 3-letter currency code, such as CNY or USD.",
    };
  }
  return { currency: trimmed };
}

export function validateCurrencyCode(currencyStr: string): {
  currency: string;
  error?: string;
} {
  const trimmed = currencyStr.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    return {
      currency: "",
      error: "Enter a 3-letter currency code, such as CNY or USD.",
    };
  }
  return { currency: trimmed };
}
