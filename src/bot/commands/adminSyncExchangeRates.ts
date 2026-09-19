import type { BotContext } from "../../types/context.js";
import { createReportConfigRepository } from "../../repositories/reportConfigRepository.js";
import { fetchXCurrencyExchangeRates } from "../../services/xcurrencyService.js";
import { createLogger } from "../../utils/logger.js";

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

export async function adminSyncExchangeRatesCommand(
  ctx: BotContext,
): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.isAdmin) {
    await ctx.reply("This command is only available to admins.");
    logger.warn("Non-admin attempted exchange-rate sync command");
    return;
  }

  const apiKey = ctx.env.XCURRENCY_API_KEY?.trim();
  if (!apiKey) {
    await ctx.reply(
      "XCURRENCY_API_KEY is not configured. Exchange-rate sync was skipped.",
    );
    logger.warn("Exchange-rate sync skipped without API key");
    return;
  }

  try {
    const result = await fetchXCurrencyExchangeRates(apiKey);
    const repo = createReportConfigRepository(ctx.env.SUBSCRIPTION_KV);
    await repo.putXCurrencyExchangeRates(result.exchangeRates);

    await ctx.reply(
      [
        "XCurrency exchange rates synced.",
        `Currency count: ${result.currencyCount}`,
        `Data timestamp: ${formatTimestamp(result.timestamp)}`,
      ].join("\n"),
    );
    logger.info("XCurrency exchange rates synced", {
      currencyCount: result.currencyCount,
      rateTimestamp: result.timestamp,
    });
  } catch (error) {
    await ctx.reply(
      "XCurrency exchange rate sync failed. Please try again later.",
    );
    logger.warn("XCurrency exchange-rate sync failed", {
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : "unknown error",
    });
  }
}
