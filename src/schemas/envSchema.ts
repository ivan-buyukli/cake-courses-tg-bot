import { z } from "zod";
import { parseMasterKey } from "../crypto/masterKey.js";
import { DEFAULT_TIMEZONE } from "../utils/dateTime.js";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const schema = z.object({
  BOT_TOKEN: z.string().regex(/^\d+:[\w-]{20,}$/),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[\w-]+$/),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[\w-]{43}$/)
    .refine((key) => {
      try {
        parseMasterKey(key);
        return true;
      } catch {
        return false;
      }
    }),
  USER_HASH_SECRET: z.string().min(32),
  ADMIN_USER_IDS: z
    .string()
    .regex(/^(?:\d+(?:\s*,\s*\d+)*)?$/)
    .transform((value) => (value ? value.split(",").map(Number) : []))
    .refine(
      (ids) =>
        ids.every((id) => Number.isSafeInteger(id) && id > 0) &&
        new Set(ids).size === ids.length,
    ),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  CAMPAIGN_TIMEZONE: optionalString
    .transform((value) => value ?? DEFAULT_TIMEZONE)
    .refine((value) => {
      if (!value) return true;
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  COURSE_WEBSITE_URL: optionalString.refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }),
});

export type Bindings = Record<string, unknown> & {
  COURSE_DB: D1Database;
  COURSE_QUEUE?: Queue;
};
export type CourseEnv = z.infer<typeof schema> & {
  COURSE_DB: D1Database;
  COURSE_QUEUE?: Queue;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function configurationError(issues: string[]): Error {
  return new Error("Course bot configuration is incomplete or invalid", {
    cause: { configIssues: unique(issues) },
  });
}

export function validateEnv(raw: Bindings): CourseEnv {
  const input = {
    ...raw,
    ADMIN_USER_IDS: raw.ADMIN_USER_IDS ?? raw.ADMIN_USER_ID ?? "",
  };
  const parsed = schema.safeParse(input);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) =>
        issue.path.length ? String(issue.path[0]) : "configuration",
      );
  if (typeof raw.COURSE_DB?.prepare !== "function") issues.push("COURSE_DB");
  if (!parsed.success) {
    // Zod errors may contain configuration values. Never forward them to logs.
    throw configurationError(issues);
  }
  if (
    parsed.data.APP_ENV === "production" &&
    parsed.data.ADMIN_USER_IDS.length === 0
  )
    issues.push("ADMIN_USER_IDS");
  if (
    parsed.data.APP_ENV === "production" &&
    typeof raw.COURSE_QUEUE?.sendBatch !== "function"
  )
    issues.push("COURSE_QUEUE");
  if (issues.length) {
    throw configurationError(issues);
  }
  return {
    ...parsed.data,
    COURSE_DB: raw.COURSE_DB,
    COURSE_QUEUE: raw.COURSE_QUEUE,
  };
}
