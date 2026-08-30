import { describe, it, expect, vi, afterEach } from "vitest";
import { handleScheduled } from "../src/handlers/scheduled.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { Env } from "../src/types/env.js";
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

function createMockEnv(kv: KVNamespace): Env {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: kv,
    REMINDER_DAYS_AHEAD: "3",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handleScheduled", () => {
  it("sends a reminder on the billing date without advancing trial subscriptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const env = createMockEnv(kv);
    const subRepo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);

    await userRepo.upsertUserProfile("user-1", 123456, VALID_KEY);
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-05-18",
        isTrial: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    await handleScheduled({} as ScheduledController, env);

    const sub = await service.get("user-1", "sub-1", VALID_KEY);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sub?.nextBillingDate).toBe("2026-05-18");
  });

  it("advances due subscriptions even when the reminder send fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const env = createMockEnv(kv);
    const subRepo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);

    await userRepo.upsertUserProfile("user-1", 123456, VALID_KEY);
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-05-18",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false }), { status: 400 }),
      );

    await handleScheduled({} as ScheduledController, env);

    const sub = await service.get("user-1", "sub-1", VALID_KEY);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sub?.nextBillingDate).toBe("2026-06-18");
    expect(await reminderRepo.listEntries("2026-05-18")).toEqual([]);
    expect(await reminderRepo.listEntries("2026-06-18")).toEqual([
      { userKey: "user-1", subscriptionId: "sub-1" },
    ]);
  });

  it("combines multiple reminders for the same user into one Telegram message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const env = createMockEnv(kv);
    const subRepo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);

    await userRepo.upsertUserProfile("user-1", 123456, VALID_KEY);
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Netflix",
        billingCycle: "monthly",
        nextBillingDate: "2026-05-18",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      VALID_KEY,
    );
    await service.create(
      "user-1",
      {
        id: "sub-2",
        name: "Spotify",
        billingCycle: "monthly",
        nextBillingDate: "2026-05-18",
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

    await handleScheduled({} as ScheduledController, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.text).toContain("以下 2 个项目");
    expect(body.text).toContain("Netflix");
    expect(body.text).toContain("Spotify");
  });

  it("scans one day ahead for project overrides when the default window is zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const env = createMockEnv(kv);
    env.REMINDER_DAYS_AHEAD = "0";
    const subRepo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const userRepo = createUserRepository(kv);
    const service = createSubscriptionService(subRepo, reminderRepo);

    await userRepo.upsertUserProfile("user-1", 123456, VALID_KEY);
    await service.create(
      "user-1",
      {
        id: "sub-1",
        name: "Daily service",
        billingCycle: "weekly",
        nextBillingDate: "2026-05-19",
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

    await handleScheduled({} as ScheduledController, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
