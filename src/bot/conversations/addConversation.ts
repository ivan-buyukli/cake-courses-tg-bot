import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import {
  Subscription,
  BillingCycle,
  BillingInterval,
} from "../../models/subscription.js";
import { shortId } from "../../utils/shortId.js";
import { createLogger } from "../../utils/logger.js";
import { InlineKeyboard } from "grammy";
import {
  parseAddConfirmCallbackData,
  parseAddPriceCallbackData,
  parseCycleCallbackData,
} from "../../utils/callbackParser.js";
import { formatBillingCycle } from "../../utils/labels.js";
import { getBillingAnchorDay, getNextBillingDate } from "../../utils/date.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { collectDateInput } from "./dateInput.js";
import { collectCurrencyInput } from "./currencyInput.js";
import { collectCycleInput, CycleSelection } from "./cycleInput.js";
import { binaryActionKeyboard } from "../keyboards/confirmationKeyboard.js";
import {
  SETTINGS_ONBOARDING_MESSAGE,
  shouldShowSettingsOnboarding,
} from "../onboarding/settingsOnboarding.js";
import {
  forceReply,
  hideMainMenu,
  restoreMainMenu,
} from "../ui/conversationUi.js";
import { postAddKeyboard } from "../ui/navigation.js";

// TODO: grammY conversations do not have built-in timeout handling.
// If a user starts /add and never completes it, the conversation waits
// indefinitely until the isolate is recycled or the user sends /cancel.
// On Cloudflare Workers, isolates may be evicted after a period of
// inactivity, which implicitly ends conversations. For MVP this is
// acceptable; a future enhancement could track conversation start
// timestamps and auto-exit stale ones.

export function validateAddName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "订阅名称不能为空。";
  return null;
}

export function validateAddPrice(priceStr: string): {
  price?: number;
  error?: string;
} {
  const trimmed = priceStr.trim().toLowerCase();
  if (trimmed === "skip" || trimmed === "") {
    return { price: undefined };
  }
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price < 0) {
    return { error: "请输入非负数字，或点击按钮跳过。" };
  }
  return { price };
}

function confirmKeyboard(): InlineKeyboard {
  return binaryActionKeyboard({
    confirmData: "add:confirm",
    cancelData: "add:cancel",
    confirmStyle: "success",
  });
}

function priceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("跳过价格", "addprice:skip")
    .text("取消", "addprice:cancel");
}

function reviewKeyboard(price?: number): InlineKeyboard {
  const keyboard = confirmKeyboard()
    .row()
    .text("自动续费", "add:toggle_autorenew")
    .text("体验", "add:toggle_trial")
    .row()
    .text("名称", "add:edit_name")
    .primary()
    .text("价格", "add:edit_price")
    .primary()
    .row();

  if (price !== undefined) {
    keyboard.text("币种", "add:edit_currency").primary();
  }

  return keyboard
    .text("周期", "add:edit_cycle")
    .primary()
    .row()
    .text("日期", "add:edit_date")
    .primary();
}

export function resolveAddCurrencyForPrice(
  price: number | undefined,
  explicitDefaultCurrency?: string,
): { currency?: string; shouldAskCurrency: boolean } {
  if (price === undefined) {
    return { currency: undefined, shouldAskCurrency: false };
  }
  if (explicitDefaultCurrency) {
    return {
      currency: explicitDefaultCurrency,
      shouldAskCurrency: false,
    };
  }
  return { currency: undefined, shouldAskCurrency: true };
}

function buildReviewMessage(draft: AddDraft): string {
  const lines = [
    "请确认订阅信息：",
    `名称：${draft.name}`,
    draft.price !== undefined
      ? `价格：${draft.price} ${draft.currency ?? ""}`.trim()
      : "价格：未填写",
    `周期：${formatBillingCycle(draft.cycle, draft.billingInterval)}`,
    `类型：${draft.isTrial ? "体验" : "付费"}`,
    `自动续费：${draft.autoRenew ? "是" : "否"}`,
    `${draft.isTrial ? "体验到期/首次扣款" : draft.autoRenew ? "下次扣款" : "服务到期"}：${draft.nextBillingDate}`,
    "",
    formatBillingDatePreview(
      draft.nextBillingDate,
      draft.cycle,
      draft.billingInterval,
    ),
  ];

  return lines.join("\n");
}

