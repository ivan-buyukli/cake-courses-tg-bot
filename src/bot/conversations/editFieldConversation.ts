import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { BillingInterval, Subscription } from "../../models/subscription.js";
import type { ScalarEditableField } from "../../models/subscriptionEdit.js";
import { formatBillingCycle } from "../../utils/labels.js";
import { getBillingAnchorDay } from "../../utils/date.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { parseEditCycleCallbackData } from "../../utils/callbackParser.js";
import { formatReminderPolicy } from "../../utils/reminderPolicy.js";
import { collectDateInput } from "./dateInput.js";
import { collectCurrencyInput } from "./currencyInput.js";
import { collectCycleInput } from "./cycleInput.js";
import { forceReply, restoreMainMenu } from "../ui/conversationUi.js";
import {
  beginSubscriptionConversation,
  completeSubscriptionConversation,
  saveConversationSubscription,
  type ListManagerConversationOptions,
} from "./subscriptionConversation.js";
import {
  collectReminderPolicyInput,
  reminderPolicyKeyboard,
} from "./reminderPolicyInput.js";

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
  field: ScalarEditableField,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "正在编辑订阅。可随时发送 /cancel 或“取消”退出。",
  );
  if (!started) return;
  const { session, sub } = started;

  const fieldLabels: Record<ScalarEditableField, string> = {
    name: "名称",
    price: "价格",
    currency: "币种",
    date: "下次扣款日期",
  };

  const promptMap: Record<ScalarEditableField, string> = {
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

  await saveConversationSubscription(conversation, session, updated);

  session.logger.info("Subscription field updated via conversation", {
    subId,
    field,
  });
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ 已保存“${updated.name}”的${fieldLabels[field]}。`,
    `已更新“${updated.name}”的${fieldLabels[field]}。`,
  );
}

export async function editCycleConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "正在编辑扣款周期。可随时发送 /cancel 或“取消”退出。",
  );
  if (!started) return;
  const { session, sub } = started;

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

  await saveConversationSubscription(conversation, session, updated);

  session.logger.info("Subscription cycle updated via conversation", {
    subId,
    cycle,
  });
  const cycleLabel = formatBillingCycle(cycle, billingInterval);
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ 已将“${updated.name}”的周期更新为${cycleLabel}。`,
    `已将“${updated.name}”的周期更新为${cycleLabel}。`,
  );
}

export async function editReminderConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "正在编辑提醒方式。可随时发送 /cancel 或“取消”退出。",
  );
  if (!started) return;
  const { session, sub } = started;

  await ctx.reply(
    `当前提醒方式：${formatReminderPolicy(sub)}\n\n请选择新的提醒方式：`,
    { reply_markup: reminderPolicyKeyboard(subId, sub.reminderPolicy) },
  );
  const reminderPolicy = await collectReminderPolicyInput(
    conversation,
    ctx,
    subId,
  );
  if (reminderPolicy === null) {
    await restoreMainMenu(ctx);
    return;
  }

  const updated: Subscription = {
    ...sub,
    reminderPolicy,
    updatedAt: new Date().toISOString(),
  };
  await saveConversationSubscription(conversation, session, updated);
  session.logger.info("Subscription reminder policy updated via conversation", {
    subId,
    policy: reminderPolicy?.mode ?? "inherit",
  });
  const policyLabel = formatReminderPolicy(updated);
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ 已将“${updated.name}”的提醒方式设为：${policyLabel}。`,
    `已将“${updated.name}”的提醒方式设为：${policyLabel}。`,
  );
}
