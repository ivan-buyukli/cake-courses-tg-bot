import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { InputFile } from "grammy";
import { reportCommand } from "../src/bot/commands/report.js";
import { renderReportOverviewPng } from "../src/utils/reportPng.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createUserRepository } from "../src/repositories/userRepository.js";
import { EXCHANGE_RATES_CONFIG_KEY } from "../src/repositories/reportConfigRepository.js";
import type { BotContext } from "../src/types/context.js";
import type { Subscription } from "../src/models/subscription.js";

vi.mock("../src/utils/reportPng.js", () => ({
  renderReportOverviewPng: vi.fn(),
}));

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
    chat: { id: 123, type: "private" },
    api: {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
    reply: vi.fn(),
    replyWithPhoto: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: crypto.randomUUID(),
    name: "Private Service",
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

describe("reportCommand", () => {
  const renderReportOverviewPngMock = vi.mocked(renderReportOverviewPng);

  beforeEach(() => {
    vi.clearAllMocks();
    renderReportOverviewPngMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("returns a friendly message when the user has no subscriptions", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv);

    await reportCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "你还没有添加任何订阅。",
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(renderReportOverviewPngMock).not.toHaveBeenCalled();
    expect(ctx.replyWithPhoto).not.toHaveBeenCalled();
  });

  it("sends a PNG photo when rendering succeeds", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSubscription(kv, createSub());
    const ctx = createMockContext(kv);

    await reportCommand(ctx);

    expect(renderReportOverviewPngMock).toHaveBeenCalledTimes(1);
    expect(ctx.replyWithPhoto).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendChatAction).toHaveBeenCalledWith(123, "upload_photo");
    expect(ctx.replyWithPhoto).toHaveBeenCalledWith(
      expect.any(InputFile),
      expect.objectContaining({
        caption: "订阅支出总览。发送 /report_text 查看完整明细。",
        reply_markup: expect.anything(),
      }),
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("uses the user's default currency for PNG report data", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSettings(kv, "EUR");
    await seedSubscription(kv, createSub({ price: 10, currency: "USD" }));
    const ctx = createMockContext(kv);

    await reportCommand(ctx);

    expect(renderReportOverviewPngMock).toHaveBeenCalledTimes(1);
    const overview = renderReportOverviewPngMock.mock.calls[0][0];
    expect(overview.baseCurrency).toBe("EUR");
    expect(overview.currentMonthly.totalBase).toBeCloseTo(8.75);
  });

  it("falls back to text when PNG rendering fails", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSubscription(kv, createSub({ name: "Very Private Name" }));
    renderReportOverviewPngMock.mockRejectedValue(
      new Error("render failed for Very Private Name"),
    );
    const ctx = createMockContext(kv);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await reportCommand(ctx);

    expect(ctx.replyWithPhoto).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text).toContain("订阅支出报告");
    expect(text).toContain("月均订阅成本");
    expect(text).toContain("未来30天支出");
    expect(text).toContain("年度预期支出");
    expect(text).not.toContain("Very Private Name");
    const warnPayload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(warnPayload.errorMessage).toBe("render failed for [redacted]");
    warnSpy.mockRestore();
  });

  it("falls back to text when Telegram photo sending fails", async () => {
    const kv = createMockKV();
    await seedRates(kv);
    await seedSubscription(kv, createSub());
    const ctx = createMockContext(kv, {
      replyWithPhoto: vi.fn().mockRejectedValue(new Error("send failed")),
    });

    await reportCommand(ctx);

    expect(renderReportOverviewPngMock).toHaveBeenCalledTimes(1);
    expect(ctx.replyWithPhoto).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "订阅支出报告",
    );
  });

  it("refuses when userKey is missing", async () => {
    const kv = createMockKV();
    const ctx = createMockContext(kv, { userKey: undefined });

    await reportCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("无法识别用户，请稍后再试。");
    expect(renderReportOverviewPngMock).not.toHaveBeenCalled();
  });
});
