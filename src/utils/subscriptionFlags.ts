import type { Subscription } from "../models/subscription.js";

export function isTrialSubscription(sub: Subscription): boolean {
  return sub.isTrial === true;
}

export function isAutoRenewing(sub: Subscription): boolean {
  return sub.autoRenew !== false;
}

export function formatSubscriptionType(sub: Subscription): string {
  return isTrialSubscription(sub) ? "Trial" : "Paid";
}

export function formatAutoRenew(sub: Subscription): string {
  return isAutoRenewing(sub) ? "Yes" : "No";
}

export function formatBillingDateLabel(sub: Subscription): string {
  if (isTrialSubscription(sub)) return "Trial ends / first payment";
  if (!isAutoRenewing(sub)) return "Service expires";
  return "Next payment";
}

export function formatStatusPrefix(sub: Subscription): string {
  const labels: string[] = [];
  if (sub.status === "paused") labels.push("Paused");
  if (isTrialSubscription(sub)) labels.push("Trial");
  if (!isAutoRenewing(sub)) labels.push("Auto-renewal off");
  return labels.length > 0 ? `[${labels.join("][")}] ` : "";
}
