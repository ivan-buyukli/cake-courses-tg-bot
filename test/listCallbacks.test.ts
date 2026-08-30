import { describe, it, expect, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  listEditFieldCallback,
  listResumeCallback,
  listPageCallback,
} from "../src/bot/callbacks/listCallbacks.js";
import {
  buildDetailKeyboard,
  buildEditFieldKeyboard,
  buildListPageKeyboard,
} from "../src/bot/keyboards/listManagerKeyboard.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import type { Subscription } from "../src/models/subscription.js";

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
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function createListCallbackContext(
  data: string,
  options?: { rejectHide?: boolean; messageDate?: number; kv?: KVNamespace },
) {
  const editMessageReplyMarkup = options?.rejectHide
    ? vi.fn().mockRejectedValue(new Error("message is not modified"))
    : vi.fn().mockResolvedValue(undefined);

  const editMessageText = vi.fn().mockResolvedValue(undefined);

  return {
    userKey: "user-key",
    requestId: "request-id",
    env: {
      SUBSCRIPTION_KV: options?.kv ?? ({} as KVNamespace),
      ENCRYPTION_KEY: VALID_KEY,
    },
    callbackQuery: {
      data,
      message: {
        date: options?.messageDate ?? Math.floor(Date.now() / 1000),
        chat: { id: 123, type: "private" },
        message_id: 99,
      },
    },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup,
    editMessageText,
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createSubscription(
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: "sub-1",
    name: "Netflix",
    price: 12.99,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function keyboardButtons(
  keyboard: ReturnType<typeof buildDetailKeyboard>,
): Array<{ text: string; callback_data?: string }> {
  return keyboard.inline_keyboard.flat();
}

describe("list manager callbacks", () => {
  it("keeps the source panel and passes its location into text editing", async () => {
    const ctx = createListCallbackContext("list:ef:name:sub-1:2");

    await listEditFieldCallback(ctx as any);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.conversation.enter).toHaveBeenCalledWith(
      "editField",
      "sub-1",
      "name",
      {
        source: "listManager",
        page: 2,
        panel: { chatId: 123, messageId: 99 },
      },
    );
  });

  it("passes the source panel into cycle editing", async () => {
    const ctx = createListCallbackContext("list:ef:cycle:sub-1:1");

    await listEditFieldCallback(ctx as any);

    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.conversation.enter).toHaveBeenCalledWith("editCycle", "sub-1", {
      source: "listManager",
      page: 1,
      panel: { chatId: 123, messageId: 99 },
    });
  });

  it("passes the source panel into reminder policy editing", async () => {
    const ctx = createListCallbackContext("list:ef:reminder:sub-1:1");

    await listEditFieldCallback(ctx as any);

    expect(ctx.conversation.enter).toHaveBeenCalledWith(
      "editReminder",
      "sub-1",
      {
        source: "listManager",
        page: 1,
        panel: { chatId: 123, messageId: 99 },
      },
    );
  });

  it("enters editing without mutating the source panel first", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = createListCallbackContext("list:ef:price:sub-1:0", {
      rejectHide: true,
    });

    await listEditFieldCallback(ctx as any);

    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.conversation.enter).toHaveBeenCalledWith(
      "editField",
      "sub-1",
      "price",
      {
        source: "listManager",
        page: 0,
        panel: { chatId: 123, messageId: 99 },
      },
    );

    warnSpy.mockRestore();
  });

  it("passes the source panel into the resume flow", async () => {
    const ctx = createListCallbackContext("list:resume:sub-1:3");

    await listResumeCallback(ctx as any);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(ctx.conversation.enter).toHaveBeenCalledWith("resume", "sub-1", {
      source: "listManager",
      page: 3,
      panel: { chatId: 123, messageId: 99 },
    });
  });

  it("toggles trial flag from the list edit menu", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    await service.create(
      "user-key",
      {
        id: "sub-1",
        name: "Netflix",
        price: 12.99,
        currency: "USD",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const ctx = createListCallbackContext("list:ef:trial:sub-1:0", { kv });

    await listEditFieldCallback(ctx as any);

    const updated = await service.get("user-key", "sub-1", VALID_KEY);
    expect(updated!.isTrial).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(undefined);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
  });

  it("toggles auto-renew flag from the list edit menu", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    await service.create(
      "user-key",
      {
        id: "sub-1",
        name: "Netflix",
        price: 12.99,
        currency: "USD",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const ctx = createListCallbackContext("list:ef:autorenew:sub-1:0", {
      kv,
    });

    await listEditFieldCallback(ctx as any);

    const updated = await service.get("user-key", "sub-1", VALID_KEY);
    expect(updated!.autoRenew).toBe(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(undefined);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
  });
});

describe("list manager keyboards", () => {
  it("labels pagination buttons with distinct emoji", () => {
    const subs = Array.from({ length: 17 }, (_, index) =>
      createSubscription({ id: `sub-${index}`, name: `Sub ${index}` }),
    );

    const firstPage = buildListPageKeyboard(subs, 0);
    expect(keyboardButtons(firstPage)).toContainEqual({
      text: "➡️ 下一页",
      callback_data: "list:page:1",
    });

    const middlePage = buildListPageKeyboard(subs, 1);
    expect(keyboardButtons(middlePage)).toContainEqual({
      text: "⬅️ 上一页",
      callback_data: "list:page:0",
    });
    expect(keyboardButtons(middlePage)).toContainEqual({
      text: "➡️ 下一页",
      callback_data: "list:page:2",
    });
  });

  it("shows direct status actions on active subscription details", () => {
    const keyboard = buildDetailKeyboard(createSubscription(), 0);

    expect(keyboardButtons(keyboard)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "✏️ 编辑",
          callback_data: "list:edit:sub-1:0",
          style: "primary",
        }),
        expect.objectContaining({
          text: "🗑 删除",
          callback_data: "list:del:sub-1:0",
          style: "danger",
        }),
        { text: "⏸ 暂停", callback_data: "list:pause:sub-1:0" },
        { text: "标记体验", callback_data: "list:ef:trial:sub-1:0" },
        {
          text: "关闭自动续费",
          callback_data: "list:ef:autorenew:sub-1:0",
        },
      ]),
    );
  });

  it("shows reverse direct actions for trial, non-renewing, and paused details", () => {
    const keyboard = buildDetailKeyboard(
      createSubscription({
        status: "paused",
        isTrial: true,
        autoRenew: false,
      }),
      2,
    );

    expect(keyboardButtons(keyboard)).toEqual(
      expect.arrayContaining([
        { text: "▶️ 恢复", callback_data: "list:resume:sub-1:2" },
        { text: "取消体验", callback_data: "list:ef:trial:sub-1:2" },
        {
          text: "开启自动续费",
          callback_data: "list:ef:autorenew:sub-1:2",
        },
      ]),
    );
  });

  it("keeps trial and auto-renew actions out of the edit field menu", () => {
    const keyboard = buildEditFieldKeyboard("sub-1", 0);
    const labels = keyboardButtons(keyboard).map((button) => button.text);

    expect(labels).toContain("名称");
    expect(labels).toContain("下次扣款日期");
    expect(labels).toContain("提醒方式");
    expect(labels).not.toContain("切换体验");
    expect(labels).not.toContain("切换自动续费");
    expect(keyboardButtons(keyboard)).not.toContainEqual({
      text: "标记体验",
      callback_data: "list:ef:trial:sub-1:0",
    });
    expect(keyboardButtons(keyboard)).not.toContainEqual({
      text: "关闭自动续费",
      callback_data: "list:ef:autorenew:sub-1:0",
    });
  });
});

describe("list panel age check", () => {
  it("fresh panel still works", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    await service.create(
      "user-key",
      {
        id: "sub-1",
        name: "Netflix",
        price: 12.99,
        currency: "USD",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ctx = createListCallbackContext("list:page:0", {
      messageDate: nowSeconds - 60, // 1 minute old
      kv,
    });

    await listPageCallback(ctx as any);

    // Should answer the callback and render the list page
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const editedText = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(editedText).toContain("你的订阅 — 第 1/1 页");
  });

  it("old panel answers with expired-panel message", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ctx = createListCallbackContext("list:page:0", {
      messageDate: nowSeconds - 3700, // more than 1 hour old
    });

    await listPageCallback(ctx as any);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "这个管理面板已过期，请重新打开。",
    );
  });

  it("old panel is replaced with a restart action", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ctx = createListCallbackContext("list:page:0", {
      messageDate: nowSeconds - 3700,
    });

    await listPageCallback(ctx as any);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("管理面板已过期"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });
});
