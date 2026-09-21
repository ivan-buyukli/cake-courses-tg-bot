import { Bot, InlineKeyboard, InputFile, type BotConfig } from "grammy";
import type { CourseEnv } from "../schemas/envSchema.js";
import type { BotContext } from "../types/context.js";
import type { MediaRecord } from "../models/course.js";
import { mediaFromMessage } from "../utils/media.js";
import {
  CourseRepository,
  type UserFilter,
  type UserReportCursor,
} from "../repositories/courseRepository.js";
import { hashUserId } from "../crypto/userHash.js";
import { detectLocale, languageNames, t, type Locale } from "./i18n.js";
import { parseCallback } from "../utils/callbackParser.js";
import { telegramErrorInfo } from "../utils/telegramErrors.js";
import { usersReport, usersReportKeyboard } from "./ui/users.js";
import { registerCampaignEditor } from "./campaignEditor.js";
import { CampaignRepository } from "../repositories/campaignRepository.js";
import { registerCampaignTests } from "./campaignTests.js";
import { registerScheduledMessages } from "./scheduledMessages.js";
import { EditorStateRepository } from "../repositories/editorStateRepository.js";
import { navigationKeyboard } from "./keyboards/navigationKeyboard.js";

function menu(ctx: BotContext): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx.locale, "myCourse"), "nav:my_course")
    .row()
    .text(t(ctx.locale, "buy"), "nav:buy")
    .text(t(ctx.locale, "language"), "nav:language");
  if (ctx.isAdmin) kb.row().text(t(ctx.locale, "admin"), "nav:admin");
  else
    kb.row().text(
      t(ctx.locale, ctx.user.opted_out ? "resume" : "stop"),
      ctx.user.opted_out ? "nav:resume" : "nav:stop",
    );
  return kb;
}

function adminKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(locale, "users"), "users:all:0")
    .row()
    .text(t(locale, "sequences"), "c:list:sequence")
    .text(t(locale, "deliveries"), "s:list")
    .row()
    .text(t(locale, "back"), "nav:menu");
}

async function adminOnly(ctx: BotContext): Promise<boolean> {
  if (ctx.isAdmin) return true;
  await ctx.reply(t(ctx.locale, "denied"));
  return false;
}

async function showUsers(
  ctx: BotContext,
  filter: UserFilter,
  cursor?: UserReportCursor & { part: number },
): Promise<void> {
  if (!(await adminOnly(ctx))) return;
  const result = await ctx.repo.userReportPage(filter, cursor);
  const entries = [];
  for (const user of result.users)
    entries.push({ user, identity: await ctx.repo.identity(user) });
  const part = cursor?.part ?? 1;
  const multipart = !!cursor || result.nextAfter !== undefined;
  const next =
    result.nextAfter === undefined
      ? undefined
      : `users:${filter}:${result.nextAfter}:${result.cutoff}:${part + 1}`;
  await ctx.replyWithDocument(
    new InputFile(
      new TextEncoder().encode(usersReport(entries, ctx.locale, ctx.timeZone)),
      `users-${filter}${multipart ? `-part-${part}` : ""}.txt`,
    ),
    {
      caption: `${t(ctx.locale, "users")}${multipart ? ` | ${t(ctx.locale, "reportPart")} ${part}` : ""}${next ? `\n${t(ctx.locale, "reportMore")}` : ""}`,
      reply_markup: usersReportKeyboard(ctx.locale, next),
    },
  );
}

async function previewMedia(
  ctx: BotContext,
  asset: MediaRecord,
): Promise<boolean> {
  if (asset.bot_key !== ctx.botKey) {
    await ctx.reply(t(ctx.locale, "mediaInvalid"));
    return false;
  }
  try {
    const fileId = await ctx.repo.mediaFileId(asset);
    const sent =
      asset.media_type === "photo"
        ? await ctx.replyWithPhoto(fileId)
        : await ctx.replyWithVideo(fileId);
    const returned = mediaFromMessage(sent);
    if (!returned) throw new Error("Media response missing");
    await ctx.repo.verifyMedia(asset, returned);
    return true;
  } catch (error) {
    const { status, description } = telegramErrorInfo(error);
    if (
      status === 400 &&
      /file[_ ]id|file identifier|wrong remote file|file reference/i.test(
        description,
      )
    ) {
      await ctx.repo.invalidateMedia(asset);
      await ctx.reply(t(ctx.locale, "mediaInvalid"));
      return false;
    }
    throw error;
  }
}

