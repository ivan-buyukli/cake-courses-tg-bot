import { InlineKeyboard } from "grammy";
import type { UserRecord, Identity } from "../../models/course.js";
import { t, languageName, type Locale, type TextKey } from "../i18n.js";
import { formatDateTime } from "../../utils/dateTime.js";

export function displayName(identity: Identity, locale: Locale): string {
  return (
    [identity.firstName, identity.lastName]
      .filter(Boolean)
      .join(" ")
      .replace(/[\r\n\t]/g, " ")
      .slice(0, 100) || t(locale, "noName")
  );
}

export function userProgress(user: UserRecord, locale: Locale): string {
  if (!user.is_admin && !user.purchase_suppressed && user.sequence_progress) {
    const progress = JSON.parse(user.sequence_progress) as {
      title: string;
      step: number;
      total: number;
      state: string;
      delivery: string | null;
    };
    const status: TextKey = user.opted_out
      ? "optedOut"
      : progress.state === "completed"
        ? "sequenceCompleted"
        : progress.state === "cancelled"
          ? "cancelled"
          : progress.delivery === "unknown"
            ? "deliveryUnknown"
            : progress.delivery === "failed"
              ? "deliveryFailed"
              : "pending";
    return `${progress.title}: ${Math.min(progress.step + (progress.state === "active" ? 1 : 0), progress.total)}/${progress.total} | ${t(locale, status)}`;
  }
  const key: TextKey = user.is_admin
    ? "admin"
    : user.purchase_suppressed
      ? "paid"
      : user.opted_out
        ? "optedOut"
        : user.started_at
          ? "waiting"
          : "notStarted";
  return t(locale, key);
}

export function usersReport(
  entries: { user: UserRecord; identity: Identity }[],
  locale: Locale,
  timeZone?: string,
): string {
  const headers = [
    "name",
    "username",
    "language",
    "sequence",
    "availability",
    "payment",
    "firstSeen",
    "lastSeen",
  ] as const;
  const rows = [
    headers.map((key) => t(locale, key)),
    ...entries.map(({ user, identity }) => [
      displayName(identity, locale),
      identity.username ? `@${identity.username}` : "-",
      languageName(user.locale),
      userProgress(user, locale),
      t(locale, user.blocked ? "blocked" : "reachable"),
      t(locale, user.payment_status),
      formatDateTime(user.first_seen_at, locale, timeZone),
      formatDateTime(user.last_seen_at, locale, timeZone),
    ]),
  ].map((row) => row.map((cell) => cell.replace(/[\r\n\t|]/g, " ")));
  const widths = headers.map((_, column) =>
    rows.reduce(
      (width, row) => Math.max(width, Array.from(row[column]!).length),
      0,
    ),
  );
  const line = (row: string[]) =>
    row
      .map(
        (cell, column) =>
          cell + " ".repeat(widths[column]! - Array.from(cell).length),
      )
      .join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  return [
    t(locale, "users"),
    "",
    line(rows[0]!),
    separator,
    ...rows.slice(1).map(line),
    ...(entries.length ? [] : [t(locale, "noUsers")]),
    "",
  ].join("\n");
}

export function usersReportKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "all"), "users:all:0")
    .text(t(locale, "blocked"), "users:blocked:0")
    .row()
    .text(t(locale, "optedOut"), "users:stopped:0")
    .text(t(locale, "paid"), "users:paid:0")
    .row()
    .text(t(locale, "back"), "nav:admin");
}
