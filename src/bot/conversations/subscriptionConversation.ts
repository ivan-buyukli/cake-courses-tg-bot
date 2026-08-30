import type { Conversation } from "@grammyjs/conversations";
import type { Subscription } from "../../models/subscription.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import type { BaseBotContext, BotContext } from "../../types/context.js";
import { formatSubscriptionDetails } from "../../utils/formatSubscription.js";
import { createLogger } from "../../utils/logger.js";
import { buildDetailKeyboard } from "../keyboards/listManagerKeyboard.js";
import { hideMainMenu, restoreMainMenu } from "../ui/conversationUi.js";

export type BotConversation = Conversation<BotContext, BaseBotContext>;

export interface ListManagerConversationOptions {
  source: "listManager";
  page: number;
  panel?: {
    chatId: number;
    messageId: number;
  };
}

export interface SubscriptionConversationSession {
  userKey: string;
  encryptionKey: string;
  logger: ReturnType<typeof createLogger>;
}

export function isFromListManager(
  options?: ListManagerConversationOptions,
): options is ListManagerConversationOptions {
  return options !== undefined;
}

export async function beginSubscriptionConversation(
  conversation: BotConversation,
  ctx: BaseBotContext,
  subId: string,
  prompt: string,
): Promise<
  { session: SubscriptionConversationSession; sub: Subscription } | undefined
> {
  const ctxData = await conversation.external((outsideCtx) => ({
    userKey: outsideCtx.userKey ?? null,
    encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
    requestId: outsideCtx.requestId,
  }));

  if (!ctxData.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    return undefined;
  }

  await hideMainMenu(ctx, prompt);
  const session: SubscriptionConversationSession = {
    userKey: ctxData.userKey,
    encryptionKey: ctxData.encryptionKey,
    logger: createLogger(ctxData.requestId),
  };
  const sub = await loadConversationSubscription(conversation, session, subId);

  if (!sub) {
    await ctx.reply("没有找到这个订阅，或它已被删除。");
    await restoreMainMenu(ctx);
    return undefined;
  }

  return { session, sub };
}

export async function loadConversationSubscription(
  conversation: BotConversation,
  session: SubscriptionConversationSession,
  subId: string,
): Promise<Subscription | null> {
  return conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.get(session.userKey, subId, session.encryptionKey);
  });
}

export async function saveConversationSubscription(
  conversation: BotConversation,
  session: SubscriptionConversationSession,
  sub: Subscription,
): Promise<void> {
  await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    await service.update(session.userKey, sub, session.encryptionKey);
  });
}

async function replyWithListManagerDetail(
  ctx: BaseBotContext,
  sub: Subscription,
  page: number,
): Promise<void> {
  await ctx.reply(formatSubscriptionDetails(sub), {
    reply_markup: buildDetailKeyboard(sub, page),
  });
}

export async function updateListManagerDetail(
  ctx: BaseBotContext,
  sub: Subscription,
  page: number,
  panel?: { chatId: number; messageId: number },
): Promise<void> {
  if (!panel) {
    await replyWithListManagerDetail(ctx, sub, page);
    return;
  }
  try {
    await ctx.api.editMessageText(
      panel.chatId,
      panel.messageId,
      formatSubscriptionDetails(sub),
      { reply_markup: buildDetailKeyboard(sub, page) },
    );
  } catch {
    await replyWithListManagerDetail(ctx, sub, page);
  }
}

export async function completeSubscriptionConversation(
  ctx: BaseBotContext,
  sub: Subscription,
  options: ListManagerConversationOptions | undefined,
  listMessage: string,
  directMessage: string,
): Promise<void> {
  if (isFromListManager(options)) {
    await updateListManagerDetail(ctx, sub, options.page, options.panel);
    await restoreMainMenu(ctx, listMessage);
    return;
  }

  await ctx.reply(directMessage);
  await restoreMainMenu(ctx);
}
