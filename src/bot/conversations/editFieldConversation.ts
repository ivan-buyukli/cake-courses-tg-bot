import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { BillingInterval, Subscription } from "../../models/subscription.js";
import type { ScalarEditableField } from "../../models/subscriptionEdit.js";
import { formatBillingCycle } from "../../utils/labels.js";
import { getBillingAnchorDay } from "../../utils/date.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { parseEditCycleCallbackData } from "../../utils/callbackParser.js";
import { formatReminderPolicy } from "../../utils/reminderPolicy.js";
import { collectDateInput } from "./dateInput.js";
import { collectCurrencyInput } from "./currencyInput.js";
import { collectCycleInput } from "./cycleInput.js";
import { forceReply, restoreMainMenu } from "../ui/conversationUi.js";
import {
  beginSubscriptionConversation,
  completeSubscriptionConversation,
  saveConversationSubscription,
  type ListManagerConversationOptions,
} from "./subscriptionConversation.js";
import {
  collectReminderPolicyInput,
  reminderPolicyKeyboard,
} from "./reminderPolicyInput.js";

// TODO: grammY conversations do not have built-in timeout handling.
// If a user starts an edit flow and never completes it, the conversation
// waits indefinitely until the isolate is recycled or the user sends /cancel.
// On Cloudflare Workers, isolates may be evicted after inactivity, which
// implicitly ends conversations. For MVP this is acceptable.

export function validateEditName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Subscription name cannot be empty.";
  return null;
}

export function validateEditPrice(priceStr: string): {
  price: number;
  error?: string;
} {
  const trimmed = priceStr.trim();
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price < 0) {
    return { price: 0, error: "Enter a non-negative number." };
  }
  return { price };
}

