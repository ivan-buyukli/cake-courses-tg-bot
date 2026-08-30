import type { ReportData } from "../services/reportService.js";
import { createBarChartLayout } from "./reportChartLayout.js";
import { formatMoney } from "./money.js";
import {
  REPORT_COLORS as COLORS,
  REPORT_HEIGHT,
  REPORT_WIDTH,
} from "./reportTheme.js";

const CHART_X = 80;
const CHART_Y = 390;
const CHART_WIDTH = 1040;
const CHART_HEIGHT = 260;
const BAR_LABEL_TOP_PADDING = 28;
const BAR_MAX_HEIGHT = CHART_HEIGHT - BAR_LABEL_TOP_PADDING;
const MONTHLY_FILL_OPACITY = "0.35";
const STACK_BLOCK_GAP = 2;

export function buildReportSvg(report: ReportData): string {
  const isMonthlyView =
    report.title.includes("摊平") || report.title.includes("月均");
  const isYearView = report.monthDistribution !== undefined;

  let bars: string;
  let chartEmpty: boolean;
  let legendItems: string;

  if (isYearView && report.monthDistribution) {
    const monthData = report.monthDistribution;
    const chart = createBarChartLayout(
      monthData.map((item) => ({
        key: item.monthKey,
        value: item.actualTotal,
      })),
      {
        x: CHART_X,
        y: CHART_Y,
        width: CHART_WIDTH,
        height: BAR_MAX_HEIGHT,
        minBarWidth: 16,
        maxBarWidth: 70,
        minBarHeight: 2,
      },
    );

    bars = monthData
      .map((item, index) => {
        const bar = chart.bars[index];
        const actualH = bar.height;
        const actualY = CHART_Y + CHART_HEIGHT - actualH;
        const actualRect =
          actualH > 0
            ? `<rect x="${bar.x}" y="${actualY.toFixed(1)}" width="${bar.width}" height="${actualH.toFixed(1)}" rx="3" fill="${COLORS.gold}"/>`
            : "";
        const monthLabel = monthNameFromKey(item.monthKey);

        return `
          ${actualRect}
          <text x="${bar.centerX}" y="${CHART_Y + CHART_HEIGHT + 24}" text-anchor="middle" class="axis">${escapeXml(monthLabel)}</text>
          ${item.actualTotal > 0 ? `<text x="${bar.centerX}" y="${Math.max(actualY - 8, CHART_Y - 4).toFixed(1)}" text-anchor="middle" class="bar-label">${escapeXml(compactAmount(item.actualTotal))}</text>` : ""}`;
      })
      .join("");

    chartEmpty = monthData.every((item) => item.actualTotal === 0);
    const legendX = CHART_X + CHART_WIDTH - 160;
    const legendY = 346;
    legendItems = `
  <rect x="${legendX}" y="${legendY}" width="16" height="16" rx="3" fill="${COLORS.gold}"/>
  <text x="${legendX + 24}" y="${legendY + 14}" class="legend">预期扣款</text>`;
  } else {
    const chart = createBarChartLayout(
      report.dayDistribution.map((item) => ({
        key: String(item.day),
        value: isMonthlyView
          ? item.actualTotal + item.monthlyEquivalentTotal
          : item.actualTotal,
      })),
      {
        x: CHART_X,
        y: CHART_Y,
        width: CHART_WIDTH,
        height: BAR_MAX_HEIGHT,
        minBarWidth: 10,
        maxBarWidth: 40,
        minBarHeight: 2,
      },
    );
    const daysInMonth = report.dayDistribution.length;

    bars = report.dayDistribution
      .map((item, index) => {
        const bar = chart.bars[index];
        const monthlyH =
          isMonthlyView && item.monthlyEquivalentTotal > 0
            ? chart.heightForValue(item.monthlyEquivalentTotal)
            : 0;
        const actualH =
          item.actualTotal > 0 ? chart.heightForValue(item.actualTotal) : 0;
        const monthlyY = CHART_Y + CHART_HEIGHT - monthlyH;
        const actualY = monthlyY - actualH;
        const monthlyRect =
          monthlyH > 0
            ? `<rect x="${bar.x}" y="${monthlyY.toFixed(1)}" width="${bar.width}" height="${monthlyH.toFixed(1)}" rx="3" fill="${COLORS.teal}"${isMonthlyView ? ` fill-opacity="${MONTHLY_FILL_OPACITY}"` : ""}/>`
            : "";
        const actualRect =
          actualH > 0
            ? isMonthlyView
              ? `<rect x="${bar.x}" y="${actualY.toFixed(1)}" width="${bar.width}" height="${actualH.toFixed(1)}" rx="3" fill="${COLORS.gold}"/>`
              : actualBarBlocks(
                  item.actualCount,
                  bar.x,
                  actualY,
                  bar.width,
                  actualH,
                )
            : "";
        const topY = actualH > 0 ? actualY : monthlyY;
        const showDayLabel =
          index === 0 || index === daysInMonth - 1 || item.day % 5 === 0;
        const dayLabel =
          report.dayLabelPrefix !== undefined
            ? `${report.dayLabelPrefix}${item.day}`
            : `D${String(item.day).padStart(2, "0")}`;

        return `
          ${monthlyRect}
          ${actualRect}
          ${showDayLabel ? `<text x="${bar.centerX}" y="${CHART_Y + CHART_HEIGHT + 24}" text-anchor="middle" class="axis">${escapeXml(dayLabel)}</text>` : ""}
          ${isMonthlyView ? monthlyViewBarLabels(item, bar.centerX, topY) : item.actualTotal > 0 ? `<text x="${bar.centerX}" y="${Math.max(topY - 8, CHART_Y - 4).toFixed(1)}" text-anchor="middle" class="bar-label">${escapeXml(compactAmount(item.actualTotal))}</text>` : ""}`;
      })
      .join("");

    chartEmpty = report.dayDistribution.every(
      (item) => item.actualTotal === 0 && item.monthlyEquivalentTotal === 0,
    );
    const legendX = CHART_X + CHART_WIDTH - 280;
    const legendY = 346;
    legendItems = isMonthlyView
      ? `
  <rect x="${legendX}" y="${legendY}" width="16" height="16" rx="3" fill="${COLORS.teal}" fill-opacity="${MONTHLY_FILL_OPACITY}"/>
  <text x="${legendX + 24}" y="${legendY + 14}" class="legend">月度摊平</text>
  <rect x="${legendX + 140}" y="${legendY}" width="16" height="16" rx="3" fill="${COLORS.gold}"/>
  <text x="${legendX + 164}" y="${legendY + 14}" class="legend">实际扣款</text>`
      : `
  <rect x="${legendX + 70}" y="${legendY}" width="16" height="16" rx="3" fill="${COLORS.gold}"/>
  <text x="${legendX + 94}" y="${legendY + 14}" class="legend">实际扣款</text>`;
  }

  const chartSubtitle = chartEmpty ? "暂无已换算订阅" : report.chartSubtitle;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_WIDTH}" height="${REPORT_HEIGHT}" viewBox="0 0 ${REPORT_WIDTH} ${REPORT_HEIGHT}">
  <style>
    text { font-family: "Noto Sans SC", sans-serif; }
    .bg { fill: ${COLORS.bg}; }
    .panel { fill: ${COLORS.panel}; stroke: ${COLORS.line}; stroke-width: 1; }
    .soft-teal { fill: ${COLORS.tealLight}; }
    .soft-gold { fill: ${COLORS.goldLight}; }
    .soft-rose { fill: ${COLORS.roseLight}; }
    .title { font-size: 44px; font-weight: 400; fill: ${COLORS.ink}; }
    .subtitle { font-size: 21px; font-weight: 400; fill: ${COLORS.muted}; }
    .metric { font-size: 66px; font-weight: 400; fill: ${COLORS.ink}; }
    .stat { font-size: 34px; font-weight: 400; fill: ${COLORS.ink}; }
    .label { font-size: 18px; font-weight: 400; fill: ${COLORS.muted}; letter-spacing: 0.6px; }
    .section { font-size: 25px; font-weight: 400; fill: ${COLORS.ink}; }
    .row-currency { font-size: 23px; font-weight: 400; fill: ${COLORS.ink}; }
    .row-text { font-size: 22px; font-weight: 400; fill: ${COLORS.ink}; }
    .row-muted { font-size: 20px; font-weight: 400; fill: ${COLORS.muted}; }
    .row-small { font-size: 17px; font-weight: 400; fill: ${COLORS.faint}; }
    .axis { font-size: 14px; font-weight: 400; fill: ${COLORS.muted}; }
    .bar-label { font-size: 14px; font-weight: 400; fill: ${COLORS.ink}; }
    .bar-label-monthly { font-size: 14px; font-weight: 400; fill: ${COLORS.teal}; opacity: 0.65; }
    .note { font-size: 19px; font-weight: 400; fill: ${COLORS.muted}; }
    .legend { font-size: 16px; font-weight: 400; fill: ${COLORS.muted}; }
  </style>
  <rect class="bg" x="0" y="0" width="${REPORT_WIDTH}" height="${REPORT_HEIGHT}"/>
  <text x="80" y="86" class="title">${escapeXml(report.title)}</text>
  <text x="82" y="124" class="subtitle">当前订阅 · 生成于 ${escapeXml(report.generatedAt.slice(0, 10))} · 基准货币 ${report.baseCurrency}</text>

  <rect class="panel" x="72" y="154" width="1056" height="178" rx="8"/>
  <text x="98" y="203" class="label">${escapeXml(report.totalLabel)}</text>
  <text x="96" y="282" class="metric">${escapeXml(formatMoney(report.totalBase, report.baseCurrency))}</text>
  <text x="98" y="314" class="note">${report.convertedCount} 个订阅已换算为 ${report.baseCurrency}${formatExcludedNote(report)}</text>

  <text x="80" y="360" class="section">${escapeXml(report.chartTitle)}</text>
  <text x="80" y="390" class="note">${escapeXml(chartSubtitle)}</text>
  ${legendItems}

  <line x1="${CHART_X}" y1="${CHART_Y}" x2="${CHART_X + CHART_WIDTH}" y2="${CHART_Y}" stroke="${COLORS.line}" stroke-width="1"/>
  <line x1="${CHART_X}" y1="${CHART_Y + CHART_HEIGHT / 2}" x2="${CHART_X + CHART_WIDTH}" y2="${CHART_Y + CHART_HEIGHT / 2}" stroke="${COLORS.line}" stroke-width="1"/>
  <line x1="${CHART_X}" y1="${CHART_Y + CHART_HEIGHT}" x2="${CHART_X + CHART_WIDTH}" y2="${CHART_Y + CHART_HEIGHT}" stroke="${COLORS.line}" stroke-width="2"/>
  ${bars}
  ${chartEmpty ? '<text x="110" y="535" class="subtitle">暂无已换算订阅。</text>' : ""}
