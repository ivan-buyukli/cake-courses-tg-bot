import { InlineKeyboard } from "grammy";
import { sendCampaignReport } from "../src/bot/ui/sendCampaignReport.js";
import { renderCampaignReport } from "../src/bot/ui/campaignReportImage.js";
import type { BotContext } from "../src/types/context.js";
import type { CampaignReport } from "../src/bot/ui/campaignReport.js";

vi.mock("../src/bot/ui/campaignReportImage.js", () => ({
  renderCampaignReport: vi.fn(),
}));

describe("campaign report delivery", () => {
  const report: CampaignReport = {
    title: "Campaign",
    subtitle: "Draft",
    fields: [{ label: "Language", value: "English" }],
    columns: [{ label: "Message", width: 100 }],
    rows: Array.from({ length: 7 }, (_, i) => [String(i + 1)]),
    pageLabel: "Page",
  };
  const keyboard = new InlineKeyboard().text("Back", "home");
  const reply = vi.fn();
  const replyWithPhoto = vi.fn();
  const ctx = { reply, replyWithPhoto } as unknown as BotContext;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(renderCampaignReport).mockResolvedValue(
      new Uint8Array([137, 80, 78, 71]),
    );
  });
  it("sends all pages with the original controls", async () => {
    await sendCampaignReport(ctx, report, keyboard);
    expect(replyWithPhoto).toHaveBeenCalledTimes(2);
    expect(
      replyWithPhoto.mock.calls.every(
        (call) => call[1].reply_markup === keyboard,
      ),
    ).toBe(true);
    expect(reply).not.toHaveBeenCalled();
  });
  it("retains details and navigation if rendering fails", async () => {
    vi.mocked(renderCampaignReport).mockRejectedValue(
      new Error("render failed"),
    );
    await sendCampaignReport(ctx, report, keyboard);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0]![0]).toContain("Language: English");
    expect(reply.mock.calls[1]![0]).toContain("7");
    expect(reply.mock.calls[0]![1]).toEqual({ reply_markup: keyboard });
    expect(replyWithPhoto).not.toHaveBeenCalled();
  });
  it("does not send duplicate fallback messages after a Telegram failure", async () => {
    replyWithPhoto.mockRejectedValue(new Error("network uncertain"));
    await expect(sendCampaignReport(ctx, report, keyboard)).rejects.toThrow(
      "network uncertain",
    );
    expect(replyWithPhoto).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });
});
