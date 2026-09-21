import { InlineKeyboard, type Bot } from "grammy";
import type { BotContext } from "../types/context.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import {
  campaignSchema,
  calendarTimingSchema,
  variantSchema,
  localizedVariant,
  type Campaign,
  type CampaignStep,
} from "../models/campaign.js";
import { CampaignRepository } from "../repositories/campaignRepository.js";
import {
  t,
  locales,
  detectLocale,
  languageNames,
  type Locale,
} from "./i18n.js";
import { parseCallback } from "../utils/callbackParser.js";
import { confirmationKeyboard } from "./keyboards/confirmationKeyboard.js";
import type { MediaInput } from "../models/course.js";
import { showTestOptions } from "./campaignTests.js";
import { sendCampaignReport } from "./ui/sendCampaignReport.js";
import { campaignOverview } from "./ui/campaignOverview.js";
import { EditorStateRepository } from "../repositories/editorStateRepository.js";
import { stepName } from "./ui/stepPresentation.js";
import { audienceKeyboard, audienceLabel } from "./ui/audience.js";
import type { Audience } from "../models/audience.js";
import {
  adjustClock,
  clockControls,
  type ClockChange,
} from "./keyboards/scheduleCalendar.js";
import { editorPanel } from "./ui/editorPanel.js";

interface Draft {
  campaign: Omit<Campaign, "title"> & { title: string };
  stage:
    | "title"
    | "name"
    | "text"
    | "offset"
    | "menu"
    | "timing"
    | "calendar"
    | "days"
    | "audience";
  selected: number;
  language: Locale;
  adding: boolean;
  messageName?: string;
  timing?: NonNullable<CampaignStep["calendar"]>;
}
type StoredDraft = { nonce: string; revision: number; content_json: string };

function draftData(row: StoredDraft): Draft {
  const draft = JSON.parse(row.content_json) as Draft;
  draft.language = detectLocale(draft.language);
  if (draft.campaign.fallback === "pl") {
    draft.campaign.fallback = "en";
    for (const step of draft.campaign.steps)
      step.variants.en ??= step.variants.pl;
  }
  draft.campaign.fallback = detectLocale(draft.campaign.fallback);
  for (const step of draft.campaign.steps)
    step.variants.ua ??= step.variants.uk;
  return draft;
}
function action(row: StoredDraft, name: string): string {
  return `d:${name}:${row.nonce}:${row.revision}`;
}

