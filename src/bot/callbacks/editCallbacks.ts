import { BotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";
import { parseEditCallbackData } from "../../utils/callbackParser.js";

async function safeAnswerCallbackQuery(
  ctx: BotContext,
  text?: string,
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch {
    // Ignore if answering fails
  }
}

async function safeEditMessageText(
  ctx: BotContext,
  text: string,
): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch {
    // Message may have been deleted or already edited
  }
}

export async function editFieldCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      return;
    }

    const parsed = parseEditCallbackData(ctx.callbackQuery?.data ?? "");
    if (!parsed) {
      await safeAnswerCallbackQuery(ctx, "Invalid button data.");
      return;
    }

    const { field, subId } = parsed;

    await safeAnswerCallbackQuery(ctx);
    switch (field) {
      case "cycle":
        await ctx.conversation.enter("editCycle", subId);
        return;
      case "reminder":
        await ctx.conversation.enter("editReminder", subId);
        return;
      case "cancel":
        await safeEditMessageText(ctx, "Editing cancelled.");
        return;
      default:
        await ctx.conversation.enter("editField", subId, field);
    }
  } catch (error) {
    logger.error("Error in editFieldCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}

export async function editCancelCallback(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  try {
    if (!ctx.userKey) {
      await safeAnswerCallbackQuery(ctx, "Unable to identify your account.");
      await safeEditMessageText(ctx, "Unable to identify your account.");
      return;
    }

    await safeAnswerCallbackQuery(ctx, "Cancelled.");
    await safeEditMessageText(ctx, "Editing cancelled.");

    logger.info("Edit cancelled via callback");
  } catch (error) {
    logger.error("Error in editCancelCallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    await safeAnswerCallbackQuery(
      ctx,
      "Operation failed. Please try again later.",
    );
  }
}
