import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createLogger } from "../../utils/logger.js";
import { parseListCallbackData } from "../../utils/callbackParser.js";
import {
  getTotalPages,
  buildListPageText,
  buildListPageKeyboard,
  buildDetailKeyboard,
  buildEditFieldKeyboard,
  buildDeleteConfirmKeyboard,
} from "../keyboards/listManagerKeyboard.js";
import type { Subscription } from "../../models/subscription.js";
import { formatSubscriptionDetails } from "../../utils/formatSubscription.js";
import { InlineKeyboard } from "grammy";
import {
  emptySubscriptionsKeyboard,
  expiredPanelKeyboard,
} from "../ui/navigation.js";

type Logger = ReturnType<typeof createLogger>;
const answeredCallbacks = new WeakSet<object>();

const PANEL_MAX_AGE_SECONDS = 3600;
const EXPIRED_PANEL_MESSAGE = "这个管理面板已过期，请重新打开。";

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
  try {
    await ctx.editMessageText(text, options);
  } catch {
    // Message may have been deleted or already edited
  }
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
    "⏳ 这个管理面板已过期。\n\n为避免误操作，请重新加载最新订阅数据。",
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
  const text = buildListPageText(adjustedPage, tp);
  const keyboard = buildListPageKeyboard(subs, adjustedPage);
  await safeEditMessageText(ctx, text, { reply_markup: keyboard });
}

async function showDetail(
  ctx: BotContext,
  sub: Subscription,
  page: number,
): Promise<void> {
  const text = formatSubscriptionDetails(sub);
  const keyboard = buildDetailKeyboard(sub, page);
  await safeEditMessageText(ctx, text, { reply_markup: keyboard });
}

export async function listPageCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "page") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeEditMessageText(ctx, "你还没有添加任何订阅。", {
        reply_markup: emptySubscriptionsKeyboard(),
      });
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showListPage(ctx, subs, parsed.page);

    logger.info("List page viewed via callback", { page: parsed.page });
  } catch (error) {
    logger.error("Error in listPageCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listSelectCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "select") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showDetail(ctx, sub, parsed.page);

    logger.info("Subscription selected via callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listSelectCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listDetailCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "detail") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。", {
          reply_markup: emptySubscriptionsKeyboard(),
        });
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
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listBackCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "back") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeEditMessageText(ctx, "你还没有添加任何订阅。", {
        reply_markup: emptySubscriptionsKeyboard(),
      });
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await showListPage(ctx, subs, parsed.page);

    logger.info("Back to list via callback", { page: parsed.page });
  } catch (error) {
    logger.error("Error in listBackCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listEditCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "edit") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。", {
          reply_markup: emptySubscriptionsKeyboard(),
        });
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `要编辑"${sub.name}"的哪一项？`, {
      reply_markup: buildEditFieldKeyboard(parsed.subId, parsed.page),
    });

    logger.info("Edit menu opened via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listEditCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listPauseCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "pause") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "正在更新…");

    const service = createService(ctx);
    const sub = await service.pause(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx, "已暂停。");
    await showDetail(ctx, sub, parsed.page);

    logger.info("Subscription paused via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listPauseCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listResumeCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "resume") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listDelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "del") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `确认删除"${sub.name}"吗？`, {
      reply_markup: buildDeleteConfirmKeyboard(parsed.subId, parsed.page),
    });

    logger.info("Delete confirmation requested via list callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in listDelCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listDeleteConfirmCallback(
  ctx: BotContext,
): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "delok") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "正在删除…");

    const service = createService(ctx);
    const sub = await service.get(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
    );

    if (!sub) {
      await safeAnswerCallbackQuery(ctx, "已经删除。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(
          ctx,
          "没有找到这个订阅，或它已被删除。\n发送 /add 添加第一个订阅。",
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

    await safeAnswerCallbackQuery(ctx, "已删除。");

    if (subs.length === 0) {
      await safeEditMessageText(
        ctx,
        `"${sub.name}"已删除。\n\n你还没有添加任何订阅。`,
        { reply_markup: emptySubscriptionsKeyboard() },
      );
      return;
    }

    const tp = getTotalPages(subs);
    let adjustedPage = parsed.page;
    if (adjustedPage >= tp) {
      adjustedPage = Math.max(0, tp - 1);
    }
    const text = `"${sub.name}"已删除。\n\n${buildListPageText(adjustedPage, tp)}`;
    const keyboard = buildListPageKeyboard(subs, adjustedPage);
    await safeEditMessageText(ctx, text, { reply_markup: keyboard });
  } catch (error) {
    logger.error("Error in listDeleteConfirmCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listDeleteCancelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "delno") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      const subs = await fetchSortedSubscriptions(
        ctx.userKey,
        ctx.env.SUBSCRIPTION_KV,
        ctx.env.ENCRYPTION_KEY,
      );
      if (subs.length === 0) {
        await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      } else {
        await showListPage(ctx, subs, parsed.page);
      }
      return;
    }

    await safeAnswerCallbackQuery(ctx, "已取消。");
    await showDetail(ctx, sub, parsed.page);

    logger.info("Delete cancelled via list callback");
  } catch (error) {
    logger.error("Error in listDeleteCancelCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function listEditFieldCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    if (isPanelExpired(ctx)) {
      await handleExpiredPanel(ctx, logger);
      return;
    }

    const parsed = parseListCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "editField") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
      return;
    }
    await safeAnswerCallbackQuery(ctx);

    const { subId, field, page } = parsed;

    if (field === "trial" || field === "autorenew") {
      const service = createService(ctx);
      const sub = await service.get(ctx.userKey, subId, ctx.env.ENCRYPTION_KEY);

      if (!sub) {
        await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
        const subs = await fetchSortedSubscriptions(
          ctx.userKey,
          ctx.env.SUBSCRIPTION_KV,
          ctx.env.ENCRYPTION_KEY,
        );
        if (subs.length === 0) {
          await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
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
            ? "已标记为体验。"
            : "已取消体验标记。"
          : updated.autoRenew
            ? "已开启自动续费。"
            : "已关闭自动续费。",
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
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

function currentPanel(
  ctx: BotContext,
): { chatId: number; messageId: number } | undefined {
  const message = ctx.callbackQuery?.message;
  if (!message) return undefined;
  return { chatId: message.chat.id, messageId: message.message_id };
}