async function showDraft(ctx: BotContext, row: StoredDraft): Promise<void> {
  const draft = draftData(row);
  const campaign = draft.campaign;
  if (draft.stage === "audience") {
    await ctx.reply(t(ctx.locale, "audienceNote"), {
      reply_markup: audienceKeyboard(
        ctx.locale,
        campaign.audience,
        (audience) => action(row, `aud${audience}`),
        action(row, "resume"),
      ),
    });
    return;
  }
  if (draft.stage === "timing") {
    await ctx.reply(t(ctx.locale, "timing"), {
      reply_markup: new InlineKeyboard()
        .text(t(ctx.locale, "delayMode"), action(row, "delay"))
        .row()
        .text(t(ctx.locale, "calendarMode"), action(row, "calendar"))
        .row()
        .text(t(ctx.locale, "back"), action(row, "resume")),
    });
    return;
  }
  if (draft.stage === "calendar") {
    const timing = draft.timing ?? {
      days: 1,
      time: "09:00",
      timeZone: ctx.timeZone,
      anchor: "start",
    };
    const [hour, minute] = timing.time.split(":").map(Number);
    const kb = new InlineKeyboard()
      .text("-", action(row, "dayminus"))
      .text(
        `${t(ctx.locale, "dayOffset")}: ${timing.days}`,
        action(row, "days"),
      )
      .text("+", action(row, "dayplus"))
      .row()
      .text(
        `${timing.anchor === "start" ? "[x] " : ""}${t(ctx.locale, "campaignStart")}`,
        action(row, "start"),
      )
      .text(
        `${timing.anchor === "previous" ? "[x] " : ""}${t(ctx.locale, "previousMessage")}`,
        action(row, "previous"),
      );
    clockControls(kb, ctx.locale, hour!, minute!, (change) =>
      action(row, change === "noop" ? "noop" : `clock${change}`),
    )
      .row()
      .text(t(ctx.locale, "saveTiming"), action(row, "applytime"))
      .row()
      .text(t(ctx.locale, "back"), action(row, "resume"));
    await editorPanel(
      ctx,
      `${t(ctx.locale, "timing")}\n${stepName(campaign.steps[draft.selected]!, ctx.locale)}\n${timing.time} (${timing.timeZone})\n${t(ctx.locale, "calendarTimingNote")}`,
      kb,
    );
    return;
  }
  if (draft.stage !== "menu") {
    const key = {
      title: "enterTitle",
      name: "enterMessageName",
      text: "enterText",
      offset: "enterOffset",
      days: "enterDays",
    } as const;
    await ctx.reply(t(ctx.locale, key[draft.stage]), {
      reply_markup: new InlineKeyboard().text(
        t(ctx.locale, "discard"),
        action(row, "discard"),
      ),
    });
    return;
  }
  const kb = new InlineKeyboard();
  campaign.steps.forEach((step, index) => {
    kb.text(
      stepName(step, ctx.locale).slice(0, 40),
      action(row, `pick${index}`),
    );
    kb.row();
  });
  kb.row();
  kb.text(t(ctx.locale, "addStep"), action(row, "add"));
  if (campaign.steps[draft.selected]) {
    kb.row()
      .text(t(ctx.locale, "editStep"), action(row, "edit"))
      .text(t(ctx.locale, "removeStep"), action(row, "remove"))
      .row()
      .text(t(ctx.locale, "previewStep"), action(row, "preview"));
    kb.row().text(t(ctx.locale, "translations"), action(row, "translations"));
    kb.row()
      .text(t(ctx.locale, "renameMessage"), action(row, "rename"))
      .text(t(ctx.locale, "timing"), action(row, "timing"));
  }
  kb.row()
    .text(t(ctx.locale, "audience"), action(row, "audience"))
    .row()
    .text(t(ctx.locale, "testCampaign"), action(row, "test"))
    .row()
    .text(t(ctx.locale, "publish"), action(row, "publish"))
    .row()
    .text(t(ctx.locale, "discard"), action(row, "discard"));
  await sendCampaignReport(
    ctx,
    campaignOverview(ctx, campaign, t(ctx.locale, "draft"), draft.selected),
    kb,
  );
}

async function showCampaigns(
  ctx: BotContext,
  repo: CampaignRepository,
  kind: Campaign["kind"],
): Promise<void> {
  const campaigns = await repo.list(kind);
  const kb = new InlineKeyboard();
  campaigns.forEach((campaign, i) => {
    if (!campaign.archived)
      kb.text(
        `${i + 1}. ${campaign.title.slice(0, 35)}`,
        `c:view:${campaign.id}`,
      )
        .text(t(ctx.locale, "archive"), `c:archive:${campaign.id}`)
        .row();
  });
  const row = await repo.draft(ctx.user.id);
  if (row && draftData(row).campaign.kind === kind)
    kb.text(t(ctx.locale, "resumeDraft"), action(row, "resume")).row();
  kb.text(t(ctx.locale, "newCampaign"), `c:new:${kind}`)
    .row()
    .text(t(ctx.locale, "back"), "nav:admin");
  await ctx.reply(
    t(ctx.locale, kind === "sequence" ? "sequences" : "broadcasts") +
      (campaigns.length ? "" : `\n${t(ctx.locale, "emptyCampaigns")}`),
    { reply_markup: kb },
  );
}

async function showPublished(
  ctx: BotContext,
  campaign: Campaign,
): Promise<void> {
  await sendCampaignReport(
    ctx,
    campaignOverview(ctx, campaign, t(ctx.locale, "published")),
    new InlineKeyboard()
      .text(t(ctx.locale, "editCampaign"), `c:edit:${campaign.id}`)
      .row()
      .text(t(ctx.locale, "archive"), `c:archive:${campaign.id}`)
      .row()
      .text(t(ctx.locale, "back"), "c:list:sequence"),
  );
}

