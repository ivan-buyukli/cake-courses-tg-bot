import { GrammyError, type InlineKeyboard } from "grammy";
import type { BotContext } from "../../types/context.js";
import { t } from "../i18n.js";

export async function editorPanel(
  ctx: BotContext,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  keyboard.row().text(t(ctx.locale, "mainMenu"), "nav:admin");
  if (ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      return;
    } catch (error) {
      if (!(error instanceof GrammyError) || error.error_code !== 400)
        throw error;
      if (/message is not modified/i.test(error.description)) return;
      if (
        !/message to edit not found|message can't be edited|there is no text/i.test(
          error.description,
        )
      )
        throw error;
    }
  }
  await ctx.reply(text, { reply_markup: keyboard });
}
