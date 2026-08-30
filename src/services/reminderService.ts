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
import {
  sendMessage,
  TelegramInlineKeyboardMarkup,
} from "./telegramService.js";
import { decrypt, parseEncryptedPayload } from "../crypto/encryption.js";
import { deriveUserKey } from "../crypto/keyDerivation.js";
import { log } from "../utils/logger.js";
import {
  addDays,
  formatDate,
  getBillingAnchorDay,
  getLocalTimeInfo,
  getNextBillingDate,
} from "../utils/date.js";
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

function formatReminderMessage(sub: Subscription): string {
  const lines: string[] = [];

  if (isTrialSubscription(sub)) {
    lines.push(
      `体验到期提醒：\n${sub.name} 将在 ${sub.nextBillingDate} 到期，之后可能开始扣款。`,
    );
  } else if (!isAutoRenewing(sub)) {
    lines.push(
      `服务到期提醒：\n${sub.name} 将在 ${sub.nextBillingDate} 到期，已关闭自动续费。`,
    );
  } else {
    lines.push(`扣款提醒：\n${sub.name} 将在 ${sub.nextBillingDate} 扣款。`);
  }

  if (sub.price !== undefined) {
    lines.push(`价格：${sub.price} ${sub.currency ?? ""}`.trim());
  }

  lines.push("\n发送 /list 查看详情或管理订阅。");
  return lines.join("\n");
}

function getReminderKindLabel(sub: Subscription): string {
  if (isTrialSubscription(sub)) return "体验到期";
  if (!isAutoRenewing(sub)) return "服务到期";
  return "扣款";
}

function formatReminderListItem(sub: Subscription, index: number): string {
  const parts = [
    `${index}. ${getReminderKindLabel(sub)}：${sub.name}`,
    `日期：${sub.nextBillingDate}`,
  ];

  if (sub.price !== undefined) {
    parts.push(`价格：${sub.price} ${sub.currency ?? ""}`.trim());
  }

  parts.push("发送 /list 管理");
  return parts.join("｜");
}

function formatCombinedReminderMessage(subs: Subscription[]): string {
  if (subs.length === 1) {
    return formatReminderMessage(subs[0]);
  }

  const sorted = [...subs].sort((a, b) => {
    const byDate = a.nextBillingDate.localeCompare(b.nextBillingDate);
    if (byDate !== 0) return byDate;
    return a.name.localeCompare(b.name);
  });

  return [
    `订阅提醒：以下 ${sorted.length} 个项目需要关注。`,
    "",
    ...sorted.map((sub, index) => formatReminderListItem(sub, index + 1)),
  ].join("\n");
}

function canRenewOneCycle(sub: Subscription): boolean {
  const billingAnchorDay =
    sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate);
  return (
    getNextBillingDate(
      sub.nextBillingDate,
      sub.billingCycle,
      billingAnchorDay,
      sub.billingInterval,
    ) !== null
  );
}

function formatRenewButtonLabel(sub: Subscription, total: number): string {
  if (total === 1) return "已续费一个周期";
  return `已续费：${sub.name}`;
}

function reminderRenewKeyboard(
  subs: Subscription[],
): TelegramInlineKeyboardMarkup | undefined {
  const renewableSubs = subs.filter(canRenewOneCycle);
  if (renewableSubs.length === 0) return undefined;

  return {
    inline_keyboard: renewableSubs.map((sub) => [
      {
        text: formatRenewButtonLabel(sub, renewableSubs.length),
        callback_data: `reminder:renew:${sub.id}:${sub.nextBillingDate}`,
      },
    ]),
  };
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
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
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

function logSendFailure(
  reminders: PendingReminder[],
  status?: number,
  description?: string,
): void {
  for (const reminder of reminders) {
    log("warn", "Failed to send reminder", {
      date: reminder.date,
      subId: reminder.entry.subscriptionId,
      status,
      description,
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
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason),
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
          error: error instanceof Error ? error.message : String(error),
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
): Promise<ReminderBatchResult> {
  const result: ReminderBatchResult = { sent: 0, messages: 0, advanced: 0 };
  const first = reminders[0];
  const subs = reminders.map((item) => item.sub);

  try {
    const sendResult = await sendMessage(
      env,
      first.userProfile.chatId,
      formatCombinedReminderMessage(subs),
      { reply_markup: reminderRenewKeyboard(subs) },
    );

    if (sendResult.ok) {
      result.sent = reminders.length;
      result.messages = 1;
      await markRemindersSent(reminderRepo, reminders);
    } else {
      logSendFailure(reminders, sendResult.status, sendResult.description);
    }
  } catch (error) {
    logSendFailure(
      reminders,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
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
  const result: ReminderBatchResult = { sent: 0, messages: 0, advanced: 0 };
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
    );
    result.sent += batchResult.sent;
    result.messages += batchResult.messages;
    result.advanced += batchResult.advanced;
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
