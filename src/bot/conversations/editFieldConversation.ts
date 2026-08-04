import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createLogger } from "../../utils/logger.js";
import { BillingInterval, Subscription } from "../../models/subscription.js";
import { formatBillingCycle } from "../../utils/labels.js";
import { getBillingAnchorDay } from "../../utils/date.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import {
  buildDetailKeyboard,
  formatDetailText,
} from "../keyboards/listManagerKeyboard.js";
import { parseEditCycleCallbackData } from "../../utils/callbackParser.js";
import { collectDateInput } from "./dateInput.js";
import { collectCurrencyInput } from "./currencyInput.js";
import { collectCycleInput } from "./cycleInput.js";
import {
  forceReply,
  hideMainMenu,
  restoreMainMenu,
} from "../ui/conversationUi.js";

interface ListManagerConversationOptions {
  source?: "listManager";
  page?: number;
  panel?: {
    chatId: number;
    messageId: number;
  };
}

function isFromListManager(options?: ListManagerConversationOptions): boolean {
  return options?.source === "listManager";
}

async function replyWithListManagerDetail(
  ctx: BaseBotContext,
  sub: Subscription,
  page: number,
): Promise<void> {
  await ctx.reply(formatDetailText(sub), {
    reply_markup: buildDetailKeyboard(sub, page),
  });
}

async function updateListManagerDetail(
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
      formatDetailText(sub),
      { reply_markup: buildDetailKeyboard(sub, page) },
    );
  } catch {
    await replyWithListManagerDetail(ctx, sub, page);
  }
}

// TODO: grammY conversations do not have built-in timeout handling.
// If a user starts an edit flow and never completes it, the conversation
// waits indefinitely until the isolate is recycled or the user sends /cancel.
// On Cloudflare Workers, isolates may be evicted after inactivity, which
// implicitly ends conversations. For MVP this is acceptable.

export function validateEditName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "订阅名称不能为空。";
  return null;
}

export function validateEditPrice(priceStr: string): {
  price: number;
  error?: string;
} {
  const trimmed = priceStr.trim();
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price < 0) {
    return { price: 0, error: "请输入非负数字。" };
  }
  return { price };
}

export async function editFieldConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  field: "name" | "price" | "currency" | "date",
  options?: ListManagerConversationOptions,
): Promise<void> {
  // grammY conversations do not inherit custom middleware properties.
  // Read required fields from the outside context via external().
  const ctxData = await conversation.external((outsideCtx) => ({
    userKey: outsideCtx.userKey ?? null,
    encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
    requestId: outsideCtx.requestId,
  }));

  if (!ctxData.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  const logger = createLogger(ctxData.requestId);
  await hideMainMenu(ctx, "正在编辑订阅。可随时发送 /cancel 或“取消”退出。");

  const sub = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.get(userKey, subId, encryptionKey);
  });

  if (!sub) {
    await ctx.reply("没有找到这个订阅，或它已被删除。");
    await restoreMainMenu(ctx);
    return;
  }

  const fieldLabels: Record<string, string> = {
    name: "名称",
    price: "价格",
    currency: "币种",
    date: "下次扣款日期",
  };

  const promptMap: Record<"name" | "price" | "currency" | "date", string> = {
    name: `当前名称：${sub.name}\n请发送新名称。`,
    price:
      sub.price !== undefined
        ? `当前价格：${sub.price}\n请发送新价格（数字）。`
        : "当前未填写价格。\n请发送价格（数字）。",
    currency:
      sub.currency !== undefined
        ? `当前币种：${sub.currency}\n请选择新币种，或点“其他”输入代码。`
        : "当前未填写币种。\n请选择币种，或点“其他”输入代码。",
    date: `当前下次扣款日期：${sub.nextBillingDate}\n请选择或输入新日期：`,
  };

  const now = new Date().toISOString();
  const updated = { ...sub, updatedAt: now };

  if (field === "name") {
    await ctx.reply(promptMap[field], {
      reply_markup: forceReply("输入新的订阅名称"),
    });
    while (true) {
      const inputCtx = await conversation.waitFor("message:text");
      const input = inputCtx.msg.text;
      if (isCancelInput(input)) {
        await ctx.reply("已取消。");
        await restoreMainMenu(ctx);
        return;
      }
      const error = validateEditName(input);
      if (error) {
        await ctx.reply(error + "\n请在当前步骤重新输入。", {
          reply_markup: forceReply("输入新的订阅名称"),
        });
        continue;
      }
      updated.name = input.trim();
      break;
    }
  } else if (field === "price") {
    await ctx.reply(promptMap[field], {
      reply_markup: forceReply("输入新的价格"),
    });
    while (true) {
      const inputCtx = await conversation.waitFor("message:text");
      const input = inputCtx.msg.text;
      if (isCancelInput(input)) {
        await ctx.reply("已取消。");
        await restoreMainMenu(ctx);
        return;
      }
      const result = validateEditPrice(input);
      if (result.error) {
        await ctx.reply(result.error + "\n请在当前步骤重新输入。", {
          reply_markup: forceReply("输入新的价格"),
        });
        continue;
      }
      updated.price = result.price;
      break;
    }
  } else if (field === "currency") {
    const selectedCurrency = await collectCurrencyInput(conversation, ctx, {
      prompt: promptMap[field],
      hasPrice: true,
    });
    if (selectedCurrency.cancelled || !selectedCurrency.currency) {
      await restoreMainMenu(ctx);
      return;
    }
    updated.currency = selectedCurrency.currency;
  } else if (field === "date") {
    const selectedDate = await collectDateInput(
      conversation,
      ctx,
      promptMap[field],
    );
    if (!selectedDate) {
      await restoreMainMenu(ctx);
      return;
    }
    updated.nextBillingDate = selectedDate;
    updated.billingAnchorDay = getBillingAnchorDay(selectedDate);
  }

  await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    await service.update(userKey, updated, encryptionKey);
  });

  logger.info("Subscription field updated via conversation", {
    subId,
    field,
  });

  if (isFromListManager(options)) {
    await updateListManagerDetail(
      ctx,
      updated,
      options?.page ?? 0,
      options?.panel,
    );
    await restoreMainMenu(
      ctx,
      `✅ 已保存“${updated.name}”的${fieldLabels[field]}。`,
    );
    return;
  }

  await ctx.reply(
    `已更新“${updated.name}”的${fieldLabels[field]}。\n发送 /list 查看结果。`,
  );
  await restoreMainMenu(ctx);
}

