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
    .text("每周", callbackData("weekly"))
    .text("每月", callbackData("monthly"))
    .row()
    .text("每季度", callbackData("quarterly"))
    .text("每年", callbackData("yearly"))
    .row()
    .text("自定义", callbackData("custom"))
    .text("高级间隔", callbackData("interval"))
    .row()
    .text("取消", cancelData);
}

function intervalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("30 天", "cycleint:preset:30d")
    .text("4 周", "cycleint:preset:4w")
    .row()
    .text("6 个月", "cycleint:preset:6m")
    .text("1 年", "cycleint:preset:1y")
    .row()
    .text("其他", "cycleint:other")
    .row()
    .text("返回周期选择", "cycleint:back")
    .text("取消", "cycleint:cancel");
}

function intervalTextKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("返回高级间隔", "cycleint:back")
    .text("取消", "cycleint:cancel");
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
    prompt = "请选择扣款周期：",
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
        await ctx.reply("已取消。");
        return null;
      }
      await ctx.reply("请点击按钮选择扣款周期，或发送 /cancel 退出。");
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
      await ctx.reply("已取消。");
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
      await ctx.reply("请选择高级间隔，或点“其他”输入自定义间隔。", {
        reply_markup: intervalKeyboard(),
      });
      const intervalChoiceCtx = await conversation.wait();
      if (intervalChoiceCtx.message?.text) {
        if (isCancelInput(intervalChoiceCtx.message.text)) {
          await ctx.reply("已取消。");
          return null;
        }
        await ctx.reply("请点击按钮选择高级间隔，或发送 /cancel 退出。");
        continue;
      }
      const intervalCallbackData = intervalChoiceCtx.callbackQuery?.data;
      if (!intervalCallbackData?.startsWith("cycleint:")) {
        continue;
      }
      const parsedInterval =
        parseCycleIntervalCallbackData(intervalCallbackData);

      if (!parsedInterval) {
        await intervalChoiceCtx.answerCallbackQuery("无效的间隔选择。");
        continue;
      }

      await intervalChoiceCtx.answerCallbackQuery();
      try {
        await intervalChoiceCtx.deleteMessage();
      } catch {
        // The callback message may already be gone.
      }

      if (parsedInterval.action === "cancel") {
        await ctx.reply("已取消。");
        return null;
      }

      if (parsedInterval.action === "back") {
        break;
      }

      if (parsedInterval.action === "preset") {
        const selection = parseIntervalSelection(parsedInterval.value);
        if (!selection) {
          await ctx.reply("请输入高级间隔，例如 30d、4w、6m 或 2y。");
          continue;
        }
        return selection;
      }

      await ctx.reply(
        "请输入间隔，例如 every 30 days、every 4 weeks、6m、2y、30d、4w、每30天、每4周、每6个月、每2年。",
        { reply_markup: intervalTextKeyboard() },
      );

      const intervalCtx = await conversation.wait();
      if (intervalCtx.message?.text) {
        const intervalText = intervalCtx.message.text;
        if (isCancelInput(intervalText)) {
          await ctx.reply("已取消。");
          return null;
        }
        try {
          const selection = parseIntervalSelection(intervalText);
          if (!selection) {
            await ctx.reply("请输入高级间隔，例如 30d、4w、6m 或 2y。");
            continue;
          }
          return selection;
        } catch (err) {
          if (err instanceof ValidationError) {
            await ctx.reply(err.message + "\n请在当前步骤重新输入。");
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
        await intervalCtx.answerCallbackQuery("无效的间隔选择。");
        continue;
      }

      if (parsedTextAction.action === "cancel") {
        await intervalCtx.answerCallbackQuery();
        await ctx.reply("已取消。");
        return null;
      }

      if (parsedTextAction.action === "back") {
        await intervalCtx.answerCallbackQuery();
        continue;
      }

      await intervalCtx.answerCallbackQuery("请发送自定义间隔。");
    }
  }
}
