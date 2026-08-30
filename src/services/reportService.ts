import type { BillingCycle, Subscription } from "../models/subscription.js";
import {
  addDays,
  addMonths,
  addYears,
  formatDate,
  getBillingAnchorDay,
  getNextBillingDate,
  getLocalTimeInfo,
} from "../utils/date.js";
import {
  isAutoRenewing,
  isTrialSubscription,
} from "../utils/subscriptionFlags.js";

export {
  formatReportText,
  formatTextReport,
} from "./reportTextFormatter.js";

export const DEFAULT_REPORT_CURRENCY = "CNY";
export const EXCHANGE_RATE_BASE_CURRENCY = "USD";

export interface ExchangeRateConfig {
  base: typeof EXCHANGE_RATE_BASE_CURRENCY;
  rates: Record<string, number>;
}

export interface ReportCurrencySummary {
  currency: string;
  total: number;
  convertedTotal?: number;
  subscriptionCount: number;
}

export interface ReportDayDistribution {
  day: number;
  actualTotal: number;
  monthlyEquivalentTotal: number;
  actualCount: number;
}

export interface ReportMonthDistribution {
  monthKey: string;
  actualTotal: number;
}

export interface ReportExcludedCounts {
  noPrice: number;
  noCurrency: number;
  customCycle: number;
  trial: number;
  nonRenewing: number;
}

export interface TextReportSubscriptionItem {
  name: string;
  amount: number;
  currency: string;
  convertedAmount?: number;
  billingDay?: number;
  billingDate?: string;
}

export interface TextReportMonthItems {
  monthKey: string;
  totalConverted: number;
  items: TextReportSubscriptionItem[];
}

export interface TextReportData {
  generatedAt: string;
  baseCurrency: string;
  currentMonthKey: string;
  upcomingWindowStart: string;
  upcomingWindowEnd: string;
  trialCount: number;
  nonRenewingCount: number;
  currentMonthItems: TextReportSubscriptionItem[];
  currentMonthTotal: number;
  yearMonthItems: TextReportMonthItems[];
  yearTotal: number;
}

export interface ReportData {
  title: string;
  totalLabel: string;
  chartTitle: string;
  chartSubtitle: string;
  generatedAt: string;
  baseCurrency: string;
  subscriptionCount: number;
  includedCount: number;
  convertedCount: number;
  totalBase: number;
  byCurrency: ReportCurrencySummary[];
  dayDistribution: ReportDayDistribution[];
  monthDistribution?: ReportMonthDistribution[];
  missingRateCurrencies: string[];
  excluded: ReportExcludedCounts;
  dayLabelPrefix?: string;
}

export interface SplitReportData {
  generatedAt: string;
  /** User-local "today" (YYYY-MM-DD) used as the report reference date. */
  referenceDate?: string;
  baseCurrency: string;
  subscriptionCount: number;
  currentMonthly: ReportData;
  currentMonthDue: ReportData;
  yearlyProjection: ReportData;
}

export function parseExchangeRateConfig(
  input: string | null,
): ExchangeRateConfig | null {
  if (!input) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.base !== EXCHANGE_RATE_BASE_CURRENCY) return null;
  if (!isRecord(parsed.rates)) return null;

  const rates: Record<string, number> = {};
  for (const [currency, value] of Object.entries(parsed.rates)) {
    const normalized = currency.toUpperCase();
    if (!isValidCurrency(normalized)) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    rates[normalized] = value;
  }

  if (rates[EXCHANGE_RATE_BASE_CURRENCY] !== 1) return null;

  return {
    base: EXCHANGE_RATE_BASE_CURRENCY,
    rates,
  };
}

function convertToReportCurrency(
  amount: number,
  currency: string,
  exchangeRates: ExchangeRateConfig | null,
  reportCurrency: string,
): number | undefined {
  const sourceCurrency = currency.toUpperCase();
  const targetCurrency = normalizeReportCurrency(reportCurrency);
  if (sourceCurrency === targetCurrency) return amount;

  const sourceRate = exchangeRates?.rates[sourceCurrency];
  const targetRate = exchangeRates?.rates[targetCurrency];
  if (sourceRate === undefined || targetRate === undefined) return undefined;

  return (amount / sourceRate) * targetRate;
}

