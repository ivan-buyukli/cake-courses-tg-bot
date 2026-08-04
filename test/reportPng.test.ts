import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SplitReportData,
  TextReportSubscriptionItem,
} from "../src/services/reportService.js";

const resvgMock = vi.hoisted(() => ({
  async: vi.fn(),
  renderedFree: vi.fn(),
  resvgFree: vi.fn(),
}));

const reportSvgMock = vi.hoisted(() => ({
  buildReportOverviewSvg: vi.fn(),
}));

vi.mock("@cf-wasm/resvg/legacy/workerd", () => ({
  Resvg: {
    async: resvgMock.async,
  },
}));

vi.mock("../src/utils/reportSvg.js", () => ({
  buildReportOverviewSvg: reportSvgMock.buildReportOverviewSvg,
}));

import { renderReportOverviewPng } from "../src/utils/reportPng.js";

describe("renderReportOverviewPng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportSvgMock.buildReportOverviewSvg.mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="780"/>',
    );
    resvgMock.async.mockResolvedValue({
      render: () => ({
        asPng: () => new Uint8Array([1, 2, 3]),
        free: resvgMock.renderedFree,
      }),
      free: resvgMock.resvgFree,
    });
  });

  it("renders the embedded-font overview through legacy resvg", async () => {
    const report = {} as SplitReportData;
    const upcomingItems: TextReportSubscriptionItem[] = [];

    const png = await renderReportOverviewPng(report, upcomingItems);

    expect(Array.from(png)).toEqual([1, 2, 3]);
    expect(reportSvgMock.buildReportOverviewSvg).toHaveBeenCalledWith(
      report,
      upcomingItems,
    );
    expect(resvgMock.async).toHaveBeenCalledTimes(1);
    const [svg, options] = resvgMock.async.mock.calls[0];
    expect(svg).toContain('width="1200"');
    expect(options).toEqual({
      background: "#f8f7f2",
      fitTo: { mode: "width", value: 1200 },
    });
    expect(options).not.toHaveProperty("font");
    expect(resvgMock.renderedFree).toHaveBeenCalledTimes(1);
    expect(resvgMock.resvgFree).toHaveBeenCalledTimes(1);
  });
});
