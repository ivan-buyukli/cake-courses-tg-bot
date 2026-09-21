import { InlineKeyboard } from "grammy";
import { t, type Locale } from "../i18n.js";

export function navigationKeyboard(
  locale: Locale,
  admin = false,
): InlineKeyboard {
  return new InlineKeyboard().text(
    t(locale, "mainMenu"),
    admin ? "nav:admin" : "nav:menu",
  );
}
