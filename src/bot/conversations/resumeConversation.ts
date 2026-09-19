import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { collectDateInput } from "./dateInput.js";
import { formatStatus } from "../../utils/labels.js";
import type { Subscription } from "../../models/subscription.js";
import {
  formatBillingDateLabel,
  isAutoRenewing,
  isTrialSubscription,
} from "../../utils/subscriptionFlags.js";
import { hideMainMenu, restoreMainMenu } from "../ui/conversationUi.js";
import {
  isFromListManager,
  updateListManagerDetail,
  type ListManagerConversationOptions,
} from "./subscriptionConversation.js";

function retainedStatusLabels(sub: Subscription): string[] {
  const labels: string[] = [];
  if (isTrialSubscription(sub)) labels.push("Trial");
  if (!isAutoRenewing(sub)) labels.push("Auto-renewal disabled");
  return labels;
}

export function buildResumePrompt(sub: Subscription): string {
  const dateLabel = formatBillingDateLabel(sub);
  const lines = [
    `Resume "${sub.name}"?`,
    `Current ${dateLabel}: ${sub.nextBillingDate}`,
    "",
    "Resuming re-enables reminders and date tracking.",
  ];

  const notes: string[] = [];
  if (isTrialSubscription(sub)) {
    notes.push(
      "This subscription is still marked as a trial. It is excluded from spending totals and its billing date will not advance automatically.",
    );
  }
  if (!isAutoRenewing(sub)) {
    notes.push(
      "This subscription still has auto-renewal disabled. It will pause automatically after its expiration reminder is sent.",
    );
  }

  if (notes.length > 0) {
    lines.push(...notes);
  }

  lines.push("", "Resume with the current date, or choose a new date:");
  return lines.join("\n");
}

export function buildResumeSuccessMessage(sub: Subscription): string {
  const dateLabel = formatBillingDateLabel(sub);
  const lines = [
    `Resumed "${sub.name}".`,
    `${dateLabel}: ${sub.nextBillingDate}`,
  ];
  const retained = retainedStatusLabels(sub);
  if (retained.length > 0) {
    lines.push(`Unchanged status: ${retained.join(", ")}`);
  }
  return lines.join("\n");
}

export async function resumeConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const ctxData = await conversation.external((outsideCtx) => ({
    userKey: outsideCtx.userKey ?? null,
    encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
  }));

  if (!ctxData.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  await hideMainMenu(
    ctx,
    "Resuming a subscription. Send /cancel or “Cancel” at any time to exit.",
  );

  const sub = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.get(userKey, subId, encryptionKey);
  });

  if (!sub) {
    await ctx.reply("Subscription not found, or it has been deleted.");
    await restoreMainMenu(ctx);
    return;
  }

  if (sub.status === "active") {
    await ctx.reply(
      `"${sub.name}" is already ${formatStatus("active").toLowerCase()}.`,
    );
    if (isFromListManager(options)) {
      await updateListManagerDetail(ctx, sub, options.page, options.panel);
    }
    await restoreMainMenu(ctx);
    return;
  }

  const selectedDate = await collectDateInput(
    conversation,
    ctx,
    buildResumePrompt(sub),
    {
      confirmValue: sub.nextBillingDate,
      confirmButtonLabel: "Resume with current date",
      cancelMessage: "Resume cancelled.",
    },
  );

  if (!selectedDate) {
    await restoreMainMenu(ctx);
    return;
  }

  await resumeWithDate(conversation, ctx, userKey, encryptionKey, subId, {
    newDate: selectedDate,
    options,
  });
}

async function resumeWithDate(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  userKey: string,
  encryptionKey: string,
  subId: string,
  {
    newDate,
    options,
  }: {
    newDate: string;
    options?: ListManagerConversationOptions;
  },
): Promise<void> {
  const resumed = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.resume(userKey, subId, encryptionKey, newDate);
  });

  if (!resumed) {
    await ctx.reply("Could not resume. Please try again later.");
    await restoreMainMenu(ctx);
    return;
  }

  if (isFromListManager(options)) {
    await updateListManagerDetail(ctx, resumed, options.page, options.panel);
    await restoreMainMenu(ctx, `✅ ${buildResumeSuccessMessage(resumed)}`);
    return;
  }

  await ctx.reply(buildResumeSuccessMessage(resumed));
  await restoreMainMenu(ctx);
}
