import type { BotContext } from "../../types/context.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function cancelCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("No operation is currently in progress.", {
    reply_markup: mainMenuReplyKeyboard(),
  });
}
