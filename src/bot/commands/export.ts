import { InputFile } from "grammy";
import type { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createPrivacyService } from "../../services/privacyService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";

export async function exportCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    logger.warn("Export command without userKey");
    return;
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  const subscriptionService = createSubscriptionService(repo, reminderRepo);
  const privacyService = createPrivacyService(
    subscriptionService,
    userRepo,
    reminderRepo,
  );

  const exportData = await privacyService.exportUserData(
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );

  const payload = JSON.stringify(exportData, null, 2);
  const exportedAt = new Date(exportData.exportedAt);
  const date = Number.isNaN(exportedAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : exportedAt.toISOString().slice(0, 10);
  const filename = `subscription-export-${date}.json`;

  if (ctx.chat) {
    await ctx.api.sendChatAction(ctx.chat.id, "upload_document");
  }
  await ctx.replyWithDocument(
    new InputFile(new TextEncoder().encode(payload), filename),
    {
      caption:
        "这是你的订阅数据副本。文件不包含 Telegram 用户 ID、存储键或加密密钥。",
    },
  );

  logger.info("Data exported as document", {
    subscriptionCount: exportData.subscriptions.length,
    payloadBytes: new TextEncoder().encode(payload).byteLength,
  });
}
