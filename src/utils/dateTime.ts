import type { Locale } from "../bot/i18n.js";

export const DEFAULT_TIMEZONE = "Europe/Berlin";

export function formatDateTime(
  timestamp: number,
  locale: Locale,
  timeZone = DEFAULT_TIMEZONE,
  presentation: "standard" | "calendar" = "standard",
): string {
  const language = locale === "ua" ? "uk-UA" : "en-GB";
  // The calendar panel displays its timezone on a separate line.
  if (presentation === "calendar") {
    const date = new Intl.DateTimeFormat(language, {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(timestamp);
    const time = new Intl.DateTimeFormat(language, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(timestamp);
    return `${date}, ${time}`;
  }
  const date = new Intl.DateTimeFormat(language, {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
  return `${date} (${timeZone})`;
}
