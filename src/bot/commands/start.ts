import { BotContext } from "../../types/context.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function startCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply(
      "Welcome to Subscription Bot.\n\n" +
        "I can track your recurring subscriptions, remind you about upcoming payments, and summarize your monthly spending.\n\n" +
        "Use the bottom menu to get started.",
      { reply_markup: mainMenuReplyKeyboard() },
    );
    logger.info("Start command without userKey");
    return;
  }

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  if (await userRepo.isUserDeleted(ctx.userKey)) {
    await userRepo.clearUserDeleted(ctx.userKey);
    if (ctx.chat?.id) {
      await userRepo.upsertUserProfile(
        ctx.userKey,
        ctx.chat.id,
        ctx.env.ENCRYPTION_KEY,
      );
    }
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const existingIds = await repo.listIds(ctx.userKey);
  const isFirstTime = existingIds.length === 0;

  if (isFirstTime) {
    await ctx.reply(
      "Welcome to Subscription Bot.\n\n" +
        "I can track your recurring subscriptions, remind you about upcoming payments, and summarize your monthly spending.\n\n" +
        "Use the bottom menu to add your first subscription.",
      {
        reply_markup: mainMenuReplyKeyboard(),
      },
    );
    logger.info("Start command: first-time welcome");
  } else {
    await ctx.reply(
      "Welcome back.\n\n" +
        "Use the bottom menu to view subscriptions, reminders, and reports.",
      {
        reply_markup: mainMenuReplyKeyboard(),
      },
    );
    logger.info("Start command: returning user welcome", {
      subscriptionCount: existingIds.length,
    });
  }
}
