import { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { formatSubscriptionLine } from "../../utils/formatSubscription.js";
import { createLogger } from "../../utils/logger.js";
import type { Subscription } from "../../models/subscription.js";
import { formatDate, getLocalTimeInfo } from "../../utils/date.js";
import { listPresentation } from "../ui/subscriptionPresentation.js";
import { sendRichOrPlain } from "../ui/richMessage.js";
import { emptySubscriptionsKeyboard } from "../ui/navigation.js";

const MAX_LIST_MESSAGE_LENGTH = 3900;

async function listSubscriptions(
  ctx: BotContext,
): Promise<Subscription[] | null> {
  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    return null;
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const service = createSubscriptionService(repo, reminderRepo);

  const subs = await service.list(ctx.userKey, ctx.env.ENCRYPTION_KEY);
  return subs.sort((a, b) => {
    const statusA = a.status === "paused" ? 1 : 0;
    const statusB = b.status === "paused" ? 1 : 0;
    if (statusA !== statusB) return statusA - statusB;
    return (
      new Date(a.nextBillingDate).getTime() -
      new Date(b.nextBillingDate).getTime()
    );
  });
}

function buildListMessages(header: string, lines: string[]): string[] {
  const messages: string[] = [];
  let current = `${header}\n\n`;

  for (const line of lines) {
    const next = current.endsWith("\n\n")
      ? current + line
      : current + "\n" + line;
    if (next.length > MAX_LIST_MESSAGE_LENGTH && !current.endsWith("\n\n")) {
      messages.push(current);
      current = `${header} (continued): \n\n${line}`;
    } else {
      current = next;
    }
  }

  messages.push(current);
  return messages;
}

export async function listTextCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  const subs = await listSubscriptions(ctx);
  if (!subs) {
    logger.warn("List command without userKey");
    return;
  }

  if (subs.length === 0) {
    await ctx.reply("You have not added any subscriptions yet.", {
      reply_markup: emptySubscriptionsKeyboard(),
    });
    return;
  }

  let today = formatDate(new Date());
  if (ctx.userKey) {
    const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
    const settings = await userRepo.getUserSettings(
      ctx.userKey,
      ctx.env.ENCRYPTION_KEY,
    );
    const local = getLocalTimeInfo(settings.timezone || "UTC");
    if (local) today = local.date;
  }
  const activeSubs = subs.filter((s) => s.status !== "paused");
  const pausedSubs = subs.filter((s) => s.status === "paused");

  const lines: string[] = [];
  if (activeSubs.length > 0) {
    lines.push(
      ...activeSubs.map((sub, index) =>
        formatSubscriptionLine(sub, index, today),
      ),
    );
  }
  if (pausedSubs.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Paused subscriptions: ");
    lines.push(
      ...pausedSubs.map((sub, index) =>
        formatSubscriptionLine(sub, index, today),
      ),
    );
  }

  for (const message of buildListMessages("Your subscriptions: ", lines)) {
    await ctx.reply(message);
  }

  logger.info("Listed compact subscriptions", {
    count: subs.length,
  });
}

export async function listCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  const subs = await listSubscriptions(ctx);
  if (!subs) {
    logger.warn("List full command without userKey");
    return;
  }

  if (subs.length === 0) {
    await ctx.reply("You have not added any subscriptions yet.", {
      reply_markup: emptySubscriptionsKeyboard(),
    });
    return;
  }

  await sendRichOrPlain(ctx, listPresentation(subs, 0));

  logger.info("Listed full subscriptions (inline)", {
    count: subs.length,
  });
}

export const listFullCommand = listCommand;
