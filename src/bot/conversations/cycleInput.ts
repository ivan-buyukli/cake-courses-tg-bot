import { Conversation } from "@grammyjs/conversations";
import { InlineKeyboard } from "grammy";
import { BillingCycle, BillingInterval } from "../../models/subscription.js";
import { parseBillingCycleText } from "../../utils/billingCycle.js";
import { parseCycleIntervalCallbackData } from "../../utils/callbackParser.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { ValidationError } from "../../utils/errors.js";
import { BotContext, BaseBotContext } from "../../types/context.js";

export interface CycleSelection {
  cycle: BillingCycle;
  billingInterval?: BillingInterval;
}

const VALID_CYCLES: readonly BillingCycle[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
  "interval",
];

function isBillingCycle(value: string | null): value is BillingCycle {
  return value !== null && VALID_CYCLES.includes(value as BillingCycle);
}

export function cycleKeyboard(
  callbackData: (cycle: BillingCycle) => string,
  cancelData = "cycle:cancel",
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Weekly", callbackData("weekly"))
    .text("Monthly", callbackData("monthly"))
    .row()
    .text("Quarterly", callbackData("quarterly"))
    .text("Yearly", callbackData("yearly"))
    .row()
    .text("Custom", callbackData("custom"))
    .text("Advanced interval", callbackData("interval"))
    .row()
    .text("Cancel", cancelData);
}

function intervalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("30 days", "cycleint:preset:30d")
    .text("4 weeks", "cycleint:preset:4w")
    .row()
    .text("6 months", "cycleint:preset:6m")
    .text("1 year", "cycleint:preset:1y")
    .row()
    .text("Other", "cycleint:other")
    .row()
    .text("Back to billing cycles", "cycleint:back")
    .text("Cancel", "cycleint:cancel");
}

function intervalTextKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Back to intervals", "cycleint:back")
    .text("Cancel", "cycleint:cancel");
}

function parseIntervalSelection(value: string): CycleSelection | null {
  const parsedCycle = parseBillingCycleText(value);
  if (parsedCycle.billingCycle !== "interval" || !parsedCycle.billingInterval) {
    return null;
  }
  return {
    cycle: parsedCycle.billingCycle,
    billingInterval: parsedCycle.billingInterval,
  };
}

export async function collectCycleInput(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  {
    prompt = "Choose a billing cycle: ",
    callbackPattern,
    callbackData,
    parseCycle,
    invalidSelectionMessage,
    cancelData = "cycle:cancel",
  }: {
    prompt?: string;
    callbackPattern: RegExp;
    callbackData: (cycle: BillingCycle) => string;
    parseCycle: (callbackData: string) => string | null;
    invalidSelectionMessage: string;
    cancelData?: string;
  },
): Promise<CycleSelection | null> {
  while (true) {
    await ctx.reply(prompt, {
      reply_markup: cycleKeyboard(callbackData, cancelData),
    });
    const cycleCtx = await conversation.wait();
    if (cycleCtx.message?.text) {
      if (isCancelInput(cycleCtx.message.text)) {
        await ctx.reply("Cancelled.");
        return null;
      }
      await ctx.reply(
        "Choose a billing cycle using the buttons, or send /cancel to exit.",
      );
      continue;
    }
    const cycleCallbackData = cycleCtx.callbackQuery?.data;
    if (!cycleCallbackData || !callbackPattern.test(cycleCallbackData)) {
      continue;
    }
    if (cycleCallbackData === cancelData) {
      await cycleCtx.answerCallbackQuery();
      try {
        await cycleCtx.deleteMessage();
      } catch {
        // The callback message may already be gone.
      }
      await ctx.reply("Cancelled.");
      return null;
    }
    const selectedCycle = parseCycle(cycleCallbackData);
    if (!isBillingCycle(selectedCycle)) {
      await ctx.reply(invalidSelectionMessage);
      return null;
    }
    await cycleCtx.answerCallbackQuery();
    try {
      await cycleCtx.deleteMessage();
    } catch {
      // The callback message may already be gone.
    }

    if (selectedCycle !== "interval") {
      return { cycle: selectedCycle };
    }

    while (true) {
      await ctx.reply(
        "Choose an interval, or select “Other” to enter a custom interval.",
        {
          reply_markup: intervalKeyboard(),
        },
      );
      const intervalChoiceCtx = await conversation.wait();
      if (intervalChoiceCtx.message?.text) {
        if (isCancelInput(intervalChoiceCtx.message.text)) {
          await ctx.reply("Cancelled.");
          return null;
        }
        await ctx.reply(
          "Choose an interval using the buttons, or send /cancel to exit.",
        );
        continue;
      }
      const intervalCallbackData = intervalChoiceCtx.callbackQuery?.data;
      if (!intervalCallbackData?.startsWith("cycleint:")) {
        continue;
      }
      const parsedInterval =
        parseCycleIntervalCallbackData(intervalCallbackData);

      if (!parsedInterval) {
        await intervalChoiceCtx.answerCallbackQuery(
          "Invalid interval selection.",
        );
        continue;
      }

      await intervalChoiceCtx.answerCallbackQuery();
      try {
        await intervalChoiceCtx.deleteMessage();
      } catch {
        // The callback message may already be gone.
      }

      if (parsedInterval.action === "cancel") {
        await ctx.reply("Cancelled.");
        return null;
      }

      if (parsedInterval.action === "back") {
        break;
      }

      if (parsedInterval.action === "preset") {
        const selection = parseIntervalSelection(parsedInterval.value);
        if (!selection) {
          await ctx.reply("Enter an interval, such as 30d, 4w, 6m, or 2y.");
          continue;
        }
        return selection;
      }

      await ctx.reply(
        "Enter an interval, such as every 30 days, every 4 weeks, 6m, 2y, 30d, or 4w.",
        { reply_markup: intervalTextKeyboard() },
      );

      const intervalCtx = await conversation.wait();
      if (intervalCtx.message?.text) {
        const intervalText = intervalCtx.message.text;
        if (isCancelInput(intervalText)) {
          await ctx.reply("Cancelled.");
          return null;
        }
        try {
          const selection = parseIntervalSelection(intervalText);
          if (!selection) {
            await ctx.reply("Enter an interval, such as 30d, 4w, 6m, or 2y.");
            continue;
          }
          return selection;
        } catch (err) {
          if (err instanceof ValidationError) {
            await ctx.reply(err.message + "\nPlease try again at this step.");
            continue;
          }
          throw err;
        }
      }

      if (!intervalCtx.callbackQuery?.data) continue;
      const parsedTextAction = parseCycleIntervalCallbackData(
        intervalCtx.callbackQuery.data,
      );
      if (!parsedTextAction) {
        await intervalCtx.answerCallbackQuery("Invalid interval selection.");
        continue;
      }

      if (parsedTextAction.action === "cancel") {
        await intervalCtx.answerCallbackQuery();
        await ctx.reply("Cancelled.");
        return null;
      }

      if (parsedTextAction.action === "back") {
        await intervalCtx.answerCallbackQuery();
        continue;
      }

      await intervalCtx.answerCallbackQuery("Enter a custom interval.");
    }
  }
}
