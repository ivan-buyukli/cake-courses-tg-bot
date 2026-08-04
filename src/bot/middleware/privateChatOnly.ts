import { InlineKeyboard, type Middleware } from "grammy";
import type { BotContext } from "../../types/context.js";

const PRIVATE_CHAT_MESSAGE =
  "为了保护你的订阅、价格和导出数据，请在与机器人的私聊中使用完整功能。";

function privateChatUrl(ctx: BotContext): string | null {
  const username = ctx.me.username;
  return username ? `https://t.me/${username}` : null;
}

export function privateChatOnly(): Middleware<BotContext> {
  return async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await next();
      return;
    }

    if (ctx.callbackQuery) {
      try {
        await ctx.answerCallbackQuery({
          text: "为了保护个人数据，请在私聊中使用。",
          show_alert: true,
        });
      } catch {
        // The callback may already be too old to answer.
      }
      return;
    }

    const text = ctx.message?.text ?? ctx.channelPost?.text;
    if (!text?.startsWith("/")) return;

    const url = privateChatUrl(ctx);
    const replyMarkup = url
      ? new InlineKeyboard().url("🔒 前往私聊", url).primary()
      : undefined;

    try {
      await ctx.reply(PRIVATE_CHAT_MESSAGE, {
        reply_markup: replyMarkup,
      });
    } catch {
      // This guard runs before the shared error handler. A failed Telegram
      // response must not let a group update continue into private state.
    }
  };
}
