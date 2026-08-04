import { describe, it, expect } from "vitest";
import { createBot } from "../src/bot/createBot.js";
import { hashUserId } from "../src/crypto/userHash.js";
import type { Env } from "../src/types/env.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, _options?: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: "" }),
  } as unknown as KVNamespace;
}

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: createMockKV(),
    ...overrides,
  };
}

describe("createBot session configuration", () => {
  it("uses hashed user ID as session key, not raw Telegram ID", async () => {
    const env = createMockEnv();
    const bot = createBot(env);

    // Track what KV keys are accessed during an update
    const accessedKeys: string[] = [];
    const originalGet = env.SUBSCRIPTION_KV.get.bind(env.SUBSCRIPTION_KV);
    env.SUBSCRIPTION_KV.get = async (key: string) => {
      accessedKeys.push(key);
      return originalGet(key);
    };

    const userId = 123456789;
    const expectedUserKey = await hashUserId(userId, env.USER_HASH_SECRET);

    // Bypass Telegram API initialization
    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };

    // Simulate a message update that triggers session loading
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Test" },
        text: "/help",
      },
    });

    // The session key should use the hashed user ID, not the raw ID
    const sessionKey = `session:${expectedUserKey}`;
    const hasSessionKey = accessedKeys.some((k) => k === sessionKey);
    expect(hasSessionKey).toBe(true);

    // Should NOT contain raw user ID in any key
    const rawIdInKey = accessedKeys.some((k) => k.includes(String(userId)));
    expect(rawIdInKey).toBe(false);
  });

  it("uses the same session key for sequentialize and session storage", async () => {
    const env = createMockEnv();
    const bot = createBot(env);

    const accessedKeys: string[] = [];
    const originalGet = env.SUBSCRIPTION_KV.get.bind(env.SUBSCRIPTION_KV);
    const originalPut = env.SUBSCRIPTION_KV.put.bind(env.SUBSCRIPTION_KV);
    env.SUBSCRIPTION_KV.get = async (key: string) => {
      accessedKeys.push(key);
      return originalGet(key);
    };
    env.SUBSCRIPTION_KV.put = async (
      key: string,
      value: string,
      options?: unknown,
    ) => {
      accessedKeys.push(key);
      return originalPut(key, value, options);
    };

    const userId = 987654321;
    const expectedUserKey = await hashUserId(userId, env.USER_HASH_SECRET);
    const expectedSessionKey = `session:${expectedUserKey}`;

    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };

    // Simulate two private updates from the same Telegram user
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Test" },
        text: "/help",
      },
    });

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: "private" },
        from: { id: userId, is_bot: false, first_name: "Test" },
        text: "/help",
      },
    });

    // Both updates should access the same session key
    const sessionKeyAccesses = accessedKeys.filter(
      (k) => k === expectedSessionKey,
    );
    expect(sessionKeyAccesses.length).toBeGreaterThanOrEqual(2);

    // No key should contain the raw Telegram ID
    const rawIdInKey = accessedKeys.some((k) => k.includes(String(userId)));
    expect(rawIdInKey).toBe(false);
  });

  it("does not access session for updates without from.id", async () => {
    const env = createMockEnv();
    const bot = createBot(env);

    const accessedKeys: string[] = [];
    const writtenKeys: string[] = [];
    const originalGet = env.SUBSCRIPTION_KV.get.bind(env.SUBSCRIPTION_KV);
    const originalPut = env.SUBSCRIPTION_KV.put.bind(env.SUBSCRIPTION_KV);
    env.SUBSCRIPTION_KV.get = async (key: string) => {
      accessedKeys.push(key);
      return originalGet(key);
    };
    env.SUBSCRIPTION_KV.put = async (
      key: string,
      value: string,
      options?: unknown,
    ) => {
      writtenKeys.push(key);
      return originalPut(key, value, options);
    };

    // Bypass Telegram API initialization
    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };

    // A channel post has no from.id
    await bot.handleUpdate({
      update_id: 1,
      channel_post: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -1001234567890, type: "channel" },
        text: "/help",
      },
    });

    // No session key should be accessed or written
    const sessionAccessed = accessedKeys.some((k) => k.startsWith("session:"));
    const sessionWritten = writtenKeys.some((k) => k.startsWith("session:"));
    expect(sessionAccessed).toBe(false);
    expect(sessionWritten).toBe(false);
  });

  it("stops group and channel commands before downstream middleware", async () => {
    const env = createMockEnv();
    const bot = createBot(env);

    let downstreamReached = false;

    // Add a downstream middleware that sets a flag
    bot.use(async (_ctx, next) => {
      downstreamReached = true;
      await next();
    });

    (bot as any).botInfo = {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "testbot",
    };

    // A channel post has no from.id
    await bot.handleUpdate({
      update_id: 1,
      channel_post: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -1001234567890, type: "channel" },
        text: "/help",
      },
    });

    expect(downstreamReached).toBe(false);
  });
});
