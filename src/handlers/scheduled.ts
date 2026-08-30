import { Env } from "../types/env.js";
import { createReminderRepository } from "../repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../repositories/subscriptionRepository.js";
import { createUserRepository } from "../repositories/userRepository.js";
import {
  processReminderEntries,
  getReminderDaysAhead,
  getReminderDateRange,
  ReminderEntryInput,
} from "../services/reminderService.js";
import { createSubscriptionService } from "../services/subscriptionService.js";
import { log } from "../utils/logger.js";
import { PROJECT_REMINDER_MAX_DAYS_BEFORE } from "../utils/reminderPolicy.js";

export async function handleScheduled(
  _controller: ScheduledController,
  env: Env,
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
  const subRepo = createSubscriptionRepository(env.SUBSCRIPTION_KV);
  const userRepo = createUserRepository(env.SUBSCRIPTION_KV);
  const subscriptionService = createSubscriptionService(subRepo, reminderRepo);

  const reminderInputs: ReminderEntryInput[] = [];

  for (const date of dates) {
    const entries = await reminderRepo.listEntries(date);
    for (const entry of entries) {
      reminderInputs.push({ entry, date });
    }
  }

  const {
    sent: sentCount,
    messages: messageCount,
    advanced: advancedCount,
  } = await processReminderEntries(
    env,
    reminderRepo,
    subRepo,
    userRepo,
    subscriptionService,
    reminderInputs,
    daysAhead,
  );

  log("info", "Scheduled reminder processing complete", {
    env: env.APP_ENV,
    daysAhead,
    scanDaysAhead,
    dateCount: dates.length,
    sentCount,
    messageCount,
    advancedCount,
  });
}
