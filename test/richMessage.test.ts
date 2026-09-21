import { Context, GrammyError, InlineKeyboard } from "grammy";
import {
  sendRichOrPlain,
  splitPlainMessage,
} from "../src/bot/ui/richMessage.js";

describe("reused rich-message transport", () => {
  const view = {
    richMessage: { blocks: [{ type: "paragraph" as const, text: "Users" }] },
    plainText: "Users",
    replyMarkup: new InlineKeyboard().text("Back", "nav:admin"),
  };
  function context() {
    return {
      chat: { id: 300, type: "private" },
      api: { sendRichMessage: vi.fn().mockResolvedValue({ message_id: 1 }) },
      reply: vi.fn().mockResolvedValue({ message_id: 2 }),
    } as unknown as Context;
  }
  function error(code: number, description: string) {
    return new GrammyError(
      "Rejected",
      { ok: false, error_code: code, description },
      "sendRichMessage",
      {},
    );
  }
  it("falls back to plain content for unsupported rich formatting", async () => {
    const ctx = context();
    vi.mocked(ctx.api.sendRichMessage).mockRejectedValue(
      error(400, "invalid rich block"),
    );
    expect((await sendRichOrPlain(ctx, view)).usedRichMessage).toBe(false);
    expect(ctx.reply).toHaveBeenCalledWith("Users", {
      reply_markup: view.replyMarkup,
    });
  });
  it.each([
    error(429, "Too many requests"),
    error(500, "Server error"),
    new Error("Uncertain outcome"),
  ])("does not resend after unrelated failures", async (failure) => {
    const ctx = context();
    vi.mocked(ctx.api.sendRichMessage).mockRejectedValue(failure);
    await expect(sendRichOrPlain(ctx, view)).rejects.toBe(failure);
    expect(ctx.reply).not.toHaveBeenCalled();
  });
  it("splits long localized text without losing surrogate pairs", () => {
    const text = "x".repeat(3899) + "\uD83D\uDE00" + "\nПривіт".repeat(2000);
    const chunks = splitPlainMessage(text);
    expect(chunks.join("")).toBe(text);
    expect(
      chunks.every(
        (chunk) => chunk.length <= 3900 && !/[\uD800-\uDBFF]$/.test(chunk),
      ),
    ).toBe(true);
  });
});
