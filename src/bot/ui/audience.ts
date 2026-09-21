import { InlineKeyboard } from "grammy";
import { audiences, type Audience } from "../../models/audience.js";
import { t, type Locale, type TextKey } from "../i18n.js";

const labels: Record<Audience, TextKey> = {
  non_purchasers: "audienceNonPurchasers",
  unpaid: "audienceUnpaid",
  unknown: "audienceUnknown",
  pending: "audiencePending",
};
export function audienceLabel(
  locale: Locale,
  audience: Audience = "non_purchasers",
): string {
  return t(locale, labels[audience]);
}
export function audienceKeyboard(
  locale: Locale,
  selected: Audience | undefined,
  callback: (audience: Audience) => string,
  back: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const audience of audiences)
    kb.text(
      `${(selected ?? "non_purchasers") === audience ? "[x] " : ""}${audienceLabel(locale, audience)}`,
      callback(audience),
    ).row();
  return kb.text(t(locale, "back"), back);
}
