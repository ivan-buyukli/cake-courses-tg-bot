import { describe, it, expect } from "vitest";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import {
  decrypt,
  encrypt,
  parseEncryptedPayload,
  serializeEncryptedPayload,
} from "../src/crypto/encryption.js";
import { deriveUserKey } from "../src/crypto/keyDerivation.js";
import type { KVNamespace } from "@cloudflare/workers-types";

// A valid base64url-encoded 32-byte master key
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
  } as unknown as KVNamespace;
}

describe("subscriptionService", () => {
  it("creates and lists a subscription", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await service.create(userKey, sub, VALID_KEY);

    const stored = await repo.get(userKey, "sub-1");
    expect(stored).not.toBeNull();
    await expect(
      decrypt(parseEncryptedPayload(stored!.encryptedPayload), VALID_KEY),
    ).rejects.toThrow();

    const list = await service.list(userKey, VALID_KEY);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Netflix");
    expect(list[0].price).toBe(12.99);
  });

  it("does not persist a subscription when its reminder index cannot be added", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, {
      ...reminderRepo,
      addEntry: async () => {
        throw new Error("index unavailable");
      },
    });

    await expect(
      service.create(
        "user-key-123",
        {
          id: "sub-1",
          name: "Netflix",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-01",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        VALID_KEY,
      ),
    ).rejects.toThrow("index unavailable");

    expect(await repo.get("user-key-123", "sub-1")).toBeNull();
  });

  it("leaves only a harmless stale reminder index when record persistence fails", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(
      {
        ...repo,
        save: async () => {
          throw new Error("record unavailable");
        },
      },
      reminderRepo,
    );

    await expect(
      service.create(
        "user-key-123",
        {
          id: "sub-1",
          name: "Netflix",
          billingCycle: "monthly",
          nextBillingDate: "2026-06-01",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        VALID_KEY,
      ),
    ).rejects.toThrow("record unavailable");

    expect(await reminderRepo.listEntries("2026-06-01")).toEqual([
      { userKey: "user-key-123", subscriptionId: "sub-1" },
    ]);
    expect(await repo.get("user-key-123", "sub-1")).toBeNull();
  });

  it("gets a single subscription", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await service.create(userKey, sub, VALID_KEY);

    const retrieved = await service.get(userKey, "sub-1", VALID_KEY);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("Netflix");
  });

  it("returns null for non-existent subscription", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const retrieved = await service.get("user-key", "missing", VALID_KEY);
    expect(retrieved).toBeNull();
  });

  it("removes a subscription", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-06-01",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await service.create(userKey, sub, VALID_KEY);
    await service.remove(userKey, "sub-1");

    const list = await service.list(userKey, VALID_KEY);
    expect(list).toHaveLength(0);
  });

  it("isolates subscriptions between users", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userA = "user-a";
    const userB = "user-b";

    await service.create(
      userA,
      {
        id: "sub-a",
        name: "Netflix",
        price: 12.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    await service.create(
      userB,
      {
        id: "sub-b",
        name: "Spotify",
        price: 9.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: "2026-06-15",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const listA = await service.list(userA, VALID_KEY);
    const listB = await service.list(userB, VALID_KEY);

    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("Netflix");
    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe("Spotify");
  });

  it("stores a billing anchor day when creating a subscription", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-01-31",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await service.create(userKey, sub, VALID_KEY);

    const retrieved = await service.get(userKey, "sub-1", VALID_KEY);
    const stored = await repo.get(userKey, "sub-1");
    expect(retrieved?.billingAnchorDay).toBe(31);
    expect(stored?.billingAnchorDay).toBe(31);
  });

  it("advances a past-due subscription and moves the reminder index", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-01-31",
      billingAnchorDay: 31,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await service.create(userKey, sub, VALID_KEY);
    const advanced = await service.advancePastDue(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-02-28",
    );

    expect(advanced?.nextBillingDate).toBe("2026-03-31");
    expect(await reminderRepo.listEntries("2026-01-31")).toEqual([]);
    expect(await reminderRepo.listEntries("2026-03-31")).toEqual([
      { userKey, subscriptionId: "sub-1" },
    ]);
    const stored = await repo.get(userKey, "sub-1");
    expect(stored?.nextBillingDate).toBe("2026-03-31");
  });

  it("advances old subscriptions without a stored billing anchor day", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    const sub = {
      id: "sub-1",
      name: "Netflix",
      billingCycle: "monthly" as const,
      nextBillingDate: "2026-01-30",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const encrypted = await encrypt(
      JSON.stringify(sub),
      await deriveUserKey(VALID_KEY, userKey),
    );
    await repo.save(userKey, {
      id: sub.id,
      encryptedPayload: serializeEncryptedPayload(encrypted),
      nextBillingDate: sub.nextBillingDate,
      billingCycle: sub.billingCycle,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });
    await reminderRepo.addEntry(sub.nextBillingDate, userKey, sub.id);

    const advanced = await service.advancePastDue(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-02-28",
    );

    expect(advanced?.billingAnchorDay).toBe(30);
    expect(advanced?.nextBillingDate).toBe("2026-03-30");
  });

  it("advances interval subscriptions and moves the reminder index", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    await service.create(
      userKey,
      {
        id: "sub-1",
        name: "Every 30 days",
        billingCycle: "interval",
        billingInterval: { unit: "day", count: 30 },
        nextBillingDate: "2026-01-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const advanced = await service.advancePastDue(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-02-15",
    );

    expect(advanced?.nextBillingDate).toBe("2026-03-02");
    expect(advanced?.billingInterval).toEqual({ unit: "day", count: 30 });
    expect(await reminderRepo.listEntries("2026-01-01")).toEqual([]);
    expect(await reminderRepo.listEntries("2026-03-02")).toEqual([
      { userKey, subscriptionId: "sub-1" },
    ]);
    const stored = await repo.get(userKey, "sub-1");
    expect(stored?.billingInterval).toEqual({ unit: "day", count: 30 });
  });

  it("renews one cycle and moves the reminder index", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    await service.create(
      userKey,
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-01-31",
        billingAnchorDay: 31,
        isTrial: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const result = await service.renewOneCycle(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-01-31",
    );

    expect(result.status).toBe("renewed");
    if (result.status !== "renewed") throw new Error("expected renewal");
    expect(result.subscription.nextBillingDate).toBe("2026-02-28");
    expect(result.subscription.isTrial).toBe(false);
    expect(await reminderRepo.listEntries("2026-01-31")).toEqual([]);
    expect(await reminderRepo.listEntries("2026-02-28")).toEqual([
      { userKey, subscriptionId: "sub-1" },
    ]);
  });

  it("does not renew from a stale reminder date", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    await service.create(
      userKey,
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-02-28",
        billingAnchorDay: 31,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const result = await service.renewOneCycle(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-01-31",
    );

    expect(result.status).toBe("stale");
    const current = await service.get(userKey, "sub-1", VALID_KEY);
    expect(current?.nextBillingDate).toBe("2026-02-28");
  });

  it("does not advance custom billing cycles", async () => {
    const kv = createMockKV();
    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);

    const userKey = "user-key-123";
    await service.create(
      userKey,
      {
        id: "sub-1",
        name: "Custom",
        billingCycle: "custom",
        nextBillingDate: "2026-01-01",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const advanced = await service.advancePastDue(
      userKey,
      "sub-1",
      VALID_KEY,
      "2026-05-18",
    );

    expect(advanced?.nextBillingDate).toBe("2026-01-01");
  });
});
