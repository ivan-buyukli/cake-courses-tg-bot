import { describe, expect, it, vi } from "vitest";
import type {
  ReportData,
  SplitReportData,
} from "../src/services/reportService.js";

vi.mock("../src/utils/reportFonts.js", async () => {
  const { readFileSync } = await import("node:fs");

  const readFont = (fileName: string): ArrayBuffer => {
    const buffer = readFileSync(
      `node_modules/@fontsource/noto-sans-sc/files/${fileName}`,
    );
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  };

  const fontSources = [
    {
      name: "Noto Sans SC Latin",
      data: readFont("noto-sans-sc-latin-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 106",
      data: readFont("noto-sans-sc-106-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 109",
      data: readFont("noto-sans-sc-109-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 110",
      data: readFont("noto-sans-sc-110-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 112",
      data: readFont("noto-sans-sc-112-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 113",
      data: readFont("noto-sans-sc-113-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 114",
      data: readFont("noto-sans-sc-114-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 115",
      data: readFont("noto-sans-sc-115-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 116",
      data: readFont("noto-sans-sc-116-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 117",
      data: readFont("noto-sans-sc-117-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 118",
      data: readFont("noto-sans-sc-118-400-normal.woff"),
      weight: 400,
    },
    {
      name: "Noto Sans SC 119",
      data: readFont("noto-sans-sc-119-400-normal.woff"),
      weight: 400,
    },
  ] as const;
  const REPORT_FONT_FAMILY = fontSources.map((font) => font.name).join(", ");

  return {
    REPORT_FONT_FAMILY,
    REPORT_SATORI_FONTS: fontSources.map((font) => ({
      name: font.name,
      data: font.data,
      weight: font.weight,
      style: "normal",
    })),
  };
});

import { Resvg } from "@cf-wasm/resvg/legacy/node";
import satori from "satori";
import { buildReportOverviewSvg } from "../src/utils/reportSvg.js";
import {
  REPORT_FONT_FAMILY,
  REPORT_SATORI_FONTS,
} from "../src/utils/reportFonts.js";

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    title: "月均订阅成本",
    totalLabel: "月均订阅成本",
    chartTitle: "每日摊平成本",
    chartSubtitle: "活跃自动续费订阅折算为月均后按 30 天摊平",
    generatedAt: "2026-06-17T00:00:00.000Z",
    baseCurrency: "CNY",
    subscriptionCount: 1,
    includedCount: 1,
    convertedCount: 1,
    totalBase: 7,
    byCurrency: [],
    dayDistribution: [
      { day: 3, actualTotal: 13, monthlyEquivalentTotal: 7, actualCount: 1 },
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

describe("buildReportOverviewSvg with real Satori", () => {
  it("uses the font subsets as a glyph fallback chain for Chinese", async () => {
    const characters = [..."订阅支出总览"];
    const svg = await satori(
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            fontFamily: REPORT_FONT_FAMILY,
            fontSize: 40,
          },
          children: characters.map((character) => ({
            type: "span",
            props: { children: character },
          })),
        },
      } as any,
      {
        width: 480,
        height: 80,
        embedFont: true,
        fonts: REPORT_SATORI_FONTS,
      },
    );
    const paths = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(paths).toHaveLength(characters.length);
    expect(new Set(paths).size).toBe(characters.length);
  });

  it("embeds font paths and renders a real PNG with legacy resvg", async () => {
    const splitReport: SplitReportData = {
      generatedAt: "2026-06-17T00:00:00.000Z",
      baseCurrency: "CNY",
      subscriptionCount: 2,
      currentMonthly: report({ totalBase: 120 }),
      currentMonthDue: report({ totalBase: 80 }),
      yearlyProjection: report({
        totalBase: 1440,
        monthDistribution: [
          { monthKey: "2026-06", actualTotal: 80 },
          { monthKey: "2026-07", actualTotal: 120 },
        ],
      }),
    };

    const svg = await buildReportOverviewSvg(splitReport, [
      {
        name: "中文订阅 · Private Service",
        amount: 10,
        currency: "USD",
        convertedAmount: 72,
        billingDate: "2026-06-20",
      },
    ]);

    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 1200 780"');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");

    const resvg = await Resvg.async(svg, {
      background: "#f8f7f2",
      fitTo: { mode: "width", value: 1200 },
    });

    try {
      const rendered = resvg.render();
      try {
        const png = rendered.asPng();
        const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
        const dataView = new DataView(
          png.buffer,
          png.byteOffset,
          png.byteLength,
        );

        expect(Array.from(png.slice(0, 8))).toEqual(pngHeader);
        expect(dataView.getUint32(16)).toBe(1200);
        expect(dataView.getUint32(20)).toBe(780);
        expect(png.byteLength).toBeGreaterThan(1_000);
      } finally {
        rendered.free();
      }
    } finally {
      resvg.free();
    }
  });
});
