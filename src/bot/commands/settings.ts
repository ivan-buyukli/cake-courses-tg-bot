import { BotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";

export async function settingsCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("Unable to identify your account. Please try again later.");
    logger.warn("Settings command without userKey");
    return;
  }

  await ctx.conversation.enter("settings");
}
