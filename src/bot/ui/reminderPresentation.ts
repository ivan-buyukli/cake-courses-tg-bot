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
    ? "体验到期"
    : !isAutoRenewing(sub)
      ? "服务到期"
      : "扣款";
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
  title = "订阅提醒",
  subtitle?: string,
): MessagePresentation {
  const items = sortReminders(subs);
  const keyboard = new InlineKeyboard();
  for (const sub of items.filter(canRenewOneCycle)) {
    keyboard
      .text(
        `已续费 · ${sub.name}`,
        `reminder:renew:${sub.id}:${sub.nextBillingDate}`,
      )
      .success()
      .row();
  }
  keyboard.text("管理订阅", "nav:list");
  const lines = items.map(
    (sub) =>
      `${sub.name} · ${reminderKind(sub)}\n${subscriptionPrice(sub)} · ${sub.nextBillingDate}`,
  );
  return {
    richMessage: {
      blocks: [
        { type: "paragraph", text: `${title} · ${items.length} 项` },
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
                    richTableCell("订阅", { header: true }),
                    richTableCell("金额", { header: true, align: "right" }),
                    richTableCell("日期", { header: true }),
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
          ? [{ type: "paragraph" as const, text: "体验到期后可能开始扣款。" }]
          : []),
      ],
    },
    plainText: [
      `${title} · ${items.length} 项`,
      subtitle,
      ...lines,
      ...(items.some(isTrialSubscription) ? ["体验到期后可能开始扣款。"] : []),
    ]
      .filter(Boolean)
      .join("\n"),
    replyMarkup: keyboard,
  };
}
