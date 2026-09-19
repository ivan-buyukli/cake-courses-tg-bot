import { describe, expect, it, vi } from "vitest";
import {
  buildEnvironmentDiagnosisChecks,
  buildEnvironmentDiagnosisReport,
  buildDiagnosisChecks,
  diagnosisCommand,
} from "../../../src/bot/commands/diagnosis.js";
import { EXCHANGE_RATES_CONFIG_KEY } from "../../../src/repositories/reportConfigRepository.js";
import { envSchema } from "../../../src/schemas/envSchema.js";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { BotContext } from "../../../src/types/context.js";
import type { Env } from "../../../src/types/env.js";
import { createMockQueue } from "../../queueTestUtils.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(store: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as KVNamespace;
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "hash-secret",
    ADMIN_USER_ID: "123456",
    SUBSCRIPTION_KV: createMockKV(),
    REMINDER_QUEUE: createMockQueue(),
    APP_ENV: "test",
    REMINDER_DAYS_AHEAD: "3",
    ...overrides,
  };
}

function createMockContext(overrides: Partial<BotContext> = {}): BotContext {
  return {
    isAdmin: true,
    env: createEnv(),
    requestId: "request-id",
    reply: vi.fn(),
    ...overrides,
  } as unknown as BotContext;
}

describe("diagnosisCommand", () => {
  it("rejects non-admin users", async () => {
    const ctx = createMockContext({ isAdmin: false });

    await diagnosisCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "This command is only available to admins.",
    );
  });

  it("reports valid environment without leaking secret values", async () => {
    const ctx = createMockContext({
      env: createEnv({
        SUBSCRIPTION_KV: createMockKV({
          [EXCHANGE_RATES_CONFIG_KEY]: JSON.stringify({
            base: "USD",
            rates: { USD: 1, CNY: 7.2, EUR: 0.92 },
          }),
        }),
      }),
    });

    await diagnosisCommand(ctx);

    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("Environment check: passed");
    expect(replyText).toContain("[OK] ENCRYPTION_KEY");
    expect(replyText).toContain("[OK] SUBSCRIPTION_KV");
    expect(replyText).toContain("[OK] REMINDER_QUEUE");
    expect(replyText).toContain("[OK] DEFAULT_REPORT_CURRENCY");
    expect(replyText).toContain("[OK] config:exchange-rates:v1");
    expect(replyText).not.toContain("bot-token");
    expect(replyText).not.toContain("webhook-secret");
    expect(replyText).not.toContain(VALID_KEY);
    expect(replyText).not.toContain("hash-secret");
    expect(replyText).not.toContain("123456");
  });
});

describe("buildDiagnosisChecks", () => {
  it("covers every environment variable declared in envSchema", () => {
    const checkNames = buildEnvironmentDiagnosisChecks(createEnv()).map(
      (check) => check.name,
    );

    expect(checkNames).toEqual(
      expect.arrayContaining(envSchema.keyof().options),
    );
  });

  it("marks invalid required configuration as errors", async () => {
    const checks = await buildDiagnosisChecks({
      BOT_TOKEN: "",
      TELEGRAM_WEBHOOK_SECRET: "",
      ENCRYPTION_KEY: "not-a-valid-master-key",
      USER_HASH_SECRET: "",
      ADMIN_USER_ID: "abc",
      SUBSCRIPTION_KV: {} as KVNamespace,
      REMINDER_QUEUE: {} as Queue,
      APP_ENV: "staging",
      REMINDER_DAYS_AHEAD: "3.5",
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "BOT_TOKEN", level: "error" }),
        expect.objectContaining({
          name: "TELEGRAM_WEBHOOK_SECRET",
          level: "error",
        }),
        expect.objectContaining({ name: "ENCRYPTION_KEY", level: "error" }),
        expect.objectContaining({ name: "USER_HASH_SECRET", level: "error" }),
        expect.objectContaining({ name: "ADMIN_USER_ID", level: "warn" }),
        expect.objectContaining({ name: "SUBSCRIPTION_KV", level: "error" }),
        expect.objectContaining({ name: "REMINDER_QUEUE", level: "error" }),
        expect.objectContaining({ name: "APP_ENV", level: "error" }),
        expect.objectContaining({
          name: "REMINDER_DAYS_AHEAD",
          level: "error",
        }),
        expect.objectContaining({
          name: "EXCHANGE_RATE_BASE_CURRENCY",
          level: "ok",
        }),
        expect.objectContaining({
          name: "DEFAULT_REPORT_CURRENCY",
          level: "ok",
        }),
      ]),
    );
  });

  it("accepts optional defaults when unset", () => {
    const report = buildEnvironmentDiagnosisReport(
      createEnv({
        ADMIN_USER_ID: undefined,
        APP_ENV: undefined,
        REMINDER_DAYS_AHEAD: undefined,
      }),
    );

    expect(report).toContain("Environment check: passed");
    expect(report).toContain("ADMIN_USER_ID: not set");
    expect(report).toContain("APP_ENV: not set; defaults to development");
    expect(report).toContain("REMINDER_DAYS_AHEAD: not set; defaults to 3");
  });

  it("warns when exchange-rate KV config is missing", async () => {
    const checks = await buildDiagnosisChecks(createEnv());

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: EXCHANGE_RATES_CONFIG_KEY,
          level: "warn",
          message: expect.stringContaining("missing"),
        }),
      ]),
    );
  });

  it("errors when exchange-rate KV config is invalid", async () => {
    const checks = await buildDiagnosisChecks(
      createEnv({
        SUBSCRIPTION_KV: createMockKV({
          [EXCHANGE_RATES_CONFIG_KEY]: JSON.stringify({
            base: "EUR",
            rates: { USD: 1, CNY: -1 },
          }),
        }),
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: EXCHANGE_RATES_CONFIG_KEY,
          level: "error",
        }),
      ]),
    );
  });

  it("warns when exchange-rate config misses the default report currency", async () => {
    const checks = await buildDiagnosisChecks(
      createEnv({
        SUBSCRIPTION_KV: createMockKV({
          [EXCHANGE_RATES_CONFIG_KEY]: JSON.stringify({
            base: "USD",
            rates: { USD: 1, EUR: 0.92 },
          }),
        }),
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: EXCHANGE_RATES_CONFIG_KEY,
          level: "warn",
          message: expect.stringContaining("CNY"),
        }),
      ]),
    );
  });

  it("accepts valid exchange-rate config with the default report currency", async () => {
    const checks = await buildDiagnosisChecks(
      createEnv({
        SUBSCRIPTION_KV: createMockKV({
          [EXCHANGE_RATES_CONFIG_KEY]: JSON.stringify({
            base: "USD",
            rates: { USD: 1, CNY: 7.2 },
          }),
        }),
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: EXCHANGE_RATES_CONFIG_KEY,
          level: "ok",
          message: expect.stringContaining("2 currencies"),
        }),
      ]),
    );
  });
});
