import {
  ReminderRepository,
  ReminderEntry,
} from "../repositories/reminderRepository.js";
import { SubscriptionRepository } from "../repositories/subscriptionRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { Subscription } from "../models/subscription.js";
import { DecryptedUserProfile } from "../models/user.js";
import { UserSettings } from "../models/userSettings.js";
import { DEFAULT_USER_SETTINGS } from "../models/userSettings.js";
import { SubscriptionService } from "./subscriptionService.js";
import { Env } from "../types/env.js";
import { sendRichMessage } from "./telegramService.js";
import {
  reminderPresentation,
  REMINDER_MESSAGE_SIZE,
} from "../bot/ui/reminderPresentation.js";
import { decrypt, parseEncryptedPayload } from "../crypto/encryption.js";
import { deriveUserKey } from "../crypto/keyDerivation.js";
import { log } from "../utils/logger.js";
import { addDays, formatDate, getLocalTimeInfo } from "../utils/date.js";
import {
  isAutoRenewing,
  isTrialSubscription,
} from "../utils/subscriptionFlags.js";
import {
  getReminderStartDaysBefore,
  shouldSendReminderOnDate,
} from "../utils/reminderPolicy.js";

function getReminderDaysAhead(env: Env): number {
  const raw = env.REMINDER_DAYS_AHEAD;
  if (raw === undefined || raw === null) return 3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 3;
  return Math.floor(parsed);
}

function isReminderDispatchSlot(
  localHour: number,
  localMinute: number,
  reminderHour: number,
): boolean {
  return localHour === reminderHour && localMinute < 30;
}

export interface ReminderEntryResult {
  sent: boolean;
  advanced: boolean;
}

export interface ReminderEntryInput {
  entry: ReminderEntry;
  date: string;
}

export interface ReminderBatchResult {
  sent: number;
  messages: number;
  advanced: number;
}

export interface ReminderQueueProcessResult extends ReminderBatchResult {
  retryableFailure: boolean;
}

interface ReminderProcessingOptions {
  deferAdvanceOnRetryableFailure: boolean;
  throwOnEvaluationError: boolean;
}

const DIRECT_PROCESSING_OPTIONS: ReminderProcessingOptions = {
  deferAdvanceOnRetryableFailure: false,
  throwOnEvaluationError: false,
};

const QUEUE_PROCESSING_OPTIONS: ReminderProcessingOptions = {
  deferAdvanceOnRetryableFailure: true,
  throwOnEvaluationError: true,
};

interface PendingReminder {
  entry: ReminderEntry;
  date: string;
  localDate: string;
  sub: Subscription;
  userProfile: DecryptedUserProfile;
  settings: UserSettings;
  localHour: number;
  localMinute: number;
}

async function advanceDueSubscription(
  env: Env,
  subscriptionService: SubscriptionService,
  entry: ReminderEntry,
  sub: Subscription,
  localToday: string,
): Promise<boolean> {
  if (isTrialSubscription(sub)) return false;

  if (!isAutoRenewing(sub)) {
    await subscriptionService.pauseExpiredNonRenewing(
      entry.userKey,
      entry.subscriptionId,
      env.ENCRYPTION_KEY,
    );
    return false;
  }

  const advanced = await subscriptionService.advancePastDue(
    entry.userKey,
    entry.subscriptionId,
    env.ENCRYPTION_KEY,
    localToday,
  );
  return Boolean(advanced && advanced.nextBillingDate > localToday);
}

