import { BotContext } from "../../types/context.js";
import { parseAddArgs } from "../../utils/commandParser.js";
import { ValidationError } from "../../utils/errors.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import type { Subscription } from "../../models/subscription.js";
import { shortId } from "../../utils/shortId.js";
import { createLogger } from "../../utils/logger.js";
import { formatBillingCycle } from "../../utils/labels.js";
import {
  SETTINGS_ONBOARDING_MESSAGE,
  shouldShowSettingsOnboarding,
} from "../onboarding/settingsOnboarding.js";

export async function addCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    logger.warn("Add command without userKey");
    return;
  }

  const text = ctx.msg?.text ?? "";
  const args = text.trim().split(/\s+/);

  // If no arguments beyond the command, start interactive conversation
  if (args.length < 2) {
    await ctx.conversation.enter("add");
    return;
  }

  let parsed;
  try {
    parsed = parseAddArgs(args);
  } catch (err) {
    if (err instanceof ValidationError) {
      await ctx.reply(err.message);
      return;
    }
    throw err;
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const service = createSubscriptionService(repo, reminderRepo);

  const now = new Date().toISOString();
  const sub: Subscription = {
    id: crypto.randomUUID(),
    name: parsed.name,
    price: parsed.price,
    currency: parsed.currency,
    billingCycle: parsed.billingCycle,
    billingInterval: parsed.billingInterval,
    nextBillingDate: parsed.nextBillingDate,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await service.create(ctx.userKey, sub, ctx.env.ENCRYPTION_KEY);

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  const showSettingsOnboarding = await shouldShowSettingsOnboarding(
    userRepo,
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );

  logger.info("Subscription created", {
    subId: sub.id,
    shortId: shortId(sub.id),
  });

  await ctx.reply(
    `Subscription added.\n` +
      `${sub.name} — ${sub.price} ${sub.currency} — ${formatBillingCycle(sub.billingCycle, sub.billingInterval)} — Next payment: ${sub.nextBillingDate}\n` +
      `Short ID: ${shortId(sub.id)}`,
  );

  if (showSettingsOnboarding) {
    await ctx.reply(SETTINGS_ONBOARDING_MESSAGE);
  }
}