function normalizeReportCurrency(currency: string | undefined): string {
  const normalized = currency?.trim().toUpperCase();
  return normalized && isValidCurrency(normalized)
    ? normalized
    : DEFAULT_REPORT_CURRENCY;
}

export function buildReportData(
  subscriptions: Subscription[],
  exchangeRates: ExchangeRateConfig | null,
  timezoneOrDate?: string | Date,
  reportCurrency?: string,
): SplitReportData {
  const isDate = timezoneOrDate instanceof Date;
  const timezone = isDate ? undefined : timezoneOrDate;
  const referenceDate = isDate ? timezoneOrDate : new Date();
  const baseCurrency = normalizeReportCurrency(reportCurrency);

  const today =
    timezone && typeof timezone === "string"
      ? (getLocalTimeInfo(timezone)?.date ?? formatDate(referenceDate))
      : formatDate(referenceDate);
  const generatedAt = new Date().toISOString();
  const monthlyDayDistribution = buildUpcomingMonthlyDayDistribution(
    subscriptions,
    exchangeRates,
    baseCurrency,
  );
  const upcomingDayDistribution = buildUpcomingDayDistribution(
    subscriptions,
    exchangeRates,
    today,
    baseCurrency,
  );
  const currentMonthly = buildReportView({
    title: "月均订阅成本",
    totalLabel: "月均订阅成本",
    chartTitle: "每日摊平成本",
    chartSubtitle: "活跃自动续费订阅折算为月均后按 30 天摊平",
    subscriptions,
    exchangeRates,
    baseCurrency,
    today,
    amountForSubscription: monthlyEquivalentForSubscription,
    dayDistribution: monthlyDayDistribution,
    dayLabelPrefix: "T+",
  });
  const currentMonthDue = buildReportView({
    title: "未来30天支出",
    totalLabel: "未来30天实际扣款",
    chartTitle: "未来30天扣款分布",
    chartSubtitle: "按未来30天日期汇总的实际扣款金额",
    subscriptions,
    exchangeRates,
    baseCurrency,
    today,
    amountForSubscription: actualAmountIfDueInUpcomingWindow,
    dayDistribution: upcomingDayDistribution,
    dayLabelPrefix: "T+",
  });

  const yearMonthDistribution = buildYearMonthDistribution(
    subscriptions,
    exchangeRates,
    today,
    baseCurrency,
  );
  const yearlyProjection = buildReportView({
    title: "年度预期支出",
    totalLabel: "未来12个月预期扣款",
    chartTitle: "月度预期扣款分布",
    chartSubtitle: "按月汇总的未来12个月预期扣款金额",
    subscriptions,
    exchangeRates,
    baseCurrency,
    today,
    amountForSubscription: totalProjectedInYear,
    dayDistribution: [],
  });
  yearlyProjection.monthDistribution = yearMonthDistribution;

  return {
    generatedAt,
    referenceDate: today,
    baseCurrency,
    subscriptionCount: subscriptions.length,
    currentMonthly,
    currentMonthDue,
    yearlyProjection,
  };
}

interface BuildReportViewOptions {
  title: string;
  totalLabel: string;
  chartTitle: string;
  chartSubtitle: string;
  subscriptions: Subscription[];
  exchangeRates: ExchangeRateConfig | null;
  baseCurrency: string;
  today: string;
  amountForSubscription: (sub: Subscription, today: string) => number | null;
  dayDistribution: ReportDayDistribution[];
  dayLabelPrefix?: string;
}

