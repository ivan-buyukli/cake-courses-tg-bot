import type { BaseBotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function hideMainMenu(
  ctx: BaseBotContext,
  message = "已进入交互流程。可随时发送 /cancel 或“取消”退出。",
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
  message = "已恢复主菜单。",
): Promise<void> {
  await ctx.reply(message, {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
