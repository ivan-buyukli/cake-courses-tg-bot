import { Temporal } from "@js-temporal/polyfill";
import { InlineKeyboard } from "grammy";
import { isoLanguageCode, t, type Locale } from "../i18n.js";

export function localToday(timeZone: string, now = Date.now()): string {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

export function scheduleCalendar(
  month: string,
  timeZone: string,
  locale: Locale,
  action: (name: string, value?: string) => string,
  options?: { selectedDate?: string; footer?: boolean },
): InlineKeyboard {
  const date = Temporal.PlainDate.from(`${month}-01`);
  const today = localToday(timeZone);
  const kb = new InlineKeyboard();
  for (const delta of [-12, -1, 1, 12]) {
    kb.text(
      delta === -12 ? "<<" : delta === -1 ? "<" : delta === 1 ? ">" : ">>",
      action("month", date.add({ months: delta }).toString().slice(0, 7)),
    );
  }
  kb.row();
  const monday = Temporal.PlainDate.from("2026-09-21");
  for (let i = 0; i < 7; i++)
    kb.text(
      monday
        .add({ days: i })
        .toLocaleString(isoLanguageCode(locale), { weekday: "short" }),
      action("noop"),
    );
  kb.row();
  const cells = Math.ceil((date.dayOfWeek - 1 + date.daysInMonth) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const day = i - date.dayOfWeek + 2;
    if (day < 1 || day > date.daysInMonth) kb.text(" ", action("noop"));
    else {
      const value = date.with({ day }).toString();
      kb.text(
        value === options?.selectedDate ? `[${day}]` : String(day),
        value < today ? action("noop") : action("day", value),
      );
    }
    if ((i + 1) % 7 === 0) kb.row();
  }
  if (options?.footer === false) return kb;
  return kb
    .text(t(locale, "today"), action("day", today))
    .row()
    .text(t(locale, "back"), action("resume"))
    .text(t(locale, "cancel"), action("discard"));
}

export const clockChanges = {
  hp: 60,
  hm: -60,
  mp: 5,
  mm: -5,
  fp: 1,
  fm: -1,
} as const;
export type ClockChange = keyof typeof clockChanges;
export function adjustClock(
  hour: number,
  minute: number,
  change: ClockChange,
): { hour: number; minute: number } {
  const total = (hour * 60 + minute + clockChanges[change] + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}
export function clockControls(
  kb: InlineKeyboard,
  locale: Locale,
  hour: number,
  minute: number,
  action: (change: ClockChange | "noop") => string,
): InlineKeyboard {
  return kb
    .row()
    .text("-", action("hm"))
    .text(
      `${t(locale, "hour")}: ${String(hour).padStart(2, "0")}`,
      action("noop"),
    )
    .text("+", action("hp"))
    .row()
    .text("-5", action("mm"))
    .text("-1", action("fm"))
    .text(
      `${t(locale, "minute")}: ${String(minute).padStart(2, "0")}`,
      action("noop"),
    )
    .text("+1", action("fp"))
    .text("+5", action("mp"));
}

export function timeKeyboard(
  count: number,
  name: string,
  action: (name: string, value?: string) => string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < count; i++) {
    kb.text(String(i).padStart(2, "0"), action(name, String(i)));
    if ((i + 1) % 6 === 0) kb.row();
  }
  return kb;
}

// Keep both occurrences of a repeated autumn time; never shift a nonexistent spring time.
export function localTimeCandidates(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): number[] {
  const plain = Temporal.PlainDate.from(date).toPlainDateTime({ hour, minute });
  return [
    ...new Set(
      (["earlier", "later"] as const).flatMap((disambiguation) => {
        const zoned = plain.toZonedDateTime(timeZone, { disambiguation });
        return zoned.toPlainDateTime().equals(plain)
          ? [zoned.epochMilliseconds]
          : [];
      }),
    ),
  ];
}

export function calendarMonthLabel(month: string, locale: Locale): string {
  return Temporal.PlainDate.from(`${month}-01`).toLocaleString(
    isoLanguageCode(locale),
    {
      month: "long",
      year: "numeric",
    },
  );
}

export function calendarDateLabel(date: string, locale: Locale): string {
  return Temporal.PlainDate.from(date).toLocaleString(isoLanguageCode(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
