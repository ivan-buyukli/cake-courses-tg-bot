import { Conversation } from "@grammyjs/conversations";
import { BotContext, BaseBotContext } from "../../types/context.js";
import { createLogger } from "../../utils/logger.js";
import { InlineKeyboard } from "grammy";
import {
  UserSettings,
  SUPPORTED_TIMEZONES,
} from "../../models/userSettings.js";
import { createUserRepository } from "../../repositories/userRepository.js";
import { parseSettingsCallbackData } from "../../utils/callbackParser.js";
import { isCancelInput } from "../../utils/conversationInput.js";
import { normalizeUtcOffset } from "../../models/userSettings.js";
import { collectCurrencyInput } from "./currencyInput.js";
import {
  forceReply,
  hideMainMenu,
  restoreMainMenu,
} from "../ui/conversationUi.js";
import { privacyActionsKeyboard } from "../ui/navigation.js";
import { privacyDeleteKeyboard } from "../keyboards/privacyDeleteKeyboard.js";
import { exportCommand } from "../commands/export.js";

export function settingsKeyboard(settings: UserSettings): InlineKeyboard {
  const reminderLabel = settings.reminderEnabled ? "开启" : "关闭";
  const hourLabel = String(settings.reminderHour).padStart(2, "0") + ":00";

  return new InlineKeyboard()
    .text(`报告币种：${settings.defaultCurrency}`, "settings:currency")
    .primary()
    .row()
    .text(`提醒：${reminderLabel}`, "settings:toggle_reminder")
    .row()
    .text(`提醒时间：${hourLabel}`, "settings:hour")
    .row()
    .text(`时区：${settings.timezone}`, "settings:timezone")
    .row()
    .text("🔐 隐私与数据", "settings:privacy")
    .row()
    .text("✅ 完成", "settings:done")
    .success();
}

export function hourPickerKeyboard(currentHour?: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (let h = 0; h < 24; h++) {
    const label = String(h).padStart(2, "0");
    keyboard.text(
      currentHour === h ? `* ${label}` : label,
      `settings:hour:${h}`,
    );
    if ((h + 1) % 8 === 0) keyboard.row();
  }

  keyboard.text("返回", "settings:back").text("取消", "settings:cancel");
  return keyboard;
}

export function timezoneKeyboard(currentTimezone?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  SUPPORTED_TIMEZONES.forEach((tz, index) => {
    const label = tz.iana === currentTimezone ? `* ${tz.label}` : tz.label;
    keyboard.text(label, `settings:tz:${tz.iana}`);
    if (index % 2 === 1) keyboard.row();
  });

  keyboard.text("自定义时区偏移", "settings:tzoffset");
  keyboard.row().text("返回", "settings:back").text("取消", "settings:cancel");
  return keyboard;
}

export function timezoneOffsetKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("UTC+5:30", "settings:tzoffset:+5:30")
    .text("UTC+5:45", "settings:tzoffset:+5:45")
    .row()
    .text("UTC+9:30", "settings:tzoffset:+9:30")
    .text("UTC+10", "settings:tzoffset:+10")
    .row()
    .text("UTC-3", "settings:tzoffset:-3")
    .text("其他", "settings:tzoffset:other")
    .row()
    .text("返回", "settings:tzoffset:back")
    .text("取消", "settings:cancel");
}