async function previewStep(ctx: BotContext, draft: Draft): Promise<void> {
  const step = draft.campaign.steps[draft.selected];
  const variant =
    step &&
    (localizedVariant(step.variants, draft.language) ??
      localizedVariant(step.variants, draft.campaign.fallback));
  if (!variant) {
    await ctx.reply(t(ctx.locale, "invalidInput"));
    return;
  }
  if (!variant.mediaId) {
    await ctx.reply(variant.text);
    return;
  }
  const asset = await ctx.repo.getMedia(variant.mediaId);
  if (!asset || asset.state !== "ready" || asset.bot_key !== ctx.botKey) {
    await ctx.reply(t(ctx.locale, "mediaInvalid"));
    return;
  }
  const fileId = await ctx.repo.mediaFileId(asset);
  if (asset.media_type === "photo")
    await ctx.replyWithPhoto(fileId, { caption: variant.text });
  else await ctx.replyWithVideo(fileId, { caption: variant.text });
}

export function registerCampaignEditor(
  bot: Bot<BotContext>,
  env: CourseEnv,
  readMedia: (
    message: NonNullable<BotContext["message"]>,
  ) => MediaInput | undefined,
  verifyMedia: (
    ctx: BotContext,
    asset: Awaited<ReturnType<BotContext["repo"]["saveMedia"]>>,
  ) => Promise<boolean>,
): void {
  const repo = new CampaignRepository(env.COURSE_DB);
  const editors = new EditorStateRepository(env.COURSE_DB);
  const allowed = async (ctx: BotContext) => {
    if (ctx.isAdmin) return true;
    await ctx.reply(t(ctx.locale, "denied"));
    return false;
  };
  bot.command("messages", async (ctx) => {
    if (await allowed(ctx)) {
      await editors.focus(ctx.user.id, "sequence");
      await showCampaigns(ctx, repo, "sequence");
    }
  });
  bot.callbackQuery(/^(?:c|d|pub|archive):/, async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (!(await allowed(ctx))) return;
    if (!parsed) {
      await ctx.reply(t(ctx.locale, "expired"));
      return;
    }
    if (parsed[0] === "archive") {
      const campaign = await repo.current(parsed[2]);
      if (parsed[1] === "confirm") await repo.archive(parsed[2], ctx.user.id);
      if (parsed[1] === "confirm")
        await ctx.reply(t(ctx.locale, "cancelled"), {
          reply_markup: new InlineKeyboard()
            .text(t(ctx.locale, "newCampaign"), "c:new:sequence")
            .row()
            .text(t(ctx.locale, "back"), "c:list:sequence"),
        });
      else if (campaign) await showPublished(ctx, campaign);
      else await showCampaigns(ctx, repo, "sequence");
      return;
    }
    if (parsed[0] === "c") {
      if (parsed[1] === "list") {
        await editors.focus(ctx.user.id, "sequence");
        await showCampaigns(ctx, repo, parsed[2]);
        return;
      }
      if (parsed[1] === "view") {
        const campaign = await repo.current(parsed[2]);
        if (campaign?.kind === "sequence") await showPublished(ctx, campaign);
        else await ctx.reply(t(ctx.locale, "expired"));
        return;
      }
      if (parsed[1] === "archive") {
        if ((await repo.current(parsed[2]))?.kind !== "sequence") {
          await ctx.reply(t(ctx.locale, "expired"));
          return;
        }
        await ctx.reply(t(ctx.locale, "archiveConfirm"), {
          reply_markup: confirmationKeyboard("archive", parsed[2], {
            confirmLabel: t(ctx.locale, "archive"),
            cancelLabel: t(ctx.locale, "back"),
          }),
        });
        return;
      }
      const existing = await repo.draft(ctx.user.id);
      if (
        parsed[1] === "edit" &&
        (await repo.current(parsed[2]))?.kind !== "sequence"
      ) {
        await ctx.reply(t(ctx.locale, "expired"));
        return;
      }
      await editors.focus(ctx.user.id, "sequence");
      if (existing) {
        await showDraft(ctx, existing);
        return;
      }
      const campaign: Campaign =
        parsed[1] === "edit"
          ? (await repo.current(parsed[2]))!
          : {
              id: crypto.randomUUID(),
              kind: parsed[2] as Campaign["kind"],
              baseRevision: 0,
              title: "",
              fallback: ctx.locale,
              steps: [],
            };
      if (!campaign || campaign.kind !== "sequence") {
        await ctx.reply(t(ctx.locale, "expired"));
        return;
      }
      const draft: Draft = {
        campaign,
        stage: parsed[1] === "edit" ? "menu" : "title",
        selected: 0,
        language: detectLocale(campaign.fallback),
        adding: false,
      };
      await repo.saveDraft(ctx.user.id, crypto.randomUUID(), 0, draft);
      await showDraft(ctx, (await repo.draft(ctx.user.id))!);
      return;
    }
    if (parsed[0] !== "d" && parsed[0] !== "pub") return;
    const row = await repo.draft(ctx.user.id);
    if (!row || row.nonce !== parsed[2] || row.revision !== parsed[3]) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    const draft = draftData(row);
    if (
      draft.campaign.baseRevision > 0 &&
      !(await repo.current(draft.campaign.id))
    ) {
      await repo.discard(ctx.user.id, row.nonce);
      await showCampaigns(ctx, repo, "sequence");
      return;
    }
    await editors.focus(ctx.user.id, "sequence");
    const command = parsed[1];
    if (parsed[0] === "pub") {
      if (command === "confirm") {
        if (await repo.publish(draft.campaign, ctx.user.id, row)) {
          await repo.discard(ctx.user.id, row.nonce);
          await ctx.reply(t(ctx.locale, "published"));
          const published = await repo.current(draft.campaign.id);
          if (published) await showPublished(ctx, published);
          else await showCampaigns(ctx, repo, "sequence");
        } else await ctx.reply(t(ctx.locale, "conflict"));
      } else await showDraft(ctx, row);
      return;
    }
    if (command === "discard") {
      await repo.discard(ctx.user.id, row.nonce);
      await ctx.reply(t(ctx.locale, "cancelled"), {
        reply_markup: new InlineKeyboard()
          .text(t(ctx.locale, "newCampaign"), "c:new:sequence")
          .row()
          .text(t(ctx.locale, "back"), "c:list:sequence"),
      });
      return;
    }
    if (command === "resume") {
      if (draft.stage === "menu") {
        await showDraft(ctx, row);
        return;
      }
      draft.stage = "menu";
      if (
        !(await repo.saveDraft(ctx.user.id, row.nonce, row.revision, draft))
      ) {
        await ctx.reply(t(ctx.locale, "conflict"));
        return;
      }
      await showDraft(ctx, (await repo.draft(ctx.user.id))!);
      return;
    }
    if (command === "noop") return;
    if (command === "preview") {
      await previewStep(ctx, draft);
      return;
    }
    if (command === "test") {
      if (
        !campaignSchema.safeParse(draft.campaign).success ||
        draft.stage !== "menu"
      ) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      await showTestOptions(ctx, draft.campaign, row.nonce, row.revision);
      return;
    }
    if (command === "translations") {
      const keyboard = new InlineKeyboard();
      for (const locale of locales)
        keyboard.text(languageNames[locale], action(row, `lang${locale}`));
      keyboard.row().text(t(ctx.locale, "back"), action(row, "resume"));
      await ctx.reply(t(ctx.locale, "translations"), {
        reply_markup: keyboard,
      });
      return;
    }
    if (command === "publish") {
      if (!campaignSchema.safeParse(draft.campaign).success) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      await ctx.reply(
        `${t(ctx.locale, "publish")}: ${draft.campaign.title}\n${t(ctx.locale, "audience")}: ${audienceLabel(ctx.locale, draft.campaign.audience)}`,
        {
          reply_markup: confirmationKeyboard(
            "pub",
            `${row.nonce}:${row.revision}`,
            {
              confirmLabel: t(ctx.locale, "publish"),
              cancelLabel: t(ctx.locale, "back"),
            },
          ),
        },
      );
      return;
    }
    if (command === "add") {
      if (draft.campaign.steps.length >= 30) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      draft.stage = "name";
      draft.adding = true;
      draft.language = detectLocale(draft.campaign.fallback);
    } else if (command === "rename") {
      if (!draft.campaign.steps[draft.selected]) return;
      draft.stage = "name";
      draft.adding = false;
    } else if (command === "audience") draft.stage = "audience";
    else if (command.startsWith("aud")) {
      draft.campaign.audience = command.slice(3) as Audience;
      draft.stage = "menu";
    } else if (
      command === "timing" ||
      command === "delay" ||
      command === "calendar"
    ) {
      if (!draft.campaign.steps[draft.selected]) return;
      draft.stage = command === "delay" ? "offset" : command;
      if (command === "calendar")
        draft.timing = draft.campaign.steps[draft.selected]!.calendar ?? {
          days: 1,
          time: "09:00",
          timeZone: ctx.timeZone,
          anchor: "start",
        };
    } else if (
      draft.stage === "calendar" &&
      draft.timing &&
      [
        "dayplus",
        "dayminus",
        "days",
        "start",
        "previous",
        "applytime",
        "clockhp",
        "clockhm",
        "clockmp",
        "clockmm",
        "clockfp",
        "clockfm",
      ].includes(command)
    ) {
      if (command === "days") draft.stage = "days";
      else if (command === "dayplus" || command === "dayminus")
        draft.timing.days = Math.min(
          365,
          Math.max(0, draft.timing.days + (command === "dayplus" ? 1 : -1)),
        );
      else if (command === "start" || command === "previous")
        draft.timing.anchor = command;
      else if (command === "applytime") {
        draft.campaign.steps[draft.selected]!.calendar =
          calendarTimingSchema.parse(draft.timing);
        draft.stage = "menu";
      } else {
        const [hour, minute] = draft.timing.time.split(":").map(Number);
        const updated = adjustClock(
          hour!,
          minute!,
          command.slice(5) as ClockChange,
        );
        draft.timing.time = `${String(updated.hour).padStart(2, "0")}:${String(updated.minute).padStart(2, "0")}`;
      }
    } else if (command === "edit" || command.startsWith("lang")) {
      if (!draft.campaign.steps[draft.selected]) return;
      draft.adding = false;
      draft.stage = "text";
      draft.language = command.startsWith("lang")
        ? detectLocale(command.slice(4))
        : detectLocale(draft.campaign.fallback);
    } else if (command === "remove") {
      draft.campaign.steps.splice(draft.selected, 1);
      draft.selected = Math.max(0, draft.selected - 1);
    } else if (command.startsWith("pick")) {
      draft.selected = Number(command.slice(4));
      draft.stage = "menu";
    }
    if (!(await repo.saveDraft(ctx.user.id, row.nonce, row.revision, draft))) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    await showDraft(ctx, (await repo.draft(ctx.user.id))!);
  });
  bot.on("message", async (ctx, next) => {
    if (!ctx.isAdmin || ctx.message.text?.startsWith("/")) {
      await next();
      return;
    }
    if ((await editors.active(ctx.user.id)) !== "sequence") {
      await next();
      return;
    }
    const row = await repo.draft(ctx.user.id);
    if (!row) {
      await next();
      return;
    }
    const draft = draftData(row);
    const input = ctx.message.text?.trim();
    if (draft.stage === "title") {
      if (!input || input.length > 100) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      draft.campaign.title = input;
      draft.stage = "name";
      draft.adding = true;
    } else if (draft.stage === "name") {
      if (!input || input.length > 100) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      if (draft.adding) {
        draft.messageName = input;
        draft.stage = "text";
      } else {
        draft.campaign.steps[draft.selected]!.name = input;
        draft.stage = "menu";
      }
    } else if (draft.stage === "days" && draft.timing) {
      if (!input || !/^\d{1,3}$/.test(input) || Number(input) > 365) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      draft.timing.days = Number(input);
      draft.stage = "calendar";
    } else if (draft.stage === "offset") {
      if (!input || !/^\d{1,6}$/.test(input) || Number(input) > 525600) {
        await ctx.reply(t(ctx.locale, "invalidInput"));
        return;
      }
      draft.campaign.steps[draft.selected]!.offsetMinutes = Number(input);
      delete draft.campaign.steps[draft.selected]!.calendar;
      draft.stage = "menu";
    } else if (draft.stage === "text") {
      const media = readMedia(ctx.message);
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
      const variant = variantSchema.parse({ text, mediaId });
      if (draft.adding) {
        const step: CampaignStep = {
          id: crypto.randomUUID(),
          name: draft.messageName,
          offsetMinutes: draft.campaign.steps.at(-1)?.offsetMinutes ?? 0,
          variants: { [draft.campaign.fallback]: variant },
        };
        draft.campaign.steps.push(step);
        draft.selected = draft.campaign.steps.length - 1;
      } else
        draft.campaign.steps[draft.selected]!.variants[draft.language] =
          variant;
      draft.stage = draft.adding ? "timing" : "menu";
      draft.adding = false;
    } else {
      await showDraft(ctx, row);
      return;
    }
    if (!(await repo.saveDraft(ctx.user.id, row.nonce, row.revision, draft))) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    await showDraft(ctx, (await repo.draft(ctx.user.id))!);
  });
}
