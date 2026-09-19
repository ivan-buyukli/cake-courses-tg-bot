import { BotContext } from "../../types/context.js";

export async function debugMeCommand(ctx: BotContext): Promise<void> {
  if (ctx.env.APP_ENV === "production") {
    await ctx.reply("This command is unavailable.");
    return;
  }

  await ctx.reply(
    "Debug information: \n" +
      `- userKey: ${ctx.userKey ? "present" : "missing"}\n` +
      `- requestId: ${ctx.requestId}\n` +
      `- Environment: ${ctx.env.APP_ENV ?? "unknown"}`,
  );
}
