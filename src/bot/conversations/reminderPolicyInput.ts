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
      inherited ? "✓ Use default settings" : "Use default settings",
      `editreminder:inherit:${subId}`,
    )
    .row()
    .text(
      inherited ? "Remind once, 1 day before" : "✓ Remind once, 1 day before",
      `editreminder:once1:${subId}`,
    )
    .row()
    .text("Cancel", `editreminder:cancel:${subId}`);
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
        await ctx.reply("Cancelled.");
        return null;
      }
      continue;
    }

    const parsed = parseEditReminderCallbackData(
      updateCtx.callbackQuery?.data ?? "",
    );
    if (!parsed || parsed.subId !== subId) {
      if (updateCtx.callbackQuery) {
        await updateCtx.answerCallbackQuery(
          "Choose a valid reminder preference.",
        );
      }
      continue;
    }

    await updateCtx.answerCallbackQuery();
    if (parsed.action === "cancel") {
      await ctx.reply("Cancelled.");
      return null;
    }
    return parsed.action === "once1"
      ? { mode: "once", daysBefore: 1 }
      : undefined;
  }
}
