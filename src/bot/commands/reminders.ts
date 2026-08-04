import { InlineKeyboard } from "grammy";
import type { InputRichMessage } from "grammy/types";
import type { BotContext } from "../../types/context.js";
import { createSubscriptionService } from "../../services/subscriptionService.js";
import { createSubscriptionRepository } from "../../repositories/subscriptionRepository.js";
import { createReminderRepository } from "../../repositories/reminderRepository.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { createLogger } from "../../utils/logger.js";
import { addDays, formatDate, getLocalTimeInfo } from "../../utils/date.js";
import { Env } from "../../types/env.js";
import { emptyRemindersKeyboard } from "../ui/navigation.js";
import { richTableCell, sendRichOrPlain } from "../ui/richMessage.js";

function getReminderDaysAhead(env: Env): number {
  const raw = env.REMINDER_DAYS_AHEAD;
  if (raw === undefined || raw === null) return 3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 3;
  return Math.floor(parsed);
}

export async function remindersCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.userKey) {
    await ctx.reply("无法识别用户，请稍后再试。");
    logger.warn("Reminders command without userKey");
    return;
  }

  const userRepo = createUserRepository(ctx.env.SUBSCRIPTION_KV);
  const settings = await userRepo.getUserSettings(
    ctx.userKey,
    ctx.env.ENCRYPTION_KEY,
  );
  const local = getLocalTimeInfo(settings.timezone || "UTC");
  const today = local?.date ?? formatDate(new Date());

  const daysAhead = getReminderDaysAhead(ctx.env);
  const maxDate = addDays(today, daysAhead);

  const subRepo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);
  const reminderRepo = createReminderRepository(ctx.env.SUBSCRIPTION_KV);
  const service = createSubscriptionService(subRepo, reminderRepo);

  const subs = await service.list(ctx.userKey, ctx.env.ENCRYPTION_KEY);

  const upcoming = subs
    .filter((sub) => sub.status !== "paused")
    .filter(
      (sub) => sub.nextBillingDate >= today && sub.nextBillingDate <= maxDate,
    )
    .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate));

  if (upcoming.length === 0) {
    await ctx.reply("近期没有即将扣款的订阅。", {
      reply_markup: emptyRemindersKeyboard(),
    });
    logger.info("Reminders command: no upcoming renewals");
    return;
  }

  const lines = upcoming.map((sub) => {
    const priceStr =
      sub.price !== undefined && sub.currency
        ? `${sub.price} ${sub.currency}`
        : sub.price !== undefined
          ? `${sub.price}`
          : "";
    const parts = [sub.name, priceStr, `扣款日 ${sub.nextBillingDate}`].filter(
      Boolean,
    );
    return parts.join(" — ");
  });

  const keyboard = new InlineKeyboard();
  for (const sub of upcoming.slice(0, 8)) {
    if (sub.billingCycle !== "custom") {
      keyboard
        .text(
          `✅ ${truncateButtonLabel(sub.name)} 已续费`,
          `reminder:renew:${sub.id}:${sub.nextBillingDate}`,
        )
        .success()
        .row();
    }
  }
  keyboard
    .text("📋 管理订阅", "nav:list")
    .primary()
    .text("⚙️ 提醒设置", "nav:settings");

  const richMessage: InputRichMessage = {
    blocks: [
      { type: "heading", size: 1, text: "近期扣款" },
      {
        type: "paragraph",
        text: `${today} 至 ${maxDate}，共 ${upcoming.length} 项`,
      },
      {
        type: "table",
        is_bordered: true,
        is_striped: true,
        cells: [
          [
            richTableCell("日期", { header: true }),
            richTableCell("订阅", { header: true }),
            richTableCell("金额", { header: true, align: "right" }),
          ],
          ...upcoming.map((sub) => [
            richTableCell(sub.nextBillingDate),
            richTableCell(sub.name),
            richTableCell(formatPrice(sub.price, sub.currency), {
              align: "right" as const,
            }),
          ]),
        ],
      },
    ],
  };
  const richResult = await sendRichOrPlain(ctx, {
    richMessage,
    plainText: "近期扣款订阅：\n\n" + lines.join("\n"),
    replyMarkup: keyboard,
  });
  if (richResult.fallbackErrorType) {
    logger.warn("Rich reminders unavailable; sent plain fallback", {
      errorType: richResult.fallbackErrorType,
    });
  }

  logger.info("Reminders command: listed upcoming renewals", {
    count: upcoming.length,
  });
}

function formatPrice(price: number | undefined, currency?: string): string {
  if (price === undefined) return "—";
  return currency ? `${price} ${currency}` : String(price);
}

function truncateButtonLabel(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}
