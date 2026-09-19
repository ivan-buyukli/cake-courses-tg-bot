import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createLogger } from "../../utils/logger.js";
import { parseListCallbackData } from "../../utils/callbackParser.js";
import {
  getTotalPages,
  buildEditFieldKeyboard,
  buildDeleteConfirmKeyboard,
} from "../keyboards/listManagerKeyboard.js";
import type { Subscription } from "../../models/subscription.js";
import {
  listPresentation,
  detailPresentation,
} from "../ui/subscriptionPresentation.js";
import { editRichOrPlain, editPlainMessage } from "../ui/richMessage.js";
import { InlineKeyboard } from "grammy";
import {
  emptySubscriptionsKeyboard,
  expiredPanelKeyboard,
} from "../ui/navigation.js";

type Logger = ReturnType<typeof createLogger>;
const answeredCallbacks = new WeakSet<object>();

const PANEL_MAX_AGE_SECONDS = 3600;
const EXPIRED_PANEL_MESSAGE =
  "This management panel has expired. Please open it again.";

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

function isPanelExpired(ctx: BotContext): boolean {
  const messageDate = ctx.callbackQuery?.message?.date;
  if (!messageDate) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds - messageDate > PANEL_MAX_AGE_SECONDS;
}

async function handleExpiredPanel(
  ctx: BotContext,
  _logger: Logger,
): Promise<void> {
  await safeAnswerCallbackQuery(ctx, EXPIRED_PANEL_MESSAGE);
  await safeEditMessageText(
    ctx,
    "⏳ This management panel has expired.\n\nReload your subscriptions before making further changes.",
    { reply_markup: expiredPanelKeyboard("list") },
  );
}

async function fetchSortedSubscriptions(
  userKey: string,
  kv: KVNamespace,
  encryptionKey: string,
): Promise<Subscription[]> {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  const service = createSubscriptionService(repo, reminderRepo);
  const subs = await service.list(userKey, encryptionKey);
  return subs.sort((a, b) => {
    const statusA = a.status === "paused" ? 1 : 0;
    const statusB = b.status === "paused" ? 1 : 0;
    if (statusA !== statusB) return statusA - statusB;
    return (
      new Date(a.nextBillingDate).getTime() -
      new Date(b.nextBillingDate).getTime()
    );
  });
}

function createService(ctx: BotContext) {
  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  return createSubscriptionService(repo, reminderRepo);
}

async function showListPage(
  ctx: BotContext,
  subs: Subscription[],
  page: number,
): Promise<void> {
  const tp = getTotalPages(subs);
  let adjustedPage = page;
  if (adjustedPage >= tp) {
    adjustedPage = Math.max(0, tp - 1);
  }
  await editRichOrPlain(ctx, listPresentation(subs, adjustedPage));
}

async function showDetail(
  ctx: BotContext,
  sub: Subscription,
  page: number,
): Promise<void> {
  await editRichOrPlain(ctx, detailPresentation(sub, page));
}

