import { InputFile } from "grammy";
import type { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import {
  buildReportData,
  buildTextReportData,
  formatReportText,
} from "../../services/reportService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createReportConfigRepository } from "../../repositories/reportConfigRepository.js";
import { renderReportOverviewPng } from "../../utils/reportPng.js";
import { createLogger } from "../../utils/logger.js";
import {
  emptySubscriptionsKeyboard,
  reportActionsKeyboard,
} from "../ui/navigation.js";

export async function reportCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    logger.warn("Report command without userKey");
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
    await ctx.reply("你还没有添加任何订阅。", {
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

  const report = buildReportData(
    subscriptions,
    exchangeRates,
    timezone,
    settings.defaultCurrency,
  );
  const textReport = buildTextReportData(
    subscriptions,
    exchangeRates,
    timezone,
    settings.defaultCurrency,
  );
  const fallbackText = formatReportText(report);

  try {
    if (ctx.chat) {
      await ctx.api.sendChatAction(ctx.chat.id, "upload_photo");
    }
    const overviewPng = await renderReportOverviewPng(
      report,
      textReport.currentMonthItems,
    );

    await ctx.replyWithPhoto(
      new InputFile(overviewPng, "subscription-spending-overview.png"),
      {
        caption: "订阅支出总览。发送 /report_text 查看完整明细。",
        reply_markup: reportActionsKeyboard(),
      },
    );
    logger.info("Report generated", {
      subscriptionCount: report.subscriptionCount,
      currentMonthlyIncludedCount: report.currentMonthly.includedCount,
      currentMonthlyConvertedCount: report.currentMonthly.convertedCount,
      currentMonthlyMissingRateCount:
        report.currentMonthly.missingRateCurrencies.length,
      currentMonthDueIncludedCount: report.currentMonthDue.includedCount,
      currentMonthDueConvertedCount: report.currentMonthDue.convertedCount,
      currentMonthDueMissingRateCount:
        report.currentMonthDue.missingRateCurrencies.length,
      yearlyProjectionIncludedCount: report.yearlyProjection.includedCount,
      yearlyProjectionConvertedCount: report.yearlyProjection.convertedCount,
      yearlyProjectionMissingRateCount:
        report.yearlyProjection.missingRateCurrencies.length,
    });
  } catch (error) {
    logger.warn("Report PNG failed; sent text fallback", {
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizeReportErrorMessage(error, textReport),
      subscriptionCount: report.subscriptionCount,
      currentMonthlyIncludedCount: report.currentMonthly.includedCount,
      currentMonthlyConvertedCount: report.currentMonthly.convertedCount,
      currentMonthlyMissingRateCount:
        report.currentMonthly.missingRateCurrencies.length,
      currentMonthDueIncludedCount: report.currentMonthDue.includedCount,
      currentMonthDueConvertedCount: report.currentMonthDue.convertedCount,
      currentMonthDueMissingRateCount:
        report.currentMonthDue.missingRateCurrencies.length,
      yearlyProjectionIncludedCount: report.yearlyProjection.includedCount,
      yearlyProjectionConvertedCount: report.yearlyProjection.convertedCount,
      yearlyProjectionMissingRateCount:
        report.yearlyProjection.missingRateCurrencies.length,
    });
    await ctx.reply(fallbackText, {
      reply_markup: reportActionsKeyboard(),
    });
  }
}

function sanitizeReportErrorMessage(
  error: unknown,
  textReport: ReturnType<typeof buildTextReportData>,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  let sanitized = raw.slice(0, 300);
  const names = new Set<string>();
  for (const item of textReport.currentMonthItems) names.add(item.name);
  for (const month of textReport.yearMonthItems) {
    for (const item of month.items) names.add(item.name);
  }

  for (const name of names) {
    if (name) sanitized = sanitized.split(name).join("[redacted]");
  }

  return sanitized;
}
