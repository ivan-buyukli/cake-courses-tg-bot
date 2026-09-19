import {
  sendRichOrPlain,
  editRichOrPlain,
  richTableCell,
  type MessagePresentation,
} from "../ui/richMessage.js";
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
  return new InlineKeyboard()
    .text("Report currency", "settings:currency")
    .primary()
    .text(
      settings.reminderEnabled ? "Disable reminders" : "Enable reminders",
      "settings:toggle_reminder",
    )
    .row()
    .text("Reminder time", "settings:hour")
    .text("Timezone", "settings:timezone")
    .row()
    .text("Privacy and data", "settings:privacy")
    .text("Done", "settings:done")
    .success();
}

export function settingsPresentation(
  settings: UserSettings,
): MessagePresentation {
  const fields = [
    ["Report currency", settings.defaultCurrency],
    ["Reminder", settings.reminderEnabled ? "On" : "Off"],
    ["Reminder time", `${String(settings.reminderHour).padStart(2, "0")}:00`],
    ["Timezone", settings.timezone],
  ];
  return {
    richMessage: {
      blocks: [
        { type: "paragraph", text: "Settings" },
        {
          type: "table",
          is_compact: true,
          is_bordered: true,
          cells: fields.map(([key, value]) => [
            richTableCell(key),
            richTableCell(value),
          ]),
        },
      ],
    },
    plainText: `Settings\n\n${fields.map(([key, value]) => `${key}: ${value}`).join("\n")}`,
    replyMarkup: settingsKeyboard(settings),
  };
}

async function sendSettings(ctx: BaseBotContext, settings: UserSettings) {
  const result = await sendRichOrPlain(ctx, settingsPresentation(settings));
  if (!result.message) throw new Error("Settings message unavailable");
  return result.message;
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

  keyboard.text("Back", "settings:back").text("Cancel", "settings:cancel");
  return keyboard;
}

