import { Middleware } from "grammy";
import { BotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";

export const errorHandler: Middleware<BotContext> = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const logger = createLogger(ctx.requestId);

    logger.error("Bot error occurred", {
      error: error instanceof Error ? error.name : "UnknownError",
      hasUserKey: !!ctx.userKey,
      // Do not log raw Telegram user IDs or full updates
    });

    try {
      await ctx.reply("发生了意外错误，请稍后再试。");
    } catch {
      // If replying fails, silently fail to avoid leaking errors
    }
  }
};
