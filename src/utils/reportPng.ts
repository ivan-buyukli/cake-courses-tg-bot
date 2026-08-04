import type {
  SplitReportData,
  TextReportSubscriptionItem,
} from "../services/reportService.js";
import { buildReportOverviewSvg } from "./reportSvg.js";

export async function renderReportOverviewPng(
  report: SplitReportData,
  upcomingItems: TextReportSubscriptionItem[],
): Promise<Uint8Array> {
  return renderSvgPng(await buildReportOverviewSvg(report, upcomingItems));
}

async function renderSvgPng(svg: string): Promise<Uint8Array> {
  const { Resvg } = await import("@cf-wasm/resvg/legacy/workerd");
  const resvg = await Resvg.async(svg, {
    background: "#f8f7f2",
    fitTo: {
      mode: "width",
      value: 1200,
    },
  });

  try {
    const rendered = resvg.render();
    try {
      return rendered.asPng();
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}
