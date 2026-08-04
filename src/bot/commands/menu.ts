import type { BotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function menuCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("请选择要进行的操作。", {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
