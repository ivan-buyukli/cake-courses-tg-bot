import type {
  ReportData,
  ReportDayDistribution,
  SplitReportData,
  TextReportSubscriptionItem,
} from "../services/reportService.js";
import { max as d3Max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { addDays } from "./date.js";
import { formatMoney } from "./money.js";
import { REPORT_FONT_FAMILY, REPORT_SATORI_FONTS } from "./reportFonts.js";
import satori from "satori";

const WIDTH = 1200;
const HEIGHT = 700;
const OVERVIEW_HEIGHT = 780;
const OVERVIEW_PANEL_PADDING = 14;
const CHART_X = 80;
const CHART_Y = 390;
const CHART_WIDTH = 1040;
const CHART_HEIGHT = 260;
const BAR_LABEL_TOP_PADDING = 28;
const BAR_MAX_HEIGHT = CHART_HEIGHT - BAR_LABEL_TOP_PADDING;
const MONTHLY_FILL_OPACITY = "0.35";
const STACK_BLOCK_GAP = 2;

type BarDatum = {
  key: string;
  value: number;
};

type BarLayout = {
  key: string;
  value: number;
  x: number;
  centerX: number;
  width: number;
  height: number;
  topY: number;
};

type BarChartLayout = {
  bars: BarLayout[];
  gap: number;
  heightForValue: (value: number) => number;
};

const COLORS = {
  ink: "#162326",
  muted: "#5f6f72",
  faint: "#89979a",
  line: "#d9d4ca",
  lineSoft: "#ece9e0",
  panel: "#ffffff",
  bg: "#f8f7f2",
  teal: "#2f6f73",
  tealLight: "#d8eeee",
  gold: "#b7791f",
  goldLight: "#fff1d6",
  rose: "#a85555",
  roseLight: "#f7e1dd",
};

export function buildReportOverviewSvg(
  report: SplitReportData,
  upcomingItems: TextReportSubscriptionItem[] = [],
): Promise<string> {
  const referenceDate = report.referenceDate ?? report.generatedAt.slice(0, 10);
  const missingCurrencies = Array.from(
    new Set([
      ...report.currentMonthly.missingRateCurrencies,
      ...report.currentMonthDue.missingRateCurrencies,
      ...report.yearlyProjection.missingRateCurrencies,
    ]),
  ).sort();
  const excludedNote = overviewExcludedNote(report);
  const missingNote =
    missingCurrencies.length > 0
      ? `总额未计入缺失汇率：${missingCurrencies.join("、")}`
      : "";

  const monthDistribution = report.yearlyProjection.monthDistribution ?? [];
  const monthlyAverage =
    monthDistribution.length > 0
      ? report.yearlyProjection.totalBase / monthDistribution.length
      : 0;
  const peakDue =
    report.currentMonthDue.dayDistribution.reduce<ReportDayDistribution | null>(
      (peak, item) =>
        item.actualTotal > (peak?.actualTotal ?? 0) ? item : peak,
      null,
    );

  return buildSatoriSvg(
    h(
      "div",
      {
        lang: "zh-CN",
        style: {
          width: "100%",
          height: "100%",
          backgroundColor: COLORS.bg,
          color: COLORS.ink,
          display: "flex",
          flexDirection: "column",
          padding: "30px 40px 22px",
          fontFamily: REPORT_FONT_FAMILY,
        },
      },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { fontSize: 34, fontWeight: 400 } }, "订阅支出总览"),
        h(
          "div",
          { style: { marginTop: 4, fontSize: 15, color: COLORS.muted } },
          `生成于 ${referenceDate} · 基准货币 ${report.baseCurrency} · 当前订阅 ${report.subscriptionCount} 个`,
        ),
      ),
      h(
        "div",
        { style: { display: "flex", gap: 16, marginTop: 12 } },
        overviewMetricCard(
          "未来 30 天扣款",
          formatMoney(report.currentMonthDue.totalBase, report.baseCurrency),
          `${report.currentMonthDue.convertedCount} 个订阅已换算`,
        ),
        overviewMetricCard(
          "月均订阅成本",
          formatMoney(report.currentMonthly.totalBase, report.baseCurrency),
          "活跃自动续费订阅折算",
        ),
        overviewMetricCard(
          "未来 12 个月预期",
          formatMoney(report.yearlyProjection.totalBase, report.baseCurrency),
          "按真实扣款日期预测",
        ),
      ),
      h(
        "div",
        { style: { display: "flex", gap: 20, marginTop: 12 } },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", width: 560 } },
          overviewSectionTitle(
            "未来 30 天扣款明细",
            `${upcomingItems.length} 笔`,
          ),
          overviewPanel(
            overviewUpcomingNode(upcomingItems, report.baseCurrency),
            { height: 264 },
          ),
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", width: 540 } },
          overviewSectionTitle(
            "扣款日分布 · 未来 30 天",
            peakDue
              ? `单日最高 ${chartMoney(peakDue.actualTotal, report.baseCurrency)} · ${axisDateLabel(referenceDate, peakDue.day)}`
              : undefined,
          ),
          overviewPanel(
            overviewDueChartNode(report.currentMonthDue, referenceDate),
            { height: 264 },
          ),
        ),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", marginTop: 12 } },
        overviewSectionTitle(
          "年度月度趋势",
          monthDistribution.length > 0
            ? `月均 ${formatMoney(monthlyAverage, report.baseCurrency)}`
            : undefined,
        ),
        overviewPanel(overviewYearChartNode(report.yearlyProjection), {
          height: 140,
        }),
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 3,
            marginTop: "auto",
            fontSize: 13,
            color: COLORS.muted,
          },
        },
        missingNote
          ? h(
              "div",
              { style: { display: "flex", color: COLORS.rose } },
              missingNote,
            )
          : null,
        excludedNote
          ? h("div", { style: { display: "flex" } }, excludedNote)
          : null,
      ),
    ),
    OVERVIEW_HEIGHT,
  );
}

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

        const showLabel = item.actualTotal > 0;

        const monthLabel = monthNameFromKey(item.monthKey);

        return `
          ${actualRect}
          <text x="${bar.centerX}" y="${CHART_Y + CHART_HEIGHT + 24}" text-anchor="middle" class="axis">${escapeXml(monthLabel)}</text>
          ${showLabel ? `<text x="${bar.centerX}" y="${Math.max(actualY - 8, CHART_Y - 4).toFixed(1)}" text-anchor="middle" class="bar-label">${escapeXml(compactAmount(item.actualTotal))}</text>` : ""}`;
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
        const showLabel = item.actualTotal > 0;

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
          ${isMonthlyView ? monthlyViewBarLabels(item, bar.centerX, topY) : showLabel ? `<text x="${bar.centerX}" y="${Math.max(topY - 8, CHART_Y - 4).toFixed(1)}" text-anchor="middle" class="bar-label">${escapeXml(compactAmount(item.actualTotal))}</text>` : ""}`;
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
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
  <rect class="bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}"/>
  <text x="80" y="86" class="title">${escapeXml(report.title)}</text>
  <text x="82" y="124" class="subtitle">当前订阅 · 生成于 ${escapeXml(
    report.generatedAt.slice(0, 10),
  )} · 基准货币 ${report.baseCurrency}</text>

  <rect class="panel" x="72" y="154" width="1056" height="178" rx="8"/>
  <text x="98" y="203" class="label">${escapeXml(report.totalLabel)}</text>
  <text x="96" y="282" class="metric">${escapeXml(
    formatMoney(report.totalBase, report.baseCurrency),
  )}</text>
  <text x="98" y="314" class="note">${report.convertedCount} 个订阅已换算为 ${
    report.baseCurrency
  }${formatExcludedNote(report)}</text>

  <text x="80" y="360" class="section">${escapeXml(report.chartTitle)}</text>
  <text x="80" y="390" class="note">${escapeXml(chartSubtitle)}</text>
  ${legendItems}

  <line x1="${CHART_X}" y1="${CHART_Y}" x2="${
    CHART_X + CHART_WIDTH
  }" y2="${CHART_Y}" stroke="${COLORS.line}" stroke-width="1"/>
  <line x1="${CHART_X}" y1="${CHART_Y + CHART_HEIGHT / 2}" x2="${
    CHART_X + CHART_WIDTH
  }" y2="${CHART_Y + CHART_HEIGHT / 2}" stroke="${COLORS.line}" stroke-width="1"/>
  <line x1="${CHART_X}" y1="${CHART_Y + CHART_HEIGHT}" x2="${
    CHART_X + CHART_WIDTH
  }" y2="${CHART_Y + CHART_HEIGHT}" stroke="${COLORS.line}" stroke-width="2"/>
  ${bars}
  ${
    chartEmpty
      ? '<text x="110" y="535" class="subtitle">暂无已换算订阅。</text>'
      : ""
  }
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

function createBarChartLayout(
  data: BarDatum[],
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    minBarWidth: number;
    maxBarWidth: number;
    minBarHeight: number;
  },
): BarChartLayout {
  const domain = data.map((item) => item.key);
  const xScale = scaleBand<string>()
    .domain(domain)
    .range([options.x, options.x + options.width])
    .paddingInner(0.16)
    .paddingOuter(0.08);
  const maxValue = d3Max(data, (item) => item.value) ?? 0;
  const yScale = scaleLinear()
    .domain([0, Math.max(maxValue, 1)])
    .range([0, options.height]);
  const scaledWidth = xScale.bandwidth();
  const barWidth = clamp(
    scaledWidth,
    Math.min(options.minBarWidth, scaledWidth),
    options.maxBarWidth,
  );

  const heightForValue = (value: number) => {
    if (value <= 0) return 0;
    return Math.max(options.minBarHeight, yScale(value));
  };

  const bars = data.map((item) => {
    const bandX = xScale(item.key) ?? options.x;
    const x = bandX + (scaledWidth - barWidth) / 2;
    const height = heightForValue(item.value);

    return {
      key: item.key,
      value: item.value,
      x: roundChartNumber(x),
      centerX: roundChartNumber(x + barWidth / 2),
      width: roundChartNumber(barWidth),
      height,
      topY: options.y + options.height - height,
    };
  });

  return {
    bars,
    gap: Math.max(0, Math.floor(xScale.step() - barWidth)),
    heightForValue,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundChartNumber(value: number): number {
  return Number(value.toFixed(1));
}

type SatoriElement = {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: SatoriChild | SatoriChild[];
    [key: string]: unknown;
  };
};

type SatoriChild = SatoriElement | string | number | null;

function h(
  type: string,
  props: Record<string, unknown> | null,
  ...children: SatoriChild[]
): SatoriElement {
  const nextProps = props ?? {};
  const style = nextProps.style as Record<string, unknown> | undefined;
  const normalizedProps =
    type === "div" && style?.display === undefined
      ? { ...nextProps, style: { ...(style ?? {}), display: "flex" } }
      : nextProps;

  return {
    type,
    props: {
      ...normalizedProps,
      children: children.length === 1 ? children[0] : children,
    },
  };
}

async function buildSatoriSvg(
  element: SatoriElement,
  height: number,
): Promise<string> {
  const svg = await satori(element as any, {
    width: WIDTH,
    height,
    embedFont: true,
    fonts: REPORT_SATORI_FONTS,
  });

  return svg;
}

function overviewMetricCard(
  title: string,
  value: string,
  note: string,
): SatoriElement {
  return overviewPanel(
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      h(
        "div",
        { style: { display: "flex", color: COLORS.muted, fontSize: 13 } },
        title,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            marginTop: 4,
            fontSize: 30,
            fontWeight: 400,
          },
        },
        value,
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            marginTop: 3,
            color: COLORS.faint,
            fontSize: 12,
          },
        },
        note,
      ),
    ),
    { width: 362, height: 104 },
    12,
  );
}

function overviewSectionTitle(title: string, note?: string): SatoriElement {
  return h(
    "div",
    { style: { display: "flex", alignItems: "baseline", marginBottom: 8 } },
    h(
      "div",
      { style: { display: "flex", fontSize: 20, fontWeight: 400 } },
      title,
    ),
    note
      ? h(
          "div",
          {
            style: {
              display: "flex",
              marginLeft: "auto",
              fontSize: 13,
              color: COLORS.faint,
            },
          },
          note,
        )
      : null,
  );
}

function overviewPanel(
  child: SatoriChild,
  size: { width?: number; height: number },
  padding: number = OVERVIEW_PANEL_PADDING,
): SatoriElement {
  return h(
    "div",
    {
      style: {
        width: size.width ?? "100%",
        height: size.height,
        backgroundColor: COLORS.panel,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        padding,
      },
    },
    child,
  );
}

function overviewChartPlaceholder(text: string): SatoriElement {
  return h(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.muted,
        fontSize: 15,
      },
    },
    text,
  );
}

function overviewUpcomingNode(
  items: TextReportSubscriptionItem[],
  baseCurrency: string,
): SatoriElement {
  if (items.length === 0) {
    return overviewChartPlaceholder("未来 30 天暂无扣款");
  }

  const maxRows = 9;
  const hasMore = items.length > maxRows;
  const shown = hasMore ? items.slice(0, maxRows - 1) : items;
  const rows = shown.map((item, index) =>
    overviewUpcomingRow(
      item,
      baseCurrency,
      index === shown.length - 1 && !hasMore,
    ),
  );
  if (hasMore) {
    rows.push(
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            height: 26,
            color: COLORS.faint,
            fontSize: 12,
          },
        },
        `另有 ${items.length - shown.length} 笔 · /report_text 查看全部`,
      ),
    );
  }

  return h(
    "div",
    { style: { display: "flex", flexDirection: "column" } },
    ...rows,
  );
}

function overviewUpcomingRow(
  item: TextReportSubscriptionItem,
  baseCurrency: string,
  isLast: boolean,
): SatoriElement {
  const converted =
    item.convertedAmount !== undefined && item.currency !== baseCurrency
      ? ` / ${formatMoney(item.convertedAmount, baseCurrency)}`
      : "";

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 26,
        borderBottom: isLast ? "none" : `1px solid ${COLORS.lineSoft}`,
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          width: 56,
          color: COLORS.muted,
          fontSize: 13,
        },
      },
      shortBillingDate(item.billingDate),
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexGrow: 1,
          fontSize: 14,
          fontWeight: 400,
          overflow: "hidden",
          whiteSpace: "nowrap",
        },
      },
      truncateText(item.name, 18),
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          marginLeft: "auto",
          paddingLeft: 12,
          color: COLORS.muted,
          fontSize: 13,
          textAlign: "right",
          whiteSpace: "nowrap",
        },
      },
      `${formatMoney(item.amount, item.currency)}${converted}`,
    ),
  );
}

function overviewDueChartNode(
  report: ReportData,
  referenceDate: string,
): SatoriElement {
  const innerWidth = 540 - OVERVIEW_PANEL_PADDING * 2;
  const innerHeight = 264 - OVERVIEW_PANEL_PADDING * 2;
  const data = report.dayDistribution;
  const nonZero = data.filter((item) => item.actualTotal > 0);
  if (nonZero.length === 0) {
    return overviewChartPlaceholder("未来 30 天暂无扣款");
  }

  const axisHeight = 18;
  const labelRowHeight = 13;
  const barArea = innerHeight - axisHeight - labelRowHeight * 2 - 6;
  const chart = createBarChartLayout(
    data.map((item) => ({ key: String(item.day), value: item.actualTotal })),
    {
      x: 0,
      y: 0,
      width: innerWidth,
      height: barArea,
      minBarWidth: 3,
      maxBarWidth: 12,
      minBarHeight: 2,
    },
  );

  const labeledDays = new Set(
    (nonZero.length <= 6
      ? nonZero
      : [...nonZero].sort((a, b) => b.actualTotal - a.actualTotal).slice(0, 5)
    ).map((item) => item.day),
  );

  const children: SatoriChild[] = overviewGridlines(
    innerWidth,
    axisHeight,
    barArea,
  );

  data.forEach((item, index) => {
    const bar = chart.bars[index];
    if (item.actualTotal <= 0 || bar.height <= 0) return;
    children.push(
      h("div", {
        style: {
          position: "absolute",
          left: bar.x,
          bottom: axisHeight,
          width: bar.width,
          height: bar.height,
          backgroundColor: COLORS.gold,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
        },
      }),
    );
    if (labeledDays.has(item.day)) {
      children.push(
        h(
          "div",
          {
            style: {
              position: "absolute",
              left: clampLabelLeft(bar.centerX, 44, innerWidth),
              width: 44,
              bottom:
                axisHeight + bar.height + 3 + (item.day % 2) * labelRowHeight,
              display: "flex",
              justifyContent: "center",
              fontSize: 11,
              color: COLORS.ink,
              whiteSpace: "nowrap",
            },
          },
          compactChartMoney(item.actualTotal, report.baseCurrency),
        ),
      );
    }
  });

  const tickEveryDay = data.length <= 10;
  const weeklyTicks = new Set([0, 7, 14, 21, 28]);
  data.forEach((item, index) => {
    if (!tickEveryDay && !weeklyTicks.has(item.day)) return;
    const bar = chart.bars[index];
    children.push(
      h(
        "div",
        {
          style: {
            position: "absolute",
            left: clampLabelLeft(bar.centerX, 56, innerWidth),
            width: 56,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            fontSize: 11,
            color: COLORS.faint,
            whiteSpace: "nowrap",
          },
        },
        axisDateLabel(referenceDate, item.day),
      ),
    );
  });

  return h(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        width: innerWidth,
        height: innerHeight,
        overflow: "hidden",
      },
    },
    ...children,
  );
}

function overviewYearChartNode(report: ReportData): SatoriElement {
  const innerWidth = 1120 - OVERVIEW_PANEL_PADDING * 2;
  const innerHeight = 140 - OVERVIEW_PANEL_PADDING * 2;
  const data = report.monthDistribution ?? [];
  if (data.length === 0 || data.every((item) => item.actualTotal === 0)) {
    return overviewChartPlaceholder("暂无年度预期扣款");
  }

  const axisHeight = 16;
  const valueLabelHeight = 15;
  const barArea = innerHeight - axisHeight - valueLabelHeight - 3;
  const chart = createBarChartLayout(
    data.map((item) => ({ key: item.monthKey, value: item.actualTotal })),
    {
      x: 0,
      y: 0,
      width: innerWidth,
      height: barArea,
      minBarWidth: 8,
      maxBarWidth: 46,
      minBarHeight: 2,
    },
  );

  const children: SatoriChild[] = overviewGridlines(
    innerWidth,
    axisHeight,
    barArea,
  );

  data.forEach((item, index) => {
    const bar = chart.bars[index];
    if (item.actualTotal > 0 && bar.height > 0) {
      children.push(
        h("div", {
          style: {
            position: "absolute",
            left: bar.x,
            bottom: axisHeight,
            width: bar.width,
            height: bar.height,
            backgroundColor: COLORS.teal,
            borderTopLeftRadius: 3,
            borderTopRightRadius: 3,
          },
        }),
      );
      children.push(
        h(
          "div",
          {
            style: {
              position: "absolute",
              left: clampLabelLeft(bar.centerX, 70, innerWidth),
              width: 70,
              bottom: axisHeight + bar.height + 3,
              display: "flex",
              justifyContent: "center",
              fontSize: 12,
              color: COLORS.ink,
              whiteSpace: "nowrap",
            },
          },
          chartMoney(item.actualTotal, report.baseCurrency),
        ),
      );
    }
    children.push(
      h(
        "div",
        {
          style: {
            position: "absolute",
            left: clampLabelLeft(bar.centerX, 70, innerWidth),
            width: 70,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            fontSize: 12,
            color: COLORS.faint,
            whiteSpace: "nowrap",
          },
        },
        monthAxisLabel(item.monthKey, index),
      ),
    );
  });

  return h(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        width: innerWidth,
        height: innerHeight,
        overflow: "hidden",
      },
    },
    ...children,
  );
}

function overviewGridlines(
  width: number,
  axisHeight: number,
  barArea: number,
): SatoriElement[] {
  return [0, 0.5, 1].map((ratio) =>
    h("div", {
      style: {
        position: "absolute",
        left: 0,
        bottom: axisHeight + Math.round(barArea * ratio),
        width,
        height: 1,
        backgroundColor: ratio === 0 ? COLORS.line : COLORS.lineSoft,
      },
    }),
  );
}

function clampLabelLeft(
  centerX: number,
  labelWidth: number,
  containerWidth: number,
): number {
  return Math.min(
    Math.max(centerX - labelWidth / 2, 0),
    containerWidth - labelWidth,
  );
}

function axisDateLabel(referenceDate: string, offset: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return addDays(referenceDate, offset).slice(5).replace("-", "/");
  }
  return `T+${offset}`;
}

function shortBillingDate(date: string | undefined): string {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(5).replace("-", "/")
    : "未定";
}

function monthAxisLabel(monthKey: string, index: number): string {
  const month = Number(monthKey.slice(5, 7));
  if (index === 0 || month === 1) {
    return `${monthKey.slice(2, 4)}年${month}月`;
  }
  return `${month}月`;
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).formatToParts(0);
    const symbol = parts.find((part) => part.type === "currency")?.value ?? "";
    return symbol.replace(/^[A-Z]+/, "");
  } catch {
    return "";
  }
}

function chartMoney(amount: number, currency: string): string {
  const symbol = currencySymbol(currency);
  if (amount >= 1000) {
    return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
  }
  if (amount >= 10) return `${symbol}${Math.round(amount)}`;
  return `${symbol}${(Math.round(amount * 10) / 10).toString()}`;
}

function compactChartMoney(amount: number, currency: string): string {
  const symbol = currencySymbol(currency);
  if (amount >= 10000) return `${symbol}${Math.round(amount / 1000)}k`;
  if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}k`;
  if (amount >= 10) return `${symbol}${Math.round(amount)}`;
  return `${symbol}${(Math.round(amount * 10) / 10).toString()}`;
}

function overviewExcludedNote(report: SplitReportData): string {
  const excluded = report.currentMonthly.excluded;
  const notes: string[] = [];
  if (excluded.trial > 0) notes.push(`体验 ${excluded.trial}`);
  if (excluded.nonRenewing > 0) notes.push(`已停续费 ${excluded.nonRenewing}`);
  if (excluded.noPrice > 0) notes.push(`无价格 ${excluded.noPrice}`);
  if (excluded.noCurrency > 0) notes.push(`无币种 ${excluded.noCurrency}`);
  if (excluded.customCycle > 0)
    notes.push(`自定义周期 ${excluded.customCycle}`);
  return notes.length > 0 ? `未计入金额：${notes.join("，")}` : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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
  const month = Number(monthKey.slice(5, 7));
  return `${month}月`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
