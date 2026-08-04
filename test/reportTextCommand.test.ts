import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { reportTextCommand } from "../src/bot/commands/reportText.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import { EXCHANGE_RATES_CONFIG_KEY } from "../src/repositories/reportConfigRepository.js";
import type { BotContext } from "../src/types/context.js";
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
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function createMockContext(
  kv: KVNamespace,
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
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: crypto.randomUUID(),
    name: "Test Service",
    price: 10,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-15",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedSubscription(
  kv: KVNamespace,
  sub: Subscription,
): Promise<void> {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  const service = createSubscriptionService(repo, reminderRepo);
  await service.create("user-key", sub, VALID_KEY);
}

async function seedRates(kv: KVNamespace): Promise<void> {
  await kv.put(
    EXCHANGE_RATES_CONFIG_KEY,
    JSON.stringify({ base: "USD", rates: { USD: 1, CNY: 7.2, EUR: 0.875 } }),
  );
}

async function seedSettings(
  kv: KVNamespace,
  defaultCurrency: string,
): Promise<void> {
  const repo = createUserRepository(kv);
  await repo.updateUserSettings(
    "user-key",
    {
      defaultCurrency,
      reminderEnabled: true,
      reminderHour: 9,
      timezone: "UTC",
    },
    VALID_KEY,
  );
}

describe("reportTextCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a friendly message when the user has no subscriptions", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv);

    await reportTextCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "你还没有添加任何订阅。",
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("sends text report with subscription names", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSubscription(kv, createSub({ name: "Netflix" }));
    const ctx = createMockContext(kv);

    await reportTextCommand(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls
      .map((call: [string]) => call[0])
      .join("\n");
    expect(text).toContain("未来30天支出");
    expect(text).toContain("Netflix");
  });

  it("uses the user's default currency for text report totals", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSettings(kv, "EUR");
    await seedSubscription(
      kv,
      createSub({ name: "USD Service", price: 10, currency: "USD" }),
    );
    const ctx = createMockContext(kv);

    await reportTextCommand(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls
      .map((call: [string]) => call[0])
      .join("\n");
    expect(text).toContain("USD Service  $10.00 → €8.75");
    expect(text).toContain("合计 €8.75");
  });

  it("refuses when userKey is missing", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv, { userKey: undefined });

    await reportTextCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("无法识别用户，请稍后再试。");
  });
});