export function timezoneKeyboard(currentTimezone?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  SUPPORTED_TIMEZONES.forEach((tz, index) => {
    const label = tz.iana === currentTimezone ? `* ${tz.label}` : tz.label;
    keyboard.text(label, `settings:tz:${tz.iana}`);
    if (index % 2 === 1) keyboard.row();
  });

  keyboard.text("Custom timezone offset", "settings:tzoffset");
  keyboard
    .row()
    .text("Back", "settings:back")
    .text("Cancel", "settings:cancel");
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
    .text("Other", "settings:tzoffset:other")
    .row()
    .text("Back", "settings:tzoffset:back")
    .text("Cancel", "settings:cancel");
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
    await ctx.reply("Unable to identify your account. Please try again later.");
    return;
  }

  const userKey = ctxData.userKey;
  const encryptionKey = ctxData.encryptionKey;
  const logger = createLogger(ctxData.requestId);
  await hideMainMenu(
    ctx,
    "Editing settings. Send /cancel or “Cancel” at any time to exit.",
  );

  let settings = await conversation.external(async (outsideCtx) => {
    const repo = createUserRepository(outsideCtx.env.SUBSCRIPTION_KV);
    return repo.getUserSettings(userKey, encryptionKey);
  });

  logger.info("Settings conversation started");

  let menuMessage = await sendSettings(ctx, settings);

  while (true) {
    const updateCtx = await conversation.wait();

    if (updateCtx.message?.text) {
      const text = updateCtx.message.text;
      if (isCancelInput(text)) {
        await ctx.reply("Cancelled.");
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
          "🔐 Privacy and data\n\nDownload a copy of your data, or permanently delete all your data.",
          { reply_markup: privacyActionsKeyboard() },
        );
      } catch {
        menuMessage = await ctx.reply(
          "🔐 Privacy and data\n\nDownload a copy of your data, or permanently delete all your data.",
          { reply_markup: privacyActionsKeyboard() },
        );
      }
      continue;
    }

    if (callbackData === "settings:export") {
      await updateCtx.answerCallbackQuery("Preparing your export…");
      await conversation.external(async (outsideCtx) => {
        await exportCommand(outsideCtx);
      });
      continue;
    }

    if (callbackData === "settings:delete") {
      await updateCtx.answerCallbackQuery();
      try {
        await updateCtx.editMessageText(
          "⚠️ Delete all data?\n\nThis permanently deletes all subscriptions, reminders, and personal settings. This cannot be undone.",
          { reply_markup: privacyDeleteKeyboard() },
        );
      } catch {
        await ctx.reply(
          "⚠️ Delete all data?\n\nThis permanently deletes all subscriptions, reminders, and personal settings. This cannot be undone.",
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
            "⚙️ Settings\n\nSettings updated.",
          );
        } catch {
          await ctx.reply("Settings updated.");
        }
        logger.info("Settings conversation completed");
        await restoreMainMenu(ctx, "Settings saved. Main menu restored.");
        return;
      }

      if (parsed.action === "back") {
        await editRichOrPlain(updateCtx, settingsPresentation(settings));
        continue;
      }

      if (parsed.action === "cancel") {
        try {
          await updateCtx.editMessageText("Settings changes cancelled.");
        } catch {
          await ctx.reply("Settings changes cancelled.");
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

        await editRichOrPlain(updateCtx, settingsPresentation(settings));
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

        await editRichOrPlain(updateCtx, settingsPresentation(settings));
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

        await editRichOrPlain(updateCtx, settingsPresentation(settings));
        continue;
      }

      if (parsed.action === "timezone_offset_menu") {
        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: timezoneOffsetKeyboard(),
          });
        } catch {
          await ctx.reply(
            "Choose a UTC offset, or select “Other” to enter one.",
            {
              reply_markup: timezoneOffsetKeyboard(),
            },
          );
        }
        continue;
      }

      if (parsed.action === "timezone_offset") {
        const normalized = normalizeUtcOffset(parsed.offset);
        if (!normalized) {
          await ctx.reply(
            "Invalid offset. Use a format such as +8, -5, or +5:30.",
          );
          continue;
        }

        settings = {
          ...settings,
          timezone: normalized,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        await editRichOrPlain(updateCtx, settingsPresentation(settings));
        continue;
      }

      if (parsed.action === "timezone_offset_other") {
        try {
          await updateCtx.editMessageText(
            "Enter a UTC offset, such as +8, -5, or +5:30.",
          );
        } catch {
          await ctx.reply("Enter a UTC offset, such as +8, -5, or +5:30.");
        }

        let normalized: string | null = null;
        while (!normalized) {
          const customTzCtx = await conversation.waitFor("message:text");
          const customTzText = customTzCtx.msg.text;
          if (isCancelInput(customTzText)) {
            await ctx.reply("Cancelled.");
            await restoreMainMenu(ctx);
            return;
          }
          normalized = normalizeUtcOffset(customTzText);
          if (!normalized) {
            await ctx.reply(
              "Invalid offset. Try again using a format such as +8, -5, or +5:30.",
              { reply_markup: forceReply("e.g. +8 or +5:30") },
            );
          }
        }

        settings = {
          ...settings,
          timezone: normalized,
        };
        await saveSettings(conversation, userKey, settings, encryptionKey);

        menuMessage = await sendSettings(ctx, settings);
        continue;
      }

      if (parsed.action === "timezone_offset_back") {
        try {
          await updateCtx.editMessageReplyMarkup({
            reply_markup: timezoneKeyboard(settings.timezone),
          });
        } catch {
          await ctx.reply("⚙️ Settings", {
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
        prompt: "Choose the default currency: ",
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

      menuMessage = await sendSettings(ctx, settings);
      continue;
    }

    // Handle "back" from sub-menus
    if (callbackData === "settings:back") {
      await updateCtx.answerCallbackQuery();

      await editRichOrPlain(updateCtx, settingsPresentation(settings));
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
