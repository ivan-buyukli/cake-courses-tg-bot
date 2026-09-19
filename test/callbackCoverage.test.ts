import { describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  deleteCancelCallback,
  deleteConfirmCallback,
} from "../src/bot/callbacks/deleteConfirm.js";
import {
  privacyDeleteCancelCallback,
  privacyDeleteConfirmCallback,
} from "../src/bot/callbacks/privacyCallbacks.js";
import {
  subDeleteCallback,
  subEditCallback,
  subPauseCallback,
  subResumeCallback,
  subViewCallback,
  reminderRenewCallback,
} from "../src/bot/callbacks/subCallbacks.js";
import { formatSubscriptionDetails } from "../src/utils/formatSubscription.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
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

function createCallbackContext(
  kv: KVNamespace,
  data: string,
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
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
      exitAll: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as BotContext;
}

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
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
  sub: Subscription = createSub(),
): Promise<void> {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  const service = createSubscriptionService(repo, reminderRepo);
  await service.create("user-key", sub, VALID_KEY);
}

function createService(kv: KVNamespace) {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  return createSubscriptionService(repo, reminderRepo);
}

describe("delete confirmation callbacks", () => {
  it("deletes an existing subscription", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const ctx = createCallbackContext(kv, "delete:confirm:sub-1");

    await deleteConfirmCallback(ctx);

    expect(
      await createService(kv).get("user-key", "sub-1", VALID_KEY),
    ).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(" has been deleted.");
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "“Netflix” has been deleted.",
    );
  });

  it("is idempotent when the subscription is already gone", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "delete:confirm:missing");

    await deleteConfirmCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Already deleted.");
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Subscription not found, or it has been deleted.",
    );
  });

  it("answers invalid callback data without editing the message", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "delete:bad");

    await deleteConfirmCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Invalid button data.",
    );
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("handles missing userKey", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "delete:confirm:sub-1", {
      userKey: undefined,
    });

    await deleteConfirmCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Unable to identify your account.",
    );
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Unable to identify your account.",
    );
  });

  it("cancels deletion without touching data", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const ctx = createCallbackContext(kv, "delete:cancel:sub-1");

    await deleteCancelCallback(ctx);

    expect(
      await createService(kv).get("user-key", "sub-1", VALID_KEY),
    ).not.toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Cancelled.");
    expect(ctx.editMessageText).toHaveBeenCalledWith("Deletion cancelled.");
  });
});

describe("privacy delete callbacks", () => {
  it("deletes subscriptions, reminder entries, and user profile", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const userRepo = createUserRepository(kv);
    await userRepo.upsertUserProfile("user-key", 123456789, VALID_KEY);
    const ctx = createCallbackContext(kv, "privacy:delete_confirm");

    await privacyDeleteConfirmCallback(ctx);

    const service = createService(kv);
    const reminderRepo = createReminderRepository(kv);
    expect(await service.list("user-key", VALID_KEY)).toHaveLength(0);
    expect(await reminderRepo.listEntries("2026-06-01")).toHaveLength(0);
    expect(await userRepo.getUserProfile("user-key", VALID_KEY)).toBeNull();
    expect(ctx.conversation.exitAll).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(" has been deleted.");
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      "Your saved data has been deleted.",
    );
  });

  it("continues deleting when exiting conversations fails", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const userRepo = createUserRepository(kv);
    await userRepo.upsertUserProfile("user-key", 123456789, VALID_KEY);
    const ctx = createCallbackContext(kv, "privacy:delete_confirm", {
      conversation: {
        exitAll: vi.fn().mockRejectedValue(new Error("not active")),
      } as unknown as BotContext["conversation"],
    });

    await privacyDeleteConfirmCallback(ctx);

    expect(await createService(kv).list("user-key", VALID_KEY)).toHaveLength(0);
    expect(await userRepo.getUserProfile("user-key", VALID_KEY)).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(" has been deleted.");
  });

  it("answers invalid callback data", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "privacy:nope");

    await privacyDeleteConfirmCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      "Invalid button data.",
    );
  });

  it("cancels privacy deletion", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "privacy:delete_cancel");

    await privacyDeleteCancelCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith("Cancelled.");
    expect(ctx.editMessageText).toHaveBeenCalledWith("Deletion cancelled.");
  });
});

