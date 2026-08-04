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
import { formatBillingCycle, formatStatus } from "../../utils/labels.js";
import type { Subscription } from "../../models/subscription.js";
import {
  formatAutoRenew,
  formatBillingDateLabel,
  formatStatusPrefix,
  formatSubscriptionType,
} from "../../utils/subscriptionFlags.js";

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
  try {
    await ctx.editMessageText(text, options);
  } catch {
    // Message may have been deleted or already edited
  }
}

export function formatSubDetails(sub: Subscription): string {
  const lines: string[] = [`${formatStatusPrefix(sub)}${sub.name}`];
  if (sub.price !== undefined) {
    lines.push(`价格：${sub.price} ${sub.currency ?? ""}`.trim());
  }
  lines.push(
    `周期：${formatBillingCycle(sub.billingCycle, sub.billingInterval)}`,
  );
  lines.push(`类型：${formatSubscriptionType(sub)}`);
  lines.push(`自动续费：${formatAutoRenew(sub)}`);
  lines.push(`${formatBillingDateLabel(sub)}：${sub.nextBillingDate}`);
  lines.push(`状态：${formatStatus(sub.status)}`);
  if (sub.category) lines.push(`分类：${sub.category}`);
  if (sub.note) lines.push(`备注：${sub.note}`);
  return lines.join("\n");
}

export async function subViewCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    const text = formatSubDetails(sub);
    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, text);

    logger.info("Viewed subscription via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subViewCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function subEditCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `要编辑"${sub.name}"的哪一项？`, {
      reply_markup: editMenuKeyboard(parsed.subId),
    });

    logger.info("Edit menu opened via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subEditCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function subDeleteCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    logger.info("Delete confirmation requested via callback", {
      subId: parsed.subId,
    });

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `确认删除"${sub.name}"吗？`, {
      reply_markup: confirmationKeyboard("delete", parsed.subId),
    });
  } catch (error) {
    logger.error("Error in subDeleteCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function subPauseCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "pause") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
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
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await safeEditMessageText(ctx, `已暂停"${sub.name}"。`, {
      reply_markup: subscriptionActionsKeyboard(sub.id, sub.status),
    });

    logger.info("Subscription paused via callback", { subId: parsed.subId });
  } catch (error) {
    logger.error("Error in subPauseCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function subResumeCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseSubCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed || parsed.action !== "resume") {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
      return;
    }

    await safeAnswerCallbackQuery(ctx);
    await ctx.conversation.enter("resume", parsed.subId);
  } catch (error) {
    logger.error("Error in subResumeCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}

export async function reminderRenewCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "无法识别用户。");
      return;
    }

    const parsed = parseReminderCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "按钮数据无效。");
      return;
    }
    await safeAnswerCallbackQuery(ctx, "正在更新…");

    const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, reminderRepo);
    const result = await service.renewOneCycle(
      ctx.userKey,
      parsed.subId,
      ctx.env.ENCRYPTION_KEY,
      parsed.billingDate,
    );

    if (result.status === "not_found") {
      await safeAnswerCallbackQuery(ctx, "没有找到这个订阅。");
      await safeEditMessageText(ctx, "没有找到这个订阅，或它已被删除。");
      return;
    }

    if (result.status === "stale") {
      await safeAnswerCallbackQuery(ctx, "这条提醒已经处理过。");
      await safeEditMessageText(
        ctx,
        `这条提醒已经处理过。\n当前下次日期：${result.subscription.nextBillingDate}`,
      );
      return;
    }

    if (result.status === "unsupported") {
      await safeAnswerCallbackQuery(ctx, "这个订阅无法自动计算下个周期。");
      await safeEditMessageText(
        ctx,
        "这个订阅无法自动计算下个周期，请发送 /list 后在详情中手动更新日期。",
      );
      return;
    }

    await safeAnswerCallbackQuery(ctx, "已更新下次日期。");
    await safeEditMessageText(
      ctx,
      `已记录"${result.subscription.name}"已续费一个周期。\n下次日期：${result.subscription.nextBillingDate}`,
    );

    logger.info("Subscription renewed from reminder callback", {
      subId: parsed.subId,
    });
  } catch (error) {
    logger.error("Error in reminderRenewCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(ctx, "操作失败，请稍后再试。");
  }
}
