import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createLogger } from "../../utils/logger.js";
import { parseDeleteCallbackData } from "../../utils/callbackParser.js";

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

export async function deleteConfirmCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      await safeEditMessageText(ctx, "Unable to identify your account.");
      logger.warn("Delete confirm callback without userKey");
      return;
    }

    const parsed = parseDeleteCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);

    // Verify it still exists before deleting (idempotency: if already gone, report safely)
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );
    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Already deleted.");
      await safeEditMessageText(
        ctx,
        "Subscription not found, or it has been deleted.",
      );
      return;
    }

    await service.remove(ctx.userKey, parsed.subId);

    logger.info("Subscription deleted", {
      subId: parsed.subId,
      // Do not log subscription name
    });

    await safeAnswerCallbackQuery(ctx, " has been deleted.");
    await safeEditMessageText(ctx, `“${sub.name}” has been deleted.`);
  } catch (error) {
    logger.error("Error in deleteConfirmCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function deleteCancelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      await safeEditMessageText(ctx, "Unable to identify your account.");
      logger.warn("Delete cancel callback without userKey");
      return;
    }

    logger.info("Delete cancelled");

    await safeAnswerCallbackQuery(ctx, "Cancelled.");
    await safeEditMessageText(ctx, "Deletion cancelled.");
  } catch (error) {
    logger.error("Error in deleteCancelCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}