describe("subscription callbacks", () => {
  it("formats subscription details", () => {
    const text = formatSubscriptionDetails(
      createSub({ isTrial: true, autoRenew: false }),
    );

    expect(text).toContain("Netflix");
    expect(text).toContain("Price: 12.99 USD");
    expect(text).toContain("Cycle: Monthly");
    expect(text).toContain("Reminder: Use default settings");
    expect(text).toContain("Type: Trial");
    expect(text).toContain("Auto-renewal: No");
    expect(text).toContain("Category: Video");
    expect(text).toContain("Notes: family plan");
  });

  it("views an existing subscription", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const ctx = createCallbackContext(kv, "sub:view:sub-1");

    await subViewCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "table",
            cells: expect.arrayContaining([
              [
                expect.objectContaining({ text: "Subscription" }),
                expect.objectContaining({ text: "Netflix" }),
              ],
            ]),
          }),
        ]),
      }),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("reports missing subscriptions for view/edit/delete/pause actions", async () => {
    const kv = createMockKV();
    const callbacks = [
      [subViewCallback, "sub:view:missing"],
      [subEditCallback, "sub:edit:missing"],
      [subDeleteCallback, "sub:delete:missing"],
      [subPauseCallback, "sub:pause:missing"],
    ] as const;

    for (const [callback, data] of callbacks) {
      const ctx = createCallbackContext(kv, data);
      await callback(ctx);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("Subscription not found"),
        { reply_markup: { inline_keyboard: [] } },
      );
    }
  });

  it("opens edit and delete flows for an existing subscription", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const editCtx = createCallbackContext(kv, "sub:edit:sub-1");
    const deleteCtx = createCallbackContext(kv, "sub:delete:sub-1");

    await subEditCallback(editCtx);
    await subDeleteCallback(deleteCtx);

    expect(editCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Netflix"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(deleteCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Delete "),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("pauses an existing subscription", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    const ctx = createCallbackContext(kv, "sub:pause:sub-1");

    await subPauseCallback(ctx);

    const updated = await createService(kv).get("user-key", "sub-1", VALID_KEY);
    expect(updated?.status).toBe("paused");
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Paused "),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("enters resume conversation", async () => {
    const kv = createMockKV();
    const ctx = createCallbackContext(kv, "sub:resume:sub-1");

    await subResumeCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.conversation.enter).toHaveBeenCalledWith("resume", "sub-1");
  });
});

describe("reminder renewal controls", () => {
  it("preserves the summary and other buttons, including on duplicate clicks", async () => {
    const kv = createMockKV();
    await seedSubscription(kv);
    await seedSubscription(kv, createSub({ id: "sub-2", name: "Spotify" }));
    const data = "reminder:renew:sub-1:2026-06-01";
    const other = {
      text: "Renewed · Spotify",
      callback_data: "reminder:renew:sub-2:2026-06-01",
    };
    const navigation = {
      text: "Manage subscriptions",
      callback_data: "nav:list",
    };
    const makeContext = () =>
      createCallbackContext(kv, data, {
        callbackQuery: {
          data,
          message: {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Renewed · Netflix", callback_data: data }],
                [other],
                [navigation],
              ],
            },
          },
        } as any,
        reply: vi.fn().mockResolvedValue(undefined),
        editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      });
    const first = makeContext();
    await reminderRenewCallback(first);
    expect(first.editMessageText).not.toHaveBeenCalled();
    expect(first.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [[other], [navigation]] },
    });
    expect(first.reply).toHaveBeenCalledWith(
      expect.stringContaining("2026-07-01"),
    );
    const duplicate = makeContext();
    await reminderRenewCallback(duplicate);
    expect(duplicate.reply).toHaveBeenCalledWith(
      expect.stringContaining("already been processed"),
    );
    expect(duplicate.editMessageText).not.toHaveBeenCalled();
    expect(
      (await createService(kv).get("user-key", "sub-1", VALID_KEY))
        ?.nextBillingDate,
    ).toBe("2026-07-01");
    expect(
      (await createService(kv).get("user-key", "sub-2", VALID_KEY))
        ?.nextBillingDate,
    ).toBe("2026-06-01");
  });
});
