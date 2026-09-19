import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { confirmationKeyboard } from "../keyboards/confirmationKeyboard.js";
import { editMenuKeyboard } from "../keyboards/editMenuKeyboard.js";
import { subscriptionActionsKeyboard } from "../keyboards/subscriptionActionsKeyboard.js";
import { createLogger } from "../../utils/logger.js";
import {
  parseReminderCallbackData,
  parseSubCallbackData,
} from "../../utils/callbackParser.js";
import { InlineKeyboard } from "grammy";
import { detailPresentation } from "../ui/subscriptionPresentation.js";
import { editRichOrPlain, editPlainMessage } from "../ui/richMessage.js";
import { isMessageNotModified } from "../../utils/telegramErrors.js";

const answeredCallbacks = new WeakSet<object>();

async function safeAnswerCallbackQuery(
  ctx: BotContext,
  text?: string,
): Promise<void> {
  if (answeredCallbacks.has(ctx)) return;
  try {
    await ctx.answerCallbackQuery(text);
    answeredCallbacks.add(ctx);
  } catch {
    // Ignore if answering fails (e.g., query too old)
  }
}

async function safeEditMessageText(
  ctx: BotContext,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<void> {
  await editPlainMessage(ctx, text, options);
}

export async function subViewCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      await safeEditMessageText(
        ctx,
        "Subscription not found, or it has been deleted.",
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await editRichOrPlain(ctx, detailPresentation(sub));

    logger.info("Viewed subscription via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subViewCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function subEditCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      await safeEditMessageText(
        ctx,
        "Subscription not found, or it has been deleted.",
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(
      ctx,
      `Edit fields for "${sub.name}": choose a field.`,
      {
        reply_markup: editMenuKeyboard(parsed.subId),
      },
    );

    logger.info("Edit menu opened via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subEditCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function subDeleteCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      await safeEditMessageText(
        ctx,
        "Subscription not found, or it has been deleted.",
      );
      return;
    }

    logger.info("Delete confirmation requested via callback", {
      subId: parsed.subId,
    });

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `Delete "${sub.name}"?`, {
      reply_markup: confirmationKeyboard("delete", parsed.subId),
    });
  } catch (error) {
    logger.error("Error in subDeleteCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function subPauseCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "pause") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const sub = await service.pause(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      await safeEditMessageText(
        ctx,
        "Subscription not found, or it has been deleted.",
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `Paused "${sub.name}".`, {
      reply_markup: subscriptionActionsKeyboard(sub.id, sub.status),
    });

    logger.info("Subscription paused via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subPauseCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function subResumeCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "resume") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await ctx.conversation.enter("resume", parsed.subId);
  } catch (error) {
    logger.error("Error in subResumeCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function reminderRenewCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseReminderCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "Updating…");

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const result = await service.renewOneCycle(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
      parsed.billingDate,
    );

    if (result.status !== "unsupported") {
      const rows =
        ctx.callbackQuery?.message?.reply_markup?.inline_keyboard ?? [];
      const remaining = rows
        .map((row) =>
          row.filter(
            (button) =>
              !("callback_data" in button) ||
              button.callback_data !== ctx.callbackQuery?.data,
          ),
        )
        .filter((row) => row.length > 0);
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: { inline_keyboard: remaining },
        });
      } catch (error) {
        if (!isMessageNotModified(error)) {
          logger.warn("Could not refresh reminder controls", {
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
    }
    if (result.status === "not_found") {
      await ctx.reply("Subscription not found, or it has been deleted.");
      return;
    }
    if (result.status === "stale") {
      await ctx.reply(
        `This reminder has already been processed. Next date: ${result.subscription.nextBillingDate}`,
      );
      return;
    }
    if (result.status === "unsupported") {
      await ctx.reply("Update this subscription's date manually.", {
        reply_markup: new InlineKeyboard().text(
          "View details",
          `sub:view:${parsed.subId}`,
        ),
      });
      return;
    }
    await ctx.reply(
      `Recorded renewal for “${result.subscription.name}”. Next date: ${result.subscription.nextBillingDate}`,
    );

    logger.info("Subscription renewed from reminder callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in reminderRenewCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}
