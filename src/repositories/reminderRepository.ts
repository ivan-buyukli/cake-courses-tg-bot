import { KVNamespace } from "@cloudflare/workers-types";
import {
  parseReminderDateEntryKey,
  reminderDateEntry,
  reminderDatePrefix,
  reminderSent,
} from "../utils/kvKeys.js";

const SENT_MARKER_TTL_SECONDS = 60 * 60 * 24 * 45;

export interface ReminderEntry {
  userKey: string;
  subscriptionId: string;
}

export interface ReminderRepository {
  addEntry(
    date: string,
    userKey: string,
    subscriptionId: string,
  ): Promise<void>;
  removeEntry(
    date: string,
    userKey: string,
    subscriptionId: string,
  ): Promise<void>;
  listEntries(date: string): Promise<ReminderEntry[]>;
  listDatesThrough(maxDate: string): Promise<string[]>;
  hasSent(
    userKey: string,
    subscriptionId: string,
    billingDate: string,
    localReminderDate: string,
  ): Promise<boolean>;
  markSent(
    userKey: string,
    subscriptionId: string,
    billingDate: string,
    localReminderDate: string,
  ): Promise<void>;
}

export function createReminderRepository(kv: KVNamespace): ReminderRepository {
  return {
    async addEntry(
      date: string,
      userKey: string,
      subscriptionId: string,
    ): Promise<void> {
      await kv.put(reminderDateEntry(date, userKey, subscriptionId), "1");
    },

    async removeEntry(
      date: string,
      userKey: string,
      subscriptionId: string,
    ): Promise<void> {
      await kv.delete(reminderDateEntry(date, userKey, subscriptionId));
    },

    async listEntries(date: string): Promise<ReminderEntry[]> {
      const prefix = reminderDatePrefix(date);
      const entries: ReminderEntry[] = [];
      let cursor: string | undefined;

      do {
        const list = await kv.list({ prefix, cursor });
        for (const key of list.keys) {
          const parsed = parseReminderDateEntryKey(key.name);
          if (!parsed || parsed.date !== date) continue;
          entries.push({
            userKey: parsed.userKey,
            subscriptionId: parsed.subscriptionId,
          });
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      return entries;
    },

    async listDatesThrough(maxDate: string): Promise<string[]> {
      const prefix = "reminders:date:";
      const dates: string[] = [];
      let cursor: string | undefined;

      do {
        const list = await kv.list({ prefix, cursor });
        for (const key of list.keys) {
          const parsed = parseReminderDateEntryKey(key.name);
          if (parsed && parsed.date <= maxDate) {
            dates.push(parsed.date);
          }
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      return Array.from(new Set(dates)).sort();
    },

    async hasSent(
      userKey: string,
      subscriptionId: string,
      billingDate: string,
      localReminderDate: string,
    ): Promise<boolean> {
      const key = reminderSent(
        userKey,
        subscriptionId,
        billingDate,
        localReminderDate,
      );
      const data = await kv.get(key);
      return data !== null;
    },

    async markSent(
      userKey: string,
      subscriptionId: string,
      billingDate: string,
      localReminderDate: string,
    ): Promise<void> {
      const key = reminderSent(
        userKey,
        subscriptionId,
        billingDate,
        localReminderDate,
      );
      await kv.put(key, "1", { expirationTtl: SENT_MARKER_TTL_SECONDS });
    },
  };
}

/**
 * Reminder entries are stored as independent keys under a date prefix so
 * concurrent writes for the same date do not overwrite each other.
 */
