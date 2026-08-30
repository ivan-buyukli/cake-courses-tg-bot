import type { InlineKeyboard } from "grammy";
import { InlineKeyboard as GrammyInlineKeyboard } from "grammy";
import type { SubscriptionReminderPolicy } from "../../models/subscription.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { parseEditReminderCallbackData } from "../../utils/callbackParser.js";
import type { BaseBotContext } from "../../types/context.js";
import type { BotConversation } from "./subscriptionConversation.js";

export function reminderPolicyKeyboard(
  subId: string,
  policy?: SubscriptionReminderPolicy,
): InlineKeyboard {
  const inherited = policy === undefined;
  return new GrammyInlineKeyboard()
    .text(
      inherited ? "✓ 跟随默认设置" : "跟随默认设置",
      `editreminder:inherit:${subId}`,
    )
    .row()
    .text(
      inherited ? "仅提前 1 天提醒一次" : "✓ 仅提前 1 天提醒一次",
      `editreminder:once1:${subId}`,
    )
    .row()
    .text("取消", `editreminder:cancel:${subId}`);
}

export async function collectReminderPolicyInput(
  conversation: BotConversation,
  ctx: BaseBotContext,
  subId: string,
): Promise<SubscriptionReminderPolicy | undefined | null> {
  while (true) {
    const updateCtx = await conversation.wait();

    if (updateCtx.message?.text) {
      if (isCancelInput(updateCtx.message.text)) {
        await ctx.reply("已取消。");
        return null;
      }
      continue;
    }

    const parsed = parseEditReminderCallbackData(
      updateCtx.callbackQuery?.data ?? "",
    );
    if (!parsed || parsed.subId !== subId) {
      if (updateCtx.callbackQuery) {
        await updateCtx.answerCallbackQuery("请选择有效的提醒方式。");
      }
      continue;
    }

    await updateCtx.answerCallbackQuery();
    if (parsed.action === "cancel") {
      await ctx.reply("已取消。");
      return null;
    }
    return parsed.action === "once1"
      ? { mode: "once", daysBefore: 1 }
      : undefined;
  }
}
