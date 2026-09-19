import type { BaseBotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function hideMainMenu(
  ctx: BaseBotContext,
  message = "An interactive operation has started. Send /cancel or “Cancel” at any time to exit.",
): Promise<void> {
  await ctx.reply(message, {
    reply_markup: { remove_keyboard: true },
  });
}

export function forceReply(placeholder: string) {
  return {
    force_reply: true as const,
    input_field_placeholder: placeholder,
  };
}

export async function restoreMainMenu(
  ctx: BaseBotContext,
  message = "Main menu restored.",
): Promise<void> {
  await ctx.reply(message, {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