function buildReportView({
  title,
  totalLabel,
  chartTitle,
  chartSubtitle,
  subscriptions,
  exchangeRates,
  baseCurrency,
  today,
  amountForSubscription,
  dayDistribution,
  dayLabelPrefix,
}: BuildReportViewOptions): ReportData {
  const byCurrency = new Map<string, ReportCurrencySummary>();
  const missingRateCurrencies = new Set<string>();
  const excluded: ReportExcludedCounts = {
    noPrice: 0,
    noCurrency: 0,
    customCycle: 0,
    trial: 0,
    nonRenewing: 0,
  };

  let includedCount = 0;
  let convertedCount = 0;
  let totalBase = 0;

  for (const sub of subscriptions) {
    if (sub.status === "paused") {
      continue;
    }

    if (isTrialSubscription(sub)) {
      excluded.trial += 1;
      continue;
    }

    if (!isAutoRenewing(sub)) {
      excluded.nonRenewing += 1;
      continue;
    }

    if (sub.price === undefined) {
      excluded.noPrice += 1;
      continue;
    }
    if (!sub.currency) {
      excluded.noCurrency += 1;
      continue;
    }

    if (sub.billingCycle === "custom") {
      excluded.customCycle += 1;
      continue;
    }

    const amount = amountForSubscription(sub, today);
    if (amount === null) {
      continue;
    }

    includedCount += 1;

    const currency = sub.currency.toUpperCase();
    const summary = byCurrency.get(currency) ?? {
      currency,
      total: 0,
      convertedTotal: undefined,
      subscriptionCount: 0,
    };
    summary.total += amount;
    summary.subscriptionCount += 1;

    const converted = convertToReportCurrency(
      amount,
      currency,
      exchangeRates,
      baseCurrency,
    );
    if (converted === undefined) {
      missingRateCurrencies.add(currency);
    } else {
      summary.convertedTotal = (summary.convertedTotal ?? 0) + converted;
      totalBase += converted;
      convertedCount += 1;
    }

    byCurrency.set(currency, summary);
  }

  return {
    title,
    totalLabel,
    chartTitle,
    chartSubtitle,
    generatedAt: new Date().toISOString(),
    baseCurrency,
    subscriptionCount: subscriptions.length,
    includedCount,
    convertedCount,
    totalBase,
    byCurrency: Array.from(byCurrency.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    dayDistribution,
    missingRateCurrencies: Array.from(missingRateCurrencies).sort(),
    excluded,
    dayLabelPrefix,
  };
}

function buildUpcomingMonthlyDayDistribution(
  subscriptions: Subscription[],
  exchangeRates: ExchangeRateConfig | null,
  baseCurrency: string,
): ReportDayDistribution[] {
  let monthlyTotal = 0;

  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    if (isTrialSubscription(sub)) continue;
    if (!isAutoRenewing(sub)) continue;
    if (sub.price === undefined) continue;
    if (!sub.currency) continue;
    if (sub.billingCycle === "custom") continue;

    const currency = sub.currency.toUpperCase();
    const monthlyAmount = monthlyEquivalentForSubscription(sub);
    if (monthlyAmount === null) continue;

    const convertedMonthlyAmount = convertToReportCurrency(
      monthlyAmount,
      currency,
      exchangeRates,
      baseCurrency,
    );
    if (convertedMonthlyAmount === undefined) continue;

    monthlyTotal += convertedMonthlyAmount;
  }

  const dailyEquivalent = monthlyTotal / 30;
  const distribution: ReportDayDistribution[] = [];
  for (let offset = 0; offset < 30; offset++) {
    distribution.push({
      day: offset,
      actualTotal: 0,
      monthlyEquivalentTotal: dailyEquivalent,
      actualCount: 0,
    });
  }
  return distribution;
}

