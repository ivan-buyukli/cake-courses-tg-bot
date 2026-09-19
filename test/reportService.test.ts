import { describe, it, expect } from "vitest";
import {
  buildReportData,
  buildTextReportData,
  formatReportText,
  formatTextReport,
  parseExchangeRateConfig,
} from "../src/services/reportService.js";
import type { Subscription } from "../src/models/subscription.js";

function sub(
  overrides: Partial<Subscription> & Pick<Subscription, "id">,
): Subscription {
  return {
    id: overrides.id,
    name: "Service",
    price: 12,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-15",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseExchangeRateConfig", () => {
  it("parses a valid USD exchange-rate config", () => {
    const config = parseExchangeRateConfig(
      JSON.stringify({
        base: "USD",
        rates: { USD: 1, CNY: 7.2, eur: 0.923 },
      }),
    );

    expect(config).toEqual({
      base: "USD",
      rates: { USD: 1, CNY: 7.2, EUR: 0.923 },
    });
  });

  it("returns null for missing or invalid JSON", () => {
    expect(parseExchangeRateConfig(null)).toBeNull();
    expect(parseExchangeRateConfig("{nope")).toBeNull();
  });

  it("returns null for unsupported base currency", () => {
    const config = parseExchangeRateConfig(
      JSON.stringify({ base: "CNY", rates: { CNY: 1, USD: 1 } }),
    );

    expect(config).toBeNull();
  });

  it("returns null when USD is not exactly 1", () => {
    const config = parseExchangeRateConfig(
      JSON.stringify({ base: "USD", rates: { CNY: 7.2, USD: 7.2 } }),
    );

    expect(config).toBeNull();
  });

  it("returns null for invalid rates", () => {
    expect(
      parseExchangeRateConfig(
        JSON.stringify({ base: "USD", rates: { CNY: 7.2, USD: 0 } }),
      ),
    ).toBeNull();
    expect(
      parseExchangeRateConfig(
        JSON.stringify({ base: "USD", rates: { CNY: 7.2, US: 1 } }),
      ),
    ).toBeNull();
  });
});

describe("buildReportData", () => {
  const rates = {
    base: "USD" as const,
    rates: { USD: 1, CNY: 7, EUR: 0.875 },
  };

  it("normalizes supported billing cycles to monthly run-rate", () => {
    const report = buildReportData(
      [
        sub({
          id: "monthly",
          price: 10,
          billingCycle: "monthly",
          nextBillingDate: "2026-06-15",
        }),
        sub({
          id: "yearly",
          price: 120,
          billingCycle: "yearly",
          nextBillingDate: "2026-06-10",
        }),
        sub({
          id: "quarterly",
          price: 30,
          billingCycle: "quarterly",
          nextBillingDate: "2026-06-12",
        }),
        sub({
          id: "weekly",
          price: 12,
          billingCycle: "weekly",
          nextBillingDate: "2026-05-24",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(4);
    expect(report.currentMonthly.totalBase).toBeCloseTo(
      (10 + 10 + 10 + 52) * 7,
    );
    expect(report.currentMonthly.byCurrency[0]).toMatchObject({
      currency: "USD",
      subscriptionCount: 4,
    });
    expect(report.currentMonthly.byCurrency[0].total).toBeCloseTo(82);
  });

  it("normalizes interval cycles to monthly run-rate", () => {
    const report = buildReportData(
      [
        sub({
          id: "every-30-days",
          price: 12,
          billingCycle: "interval",
          billingInterval: { unit: "day", count: 30 },
          nextBillingDate: "2026-06-16",
        }),
        sub({
          id: "every-4-weeks",
          price: 12,
          billingCycle: "interval",
          billingInterval: { unit: "week", count: 4 },
          nextBillingDate: "2026-06-14",
        }),
        sub({
          id: "outside-window",
          price: 12,
          billingCycle: "interval",
          billingInterval: { unit: "week", count: 4 },
          nextBillingDate: "2026-06-15",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(3);
    expect(report.currentMonthly.byCurrency[0].total).toBeCloseTo(
      (12 * 365) / 30 / 12 + (12 * 52) / 4 / 12 + (12 * 52) / 4 / 12,
    );
  });

  it("includes active subscriptions outside the next 30 days in monthly run-rate", () => {
    const report = buildReportData(
      [
        sub({
          id: "outside-window-yearly",
          price: 120,
          billingCycle: "yearly",
          nextBillingDate: "2027-05-17",
        }),
        sub({
          id: "far-future-yearly",
          price: 120,
          billingCycle: "yearly",
          nextBillingDate: "2029-01-01",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(2);
    expect(report.currentMonthly.totalBase).toBeCloseTo(140);
  });

  it("excludes custom cycle and subscriptions without price or currency", () => {
    const report = buildReportData(
      [
        sub({ id: "no-price", price: undefined }),
        sub({ id: "no-currency", currency: undefined }),
        sub({ id: "custom", billingCycle: "custom" }),
        sub({ id: "valid", price: 10, currency: "CNY" }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(1);
    expect(report.currentMonthly.excluded).toEqual({
      noPrice: 1,
      noCurrency: 1,
      customCycle: 1,
      trial: 0,
      nonRenewing: 0,
    });
    expect(report.currentMonthly.totalBase).toBe(10);
  });

  it("excludes trial and non-renewing subscriptions from report totals", () => {
    const report = buildReportData(
      [
        sub({ id: "trial", price: 10, currency: "CNY", isTrial: true }),
        sub({
          id: "non-renewing",
          price: 10,
          currency: "CNY",
          autoRenew: false,
        }),
        sub({ id: "valid", price: 10, currency: "CNY" }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(1);
    expect(report.currentMonthly.totalBase).toBe(10);
    expect(report.currentMonthly.excluded.trial).toBe(1);
    expect(report.currentMonthly.excluded.nonRenewing).toBe(1);
    expect(report.yearlyProjection.totalBase).toBe(120);
  });

  it("groups by currency and reports missing exchange rates", () => {
    const report = buildReportData(
      [
        sub({ id: "usd", price: 10, currency: "USD" }),
        sub({ id: "eur", price: 10, currency: "EUR" }),
        sub({ id: "gbp", price: 10, currency: "GBP" }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.byCurrency).toHaveLength(3);
    expect(report.currentMonthly.totalBase).toBe(150);
    expect(report.currentMonthly.convertedCount).toBe(2);
    expect(report.currentMonthly.missingRateCurrencies).toEqual(["GBP"]);
    expect(
      report.currentMonthly.byCurrency.find((item) => item.currency === "GBP"),
    ).toMatchObject({
      total: 10,
      convertedTotal: undefined,
    });
  });

  it("converts non-USD currencies through USD before the report currency", () => {
    const report = buildReportData(
      [
        sub({
          id: "eur",
          price: 10,
          currency: "EUR",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.totalBase).toBeCloseTo(80);
    expect(report.currentMonthly.byCurrency[0].convertedTotal).toBeCloseTo(80);
  });

  it("uses a caller-provided report currency for converted totals", () => {
    const report = buildReportData(
      [
        sub({
          id: "usd",
          price: 10,
          currency: "USD",
        }),
        sub({
          id: "cny",
          price: 70,
          currency: "CNY",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
      "EUR",
    );

    expect(report.baseCurrency).toBe("EUR");
    expect(report.currentMonthly.baseCurrency).toBe("EUR");
    expect(report.currentMonthly.totalBase).toBeCloseTo(17.5);
    expect(
      report.currentMonthly.byCurrency.find((item) => item.currency === "USD")
        ?.convertedTotal,
    ).toBeCloseTo(8.75);
    expect(
      report.currentMonthly.byCurrency.find((item) => item.currency === "CNY")
        ?.convertedTotal,
    ).toBeCloseTo(8.75);
  });

  it("builds upcoming 30-day run-rate and due distributions", () => {
    const report = buildReportData(
      [
        sub({
          id: "a",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-06-01",
        }),
        sub({
          id: "b",
          price: 20,
          currency: "USD",
          nextBillingDate: "2026-06-01",
        }),
        sub({
          id: "c",
          price: 5,
          currency: "EUR",
          nextBillingDate: "2026-06-15",
        }),
        sub({
          id: "d",
          price: 5,
          currency: "GBP",
          nextBillingDate: "2026-06-15",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.dayDistribution).toHaveLength(30);
    expect(report.currentMonthly.dayLabelPrefix).toBe("T+");
    expect(report.currentMonthDue.dayDistribution).toHaveLength(30);
    expect(report.currentMonthDue.dayLabelPrefix).toBe("T+");

    for (const day of report.currentMonthly.dayDistribution) {
      expect(day.monthlyEquivalentTotal).toBeCloseTo(250 / 30);
      expect(day.actualTotal).toBe(0);
    }

    const offset15 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 15,
    )!;
    expect(offset15.actualTotal).toBeCloseTo(210);
    expect(offset15.actualCount).toBe(2);

    const offset29 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 29,
    )!;
    expect(offset29.actualTotal).toBeCloseTo(40);
    expect(offset29.actualCount).toBe(1);

    // Zero-total days exist
    const day10 = report.currentMonthly.dayDistribution.find(
      (item) => item.day === 10,
    )!;
    expect(day10.monthlyEquivalentTotal).toBeCloseTo(250 / 30);
    expect(day10.actualTotal).toBe(0);
  });

  it("uses a fixed 30-day window across February", () => {
    const report = buildReportData(
      [
        sub({
          id: "feb",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-02-20",
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-02-15T00:00:00.000Z"),
    );

    expect(report.currentMonthly.dayDistribution).toHaveLength(30);
    const day20 = report.currentMonthly.dayDistribution.find(
      (item) => item.day === 5,
    )!;
    expect(day20.monthlyEquivalentTotal).toBeCloseTo(70 / 30);
  });

  it("keeps run-rate and upcoming actual totals in separate day windows", () => {
    const report = buildReportData(
      [
        sub({
          id: "yearly",
          price: 120,
          currency: "USD",
          billingCycle: "yearly",
          nextBillingDate: "2026-05-20",
        }),
        sub({
          id: "quarterly",
          price: 30,
          currency: "EUR",
          billingCycle: "quarterly",
          nextBillingDate: "2026-05-31",
        }),
        sub({
          id: "next-month",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-01",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.dayDistribution).toHaveLength(30);
    expect(report.currentMonthDue.dayDistribution).toHaveLength(30);

    // Day 20: yearly due in May + active in the monthly run-rate view
    const day20 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 3,
    )!;
    expect(day20.actualTotal).toBeCloseTo(120 * 7);
    expect(day20.monthlyEquivalentTotal).toBe(0);

    // Day 31: quarterly due in May + active
    const day31 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 14,
    )!;
    expect(day31.actualTotal).toBeCloseTo(30 * 8);
    expect(day31.monthlyEquivalentTotal).toBe(0);

    // Next-month subscription is active in run-rate but due in the upcoming window
    const day1 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 15,
    )!;
    expect(day1.actualTotal).toBeCloseTo(10 * 7);
    expect(day1.monthlyEquivalentTotal).toBe(0);

    expect(report.currentMonthDue.includedCount).toBe(3);
    expect(report.currentMonthDue.totalBase).toBe(120 * 7 + 30 * 8 + 10 * 7);
    expect(report.currentMonthDue.byCurrency).toEqual([
      {
        currency: "EUR",
        total: 30,
        convertedTotal: 240,
        subscriptionCount: 1,
      },
      {
        currency: "USD",
        total: 130,
        convertedTotal: 910,
        subscriptionCount: 2,
      },
    ]);
  });

  it("excludes already-paid monthly subscription from upcoming 30-day due", () => {
    const report = buildReportData(
      [
        sub({
          id: "monthly-paid",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-03", // advanced from 2026-05-03
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthDue.includedCount).toBe(1);
    expect(report.currentMonthDue.totalBase).toBeCloseTo(70); // 2026-06-03 is upcoming

    const offset17 = report.currentMonthDue.dayDistribution.find(
      (item) => item.day === 17,
    )!;
    expect(offset17.actualTotal).toBeCloseTo(70);
  });

  it("excludes already-paid quarterly subscription outside upcoming 30 days", () => {
    const report = buildReportData(
      [
        sub({
          id: "quarterly-paid",
          price: 30,
          currency: "USD",
          billingCycle: "quarterly",
          nextBillingDate: "2026-08-15", // advanced from 2026-05-15
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthDue.includedCount).toBe(0);
    expect(report.currentMonthDue.totalBase).toBe(0);
  });

  it("excludes already-paid yearly subscription outside upcoming 30 days", () => {
    const report = buildReportData(
      [
        sub({
          id: "yearly-paid",
          price: 120,
          currency: "USD",
          billingCycle: "yearly",
          nextBillingDate: "2027-05-10", // advanced from 2026-05-10
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthDue.includedCount).toBe(0);
    expect(report.currentMonthDue.totalBase).toBe(0);
  });

  it("includes newly created subscription when future billing is in upcoming 30 days", () => {
    const report = buildReportData(
      [
        sub({
          id: "new-sub",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-15",
          createdAt: "2026-05-20T00:00:00.000Z", // created after would-be prevDate 2026-05-15
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthDue.includedCount).toBe(1);
    expect(report.currentMonthDue.totalBase).toBeCloseTo(70);
  });

  it("monthly run-rate includes past-due subscription after advancing", () => {
    const report = buildReportData(
      [
        sub({
          id: "past-due-monthly",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-03", // past due, should be advanced
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.currentMonthly.includedCount).toBe(1);
    expect(report.currentMonthly.totalBase).toBeCloseTo(70); // 10 * 7
  });

  it("formats a text fallback without subscription names", () => {
    const report = buildReportData(
      [
        sub({ id: "a", name: "Private Service", price: 10, currency: "USD" }),
        sub({ id: "b", price: 10, currency: "GBP" }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const text = formatReportText(report);
    expect(text).toContain("Subscription spending report");
    expect(text).toContain("Monthly subscription cost");
    expect(text).toContain("Next 30 days spending");
    expect(text).toContain("Expected annual spending");
    expect(text).not.toContain("Private Service");
  });

  it("mentions excluded trial and non-renewing counts in fallback text", () => {
    const report = buildReportData(
      [
        sub({ id: "trial", price: 10, currency: "CNY", isTrial: true }),
        sub({ id: "off", price: 10, currency: "CNY", autoRenew: false }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const text = formatReportText(report);
    expect(text).toContain("Excluded from totals: Trial 1, Auto-renewal off 1");
  });

  it("projects monthly subscription across 12 months", () => {
    const report = buildReportData(
      [
        sub({
          id: "monthly",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.yearlyProjection.includedCount).toBe(1);
    expect(report.yearlyProjection.totalBase).toBeCloseTo(840); // 12 * 10 * 7
    expect(report.yearlyProjection.monthDistribution).toHaveLength(13);
    for (const item of report.yearlyProjection.monthDistribution!) {
      if (item.monthKey === "2027-05") {
        expect(item.actualTotal).toBe(0);
      } else {
        expect(item.actualTotal).toBeCloseTo(70); // 10 * 7 per month
      }
    }
  });

  it("does not look back to current-month already-paid subscription", () => {
    const report = buildReportData(
      [
        sub({
          id: "monthly-paid",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-03", // advanced from 2026-05-03
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.yearlyProjection.includedCount).toBe(1);
    const may = report.yearlyProjection.monthDistribution!.find(
      (item) => item.monthKey === "2026-05",
    )!;
    const jun = report.yearlyProjection.monthDistribution!.find(
      (item) => item.monthKey === "2026-06",
    )!;
    expect(may.actualTotal).toBe(0);
    expect(jun.actualTotal).toBeCloseTo(70);
  });

  it("lookback excludes newly created subscription with phantom date", () => {
    const report = buildReportData(
      [
        sub({
          id: "new-sub",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-15",
          createdAt: "2026-05-20T00:00:00.000Z", // created after would-be prevDate 2026-05-15
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const may = report.yearlyProjection.monthDistribution!.find(
      (item) => item.monthKey === "2026-05",
    )!;
    expect(may.actualTotal).toBe(0);
  });

  it("excludes subscription with nextBillingDate beyond one year", () => {
    const report = buildReportData(
      [
        sub({
          id: "far-future",
          price: 100,
          currency: "USD",
          billingCycle: "yearly",
          nextBillingDate: "2028-01-01",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.yearlyProjection.includedCount).toBe(0);
    expect(report.yearlyProjection.totalBase).toBe(0);
  });

  it("yearly subscription only appears in its billing month", () => {
    const report = buildReportData(
      [
        sub({
          id: "yearly",
          price: 120,
          currency: "USD",
          billingCycle: "yearly",
          nextBillingDate: "2027-03-15",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.yearlyProjection.includedCount).toBe(1);
    const mar = report.yearlyProjection.monthDistribution!.find(
      (item) => item.monthKey === "2027-03",
    )!;
    expect(mar.actualTotal).toBeCloseTo(840); // 120 * 7
  });

  it("handles weekly subscription distributed across months", () => {
    const report = buildReportData(
      [
        sub({
          id: "weekly",
          price: 12,
          currency: "USD",
          billingCycle: "weekly",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(report.yearlyProjection.includedCount).toBe(1);
    // Some months will have 4 payments, some 5
    const totalSum = report.yearlyProjection.monthDistribution!.reduce(
      (sum, item) => sum + item.actualTotal,
      0,
    );
    expect(totalSum).toBeGreaterThan(0);
  });
});

describe("buildTextReportData", () => {
  const rates = {
    base: "USD" as const,
    rates: { USD: 1, CNY: 7, EUR: 0.875 },
  };

  it("collects upcoming 30-day items with billing date", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "a",
          name: "Netflix",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-05-20",
        }),
        sub({
          id: "b",
          name: "Spotify",
          price: 15,
          currency: "CNY",
          nextBillingDate: "2026-05-10",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(data.currentMonthKey).toBe("2026-05");
    expect(data.currentMonthItems).toHaveLength(2);
    expect(data.upcomingWindowStart).toBe("2026-05-17");
    expect(data.upcomingWindowEnd).toBe("2026-06-15");
    expect(data.currentMonthItems[0]).toMatchObject({
      name: "Netflix",
      billingDay: 20,
      billingDate: "2026-05-20",
    });
    expect(data.currentMonthItems[1]).toMatchObject({
      name: "Spotify",
      billingDay: 10,
      billingDate: "2026-06-10",
    });
    expect(data.currentMonthTotal).toBeCloseTo(15 + 10 * 7);
  });

  it("uses a caller-provided report currency for text totals", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "a",
          name: "Netflix",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
      "EUR",
    );

    expect(data.baseCurrency).toBe("EUR");
    expect(data.currentMonthTotal).toBeCloseTo(8.75);
    expect(data.currentMonthItems[0].convertedAmount).toBeCloseTo(8.75);
  });

  it("collects year month items for each subscription", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "a",
          name: "Netflix",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(data.yearMonthItems).toHaveLength(13);
    const nonEmpty = data.yearMonthItems.filter((m) => m.items.length > 0);
    expect(nonEmpty).toHaveLength(12);
    for (const month of nonEmpty) {
      expect(month.items).toHaveLength(1);
      expect(month.items[0].name).toBe("Netflix");
    }
    expect(data.yearTotal).toBeCloseTo(12 * 10 * 7);
  });

  it("yearly subscription only appears in its billing month", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "yearly",
          name: "AWS",
          price: 120,
          currency: "USD",
          billingCycle: "yearly",
          nextBillingDate: "2027-03-15",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const nonEmpty = data.yearMonthItems.filter((m) => m.items.length > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0].monthKey).toBe("2027-03");
  });

  it("excludes paused and custom-cycle subscriptions", () => {
    const data = buildTextReportData(
      [
      sub({ id: "paused", name: "Paused", status: "paused" }),
        sub({ id: "custom", name: "Custom", billingCycle: "custom" }),
        sub({
          id: "valid",
          name: "Valid",
          price: 10,
          currency: "CNY",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(data.currentMonthItems).toHaveLength(1);
    expect(data.currentMonthItems[0].name).toBe("Valid");
  });

  it("includes upcoming items after already-paid current-month billing", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "monthly-paid",
          name: "Paid",
          price: 10,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-03",
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(data.currentMonthItems).toHaveLength(1);
    expect(data.currentMonthItems[0].billingDate).toBe("2026-06-03");
  });

  it("sorts upcoming items by billing date", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "a",
          name: "Z-Service",
          price: 10,
          currency: "CNY",
          nextBillingDate: "2026-05-25",
        }),
        sub({
          id: "b",
          name: "A-Service",
          price: 10,
          currency: "CNY",
          nextBillingDate: "2026-05-05",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    expect(data.currentMonthItems[0].billingDate).toBe("2026-05-25");
    expect(data.currentMonthItems[1].billingDate).toBe("2026-06-05");
  });

  it("sorts year items by converted amount descending", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "cheap",
          name: "Cheap",
          price: 1,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-20",
        }),
        sub({
          id: "expensive",
          name: "Expensive",
          price: 100,
          currency: "CNY",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-20",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const may = data.yearMonthItems.find((m) => m.monthKey === "2026-05")!;
    expect(may.items[0].name).toBe("Expensive");
    expect(may.items[1].name).toBe("Cheap");
  });
});

describe("formatTextReport", () => {
  const rates = {
    base: "USD" as const,
    rates: { USD: 1, CNY: 7 },
  };

  it("formats current month and year items as text", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "a",
          name: "Netflix",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-05-20",
        }),
        sub({
          id: "b",
          name: "Spotify",
          price: 15,
          currency: "CNY",
          nextBillingDate: "2026-05-10",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const chunks = formatTextReport(data);
    const text = chunks.join("\n");

    expect(text).toContain("Next 30 days spending · 2026-05-17~2026-06-15");
    expect(text).toContain("Spotify");
    expect(text).toContain("Netflix");
    expect(text).toContain("2026-06-10");
    expect(text).toContain("2026-05-20");
    expect(text).toContain("Annual forecast");
  });

  it("shows converted amount arrow only for non-base currencies", () => {
    const data = buildTextReportData(
      [
        sub({
          id: "usd",
          name: "US Service",
          price: 10,
          currency: "USD",
          nextBillingDate: "2026-05-20",
        }),
        sub({
          id: "cny",
          name: "CN Service",
          price: 50,
          currency: "CNY",
          nextBillingDate: "2026-05-10",
        }),
      ],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );

    const chunks = formatTextReport(data);
    const text = chunks.join("\n");

    expect(text).toContain("→");
    expect(text).toContain("→");

    expect(text).toContain("US Service  $10.00 → CN¥70.00");

    const cnyLine = `CN Service  CN¥50.00`;
    expect(text).toContain(cnyLine);
  });

  it("splits into multiple chunks when exceeding 4096 chars", () => {
    const manySubs: Subscription[] = [];
    for (let i = 0; i < 200; i++) {
      manySubs.push(
        sub({
          id: `sub-${i}`,
          name: `Subscription ${String(i).padStart(3, "0")}`,
          price: 10 + i,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: "2026-05-20",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    }

    const data = buildTextReportData(
      manySubs,
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );
    const chunks = formatTextReport(data);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it("handles empty subscriptions gracefully", () => {
    const data = buildTextReportData(
      [],
      rates,
      new Date("2026-05-17T00:00:00.000Z"),
    );
    const chunks = formatTextReport(data);
    const text = chunks.join("\n");

    expect(text).toContain("No upcoming payments");
    expect(text).toContain("No expected payments");
  });
});
