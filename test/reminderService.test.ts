import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processReminderEntry,
  processReminderEntries,
  getReminderDaysAhead,
  getReminderDateRange,
} from "../src/services/reminderService.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import { Env } from "../src/types/env.js";
import {
  encrypt,
  serializeEncryptedPayload,
} from "../src/crypto/encryption.js";
import { deriveUserKey } from "../src/crypto/keyDerivation.js";
import type { KVNamespace } from "@cloudflare/workers-types";

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

function createMockEnv(): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: {} as unknown as KVNamespace,
    REMINDER_DAYS_AHEAD: "3",
  };
}

async function encryptedSubPayload(
  userKey: string,
  sub: unknown,
): Promise<string> {
  const encrypted = await encrypt(
    JSON.stringify(sub),
    await deriveUserKey(VALID_KEY, userKey),
  );
  return serializeEncryptedPayload(encrypted);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getReminderDaysAhead", () => {
  it("defaults to 3 when missing", () => {
    const env = createMockEnv();
    delete (env as Record<string, unknown>).REMINDER_DAYS_AHEAD;
    expect(getReminderDaysAhead(env)).toBe(3);
  });

  it("defaults to 3 for invalid string", () => {
    const env = createMockEnv();
    env.REMINDER_DAYS_AHEAD = "not-a-number";
    expect(getReminderDaysAhead(env)).toBe(3);
  });

  it("defaults to 3 for negative number", () => {
    const env = createMockEnv();
    env.REMINDER_DAYS_AHEAD = "-1";
    expect(getReminderDaysAhead(env)).toBe(3);
  });

  it("parses a valid positive integer", () => {
    const env = createMockEnv();
    env.REMINDER_DAYS_AHEAD = "7";
    expect(getReminderDaysAhead(env)).toBe(7);
  });

  it("floors a decimal", () => {
    const env = createMockEnv();
    env.REMINDER_DAYS_AHEAD = "3.9";
    expect(getReminderDaysAhead(env)).toBe(3);
  });
});

describe("getReminderDateRange", () => {
  it("returns today-1 through today + daysAhead + 1 inclusive", () => {
    vi.setSystemTime(new Date("2026-05-20T00:00:00Z"));
    const range = getReminderDateRange(3);

    expect(range).toHaveLength(6);
    expect(range[0]).toBe("2026-05-19");
    expect(range[5]).toBe("2026-05-24");
    // Verify each date is one day apart
    for (let i = 1; i < range.length; i++) {
      const prev = new Date(range[i - 1] + "T00:00:00Z");
      const curr = new Date(range[i] + "T00:00:00Z");
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBe(1);
    }
  });
});

