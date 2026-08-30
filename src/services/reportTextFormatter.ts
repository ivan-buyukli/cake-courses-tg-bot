import type {
  ReportData,
  SplitReportData,
  TextReportData,
  TextReportSubscriptionItem,
} from "./reportService.js";
import { formatMoney } from "../utils/money.js";

const TELEGRAM_MSG_LIMIT = 4096;

export function formatReportText(report: SplitReportData): string {
  const lines = [
    "订阅支出报告",
    `生成日期：${report.generatedAt.slice(0, 10)}`,
  ];

  appendReportSection(lines, report.currentMonthly);
  appendReportSection(lines, report.currentMonthDue);
  appendReportSection(lines, report.yearlyProjection);

  return lines.join("\n");
}

function appendReportSection(lines: string[], report: ReportData): void {
  lines.push(
    "",
    report.title,
    `${report.totalLabel}：${formatMoney(report.totalBase, report.baseCurrency)}`,
    `纳入统计：${report.includedCount}`,
  );

  if (report.byCurrency.length > 0) {
    lines.push("", "按币种：");
    for (const summary of report.byCurrency) {
      const converted =
        summary.convertedTotal !== undefined
          ? `（约 ${formatMoney(summary.convertedTotal, report.baseCurrency)}）`
          : "（缺少汇率）";
      lines.push(
        `- ${summary.currency}：${formatMoney(summary.total, summary.currency)} ${converted}`,
      );
    }
  }

  const excludedNotes: string[] = [];
  if (report.excluded.trial > 0) {
    excludedNotes.push(`体验 ${report.excluded.trial}`);
  }
  if (report.excluded.nonRenewing > 0) {
    excludedNotes.push(`已停续费 ${report.excluded.nonRenewing}`);
  }
  if (excludedNotes.length > 0) {
    lines.push("", `未计入金额：${excludedNotes.join("，")}`);
  }

  if (report.monthDistribution && report.monthDistribution.length > 0) {
    const nonZeroMonths = report.monthDistribution.filter(
      (item) => item.actualTotal > 0,
    );
    if (nonZeroMonths.length > 0) {
      lines.push("", "按月分布：");
      for (const item of nonZeroMonths) {
        lines.push(
          `- ${item.monthKey}：实际 ${formatMoney(item.actualTotal, report.baseCurrency)}`,
        );
      }
    }
  } else {
    const nonZeroDays = report.dayDistribution.filter(
      (item) => item.actualTotal > 0 || item.monthlyEquivalentTotal > 0,
    );
    if (nonZeroDays.length > 0) {
      lines.push("", "按扣款日分布：");
      for (const item of nonZeroDays) {
        const parts: string[] = [];
        if (item.actualTotal > 0) {
          parts.push(
            `实际 ${formatMoney(item.actualTotal, report.baseCurrency)}`,
          );
        }
        if (item.monthlyEquivalentTotal > 0) {
          parts.push(
            `等值 ${formatMoney(item.monthlyEquivalentTotal, report.baseCurrency)}`,
          );
        }
        const dayLabel =
          report.dayLabelPrefix !== undefined
            ? `${report.dayLabelPrefix}${item.day}`
            : `${String(item.day).padStart(2, "0")} 日`;
        lines.push(`- ${dayLabel}：${parts.join("，")}`);
      }
    }
  }
}

export function formatTextReport(data: TextReportData): string[] {
  const chunks: string[] = [];
  let current = "";

  const push = (line: string): void => {
    const withNewline = current.length === 0 ? line : "\n" + line;
    if (current.length + withNewline.length > TELEGRAM_MSG_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current += withNewline;
    }
  };

  const fmtItem = (item: TextReportSubscriptionItem): string => {
    const money = formatMoney(item.amount, item.currency);
    const arrow =
      item.convertedAmount !== undefined && item.currency !== data.baseCurrency
        ? ` → ${formatMoney(item.convertedAmount, data.baseCurrency)}`
        : "";
    const date =
      item.billingDate !== undefined
        ? `  ${item.billingDate}`
        : item.billingDay !== undefined
          ? `  ${item.billingDay}日`
          : "";
    return `${item.name}  ${money}${arrow}${date}`;
  };

  push(`未来30天支出 · ${data.upcomingWindowStart}~${data.upcomingWindowEnd}`);
  if (data.trialCount > 0 || data.nonRenewingCount > 0) {
    const notes: string[] = [];
    if (data.trialCount > 0) notes.push(`体验 ${data.trialCount}`);
    if (data.nonRenewingCount > 0) {
      notes.push(`已停续费 ${data.nonRenewingCount}`);
    }
    push(`未计入金额：${notes.join("，")}`);
  }

  if (data.currentMonthItems.length === 0) {
    push("暂无扣款");
  } else {
    for (const item of data.currentMonthItems) push(fmtItem(item));
    push(`合计 ${formatMoney(data.currentMonthTotal, data.baseCurrency)}`);
  }

  push("───");
  push(
    `年度预期 · ${data.currentMonthKey}~${data.yearMonthItems.length > 0 ? data.yearMonthItems[data.yearMonthItems.length - 1].monthKey : data.currentMonthKey}`,
  );

  let yearHasItems = false;
  for (const month of data.yearMonthItems) {
    if (month.items.length === 0) continue;
    yearHasItems = true;
    push(
      `${month.monthKey} · ${formatMoney(month.totalConverted, data.baseCurrency)}`,
    );
    for (const item of month.items) push(`  ${fmtItem(item)}`);
  }

  if (!yearHasItems) {
    push("暂无预期扣款");
  } else {
    push(`年度合计 ${formatMoney(data.yearTotal, data.baseCurrency)}`);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
