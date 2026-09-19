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
    .text("Back to currencies", "addcurrency:back")
    .text("Cancel", "addcurrency:cancel");
}

export async function collectCurrencyInput(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  {
    prompt = "Choose a currency, or select “Other” to enter a code.",
    hasPrice,
    cancelMessage = "Cancelled.",
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
      await ctx.reply(
        "Choose a currency using the buttons, or send /cancel to exit.",
      );
      continue;
    }
    const currencyCallbackData = currencyCtx.callbackQuery?.data;
    if (!currencyCallbackData?.startsWith("addcurrency:")) {
      continue;
    }
    const parsedCurrency = parseAddCurrencyCallbackData(currencyCallbackData);

    if (!parsedCurrency) {
      await currencyCtx.answerCallbackQuery("Invalid currency selection.");
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
        await ctx.reply("A currency is required when a price is set.");
        continue;
      }
      await safeDeleteMessage(currencyCtx);
      return { currency: undefined, cancelled: false };
    }

    if (parsedCurrency.action === "other") {
      await safeDeleteMessage(currencyCtx);
      await ctx.reply("Enter a 3-letter currency code, such as CNY or USD.", {
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
              (result.error ?? "Enter a valid currency code.") +
                "\nPlease try again at this step.",
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
          await customCurrencyCtx.answerCallbackQuery(
            "Invalid currency selection.",
          );
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

        await customCurrencyCtx.answerCallbackQuery(
          "Enter a custom currency code.",
        );
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
