import { BotContext } from "../../types/context.js";
import { privacyDeleteKeyboard } from "../keyboards/privacyDeleteKeyboard.js";
import { createLogger } from "../../utils/logger.js";

export async function deleteMeCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    logger.warn("Delete me command without userKey");
    return;
  }

  await ctx.reply(
    "This will permanently delete all your saved subscription data. Continue?",
    {
      reply_markup: privacyDeleteKeyboard(),
    },
  );

  logger.info("Delete me confirmation requested");
}
