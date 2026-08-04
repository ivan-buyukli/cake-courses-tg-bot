import { describe, expect, it, vi } from "vitest";
import { InputFile } from "grammy";
import type { KVNamespace } from "@cloudflare/workers-types";
import { exportCommand } from "../src/bot/commands/export.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import type { Subscription } from "../src/models/subscription.js";
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

function createContext(
  kv: KVNamespace,
  text: string,
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
    requestId: "request-id",
    msg: { text },
    chat: { id: 123, type: "private" },
    api: {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
    reply: vi.fn(),
    replyWithDocument: vi.fn().mockResolvedValue(undefined),
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as BotContext;
}

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-12345678",
    name: "Netflix",
    price: 12.99,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-01",
    category: "Video",
    note: "family plan",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedSubscription(
  kv: KVNamespace,
  sub: Subscription,
): Promise<void> {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  const service = createSubscriptionService(repo, reminderRepo);
  await service.create("user-key", sub, VALID_KEY);
}

describe("exportCommand", () => {
  it("refuses when userKey is missing", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/export", { userKey: undefined });

    await exportCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("无法识别用户，请稍后再试。");
  });

  it("exports subscriptions as a JSON document without internal identifiers", async () => {
    const kv = createMockKV();
    await seedSubscription(kv, createSub({ id: "sub-export" }));
    const ctx = createContext(kv, "/export");

    await exportCommand(ctx);

    expect(ctx.replyWithDocument).toHaveBeenCalledTimes(1);
    const [file, options] = (ctx.replyWithDocument as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [InputFile, { caption: string }];
    expect(file).toBeInstanceOf(InputFile);
    expect(file.filename).toMatch(
      /^subscription-export-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const raw = await file.toRaw();
    expect(raw).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(raw as Uint8Array);
    expect(text).toContain('"version": 2');
    expect(text).toContain('"name": "Netflix"');
    expect(text).not.toContain("user-key");
    expect(text).not.toContain("userKey");
    expect(text).not.toContain("encryptedPayload");
    expect(text).not.toContain("123456789");
    expect(options.caption).toContain("不包含 Telegram 用户 ID");
    expect(ctx.api.sendChatAction).toHaveBeenCalledWith(123, "upload_document");
  });

  it("exports payloads larger than the Telegram text limit as a file", async () => {
    const kv = createMockKV();
    for (let index = 0; index < 35; index += 1) {
      await seedSubscription(
        kv,
        createSub({
          id: `sub-large-${index}`,
          name: `Service ${index}`,
          note: "x".repeat(180),
        }),
      );
    }
    const ctx = createContext(kv, "/export");

    await exportCommand(ctx);

    expect(ctx.replyWithDocument).toHaveBeenCalledTimes(1);
    const [file] = (ctx.replyWithDocument as ReturnType<typeof vi.fn>).mock
      .calls[0] as [InputFile];
    const raw = await file.toRaw();
    expect((raw as Uint8Array).byteLength).toBeGreaterThan(4000);
  });
});