export async function listPageCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "page") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const subs = await fetchSortedSubscriptions(
      ctx.userKey,
      ctx.env.SUBSCRIPTION_KV,
      ctx.env.ENCRYPTION_KEY,
    );

    if (subs.length === 0) {
      await safeAnswerCallbackQuery(ctx);
      await safeEditMessageText(
        ctx,
        "You have not added any subscriptions yet.",
        {
          reply_markup: emptySubscriptionsKeyboard(),
        },
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showListPage(ctx, subs, parsed.page);

    logger.info("List page viewed via callback", { page: parsed.page });
  } catch (error) {
    logger.error("Error in listPageCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listSelectCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "select") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const service = createService(ctx);
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
    await showDetail(ctx, sub, parsed.page);

    logger.info("Subscription selected via callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listSelectCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listDetailCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "detail") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.",
          {
            reply_markup: emptySubscriptionsKeyboard(),
          },
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showDetail(ctx, sub, parsed.page);

    logger.info("Subscription detail viewed via callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listDetailCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listBackCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "back") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const subs = await fetchSortedSubscriptions(
      ctx.userKey,
      ctx.env.SUBSCRIPTION_KV,
      ctx.env.ENCRYPTION_KEY,
    );

    if (subs.length === 0) {
      await safeAnswerCallbackQuery(ctx);
      await safeEditMessageText(
        ctx,
        "You have not added any subscriptions yet.",
        {
          reply_markup: emptySubscriptionsKeyboard(),
        },
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showListPage(ctx, subs, parsed.page);

    logger.info("Back to list via callback", { page: parsed.page });
  } catch (error) {
    logger.error("Error in listBackCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listEditCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "edit") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.",
          {
            reply_markup: emptySubscriptionsKeyboard(),
          },
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(
      ctx,
      `Edit fields for "${sub.name}": choose a field.`,
      {
        reply_markup: buildEditFieldKeyboard(parsed.subId, parsed.page),
      },
    );

    logger.info("Edit menu opened via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listEditCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listPauseCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "pause") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "Updating…");

    const service = createService(ctx);
    const sub = await service.pause(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.",
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx, "Paused.");
    await showDetail(ctx, sub, parsed.page);

    logger.info("Subscription paused via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listPauseCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listResumeCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "resume") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await ctx.conversation.enter("resume", parsed.subId, {
      source: "listManager",
      page: parsed.page,
      panel: currentPanel(ctx),
    });
  } catch (error) {
    logger.error("Error in listResumeCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listDelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "del") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.",
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `Delete "${sub.name}"?`, {
      reply_markup: buildDeleteConfirmKeyboard(parsed.subId, parsed.page),
    });

    logger.info("Delete confirmation requested via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listDelCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listDeleteConfirmCallback(
  ctx: BotContext,
): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "delok") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "Deleting…");

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Already deleted.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.\nSend /add to add your first subscription.",
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await service.remove(ctx.userKey, parsed.subId);

    logger.info("Subscription deleted via list callback", {
      subId: parsed.subId,
    });

    const subs = await fetchSortedSubscriptions(
      ctx.userKey,
      ctx.env.SUBSCRIPTION_KV,
      ctx.env.ENCRYPTION_KEY,
    );

    await safeAnswerCallbackQuery(ctx, " has been deleted.");

    if (subs.length === 0) {
      await safeEditMessageText(
        ctx,
        `"${sub.name}" has been deleted.\n\nYou have not added any subscriptions yet.`,
        { reply_markup: emptySubscriptionsKeyboard() },
      );
      return;
    }

    const tp = getTotalPages(subs);
    let adjustedPage = parsed.page;
    if (adjustedPage >= tp) {
      adjustedPage = Math.max(0, tp - 1);
    }
    await showListPage(ctx, subs, adjustedPage);
  } catch (error) {
    logger.error("Error in listDeleteConfirmCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listDeleteCancelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "delno") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "Subscription not found.");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "Subscription not found, or it has been deleted.",
        );
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx, "Cancelled.");
    await showDetail(ctx, sub, parsed.page);

    logger.info("Delete cancelled via list callback");
  } catch (error) {
    logger.error("Error in listDeleteCancelCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function listEditFieldCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "editField") {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const { subId, field, page } = parsed;

    if (field === "trial" || field === "autorenew") {
      const service = createService(ctx);
      const sub = await service.get(ctx.userKey, subId, ctx.env.ENCRYPTION_KEY);

      if (!sub) {
        await safeAnswerCallbackQuery(ctx, "Subscription not found.");
        const subs = await fetchSortedSubscriptions(
          ctx.userKey,
          ctx.env.SUBSCRIPTION_KV,
          ctx.env.ENCRYPTION_KEY,
        );
        if (subs.length === 0) {
          await safeEditMessageText(
            ctx,
            "Subscription not found, or it has been deleted.",
          );
        } else {
          await showListPage(ctx, subs, page);
        }
        return;
      }

      const updated: Subscription =
        field === "trial"
          ? {
              ...sub,
              isTrial: !sub.isTrial,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...sub,
              autoRenew: sub.autoRenew === false,
              updatedAt: new Date().toISOString(),
            };

      await service.update(ctx.userKey, updated, ctx.env.ENCRYPTION_KEY);
      await safeAnswerCallbackQuery(
        ctx,
        field === "trial"
          ? updated.isTrial
            ? "Marked as a trial."
            : "Trial status removed."
          : updated.autoRenew
            ? "Auto-renewal enabled."
            : "Auto-renewal disabled.",
      );
      await showDetail(ctx, updated, page);

      logger.info("Subscription flag toggled via list callback", {
        subId,
        field,
      });
      return;
    }

    const options = {
      source: "listManager" as const,
      page,
      panel: currentPanel(ctx),
    };
    switch (field) {
      case "cycle":
        await ctx.conversation.enter("editCycle", subId, options);
        return;
      case "reminder":
        await ctx.conversation.enter("editReminder", subId, options);
        return;
      default:
        await ctx.conversation.enter("editField", subId, field, options);
    }
  } catch (error) {
    logger.error("Error in listEditFieldCallback", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

function currentPanel(
  ctx: BotContext,
): { chatId: number; messageId: number } | undefined {
  const message = ctx.callbackQuery?.message;
  if (!message) return undefined;
  return { chatId: message.chat.id, messageId: message.message_id };
}
