import { BotContext } from "../../types/context.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";
import { mainMenuReplyKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function startCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply(
      "欢迎使用订阅管理机器人。\n\n" +
        "我可以帮你记录周期性订阅、提醒下次扣款，并汇总每月支出。\n\n" +
        "使用底部菜单开始。",
      { reply_markup: mainMenuReplyKeyboard() },
    );
    logger.info("Start command without userKey");
    return;
  }

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  if (await userRepo.isUserDeleted(ctx.userKey)) {
    await userRepo.clearUserDeleted(ctx.userKey);
    if (ctx.chat?.id) {
      await userRepo.upsertUserProfile(
        ctx.userKey,
        ctx.chat.id,
        ctx.env.ENCRYPTION_KEY,
      );
    }
  }

  const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const existingIds = await repo.listIds(ctx.userKey);
  const isFirstTime = existingIds.length === 0;

  if (isFirstTime) {
    await ctx.reply(
      "欢迎使用订阅管理机器人。\n\n" +
        "我可以帮你记录周期性订阅、提醒下次扣款，并汇总每月支出。\n\n" +
        "从底部菜单添加第一个订阅。",
      {
        reply_markup: mainMenuReplyKeyboard(),
      },
    );
    logger.info("Start command: first-time welcome");
  } else {
    await ctx.reply("欢迎回来。\n\n" + "使用底部菜单查看订阅、提醒和报告。", {
      reply_markup: mainMenuReplyKeyboard(),
    });
    logger.info("Start command: returning user welcome", {
      subscriptionCount: existingIds.length,
    });
  }
}
