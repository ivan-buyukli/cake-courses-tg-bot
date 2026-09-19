import { ValidationError } from "./errors.js";
import type { BillingCycle, BillingInterval } from "../models/subscription.js";
import { parseBillingCycleText } from "./billingCycle.js";

export interface ParsedAddArgs {
  name: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  billingInterval?: BillingInterval;
  nextBillingDate: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the arguments for the /add command.
 *
 * Expected format (single-word name for now):
 *   /add <name> <price> <currency> <cycle> <nextBillingDate>
 *
 * Example:
 *   /add Netflix 12.99 EUR monthly 2026-06-01
 *
 * TODO: Support quoted or multi-word names.
 */
export function parseAddArgs(args: string[]): ParsedAddArgs {
  // args[0] is the command itself (e.g. "/add"), so we need at least 6 elements
  if (args.length < 6) {
    throw new ValidationError(
      "Usage: /add <Name> <Price> <Currency> <Cycle> <Next billing date>\n" +
        "Example: /add Netflix 12.99 CNY monthly 2026-06-01",
    );
  }

  const name = args[1];
  const priceStr = args[2];
  const currency = args[3].toUpperCase();
  const nextBillingDate = args[args.length - 1];
  const cycleText = args.slice(4, -1).join(" ");

  if (!name || name.trim().length === 0) {
    throw new ValidationError("Subscription name cannot be empty.");
  }

  const price = Number(priceStr);
  if (!Number.isFinite(price) || price < 0) {
    throw new ValidationError(
      `Invalid price: “${priceStr}”. Price must be a non-negative number.`,
    );
  }

  const parsedCycle = parseBillingCycleText(cycleText);

  if (!DATE_REGEX.test(nextBillingDate)) {
    throw new ValidationError(
      `Invalid date: “${nextBillingDate}”. Use YYYY-MM-DD format.`,
    );
  }

  // Validate that the date is actually parseable
  const parsedDate = new Date(nextBillingDate + "T00:00:00Z");
  if (
    isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== nextBillingDate
  ) {
    throw new ValidationError(
      `Invalid date: “${nextBillingDate}”. Use YYYY-MM-DD format.`,
    );
  }

  return {
    name,
    price,
    currency,
    billingCycle: parsedCycle.billingCycle,
    billingInterval: parsedCycle.billingInterval,
    nextBillingDate,
  };
}
