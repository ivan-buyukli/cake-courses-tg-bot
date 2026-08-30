import { describe, expect, it } from "vitest";
import { subscriptionInputSchema } from "../src/schemas/subscriptionSchema.js";

describe("subscriptionInputSchema", () => {
  it("accepts trial and auto-renew flags", () => {
    const parsed = subscriptionInputSchema.parse({
      name: "Netflix",
      price: 12,
      currency: "USD",
      billingCycle: "monthly",
      nextBillingDate: "2026-06-01",
      status: "active",
      isTrial: true,
      autoRenew: false,
    });

    expect(parsed.isTrial).toBe(true);
    expect(parsed.autoRenew).toBe(false);
  });

  it("accepts the one-day single reminder override", () => {
    const parsed = subscriptionInputSchema.parse({
      name: "Daily service",
      billingCycle: "weekly",
      nextBillingDate: "2026-06-01",
      status: "active",
      reminderPolicy: { mode: "once", daysBefore: 1 },
    });

    expect(parsed.reminderPolicy).toEqual({ mode: "once", daysBefore: 1 });
  });

  it("rejects unsupported reminder overrides", () => {
    expect(() =>
      subscriptionInputSchema.parse({
        name: "Daily service",
        billingCycle: "weekly",
        nextBillingDate: "2026-06-01",
        status: "active",
        reminderPolicy: { mode: "once", daysBefore: 2 },
      }),
    ).toThrow();
  });
});
