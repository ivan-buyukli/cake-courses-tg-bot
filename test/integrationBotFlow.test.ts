import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { createBot } from "../src/bot/createBot.js";
import { hashUserId } from "../src/crypto/userHash.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import type { Env } from "../src/types/env.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

type TelegramPayload = Record<string, unknown>;

function createMockKV(): KVNamespace & { keys(): string[] } {
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
    keys: () => Array.from(store.keys()),
  } as unknown as KVNamespace & { keys(): string[] };
}

function createEnv(kv: KVNamespace): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: kv,
    APP_ENV: "test",
    REMINDER_DAYS_AHEAD: "3",
  };
}

function messageUpdate(updateId: number, userId: number, text: string) {
  const command = text.split(/\s+/, 1)[0] ?? "";
  const entities = text.startsWith("/")
    ? [{ type: "bot_command" as const, offset: 0, length: command.length }]
    : undefined;

  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private" as const },
      from: { id: userId, is_bot: false, first_name: "Test" },
      text,
      entities,
    },
  };
}

function recordTelegramApi(
  bot: ReturnType<typeof createBot>,
  sentMessages: TelegramPayload[],
): void {
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage" || method === "sendRichMessage") {
      sentMessages.push(payload as TelegramPayload);
      return {
        ok: true,
        result: {
          message_id: sentMessages.length,
          date: 0,
          chat: { id: 123456789, type: "private" },
          text: String((payload as TelegramPayload).text ?? ""),
        },
      };
    }
    return { ok: true, result: true };
  });
}

describe("bot command integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handles add then reminders through middleware, KV, crypto, and Telegram replies", async () => {
    const sentMessages: TelegramPayload[] = [];
    const kv = createMockKV();
    const env = createEnv(kv);
    const bot = createBot(env);
    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };
    recordTelegramApi(bot, sentMessages);
    const userId = 123456789;
    const userKey = await hashUserId(userId, env.USER_HASH_SECRET);

    await bot.handleUpdate(
      messageUpdate(1, userId, "/add Netflix 12.99 USD monthly 2026-06-03"),
    );

    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);
    const subs = await service.list(userKey, env.ENCRYPTION_KEY);

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      name: "Netflix",
      price: 12.99,
      currency: "USD",
      billingCycle: "monthly",
      nextBillingDate: "2026-06-03",
    });
    expect(kv.keys().some((key) => key.includes(String(userId)))).toBe(false);
    expect(
      sentMessages.some((msg) =>
        String(msg.text).includes("Subscription added"),
      ),
    ).toBe(true);

    await bot.handleUpdate(messageUpdate(2, userId, "/reminders"));

    expect(
      sentMessages.some((msg) =>
        JSON.stringify(msg).includes("Upcoming reminders"),
      ),
    ).toBe(true);
    expect(
      sentMessages.some((msg) => JSON.stringify(msg).includes("Netflix")),
    ).toBe(true);
    expect(
      sentMessages.some((msg) => String(msg.text).includes("123456789")),
    ).toBe(false);
  });

  it("continues the interactive add conversation after the name reply", async () => {
    vi.useRealTimers();
    const sentMessages: TelegramPayload[] = [];
    const kv = createMockKV();
    const env = createEnv(kv);
    const bot = createBot(env, {
      fetch: vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) => {
          const payload = JSON.parse(
            String(init?.body ?? "{}"),
          ) as TelegramPayload;
          sentMessages.push(payload);
          return new Response(
            JSON.stringify({
              ok: true,
              result: {
                message_id: sentMessages.length,
                date: 0,
                chat: { id: payload.chat_id, type: "private" },
                text: String(payload.text ?? ""),
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
      ),
    });
    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };
    const userId = 123456789;

    await bot.handleUpdate(messageUpdate(1, userId, "/add"));
    await bot.handleUpdate(messageUpdate(2, userId, "Netflix"));

    expect(sentMessages.map((msg) => msg.text)).toContain(
      "What is the subscription name?",
    );
    expect(
      sentMessages.some((msg) =>
        String(msg.text).includes("What is the price?"),
      ),
    ).toBe(true);
  });
});
