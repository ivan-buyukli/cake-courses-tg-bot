import { InlineKeyboard } from "grammy";
import type { Subscription } from "../../models/subscription.js";
import { getBillingAnchorDay, getNextBillingDate } from "../../utils/date.js";
import {
  isAutoRenewing,
  isTrialSubscription,
} from "../../utils/subscriptionFlags.js";
import { richTableCell, type MessagePresentation } from "./richMessage.js";
import { subscriptionPrice } from "./subscriptionPresentation.js";

export const REMINDER_MESSAGE_SIZE = 12;
export function sortReminders<T extends Subscription>(subs: T[]): T[] {
  return [...subs].sort(
    (a, b) =>
      a.nextBillingDate.localeCompare(b.nextBillingDate) ||
      a.name.localeCompare(b.name),
  );
}
export function reminderKind(sub: Subscription): string {
  return isTrialSubscription(sub)
    ? "Trial ends"
    : !isAutoRenewing(sub)
      ? "Service expires"
      : "Payment";
}
export function canRenewOneCycle(sub: Subscription): boolean {
  return (
    getNextBillingDate(
      sub.nextBillingDate,
      sub.billingCycle,
      sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate),
      sub.billingInterval,
    ) !== null
  );
}
export function reminderPresentation(
  subs: Subscription[],
  title = "Subscription reminders",
  subtitle?: string,
): MessagePresentation {
  const items = sortReminders(subs);
  const keyboard = new InlineKeyboard();
  for (const sub of items.filter(canRenewOneCycle)) {
    keyboard
      .text(
        `Renewed · ${sub.name}`,
        `reminder:renew:${sub.id}:${sub.nextBillingDate}`,
      )
      .success()
      .row();
  }
  keyboard.text("Manage subscriptions", "nav:list");
  const lines = items.map(
    (sub) =>
      `${sub.name} · ${reminderKind(sub)}\n${subscriptionPrice(sub)} · ${sub.nextBillingDate}`,
  );
  return {
    richMessage: {
      blocks: [
        { type: "paragraph", text: `${title} · ${items.length} items` },
        ...(subtitle ? [{ type: "paragraph" as const, text: subtitle }] : []),
        ...(items.length === 1
          ? [{ type: "paragraph" as const, text: lines[0] }]
          : [
              {
                type: "table" as const,
                is_compact: true as const,
                is_bordered: true as const,
                cells: [
                  [
                    richTableCell("Subscription", { header: true }),
                    richTableCell("Amount", { header: true, align: "right" }),
                    richTableCell("Date", { header: true }),
                  ],
                  ...items.map((sub) => [
                    richTableCell(`${sub.name}\n${reminderKind(sub)}`),
                    richTableCell(subscriptionPrice(sub), { align: "right" }),
                    richTableCell(sub.nextBillingDate),
                  ]),
                ],
              },
            ]),
        ...(items.some(isTrialSubscription)
          ? [
              {
                type: "paragraph" as const,
                text: "Charges may begin when the trial ends.",
              },
            ]
          : []),
      ],
    },
    plainText: [
      `${title} · ${items.length} items`,
      subtitle,
      ...lines,
      ...(items.some(isTrialSubscription)
        ? ["Charges may begin when the trial ends."]
        : []),
    ]
      .filter(Boolean)
      .join("\n"),
    replyMarkup: keyboard,
  };
}
