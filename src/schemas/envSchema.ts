import { custom, enum as zodEnum, object, string } from "zod";
import { parseMasterKey } from "../crypto/masterKey.js";
import type { Env } from "../types/env.js";

export const envSchema = object({
  BOT_TOKEN: string().min(1),
  TELEGRAM_WEBHOOK_SECRET: string().min(1),
  ENCRYPTION_KEY: string()
    .min(1)
    .refine(
      (val) => {
        try {
          parseMasterKey(val);
          return true;
        } catch {
          return false;
        }
      },
      {
        error:
          "ENCRYPTION_KEY must be a base64url-encoded 32-byte value. Generate with: node -e \"console.log(Buffer.from(crypto.randomBytes(32)).toString('base64url'))\"",
      },
    ),
  USER_HASH_SECRET: string().min(1),
  ADMIN_USER_ID: string().optional(),
  SUBSCRIPTION_KV: custom<KVNamespace>((val) => val !== undefined),
  APP_ENV: zodEnum(["development", "production", "test"]).optional(),
  REMINDER_DAYS_AHEAD: string()
    .optional()
    .refine(
      (val) => {
        if (val === undefined || val === "") return true;
        const parsed = Number(val);
        return Number.isFinite(parsed) && parsed >= 0;
      },
      {
        error: "REMINDER_DAYS_AHEAD must be a non-negative integer",
      },
    ),
  XCURRENCY_API_KEY: string().optional(),
});

export function validateEnv(env: unknown): Env {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const fields = Array.from(
      new Set(
        result.error.issues.map((issue) => issue.path.join(".") || "env"),
      ),
    ).sort();
    throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
  }

  return result.data as Env;
}
