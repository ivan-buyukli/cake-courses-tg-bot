import { InlineKeyboard, type Bot } from "grammy";
import { Temporal } from "@js-temporal/polyfill";
import type { BotContext } from "../types/context.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import type { MediaRecord } from "../models/course.js";
import {
  variantSchema,
  localizedVariant,
  type Campaign,
  type CampaignStep,
} from "../models/campaign.js";
import { CampaignRepository } from "../repositories/campaignRepository.js";
import {
  EditorStateRepository,
  type EditorDraftRow,
} from "../repositories/editorStateRepository.js";
import { parseCallback } from "../utils/callbackParser.js";
import { mediaFromMessage } from "../utils/media.js";
import { formatDateTime } from "../utils/dateTime.js";
import { detectLocale, t, type Locale } from "./i18n.js";
import { sendCampaignReport } from "./ui/sendCampaignReport.js";
import { audienceKeyboard, audienceLabel } from "./ui/audience.js";
import type { Audience } from "../models/audience.js";
import { editorPanel } from "./ui/editorPanel.js";
import {
  confirmationKeyboard,
  binaryActionKeyboard,
} from "./keyboards/confirmationKeyboard.js";
import {
  calendarDateLabel,
  calendarMonthLabel,
  localTimeCandidates,
  localToday,
  scheduleCalendar,
  clockControls,
  adjustClock,
} from "./keyboards/scheduleCalendar.js";

interface ScheduledDraft {
  id: string;
  title: string;
  baseRevision: number;
  locale: Locale;
  editingLocale?: Locale;
  variants: CampaignStep["variants"];
  stage:
    | "content"
    | "calendar"
    | "hour"
    | "minute"
    | "menu"
    | "confirm"
    | "audience";
  audience?: Audience;
  timeZone?: string;
  month?: string;
  date?: string;
  hour?: number;
  minute?: number;
  scheduledAt?: number;
}

function action(row: EditorDraftRow, name: string, value?: string): string {
  return `s:${name}:${row.nonce}:${row.revision}${value === undefined ? "" : `:${value}`}`;
}
function fromCampaign(campaign: Campaign): ScheduledDraft {
  const variants = { ...campaign.steps[0]!.variants };
  variants.ua ??= variants.uk;
  if (campaign.fallback === "pl") variants.en ??= variants.pl;
  return {
    id: campaign.id,
    title: campaign.title,
    baseRevision: campaign.baseRevision,
    locale: detectLocale(campaign.fallback),
    variants,
    stage: "menu",
    scheduledAt: campaign.scheduledAt,
    audience: campaign.audience,
  };
}
function readDraft(row: EditorDraftRow): ScheduledDraft {
  const draft = JSON.parse(row.content_json) as ScheduledDraft;
  draft.locale = detectLocale(draft.locale);
  if (draft.editingLocale)
    draft.editingLocale = detectLocale(draft.editingLocale);
  draft.variants.ua ??= draft.variants.uk;
  if (draft.locale === "en") draft.variants.en ??= draft.variants.pl;
  if (draft.stage === "hour" || draft.stage === "minute")
    draft.stage = "calendar";
  return draft;
}
function initializeCalendar(draft: ScheduledDraft, zone: string): void {
  draft.timeZone ??= zone;
  const local = Temporal.Instant.fromEpochMilliseconds(
    draft.scheduledAt ?? Date.now() + 3600000,
  ).toZonedDateTimeISO(draft.timeZone);
  draft.date ??= local.toPlainDate().toString();
  draft.month ??= draft.date.slice(0, 7);
  draft.hour ??= local.hour;
  draft.minute ??= local.minute;
}
function asBroadcast(draft: ScheduledDraft): Campaign {
  return {
    id: draft.id,
    kind: "broadcast",
    title: draft.title,
    baseRevision: draft.baseRevision,
    fallback: draft.locale,
    scheduledAt: draft.scheduledAt,
    audience: draft.audience,
    steps: [
      {
        id: draft.id,
        name: draft.title,
        offsetMinutes: 0,
        variants: draft.variants,
      },
    ],
  };
}

