import type { ReminderQueueMessage } from "./reminderQueue.js";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ENCRYPTION_KEY: string;
  USER_HASH_SECRET: string;
  ADMIN_USER_ID?: string;
  SUBSCRIPTION_KV: KVNamespace;
  REMINDER_QUEUE?: Queue<ReminderQueueMessage>;
  APP_ENV?: string;
  REMINDER_DAYS_AHEAD?: string;
  XCURRENCY_API_KEY?: string;
}

export type ValidatedEnv = Env & {
  REMINDER_QUEUE: Queue<ReminderQueueMessage>;
};
