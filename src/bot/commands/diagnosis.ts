import { parseMasterKey } from "../../crypto/masterKey.js";
import { EXCHANGE_RATES_CONFIG_KEY } from "../../repositories/reportConfigRepository.js";
import {
  DEFAULT_REPORT_CURRENCY,
  EXCHANGE_RATE_BASE_CURRENCY,
  parseExchangeRateConfig,
} from "../../services/reportService.js";
import { BotContext } from "../../types/context.js";
import { Env } from "../../types/env.js";
import { validateCurrencyCode } from "../../utils/currency.js";
import { createLogger } from "../../utils/logger.js";

type DiagnosisLevel = "ok" | "warn" | "error";

interface DiagnosisCheck {
  name: string;
  level: DiagnosisLevel;
  message: string;
}

const VALID_APP_ENVS = new Set(["development", "production", "test"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasKvMethods(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.get === "function" &&
    typeof candidate.put === "function" &&
    typeof candidate.delete === "function" &&
    typeof candidate.list === "function"
  );
}

function checkRequiredSecret(
  name: keyof Env,
  env: Partial<Env>,
): DiagnosisCheck {
  const value = env[name];
  if (!isNonEmptyString(value)) {
    return {
      name,
      level: "error",
      message: "missing or empty",
    };
  }

  return {
    name,
    level: "ok",
    message: "set",
  };
}

function checkEncryptionKey(env: Partial<Env>): DiagnosisCheck {
  const value = env.ENCRYPTION_KEY;
  if (!isNonEmptyString(value)) {
    return {
      name: "ENCRYPTION_KEY",
      level: "error",
      message: "missing or empty",
    };
  }

  try {
    parseMasterKey(value);
    return {
      name: "ENCRYPTION_KEY",
      level: "ok",
      message: "valid base64url 32-byte key",
    };
  } catch (error) {
    return {
      name: "ENCRYPTION_KEY",
      level: "error",
      message: error instanceof Error ? error.message : "invalid key",
    };
  }
}

function checkAdminUserId(env: Partial<Env>): DiagnosisCheck {
  const value = env.ADMIN_USER_ID;
  if (value === undefined || value === "") {
    return {
      name: "ADMIN_USER_ID",
      level: "warn",
      message: "not set; admin-only commands are unavailable",
    };
  }

  if (!/^\d+$/.test(value)) {
    return {
      name: "ADMIN_USER_ID",
      level: "warn",
      message: "set, but expected a numeric Telegram user ID",
    };
  }

  return {
    name: "ADMIN_USER_ID",
    level: "ok",
    message: "set",
  };
}

function checkKvBinding(env: Partial<Env>): DiagnosisCheck {
  if (!env.SUBSCRIPTION_KV) {
    return {
      name: "SUBSCRIPTION_KV",
      level: "error",
      message: "binding missing",
    };
  }

  if (!hasKvMethods(env.SUBSCRIPTION_KV)) {
    return {
      name: "SUBSCRIPTION_KV",
      level: "error",
      message: "binding does not expose expected KV methods",
    };
  }

  return {
    name: "SUBSCRIPTION_KV",
    level: "ok",
    message: "binding available",
  };
}

function checkQueueBinding(env: Partial<Env>): DiagnosisCheck {
  const queue = env.REMINDER_QUEUE;
  if (!queue) {
    return {
      name: "REMINDER_QUEUE",
      level: "error",
      message: "binding missing",
    };
  }

  if (
    typeof queue.send !== "function" ||
    typeof queue.sendBatch !== "function"
  ) {
    return {
      name: "REMINDER_QUEUE",
      level: "error",
      message: "binding does not expose expected Queue methods",
    };
  }

  return {
    name: "REMINDER_QUEUE",
    level: "ok",
    message: "binding available",
  };
}

function checkAppEnv(env: Partial<Env>): DiagnosisCheck {
  const value = env.APP_ENV;
  if (value === undefined || value === "") {
    return {
      name: "APP_ENV",
      level: "ok",
      message: "not set; defaults to development",
    };
  }

  if (!VALID_APP_ENVS.has(value)) {
    return {
      name: "APP_ENV",
      level: "error",
      message: "must be development, production, or test",
    };
  }

  return {
    name: "APP_ENV",
    level: "ok",
    message: value,
  };
}

function checkReminderDaysAhead(env: Partial<Env>): DiagnosisCheck {
  const value = env.REMINDER_DAYS_AHEAD;
  if (value === undefined || value === "") {
    return {
      name: "REMINDER_DAYS_AHEAD",
      level: "ok",
      message: "not set; defaults to 3",
    };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return {
      name: "REMINDER_DAYS_AHEAD",
      level: "error",
      message: "must be a non-negative integer",
    };
  }

  return {
    name: "REMINDER_DAYS_AHEAD",
    level: "ok",
    message: value,
  };
}

function checkXCurrencyApiKey(env: Partial<Env>): DiagnosisCheck {
  const value = env.XCURRENCY_API_KEY;
  if (value === undefined || value === "") {
    return {
      name: "XCURRENCY_API_KEY",
      level: "warn",
      message: "not set; /admin_sync_exchange_rates is unavailable",
    };
  }

  return {
    name: "XCURRENCY_API_KEY",
    level: "ok",
    message: "set",
  };
}

function checkStaticReportCurrencyConfig(): DiagnosisCheck[] {
  const baseCurrency = validateCurrencyCode(EXCHANGE_RATE_BASE_CURRENCY);
  const defaultCurrency = validateCurrencyCode(DEFAULT_REPORT_CURRENCY);

  return [
    {
      name: "EXCHANGE_RATE_BASE_CURRENCY",
      level: baseCurrency.error ? "error" : "ok",
      message: baseCurrency.error
        ? "must be a valid 3-letter currency code"
        : `${baseCurrency.currency} base currency`,
    },
    {
      name: "DEFAULT_REPORT_CURRENCY",
      level: defaultCurrency.error ? "error" : "ok",
      message: defaultCurrency.error
        ? "must be a valid 3-letter currency code"
        : `${defaultCurrency.currency} default report currency`,
    },
  ];
}

async function checkExchangeRateConfig(
  env: Partial<Env>,
): Promise<DiagnosisCheck> {
  if (!env.SUBSCRIPTION_KV || !hasKvMethods(env.SUBSCRIPTION_KV)) {
    return {
      name: EXCHANGE_RATES_CONFIG_KEY,
      level: "warn",
      message: "skipped because SUBSCRIPTION_KV is unavailable",
    };
  }

  let raw: string | null;
  try {
    raw = await env.SUBSCRIPTION_KV.get(EXCHANGE_RATES_CONFIG_KEY);
  } catch {
    return {
      name: EXCHANGE_RATES_CONFIG_KEY,
      level: "error",
      message: "failed to read exchange-rate config from KV",
    };
  }

  if (!raw) {
    return {
      name: EXCHANGE_RATES_CONFIG_KEY,
      level: "warn",
      message:
        "missing; reports still work, but cross-currency totals cannot be converted",
    };
  }

  const parsed = parseExchangeRateConfig(raw);
  if (!parsed) {
    return {
      name: EXCHANGE_RATES_CONFIG_KEY,
      level: "error",
      message:
        "invalid JSON; expected base USD and positive numeric 3-letter currency rates",
    };
  }

  const currencies = Object.keys(parsed.rates);
  if (!currencies.includes(DEFAULT_REPORT_CURRENCY)) {
    return {
      name: EXCHANGE_RATES_CONFIG_KEY,
      level: "warn",
      message: `valid, but missing ${DEFAULT_REPORT_CURRENCY} rate for default report totals`,
    };
  }

  return {
    name: EXCHANGE_RATES_CONFIG_KEY,
    level: "ok",
    message: `valid base ${parsed.base}; ${currencies.length} currencies configured`,
  };
}

export function buildEnvironmentDiagnosisChecks(
  env: Partial<Env>,
): DiagnosisCheck[] {
  return [
    checkRequiredSecret("BOT_TOKEN", env),
    checkRequiredSecret("TELEGRAM_WEBHOOK_SECRET", env),
    checkEncryptionKey(env),
    checkRequiredSecret("USER_HASH_SECRET", env),
    checkAdminUserId(env),
    checkKvBinding(env),
    checkQueueBinding(env),
    checkAppEnv(env),
    checkReminderDaysAhead(env),
    checkXCurrencyApiKey(env),
    ...checkStaticReportCurrencyConfig(),
  ];
}

export async function buildDiagnosisChecks(
  env: Partial<Env>,
): Promise<DiagnosisCheck[]> {
  return [
    ...buildEnvironmentDiagnosisChecks(env),
    await checkExchangeRateConfig(env),
  ];
}

function formatStatus(level: DiagnosisLevel): string {
  switch (level) {
    case "ok":
      return "OK";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
  }
}

export function buildEnvironmentDiagnosisReport(env: Partial<Env>): string {
  return formatDiagnosisReport(buildEnvironmentDiagnosisChecks(env));
}

export async function buildDiagnosisReport(env: Partial<Env>): Promise<string> {
  return formatDiagnosisReport(await buildDiagnosisChecks(env));
}

function formatDiagnosisReport(checks: DiagnosisCheck[]): string {
  const errorCount = checks.filter((check) => check.level === "error").length;
  const warnCount = checks.filter((check) => check.level === "warn").length;

  const header =
    errorCount === 0
      ? "Environment check: passed"
      : `Environment check: found ${errorCount} errors`;

  return [
    header,
    warnCount > 0 ? `Warnings: ${warnCount}` : "Warnings: 0",
    "",
    ...checks.map(
      (check) =>
        `- [${formatStatus(check.level)}] ${check.name}: ${check.message}`,
    ),
  ].join("\n");
}

export async function diagnosisCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.isAdmin) {
    await ctx.reply("This command is only available to admins.");
    logger.warn("Non-admin attempted diagnosis command");
    return;
  }

  const checks = await buildDiagnosisChecks(ctx.env);
  await ctx.reply(formatDiagnosisReport(checks));
  logger.info("Environment diagnosis reported", {
    hasErrors: checks.some((check) => check.level === "error"),
  });
}
