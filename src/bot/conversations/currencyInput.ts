import { Conversation } from "@grammyjs/conversations";
import { InlineKeyboard } from "grammy";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { parseAddCurrencyCallbackData } from "../../utils/callbackParser.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import {
  currencyKeyboard,
  validateCurrencyInput,
} from "../../utils/currency.js";

export interface CurrencyInputResult {
  currency?: string;
  cancelled: boolean;
}

async function safeDeleteMessage(ctx: BaseBotContext): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // The callback message may already be gone.
  }
}

function customCurrencyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("返回币种选择", "addcurrency:back")
    .text("取消", "addcurrency:cancel");
}

export async function collectCurrencyInput(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  {
    prompt = "请选择币种，或点“其他”输入代码。",
    hasPrice,
    cancelMessage = "已取消。",
  }: {
    prompt?: string;
    hasPrice: boolean;
    cancelMessage?: string;
  },
): Promise<CurrencyInputResult> {
  while (true) {
    await ctx.reply(prompt, {
      reply_markup: currencyKeyboard(hasPrice),
    });

    const currencyCtx = await conversation.wait();
    if (currencyCtx.message?.text) {
      if (isCancelInput(currencyCtx.message.text)) {
        await ctx.reply(cancelMessage);
        return { cancelled: true };
      }
      await ctx.reply("请点击按钮选择币种，或发送 /cancel 退出。");
      continue;
    }
    const currencyCallbackData = currencyCtx.callbackQuery?.data;
    if (!currencyCallbackData?.startsWith("addcurrency:")) {
      continue;
    }
    const parsedCurrency = parseAddCurrencyCallbackData(currencyCallbackData);

    if (!parsedCurrency) {
      await currencyCtx.answerCallbackQuery("无效的币种选择。");
      continue;
    }

    await currencyCtx.answerCallbackQuery();

    if (parsedCurrency.action === "cancel") {
      await safeDeleteMessage(currencyCtx);
      await ctx.reply(cancelMessage);
      return { cancelled: true };
    }

    if (parsedCurrency.action === "skip") {
      if (hasPrice) {
        await ctx.reply("已填写价格时必须选择币种。");
        continue;
      }
      await safeDeleteMessage(currencyCtx);
      return { currency: undefined, cancelled: false };
    }

    if (parsedCurrency.action === "other") {
      await safeDeleteMessage(currencyCtx);
      await ctx.reply("请输入 3 位币种代码，例如 CNY 或 USD。", {
        reply_markup: customCurrencyKeyboard(),
      });

      while (true) {
        const customCurrencyCtx = await conversation.wait();

        if (customCurrencyCtx.message?.text) {
          const customCurrencyText = customCurrencyCtx.message.text;
          if (isCancelInput(customCurrencyText)) {
            await ctx.reply(cancelMessage);
            return { cancelled: true };
          }
          const result = validateCurrencyInput(customCurrencyText, hasPrice);
          if (result.error || !result.currency) {
            await ctx.reply(
              (result.error ?? "请输入有效的币种代码。") +
                "\n请留在当前步骤重新输入。",
            );
            continue;
          }
          return { currency: result.currency, cancelled: false };
        }

        if (!customCurrencyCtx.callbackQuery?.data) continue;
        const customParsed = parseAddCurrencyCallbackData(
          customCurrencyCtx.callbackQuery.data,
        );

        if (!customParsed) {
          await customCurrencyCtx.answerCallbackQuery("无效的币种选择。");
          continue;
        }

        if (customParsed.action === "back") {
          await customCurrencyCtx.answerCallbackQuery();
          await safeDeleteMessage(customCurrencyCtx);
          break;
        }

        if (customParsed.action === "cancel") {
          await customCurrencyCtx.answerCallbackQuery();
          await safeDeleteMessage(customCurrencyCtx);
          await ctx.reply(cancelMessage);
          return { cancelled: true };
        }

        await customCurrencyCtx.answerCallbackQuery("请发送自定义币种代码。");
      }

      continue;
    }

    if (parsedCurrency.action === "back") {
      await safeDeleteMessage(currencyCtx);
      continue;
    }

    await safeDeleteMessage(currencyCtx);
    return { currency: parsedCurrency.currency, cancelled: false };
  }
}
