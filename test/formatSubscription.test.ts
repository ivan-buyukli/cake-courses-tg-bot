import { describe, expect, it } from "vitest";
import type { Subscription } from "../src/models/subscription.js";
import {
  formatRelativeBillingDate,
  formatSubscriptionFullLine,
  formatSubscriptionLine,
} from "../src/utils/formatSubscription.js";

function createSubscription(
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: "12345678-1234-1234-1234-123456789abc",
    name: "Netflix",
    price: 12.99,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-01",
    status: "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatSubscription", () => {
  it("formats compact list lines with relative billing date", () => {
    const line = formatSubscriptionLine(createSubscription(), 0, "2026-05-18");

    expect(line).toBe("1. Netflix — 12.99 USD — Next payment: 14 days away");
  });

  it("omits missing prices from compact list lines", () => {
    const line = formatSubscriptionLine(
      createSubscription({ price: undefined, currency: undefined }),
      1,
      "2026-05-18",
    );

    expect(line).toBe("2. Netflix — Next payment: 14 days away");
  });

  it("formats relative billing dates for today and past dates", () => {
    expect(formatRelativeBillingDate("2026-05-18", "2026-05-18")).toBe("Today");
    expect(formatRelativeBillingDate("2026-05-17", "2026-05-18")).toBe(
      "Overdue by 1 day",
    );
  });

  it("keeps full list lines compatible with action button messages", () => {
    const line = formatSubscriptionFullLine(
      createSubscription({ billingCycle: "yearly" }),
      0,
    );

    expect(line).toBe(
      "1. Netflix — 12.99 USD — Yearly — Next payment: 2026-06-01 — ID: 12345678",
    );
  });

  it("shows paused label in compact list line without billing date", () => {
    const line = formatSubscriptionLine(
      createSubscription({ status: "paused" }),
      0,
      "2026-05-18",
    );

    expect(line).toBe("1. [Paused] Netflix — 12.99 USD");
  });

  it("shows paused label in full list line", () => {
    const line = formatSubscriptionFullLine(
      createSubscription({ status: "paused" }),
      0,
    );

    expect(line).toBe(
      "1. [Paused] Netflix — 12.99 USD — Monthly — Next payment: 2026-06-01 — ID: 12345678",
    );
  });

  it("does not show label for active subscriptions", () => {
    const line = formatSubscriptionLine(
      createSubscription({ status: "active" }),
      0,
      "2026-05-18",
    );

    expect(line).toBe("1. Netflix — 12.99 USD — Next payment: 14 days away");
  });

  it("shows trial label and trial date wording", () => {
    const line = formatSubscriptionLine(
      createSubscription({ isTrial: true }),
      0,
      "2026-05-18",
    );

    expect(line).toBe(
      "1. [Trial] Netflix — 12.99 USD — Trial ends / first payment: 14 days away",
    );
  });

  it("shows non-renewing label and service end wording", () => {
    const line = formatSubscriptionLine(
      createSubscription({ autoRenew: false }),
      0,
      "2026-05-18",
    );

    expect(line).toBe(
      "1. [Auto-renewal off] Netflix — 12.99 USD — Service expires: 14 days away",
    );
  });
});
