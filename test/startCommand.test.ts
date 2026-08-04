import { describe, it, expect, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { startCommand } from "../src/bot/commands/start.js";
import { MAIN_MENU_BUTTON_LABELS } from "../src/bot/keyboards/mainMenuKeyboard.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import type { BotContext } from "../src/types/context.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): KVNamespace {
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
  } as unknown as KVNamespace;
}

function createMockContext(
  kv: KVNamespace,
  overrides: Partial<BotContext> = {},
): BotContext {
  return {
    env: {
      BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_SECRET: "secret",
      ENCRYPTION_KEY: VALID_KEY,
      USER_HASH_SECRET: "hash-secret",
      SUBSCRIPTION_KV: kv,
      APP_ENV: "test",
    },
    userKey: "user-key",
    chat: { id: 123456, type: "private" },
    requestId: "request-id",
    isAdmin: false,
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

describe("startCommand", () => {
  it("welcomes first-time users when no subscriptions exist", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv);

    await startCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("欢迎使用");
    expect(replyText).toContain("添加第一个订阅");
    expect(replyText).toContain("底部快捷按钮");

    const replyOptions = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(replyOptions.reply_markup.keyboard[0][0].text).toBe(
      MAIN_MENU_BUTTON_LABELS.add,
    );
    expect(replyOptions.reply_markup.is_persistent).toBe(true);
  });

  it("welcomes returning users when subscriptions exist", async () => {
    const kv = createMockKV();
    await kv.put("user:user-key:sub:sub-1", "{}");
    await kv.put("user:user-key:sub:sub-2", "{}");
    const ctx = createMockContext(kv);

    await startCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("欢迎回来");
    expect(replyText).toContain("快捷按钮");

    const replyOptions = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(replyOptions.reply_markup.keyboard.flat()).toContainEqual(
      expect.objectContaining({
        text: MAIN_MENU_BUTTON_LABELS.list,
        style: "primary",
      }),
    );
  });

  it("sends a plain welcome when userKey is missing", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv, { userKey: undefined });

    await startCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("欢迎使用");
    expect(replyText).toContain("请选择下面的操作");

    const replyOptions = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(replyOptions.reply_markup.keyboard[0][0].text).toBe(
      MAIN_MENU_BUTTON_LABELS.add,
    );
  });

  it("clears deletion tombstone on explicit /start", async () => {
    const kv = createMockKV();
    const userRepo = createUserRepository(kv);
    await userRepo.markUserDeleted("user-key");

    const ctx = createMockContext(kv);
    await startCommand(ctx);

    expect(await userRepo.isUserDeleted("user-key")).toBe(false);
    expect(await userRepo.getUserProfile("user-key", VALID_KEY)).not.toBeNull();
  });
});
