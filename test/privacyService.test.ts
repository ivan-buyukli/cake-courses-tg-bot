import { describe, it, expect } from "vitest";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createPrivacyService } from "../src/services/privacyService.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import {
  createUserRepository,
  USER_DELETION_TOMBSTONE_TTL_SECONDS,
} from "../src/repositories/userRepository.js";
import { userDeleted } from "../src/utils/kvKeys.js";
import type { KVNamespace } from "@cloudflare/workers-types";

// A valid base64url-encoded 32-byte master key
const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): KVNamespace & {
  putOptionsFor(key: string): { expirationTtl?: number } | undefined;
} {
  const store = new Map<string, string>();
  const putOptions = new Map<string, { expirationTtl?: number }>();

  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ) => {
      store.set(key, value);
      putOptions.set(key, options ?? {});
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const prefix = options?.prefix ?? "";
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
    putOptionsFor: (key: string) => putOptions.get(key),
  } as unknown as KVNamespace & {
    putOptionsFor(key: string): { expirationTtl?: number } | undefined;
  };
}

describe("privacyService", () => {
  it("exports user data with correct format", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await subscriptionService.create(userKey, sub, VALID_KEY);

    const exported = await privacyService.exportUserData(userKey, VALID_KEY);

    expect(exported.version).toBe(2);
    expect(typeof exported.exportedAt).toBe("string");
    expect(exported.subscriptions).toHaveLength(1);
    expect(exported.subscriptions[0].id).toBe("sub-1");
    expect(exported.subscriptions[0].name).toBe("Netflix");
    expect(exported.subscriptions[0].price).toBe(12.99);
    expect(exported.subscriptions[0].currency).toBe("EUR");
  });

  it("export does not include internal identifiers", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await subscriptionService.create(userKey, sub, VALID_KEY);

    const exported = await privacyService.exportUserData(userKey, VALID_KEY);
    const json = JSON.stringify(exported);

    expect(json).not.toContain("userKey");
    expect(json).not.toContain("user-key-123");
    expect(json).not.toContain("encryptedPayload");
  });

  it("deleteUserData removes all subscriptions for the user", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await subscriptionService.create(userKey, sub, VALID_KEY);
    await privacyService.deleteUserData(userKey);

    const list = await subscriptionService.list(userKey, VALID_KEY);
    expect(list).toHaveLength(0);
  });

  it("deleteUserData does not affect another user", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userA = "user-a";
    const userB = "user-b";

    await subscriptionService.create(
      userA,
      {
        id: "sub-a",
        name: "Netflix",
        price: 12.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      VALID_KEY,
    );

    await subscriptionService.create(
      userB,
      {
        id: "sub-b",
        name: "Spotify",
        price: 9.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-15",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      VALID_KEY,
    );

    await privacyService.deleteUserData(userA);

    const listA = await subscriptionService.list(userA, VALID_KEY);
    const listB = await subscriptionService.list(userB, VALID_KEY);

    expect(listA).toHaveLength(0);
    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe("Spotify");
  });

  it("export returns empty subscriptions array when user has no data", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const exported = await privacyService.exportUserData(
      "empty-user",
      VALID_KEY,
    );

    expect(exported.version).toBe(2);
    expect(exported.subscriptions).toHaveLength(0);
  });

  it("deleteUserData removes user profile", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    expect(await userRepo.getUserProfile(userKey, VALID_KEY)).not.toBeNull();

    await privacyService.deleteUserData(userKey);

    expect(await userRepo.getUserProfile(userKey, VALID_KEY)).toBeNull();
  });

  it("deleteUserData leaves a deletion tombstone", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    await privacyService.deleteUserData(userKey);

    expect(await userRepo.isUserDeleted(userKey)).toBe(true);
    expect(kv.putOptionsFor(userDeleted(userKey))?.expirationTtl).toBe(
      USER_DELETION_TOMBSTONE_TTL_SECONDS,
    );
  });

  it("deleteUserData removes reminder index entries for the user", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(repo, reminderRepo);
    const privacyService = createPrivacyService(
      subscriptionService,
      userRepo,
      reminderRepo,
    );

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await subscriptionService.create(userKey, sub, VALID_KEY);
    await privacyService.deleteUserData(userKey);

    const entries = await reminderRepo.listEntries("2026-06-01");
    expect(entries).toHaveLength(0);
  });
});
