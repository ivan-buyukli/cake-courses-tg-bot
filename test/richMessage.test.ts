import { InlineKeyboard } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { sendRichOrPlain } from "../src/bot/ui/richMessage.js";
import type { BotContext } from "../src/types/context.js";

function createContext(sendRichMessage: ReturnType<typeof vi.fn>): BotContext {
  return {
    chat: { id: 123, type: "private" },
    api: { sendRichMessage },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as BotContext;
}

const richMessage = {
  blocks: [{ type: "heading" as const, size: 1 as const, text: "帮助" }],
};

describe("sendRichOrPlain", () => {
  it("uses Rich Messages with the same action keyboard", async () => {
    const sendRichMessage = vi.fn().mockResolvedValue({});
    const ctx = createContext(sendRichMessage);
    const keyboard = new InlineKeyboard().text("返回", "nav:menu");

    const result = await sendRichOrPlain(ctx, {
      richMessage,
      plainText: "帮助",
      replyMarkup: keyboard,
    });

    expect(result).toEqual({ usedRichMessage: true });
    expect(sendRichMessage).toHaveBeenCalledWith(123, richMessage, {
      reply_markup: keyboard,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("sends equivalent plain text when Telegram rejects Rich Messages", async () => {
    const sendRichMessage = vi.fn().mockRejectedValue(new Error("Bad Request"));
    const ctx = createContext(sendRichMessage);
    const keyboard = new InlineKeyboard().text("返回", "nav:menu");

    const result = await sendRichOrPlain(ctx, {
      richMessage,
      plainText: "普通帮助内容",
      replyMarkup: keyboard,
    });

    expect(result).toEqual({
      usedRichMessage: false,
      fallbackErrorType: "Error",
    });
    expect(ctx.reply).toHaveBeenCalledWith("普通帮助内容", {
      reply_markup: keyboard,
    });
  });
});
