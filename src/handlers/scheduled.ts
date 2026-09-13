import { createReminderRepository } from "../repositories/reminderRepository.js";
import {
  getReminderDaysAhead,
  getReminderDateRange,
  ReminderEntryInput,
} from "../services/reminderService.js";
import { enqueueReminderEntries } from "../queues/reminderQueue.js";
import type { ValidatedEnv } from "../types/env.js";
import { log } from "../utils/logger.js";
import { PROJECT_REMINDER_MAX_DAYS_BEFORE } from "../utils/reminderPolicy.js";

export async function handleScheduled(
  _controller: ScheduledController,
  env: ValidatedEnv,
): Promise<void> {
  const daysAhead = getReminderDaysAhead(env);
  const scanDaysAhead = Math.max(daysAhead, PROJECT_REMINDER_MAX_DAYS_BEFORE);
  const dates = getReminderDateRange(scanDaysAhead);

  log("info", "Scheduled trigger fired", {
    env: env.APP_ENV,
    daysAhead,
    scanDaysAhead,
    dateCount: dates.length,
  });

  const reminderRepo = createReminderRepository(env.SUBSCRIPTION_KV);

  const reminderInputs: ReminderEntryInput[] = [];

  for (const date of dates) {
    const entries = await reminderRepo.listEntries(date);
    for (const entry of entries) {
      reminderInputs.push({ entry, date });
    }
  }

  const queuedMessageCount = await enqueueReminderEntries(
    env.REMINDER_QUEUE,
    reminderInputs,
  );

  log("info", "Scheduled reminder enqueue complete", {
    env: env.APP_ENV,
    daysAhead,
    scanDaysAhead,
    dateCount: dates.length,
    reminderEntryCount: reminderInputs.length,
    queuedMessageCount,
  });
}
