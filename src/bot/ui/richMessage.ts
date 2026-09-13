import type { Context } from "grammy";
import type {
  InlineKeyboardMarkup,
  InputRichMessage,
  RichText,
  Message,
} from "grammy/types";
import {
  isMessageNotModified,
  isRichMessageRejected,
  telegramErrorInfo,
} from "../../utils/telegramErrors.js";

export interface MessagePresentation {
  richMessage: InputRichMessage;
  plainText: string;
  replyMarkup?: InlineKeyboardMarkup;
  plainReplyMarkup?: InlineKeyboardMarkup;
}

export interface RichMessageResult {
  usedRichMessage: boolean;
  fallbackErrorType?: string;
  message?: Message;
}

/** Preserve every UTF-16 code unit while keeping each plain message under Telegram's limit. */
export function splitPlainMessage(text: string): string[] {
  const limit = 3900;
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let end = remaining.lastIndexOf("\n", limit - 1) + 1;
    if (end === 0) end = limit;
    const last = remaining.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining || chunks.length === 0) chunks.push(remaining);
  return chunks;
}

async function sendPlainPresentation(
  ctx: Context,
  view: MessagePresentation,
): Promise<Message> {
  const chunks = splitPlainMessage(view.plainText);
  let message: Message | undefined;
  for (let i = 0; i < chunks.length; i++) {
    message = await ctx.reply(chunks[i], {
      reply_markup:
        i === chunks.length - 1
          ? (view.plainReplyMarkup ?? view.replyMarkup)
          : undefined,
    });
  }
  return message!;
}

export async function sendRichOrPlain(
  ctx: Context,
  view: MessagePresentation,
): Promise<RichMessageResult> {
  if (!ctx.chat) {
    const message = await sendPlainPresentation(ctx, view);
    return { usedRichMessage: false, message };
  }
  try {
    const message = await ctx.api.sendRichMessage(
      ctx.chat.id,
      view.richMessage,
      {
        reply_markup: view.replyMarkup,
        ...(ctx.msg?.message_thread_id
          ? { message_thread_id: ctx.msg.message_thread_id }
          : {}),
      },
    );
    return { usedRichMessage: true, message };
  } catch (error) {
    const { status, description } = telegramErrorInfo(error);
    if (!isRichMessageRejected(status, description)) throw error;
    const message = await sendPlainPresentation(ctx, view);
    return {
      usedRichMessage: false,
      fallbackErrorType: "RichMessageRejected",
      message,
    };
  }
}

export async function editRichOrPlain(
  ctx: Context,
  view: MessagePresentation,
  panel?: { chatId: number; messageId: number },
): Promise<void> {
  const edit = (
    content: string | InputRichMessage,
    reply_markup?: InlineKeyboardMarkup,
  ) =>
    panel
      ? ctx.api.editMessageText(panel.chatId, panel.messageId, content, {
          reply_markup,
        })
      : ctx.editMessageText(content, { reply_markup });
  try {
    await edit(view.richMessage, view.replyMarkup ?? { inline_keyboard: [] });
  } catch (error) {
    if (isMessageNotModified(error)) return;
    const { status, description } = telegramErrorInfo(error);
    if (!isRichMessageRejected(status, description)) throw error;
    try {
      await edit(
        view.plainText,
        view.plainReplyMarkup ?? view.replyMarkup ?? { inline_keyboard: [] },
      );
    } catch (plainError) {
      if (!isMessageNotModified(plainError)) throw plainError;
    }
  }
}

export async function editPlainMessage(
  ctx: Context,
  text: string,
  options?: { reply_markup?: InlineKeyboardMarkup },
): Promise<void> {
  try {
    await ctx.editMessageText(text, {
      reply_markup: options?.reply_markup ?? { inline_keyboard: [] },
    });
  } catch (error) {
    if (!isMessageNotModified(error)) throw error;
  }
}

export function richTableCell(
  text: RichText,
  options?: { header?: boolean; align?: "left" | "center" | "right" },
) {
  return {
    text,
    align: options?.align ?? "left",
    valign: "middle" as const,
    ...(options?.header ? { is_header: true as const } : {}),
  };
}
