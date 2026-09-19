import { InlineKeyboard, GrammyError } from "grammy";
import { describe, expect, it, vi } from "vitest";
import {
  sendRichOrPlain,
  editRichOrPlain,
  editPlainMessage,
  splitPlainMessage,
} from "../src/bot/ui/richMessage.js";
import type { BotContext } from "../src/types/context.js";

function error(status: number, description: string) {
  return new GrammyError(
    "Telegram error",
    { ok: false, error_code: status, description },
    "sendRichMessage",
    {},
  );
}
function createContext() {
  return {
    chat: { id: 123, type: "private" },
    api: { sendRichMessage: vi.fn().mockResolvedValue({ message_id: 1 }) },
    reply: vi.fn().mockResolvedValue({ message_id: 2 }),
    editMessageText: vi.fn().mockResolvedValue(true),
  } as unknown as BotContext;
}
const view = {
  richMessage: {
    blocks: [{ type: "heading" as const, size: 1 as const, text: "Help" }],
  },
  plainText: "Plain help text",
  replyMarkup: new InlineKeyboard().text("Back", "nav:menu"),
  plainReplyMarkup: new InlineKeyboard().text("1", "list:select:sub-1:0"),
};

describe("message presentation transport", () => {
  it("sends rich content and returns its message for conversations", async () => {
    const ctx = createContext();
    expect(await sendRichOrPlain(ctx, view)).toMatchObject({
      usedRichMessage: true,
      message: { message_id: 1 },
    });
    expect(ctx.api.sendRichMessage).toHaveBeenCalledWith(
      123,
      view.richMessage,
      { reply_markup: view.replyMarkup },
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });
  it("falls back only for an explicit rich formatting rejection, preserving controls", async () => {
    const ctx = createContext();
    vi.mocked(ctx.api.sendRichMessage).mockRejectedValue(
      error(400, "Bad Request: can't parse rich message"),
    );
    expect(await sendRichOrPlain(ctx, view)).toMatchObject({
      usedRichMessage: false,
    });
    expect(ctx.reply).toHaveBeenCalledWith(view.plainText, {
      reply_markup: view.plainReplyMarkup,
    });
  });
  it.each([
    error(429, "Too Many Requests"),
    error(500, "Server Error"),
    error(400, "chat not found"),
    new Error("network timeout"),
  ])("does not resend on unrelated or uncertain failure", async (failure) => {
    const ctx = createContext();
    vi.mocked(ctx.api.sendRichMessage).mockRejectedValue(failure);
    await expect(sendRichOrPlain(ctx, view)).rejects.toBe(failure);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
  it("edits the same message to plain content on a supported fallback", async () => {
    const ctx = createContext();
    vi.mocked(ctx.editMessageText).mockRejectedValueOnce(
      error(400, "invalid rich block"),
    );
    await editRichOrPlain(ctx, view);
    expect(ctx.editMessageText).toHaveBeenNthCalledWith(2, view.plainText, {
      reply_markup: view.plainReplyMarkup,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });
  it("treats unchanged edits as success and propagates other failures", async () => {
    const ctx = createContext();
    vi.mocked(ctx.editMessageText).mockRejectedValueOnce(
      error(400, "message is not modified"),
    );
    await expect(editRichOrPlain(ctx, view)).resolves.toBeUndefined();
    vi.mocked(ctx.editMessageText).mockRejectedValueOnce(
      error(400, "message to edit not found"),
    );
    await expect(editPlainMessage(ctx, "Notice")).rejects.toBeInstanceOf(
      GrammyError,
    );
  });
});

describe("long plain report fallback", () => {
  it("preserves long text and emoji without splitting surrogate pairs", async () => {
    const text = "x".repeat(3899) + "😀" + "Details\n".repeat(1500);
    const chunks = splitPlainMessage(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 3900)).toBe(true);
    expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    const ctx = createContext();
    vi.mocked(ctx.api.sendRichMessage).mockRejectedValue(
      error(400, "invalid rich message"),
    );
    await sendRichOrPlain(ctx, { ...view, plainText: text });
    const calls = vi.mocked(ctx.reply).mock.calls;
    expect(calls.map((call) => call[0]).join("")).toBe(text);
    expect(calls.at(-1)?.[1]?.reply_markup).toEqual(view.plainReplyMarkup);
  });
});

describe("presentation error privacy", () => {
  it("does not log a raw Telegram description in the outer middleware", async () => {
    const { errorHandler } = await import(
      "../src/bot/middleware/errorHandler.js"
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = createContext();
      await errorHandler(ctx, async () => {
        throw error(400, "private subscription name and price 19.99");
      });
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "private subscription name",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("19.99");
    } finally {
      log.mockRestore();
    }
  });
});
