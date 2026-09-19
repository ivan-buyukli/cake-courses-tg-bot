import { describe, it, expect } from "vitest";
import {
  formatBillingCycleValue,
  parseBillingCycleText,
} from "../src/utils/billingCycle.js";
import { ValidationError } from "../src/utils/errors.js";

describe("billing cycle parsing", () => {
  it("parses day and week interval formats", () => {
    expect(parseBillingCycleText("every 30 days")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "day", count: 30 },
    });
    expect(parseBillingCycleText("every 4 weeks")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "week", count: 4 },
    });
    expect(parseBillingCycleText("30d")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "day", count: 30 },
    });
    expect(parseBillingCycleText("4w")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "week", count: 4 },
    });
    expect(parseBillingCycleText("每30天")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "day", count: 30 },
    });
    expect(parseBillingCycleText("每4周")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "week", count: 4 },
    });
  });

  it("parses month and year interval formats", () => {
    expect(parseBillingCycleText("6m")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "month", count: 6 },
    });
    expect(parseBillingCycleText("every 2 months")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "month", count: 2 },
    });
    expect(parseBillingCycleText("2y")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "year", count: 2 },
    });
    expect(parseBillingCycleText("every 1 year")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "year", count: 1 },
    });
    expect(parseBillingCycleText("每6个月")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "month", count: 6 },
    });
    expect(parseBillingCycleText("每2年")).toEqual({
      billingCycle: "interval",
      billingInterval: { unit: "year", count: 2 },
    });
  });

  it("rejects invalid interval values and unsupported units", () => {
    expect(() => parseBillingCycleText("0d")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("367d")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("53w")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("-1d")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("121m")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("31y")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("0m")).toThrow(ValidationError);
    expect(() => parseBillingCycleText("0y")).toThrow(ValidationError);
  });

  it("formats interval labels", () => {
    expect(
      formatBillingCycleValue("interval", { unit: "year", count: 1 }),
    ).toBe("Every 1 year");
    expect(
      formatBillingCycleValue("interval", { unit: "day", count: 30 }),
    ).toBe("Every 30 days");
    expect(
      formatBillingCycleValue("interval", { unit: "week", count: 4 }),
    ).toBe("Every 4 weeks");
    expect(
      formatBillingCycleValue("interval", { unit: "month", count: 6 }),
    ).toBe("Every 6 months");
    expect(
      formatBillingCycleValue("interval", { unit: "year", count: 2 }),
    ).toBe("Every 2 years");
  });
});