function buildUpcomingDayDistribution(
  subscriptions: Subscription[],
  exchangeRates: ExchangeRateConfig | null,
  today: string,
  baseCurrency: string,
): ReportDayDistribution[] {
  const actualByOffset = new Map<number, number>();
  const actualCountByOffset = new Map<number, number>();
  const windowEnd = upcomingWindowEnd(today);

  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    if (isTrialSubscription(sub)) continue;
    if (!isAutoRenewing(sub)) continue;
    if (sub.price === undefined) continue;
    if (!sub.currency) continue;
    if (sub.billingCycle === "custom") continue;

    const currency = sub.currency.toUpperCase();
    const convertedActualAmount = convertToReportCurrency(
      sub.price,
      currency,
      exchangeRates,
      baseCurrency,
    );
    if (convertedActualAmount === undefined) continue;

    const billingDates = findBillingDatesInWindow(sub, today, windowEnd);
    for (const billingDate of billingDates) {
      const offset = daysBetween(today, billingDate);
      actualByOffset.set(
        offset,
        (actualByOffset.get(offset) ?? 0) + convertedActualAmount,
      );
      actualCountByOffset.set(
        offset,
        (actualCountByOffset.get(offset) ?? 0) + 1,
      );
    }
  }

  const distribution: ReportDayDistribution[] = [];
  for (let offset = 0; offset < 30; offset++) {
    distribution.push({
      day: offset,
      actualTotal: actualByOffset.get(offset) ?? 0,
      monthlyEquivalentTotal: 0,
      actualCount: actualCountByOffset.get(offset) ?? 0,
    });
  }
  return distribution;
}

function monthlyEquivalent(price: number, cycle: BillingCycle): number | null {
  if (cycle === "monthly") return price;
  if (cycle === "yearly") return price / 12;
  if (cycle === "quarterly") return price / 3;
  if (cycle === "weekly") return (price * 52) / 12;
  return null;
}

function monthlyEquivalentForSubscription(sub: Subscription): number | null {
  if (sub.billingCycle === "interval") {
    if (!sub.billingInterval) return null;
    if (sub.billingInterval.unit === "day") {
      return ((sub.price ?? 0) * 365) / sub.billingInterval.count / 12;
    }
    if (sub.billingInterval.unit === "week") {
      return ((sub.price ?? 0) * 52) / sub.billingInterval.count / 12;
    }
    if (sub.billingInterval.unit === "month") {
      return (sub.price ?? 0) / sub.billingInterval.count;
    }
    if (sub.billingInterval.unit === "year") {
      return (sub.price ?? 0) / (sub.billingInterval.count * 12);
    }
    return null;
  }

  return monthlyEquivalent(sub.price ?? 0, sub.billingCycle);
}

function actualAmountIfDueInUpcomingWindow(
  sub: Subscription,
  today: string,
): number | null {
  const billingDates = findBillingDatesInWindow(
    sub,
    today,
    upcomingWindowEnd(today),
  );
  return billingDates.length > 0
    ? (sub.price ?? 0) * billingDates.length
    : null;
}

function getBillingDay(date: string): number {
  const parsed = Number(date.slice(8, 10));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : 1;
}

function upcomingWindowEnd(today: string): string {
  return addDays(today, 29);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function findBillingDatesInWindow(
  sub: Subscription,
  startDate: string,
  endDate: string,
): string[] {
  if (sub.billingCycle === "custom") return [];

  const anchorDay =
    sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate);
  let billingDate = sub.nextBillingDate;
  let iterations = 0;

  while (billingDate < startDate && iterations < 400) {
    const next = getNextBillingDate(
      billingDate,
      sub.billingCycle,
      anchorDay,
      sub.billingInterval,
    );
    if (!next || next <= billingDate) return [];
    billingDate = next;
    iterations++;
  }

  const dates: string[] = [];
  while (billingDate <= endDate && iterations < 400) {
    if (billingDate >= startDate && sub.createdAt.slice(0, 10) <= billingDate) {
      dates.push(billingDate);
    }

    const next = getNextBillingDate(
      billingDate,
      sub.billingCycle,
      anchorDay,
      sub.billingInterval,
    );
    if (!next || next <= billingDate) break;
    billingDate = next;
    iterations++;
  }

  return dates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function projectedAmountsByMonth(
  sub: Subscription,
  today: string,
): Map<string, number> | null {
  if (isTrialSubscription(sub)) return null;
  if (!isAutoRenewing(sub)) return null;
  if (sub.billingCycle === "custom") return null;
  if (sub.price === undefined) return null;
  if (!sub.currency) return null;

  const windowEnd = addDays(addYears(today, 1), -1);
  if (sub.nextBillingDate > windowEnd) return null;

  const anchorDay =
    sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate);
  const price = sub.price;
  const result = new Map<string, number>();

  // Advance past-due dates to the next future date
  let nextDate = sub.nextBillingDate;
  if (nextDate < today) {
    let iterations = 0;
    while (nextDate < today && iterations < 400) {
      const next = getNextBillingDate(
        nextDate,
        sub.billingCycle,
        anchorDay,
        sub.billingInterval,
      );
      if (!next || next <= nextDate) break;
      nextDate = next;
      iterations++;
    }
    if (nextDate < today) return null;
  }

  // Forward projection from nextDate
  let billingDate = nextDate;
  let iterations = 0;
  while (billingDate <= windowEnd && iterations < 400) {
    if (billingDate >= today && sub.createdAt.slice(0, 10) <= billingDate) {
      const monthKey = billingDate.slice(0, 7);
      result.set(monthKey, (result.get(monthKey) ?? 0) + price);
    }
    const next = getNextBillingDate(
      billingDate,
      sub.billingCycle,
      anchorDay,
      sub.billingInterval,
    );
    if (!next || next <= billingDate) break;
    billingDate = next;
    iterations++;
  }

  return result.size > 0 ? result : null;
}

