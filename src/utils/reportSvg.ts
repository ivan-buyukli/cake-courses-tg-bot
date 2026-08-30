import type {
  ReportData,
  ReportDayDistribution,
  SplitReportData,
  TextReportSubscriptionItem,
} from "../services/reportService.js";
import { addDays } from "./date.js";
import { formatMoney } from "./money.js";
import { REPORT_FONT_FAMILY, REPORT_SATORI_FONTS } from "./reportFonts.js";
import { createBarChartLayout } from "./reportChartLayout.js";
import {
  REPORT_COLORS as COLORS,
  REPORT_OVERVIEW_HEIGHT as OVERVIEW_HEIGHT,
  REPORT_OVERVIEW_PANEL_PADDING as OVERVIEW_PANEL_PADDING,
  REPORT_WIDTH as WIDTH,
} from "./reportTheme.js";
import satori from "satori";

export { buildReportSvg } from "./reportLegacySvg.js";

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