async function evaluateReminderEntry(
  env: Env,
  reminderRepo: ReminderRepository,
  subRepo: SubscriptionRepository,
  userRepo: UserRepository,
  subscriptionService: SubscriptionService,
  entry: ReminderEntry,
  date: string,
  daysAhead: number,
  throwOnError = false,
): Promise<{ pending?: PendingReminder; advanced: boolean }> {
  const result = {
    pending: undefined as PendingReminder | undefined,
    advanced: false,
  };

  try {
    if (await userRepo.isUserDeleted(entry.userKey)) {
      return result;
    }

    const stored = await subRepo.get(entry.userKey, entry.subscriptionId);
    if (!stored) {
      log("info", "Skipping stale reminder: subscription missing", {
        date,
        subId: entry.subscriptionId,
      });
      return result;
    }
    if (stored.nextBillingDate !== date) {
      log("info", "Skipping stale reminder: billing date mismatch", {
        date,
        subId: entry.subscriptionId,
      });
      return result;
    }

    const encryptedSub = parseEncryptedPayload(stored.encryptedPayload);
    const userEncryptionKey = await deriveUserKey(
      env.ENCRYPTION_KEY,
      entry.userKey,
    );
    const decryptedSub = await decrypt(encryptedSub, userEncryptionKey);
    const sub: Subscription = JSON.parse(decryptedSub);
    const status = sub.status ?? "active";

    if (status === "paused") {
      log("info", "Skipping reminder: subscription paused", {
        date,
        subId: entry.subscriptionId,
      });
      return result;
    }

    const userProfile = await userRepo.getUserProfile(
      entry.userKey,
      env.ENCRYPTION_KEY,
    );
    if (!userProfile) {
      log("warn", "Skipping reminder: no user profile", {
        date,
        subId: entry.subscriptionId,
      });
      return result;
    }

    const settings = userProfile.settings ?? DEFAULT_USER_SETTINGS;
    if (!settings.reminderEnabled) {
      return result;
    }

    const tz = settings.timezone || "UTC";
    const local = getLocalTimeInfo(tz);
    if (!local) {
      log("warn", "Invalid timezone in user settings", {
        date,
        subId: entry.subscriptionId,
        timezone: tz,
      });
      return result;
    }

    const { date: localToday, hour: localHour, minute: localMinute } = local;
    const billingDate = sub.nextBillingDate;
    const reminderHour = settings.reminderHour ?? 9;
    const reminderStart = addDays(
      billingDate,
      -getReminderStartDaysBefore(sub, daysAhead),
    );

    if (localToday < reminderStart) {
      return result;
    }

    if (localToday > billingDate) {
      result.advanced = await advanceDueSubscription(
        env,
        subscriptionService,
        entry,
        sub,
        localToday,
      );
      return result;
    }

    if (!isReminderDispatchSlot(localHour, localMinute, reminderHour)) {
      return result;
    }

    if (!shouldSendReminderOnDate(sub, localToday, reminderStart)) {
      if (localToday === billingDate) {
        result.advanced = await advanceDueSubscription(
          env,
          subscriptionService,
          entry,
          sub,
          localToday,
        );
      }
      return result;
    }

    if (
      await reminderRepo.hasSent(
        entry.userKey,
        entry.subscriptionId,
        billingDate,
        localToday,
      )
    ) {
      if (localToday === billingDate) {
        result.advanced = await advanceDueSubscription(
          env,
          subscriptionService,
          entry,
          sub,
          localToday,
        );
      }
      return result;
    }

    result.pending = {
      entry,
      date,
      localDate: localToday,
      sub,
      userProfile,
      settings,
      localHour,
      localMinute,
    };
  } catch (error) {
    log("error", "Error processing reminder entry", {
      date,
      subId: entry.subscriptionId,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    if (throwOnError) throw error;
  }

  return result;
}

function isRetryableTelegramFailure(status?: number): boolean {
  return (
    status === undefined || status === 401 || status === 429 || status >= 500
  );
}

async function advancePendingReminder(
  env: Env,
  subscriptionService: SubscriptionService,
  reminder: PendingReminder,
): Promise<boolean> {
  if (reminder.localDate < reminder.sub.nextBillingDate) return false;
  return advanceDueSubscription(
    env,
    subscriptionService,
    reminder.entry,
    reminder.sub,
    reminder.localDate,
  );
}

function logSendFailure(reminders: PendingReminder[], status?: number): void {
  for (const reminder of reminders) {
    log("warn", "Failed to send reminder", {
      date: reminder.date,
      subId: reminder.entry.subscriptionId,
      status,
    });
  }
}

function logSendSuccess(reminder: PendingReminder): void {
  log("info", "Reminder sent successfully", {
    date: reminder.date,
    subId: reminder.entry.subscriptionId,
    timezone: reminder.settings.timezone || "UTC",
    localHour: reminder.localHour,
    localMinute: reminder.localMinute,
  });
}

async function markRemindersSent(
  reminderRepo: ReminderRepository,
  reminders: PendingReminder[],
): Promise<void> {
  const outcomes = await Promise.allSettled(
    reminders.map((reminder) =>
      reminderRepo.markSent(
        reminder.entry.userKey,
        reminder.entry.subscriptionId,
        reminder.date,
        reminder.localDate,
      ),
    ),
  );

  outcomes.forEach((outcome, index) => {
    const reminder = reminders[index];
    if (outcome.status === "fulfilled") {
      logSendSuccess(reminder);
      return;
    }
    log("error", "Failed to persist reminder sent marker", {
      date: reminder.date,
      subId: reminder.entry.subscriptionId,
      error:
        outcome.reason instanceof Error ? outcome.reason.name : "UnknownError",
    });
  });
}

async function advancePendingReminders(
  env: Env,
  subscriptionService: SubscriptionService,
  reminders: PendingReminder[],
): Promise<number> {
  const outcomes = await Promise.all(
    reminders.map(async (reminder) => {
      try {
        return await advancePendingReminder(env, subscriptionService, reminder);
      } catch (error) {
        log("error", "Failed to advance due subscription", {
          date: reminder.date,
          subId: reminder.entry.subscriptionId,
          error: error instanceof Error ? error.name : "UnknownError",
        });
        return false;
      }
    }),
  );
  return outcomes.filter(Boolean).length;
}

async function processPendingReminderBatch(
  env: Env,
  reminderRepo: ReminderRepository,
  subscriptionService: SubscriptionService,
  reminders: PendingReminder[],
  options: ReminderProcessingOptions,
): Promise<ReminderQueueProcessResult> {
  if (reminders.length > REMINDER_MESSAGE_SIZE) {
    const combined: ReminderQueueProcessResult = {
      sent: 0,
      messages: 0,
      advanced: 0,
      retryableFailure: false,
    };
    const sorted = [...reminders].sort(
      (a, b) =>
        a.sub.nextBillingDate.localeCompare(b.sub.nextBillingDate) ||
        a.sub.name.localeCompare(b.sub.name),
    );
    for (let start = 0; start < sorted.length; start += REMINDER_MESSAGE_SIZE) {
      const chunk = await processPendingReminderBatch(
        env,
        reminderRepo,
        subscriptionService,
        sorted.slice(start, start + REMINDER_MESSAGE_SIZE),
        options,
      );
      combined.sent += chunk.sent;
      combined.messages += chunk.messages;
      combined.advanced += chunk.advanced;
      combined.retryableFailure ||= chunk.retryableFailure;
    }
    return combined;
  }
  const result: ReminderQueueProcessResult = {
    sent: 0,
    messages: 0,
    advanced: 0,
    retryableFailure: false,
  };
  const first = reminders[0];
  const subs = reminders.map((item) => item.sub);

  try {
    const sendResult = await sendRichMessage(
      env,
      first.userProfile.chatId,
      reminderPresentation(subs),
    );

    if (sendResult.ok) {
      result.sent = reminders.length;
      result.messages = 1;
      await markRemindersSent(reminderRepo, reminders);
    } else {
      logSendFailure(reminders, sendResult.status);
      result.retryableFailure = isRetryableTelegramFailure(sendResult.status);
    }
  } catch {
    logSendFailure(reminders, undefined);
    result.retryableFailure = true;
  }

  if (result.retryableFailure && options.deferAdvanceOnRetryableFailure) {
    return result;
  }

  result.advanced = await advancePendingReminders(
    env,
    subscriptionService,
    reminders,
  );
  return result;
}

export async function processReminderEntry(
  env: Env,
  reminderRepo: ReminderRepository,
  subRepo: SubscriptionRepository,
  userRepo: UserRepository,
  subscriptionService: SubscriptionService,
  entry: ReminderEntry,
  date: string,
  daysAhead = getReminderDaysAhead(env),
): Promise<ReminderEntryResult> {
  const { pending, advanced } = await evaluateReminderEntry(
    env,
    reminderRepo,
    subRepo,
    userRepo,
    subscriptionService,
    entry,
    date,
    daysAhead,
  );
  if (!pending) return { sent: false, advanced };

  const batchResult = await processPendingReminderBatch(
    env,
    reminderRepo,
    subscriptionService,
    [pending],
    DIRECT_PROCESSING_OPTIONS,
  );
  return {
    sent: batchResult.sent === 1,
    advanced: batchResult.advanced === 1,
  };
}

export async function processReminderEntries(
  env: Env,
  reminderRepo: ReminderRepository,
  subRepo: SubscriptionRepository,
  userRepo: UserRepository,
  subscriptionService: SubscriptionService,
  inputs: ReminderEntryInput[],
  daysAhead = getReminderDaysAhead(env),
): Promise<ReminderBatchResult> {
  const result = await processReminderEntriesInternal(
    env,
    reminderRepo,
    subRepo,
    userRepo,
    subscriptionService,
    inputs,
    daysAhead,
    DIRECT_PROCESSING_OPTIONS,
  );
  return {
    sent: result.sent,
    messages: result.messages,
    advanced: result.advanced,
  };
}

export async function processReminderQueueEntries(
  env: Env,
  reminderRepo: ReminderRepository,
  subRepo: SubscriptionRepository,
  userRepo: UserRepository,
  subscriptionService: SubscriptionService,
  inputs: ReminderEntryInput[],
  daysAhead = getReminderDaysAhead(env),
): Promise<ReminderQueueProcessResult> {
  return processReminderEntriesInternal(
    env,
    reminderRepo,
    subRepo,
    userRepo,
    subscriptionService,
    inputs,
    daysAhead,
    QUEUE_PROCESSING_OPTIONS,
  );
}

async function processReminderEntriesInternal(
  env: Env,
  reminderRepo: ReminderRepository,
  subRepo: SubscriptionRepository,
  userRepo: UserRepository,
  subscriptionService: SubscriptionService,
  inputs: ReminderEntryInput[],
  daysAhead: number,
  options: ReminderProcessingOptions,
): Promise<ReminderQueueProcessResult> {
  const result: ReminderQueueProcessResult = {
    sent: 0,
    messages: 0,
    advanced: 0,
    retryableFailure: false,
  };
  const pendingByUser = new Map<string, PendingReminder[]>();

  for (const { entry, date } of inputs) {
    const { pending, advanced } = await evaluateReminderEntry(
      env,
      reminderRepo,
      subRepo,
      userRepo,
      subscriptionService,
      entry,
      date,
      daysAhead,
      options.throwOnEvaluationError,
    );

    if (advanced) result.advanced++;
    if (!pending) continue;

    const existing = pendingByUser.get(entry.userKey);
    if (existing) {
      existing.push(pending);
    } else {
      pendingByUser.set(entry.userKey, [pending]);
    }
  }

  for (const reminders of pendingByUser.values()) {
    const batchResult = await processPendingReminderBatch(
      env,
      reminderRepo,
      subscriptionService,
      reminders,
      options,
    );
    result.sent += batchResult.sent;
    result.messages += batchResult.messages;
    result.advanced += batchResult.advanced;
    result.retryableFailure ||= batchResult.retryableFailure;
  }

  return result;
}

/**
 * Compute the date range for scheduled reminders.
 * Returns dates from today - 1 through today + daysAhead + 1 (inclusive).
 * The extra ±1 day covers timezone boundaries (UTC-12 to UTC+14).
 */
export function getReminderDateRange(daysAhead: number): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let i = -1; i <= daysAhead + 1; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

export { getReminderDaysAhead };
