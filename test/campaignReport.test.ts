import { mkdirSync, writeFileSync } from "node:fs";
import {
  campaignReportPages,
  type CampaignReport,
} from "../src/bot/ui/campaignReport.js";
import { renderCampaignReport } from "../src/bot/ui/campaignReportImage.js";
import { campaignOverview } from "../src/bot/ui/campaignOverview.js";
import type { BotContext } from "../src/types/context.js";
import { catalogs } from "../src/bot/i18n.js";

describe("campaign report images", () => {
  const report: CampaignReport = {
    title: "Course launch: a practical introduction",
    subtitle: "Test campaign | Quick test | Active",
    fields: [{ label: "Messages sent", value: "1/6" }],
    columns: [
      { label: "Message", width: 28 },
      { label: "Status", width: 20 },
      { label: "Scheduled time", width: 26 },
      { label: "Sent", width: 26 },
    ],
    rows: Array.from({ length: 6 }, (_, i) => [
      i === 0 ? "Welcome message" : `Lesson reminder ${i}`,
      i ? "Pending" : "Sent",
      "20 Sep 2026, 14:30 CEST (Europe/Berlin)",
      i ? "-" : "20 Sep 2026, 14:30 CEST (Europe/Berlin)",
    ]),
    pageLabel: "Page",
  };

  it("paginates without losing rows or metadata", () => {
    const input = {
      ...report,
      rows: Array.from({ length: 30 }, (_, i) => [String(i)]),
    };
    const pages = campaignReportPages(input);
    expect(pages).toHaveLength(5);
    expect(pages.flatMap((page) => page.rows)).toEqual(input.rows);
    expect(pages.every((page) => page.fields === input.fields)).toBe(true);
    expect(campaignReportPages({ ...report, rows: [] })).toHaveLength(1);
  });

  it.each(["en", "ua"])(
    "renders a real %s PNG with readable dimensions",
    async (language) => {
      const input =
        language === "en"
          ? report
          : {
              ...report,
              title:
                "Навчальний курс: практичний вступ та підготовка до наступного етапу навчання",
              subtitle: "Тест кампанії | Швидкий тест | Активний",
              fields: [{ label: "Надіслано повідомлень", value: "1/6" }],
              columns: report.columns.map((column, i) => ({
                ...column,
                label: [
                  "Повідомлення",
                  "Статус",
                  "Запланований час",
                  "Надіслано",
                ][i]!,
              })),
              rows: report.rows.map((row) => [
                "Нагадування про наступний урок",
                "Очікує надсилання",
                row[2]!,
                row[3]!,
              ]),
            };
      const png = await renderCampaignReport(input);
      expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const dimensions = new DataView(
        png.buffer,
        png.byteOffset,
        png.byteLength,
      );
      expect(dimensions.getUint32(16)).toBe(1200);
      expect(dimensions.getUint32(20)).toBeGreaterThan(580);
      expect(dimensions.getUint32(20)).toBeLessThan(2400);
      if (process.env.WRITE_REPORT_PREVIEWS) {
        mkdirSync(".cache", { recursive: true });
        writeFileSync(`.cache/campaign-report-${language}.png`, png);
      }
    },
  );
  it.each(["en", "ua"] as const)(
    "renders the actual named-message %s overview without language metadata",
    async (locale) => {
      const model = campaignOverview(
        { locale, timeZone: "Europe/Berlin" } as BotContext,
        {
          id: crypto.randomUUID(),
          title:
            locale === "en" ? "Course introduction" : "Знайомство з курсом",
          kind: "sequence",
          baseRevision: 1,
          fallback: "en",
          audience: "unpaid",
          steps: [
            {
              id: crypto.randomUUID(),
              name:
                locale === "en" ? "Welcome message" : "Вітальне повідомлення",
              offsetMinutes: 0,
              variants: { en: { text: "Hello" } },
            },
            {
              id: crypto.randomUUID(),
              name:
                locale === "en"
                  ? "First lesson reminder"
                  : "Нагадування про перший урок",
              offsetMinutes: 0,
              calendar: {
                days: 1,
                time: "09:00",
                timeZone: "Europe/Berlin",
                anchor: "start",
              },
              variants: { en: { text: "Lesson" } },
            },
          ],
        },
        catalogs[locale].published,
      );
      const image = await renderCampaignReport(model);
      expect(image.byteLength).toBeGreaterThan(1000);
      expect(JSON.stringify(model)).not.toContain(
        catalogs[locale].contentLanguage,
      );
      if (process.env.WRITE_REPORT_PREVIEWS) {
        mkdirSync(".cache", { recursive: true });
        writeFileSync(`.cache/campaign-names-${locale}.png`, image);
      }
    },
  );
});
