import type { ReminderEntryInput } from "../services/reminderService.js";

export const REMINDER_QUEUE_MESSAGE_VERSION = 1 as const;

export interface ReminderQueueMessage {
  version: typeof REMINDER_QUEUE_MESSAGE_VERSION;
  entries: ReminderEntryInput[];
}