async function navigate(ctx: BotContext, action: string): Promise<void> {
  switch (action) {
    case "start":
      await ctx.repo.start(ctx.user.id);
      ctx.user = (await ctx.repo.getUser(ctx.user.id))!;
      await ctx.reply(t(ctx.locale, ctx.isAdmin ? "adminWelcome" : "welcome"), {
        reply_markup: ctx.isAdmin ? adminKeyboard(ctx.locale) : menu(ctx),
      });
      break;
    case "menu":
      await ctx.reply(t(ctx.locale, "menu"), { reply_markup: menu(ctx) });
      break;
    case "admin":
      if (await adminOnly(ctx))
        await ctx.reply(t(ctx.locale, "adminWelcome"), {
          reply_markup: adminKeyboard(ctx.locale),
        });
      break;
    case "language":
      await ctx.reply(t(ctx.locale, "chooseLanguage"), {
        reply_markup: new InlineKeyboard()
          .text(languageNames.ua, "locale:ua")
          .text(languageNames.en, "locale:en"),
      });
      break;
    case "stop":
    case "resume": {
      if (ctx.isAdmin) {
        await navigate(ctx, "admin");
        break;
      }
      if (!ctx.user.started_at) {
        await ctx.reply(t(ctx.locale, "startFirst"));
        break;
      }
      await ctx.repo.setOptOut(
        ctx.user.id,
        action === "stop",
        ctx.eventAt,
        ctx.update.update_id,
      );
      ctx.user = (await ctx.repo.getUser(ctx.user.id))!;
      await ctx.reply(
        t(
          ctx.locale,
          ctx.user.purchase_suppressed
            ? "purchased"
            : ctx.user.opted_out
              ? "stopped"
              : "resumed",
        ),
        { reply_markup: menu(ctx) },
      );
      break;
    }
    case "buy":
      await ctx.reply(t(ctx.locale, "checkoutUnavailable"));
      break;
    case "my_course":
      await ctx.reply(t(ctx.locale, "accessUnknown"));
      break;
    default:
      await ctx.reply(t(ctx.locale, "expired"));
  }
}