describe("processReminderEntry", () => {
  it("sends upcoming reminders during the user's exact local dispatch slot", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-04";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await userRepo.updateUserSettings(
      userKey,
      {
        defaultCurrency: "USD",
        reminderEnabled: true,
        reminderHour: 8,
        timezone: "Asia/Shanghai",
      },
      VALID_KEY,
    );

    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Netflix",
        price: 12.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
      3,
    );

    expect(result.sent).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "Renewed · Netflix",
      style: "success",
      callback_data: "reminder:renew:sub-1:2026-06-04",
    });
  });

  it("skips upcoming reminders outside the exact local dispatch slot", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:30:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-04";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await userRepo.updateUserSettings(
      userKey,
      {
        defaultCurrency: "USD",
        reminderEnabled: true,
        reminderHour: 8,
        timezone: "Asia/Shanghai",
      },
      VALID_KEY,
    );

    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Netflix",
        price: 12.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
      3,
    );

    expect(result.sent).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips upcoming reminders before the configured reminder window", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-05";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
      3,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a reminder in the dispatch slot and persists sent state", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await reminderRepo.hasSent(userKey, subId, date, date)).toBe(true);
  });

  it("sends once per local day from three days ahead through the billing date", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const billingDate = "2026-06-04";
    const reminderDates = [
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      billingDate,
    ];

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: billingDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    for (const localDate of reminderDates) {
      vi.setSystemTime(new Date(`${localDate}T09:00:00Z`));
      const result = await processReminderEntry(
        env,
        reminderRepo,
        subRepo,
        userRepo,
        subscriptionService,
        { userKey, subscriptionId: subId },
        billingDate,
        3,
      );

      expect(result.sent).toBe(true);
      expect(
        await reminderRepo.hasSent(userKey, subId, billingDate, localDate),
      ).toBe(true);

      if (localDate === reminderDates[0]) {
        const duplicate = await processReminderEntry(
          env,
          reminderRepo,
          subRepo,
          userRepo,
          subscriptionService,
          { userKey, subscriptionId: subId },
          billingDate,
          3,
        );
        expect(duplicate.sent).toBe(false);
      }
    }

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("supports a project override that sends only once on the day before billing", async () => {
    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const billingDate = "2026-06-04";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Daily service",
        billingCycle: "weekly",
        nextBillingDate: billingDate,
        reminderPolicy: { mode: "once", daysBefore: 1 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    for (const localDate of ["2026-06-01", "2026-06-02"]) {
      vi.setSystemTime(new Date(`${localDate}T09:00:00Z`));
      const result = await processReminderEntry(
        env,
        reminderRepo,
        subRepo,
        userRepo,
        subscriptionService,
        { userKey, subscriptionId: subId },
        billingDate,
        3,
      );
      expect(result.sent).toBe(false);
    }

    vi.setSystemTime(new Date("2026-06-03T09:00:00Z"));
    const dayBefore = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      billingDate,
      3,
    );
    expect(dayBefore.sent).toBe(true);

    vi.setSystemTime(new Date("2026-06-04T09:00:00Z"));
    const billingDay = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      billingDate,
      3,
    );

    expect(billingDay.sent).toBe(false);
    expect(billingDay.advanced).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(
      (await subscriptionService.get(userKey, subId, VALID_KEY))
        ?.nextBillingDate,
    ).toBe("2026-06-11");
  });

  it("uses trial reminder wording for trial subscriptions", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Trial Service",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      isTrial: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      isTrial: true,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });
    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(JSON.stringify(body.rich_message)).toContain("Trial ends");
    expect(JSON.stringify(body.rich_message)).toContain(
      "Charges may begin when the trial ends",
    );
  });

  it("uses service-end wording for non-renewing subscriptions", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Cancelled Service",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      autoRenew: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      autoRenew: false,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });
    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(JSON.stringify(body.rich_message)).toContain("Service expires");
    expect(JSON.stringify(body.rich_message)).toContain("Service expires");

    const updated = await subscriptionService.get(userKey, subId, VALID_KEY);
    expect(updated?.status).toBe("paused");
    expect(updated?.nextBillingDate).toBe(date);
    expect(await reminderRepo.listEntries(date)).toEqual([]);
  });

  it("skips stale entries when subscription is missing", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(await reminderRepo.hasSent(userKey, subId, date, date)).toBe(false);
  });

  it("skips stale entries when nextBillingDate mismatches", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const indexDate = "2026-06-01";
    const actualDate = "2026-07-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: actualDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: actualDate,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(indexDate, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      indexDate,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      await reminderRepo.hasSent(userKey, subId, indexDate, "2026-06-01"),
    ).toBe(false);
  });

  it("skips reminders that already have sent markers", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);
    await reminderRepo.markSent(userKey, subId, date, date);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns unsent when Telegram send fails", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, description: "Chat not found" }),
          { status: 400 },
        ),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await reminderRepo.hasSent(userKey, subId, date, date)).toBe(false);
  });

  it("skips when no user profile exists", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(await reminderRepo.hasSent(userKey, subId, date, date)).toBe(false);
  });

  it("skips deleted users even if stale reminder data remains", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );
    await userRepo.markUserDeleted(userKey);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      [{ entry: { userKey, subscriptionId: subId }, date }],
    );

    expect(result).toEqual({ sent: 0, messages: 0, advanced: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when reminder hour has not passed", async () => {
    vi.setSystemTime(new Date("2026-06-01T08:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pauses past-due non-renewing subscriptions without sending catch-up reminders", async () => {
    vi.setSystemTime(new Date("2026-06-02T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: subId,
        name: "Cancelled Service",
        price: 12.99,
        currency: "EUR",
        billingCycle: "monthly",
        nextBillingDate: date,
        autoRenew: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(result.sent).toBe(false);
    expect(result.advanced).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();

    const updated = await subscriptionService.get(userKey, subId, VALID_KEY);
    expect(updated?.status).toBe("paused");
    expect(updated?.nextBillingDate).toBe(date);
    expect(await reminderRepo.listEntries(date)).toEqual([]);
  });

  it("pauses non-renewing subscriptions after sending a combined batch reminder", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: "sub-1",
        name: "Cancelled One",
        billingCycle: "monthly",
        nextBillingDate: date,
        autoRenew: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );
    await subscriptionService.create(
      userKey,
      {
        id: "sub-2",
        name: "Cancelled Two",
        billingCycle: "monthly",
        nextBillingDate: date,
        autoRenew: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      [
        { entry: { userKey, subscriptionId: "sub-1" }, date },
        { entry: { userKey, subscriptionId: "sub-2" }, date },
      ],
    );

    expect(result.sent).toBe(2);
    expect(result.messages).toBe(1);
    expect(result.advanced).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await reminderRepo.hasSent(userKey, "sub-1", date, date)).toBe(true);
    expect(await reminderRepo.hasSent(userKey, "sub-2", date, date)).toBe(true);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(JSON.stringify(body.rich_message)).toContain(
      "Subscription reminders · 2 items",
    );
    expect(body.reply_markup.inline_keyboard).toEqual([
      [
        {
          text: "Renewed · Cancelled One",
          style: "success",
          callback_data: "reminder:renew:sub-1:2026-06-01",
        },
      ],
      [
        {
          text: "Renewed · Cancelled Two",
          style: "success",
          callback_data: "reminder:renew:sub-2:2026-06-01",
        },
      ],
      [{ text: "Manage subscriptions", callback_data: "nav:list" }],
    ]);

    const first = await subscriptionService.get(userKey, "sub-1", VALID_KEY);
    const second = await subscriptionService.get(userKey, "sub-2", VALID_KEY);
    expect(first?.status).toBe("paused");
    expect(second?.status).toBe("paused");
    expect(await reminderRepo.listEntries(date)).toEqual([]);
  });

  it("applies one-day reminder overrides through the production batch path", async () => {
    vi.setSystemTime(new Date("2026-06-03T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;
    const userKey = "user-1";
    const date = "2026-06-04";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: "sub-1",
        name: "One-day reminder",
        billingCycle: "weekly",
        nextBillingDate: date,
        reminderPolicy: { mode: "once", daysBefore: 1 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      [{ entry: { userKey, subscriptionId: "sub-1" }, date }],
      3,
    );

    expect(result).toEqual({ sent: 1, messages: 1, advanced: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(
      await reminderRepo.hasSent(userKey, "sub-1", date, "2026-06-03"),
    ).toBe(true);
  });

  it("continues with other users when a sent-marker write fails", async () => {
    vi.setSystemTime(new Date("2026-05-31T09:00:00Z"));

    const kv = createMockKV();
    const baseReminderRepo = createReminderRepository(kv);
    const reminderRepo = {
      ...baseReminderRepo,
      markSent: async (
        userKey: string,
        subscriptionId: string,
        billingDate: string,
        localReminderDate: string,
      ) => {
        if (userKey === "user-1") throw new Error("marker unavailable");
        await baseReminderRepo.markSent(
          userKey,
          subscriptionId,
          billingDate,
          localReminderDate,
        );
      },
    };
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;
    const date = "2026-06-01";

    for (const [userKey, chatId] of [
      ["user-1", 111],
      ["user-2", 222],
    ] as const) {
      await userRepo.upsertUserProfile(userKey, chatId, VALID_KEY);
      await subscriptionService.create(
        userKey,
        {
          id: "sub-1",
          name: userKey,
          billingCycle: "monthly",
          nextBillingDate: date,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        VALID_KEY,
      );
    }

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      ["user-1", "user-2"].map((userKey) => ({
        entry: { userKey, subscriptionId: "sub-1" },
        date,
      })),
    );

    expect(result).toEqual({ sent: 2, messages: 2, advanced: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      await baseReminderRepo.hasSent("user-2", "sub-1", date, "2026-05-31"),
    ).toBe(true);
  });

  it("excludes already sent reminders from combined batch sends", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);
    await subscriptionService.create(
      userKey,
      {
        id: "sub-1",
        name: "Already Sent",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );
    await subscriptionService.create(
      userKey,
      {
        id: "sub-2",
        name: "Unsent",
        billingCycle: "monthly",
        nextBillingDate: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );
    await reminderRepo.markSent(userKey, "sub-1", date, date);
    await reminderRepo.markSent(userKey, "sub-2", date, "2026-05-31");

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      [
        { entry: { userKey, subscriptionId: "sub-1" }, date },
        { entry: { userKey, subscriptionId: "sub-2" }, date },
      ],
    );

    expect(result.sent).toBe(1);
    expect(result.messages).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(JSON.stringify(body.rich_message)).toContain("Unsent");
    expect(JSON.stringify(body.rich_message)).not.toContain("Already Sent");
    expect(await reminderRepo.hasSent(userKey, "sub-2", date, date)).toBe(true);
  });

  it("advances past-due on the billing date after sending", async () => {
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));

    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const subscriptionService = createSubscriptionService(
      subRepo,
      reminderRepo,
    );
    const env = createMockEnv();
    env.SUBSCRIPTION_KV = kv;

    const userKey = "user-1";
    const subId = "sub-1";
    const date = "2026-06-01";

    await userRepo.upsertUserProfile(userKey, 123456, VALID_KEY);

    const sub = {
      id: subId,
      name: "Netflix",
      price: 12.99,
      currency: "EUR",
      billingCycle: "monthly" as const,
      nextBillingDate: date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await subRepo.save(userKey, {
      id: subId,
      encryptedPayload: await encryptedSubPayload(userKey, sub),
      nextBillingDate: date,
      billingCycle: "monthly",
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });

    await reminderRepo.addEntry(date, userKey, subId);

    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    global.fetch = mockFetch;

    const result = await processReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      { userKey, subscriptionId: subId },
      date,
    );

    expect(result.sent).toBe(true);
    expect(result.advanced).toBe(true);

    const updatedSub = await subscriptionService.get(userKey, subId, VALID_KEY);
    expect(updatedSub?.nextBillingDate).toBe("2026-07-01");
  });
});

describe("rich reminder grouping", () => {
  it("marks and advances only successful chunks, then retries the remaining items without resending delivered ones", async () => {
    const { processReminderQueueEntries } = await import(
      "../src/services/reminderService.js"
    );
    vi.setSystemTime(new Date("2026-06-01T09:00:00Z"));
    const kv = createMockKV();
    const reminderRepo = createReminderRepository(kv);
    const subRepo = createSubscriptionRepository(kv);
    const userRepo = createUserRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);
    const env = { ...createMockEnv(), SUBSCRIPTION_KV: kv };
    const date = "2026-06-01";
    const userKey = "test-user";
    await userRepo.upsertUserProfile(userKey, 123, VALID_KEY);
    const inputs = [];
    for (let i = 0; i < 13; i++) {
      const id = `sub-${String(i).padStart(2, "0")}`;
      await service.create(
        userKey,
        {
          id,
          name: id,
          price: 0,
          currency: "USD",
          billingCycle: "monthly",
          nextBillingDate: date,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        VALID_KEY,
      );
      inputs.push({ entry: { userKey, subscriptionId: id }, date });
    }
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    global.fetch = mockFetch;
    const first = await processReminderQueueEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      service,
      inputs,
    );
    expect(first).toMatchObject({
      sent: 12,
      messages: 1,
      advanced: 12,
      retryableFailure: true,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      (await service.get(userKey, "sub-12", VALID_KEY))?.nextBillingDate,
    ).toBe(date);
    expect(await reminderRepo.hasSent(userKey, "sub-12", date, date)).toBe(
      false,
    );
    for (let i = 0; i < 12; i++)
      expect(
        await reminderRepo.hasSent(
          userKey,
          `sub-${String(i).padStart(2, "0")}`,
          date,
          date,
        ),
      ).toBe(true);
    const retryFetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = retryFetch;
    const retry = await processReminderQueueEntries(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      service,
      inputs,
    );
    expect(retry).toMatchObject({
      sent: 1,
      messages: 1,
      advanced: 1,
      retryableFailure: false,
    });
    expect(retryFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(retryFetch.mock.calls[0][1].body);
    expect(JSON.stringify(body.rich_message)).toContain("sub-12");
    expect(JSON.stringify(body.rich_message)).not.toContain("sub-00");
  });
});
