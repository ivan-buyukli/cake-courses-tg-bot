import type {
  BillingCycle,
  BillingInterval,
  Subscription,
} from "../models/subscription.js";
import { ValidationError } from "./errors.js";

export const STANDARD_BILLING_CYCLES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
] as const satisfies readonly BillingCycle[];

export interface ParsedBillingCycle {
  billingCycle: BillingCycle;
  billingInterval?: BillingInterval;
}

const INTERVAL_LIMITS: Record<BillingInterval["unit"], number> = {
  day: 366,
  week: 52,
  month: 120,
  year: 30,
};

const UNIT_LABELS: Record<BillingInterval["unit"], string> = {
  day: "days",
  week: "weeks",
  month: "months",
  year: "years",
};

const ENGLISH_UNITS: Record<string, BillingInterval["unit"] | undefined> = {
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  week: "week",
  weeks: "week",
  m: "month",
  month: "month",
  months: "month",
  y: "year",
  year: "year",
  years: "year",
};

const CHINESE_UNITS: Record<string, BillingInterval["unit"] | undefined> = {
  天: "day",
  日: "day",
  周: "week",
  週: "week",
  星期: "week",
  月: "month",
  年: "year",
};

export function parseBillingCycleText(input: string): ParsedBillingCycle {
  const trimmed = input.trim();
  if (STANDARD_BILLING_CYCLES.some((cycle) => cycle === trimmed)) {
    return { billingCycle: trimmed as BillingCycle };
  }

  const interval = parseBillingInterval(trimmed);
  if (interval) {
    return { billingCycle: "interval", billingInterval: interval };
  }

  throw new ValidationError(
    `Invalid billing cycle: “${input}”. Valid values: ${STANDARD_BILLING_CYCLES.join(
      ", ",
    )}, or every 30 days, 30d, 4w, 6m, or 2y.`,
  );
}

export function parseBillingInterval(input: string): BillingInterval | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");

  const compactEnglish = normalized.match(/^(\d+)(d|w|m|y)$/);
  if (compactEnglish) {
    return validateBillingInterval(
      Number(compactEnglish[1]),
      ENGLISH_UNITS[compactEnglish[2]],
      input,
    );
  }

  const english = normalized.match(
    /^(?:every\s+)?(\d+)\s+(days?|weeks?|months?|years?)$/,
  );
  if (english) {
    return validateBillingInterval(
      Number(english[1]),
      ENGLISH_UNITS[english[2]],
      input,
    );
  }

  const chinese = input
    .trim()
    .match(/^每\s*(\d+)\s*(?:个\s*)?(天|日|周|週|星期|月|年)$/);
  if (chinese) {
    return validateBillingInterval(
      Number(chinese[1]),
      CHINESE_UNITS[chinese[2]],
      input,
    );
  }

  return null;
}

export function validateBillingInterval(
  count: number,
  unit: BillingInterval["unit"] | undefined,
  input: string,
): BillingInterval {
  if (!unit) {
    throw new ValidationError(
      `Invalid billing cycle: “${input}”. Use days, weeks, months, or years, such as 30d, 4w, 6m, or 2y.`,
    );
  }

  const max = INTERVAL_LIMITS[unit];
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new ValidationError(
      `${UNIT_LABELS[unit]} interval is invalid: “${input}”. Enter a value from 1 to ${max} ${UNIT_LABELS[unit]}.`,
    );
  }

  return { unit, count };
}

export function formatBillingCycleValue(
  billingCycle: BillingCycle,
  billingInterval?: BillingInterval,
): string {
  if (billingCycle === "interval" && billingInterval) {
    const unit =
      billingInterval.count === 1
        ? billingInterval.unit
        : UNIT_LABELS[billingInterval.unit];
    return `Every ${billingInterval.count} ${unit}`;
  }

  const labels: Record<Exclude<BillingCycle, "interval">, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
    custom: "Custom",
  };

  return billingCycle === "interval" ? "Custom interval" : labels[billingCycle];
}

export function formatSubscriptionBillingCycle(sub: Subscription): string {
  return formatBillingCycleValue(sub.billingCycle, sub.billingInterval);
}