export async function editFieldConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  field: ScalarEditableField,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "Editing a subscription. Send /cancel or “Cancel” at any time to exit.",
  );
  if (!started) return;
  const { session, sub } = started;

  const fieldLabels: Record<ScalarEditableField, string> = {
    name: "Name",
    price: "Price",
    currency: "Currency",
    date: "Next billing date",
  };

  const promptMap: Record<ScalarEditableField, string> = {
    name: `Current name: ${sub.name}\nEnter the new name.`,
    price:
      sub.price !== undefined
        ? `Current price: ${sub.price}\nEnter the new price as a number.`
        : "No price is currently set.\nEnter the price as a number.",
    currency:
      sub.currency !== undefined
        ? `Current currency: ${sub.currency}\nChoose a new currency, or select “Other” to enter a code.`
        : "No currency is currently set.\nChoose a currency, or select “Other” to enter a code.",
    date: `Current next billing date: ${sub.nextBillingDate}\nChoose or enter a new date: `,
  };

  const now = new Date().toISOString();
  const updated = { ...sub, updatedAt: now };

  if (field === "name") {
    await ctx.reply(promptMap[field], {
      reply_markup: forceReply("Enter a new subscription name"),
    });
    while (true) {
      const inputCtx = await conversation.waitFor("message:text");
      const input = inputCtx.msg.text;
      if (isCancelInput(input)) {
        await ctx.reply("Cancelled.");
        await restoreMainMenu(ctx);
        return;
      }
      const error = validateEditName(input);
      if (error) {
        await ctx.reply(error + "\nPlease try again at this step.", {
          reply_markup: forceReply("Enter a new subscription name"),
        });
        continue;
      }
      updated.name = input.trim();
      break;
    }
  } else if (field === "price") {
    await ctx.reply(promptMap[field], {
      reply_markup: forceReply("Enter a new price"),
    });
    while (true) {
      const inputCtx = await conversation.waitFor("message:text");
      const input = inputCtx.msg.text;
      if (isCancelInput(input)) {
        await ctx.reply("Cancelled.");
        await restoreMainMenu(ctx);
        return;
      }
      const result = validateEditPrice(input);
      if (result.error) {
        await ctx.reply(result.error + "\nPlease try again at this step.", {
          reply_markup: forceReply("Enter a new price"),
        });
        continue;
      }
      updated.price = result.price;
      break;
    }
  } else if (field === "currency") {
    const selectedCurrency = await collectCurrencyInput(conversation, ctx, {
      prompt: promptMap[field],
      hasPrice: true,
    });
    if (selectedCurrency.cancelled || !selectedCurrency.currency) {
      await restoreMainMenu(ctx);
      return;
    }
    updated.currency = selectedCurrency.currency;
  } else if (field === "date") {
    const selectedDate = await collectDateInput(
      conversation,
      ctx,
      promptMap[field],
    );
    if (!selectedDate) {
      await restoreMainMenu(ctx);
      return;
    }
    updated.nextBillingDate = selectedDate;
    updated.billingAnchorDay = getBillingAnchorDay(selectedDate);
  }

  await saveConversationSubscription(conversation, session, updated);

  session.logger.info("Subscription field updated via conversation", {
    subId,
    field,
  });
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ Saved “${updated.name}”: ${fieldLabels[field]}.`,
    `Updated “${updated.name}”: ${fieldLabels[field]}.`,
  );
}

export async function editCycleConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "Editing the billing cycle. Send /cancel or “Cancel” at any time to exit.",
  );
  if (!started) return;
  const { session, sub } = started;

  const cycleSelection = await collectCycleInput(conversation, ctx, {
    prompt: "Choose a new billing cycle: ",
    callbackPattern: /^editcycle:/,
    callbackData: (cycle) => `editcycle:${cycle}:${subId}`,
    parseCycle: (callbackData) =>
      parseEditCycleCallbackData(callbackData)?.cycle ?? null,
    invalidSelectionMessage:
      "Choose a billing cycle using the buttons, or select Cancel.",
    cancelData: `editcycle:cancel:${subId}`,
  });
  if (!cycleSelection) {
    await restoreMainMenu(ctx);
    return;
  }

  const cycle = cycleSelection.cycle;
  const billingInterval: BillingInterval | undefined =
    cycleSelection.billingInterval;

  const now = new Date().toISOString();
  const updated = {
    ...sub,
    billingCycle: cycle,
    billingInterval,
    updatedAt: now,
  };

  await saveConversationSubscription(conversation, session, updated);

  session.logger.info("Subscription cycle updated via conversation", {
    subId,
    cycle,
  });
  const cycleLabel = formatBillingCycle(cycle, billingInterval);
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ Updated “${updated.name}”: billing cycle set to ${cycleLabel}.`,
    `Updated “${updated.name}”: billing cycle set to ${cycleLabel}.`,
  );
}

export async function editReminderConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  subId: string,
  options?: ListManagerConversationOptions,
): Promise<void> {
  const started = await beginSubscriptionConversation(
    conversation,
    ctx,
    subId,
    "Editing reminder preferences. Send /cancel or “Cancel” at any time to exit.",
  );
  if (!started) return;
  const { session, sub } = started;

  await ctx.reply(
    `Current reminder preference: ${formatReminderPolicy(sub)}\n\nChoose a new reminder preference: `,
    { reply_markup: reminderPolicyKeyboard(subId, sub.reminderPolicy) },
  );
  const reminderPolicy = await collectReminderPolicyInput(
    conversation,
    ctx,
    subId,
  );
  if (reminderPolicy === null) {
    await restoreMainMenu(ctx);
    return;
  }

  const updated: Subscription = {
    ...sub,
    reminderPolicy,
    updatedAt: new Date().toISOString(),
  };
  await saveConversationSubscription(conversation, session, updated);
  session.logger.info("Subscription reminder policy updated via conversation", {
    subId,
    policy: reminderPolicy?.mode ?? "inherit",
  });
  const policyLabel = formatReminderPolicy(updated);
  await completeSubscriptionConversation(
    ctx,
    updated,
    options,
    `✅ Updated “${updated.name}”: reminder preference set to ${policyLabel}.`,
    `Updated “${updated.name}”: reminder preference set to ${policyLabel}.`,
  );
}
