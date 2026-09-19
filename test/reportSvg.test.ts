import { describe, expect, it, vi } from "vitest";
import type {
  ReportData,
  SplitReportData,
} from "../src/services/reportService.js";

vi.mock("satori", () => ({
  default: vi.fn(async (element) => JSON.stringify(element)),
}));

import {
  buildReportOverviewSvg,
  buildReportSvg,
} from "../src/utils/reportSvg.js";

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    title: "Monthly subscription cost",
    totalLabel: "Monthly subscription cost",
    chartTitle: "Daily average cost",
    chartSubtitle:
      "Monthly cost of active auto-renewing subscriptions, spread over 30 days",
    generatedAt: "2026-06-17T00:00:00.000Z",
    baseCurrency: "EUR",
    subscriptionCount: 1,
    includedCount: 1,
    convertedCount: 1,
    totalBase: 7,
    byCurrency: [],
    dayDistribution: [
      { day: 1, actualTotal: 13, monthlyEquivalentTotal: 7, actualCount: 1 },
      { day: 2, actualTotal: 0, monthlyEquivalentTotal: 0, actualCount: 0 },
    ],
    missingRateCurrencies: [],
    excluded: {
      noPrice: 0,
      noCurrency: 0,
      customCycle: 0,
      trial: 0,
      nonRenewing: 0,
    },
    ...overrides,
  };
}

describe("buildReportSvg", () => {
  it("renders monthly view labels with actual and monthly-equivalent values", () => {
    const svg = buildReportSvg(report());

    expect(svg).toContain("Paid 13");
    expect(svg).toContain("Avg 7");
    expect(svg).toContain('class="bar-label-monthly"');
  });

  it("renders monthly-equivalent bars as the muted series", () => {
    const svg = buildReportSvg(report());

    expect(svg).toContain('fill="#2f6f73" fill-opacity="0.35"');
    expect(svg).toContain(
      '<rect x="840" y="346" width="16" height="16" rx="3" fill="#2f6f73" fill-opacity="0.35"/>',
    );
    expect(svg).toContain(
      '<rect x="980" y="346" width="16" height="16" rx="3" fill="#b7791f"/>',
    );
    expect(svg).not.toContain('fill="#b7791f" fill-opacity="0.45"');
  });

  it("renders upcoming due bars as blocks while keeping one total label", () => {
    const svg = buildReportSvg(
      report({
        title: "Next 30 days spending",
        totalLabel: "Actual payments in the next 30 days",
        chartTitle: "Payment dates over the next 30 days",
        chartSubtitle: "Actual payments grouped by date over the next 30 days",
        totalBase: 20,
        dayLabelPrefix: "T+",
        dayDistribution: [
          {
            day: 0,
            actualTotal: 20,
            monthlyEquivalentTotal: 0,
            actualCount: 3,
          },
          {
            day: 1,
            actualTotal: 0,
            monthlyEquivalentTotal: 0,
            actualCount: 0,
          },
        ],
      }),
    );

    expect(svg).toContain(">20</text>");
    expect(svg.match(/x="320" y="(418\.0|496\.0|574\.0)"/g)).toHaveLength(3);
  });

  it("renders an overview report with key metrics and upcoming items", async () => {
    const splitReport: SplitReportData = {
      generatedAt: "2026-06-17T00:00:00.000Z",
      baseCurrency: "CNY",
      subscriptionCount: 2,
      currentMonthly: report({
        title: "Monthly subscription cost",
        totalBase: 120,
        baseCurrency: "CNY",
      }),
      currentMonthDue: report({
        title: "Next 30 days spending",
        totalBase: 80,
        baseCurrency: "CNY",
        dayDistribution: [
          {
            day: 3,
            actualTotal: 80,
            monthlyEquivalentTotal: 0,
            actualCount: 1,
          },
        ],
      }),
      yearlyProjection: report({
        title: "Expected annual spending",
        totalBase: 1440,
        baseCurrency: "CNY",
        monthDistribution: [
          { monthKey: "2026-06", actualTotal: 80 },
          { monthKey: "2026-07", actualTotal: 120 },
        ],
      }),
    };

    const svg = await buildReportOverviewSvg(splitReport, [
      {
        name: "Private Service",
        amount: 10,
        currency: "USD",
        convertedAmount: 72,
        billingDate: "2026-06-20",
      },
    ]);

    expect(svg).toContain("Subscription spending overview");
    expect(svg).toContain("Next 30 days");
    expect(svg).toContain("Monthly subscription cost");
    expect(svg).toContain("Next 12 months");
    expect(svg).toContain("Private Service");
    expect(svg).toContain("06/20");
    expect(svg).toContain("¥80");
    expect(svg).toContain("26-06");
    expect(svg).toContain("¥120");
    expect(svg).toContain("Monthly average CN¥720.00");
  });
});
