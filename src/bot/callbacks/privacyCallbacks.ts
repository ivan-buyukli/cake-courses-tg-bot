import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createPrivacyService } from "../../services/privacyService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";
import { parsePrivacyCallbackData } from "../../utils/callbackParser.js";

async function safeAnswerCallbackQuery(
  ctx: BotContext,
  text?: string,
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch {
    // Ignore if answering fails
  }
}

async function safeEditMessageText(
  ctx: BotContext,
  text: string,
): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch {
    // Message may have been deleted or already edited
  }
}

export async function privacyDeleteConfirmCallback(
  ctx: BotContext,
): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      await safeEditMessageText(ctx, "Unable to identify your account.");
      logger.warn("Privacy delete confirm callback without userKey");
      return;
    }

    const parsed = parsePrivacyCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }

    const subRepo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    // Exit any active conversations before deleting data
    try {
      await ctx.conversation.exitAll();
    } catch {
      // exitAll may throw if no conversations plugin is active; ignore
    }

    await privacyService.deleteUserData(ctx.userKey);

    logger.info("All user data deleted", {
      // Do not log userKey
    });

    await safeAnswerCallbackQuery(ctx, " has been deleted.");
    await safeEditMessageText(ctx, "Your saved data has been deleted.");
  } catch (error) {
    logger.error("Error in privacyDeleteConfirmCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function privacyDeleteCancelCallback(
  ctx: BotContext,
): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      await safeEditMessageText(ctx, "Unable to identify your account.");
      logger.warn("Privacy delete cancel callback without userKey");
      return;
    }

    logger.info("Privacy deletion cancelled");

    await safeAnswerCallbackQuery(ctx, "Cancelled.");
    await safeEditMessageText(ctx, "Deletion cancelled.");
  } catch (error) {
    logger.error("Error in privacyDeleteCancelCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}