interface AddDraft {
  name: string;
  price?: number;
  currency?: string;
  cycle: BillingCycle;
  billingInterval?: BillingInterval;
  nextBillingDate: string;
  isTrial: boolean;
  autoRenew: boolean;
}

export function buildBillingDatePreview(
  nextBillingDate: string,
  billingCycle: BillingCycle,
  billingAnchorDay = getBillingAnchorDay(nextBillingDate),
  count = 5,
  billingInterval?: BillingInterval,
): string[] {
  const dates = [nextBillingDate];
  let currentDate = nextBillingDate;

  while (dates.length < count) {
    const nextDate = getNextBillingDate(
      currentDate,
      billingCycle,
      billingAnchorDay,
      billingInterval,
    );
    if (!nextDate) break;
    dates.push(nextDate);
    currentDate = nextDate;
  }

  return dates;
}

export function formatBillingDatePreview(
  nextBillingDate: string,
  billingCycle: BillingCycle,
  billingInterval?: BillingInterval,
): string {
  const dates = buildBillingDatePreview(
    nextBillingDate,
    billingCycle,
    getBillingAnchorDay(nextBillingDate),
    5,
    billingInterval,
  );
  const cycleLabel = formatBillingCycle(billingCycle, billingInterval);
  const lines = [
    `周期：${cycleLabel}`,
    "未来扣款日期预览：",
    ...dates.map((date, index) => `${index + 1}. ${date}`),
  ];

  if (billingCycle === "custom") {
    lines.push("自定义周期不会自动推进，请之后手动修改下次扣款日期。");
  }

  return lines.join("\n");
}

async function safeDeleteMessage(ctx: BaseBotContext): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // The callback message may already be gone.
  }
}

async function safeDeletePromptMessage(
  ctx: BaseBotContext,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // The prompt message may already be gone.
  }
}

async function collectCurrencyForPrice(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  price: number | undefined,
  explicitDefaultCurrency?: string,
): Promise<{ currency?: string; cancelled: boolean }> {
  const resolved = resolveAddCurrencyForPrice(price, explicitDefaultCurrency);
  if (!resolved.shouldAskCurrency) {
    return { currency: resolved.currency, cancelled: false };
  }

  return collectCurrencyInput(conversation, ctx, {
    hasPrice: true,
  });
}

async function collectName(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
  prompt: string,
): Promise<string | null> {
  await ctx.reply(prompt, { reply_markup: forceReply("输入订阅名称") });
  while (true) {
    const nameCtx = await conversation.waitFor("message:text");
    const nameText = nameCtx.msg.text;
    if (isCancelInput(nameText)) {
      await ctx.reply("已取消。");
      return null;
    }
    const nameError = validateAddName(nameText);
    if (nameError) {
      await ctx.reply(nameError + "\n请在当前步骤重新输入。", {
        reply_markup: forceReply("输入订阅名称"),
      });
      continue;
    }
    return nameText.trim();
  }
}

async function collectPrice(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
): Promise<{ price?: number; cancelled: boolean }> {
  const promptMsg = await ctx.reply(
    "价格是多少？请输入数字，或点击按钮跳过。",
    {
      reply_markup: priceKeyboard(),
    },
  );

  while (true) {
    const priceCtx = await conversation.wait();

    if (priceCtx.message?.text) {
      const priceText = priceCtx.message.text;
      if (isCancelInput(priceText)) {
        await safeDeletePromptMessage(
          ctx,
          promptMsg.chat.id,
          promptMsg.message_id,
        );
        await ctx.reply("已取消。");
        return { cancelled: true };
      }
      const priceResult = validateAddPrice(priceText);
      if (priceResult.error) {
        await ctx.reply(priceResult.error + "\n请在当前步骤重新输入。", {
          reply_markup: forceReply("输入价格，或发送 skip"),
        });
        continue;
      }
      await safeDeletePromptMessage(
        ctx,
        promptMsg.chat.id,
        promptMsg.message_id,
      );
      return { price: priceResult.price, cancelled: false };
    }

    if (!priceCtx.callbackQuery?.data) continue;
    const parsedPrice = parseAddPriceCallbackData(priceCtx.callbackQuery.data);
    if (!parsedPrice) {
      await priceCtx.answerCallbackQuery("无效的价格选择。");
      continue;
    }

    await priceCtx.answerCallbackQuery();
    await safeDeleteMessage(priceCtx);

    if (parsedPrice.action === "cancel") {
      await ctx.reply("已取消。");
      return { cancelled: true };
    }

    return { price: undefined, cancelled: false };
  }
}

