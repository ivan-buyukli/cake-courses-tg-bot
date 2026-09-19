import {
  reminderPresentation,
  sortReminders,
  REMINDER_MESSAGE_SIZE,
} from "../ui/reminderPresentation.js";
import type { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";
import { addDays, formatDate, getLocalTimeInfo } from "../../utils/date.js";
import { Env } from "../../types/env.js";
import { emptyRemindersKeyboard } from "../ui/navigation.js";
import { sendRichOrPlain } from "../ui/richMessage.js";

function getReminderDaysAhead(env: Env): number {
  const raw = env.REMINDER_DAYS_AHEAD;
  if (raw === undefined || raw === null) return 3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 3;
  return Math.floor(parsed);
}

export async function remindersCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    logger.warn("Reminders command without userKey");
    return;
  }

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  const settings = await userRepo.getUserSettings(
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );
  const local = getLocalTimeInfo(settings.timezone || "UTC");
  const today = local?.date ?? formatDate(new Date());

  const daysAhead = getReminderDaysAhead(ctx.env);
  const maxDate = addDays(today, daysAhead);

  const subRepo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const service = createSubscriptionService(subRepo, reminderRepo);

  const subs = await service.list(ctx.userKey, ctx.env.ENCRYPTION_KEY);

  const upcoming = subs
    .filter((sub) => sub.status !== "paused")
    .filter(
      (sub) => sub.nextBillingDate >= today && sub.nextBillingDate <= maxDate,
    )
    .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate));

  if (upcoming.length === 0) {
    await ctx.reply("No upcoming subscription payments.", {
      reply_markup: emptyRemindersKeyboard(),
    });
    logger.info("Reminders command: no upcoming renewals");
    return;
  }

  const sorted = sortReminders(upcoming);
  for (let start = 0; start < sorted.length; start += REMINDER_MESSAGE_SIZE) {
    await sendRichOrPlain(
      ctx,
      reminderPresentation(
        sorted.slice(start, start + REMINDER_MESSAGE_SIZE),
        "Upcoming reminders",
        `${today} to ${maxDate} · ${start + 1}–${Math.min(start + REMINDER_MESSAGE_SIZE, sorted.length)}/${sorted.length}`,
      ),
    );
  }

  logger.info("Reminders command: listed upcoming renewals", {
    count: upcoming.length,
  });
}
