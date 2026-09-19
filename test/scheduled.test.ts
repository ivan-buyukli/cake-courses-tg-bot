import { describe, it, expect, vi, afterEach } from "vitest";
import { handleScheduled } from "../src/handlers/scheduled.js";
import { handleReminderQueue } from "../src/queues/reminderQueue.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import type { ValidatedEnv } from "../src/types/env.js";
import type { ReminderQueueMessage } from "../src/types/reminderQueue.js";
import type { KVNamespace } from "@cloudflare/workers-types";
import { createMockQueue } from "./queueTestUtils.js";

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

function createMockEnv(
  kv: KVNamespace,
  queued: ReminderQueueMessage[],
): ValidatedEnv {
  return {
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "test-hash-secret",
    SUBSCRIPTION_KV: kv,
    REMINDER_QUEUE: createMockQueue(queued),
    REMINDER_DAYS_AHEAD: "3",
  };
}

async function consumeQueuedReminders(
  queued: ReminderQueueMessage[],
  env: ValidatedEnv,
): Promise<{ ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> }> {
  const ack = vi.fn();
  const retry = vi.fn();
  const messages = queued.map((body, index) => ({
    id: `message-${index}`,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack,
    retry,
  }));

  await handleReminderQueue(
    {
      queue: "subscription-reminders",
      messages,
      metadata: {
        metrics: { backlogCount: 0, backlogBytes: 0 },
      },
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    },
    env,
  );

  return { ack, retry };
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
    const queued: ReminderQueueMessage[] = [];
    const env = createMockEnv(kv, queued);
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
    expect(global.fetch).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    await consumeQueuedReminders(queued, env);

    const sub = await service.get("user-1", "sub-1", VALID_KEY);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sub?.nextBillingDate).toBe("2026-05-18");
  });

  it("advances due subscriptions even when the reminder send fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const queued: ReminderQueueMessage[] = [];
    const env = createMockEnv(kv, queued);
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
    const { ack, retry } = await consumeQueuedReminders(queued, env);

    const sub = await service.get("user-1", "sub-1", VALID_KEY);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(sub?.nextBillingDate).toBe("2026-06-18");
    expect(await reminderRepo.listEntries("2026-05-18")).toEqual([]);
    expect(await reminderRepo.listEntries("2026-06-18")).toEqual([
      { userKey: "user-1", subscriptionId: "sub-1" },
    ]);
  });

  it("retries transient Telegram failures without advancing the billing date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const queued: ReminderQueueMessage[] = [];
    const env = createMockEnv(kv, queued);
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
      .mockResolvedValue(new Response("upstream", { status: 500 }));

    await handleScheduled({} as ScheduledController, env);
    const { ack, retry } = await consumeQueuedReminders(queued, env);

    const sub = await service.get("user-1", "sub-1", VALID_KEY);
    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(sub?.nextBillingDate).toBe("2026-05-18");
    expect(await reminderRepo.listEntries("2026-05-18")).toEqual([
      { userKey: "user-1", subscriptionId: "sub-1" },
    ]);
  });

  it("acknowledges malformed queue messages without processing them", async () => {
    const kv = createMockKV();
    const env = createMockEnv(kv, []);
    const ack = vi.fn();
    const retry = vi.fn();

    await handleReminderQueue(
      {
        queue: "subscription-reminders",
        messages: [
          {
            id: "invalid-message",
            timestamp: new Date(),
            body: { version: 99, entries: [] },
            attempts: 1,
            ack,
            retry,
          },
        ],
        metadata: {
          metrics: { backlogCount: 0, backlogBytes: 0 },
        },
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      env,
    );

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("combines multiple reminders for the same user into one Telegram message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const queued: ReminderQueueMessage[] = [];
    const env = createMockEnv(kv, queued);
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
    expect(queued).toHaveLength(1);
    expect(queued[0].entries).toHaveLength(2);
    await consumeQueuedReminders(queued, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(JSON.stringify(body.rich_message)).toContain(
      "Subscription reminders · 2 items",
    );
    expect(JSON.stringify(body.rich_message)).toContain("Netflix");
    expect(JSON.stringify(body.rich_message)).toContain("Spotify");
  });

  it("scans one day ahead for project overrides when the default window is zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T09:00:00Z"));

    const kv = createMockKV();
    const queued: ReminderQueueMessage[] = [];
    const env = createMockEnv(kv, queued);
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
    await consumeQueuedReminders(queued, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
