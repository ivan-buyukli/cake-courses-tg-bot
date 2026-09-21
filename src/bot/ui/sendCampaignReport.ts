import { InputFile, type InlineKeyboard } from "grammy";
import type { BotContext } from "../../types/context.js";
import { campaignReportPages, type CampaignReport } from "./campaignReport.js";
import { renderCampaignReport } from "./campaignReportImage.js";
import { splitPlainMessage } from "./richMessage.js";

export async function sendCampaignReport(
  ctx: BotContext,
  report: CampaignReport,
  keyboard: InlineKeyboard,
  caption?: string,
): Promise<void> {
  const pages = campaignReportPages(report);
  for (const [index, page] of pages.entries()) {
    let png: Uint8Array;
    try {
      png = await renderCampaignReport(page);
    } catch {
      // A rendering failure must not strand the editor or leak campaign contents to logs.
      const plain = [
        ...(caption ? [caption] : []),
        page.subtitle,
        page.title,
        ...page.fields.map(({ label, value }) => `${label}: ${value}`),
        page.columns.map(({ label }) => label).join(" | "),
        ...page.rows.map((row) => row.join(" | ")),
      ].join("\n");
      for (const chunk of splitPlainMessage(plain))
        await ctx.reply(chunk, { reply_markup: keyboard });
      continue;
    }
    await ctx.replyWithPhoto(new InputFile(png, `campaign-${index + 1}.png`), {
      reply_markup: keyboard,
      ...(caption ? { caption } : {}),
    });
  }
}