export async function settingsConversation(
  conversation: Conversation<BotContext, BaseBotContext>,
  ctx: BaseBotContext,
): Promise<void> {
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
  await hideMainMenu(ctx, "正在调整设置。可随时发送 /cancel 或“取消”退出。");

  let settings = await conversation.external(async (outsideCtx) => {
    const repo = createUserRepository(outsideCtx.env.SUBSCRIPTION_KV);
    return repo.getUserSettings(userKey, encryptionKey);
  });

  logger.info("Settings conversation started");

  let menuMessage = await ctx.reply("⚙️ 设置", {
    reply_markup: settingsKeyboard(settings),
  });

  while (true) {
    const updateCtx = await conversation.wait();

    if (updateCtx.message?.text) {
      const text = updateCtx.message.text;
      if (isCancelInput(text)) {
        await ctx.reply("已取消。");
        await restoreMainMenu(ctx);
        return;
      }
      continue;
    }

    if (!updateCtx.callbackQuery?.data) continue;

    const callbackData = updateCtx.callbackQuery.data;

    if (callbackData === "settings:privacy") {
      await updateCtx.answerCallbackQuery();
      try {
        await updateCtx.editMessageText(
          "🔐 隐私与数据\n\n你可以下载个人数据副本，或永久删除全部数据。",
          { reply_markup: privacyActionsKeyboard() },
        );
      } catch {
        menuMessage = await ctx.reply(
          "🔐 隐私与数据\n\n你可以下载个人数据副本，或永久删除全部数据。",
          { reply_markup: privacyActionsKeyboard() },
        );
      }
      continue;
    }

    if (callbackData === "settings:export") {
      await updateCtx.answerCallbackQuery("正在准备导出文件…");
      await conversation.external(async (outsideCtx) => {
        await exportCommand(outsideCtx);
      });
      continue;
    }

    if (callbackData === "settings:delete") {
      await updateCtx.answerCallbackQuery();
      try {
        await updateCtx.editMessageText(
          "⚠️ 确认删除全部数据？\n\n这将永久删除所有订阅、提醒和个人设置，且无法恢复。",
          { reply_markup: privacyDeleteKeyboard() },
        );
      } catch {
        await ctx.reply(
          "⚠️ 确认删除全部数据？\n\n这将永久删除所有订阅、提醒和个人设置，且无法恢复。",
          { reply_markup: privacyDeleteKeyboard() },
        );
      }
      await restoreMainMenu(ctx);
      return;
    }

    const parsed = parseSettingsCallbackData(callbackData);

    if (parsed) {
      await updateCtx.answerCallbackQuery();

      if (parsed.action === "done") {
        try {
          await ctx.api.editMessageText(
            menuMessage.chat.id,
            menuMessage.message_id,
            "⚙️ 设置\n\n设置已更新。",
          );
        } catch {
          await ctx.reply("设置已更新。");
        }
        logger.info("Settings conversation completed");
        await restoreMainMenu(ctx, "设置已保存，主菜单已恢复。");
        return;
      }

      if (parsed.action === "back") {
        try {
          await updateCtx.editMessageText("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        } catch {
          menuMessage = await ctx.reply("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        }
        continue;
      }

      if (parsed.action === "cancel") {
        try {
          await updateCtx.editMessageText("已取消设置操作。");
        } catch {
          await ctx.reply("已取消设置操作。");
        }
        await restoreMainMenu(ctx);
        return;
      }

      if (parsed.action === "toggle_reminder") {
        settings = {
          ...settings,
          reminderEnabled: !settings.reminderEnabled,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: settingsKeyboard(settings),
          });
        } catch {
          await ctx.reply("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        }
        continue;
      }

      if (parsed.action === "hour") {
        await updateCtx.editMessageReplyMarkup({
          reply_markup: hourPickerKeyboard(settings.reminderHour),
        });
        continue;
      }

      if (parsed.action === "select_hour") {
        settings = {
          ...settings,
          reminderHour: parsed.hour,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: settingsKeyboard(settings),
          });
        } catch {
          await ctx.reply("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        }
        continue;
      }

      if (parsed.action === "timezone") {
        await updateCtx.editMessageReplyMarkup({
          reply_markup: timezoneKeyboard(settings.timezone),
        });
        continue;
      }

      if (parsed.action === "select_timezone") {
        settings = {
          ...settings,
          timezone: parsed.timezone,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: settingsKeyboard(settings),
          });
        } catch {
          await ctx.reply("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        }
        continue;
      }

      if (parsed.action === "timezone_offset_menu") {
        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: timezoneOffsetKeyboard(),
          });
        } catch {
          await ctx.reply("请选择 UTC 偏移，或点“其他”输入。", {
            reply_markup: timezoneOffsetKeyboard(),
          });
        }
        continue;
      }

      if (parsed.action === "timezone_offset") {
        const normalized = normalizeUtcOffset(parsed.offset);
        if (!normalized) {
          await ctx.reply("无效的偏移。请使用 +8、-5、+5:30 这样的格式。");
          continue;
        }

        settings = {
          ...settings,
          timezone: normalized,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: settingsKeyboard(settings),
          });
        } catch {
          await ctx.reply("⚙️ 设置", {
            reply_markup: settingsKeyboard(settings),
          });
        }
        continue;
      }

      if (parsed.action === "timezone_offset_other") {
        try {
          await updateCtx.editMessageText(
            "请输入 UTC 偏移，例如 +8、-5、+5:30。",
          );
        } catch {
          await ctx.reply("请输入 UTC 偏移，例如 +8、-5、+5:30。");
        }

        let normalized: string | null = null;
        while (!normalized) {
          const customTzCtx = await conversation.waitFor("message:text");
          const customTzText = customTzCtx.msg.text;
          if (isCancelInput(customTzText)) {
            await ctx.reply("已取消。");
            await restoreMainMenu(ctx);
            return;
          }
          normalized = normalizeUtcOffset(customTzText);
          if (!normalized) {
            await ctx.reply(
              "无效的偏移。请使用 +8、-5、+5:30 这样的格式并重新输入。",
              { reply_markup: forceReply("例如 +8 或 +5:30") },
            );
          }
        }

        settings = {
          ...settings,
          timezone: normalized,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        menuMessage = await ctx.reply("⚙️ 设置", {
          reply_markup: settingsKeyboard(settings),
        });
        continue;
      }

      if (parsed.action === "timezone_offset_back") {
        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: timezoneKeyboard(settings.timezone),
          });
        } catch {
          await ctx.reply("⚙️ 设置", {
            reply_markup: timezoneKeyboard(settings.timezone),
          });
        }
        continue;
      }

      continue;
    }

    // Handle "currency" action: show currency picker
    if (callbackData === "settings:currency") {
      await updateCtx.answerCallbackQuery();
      const selectedCurrency = await collectCurrencyInput(conversation, ctx, {
        prompt: "请选择默认币种：",
        hasPrice: true,
      });
      if (selectedCurrency.cancelled || !selectedCurrency.currency) {
        await restoreMainMenu(ctx);
        return;
      }

      settings = {
        ...settings,
        defaultCurrency: selectedCurrency.currency,
      };
      await saveSettings(conversation, userKey, settings, encryptionKey);

      menuMessage = await ctx.reply("⚙️ 设置", {
        reply_markup: settingsKeyboard(settings),
      });
      continue;
    }

    // Handle "back" from sub-menus
    if (callbackData === "settings:back") {
      await updateCtx.answerCallbackQuery();

      try {
        await updateCtx.editMessageReplyMarkup({
          reply_markup: settingsKeyboard(settings),
        });
      } catch {
        await ctx.reply("⚙️ 设置", {
          reply_markup: settingsKeyboard(settings),
        });
      }
      continue;
    }

    // Handle stale addcurrency callbacks from shared currency keyboard
    if (callbackData.startsWith("addcurrency:")) {
      await updateCtx.answerCallbackQuery(
        "This selection is no longer active. Use /settings to restart.",
      );
      continue;
    }

    await updateCtx.answerCallbackQuery();
  }
}

async function saveSettings(
  conversation: Conversation<BotContext, BaseBotContext>,
  userKey: string,
  settings: UserSettings,
  encryptionKey: string,
): Promise<void> {
  await conversation.external(async (outsideCtx) => {
    const repo = createUserRepository(outsideCtx.env.SUBSCRIPTION_KV);
    await repo.updateUserSettings(userKey, settings, encryptionKey);
  });
}
