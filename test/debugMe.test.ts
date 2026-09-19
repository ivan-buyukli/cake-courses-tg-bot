import { describe, it, expect, vi } from "vitest";
import { debugMeCommand } from "../src/bot/commands/debugMe.js";
import { BotContext } from "../src/types/context.js";

function createMockContext(overrides: Partial<BotContext> = {}): BotContext {
  return {
    env: { APP_ENV: "development" } as BotContext["env"],
    userKey: undefined,
    requestId: "test-request-id",
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

describe("debugMeCommand", () => {
  it("shows debug info in development", async () => {
    const ctx = createMockContext({
      env: { APP_ENV: "development" } as BotContext["env"],
      userKey: "some-user-key",
      requestId: "req-123",
    });

    await debugMeCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("userKey: present");
    expect(replyText).toContain("req-123");
    expect(replyText).toContain("development");
    expect(replyText).not.toContain("some-user-key");
  });

  it("shows userKey as missing when undefined", async () => {
    const ctx = createMockContext({
      env: { APP_ENV: "development" } as BotContext["env"],
      userKey: undefined,
    });

    await debugMeCommand(ctx);

    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("userKey: missing");
  });

  it("refuses in production", async () => {
    const ctx = createMockContext({
      env: { APP_ENV: "production" } as BotContext["env"],
    });

    await debugMeCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("This command is unavailable.");
  });

  it("refuses when APP_ENV is undefined", async () => {
    const ctx = createMockContext({
      env: {} as BotContext["env"],
    });

    await debugMeCommand(ctx);

    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("userKey: missing");
  });
});
