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
    "Subscription spending report",
    `Generated on: ${report.generatedAt.slice(0, 10)}`,
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
    `${report.totalLabel}: ${formatMoney(report.totalBase, report.baseCurrency)}`,
    `Included subscriptions: ${report.includedCount}`,
  );

  if (report.byCurrency.length > 0) {
    lines.push("", "By currency: ");
    for (const summary of report.byCurrency) {
      const converted =
        summary.convertedTotal !== undefined
          ? ` (approx. ${formatMoney(summary.convertedTotal, report.baseCurrency)})`
          : " (Missing exchange rate)";
      lines.push(
        `- ${summary.currency}: ${formatMoney(summary.total, summary.currency)} ${converted}`,
      );
    }
  }

  const excludedNotes: string[] = [];
  if (report.excluded.trial > 0) {
    excludedNotes.push(`Trial ${report.excluded.trial}`);
  }
  if (report.excluded.nonRenewing > 0) {
    excludedNotes.push(`Auto-renewal off ${report.excluded.nonRenewing}`);
  }
  if (excludedNotes.length > 0) {
    lines.push("", `Excluded from totals: ${excludedNotes.join(", ")}`);
  }

  if (report.monthDistribution && report.monthDistribution.length > 0) {
    const nonZeroMonths = report.monthDistribution.filter(
      (item) => item.actualTotal > 0,
    );
    if (nonZeroMonths.length > 0) {
      lines.push("", "By month: ");
      for (const item of nonZeroMonths) {
        lines.push(
          `- ${item.monthKey}: Actual ${formatMoney(item.actualTotal, report.baseCurrency)}`,
        );
      }
    }
  } else {
    const nonZeroDays = report.dayDistribution.filter(
      (item) => item.actualTotal > 0 || item.monthlyEquivalentTotal > 0,
    );
    if (nonZeroDays.length > 0) {
      lines.push("", "By billing date: ");
      for (const item of nonZeroDays) {
        const parts: string[] = [];
        if (item.actualTotal > 0) {
          parts.push(
            `Actual ${formatMoney(item.actualTotal, report.baseCurrency)}`,
          );
        }
        if (item.monthlyEquivalentTotal > 0) {
          parts.push(
            `Equivalent ${formatMoney(item.monthlyEquivalentTotal, report.baseCurrency)}`,
          );
        }
        const dayLabel =
          report.dayLabelPrefix !== undefined
            ? `${report.dayLabelPrefix}${item.day}`
            : `Day ${String(item.day).padStart(2, "0")}`;
        lines.push(`- ${dayLabel}: ${parts.join(", ")}`);
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
          ? `  Day ${item.billingDay}`
          : "";
    return `${item.name}  ${money}${arrow}${date}`;
  };

  push(
    `Next 30 days spending · ${data.upcomingWindowStart}~${data.upcomingWindowEnd}`,
  );
  if (data.trialCount > 0 || data.nonRenewingCount > 0) {
    const notes: string[] = [];
    if (data.trialCount > 0) notes.push(`Trial ${data.trialCount}`);
    if (data.nonRenewingCount > 0) {
      notes.push(`Auto-renewal off ${data.nonRenewingCount}`);
    }
    push(`Excluded from totals: ${notes.join(", ")}`);
  }

  if (data.currentMonthItems.length === 0) {
    push("No upcoming payments");
  } else {
    for (const item of data.currentMonthItems) push(fmtItem(item));
    push(`Total ${formatMoney(data.currentMonthTotal, data.baseCurrency)}`);
  }

  push("───");
  push(
    `Annual forecast · ${data.currentMonthKey}~${data.yearMonthItems.length > 0 ? data.yearMonthItems[data.yearMonthItems.length - 1].monthKey : data.currentMonthKey}`,
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
    push("No expected payments");
  } else {
    push(`Annual total ${formatMoney(data.yearTotal, data.baseCurrency)}`);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