async function report(
  ctx: BotContext,
  draft: ScheduledDraft,
  status: string,
  keyboard: InlineKeyboard,
  caption?: string,
): Promise<void> {
  await sendCampaignReport(
    ctx,
    {
      title: draft.title || t(ctx.locale, "scheduledMessage"),
      subtitle: `${t(ctx.locale, "scheduledMessage")} | ${status}`,
      fields: [
        {
          label: t(ctx.locale, "sendAt"),
          value: draft.scheduledAt
            ? formatDateTime(
                draft.scheduledAt,
                ctx.locale,
                draft.timeZone ?? ctx.timeZone,
              )
            : "-",
        },
      ],
      columns: [
        { label: t(ctx.locale, "reportMessage"), width: 45 },
        { label: t(ctx.locale, "reportRecipients"), width: 55 },
      ],
      rows: [
        [
          draft.title || t(ctx.locale, "scheduledMessage"),
          audienceLabel(ctx.locale, draft.audience),
        ],
      ],
      pageLabel: t(ctx.locale, "page"),
    },
    keyboard,
    caption,
  );
}

async function preview(ctx: BotContext, draft: ScheduledDraft): Promise<void> {
  const variant =
    localizedVariant(draft.variants, ctx.locale) ??
    localizedVariant(draft.variants, draft.locale);
  if (!variant) return;
  if (!variant.mediaId) {
    await ctx.reply(variant.text);
    return;
  }
  const media = await ctx.repo.getMedia(variant.mediaId);
  if (!media || media.state !== "ready" || media.bot_key !== ctx.botKey) {
    await ctx.reply(t(ctx.locale, "mediaInvalid"));
    return;
  }
  const file = await ctx.repo.mediaFileId(media);
  if (media.media_type === "photo")
    await ctx.replyWithPhoto(file, { caption: variant.text });
  else await ctx.replyWithVideo(file, { caption: variant.text });
}