export function createBot(
  env: CourseEnv,
  options?: BotConfig<BotContext>,
): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN, {
    ...options,
    client: { timeoutSeconds: 20, ...options?.client },
  });
  const repo = new CourseRepository(env);
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      if (ctx.callbackQuery)
        await ctx.answerCallbackQuery({
          text: t(detectLocale(ctx.from?.language_code), "privateOnly"),
          show_alert: true,
        });
      return;
    }
    if (ctx.myChatMember) {
      await repo.setBlocked(
        ctx.chat.id,
        ctx.myChatMember.new_chat_member.status === "kicked",
        ctx.myChatMember.date * 1000,
      );
      return;
    }
    // Edited messages must not re-run commands; inline callbacks lack a private chat.
    if (
      !ctx.from ||
      ctx.from.is_bot ||
      ctx.editedMessage ||
      (!ctx.message && !ctx.callbackQuery)
    )
      return;
    ctx.eventAt = ctx.message ? ctx.message.date * 1000 : Date.now();
    ctx.repo = repo;
    ctx.botKey = await hashUserId(ctx.me.id, env.USER_HASH_SECRET);
    ctx.user = await repo.touchUser(
      {
        telegramId: ctx.from.id,
        chatId: ctx.chat.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      },
      ctx.from.language_code,
      ctx.eventAt,
    );
    ctx.locale = detectLocale(ctx.user.locale);
    ctx.isAdmin = env.ADMIN_USER_IDS.includes(ctx.from.id);
    ctx.timeZone = env.CAMPAIGN_TIMEZONE;
    // Every private reply has a way back, including errors and completed actions.
    ctx.api.config.use((prev, method, payload, signal) => {
      if (
        ["sendMessage", "sendPhoto", "sendVideo", "sendDocument"].includes(
          method,
        ) &&
        "chat_id" in payload &&
        payload.chat_id === ctx.chat?.id
      ) {
        const markup =
          "reply_markup" in payload ? payload.reply_markup : undefined;
        if (markup && "inline_keyboard" in markup) {
          const hasMenu = markup.inline_keyboard.some((row) =>
            row.some(
              (button) =>
                "callback_data" in button &&
                ["nav:admin", "nav:menu", "nav:my_course"].includes(
                  button.callback_data,
                ),
            ),
          );
          if (hasMenu) return prev(method, payload, signal);
          return prev(
            method,
            {
              ...payload,
              reply_markup: {
                inline_keyboard: [
                  ...markup.inline_keyboard,
                  ...navigationKeyboard(ctx.locale, ctx.isAdmin)
                    .inline_keyboard,
                ],
              },
            },
            signal,
          );
        }
        if (markup) return prev(method, payload, signal);
        return prev(
          method,
          {
            ...payload,
            reply_markup: ctx.isAdmin ? adminKeyboard(ctx.locale) : menu(ctx),
          },
          signal,
        );
      }
      return prev(method, payload, signal);
    });
    await next();
  });
  for (const command of [
    "start",
    "menu",
    "buy",
    "my_course",
    "language",
    "stop",
    "resume",
    "admin",
  ]) {
    bot.command(command, (ctx) => navigate(ctx, command));
  }
  bot.command("help", async (ctx) => {
    await ctx.reply(
      t(ctx.locale, "help") +
        (ctx.isAdmin ? `\n\n${t(ctx.locale, "adminHelp")}` : ""),
    );
  });
  for (const command of ["support", "terms", "privacy"] as const) {
    bot.command(command, async (ctx) => {
      await ctx.reply(t(ctx.locale, command));
    });
  }
  bot.command("users", (ctx) => showUsers(ctx, "all"));
  bot.command("cancel", async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const editors = new EditorStateRepository(env.COURSE_DB);
    if ((await editors.active(ctx.user.id)) === "scheduled") {
      const row = await editors.draft(ctx.user.id);
      if (row) await editors.discard(ctx.user.id, row.nonce);
      await ctx.reply(t(ctx.locale, "cancelled"), {
        reply_markup: new InlineKeyboard()
          .text(t(ctx.locale, "newScheduledMessage"), "s:new")
          .row()
          .text(t(ctx.locale, "back"), "s:list"),
      });
      return;
    }
    const campaigns = new CampaignRepository(env.COURSE_DB);
    const draft = await campaigns.draft(ctx.user.id);
    if (draft) await campaigns.discard(ctx.user.id, draft.nonce);
    await ctx.reply(t(ctx.locale, "cancelled"), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx.locale, "newCampaign"), "c:new:sequence")
        .row()
        .text(t(ctx.locale, "back"), "c:list:sequence"),
    });
  });
  registerCampaignTests(bot, env);
  registerScheduledMessages(bot, env, previewMedia);
  registerCampaignEditor(bot, env, mediaFromMessage, previewMedia);
  bot.on("callback_query:data", async (ctx) => {
    const data = parseCallback(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery(
      data ? undefined : { text: t(ctx.locale, "expired") },
    );
    if (!data) {
      await ctx.reply(t(ctx.locale, "expired"));
      return;
    }
    switch (data[0]) {
      case "nav":
        await navigate(ctx, data[1]);
        break;
      case "locale":
        await repo.setLocale(
          ctx.user.id,
          data[1],
          ctx.eventAt,
          ctx.update.update_id,
        );
        ctx.user = (await repo.getUser(ctx.user.id))!;
        ctx.locale = ctx.user.locale;
        await ctx.reply(t(ctx.locale, "languageSaved"), {
          reply_markup: menu(ctx),
        });
        break;
      case "users":
        await showUsers(
          ctx,
          data[1],
          data.length === 5
            ? { after: data[2], cutoff: data[3], part: data[4] }
            : undefined,
        );
        break;
    }
  });
  bot.on("message", async (ctx) => {
    await ctx.reply(t(ctx.locale, "help"), { reply_markup: menu(ctx) });
  });
  return bot;
}
