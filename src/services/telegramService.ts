import type { InlineKeyboardMarkup } from "grammy/types";
import { isRichMessageRejected } from "../utils/telegramErrors.js";
import { Env } from "../types/env.js";

export interface TelegramSendResult {
  ok: boolean;
  status?: number;
  description?: string;
}

export type TelegramInlineKeyboardMarkup = InlineKeyboardMarkup;

export interface TelegramLinkPreviewOptions {
  is_disabled?: boolean;
}

export interface TelegramSendOptions {
  link_preview_options?: TelegramLinkPreviewOptions;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

/**
 * Send a plain text message via the Telegram Bot API.
 * Does not log the token, chatId, or message text.
 */
export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  options: TelegramSendOptions = {},
): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...options,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let description: string | undefined;
    try {
      const parsed = JSON.parse(body);
      description = parsed.description;
    } catch {
      // ignore parse error
    }
    return {
      ok: false,
      status: response.status,
      description,
    };
  }

  return { ok: true };
}

/** Rich payloads share the existing transport result and retry contract. */
export async function sendRichMessage(
  env: Env,
  chatId: number | string,
  view: import("../bot/ui/richMessage.js").MessagePresentation,
): Promise<TelegramSendResult> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendRichMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: view.richMessage,
        reply_markup: view.replyMarkup,
      }),
    },
  );
  if (response.ok) return { ok: true };
  let description = "";
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "description" in body &&
      typeof body.description === "string"
    )
      description = body.description;
  } catch {
    /* An unparseable response must retain its HTTP retry semantics. */
  }
  if (isRichMessageRejected(response.status, description)) {
    return sendMessage(env, chatId, view.plainText, {
      reply_markup: view.plainReplyMarkup ?? view.replyMarkup,
    });
  }
  return { ok: false, status: response.status };
}
