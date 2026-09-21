import { localizedVariant, type CampaignStep } from "../../models/campaign.js";
import { t, type Locale } from "../i18n.js";

export function stepName(step: CampaignStep, locale: Locale): string {
  return (
    step.name ??
    ((
      localizedVariant(step.variants, locale)?.text ??
      Object.values(step.variants).find((variant) => variant?.text.trim())?.text
    )
      ?.trim()
      .split(/\r?\n/)[0]
      ?.slice(0, 100) ||
      t(locale, "legacyMessage"))
  );
}
export function stepTiming(step: CampaignStep, locale: Locale): string {
  if (!step.calendar) return String(step.offsetMinutes);
  const { days, time, timeZone, anchor } = step.calendar;
  return `${t(locale, "dayOffset")}: ${days}\n${t(locale, anchor === "start" ? "campaignStart" : "previousMessage")}\n${time} (${timeZone})`;
}
