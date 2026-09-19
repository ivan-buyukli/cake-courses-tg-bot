import { describe, expect, it, vi } from "vitest";
import { privateChatOnly } from "../src/bot/middleware/privateChatOnly.js";
import type { BotContext } from "../src/types/context.js";

function createContext(overrides: Partial<BotContext>): BotContext {
  return {
    me: {
      id: 1,
      is_bot: true,
      first_name: "Subscription Bot",
      username: "subscription_test_bot",
    },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BotContext;
}

describe("privateChatOnly", () => {
  it("lets private updates reach downstream middleware", async () => {
    const ctx = createContext({
      chat: { id: 123, type: "private" },
      message: { text: "/list" } as BotContext["message"],
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await privateChatOnly()(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("stops group commands before downstream state is touched", async () => {
    const ctx = createContext({
      chat: { id: -123, type: "group" },
      message: { text: "/list" } as BotContext["message"],
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await privateChatOnly()(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("private chat"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              expect.objectContaining({
                url: "https://t.me/subscription_test_bot",
                style: "primary",
              }),
            ],
          ],
        }),
      }),
    );
  });

  it("rejects legacy callbacks in groups without continuing", async () => {
    const ctx = createContext({
      chat: { id: -123, type: "supergroup" },
      callbackQuery: { data: "list:page:0" } as BotContext["callbackQuery"],
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await privateChatOnly()(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Please use a private chat to protect your personal data.",
      show_alert: true,
    });
  });
});