export function registerScheduledMessages(
  bot: Bot<BotContext>,
  env: CourseEnv,
  verifyMedia: (ctx: BotContext, asset: MediaRecord) => Promise<boolean>,
): void {
  const editors = new EditorStateRepository(env.COURSE_DB);
  const broadcasts = new CampaignRepository(env.COURSE_DB);
  const list = async (ctx: BotContext) => {
    await editors.focus(ctx.user.id, "scheduled");
    const entries = (await broadcasts.list("broadcast")).filter(
      (item) => !item.archived,
    );
    const kb = new InlineKeyboard();
    for (const item of entries)
      kb.text(item.title.slice(0, 45), `s:view:${item.id}`).row();
    const row = await editors.draft(ctx.user.id);
    if (row) kb.text(t(ctx.locale, "resumeDraft"), action(row, "resume")).row();
    kb.text(t(ctx.locale, "newScheduledMessage"), "s:new")
      .row()
      .text(t(ctx.locale, "back"), "nav:admin");
    await ctx.reply(
      t(ctx.locale, "deliveries") +
        (entries.length ? "" : `\n${t(ctx.locale, "noScheduledMessages")}`),
      { reply_markup: kb },
    );
  };
  const published = async (ctx: BotContext, campaign: Campaign) => {
    const draft = fromCampaign(campaign);
    const kb = new InlineKeyboard();
    if (campaign.scheduledAt! > Date.now())
      kb.text(t(ctx.locale, "editMessage"), `s:edit:${campaign.id}`).row();
    kb.text(t(ctx.locale, "cancelMessage"), `s:cancel:${campaign.id}`)
      .row()
      .text(t(ctx.locale, "back"), "s:list");
    await report(ctx, draft, t(ctx.locale, "published"), kb);
  };
  const show = async (
    ctx: BotContext,
    row: EditorDraftRow,
    notice?: string,
  ) => {
    const draft = readDraft(row);
    initializeCalendar(draft, ctx.timeZone);
    const zone = draft.timeZone ?? ctx.timeZone;
    const a = (name: string, value?: string) => action(row, name, value);
    const nav = (kb = new InlineKeyboard()) =>
      kb
        .row()
        .text(t(ctx.locale, "back"), a("resume"))
        .text(t(ctx.locale, "cancel"), a("discard"));
    if (draft.stage === "content") {
      await ctx.reply(t(ctx.locale, "enterText"), { reply_markup: nav() });
    } else if (draft.stage === "audience") {
      await ctx.reply(t(ctx.locale, "audienceNote"), {
        reply_markup: audienceKeyboard(
          ctx.locale,
          draft.audience,
          (audience) => a("aud", audience),
          a("resume"),
        ),
      });
    } else if (draft.stage === "calendar") {
      const month = draft.month!;
      const kb = new InlineKeyboard()
        .text(calendarMonthLabel(month, ctx.locale), a("noop"))
        .append(
          scheduleCalendar(month, zone, ctx.locale, a, {
            selectedDate: draft.date,
            footer: false,
          }),
        );
      kb.text(t(ctx.locale, "today"), a("day", localToday(zone)));
      kb.row().text(calendarDateLabel(draft.date!, ctx.locale), a("noop"));
      clockControls(kb, ctx.locale, draft.hour!, draft.minute!, (change) =>
        change === "noop" ? a("noop") : a("clock", change),
      );
      kb.row()
        .text(t(ctx.locale, "saveTime"), a("settime"))
        .row()
        .text(t(ctx.locale, "back"), a("resume"))
        .text(t(ctx.locale, "cancel"), a("discard"));
      if (notice === t(ctx.locale, "timeRepeated")) {
        for (const instant of localTimeCandidates(
          draft.date!,
          draft.hour!,
          draft.minute!,
          zone,
        ).filter((time) => time > Date.now()))
          kb.row().text(
            `UTC${Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone).offset}`,
            a("at", String(instant)),
          );
      }
      await editorPanel(
        ctx,
        [
          t(ctx.locale, "dateAndTime"),
          "",
          `${t(ctx.locale, "currentTime")}: ${formatDateTime(Date.now(), ctx.locale, zone, "calendar")}`,
          `${t(ctx.locale, "timeZone")}: ${zone}`,
          "",
          t(ctx.locale, "chooseSendingDateTime"),
          ...(notice ? ["", notice] : []),
        ].join("\n"),
        kb,
      );
    } else {
      const kb =
        draft.stage === "confirm"
          ? confirmationKeyboard("s", `${row.nonce}:${row.revision}`, {
              confirmLabel: t(ctx.locale, "scheduleMessage"),
              cancelLabel: t(ctx.locale, "back"),
            })
          : new InlineKeyboard();
      if (draft.stage !== "confirm") {
        kb.text(t(ctx.locale, "editMessage"), a("content"))
          .text(t(ctx.locale, "preview"), a("preview"))
          .row()
          .text(t(ctx.locale, "dateAndTime"), a("calendar"))
          .text(t(ctx.locale, "audience"), a("audience"))
          .row();
        if (draft.variants[draft.locale] && draft.scheduledAt)
          kb.text(t(ctx.locale, "scheduleMessage"), a("publish")).row();
        kb.text(t(ctx.locale, "cancel"), a("discard")).text(
          t(ctx.locale, "back"),
          "s:list",
        );
      }
      await report(
        ctx,
        draft,
        t(ctx.locale, "draft"),
        kb,
        draft.stage === "confirm"
          ? t(ctx.locale, "scheduledConfirm")
          : undefined,
      );
    }
  };
  const allowed = async (ctx: BotContext) => {
    if (ctx.isAdmin) return true;
    await ctx.reply(t(ctx.locale, "denied"));
    return false;
  };
  bot.command(["broadcasts", "deliveries"], async (ctx) => {
    if (await allowed(ctx)) await list(ctx);
  });
  bot.callbackQuery(/^(?:s:|c:(?:list|new):broadcast$)/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await allowed(ctx))) return;
    const data = parseCallback(ctx.callbackQuery.data);
    if (!data || (data[0] !== "s" && data[0] !== "c")) {
      await ctx.reply(t(ctx.locale, "expired"));
      return;
    }
    if (data[1] === "list") {
      await list(ctx);
      return;
    }
    if (
      ["view", "cancel", "cancelok", "edit"].includes(data[1]) &&
      data.length === 3 &&
      data[2]
    ) {
      const campaign = await broadcasts.current(data[2]);
      if (campaign?.kind !== "broadcast") {
        await ctx.reply(t(ctx.locale, "expired"));
        return;
      }
      if (data[1] === "view") {
        await published(ctx, campaign);
        return;
      }
      if (data[1] === "cancel") {
        await ctx.reply(t(ctx.locale, "cancelMessageConfirm"), {
          reply_markup: binaryActionKeyboard({
            confirmLabel: t(ctx.locale, "cancelMessage"),
            confirmData: `s:cancelok:${campaign.id}`,
            cancelLabel: t(ctx.locale, "back"),
            cancelData: `s:view:${campaign.id}`,
            confirmStyle: "danger",
          }),
        });
        return;
      }
      if (data[1] === "cancelok") {
        await broadcasts.archive(campaign.id, ctx.user.id);
        await ctx.reply(t(ctx.locale, "cancelled"), {
          reply_markup: new InlineKeyboard()
            .text(t(ctx.locale, "newScheduledMessage"), "s:new")
            .row()
            .text(t(ctx.locale, "back"), "s:list"),
        });
        return;
      }
      if (campaign.scheduledAt! <= Date.now()) {
        await ctx.reply(t(ctx.locale, "expired"));
        return;
      }
      await editors.focus(ctx.user.id, "scheduled");
      const existing = await editors.draft(ctx.user.id);
      if (!existing)
        await editors.save(
          ctx.user.id,
          crypto.randomUUID(),
          0,
          fromCampaign(campaign),
        );
      await show(ctx, (await editors.draft(ctx.user.id))!);
      return;
    }
    if (data[1] === "new") {
      await editors.focus(ctx.user.id, "scheduled");
      if (!(await editors.draft(ctx.user.id)))
        await editors.save(ctx.user.id, crypto.randomUUID(), 0, {
          id: crypto.randomUUID(),
          title: "",
          baseRevision: 0,
          locale: ctx.locale,
          variants: {},
          stage: "content",
          timeZone: ctx.timeZone,
        } satisfies ScheduledDraft);
      await show(ctx, (await editors.draft(ctx.user.id))!);
      return;
    }
    if (data[0] !== "s" || data.length < 4) return;
    const row = await editors.draft(ctx.user.id);
    if (!row || row.nonce !== data[2] || row.revision !== data[3]) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    const draft = readDraft(row);
    if (draft.baseRevision > 0 && !(await broadcasts.current(draft.id))) {
      await editors.discard(ctx.user.id, row.nonce);
      await list(ctx);
      return;
    }
    await editors.focus(ctx.user.id, "scheduled");
    draft.timeZone ??= ctx.timeZone;
    initializeCalendar(draft, ctx.timeZone);
    let notice: string | undefined;
    const a = (name: string, value?: string) => action(row, name, value);
    if (data[1] === "noop") return;
    if (data[1] === "discard") {
      await editors.discard(ctx.user.id, row.nonce);
      await ctx.reply(t(ctx.locale, "cancelled"), {
        reply_markup: new InlineKeyboard()
          .text(t(ctx.locale, "newScheduledMessage"), "s:new")
          .row()
          .text(t(ctx.locale, "back"), "s:list"),
      });
      return;
    }
    if (data[1] === "preview") {
      await preview(ctx, draft);
      await show(ctx, row);
      return;
    }
    if (data[1] === "confirm") {
      if (
        draft.stage !== "confirm" ||
        !draft.scheduledAt ||
        draft.scheduledAt <= Date.now()
      ) {
        await ctx.reply(t(ctx.locale, "timeUnavailable"));
        await show(ctx, row);
        return;
      }
      if (
        await broadcasts.publish(asBroadcast(draft), ctx.user.id, {
          nonce: row.nonce,
          revision: row.revision,
          scheduled: true,
        })
      ) {
        await editors.discard(ctx.user.id, row.nonce);
        const saved = await broadcasts.current(draft.id);
        if (saved) await published(ctx, saved);
      } else await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    if (data[1] === "publish") {
      if (
        !draft.variants[draft.locale] ||
        !draft.scheduledAt ||
        draft.scheduledAt <= Date.now()
      ) {
        await ctx.reply(t(ctx.locale, "timeUnavailable"));
        await show(ctx, row);
        return;
      }
      draft.stage = "confirm";
    } else if (data[1] === "resume" || data[1] === "cancel")
      draft.stage = "menu";
    else if (data[1] === "audience") draft.stage = "audience";
    else if (data[1] === "aud") {
      draft.audience = data[4];
      draft.stage = "menu";
    } else if (data[1] === "content" || data[1] === "lang") {
      draft.stage = "content";
      draft.editingLocale = data[1] === "lang" ? data[4] : draft.locale;
    } else if (data[1] === "calendar" || data[1] === "month") {
      draft.stage = "calendar";
      draft.month = data[1] === "month" ? data[4] : draft.date!.slice(0, 7);
    } else if (data[1] === "day" && draft.stage === "calendar") {
      if (data[4] < localToday(draft.timeZone)) {
        await show(ctx, row);
        return;
      }
      draft.date = data[4];
      draft.month = draft.date.slice(0, 7);
    } else if (data[1] === "clock" && draft.stage === "calendar") {
      Object.assign(draft, adjustClock(draft.hour!, draft.minute!, data[4]));
    } else if (data[1] === "hour" && draft.stage === "calendar") {
      draft.hour = Number(data[4]);
    } else if (data[1] === "minute" && draft.stage === "calendar") {
      draft.minute = Number(data[4]);
    } else if (data[1] === "settime" && draft.stage === "calendar") {
      const candidates = localTimeCandidates(
        draft.date!,
        draft.hour!,
        draft.minute!,
        draft.timeZone,
      ).filter((time) => time > Date.now());
      if (!candidates.length) notice = t(ctx.locale, "timeUnavailable");
      else if (candidates.length > 1) notice = t(ctx.locale, "timeRepeated");
      else {
        draft.scheduledAt = candidates[0];
        draft.stage = "menu";
      }
    } else if (
      data[1] === "at" &&
      draft.stage === "calendar" &&
      draft.minute !== undefined
    ) {
      const candidate = Number(data[4]);
      if (
        candidate <= Date.now() ||
        !localTimeCandidates(
          draft.date!,
          draft.hour!,
          draft.minute,
          draft.timeZone,
        ).includes(candidate)
      ) {
        await ctx.reply(t(ctx.locale, "timeUnavailable"));
        return;
      }
      draft.scheduledAt = candidate;
      draft.stage = "menu";
    } else {
      await ctx.reply(t(ctx.locale, "expired"), {
        reply_markup: new InlineKeyboard().text(
          t(ctx.locale, "back"),
          a("resume"),
        ),
      });
      return;
    }
    if (!(await editors.save(ctx.user.id, row.nonce, row.revision, draft))) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    await show(ctx, (await editors.draft(ctx.user.id))!, notice);
  });
  bot.on("message", async (ctx, next) => {
    if (
      !ctx.isAdmin ||
      ctx.message.text?.startsWith("/") ||
      (await editors.active(ctx.user.id)) !== "scheduled"
    ) {
      await next();
      return;
    }
    const row = await editors.draft(ctx.user.id);
    if (!row) {
      await next();
      return;
    }
    const draft = readDraft(row);
    if (draft.stage !== "content") {
      await show(ctx, row);
      return;
    }
    const media = mediaFromMessage(ctx.message);
    const text = ctx.message.text ?? ctx.message.caption ?? "";
    if (
      (!text.trim() && !media) ||
      text.length > (media ? 1024 : 4096) ||
      ctx.message.document
    ) {
      await ctx.reply(t(ctx.locale, "invalidInput"));
      return;
    }
    let mediaId: string | undefined;
    if (media) {
      const asset = await ctx.repo.saveMedia(ctx.user.id, ctx.me.id, media);
      if (!(await verifyMedia(ctx, asset))) return;
      mediaId = asset.id;
    }
    draft.variants[draft.editingLocale ?? draft.locale] = variantSchema.parse({
      text,
      mediaId,
    });
    draft.title ||=
      text.trim().slice(0, 100) ||
      t(ctx.locale, media?.type === "video" ? "video" : "photo");
    draft.stage = draft.scheduledAt ? "menu" : "calendar";
    draft.timeZone ??= ctx.timeZone;
    initializeCalendar(draft, ctx.timeZone);
    if (!(await editors.save(ctx.user.id, row.nonce, row.revision, draft))) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    await show(ctx, (await editors.draft(ctx.user.id))!);
  });
}
