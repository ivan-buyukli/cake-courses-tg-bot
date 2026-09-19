import { describe, it, expect, vi } from "vitest";
import { rateLimiter } from "../src/bot/middleware/rateLimit.js";
import type { BotContext } from "../src/types/context.js";

describe("rateLimiter", () => {
  it("allows requests within limit", async () => {
    const middleware = rateLimiter({ maxRequests: 3, windowMs: 60_000 });
    const next = vi.fn();

    const ctx = {
      userKey: "user-allows",
      reply: vi.fn(),
    } as unknown as BotContext;

    await middleware(ctx, next);
    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks requests over limit", async () => {
    const middleware = rateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const next = vi.fn();

    const ctx = {
      userKey: "user-blocks",
      reply: vi.fn(),
    } as unknown as BotContext;

    await middleware(ctx, next);
    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Too many requests"),
    );
  });

  it("resets window after windowMs", async () => {
    const middleware = rateLimiter({ maxRequests: 1, windowMs: 0 });
    const next = vi.fn();

    const ctx = {
      userKey: "user-reset",
      reply: vi.fn(),
    } as unknown as BotContext;

    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("does not rate limit when userKey is missing", async () => {
    const middleware = rateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const next = vi.fn();

    const ctx = {
      userKey: undefined,
      reply: vi.fn(),
    } as unknown as BotContext;

    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("tracks different users separately", async () => {
    const middleware = rateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const next = vi.fn();

    const ctxA = {
      userKey: "user-separate-a",
      reply: vi.fn(),
    } as unknown as BotContext;

    const ctxB = {
      userKey: "user-separate-b",
      reply: vi.fn(),
    } as unknown as BotContext;

    await middleware(ctxA, next);
    await middleware(ctxB, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(ctxA.reply).not.toHaveBeenCalled();
    expect(ctxB.reply).not.toHaveBeenCalled();
  });
});
