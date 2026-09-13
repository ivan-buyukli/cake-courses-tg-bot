import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "@grammyjs/conversations";
import type { KVNamespace } from "@cloudflare/workers-types";
import { editReminderConversation } from "../src/bot/conversations/editFieldConversation.js";
import {
  collectReminderPolicyInput,
  reminderPolicyKeyboard,
} from "../src/bot/conversations/reminderPolicyInput.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import type { BaseBotContext, BotContext } from "../src/types/context.js";
import type { Env } from "../src/types/env.js";

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
    list: async (options?: { prefix?: string }) => ({
      keys: Array.from(store.keys())
        .filter((key) => key.startsWith(options?.prefix ?? ""))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    }),
  } as unknown as KVNamespace;
}

function createEnv(kv: KVNamespace): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-user-secret",
    SUBSCRIPTION_KV: kv,
  };
}

function callbackUpdate(data: string) {
  return {
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
}

describe("reminder policy input", () => {
  it("renders the current policy and all actions", () => {
    const inherited = reminderPolicyKeyboard("sub-1").inline_keyboard.flat();
    const overridden = reminderPolicyKeyboard("sub-1", {
      mode: "once",
      daysBefore: 1,
    }).inline_keyboard.flat();

    expect(inherited.map((button) => button.text)).toEqual([
      "✓ 跟随默认设置",
      "仅提前 1 天提醒一次",
      "取消",
    ]);
    expect(overridden.map((button) => button.text)).toEqual([
      "跟随默认设置",
      "✓ 仅提前 1 天提醒一次",
      "取消",
    ]);
  });

  it("ignores invalid callbacks before accepting a valid selection", async () => {
    const invalid = callbackUpdate("editreminder:once1:other-sub");
    const valid = callbackUpdate("editreminder:once1:sub-1");
    const conversation = {
      wait: vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid),
    } as unknown as Conversation<BotContext, BaseBotContext>;
    const ctx = {
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as BaseBotContext;

    await expect(
      collectReminderPolicyInput(conversation, ctx, "sub-1"),
    ).resolves.toEqual({ mode: "once", daysBefore: 1 });
    expect(invalid.answerCallbackQuery).toHaveBeenCalledWith(
      "请选择有效的提醒方式。",
    );
  });

  it("returns null for text cancellation", async () => {
    const conversation = {
      wait: vi.fn().mockResolvedValue({ message: { text: "/cancel" } }),
    } as unknown as Conversation<BotContext, BaseBotContext>;
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { reply } as unknown as BaseBotContext;

    await expect(
      collectReminderPolicyInput(conversation, ctx, "sub-1"),
    ).resolves.toBeNull();
    expect(reply).toHaveBeenCalledWith("已取消。");
  });
});

describe("editReminderConversation", () => {
  it("persists the selection and restores the direct-chat menu", async () => {
    const kv = createMockKV();
    const env = createEnv(kv);
    const service = createSubscriptionService(
      createSubscriptionRepository(kv),
      createReminderRepository(kv),
    );
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-09-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      VALID_KEY,
    );

    const outsideCtx = {
      userKey: "user-1",
      env,
      requestId: "request-1",
    } as unknown as BotContext;
    const conversation = {
      external: async <T>(callback: (ctx: BotContext) => T | Promise<T>) =>
        callback(outsideCtx),
      wait: vi
        .fn()
        .mockResolvedValue(callbackUpdate("editreminder:once1:sub-1")),
    } as unknown as Conversation<BotContext, BaseBotContext>;
    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx = { reply } as unknown as BaseBotContext;

    await editReminderConversation(conversation, ctx, "sub-1");

    const updated = await service.get("user-1", "sub-1", VALID_KEY);
    expect(updated?.reminderPolicy).toEqual({ mode: "once", daysBefore: 1 });
    expect(reply).toHaveBeenLastCalledWith(
      expect.stringContaining("提醒方式设为"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("updates the original list-manager panel", async () => {
    const kv = createMockKV();
    const env = createEnv(kv);
    const service = createSubscriptionService(
      createSubscriptionRepository(kv),
      createReminderRepository(kv),
    );
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-09-01",
        reminderPolicy: { mode: "once", daysBefore: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      VALID_KEY,
    );

    const outsideCtx = {
      userKey: "user-1",
      env,
      requestId: "request-1",
    } as unknown as BotContext;
    const conversation = {
      external: async <T>(callback: (ctx: BotContext) => T | Promise<T>) =>
        callback(outsideCtx),
      wait: vi
        .fn()
        .mockResolvedValue(callbackUpdate("editreminder:inherit:sub-1")),
    } as unknown as Conversation<BotContext, BaseBotContext>;
    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: vi.fn().mockResolvedValue(undefined),
      api: { editMessageText },
    } as unknown as BaseBotContext;

    await editReminderConversation(conversation, ctx, "sub-1", {
      source: "listManager",
      page: 2,
      panel: { chatId: 123, messageId: 456 },
    });

    expect(
      (await service.get("user-1", "sub-1", VALID_KEY))?.reminderPolicy,
    ).toBeUndefined();
    expect(editMessageText).toHaveBeenCalledWith(
      123,
      456,
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "table",
            cells: expect.arrayContaining([
              [
                expect.objectContaining({ text: "提醒" }),
                expect.objectContaining({ text: "跟随默认设置" }),
              ],
            ]),
          }),
        ]),
      }),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });
});

describe("settings overview conversation", () => {
  it("reads outside context and refreshes displayed values after saving", async () => {
    const { settingsConversation } = await import(
      "../src/bot/conversations/settingsConversation.js"
    );
    const { createUserRepository } = await import(
      "../src/repositories/userRepository.js"
    );
    const kv = createMockKV();
    const env = createEnv(kv);
    const outside = {
      userKey: "settings-user",
      env,
      requestId: "settings-test",
    } as BotContext;
    const updates = [
      "settings:toggle_reminder",
      "settings:hour:10",
      "settings:done",
    ].map((data) => ({
      callbackQuery: { data },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(true),
    }));
    const external = vi.fn(async (callback: (ctx: BotContext) => unknown) =>
      callback(outside),
    );
    const conversation = {
      external,
      wait: vi
        .fn()
        .mockResolvedValueOnce(updates[0])
        .mockResolvedValueOnce(updates[1])
        .mockResolvedValueOnce(updates[2]),
    } as unknown as Conversation<BotContext, BaseBotContext>;
    const ctx = {
      chat: { id: 123, type: "private" },
      reply: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } }),
      api: {
        sendRichMessage: vi
          .fn()
          .mockResolvedValue({ message_id: 2, chat: { id: 123 } }),
        editMessageText: vi.fn().mockResolvedValue(true),
      },
    } as unknown as BaseBotContext;
    await settingsConversation(conversation, ctx);
    const settings = await createUserRepository(kv).getUserSettings(
      "settings-user",
      VALID_KEY,
    );
    expect(settings.reminderEnabled).toBe(false);
    expect(settings.reminderHour).toBe(10);
    expect(external).toHaveBeenCalled();
    expect(
      JSON.stringify(updates[0].editMessageText.mock.calls[0][0]),
    ).toContain("关闭");
    expect(
      JSON.stringify(updates[1].editMessageText.mock.calls[0][0]),
    ).toContain("10:00");
    expect(ctx.api.sendRichMessage).toHaveBeenCalledTimes(1);
  });
});
