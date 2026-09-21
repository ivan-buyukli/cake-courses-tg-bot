import type { BotContext } from "../../types/context.js";
import type { Campaign } from "../../models/campaign.js";
import { t } from "../i18n.js";
import { audienceLabel } from "./audience.js";
import { stepName, stepTiming } from "./stepPresentation.js";
import { formatDateTime } from "../../utils/dateTime.js";
import type { CampaignReport } from "./campaignReport.js";

export function campaignOverview(
  ctx: BotContext,
  campaign: Campaign,
  subtitle: string,
  selected?: number,
): CampaignReport {
  return {
    title: campaign.title,
    subtitle,
    fields: [
      {
        label: t(ctx.locale, "reportRecipients"),
        value: audienceLabel(ctx.locale, campaign.audience),
      },
      ...(selected === undefined
        ? []
        : [
            {
              label: t(ctx.locale, "selectedStep"),
              value: campaign.steps[selected]
                ? stepName(campaign.steps[selected]!, ctx.locale)
                : "-",
            },
          ]),
      ...(campaign.scheduledAt
        ? [
            {
              label: t(ctx.locale, "sendAt"),
              value: formatDateTime(
                campaign.scheduledAt,
                ctx.locale,
                ctx.timeZone,
              ),
            },
          ]
        : []),
    ],
    columns: [
      { label: t(ctx.locale, "reportMessage"), width: 44 },
      { label: t(ctx.locale, "offset"), width: 56 },
    ],
    rows: campaign.steps.map((step) => [
      stepName(step, ctx.locale),
      stepTiming(step, ctx.locale),
    ]),
    pageLabel: t(ctx.locale, "page"),
  };
}
