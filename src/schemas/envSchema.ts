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

export function validateEnv(raw: Bindings): CourseEnv {
  const parsed = schema.safeParse({
    ...raw,
    ADMIN_USER_IDS: raw.ADMIN_USER_IDS ?? raw.ADMIN_USER_ID ?? "",
  });
  if (
    !parsed.success ||
    !raw.COURSE_DB?.prepare ||
    (parsed.data.APP_ENV === "production" &&
      parsed.data.ADMIN_USER_IDS.length === 0)
  ) {
    // Zod errors may contain configuration values. Never forward them to logs.
    throw new Error("Course bot configuration is incomplete or invalid");
  }
  return {
    ...parsed.data,
    COURSE_DB: raw.COURSE_DB,
    COURSE_QUEUE: raw.COURSE_QUEUE,
  };
}
