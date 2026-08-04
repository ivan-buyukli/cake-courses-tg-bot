import type { InlineKeyboard } from "grammy";
import type { InputRichMessage } from "grammy/types";
import type { BotContext } from "../../types/context.js";

export interface RichMessageResult {
  usedRichMessage: boolean;
  fallbackErrorType?: string;
}

export async function sendRichOrPlain(
  ctx: BotContext,
  {
    richMessage,
    plainText,
    replyMarkup,
  }: {
    richMessage: InputRichMessage;
    plainText: string;
    replyMarkup?: InlineKeyboard;
  },
): Promise<RichMessageResult> {
  if (!ctx.chat) {
    await ctx.reply(plainText, { reply_markup: replyMarkup });
    return { usedRichMessage: false };
  }

  try {
    await ctx.api.sendRichMessage(ctx.chat.id, richMessage, {
      reply_markup: replyMarkup,
    });
    return { usedRichMessage: true };
  } catch (error) {
    await ctx.reply(plainText, { reply_markup: replyMarkup });
    return {
      usedRichMessage: false,
      fallbackErrorType: error instanceof Error ? error.name : typeof error,
    };
  }
}

export function richTableCell(
  text: string,
  options?: {
    header?: boolean;
    align?: "left" | "center" | "right";
  },
) {
  return {
    text,
    align: options?.align ?? "left",
    valign: "middle" as const,
    ...(options?.header ? { is_header: true as const } : {}),
  };
}
