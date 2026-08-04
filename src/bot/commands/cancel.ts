import type { BotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function cancelCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("当前没有进行中的操作。", {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
