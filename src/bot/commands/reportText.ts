import type { BotContext } from "../../types/context.js";
import type { InputRichMessage } from "grammy/types";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import {
  buildTextReportData,
  formatTextReport,
} from "../../services/reportService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createReportConfigRepository } from "../../repositories/reportConfigRepository.js";
import { createLogger } from "../../utils/logger.js";
import { formatMoney } from "../../utils/money.js";
import {
  emptySubscriptionsKeyboard,
  reportActionsKeyboard,
} from "../ui/navigation.js";
import { richTableCell, sendRichOrPlain } from "../ui/richMessage.js";

export async function reportTextCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    logger.warn("Report text command without userKey");
    return;
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const configRepo = createReportConfigRepository(ctx.env.SUBSCRIPTION_KV);
  const subscriptionService = createSubscriptionService(repo, reminderRepo);

  const subscriptions = await subscriptionService.list(
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );
  if (subscriptions.length === 0) {
    await ctx.reply("You have not added any subscriptions yet.", {
      reply_markup: emptySubscriptionsKeyboard(),
    });
    return;
  }

  const exchangeRates = await configRepo.getExchangeRates();

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  const settings = await userRepo.getUserSettings(
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );
  const timezone = settings.timezone || "UTC";

  const data = buildTextReportData(
    subscriptions,
    exchangeRates,
    timezone,
    settings.defaultCurrency,
  );
  const chunks = formatTextReport(data);
  const plainText = chunks.join("\n\n");
  const result = await sendRichOrPlain(ctx, {
    richMessage: buildRichReport(data),
    plainText,
    replyMarkup: reportActionsKeyboard(),
  });
  if (result.fallbackErrorType) {
    logger.warn("Rich text report unavailable; sent plain fallback", {
      errorType: result.fallbackErrorType,
    });
  }

  logger.info("Text report generated", {
    subscriptionCount: subscriptions.length,
    currentMonthItemCount: data.currentMonthItems.length,
    yearMonthItemCount: data.yearMonthItems.filter((m) => m.items.length > 0)
      .length,
  });
}

function buildRichReport(
  data: ReturnType<typeof buildTextReportData>,
): InputRichMessage {
  const currentRows = data.currentMonthItems.slice(0, 30).map((item) => [
    richTableCell(item.billingDate ?? "—"),
    richTableCell(item.name),
    richTableCell(formatMoney(item.amount, item.currency), {
      align: "right" as const,
    }),
  ]);
  const yearRows = data.yearMonthItems.map((month) => [
    richTableCell(month.monthKey),
    richTableCell(String(month.items.length), { align: "right" as const }),
    richTableCell(formatMoney(month.totalConverted, data.baseCurrency), {
      align: "right" as const,
    }),
  ]);
  const noteParts: string[] = [];
  if (data.trialCount > 0) noteParts.push(`Trial ${data.trialCount}`);
  if (data.nonRenewingCount > 0) {
    noteParts.push(`Auto-renewal off ${data.nonRenewingCount}`);
  }

  return {
    blocks: [
      { type: "paragraph", text: "Subscription spending details" },
      {
        type: "paragraph",
        text:
          `Next 30 days · ${data.upcomingWindowStart} to ${data.upcomingWindowEnd}\n` +
          `Total ${formatMoney(data.currentMonthTotal, data.baseCurrency)}`,
      },
      ...(noteParts.length > 0
        ? [
            {
              type: "paragraph" as const,
              text: `Excluded from totals: ${noteParts.join(", ")}`,
            },
          ]
        : []),
      ...(currentRows.length > 0
        ? [
            {
              type: "table" as const,
              is_compact: true as const,
              is_bordered: true as const,
              is_striped: true as const,
              cells: [
                [
                  richTableCell("Date", { header: true }),
                  richTableCell("Subscription", { header: true }),
                  richTableCell("Amount", { header: true, align: "right" }),
                ],
                ...currentRows,
              ],
            },
          ]
        : [
            {
              type: "paragraph" as const,
              text: "No payments in the next 30 days.",
            },
          ]),
      ...(data.currentMonthItems.length > 30
        ? [
            {
              type: "paragraph" as const,
              text: `Showing the first 30 of ${data.currentMonthItems.length} items; totals include all items.`,
            },
          ]
        : []),
      { type: "divider" },
      {
        type: "paragraph",
        text: `Next 12 months · ${formatMoney(data.yearTotal, data.baseCurrency)}`,
      },
      {
        type: "details",
        summary: "View monthly totals",
        blocks: [
          {
            type: "table",
            is_compact: true,
            is_bordered: true,
            is_striped: true,
            cells: [
              [
                richTableCell("Month", { header: true }),
                richTableCell("Items", { header: true, align: "right" }),
                richTableCell("Total", { header: true, align: "right" }),
              ],
              ...yearRows,
            ],
          },
        ],
      },
    ],
  };
}
