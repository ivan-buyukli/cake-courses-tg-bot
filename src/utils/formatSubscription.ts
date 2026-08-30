import type { Subscription } from "../models/subscription.js";
import { shortId } from "./shortId.js";
import { formatBillingCycle, formatStatus } from "./labels.js";
import { formatDate } from "./date.js";
import {
  formatAutoRenew,
  formatBillingDateLabel,
  formatStatusPrefix,
  formatSubscriptionType,
} from "./subscriptionFlags.js";
import { formatReminderPolicy } from "./reminderPolicy.js";

function formatPrice(sub: Subscription): string {
  if (sub.price !== undefined && sub.currency) {
    return `${sub.price} ${sub.currency}`;
  }
  if (sub.price !== undefined) {
    return `${sub.price}`;
  }
  return "";
}

function daysBetweenDates(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00Z").getTime();
  const to = new Date(toDate + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86_400_000);
}

export function formatRelativeBillingDate(
  nextBillingDate: string,
  today = formatDate(new Date()),
): string {
  const days = daysBetweenDates(today, nextBillingDate);
  if (days === 0) return "今天";
  if (days > 0) return `${days} 天后`;
  return `已过期 ${Math.abs(days)} 天`;
}

export function formatSubscriptionLine(
  sub: Subscription,
  index: number,
  today = formatDate(new Date()),
): string {
  const parts = [
    `${formatStatusPrefix(sub)}${sub.name}`,
    formatPrice(sub),
  ].filter(Boolean);

  if (sub.status !== "paused") {
    parts.push(
      `${formatBillingDateLabel(sub)}：${formatRelativeBillingDate(
        sub.nextBillingDate,
        today,
      )}`,
    );
  }

  return `${index + 1}. ${parts.join(" — ")}`;
}

export function formatSubscriptionFullLine(
  sub: Subscription,
  index: number,
): string {
  const parts = [
    `${formatStatusPrefix(sub)}${sub.name}`,
    formatPrice(sub),
    formatBillingCycle(sub.billingCycle, sub.billingInterval),
    `${formatBillingDateLabel(sub)}：${sub.nextBillingDate}`,
    `ID：${shortId(sub.id)}`,
  ].filter(Boolean);
  return `${index + 1}. ${parts.join(" — ")}`;
}

export function formatSubscriptionDetails(sub: Subscription): string {
  const lines: string[] = [`${formatStatusPrefix(sub)}${sub.name}`];
  if (sub.price !== undefined) {
    lines.push(`价格：${sub.price} ${sub.currency ?? ""}`.trim());
  }
  lines.push(
    `周期：${formatBillingCycle(sub.billingCycle, sub.billingInterval)}`,
    `类型：${formatSubscriptionType(sub)}`,
    `自动续费：${formatAutoRenew(sub)}`,
    `${formatBillingDateLabel(sub)}：${sub.nextBillingDate}`,
    `提醒：${formatReminderPolicy(sub)}`,
    `状态：${formatStatus(sub.status)}`,
  );
  if (sub.category) lines.push(`分类：${sub.category}`);
  if (sub.note) lines.push(`备注：${sub.note}`);
  return lines.join("\n");
}