</svg>`;
}

function monthlyViewBarLabels(
  item: { actualTotal: number; monthlyEquivalentTotal: number },
  x: number,
  topY: number,
): string {
  if (item.actualTotal <= 0 && item.monthlyEquivalentTotal <= 0) return "";
  const labelY = Math.max(topY - 24, CHART_Y - 12);
  const actualLabel = `扣${compactAmount(item.actualTotal)}`;
  const monthlyLabel = `摊${compactAmount(item.monthlyEquivalentTotal)}`;
  return `<text x="${x}" y="${labelY.toFixed(1)}" text-anchor="middle">
    <tspan x="${x}" class="bar-label">${escapeXml(actualLabel)}</tspan>
    <tspan x="${x}" dy="16" class="bar-label-monthly">${escapeXml(monthlyLabel)}</tspan>
  </text>`;
}

function actualBarBlocks(
  count: number,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const blockCount = Math.max(1, count);
  if (blockCount === 1 || height <= STACK_BLOCK_GAP * 2) {
    return `<rect x="${x}" y="${y.toFixed(1)}" width="${width}" height="${height.toFixed(1)}" rx="3" fill="${COLORS.gold}"/>`;
  }
  const totalGap = STACK_BLOCK_GAP * (blockCount - 1);
  const blockHeight = Math.max(1, (height - totalGap) / blockCount);
  return Array.from({ length: blockCount }, (_, index) => {
    const blockY = y + index * (blockHeight + STACK_BLOCK_GAP);
    return `<rect x="${x}" y="${blockY.toFixed(1)}" width="${width}" height="${blockHeight.toFixed(1)}" rx="3" fill="${COLORS.gold}"/>`;
  }).join("");
}

function compactAmount(amount: number): string {
  if (amount >= 10000) return `${Math.round(amount / 1000)}k`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return Math.round(amount).toString();
}

function formatExcludedNote(report: ReportData): string {
  const notes: string[] = [];
  if (report.excluded.trial > 0) notes.push(`体验 ${report.excluded.trial}`);
  if (report.excluded.nonRenewing > 0) {
    notes.push(`已停续费 ${report.excluded.nonRenewing}`);
  }
  return notes.length > 0 ? ` · 未计入：${notes.join("，")}` : "";
}

function monthNameFromKey(monthKey: string): string {
  return `${Number(monthKey.slice(5, 7))}月`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