async function collectCycle(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
): Promise<CycleSelection | null> {
  return collectCycleInput(conversation, ctx, {
    callbackPattern: /^cycle:/,
    callbackData: (cycle) => `cycle:${cycle}`,
    parseCycle: (callbackData) =>
      parseCycleCallbackData(callbackData)?.cycle ?? null,
    invalidSelectionMessage: "请点击按钮选择扣款周期，或点击取消。",
    cancelData: "cycle:cancel",
  });
}

async function collectDate(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
): Promise<string | null> {
  return collectDateInput(conversation, ctx, "请选择或输入下次扣款日期：");
}

export async function addConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
): Promise<void> {
  // grammY conversations create fresh context objects that do not inherit
  // custom properties from outside middleware. We must read userKey, env,
  // and requestId via conversation.external() which gives us access to the
  // outside context from the current middleware pass.
  const ctxData = await conversation.external((outsideCtx) => ({
    userKey: outsideCtx.userKey ?? null,
    encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
    requestId: outsideCtx.requestId,
  }));

  if (!ctxData.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  const logger = createLogger(ctxData.requestId);
  await hideMainMenu(ctx, "开始添加订阅。可随时发送 /cancel 或“取消”退出。");

  const settingsOnboarding = await conversation.external(async (outsideCtx) => {
    const repo = createUserRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const profile = await repo.getUserProfile(userKey, encryptionKey);

    return {
      explicitDefaultCurrency: profile?.settings?.defaultCurrency,
      shouldShow: !profile?.settings,
    };
  });
  const explicitDefaultCurrency = settingsOnboarding.explicitDefaultCurrency;

  async function getLatestSettingsOnboarding(): Promise<boolean> {
    return conversation.external(async (outsideCtx) => {
      const repo = createUserRepository(outsideCtx.env.SUBSCRIPTION_KV);
      return shouldShowSettingsOnboarding(repo, userKey, encryptionKey);
    });
  }

  const name = await collectName(conversation, ctx, "订阅名称是什么？");
  if (!name) {
    await restoreMainMenu(ctx);
    return;
  }

  const priceSelection = await collectPrice(conversation, ctx);
  if (priceSelection.cancelled) {
    await restoreMainMenu(ctx);
    return;
  }

  const currencySelection = await collectCurrencyForPrice(
    conversation,
    ctx,
    priceSelection.price,
    explicitDefaultCurrency,
  );
  if (currencySelection.cancelled) {
    await restoreMainMenu(ctx);
    return;
  }

  const cycleSelection = await collectCycle(conversation, ctx);
  if (!cycleSelection) {
    await restoreMainMenu(ctx);
    return;
  }

  const dateSelection = await collectDate(conversation, ctx);
  if (!dateSelection) {
    await restoreMainMenu(ctx);
    return;
  }

  const draft: AddDraft = {
    name,
    price: priceSelection.price,
    currency: currencySelection.currency,
    cycle: cycleSelection.cycle,
    billingInterval: cycleSelection.billingInterval,
    nextBillingDate: dateSelection,
    isTrial: false,
    autoRenew: true,
  };

  const reviewMessage = await ctx.reply(buildReviewMessage(draft), {
    reply_markup: reviewKeyboard(draft.price),
  });

  while (true) {
    const reviewCtx = await conversation.waitForCallbackQuery(/^add:/);
    const parsedReview = parseAddConfirmCallbackData(
      reviewCtx.callbackQuery.data,
    );
    await reviewCtx.answerCallbackQuery();

    if (!parsedReview) {
      await ctx.reply("无效的选择，请重新确认。");
      continue;
    }

    if (parsedReview.action === "cancel") {
      await safeEditReviewMessage(
        ctx,
        reviewMessage.chat.id,
        reviewMessage.message_id,
        "已取消添加订阅。",
      );
      await restoreMainMenu(ctx);
      logger.info("Add conversation cancelled at review");
      return;
    }

    if (parsedReview.action === "confirm") {
      break;
    }

    if (parsedReview.action === "toggle_trial") {
      draft.isTrial = !draft.isTrial;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "toggle_autorenew") {
      draft.autoRenew = !draft.autoRenew;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "edit_name") {
      const updatedName = await collectName(
        conversation,
        ctx,
        "请发送新的订阅名称：",
      );
      if (!updatedName) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.name = updatedName;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "edit_price") {
      const updatedPrice = await collectPrice(conversation, ctx);
      if (updatedPrice.cancelled) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.price = updatedPrice.price;
      const updatedCurrency = await collectCurrencyForPrice(
        conversation,
        ctx,
        draft.price,
        explicitDefaultCurrency,
      );
      if (updatedCurrency.cancelled) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.currency = updatedCurrency.currency;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "edit_currency") {
      if (draft.price === undefined) {
        await ctx.reply("未填写价格时不需要币种。");
        draft.currency = undefined;
        await refreshReviewMessage(ctx, reviewMessage, draft);
        continue;
      }
      const updatedCurrency = await collectCurrencyInput(conversation, ctx, {
        hasPrice: true,
      });
      if (updatedCurrency.cancelled) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.currency = updatedCurrency.currency;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "edit_cycle") {
      const updatedCycle = await collectCycle(conversation, ctx);
      if (!updatedCycle) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.cycle = updatedCycle.cycle;
      draft.billingInterval = updatedCycle.billingInterval;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    if (parsedReview.action === "edit_date") {
      const updatedDate = await collectDate(conversation, ctx);
      if (!updatedDate) {
        await restoreMainMenu(ctx);
        return;
      }
      draft.nextBillingDate = updatedDate;
      await refreshReviewMessage(ctx, reviewMessage, draft);
      continue;
    }

    await refreshReviewMessage(ctx, reviewMessage, draft);
  }

  // Save
  const now = new Date().toISOString();
  const sub: Subscription = {
    id: crypto.randomUUID(),
    name: draft.name,
    price: draft.price,
    currency: draft.currency,
    billingCycle: draft.cycle,
    billingInterval: draft.billingInterval,
    nextBillingDate: draft.nextBillingDate,
    billingAnchorDay: getBillingAnchorDay(draft.nextBillingDate),
    status: "active",
    isTrial: draft.isTrial,
    autoRenew: draft.autoRenew,
    createdAt: now,
    updatedAt: now,
  };

  await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const reminderRepo = createReminderRepository(
      outsideCtx.env.SUBSCRIPTION_KV,
    );
    const service = createSubscriptionService(repo, reminderRepo);
    await service.create(userKey, sub, encryptionKey);
  });

  logger.info("Subscription created via conversation", {
    subId: sub.id,
    shortId: shortId(sub.id),
  });

  await safeEditReviewMessage(
    ctx,
    reviewMessage.chat.id,
    reviewMessage.message_id,
    `✅ 已添加“${draft.name}”。\n短 ID：${shortId(sub.id)}`,
    postAddKeyboard(),
  );
  await restoreMainMenu(ctx, "添加完成，主菜单已恢复。");

  if (settingsOnboarding.shouldShow && (await getLatestSettingsOnboarding())) {
    await ctx.reply(SETTINGS_ONBOARDING_MESSAGE);
  }
}

async function refreshReviewMessage(
  ctx: BaseBotContext,
  message: { chat: { id: number }; message_id: number },
  draft: AddDraft,
): Promise<void> {
  await safeEditReviewMessage(
    ctx,
    message.chat.id,
    message.message_id,
    buildReviewMessage(draft),
    reviewKeyboard(draft.price),
  );
}

async function safeEditReviewMessage(
  ctx: BaseBotContext,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  try {
    await ctx.api.editMessageText(chatId, messageId, text, {
      reply_markup: replyMarkup,
    });
  } catch {
    await ctx.reply(text, { reply_markup: replyMarkup });
  }
}