function totalProjectedInYear(sub: Subscription, today: string): number | null {
  const amounts = projectedAmountsByMonth(sub, today);
  if (!amounts) return null;
  let total = 0;
  for (const amount of amounts.values()) {
    total += amount;
  }
  return total > 0 ? total : null;
}

function buildYearMonthDistribution(
  subscriptions: Subscription[],
  exchangeRates: ExchangeRateConfig | null,
  today: string,
  baseCurrency: string,
): ReportMonthDistribution[] {
  const windowStartMonth = today.slice(0, 7);
  const windowEndMonth = addDays(addYears(today, 1), -1).slice(0, 7);

  const monthTotals = new Map<string, number>();
  let currentMonth = windowStartMonth;
  while (currentMonth <= windowEndMonth) {
    monthTotals.set(currentMonth, 0);
    currentMonth = addMonths(currentMonth + "-01", 1).slice(0, 7);
  }

  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    if (isTrialSubscription(sub)) continue;
    if (!isAutoRenewing(sub)) continue;
    if (sub.price === undefined) continue;
    if (!sub.currency) continue;
    if (sub.billingCycle === "custom") continue;

    const currency = sub.currency.toUpperCase();
    const convertedOneUnit = convertToReportCurrency(
      1,
      currency,
      exchangeRates,
      baseCurrency,
    );
    if (convertedOneUnit === undefined) continue;

    const amounts = projectedAmountsByMonth(sub, today);
    if (!amounts) continue;

    for (const [monthKey, amount] of amounts) {
      if (monthTotals.has(monthKey)) {
        monthTotals.set(
          monthKey,
          (monthTotals.get(monthKey) ?? 0) + amount * convertedOneUnit,
        );
      }
    }
  }

  return Array.from(monthTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, actualTotal]) => ({ monthKey, actualTotal }));
}

