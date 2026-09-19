import type { BotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function menuCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("Choose an action.", {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
