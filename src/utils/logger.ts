const TELEGRAM_BOT_TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;
const TELEGRAM_BOT_URL_RE =
  /(api\.telegram\.org\/bot)\d{6,}:[A-Za-z0-9_-]{20,}/g;
const USER_KEY_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const LONG_NUMERIC_ID_RE = /(?<![\w.-])-?\d{7,}(?![\w.-])/g;

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(TELEGRAM_BOT_URL_RE, "$1[REDACTED]")
    .replace(TELEGRAM_BOT_TOKEN_RE, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(USER_KEY_RE, "[REDACTED_USER_KEY]")
    .replace(LONG_NUMERIC_ID_RE, "[REDACTED_ID]");
}

function sanitizeLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeErrorMessage(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }

  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeLogValue(item)]),
    );
  }

  return value;
}

function sanitizeLogMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  return meta ? (sanitizeLogValue(meta) as Record<string, unknown>) : {};
}

export function log(
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level,
    message: sanitizeErrorMessage(message),
    ...sanitizeLogMeta(meta),
  };

  // In production, avoid console.log and use structured logging if available
  if (level === "error") {
    console.error(JSON.stringify(payload));
  } else if (level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export function createLogger(requestId: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      log("info", message, { requestId, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      log("warn", message, { requestId, ...meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      log("error", message, { requestId, ...meta }),
  };
}
