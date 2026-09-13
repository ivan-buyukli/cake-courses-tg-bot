import { InlineKeyboard } from "grammy";
import type { Subscription } from "../../models/subscription.js";
import { formatBillingCycle, formatStatus } from "../../utils/labels.js";
import {
  formatAutoRenew,
  formatBillingDateLabel,
  formatSubscriptionType,
  isAutoRenewing,
  isTrialSubscription,
} from "../../utils/subscriptionFlags.js";
import { formatReminderPolicy } from "../../utils/reminderPolicy.js";
import { formatSubscriptionDetails } from "../../utils/formatSubscription.js";
import {
  LIST_PAGE_SIZE,
  getTotalPages,
  buildListPageKeyboard,
  buildDetailKeyboard,
} from "../keyboards/listManagerKeyboard.js";
import { richTableCell, type MessagePresentation } from "./richMessage.js";

export function subscriptionPrice(sub: Subscription): string {
  return sub.price === undefined
    ? "—"
    : `${sub.price}${sub.currency ? ` ${sub.currency}` : ""}`;
}

export function subscriptionTag(sub: Subscription): string {
  return [
    sub.status === "paused" ? "暂停" : "",
    isTrialSubscription(sub) ? "体验" : "",
    !isAutoRenewing(sub) ? "已停续费" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function listPresentation(
  subs: Subscription[],
  requestedPage: number,
): MessagePresentation {
  const totalPages = getTotalPages(subs);
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const start = page * LIST_PAGE_SIZE;
  const items = subs.slice(start, start + LIST_PAGE_SIZE);
  const title = `你的订阅 · ${subs.length} 项 · 第 ${page + 1}/${totalPages} 页`;
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("← 上一页", `list:page:${page - 1}`);
  if (page < totalPages - 1) keyboard.text("下一页 →", `list:page:${page + 1}`);
  const date = (sub: Subscription) =>
    sub.status === "paused" ? "已暂停" : sub.nextBillingDate;
  return {
    richMessage: {
      blocks: [
        { type: "paragraph", text: title },
        {
          type: "table",
          is_compact: true,
          is_bordered: true,
          cells: [
            [
              richTableCell("订阅", { header: true }),
              richTableCell("金额", { header: true, align: "right" }),
              richTableCell("下次日期", { header: true }),
            ],
            ...items.map((sub) => [
              richTableCell([
                {
                  type: "button" as const,
                  button: {
                    text: sub.name,
                    style: "link" as const,
                    callback_data: `list:select:${sub.id}:${page}`,
                  },
                },
                ...(subscriptionTag(sub) ? [`\n${subscriptionTag(sub)}`] : []),
              ]),
              richTableCell(subscriptionPrice(sub), { align: "right" }),
              richTableCell(date(sub)),
            ]),
          ],
        },
      ],
    },
    plainText: `${title}\n\n${items.map((sub, i) => `${start + i + 1}. ${sub.name}${subscriptionTag(sub) ? ` · ${subscriptionTag(sub)}` : ""}\n${subscriptionPrice(sub)} · ${date(sub)}`).join("\n")}`,
    replyMarkup: keyboard,
    plainReplyMarkup: buildListPageKeyboard(subs, page),
  };
}

export function detailPresentation(
  sub: Subscription,
  page = 0,
): MessagePresentation {
  const fields = [
    ["订阅", sub.name],
    [
      "金额 / 周期",
      `${subscriptionPrice(sub)} · ${formatBillingCycle(sub.billingCycle, sub.billingInterval)}`,
    ],
    [formatBillingDateLabel(sub), sub.nextBillingDate],
    [
      "状态 / 类型",
      `${formatStatus(sub.status)} · ${formatSubscriptionType(sub)}`,
    ],
    ["自动续费", formatAutoRenew(sub)],
    ["提醒", formatReminderPolicy(sub)],
    ...(sub.category ? [["分类", sub.category]] : []),
  ];
  return {
    richMessage: {
      blocks: [
        {
          type: "table",
          is_compact: true,
          is_bordered: true,
          cells: fields.map(([label, value]) => [
            richTableCell(label),
            richTableCell(value),
          ]),
        },
        ...(sub.note
          ? [
              {
                type: "details" as const,
                summary: "备注",
                blocks: [{ type: "paragraph" as const, text: sub.note }],
              },
            ]
          : []),
      ],
    },
    plainText: formatSubscriptionDetails(sub),
    replyMarkup: buildDetailKeyboard(sub, page),
  };
}
