import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { errorHandler } from "../src/bot/middleware/errorHandler.js";
import { isCancelInput } from "../src/utils/conversationInput.js";
import { log, sanitizeErrorMessage } from "../src/utils/logger.js";
import { formatMoney, parseMoneyInput } from "../src/utils/money.js";
import type { BotContext } from "../src/types/context.js";
import type { Env } from "../src/types/env.js";
import { createMockQueue } from "./queueTestUtils.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): Env["SUBSCRIPTION_KV"] {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (options?: { prefix?: string }) => {
      const prefix = options?.prefix ?? "";
      const keys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as Env["SUBSCRIPTION_KV"];
}

function createEnv(): Env {
  return {
    BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "hash-secret",
    SUBSCRIPTION_KV: createMockKV(),
    REMINDER_QUEUE: createMockQueue(),
    APP_ENV: "test",
  };
}

describe("conversation input helpers", () => {
  it("recognizes cancel text after trimming", () => {
    expect(isCancelInput(" /cancel ")).toBe(true);
    expect(isCancelInput(" 取消 ")).toBe(true);
    expect(isCancelInput("cancel")).toBe(false);
  });
});

describe("money helpers", () => {
  it("formats and parses money input", () => {
    expect(formatMoney(12.5, "usd")).toBe("$12.50");
    expect(formatMoney(12.5, "not-a-currency")).toBe("12.5 NOT-A-CURRENCY");
    expect(parseMoneyInput("$12.50")).toBe(12.5);
    expect(parseMoneyInput("free")).toBeUndefined();
  });
});

describe("logger sanitization", () => {
  it("redacts sensitive fragments while preserving surrounding diagnostics", () => {
    const userKey = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP_";
    const raw =
      "Telegram request failed for user 123456789 at https://api.telegram.org/bot123456789:ABCdef_12345678901234567890/sendMessage with key " +
      userKey;

    const sanitized = sanitizeErrorMessage(raw);

    expect(sanitized).toContain("Telegram request failed for user");
    expect(sanitized).toContain("api.telegram.org/bot[REDACTED]");
    expect(sanitized).toContain("[REDACTED_ID]");
    expect(sanitized).toContain("[REDACTED_USER_KEY]");
    expect(sanitized).not.toContain("123456789:ABCdef_12345678901234567890");
    expect(sanitized).not.toContain("123456789");
    expect(sanitized).not.toContain(userKey);
  });

  it("sanitizes structured log metadata recursively", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      log("error", "Failed chat 987654321", {
        requestId: "request-id",
        error: "token 987654321:ABCdef_12345678901234567890 user 123456789",
        nested: {
          url: "https://api.telegram.org/bot987654321:ABCdef_12345678901234567890/getMe",
        },
      });

      expect(errorSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(errorSpy.mock.calls[0][0] as string) as {
        message: string;
        error: string;
        nested: { url: string };
      };

      expect(payload.message).toBe("Failed chat [REDACTED_ID]");
      expect(payload.error).toContain("[REDACTED_TELEGRAM_TOKEN]");
      expect(payload.error).toContain("[REDACTED_ID]");
      expect(payload.nested.url).toContain("api.telegram.org/bot[REDACTED]");
      expect(JSON.stringify(payload)).not.toContain("987654321");
      expect(JSON.stringify(payload)).not.toContain(
        "ABCdef_12345678901234567890",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("errorHandler", () => {
  it("lets successful middleware continue", async () => {
    const ctx = {
      requestId: "request-id",
      userKey: "user-key",
      reply: vi.fn(),
    } as unknown as BotContext;
    const next = vi.fn().mockResolvedValue(undefined);

    await errorHandler(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies with a generic error when downstream throws", async () => {
    const ctx = {
      requestId: "request-id",
      userKey: "user-key",
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotContext;

    await errorHandler(ctx, async () => {
      throw new Error("secret details");
    });

    expect(ctx.reply).toHaveBeenCalledWith("发生了意外错误，请稍后再试。");
  });

  it("swallows reply failures while handling errors", async () => {
    const ctx = {
      requestId: "request-id",
      userKey: undefined,
      reply: vi.fn().mockRejectedValue(new Error("send failed")),
    } as unknown as BotContext;

    await expect(
      errorHandler(ctx, async () => {
        throw "boom";
      }),
    ).resolves.toBeUndefined();
  });
});

describe("worker entrypoint", () => {
  it("routes health checks", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/health"),
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/missing"),
      createEnv(),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  it("rejects requests before routing when env is invalid", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/health"),
      { ...createEnv(), ENCRYPTION_KEY: "not-a-valid-key" },
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
  });

  it("forwards scheduled events to the scheduler", async () => {
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: "0 8 * * *" },
        createEnv(),
        {} as ExecutionContext,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects scheduled events before using env when env is invalid", async () => {
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: "0 8 * * *" },
        { ...createEnv(), BOT_TOKEN: "" },
        {} as ExecutionContext,
      ),
    ).rejects.toThrow("Invalid environment configuration: BOT_TOKEN");
  });
});
