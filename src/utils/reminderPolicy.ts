import type { Subscription } from "../models/subscription.js";

export const PROJECT_REMINDER_MAX_DAYS_BEFORE = 1;

export function formatReminderPolicy(sub: Subscription): string {
  if (sub.reminderPolicy?.mode === "once") {
    return "Remind once, 1 day before";
  }
  return "Use default settings";
}

export function getReminderStartDaysBefore(
  sub: Subscription,
  defaultDaysAhead: number,
): number {
  return sub.reminderPolicy?.mode === "once"
    ? sub.reminderPolicy.daysBefore
    : defaultDaysAhead;
}

export function shouldSendReminderOnDate(
  sub: Subscription,
  localDate: string,
  reminderStart: string,
): boolean {
  return sub.reminderPolicy?.mode !== "once" || localDate === reminderStart;
}