export function buildTextReportData(
  subscriptions: Subscription[],
  exchangeRates: ExchangeRateConfig | null,
  timezoneOrDate?: string | Date,
  reportCurrency?: string,
): TextReportData {
  const isDate = timezoneOrDate instanceof Date;
  const timezone = isDate ? undefined : timezoneOrDate;
  const referenceDate = isDate ? timezoneOrDate : new Date();
  const baseCurrency = normalizeReportCurrency(reportCurrency);

  const today =
    timezone && typeof timezone === "string"
      ? (getLocalTimeInfo(timezone)?.date ?? formatDate(referenceDate))
      : formatDate(referenceDate);
  const currentMonthKey = today.slice(0, 7);
  const upcomingWindowStart = today;
  const upcomingWindowEndDate = upcomingWindowEnd(today);
  const generatedAt = new Date().toISOString();
  const trialCount = subscriptions.filter(
    (sub) => sub.status !== "paused" && isTrialSubscription(sub),
  ).length;
  const nonRenewingCount = subscriptions.filter(
    (sub) =>
      sub.status !== "paused" &&
      !isTrialSubscription(sub) &&
      !isAutoRenewing(sub),
  ).length;

  const currentMonthItems: TextReportSubscriptionItem[] = [];
  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    if (isTrialSubscription(sub)) continue;
    if (!isAutoRenewing(sub)) continue;
    if (sub.price === undefined) continue;
    if (!sub.currency) continue;
    if (sub.billingCycle === "custom") continue;

    const billingDates = findBillingDatesInWindow(
      sub,
      upcomingWindowStart,
      upcomingWindowEndDate,
    );
    if (billingDates.length === 0) continue;

    const currency = sub.currency.toUpperCase();

    for (const billingDate of billingDates) {
      const convertedAmount = convertToReportCurrency(
        sub.price,
        currency,
        exchangeRates,
        baseCurrency,
      );

      currentMonthItems.push({
        name: sub.name,
        amount: sub.price,
        currency,
        convertedAmount,
        billingDay: getBillingDay(billingDate),
        billingDate,
      });
    }
  }

  currentMonthItems.sort((a, b) => {
    if (a.billingDate && b.billingDate && a.billingDate !== b.billingDate) {
      return a.billingDate.localeCompare(b.billingDate);
    }
    if (a.billingDay !== b.billingDay) return a.billingDay! - b.billingDay!;
    return a.name.localeCompare(b.name);
  });

  let currentMonthTotal = 0;
  for (const item of currentMonthItems) {
    if (item.convertedAmount !== undefined) {
      currentMonthTotal += item.convertedAmount;
    }
  }

  const yearMonthMap = new Map<
    string,
    { totalConverted: number; items: TextReportSubscriptionItem[] }
  >();

  let cursorMonth = currentMonthKey;
  const yearWindowEndMonth = addDays(addYears(today, 1), -1).slice(0, 7);
  while (cursorMonth <= yearWindowEndMonth) {
    yearMonthMap.set(cursorMonth, { totalConverted: 0, items: [] });
    cursorMonth = addMonths(cursorMonth + "-01", 1).slice(0, 7);
  }

  for (const sub of subscriptions) {
    if (sub.status === "paused") continue;
    if (isTrialSubscription(sub)) continue;
    if (!isAutoRenewing(sub)) continue;
    if (sub.price === undefined) continue;
    if (!sub.currency) continue;
    if (sub.billingCycle === "custom") continue;

    const currency = sub.currency.toUpperCase();

    const amounts = projectedAmountsByMonth(sub, today);
    if (!amounts) continue;

    for (const [monthKey, amount] of amounts) {
      const entry = yearMonthMap.get(monthKey);
      if (!entry) continue;

      const convertedAmount = convertToReportCurrency(
        amount,
        currency,
        exchangeRates,
        baseCurrency,
      );
      if (convertedAmount !== undefined) {
        entry.totalConverted += convertedAmount;
      }

      entry.items.push({
        name: sub.name,
        amount,
        currency,
        convertedAmount,
      });
    }
  }

  const yearMonthItems: TextReportMonthItems[] = [];
  for (const [monthKey, entry] of yearMonthMap) {
    entry.items.sort((a, b) => {
      const aVal = a.convertedAmount ?? 0;
      const bVal = b.convertedAmount ?? 0;
      if (bVal !== aVal) return bVal - aVal;
      return a.name.localeCompare(b.name);
    });
    yearMonthItems.push({
      monthKey,
      totalConverted: entry.totalConverted,
      items: entry.items,
    });
  }

  let yearTotal = 0;
  for (const month of yearMonthItems) {
    yearTotal += month.totalConverted;
  }

  return {
    generatedAt,
    baseCurrency,
    currentMonthKey,
    upcomingWindowStart,
    upcomingWindowEnd: upcomingWindowEndDate,
    trialCount,
    nonRenewingCount,
    currentMonthItems,
    currentMonthTotal,
    yearMonthItems,
    yearTotal,
  };
}
