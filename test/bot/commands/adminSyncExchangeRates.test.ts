import { describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { adminSyncExchangeRatesCommand } from "../../../src/bot/commands/adminSyncExchangeRates.js";
import { XCURRENCY_EXCHANGE_RATES_CONFIG_KEY } from "../../../src/repositories/reportConfigRepository.js";
import type { BotContext } from "../../../src/types/context.js";
import type { Env } from "../../../src/types/env.js";

vi.mock("../../../src/services/xcurrencyService.js", () => ({
  fetchXCurrencyExchangeRates: vi.fn(),
}));

import { fetchXCurrencyExchangeRates } from "../../../src/services/xcurrencyService.js";

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
    delete: vi.fn(),
    list: vi.fn(),
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
    XCURRENCY_API_KEY: "xcurrency-secret",
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

describe("adminSyncExchangeRatesCommand", () => {
  it("rejects non-admin users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, { isAdmin: false });

    await adminSyncExchangeRatesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "This command is only available to admins.",
    );
    expect(fetchXCurrencyExchangeRates).not.toHaveBeenCalled();
  });

  it("skips sync when the API key is not configured", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, {
      env: createEnv(kv, { XCURRENCY_API_KEY: undefined }),
    });

    await adminSyncExchangeRatesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "XCURRENCY_API_KEY is not configured. Exchange-rate sync was skipped.",
    );
    expect(fetchXCurrencyExchangeRates).not.toHaveBeenCalled();
  });

  it("fetches and stores XCurrency rates", async () => {
    const kv = createMockKV();
    vi.mocked(fetchXCurrencyExchangeRates).mockResolvedValueOnce({
      exchangeRates: {
        base: "USD",
        rates: { USD: 1, CNY: 7.1 },
      },
      timestamp: 1591784799,
      currencyCount: 2,
    });
    const ctx = createContext(kv);

    await adminSyncExchangeRatesCommand(ctx);

    expect(fetchXCurrencyExchangeRates).toHaveBeenCalledWith(
      "xcurrency-secret",
    );
    expect(kv.put).toHaveBeenCalledWith(
      XCURRENCY_EXCHANGE_RATES_CONFIG_KEY,
      JSON.stringify({ base: "USD", rates: { USD: 1, CNY: 7.1 } }),
    );
    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text).toContain("XCurrency exchange rates synced");
    expect(text).toContain("Currency count: 2");
    expect(text).not.toContain("xcurrency-secret");
  });

  it("reports fetch failures without leaking the API key", async () => {
    const kv = createMockKV();
    vi.mocked(fetchXCurrencyExchangeRates).mockRejectedValueOnce(
      new Error("network failed"),
    );
    const ctx = createContext(kv);

    await adminSyncExchangeRatesCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "XCurrency exchange rate sync failed. Please try again later.",
    );
    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).not.toContain("xcurrency-secret");
  });
});
