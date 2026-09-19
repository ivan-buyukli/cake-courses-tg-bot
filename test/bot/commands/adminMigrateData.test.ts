import { describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  adminMigrateDataCommand,
  migrateHistoricalData,
} from "../../../src/bot/commands/adminMigrateData.js";
import { createReminderRepository } from "../../../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../../../src/repositories/subscriptionRepository.js";
import { createUserRepository } from "../../../src/repositories/userRepository.js";
import { createSubscriptionService } from "../../../src/services/subscriptionService.js";
import {
  encrypt,
  serializeEncryptedPayload,
} from "../../../src/crypto/encryption.js";
import {
  reminderDateEntry,
  userProfile,
  userSubscriptionsIndex,
} from "../../../src/utils/kvKeys.js";
import type { BotContext } from "../../../src/types/context.js";
import type { Env } from "../../../src/types/env.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(
      async (options?: {
        prefix?: string;
        limit?: number;
        cursor?: string;
      }) => {
        const prefix = options?.prefix ?? "";
        const keys = Array.from(store.keys())
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((name) => ({ name }));
        return { keys, list_complete: true, cursor: "" };
      },
    ),
  } as unknown as KVNamespace;
}

function createEnv(kv: KVNamespace, overrides: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "hash-secret",
    ADMIN_USER_ID: "123456",
    SUBSCRIPTION_KV: kv,
    APP_ENV: "test",
    ...overrides,
  };
}

function createContext(
  kv: KVNamespace,
  overrides: Partial<BotContext> = {},
): BotContext {
  return {
    isAdmin: true,
    env: createEnv(kv),
    requestId: "request-id",
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

describe("adminMigrateDataCommand", () => {
  it("rejects non-admin users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, { isAdmin: false });

    await adminMigrateDataCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "This command is only available to admins.",
    );
  });

  it("migrates legacy encrypted data and reminder arrays", async () => {
    const kv = createMockKV();
    const userKey = "user-1";
    const now = new Date().toISOString();
    const profile = {
      chatId: 123456,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    const subscription = {
      id: "sub-1",
      name: "Legacy Netflix",
      price: 9,
      currency: "USD",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    const encryptedProfile = await encrypt(JSON.stringify(profile), VALID_KEY);
    const encryptedSubscription = await encrypt(
      JSON.stringify(subscription),
      VALID_KEY,
    );

    await kv.put(
      userProfile(userKey),
      JSON.stringify({
        userKey,
        encryptedPayload: serializeEncryptedPayload(encryptedProfile),
        createdAt: now,
        updatedAt: now,
      }),
    );
    await kv.put(
      `user:${userKey}:sub:${subscription.id}`,
      JSON.stringify({
        id: subscription.id,
        encryptedPayload: serializeEncryptedPayload(encryptedSubscription),
        nextBillingDate: subscription.nextBillingDate,
        billingCycle: subscription.billingCycle,
        status: subscription.status,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await kv.put(`user:${userKey}:subs`, JSON.stringify([subscription.id]));
    await kv.put(
      "reminders:date:2026-06-01",
      JSON.stringify([{ userKey, subscriptionId: subscription.id }]),
    );

    const result = await migrateHistoricalData(kv, VALID_KEY);

    expect(result).toMatchObject({
      profilesMigrated: 1,
      subscriptionsMigrated: 1,
      reminderEntriesMigrated: 1,
      legacyReminderKeysDeleted: 1,
      skipped: 0,
    });

    const userRepo = createUserRepository(kv);
    await expect(userRepo.getUserProfile(userKey, VALID_KEY)).resolves.toEqual(
      profile,
    );

    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);
    await expect(
      service.get(userKey, subscription.id, VALID_KEY),
    ).resolves.toMatchObject({
      name: "Legacy Netflix",
    });
    await expect(reminderRepo.listEntries("2026-06-01")).resolves.toEqual([
      { userKey, subscriptionId: subscription.id },
    ]);
    await expect(kv.get("reminders:date:2026-06-01")).resolves.toBeNull();
  });

  it("repairs subscription and reminder indexes from stored subscription records", async () => {
    const kv = createMockKV();
    const userKey = "user-1";
    const subRepo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);
    const now = new Date().toISOString();

    await service.create(
      userKey,
      {
        id: "sub-1",
        name: "Netflix",
        price: 9,
        currency: "USD",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      VALID_KEY,
    );
    await service.create(
      userKey,
      {
        id: "sub-2",
      name: "Paused",
        billingCycle: "monthly",
        nextBillingDate: "2026-07-01",
        status: "paused",
        createdAt: now,
        updatedAt: now,
      },
      VALID_KEY,
    );
    await kv.put(userSubscriptionsIndex(userKey), JSON.stringify(["missing"]));
    await kv.delete(reminderDateEntry("2026-06-01", userKey, "sub-1"));
    await kv.delete(reminderDateEntry("2026-07-01", userKey, "sub-2"));

    const result = await migrateHistoricalData(kv, VALID_KEY);

    expect(result).toMatchObject({
      subscriptionIndexesRebuilt: 1,
      reminderEntriesRebuilt: 1,
      skipped: 0,
    });
    await expect(subRepo.listIds(userKey)).resolves.toEqual(["sub-1", "sub-2"]);
    await expect(reminderRepo.listEntries("2026-06-01")).resolves.toEqual([
      { userKey, subscriptionId: "sub-1" },
    ]);
    await expect(reminderRepo.listEntries("2026-07-01")).resolves.toEqual([]);
  });

  it("replies with migration counts", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv);

    await adminMigrateDataCommand(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text).toContain("Historical data migration complete");
    expect(text).toContain("User profiles: 0");
    expect(text).toContain("Subscription indexes rebuilt: 0");
    expect(text).toContain("Reminder indexes rebuilt: 0");
    expect(text).toContain("Skipped: 0");
  });
});