export async function editCycleConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  // grammY conversations do not inherit custom middleware properties.
  // Read required fields from the outside context via external().
  const ctxData = await conversation.external((outsideCtx) => ({
    userKey: outsideCtx.userKey ?? null,
    encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
    requestId: outsideCtx.requestId,
  }));

  if (!ctxData.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  const logger = createLogger(ctxData.requestId);
  await hideMainMenu(
    ctx,
    "正在编辑扣款周期。可随时发送 /cancel 或“取消”退出。",
  );

  const sub = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.get(userKey, subId, encryptionKey);
  });

  if (!sub) {
    await ctx.reply("没有找到这个订阅，或它已被删除。");
    await restoreMainMenu(ctx);
    return;
  }

  const cycleSelection = await collectCycleInput(conversation, ctx, {
    prompt: "请选择新的扣款周期：",
    callbackPattern: /^editcycle:/,
    callbackData: (cycle) => `editcycle:${cycle}:${subId}`,
    parseCycle: (callbackData) =>
      parseEditCycleCallbackData(callbackData)?.cycle ?? null,
    invalidSelectionMessage: "请点击按钮选择扣款周期，或点击取消。",
    cancelData: `editcycle:cancel:${subId}`,
  });
  if (!cycleSelection) {
    await restoreMainMenu(ctx);
    return;
  }

  const cycle = cycleSelection.cycle;
  const billingInterval: BillingInterval | undefined =
    cycleSelection.billingInterval;

  const now = new Date().toISOString();
  const updated = {
    ...sub,
    billingCycle: cycle,
    billingInterval,
    updatedAt: now,
  };

  await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    await service.update(userKey, updated, encryptionKey);
  });

  logger.info("Subscription cycle updated via conversation", { subId, cycle });

  if (isFromListManager(options)) {
    await updateListManagerDetail(
      ctx,
      updated,
      options?.page ?? 0,
      options?.panel,
    );
    await restoreMainMenu(
      ctx,
      `✅ 已将“${updated.name}”的周期更新为${formatBillingCycle(
        cycle,
        billingInterval,
      )}。`,
    );
    return;
  }

  await ctx.reply(
    `已将“${updated.name}”的周期更新为${formatBillingCycle(
      cycle,
      billingInterval,
    )}。\n发送 /list 查看结果。`,
  );
  await restoreMainMenu(ctx);
}
