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
  if (isTrialSubscription(sub)) labels.push("体验");
  if (!isAutoRenewing(sub)) labels.push("停止续费");
  return labels;
}

export function buildResumePrompt(sub: Subscription): string {
  const dateLabel = formatBillingDateLabel(sub);
  const lines = [
    `恢复"${sub.name}"？`,
    `当前${dateLabel}日期：${sub.nextBillingDate}`,
    "",
    "恢复后会重新开启提醒和日期跟踪。",
  ];

  const notes: string[] = [];
  if (isTrialSubscription(sub)) {
    notes.push(
      "这个项目仍标记为体验，不会计入支出统计，也不会自动推进扣款日。",
    );
  }
  if (!isAutoRenewing(sub)) {
    notes.push("这个项目仍为停止续费，到期提醒发送后会自动暂停。");
  }

  if (notes.length > 0) {
    lines.push(...notes);
  }

  lines.push("", "请选择按当前日期恢复，或选择日期后恢复：");
  return lines.join("\n");
}

export function buildResumeSuccessMessage(sub: Subscription): string {
  const dateLabel = formatBillingDateLabel(sub);
  const lines = [
    `已恢复"${sub.name}"。`,
    `${dateLabel}日期：${sub.nextBillingDate}`,
  ];
  const retained = retainedStatusLabels(sub);
  if (retained.length > 0) {
    lines.push(`保留状态：${retained.join("、")}`);
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
    await ctx.reply("无法识别用户，请稍后再试。");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  await hideMainMenu(ctx, "正在恢复订阅。可随时发送 /cancel 或“取消”退出。");

  const sub = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    return service.get(userKey, subId, encryptionKey);
  });

  if (!sub) {
    await ctx.reply("没有找到这个订阅，或它已被删除。");
    await restoreMainMenu(ctx);
    return;
  }

  if (sub.status === "active") {
    await ctx.reply(`"${sub.name}" 已经是${formatStatus("active")}状态。`);
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
      confirmButtonLabel: "按当前日期恢复",
      cancelMessage: "已取消恢复操作。",
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
    await ctx.reply("恢复失败，请稍后再试。");
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
