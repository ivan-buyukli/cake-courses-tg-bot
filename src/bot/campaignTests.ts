import { InlineKeyboard, type Bot } from "grammy";
import type { BotContext } from "../types/context.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import { CampaignRepository } from "../repositories/campaignRepository.js";
import { CampaignTestRepository } from "../repositories/campaignTestRepository.js";
import { campaignSchema, type Campaign } from "../models/campaign.js";
import {
  testDueAt,
  type CampaignTest,
  type TestDelivery,
} from "../models/campaignTest.js";
import { parseCallback } from "../utils/callbackParser.js";
import { formatDateTime } from "../utils/dateTime.js";
import { sendCampaignReport } from "./ui/sendCampaignReport.js";
import { campaignOverview } from "./ui/campaignOverview.js";
import { detectLocale, t, type TextKey } from "./i18n.js";
import { stepName } from "./ui/stepPresentation.js";

export async function showTestOptions(
  ctx: BotContext,
  campaign: Campaign,
  nonce: string,
  revision: number,
): Promise<void> {
  await sendCampaignReport(
    ctx,
    campaignOverview(ctx, campaign, t(ctx.locale, "reportTestCampaign")),
    new InlineKeyboard()
      .text(t(ctx.locale, "testFast"), `ct:fast:${nonce}:${revision}`)
      .row()
      .text(t(ctx.locale, "testReal"), `ct:real:${nonce}:${revision}`)
      .row()
      .text(t(ctx.locale, "back"), `d:resume:${nonce}:${revision}`),
    t(ctx.locale, "testConfirm"),
  );
}

const deliveryLabels: Record<TestDelivery["state"], TextKey> = {
  pending: "pending",
  sending: "testSending",
  sent: "testSent",
  failed: "deliveryFailed",
  unknown: "deliveryUnknown",
  skipped: "testSkipped",
};

async function showTest(
  ctx: BotContext,
  repo: CampaignTestRepository,
  run: CampaignTest | null,
): Promise<void> {
  if (!run || run.owner_id !== ctx.user.id) {
    await ctx.reply(t(ctx.locale, "testNone"));
    return;
  }
  const campaign = campaignSchema.parse(JSON.parse(run.content_json));
  const deliveries = await repo.deliveries(run.id);
  const current = deliveries.find((delivery) => delivery.step === run.step);
  const state =
    run.state === "active"
      ? current?.state === "failed" || current?.state === "unknown"
        ? deliveryLabels[current.state]
        : "testActive"
      : run.state === "completed"
        ? "sequenceCompleted"
        : "cancelled";
  const rows: string[][] = [];
  for (const [index, step] of campaign.steps.entries()) {
    const delivery = deliveries.find((item) => item.step === index);
    const previousSent =
      deliveries.find((item) => item.step === index - 1)?.sent_at ?? undefined;
    const due =
      index === run.step
        ? Math.max(run.due_at, delivery?.available_at ?? 0)
        : testDueAt(campaign, run.mode, run.started_at, index, previousSent);
    const status = delivery
      ? deliveryLabels[delivery.state]
      : run.state === "cancelled"
        ? "cancelled"
        : "pending";
    rows.push([
      stepName(step, ctx.locale),
      t(ctx.locale, status),
      formatDateTime(due, ctx.locale, ctx.timeZone),
      delivery?.sent_at
        ? formatDateTime(delivery.sent_at, ctx.locale, ctx.timeZone)
        : "-",
    ]);
  }
  const keyboard = new InlineKeyboard().text(
    t(ctx.locale, "testRefresh"),
    `ct:status:${run.id}`,
  );
  if (run.state === "active")
    keyboard.text(t(ctx.locale, "testStop"), `ct:stop:${run.id}`);
  keyboard.row().text(t(ctx.locale, "back"), "nav:admin");
  await sendCampaignReport(
    ctx,
    {
      title: campaign.title,
      subtitle: `${t(ctx.locale, "reportTestCampaign")} | ${t(ctx.locale, run.mode === "real" ? "testRealMode" : "testFastMode")} | ${t(ctx.locale, state)}`,
      fields: [
        {
          label: t(ctx.locale, "testProgress"),
          value: `${deliveries.filter((delivery) => delivery.state === "sent").length}/${campaign.steps.length}`,
        },
      ],
      columns: [
        { label: t(ctx.locale, "reportMessage"), width: 28 },
        { label: t(ctx.locale, "reportStatus"), width: 20 },
        { label: t(ctx.locale, "sendAt"), width: 26 },
        { label: t(ctx.locale, "testSent"), width: 26 },
      ],
      rows,
      pageLabel: t(ctx.locale, "page"),
    },
    keyboard,
  );
}

export function registerCampaignTests(
  bot: Bot<BotContext>,
  env: CourseEnv,
): void {
  const repo = new CampaignTestRepository(env.COURSE_DB);
  const campaigns = new CampaignRepository(env.COURSE_DB);
  const allowed = async (ctx: BotContext) => {
    if (ctx.isAdmin) return true;
    await ctx.reply(t(ctx.locale, "denied"));
    return false;
  };
  bot.command("test", async (ctx) => {
    if (await allowed(ctx))
      await showTest(ctx, repo, await repo.latest(ctx.user.id));
  });
  bot.callbackQuery(/^ct:/, async (ctx) => {
    const data = parseCallback(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (!(await allowed(ctx))) return;
    if (!data || data[0] !== "ct") {
      await ctx.reply(t(ctx.locale, "expired"));
      return;
    }
    if (data[1] === "latest") {
      await showTest(ctx, repo, await repo.latest(ctx.user.id));
      return;
    }
    if (data[1] === "status" || data[1] === "stop") {
      if (data[1] === "stop") await repo.cancel(data[2], ctx.user.id);
      await showTest(ctx, repo, await repo.get(data[2]));
      return;
    }
    if (data[1] !== "real" && data[1] !== "fast") return;
    const language = detectLocale(ctx.locale);
    const row = await campaigns.draft(ctx.user.id);
    if (!row || row.nonce !== data[2] || row.revision !== data[3]) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    const draft = JSON.parse(row.content_json) as {
      campaign: Campaign;
      stage: string;
    };
    const parsed = campaignSchema.safeParse(draft.campaign);
    if (draft.stage !== "menu" || !parsed.success) {
      await ctx.reply(t(ctx.locale, "invalidInput"));
      return;
    }
    const campaign = parsed.data;
    if (
      data[1] === "real" &&
      campaign.kind === "broadcast" &&
      campaign.scheduledAt! <= Date.now()
    ) {
      await ctx.reply(t(ctx.locale, "testPastBroadcast"));
      return;
    }
    if (!env.COURSE_QUEUE) {
      await ctx.reply(t(ctx.locale, "queueUnavailable"));
      return;
    }
    const run = await repo.start(
      ctx.user.id,
      String(ctx.update.update_id),
      campaign,
      data[1],
      language,
      Date.now(),
      { nonce: row.nonce, revision: row.revision },
    );
    if (!run) {
      await ctx.reply(t(ctx.locale, "conflict"));
      return;
    }
    if (run.request_key !== String(ctx.update.update_id))
      await ctx.reply(t(ctx.locale, "testAlreadyActive"));
    if (env.COURSE_QUEUE) {
      await repo.materialize(Date.now());
      await repo.dispatch(env.COURSE_QUEUE, Date.now());
    }
    await showTest(ctx, repo, run);
  });
}
