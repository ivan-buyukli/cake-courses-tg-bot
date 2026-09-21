import { Temporal } from "@js-temporal/polyfill";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import {
  createTestDatabase,
  setupBot,
  callback,
  command,
  lastCampaignReport,
} from "./courseTestUtils.js";
import { CampaignRepository } from "../src/repositories/campaignRepository.js";
import { EditorStateRepository } from "../src/repositories/editorStateRepository.js";
import {
  calendarDateLabel,
  calendarMonthLabel,
  localTimeCandidates,
  localToday,
  scheduleCalendar,
  timeKeyboard,
} from "../src/bot/keyboards/scheduleCalendar.js";
import { parseCallback } from "../src/utils/callbackParser.js";
import { catalogs } from "../src/bot/i18n.js";
import type { Campaign } from "../src/models/campaign.js";

describe("standalone scheduled messages", () => {
  let db: ReturnType<typeof createTestDatabase>;
  let setup: ReturnType<typeof setupBot>;
  let update: number;
  function row() {
    return db.sqlite.prepare("SELECT * FROM scheduled_message_drafts").get()!;
  }
  function draft() {
    return JSON.parse(row().content_json as string);
  }
  async function click(action: string, value?: string) {
    const state = row();
    await setup.bot.handleUpdate(
      callback(
        `s:${action}:${state.nonce}:${state.revision}${value === undefined ? "" : `:${value}`}`,
        100,
        update++,
      ),
    );
  }
  async function text(value: string) {
    const message = command(value, 100, update++);
    message.message!.entities = undefined;
    await setup.bot.handleUpdate(message);
  }
  async function create() {
    await setup.bot.handleUpdate(callback("s:new", 100, update++));
    await text("A standalone announcement");
    await click("day", "2026-10-20");
    await click("hour", "15");
    await click("minute", "37");
    await click("settime");
  }
  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-20T10:00:00Z"));
    db = createTestDatabase();
    setup = setupBot(db.db);
    update = 1;
    await setup.bot.handleUpdate(command("/start", 100, update++));
  });
  afterEach(() => {
    db.sqlite.close();
    vi.restoreAllMocks();
  });

  it.each(["en", "ua"] as const)(
    "schedules one message through the %s calendar, only after confirmation",
    async (locale) => {
      await setup.bot.handleUpdate(callback(`locale:${locale}`, 100, update++));
      await create();
      const menu = setup.calls.at(-1)!.payload.reply_markup.inline_keyboard;
      expect(JSON.stringify(menu)).not.toContain("s:lang:");
      expect(
        menu.flat().map((button: { text: string }) => button.text),
      ).not.toContain("Українська");
      expect(
        menu.flat().map((button: { text: string }) => button.text),
      ).not.toContain("English");
      expect(menu.every((row: unknown[]) => row.length > 0)).toBe(true);
      expect(JSON.stringify(menu)).toContain("s:content:");
      expect(draft().scheduledAt).toBe(Date.parse("2026-10-20T13:37:00Z"));
      expect(draft()).not.toHaveProperty("campaign");
      expect(
        db.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(0);
      expect(lastCampaignReport().subtitle).toContain(catalogs[locale].draft);
      await click("publish");
      expect(db.sqlite.prepare("SELECT * FROM campaigns").all()).toHaveLength(
        0,
      );
      expect(setup.calls.at(-1)!.payload.caption).toBe(
        catalogs[locale].scheduledConfirm,
      );
      const confirm = `s:confirm:${row().nonce}:${row().revision}`;
      await click("confirm");
      expect(db.sqlite.prepare("SELECT kind FROM campaigns").all()).toEqual([
        { kind: "broadcast" },
      ]);
      expect(
        db.sqlite.prepare("SELECT * FROM scheduled_message_drafts").all(),
      ).toHaveLength(0);
      expect(lastCampaignReport().subtitle).toContain(
        catalogs[locale].published,
      );
      expect(lastCampaignReport().subtitle).not.toContain(
        catalogs[locale].draft,
      );
      await setup.bot.handleUpdate(callback(confirm, 100, update++));
      expect(
        db.sqlite.prepare("SELECT * FROM campaign_versions").all(),
      ).toHaveLength(1);
    },
  );

  it("updates date and clock in the same panel and persists its selected audience", async () => {
    await setup.bot.handleUpdate(callback("s:new", 100, update++));
    await text("An announcement");
    const originalSent = setup.calls.filter(
      (call) => call.method === "sendMessage",
    ).length;
    for (const [name, value] of [
      ["day", "2026-10-20"],
      ["clock", "hp"],
      ["clock", "fp"],
    ]) {
      const state = row();
      const event = callback(
        `s:${name}:${state.nonce}:${state.revision}:${value}`,
        100,
        update++,
      );
      event.callback_query!.message!.message_id = 900;
      await setup.bot.handleUpdate(event);
      expect(setup.calls.at(-1)!.method).toBe("editMessageText");
      expect(setup.calls.at(-1)!.payload.message_id).toBe(900);
      const buttons = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
      expect(buttons).toContain("s:day:");
      expect(buttons).toContain("s:clock:");
      expect(buttons).toContain("s:settime:");
    }
    expect(
      setup.calls.filter((call) => call.method === "sendMessage"),
    ).toHaveLength(originalSent);
    expect(draft().scheduledAt).toBeUndefined();
    await click("settime");
    await click("audience");
    await click("aud", "unpaid");
    expect(draft().audience).toBe("unpaid");
    const report = lastCampaignReport();
    expect(report.rows[0]![1]).toBe(catalogs.en.audienceUnpaid);
    for (const key of [
      "fallback",
      "contentLanguage",
      "reportLanguages",
    ] as const)
      expect([
        ...report.fields.map((field) => field.label),
        ...report.columns.map((column) => column.label),
      ]).not.toContain(catalogs.en[key]);
    await click("publish");
    await click("confirm");
    expect(
      JSON.parse(
        db.sqlite.prepare("SELECT content_json FROM campaign_versions").get()!
          .content_json as string,
      ).audience,
    ).toBe("unpaid");
  });

  it.each(["ua", "en"] as const)(
    "shows the current time independently of the selected delivery in %s",
    async (locale) => {
      vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-20T13:52:00Z"));
      await setup.bot.handleUpdate(callback(`locale:${locale}`, 100, update++));
      await setup.bot.handleUpdate(callback("s:new", 100, update++));
      await text("An announcement");
      const expected = [
        catalogs[locale].dateAndTime,
        "",
        `${catalogs[locale].currentTime}: ${locale === "ua" ? "20 вересня 2026 р." : "20 September 2026"}, 15:52`,
        `${catalogs[locale].timeZone}: Europe/Berlin`,
        "",
        catalogs[locale].chooseSendingDateTime,
      ].join("\n");
      expect(setup.calls.at(-1)!.payload.text).toBe(expected);
      await click("day", "2026-10-20");
      await click("clock", "hp");
      expect(setup.calls.at(-1)!.method).toBe("editMessageText");
      expect(setup.calls.at(-1)!.payload.text).toBe(expected);
      const keyboard = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
      expect(keyboard).toContain(calendarMonthLabel("2026-10", locale));
      expect(keyboard).toContain(calendarDateLabel("2026-10-20", locale));
      expect(
        setup.calls
          .at(-1)!
          .payload.reply_markup.inline_keyboard.every(
            (row: unknown[]) => row.length > 0,
          ),
      ).toBe(true);
      vi.mocked(Date.now).mockReturnValue(Date.parse("2026-09-20T13:53:00Z"));
      await click("month", "2026-11");
      expect(setup.calls.at(-1)!.payload.text).toBe(
        expected.replace("15:52", "15:53"),
      );
      expect(
        JSON.stringify(setup.calls.at(-1)!.payload.reply_markup),
      ).toContain(calendarMonthLabel("2026-11", locale));
    },
  );

  it("resumes legacy Ukrainian drafts and language buttons as ua", async () => {
    await create();
    const legacy = {
      ...draft(),
      locale: "uk",
      editingLocale: "uk",
      variants: { uk: { text: "Legacy Ukrainian" } },
    };
    db.sqlite
      .prepare("UPDATE scheduled_message_drafts SET content_json = ?")
      .run(JSON.stringify(legacy));
    await click("preview");
    expect(
      setup.calls.findLast((call) => call.method === "sendMessage")!.payload
        .text,
    ).toBe("Legacy Ukrainian");
    await click("lang", "uk");
    await text("Updated Ukrainian");
    expect(draft().locale).toBe("ua");
    expect(draft().editingLocale).toBe("ua");
    expect(draft().variants.ua.text).toBe("Updated Ukrainian");
    expect(calendarMonthLabel("2028-02", "ua")).toContain("лютий");
    const calendar = scheduleCalendar(
      "2028-02",
      "Europe/Berlin",
      "ua",
      (name) => name,
    );
    expect(calendar.inline_keyboard[1]![0]!.text).toBe("пн");
  });

  it("keeps DST errors and repeated-hour choices in the combined calendar", async () => {
    await setup.bot.handleUpdate(callback("s:new", 100, update++));
    await text("DST announcement");
    await click("day", "2027-03-28");
    await click("hour", "2");
    await click("minute", "30");
    await click("settime");
    expect(draft().scheduledAt).toBeUndefined();
    expect(setup.calls.at(-1)!.method).toBe("editMessageText");
    expect(setup.calls.at(-1)!.payload.text).toContain(
      catalogs.en.timeUnavailable,
    );
    await click("day", "2026-10-25");
    await click("settime");
    const markup = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
    expect(markup).toContain("UTC+02:00");
    expect(markup).toContain("UTC+01:00");
    await click("at", String(Date.parse("2026-10-25T01:30:00Z")));
    expect(draft().scheduledAt).toBe(Date.parse("2026-10-25T01:30:00Z"));
  });

  it("keeps sequence drafts separate and cancels only the active editor", async () => {
    await setup.bot.handleUpdate(callback("c:new:sequence", 100, update++));
    await text("Sequence title");
    await text("Welcome message");
    const original = db.sqlite
      .prepare("SELECT content_json FROM campaign_drafts")
      .get()!;
    await create();
    expect(
      db.sqlite.prepare("SELECT content_json FROM campaign_drafts").get(),
    ).toEqual(original);
    await setup.bot.handleUpdate(command("/cancel", 100, update++));
    expect(
      db.sqlite.prepare("SELECT * FROM scheduled_message_drafts").all(),
    ).toHaveLength(0);
    expect(
      db.sqlite.prepare("SELECT content_json FROM campaign_drafts").get(),
    ).toEqual(original);
    const buttons = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
    expect(buttons).toContain("s:new");
    expect(buttons).not.toContain("resume");
    await setup.bot.handleUpdate(command("/messages", 100, update++));
    await text("Sequence content");
    expect(
      JSON.parse(
        db.sqlite.prepare("SELECT content_json FROM campaign_drafts").get()!
          .content_json as string,
      ).stage,
    ).toBe("timing");
  });

  it("checks admin access, ownership and stale revisions on calendar buttons", async () => {
    await create();
    const stale = `s:calendar:${row().nonce}:${row().revision}`;
    await click("calendar");
    const revision = row().revision;
    await setup.bot.handleUpdate(callback(stale, 100, update++));
    expect(row().revision).toBe(revision);
    await setup.bot.handleUpdate(
      callback(`s:day:${row().nonce}:${revision}:2026-10-21`, 200, update++),
    );
    expect(row().revision).toBe(revision);
    await setup.bot.handleUpdate(callback("s:new", 300, update++));
    expect(setup.calls.at(-1)!.payload.text).toBe(catalogs.en.denied);
    setup.env.ADMIN_USER_IDS = [200];
    await setup.bot.handleUpdate(
      callback(`s:discard:${row().nonce}:${revision}`, 100, update++),
    );
    expect(row().revision).toBe(revision);
  });

  it("retains a verified photo and previews it without enrolling users", async () => {
    await setup.bot.handleUpdate(callback("s:new", 100, update++));
    const message = command("", 100, update++);
    message.message!.text = undefined;
    message.message!.entities = undefined;
    message.message!.caption = "Photo announcement";
    message.message!.photo = [
      {
        file_id: "fixture-photo",
        file_unique_id: "photo_unique",
        width: 1200,
        height: 800,
      },
    ];
    await setup.bot.handleUpdate(message);
    expect(draft().variants.en.mediaId).toBeTruthy();
    await click("resume");
    await click("preview");
    expect(
      setup.calls.some(
        (call) =>
          call.method === "sendPhoto" &&
          call.payload.caption === "Photo announcement",
      ),
    ).toBe(true);
    expect(db.sqlite.prepare("SELECT * FROM enrollments").all()).toHaveLength(
      0,
    );
  });

  it("removes editing copies when a scheduled message is cancelled", async () => {
    await create();
    await click("publish");
    await click("confirm");
    const id = db.sqlite.prepare("SELECT id FROM campaigns").get()!
      .id as string;
    await setup.bot.handleUpdate(callback(`s:edit:${id}`, 100, update++));
    const stale = `s:resume:${row().nonce}:${row().revision}`;
    await setup.bot.handleUpdate(callback(`s:cancelok:${id}`, 200, update++));
    expect(
      db.sqlite.prepare("SELECT * FROM scheduled_message_drafts").all(),
    ).toHaveLength(0);
    await setup.bot.handleUpdate(callback(stale, 100, update++));
    expect(
      db.sqlite.prepare("SELECT * FROM scheduled_message_drafts").all(),
    ).toHaveLength(0);
    await setup.bot.handleUpdate(command("/deliveries", 100, update++));
    expect(
      JSON.stringify(setup.calls.at(-1)!.payload.reply_markup),
    ).not.toContain("Continue draft");
  });

  it("does not publish from an outdated confirmation snapshot", async () => {
    await create();
    await click("publish");
    const saved = row();
    const content = draft();
    const repo = new EditorStateRepository(db.db);
    const owner = saved.owner_id as string;
    await repo.save(owner, saved.nonce as string, saved.revision as number, {
      ...content,
      stage: "content",
    });
    const input: Campaign = {
      id: content.id,
      title: content.title,
      kind: "broadcast",
      fallback: "en",
      baseRevision: 0,
      scheduledAt: content.scheduledAt,
      steps: [{ id: content.id, offsetMinutes: 0, variants: content.variants }],
    };
    expect(
      await new CampaignRepository(db.db).publish(input, owner, {
        nonce: saved.nonce as string,
        revision: saved.revision as number,
        scheduled: true,
      }),
    ).toBe(false);
    expect(db.sqlite.prepare("SELECT * FROM campaigns").all()).toHaveLength(0);
  });
});

describe("calendar and clock selection", () => {
  it("migrates legacy broadcast drafts without losing media or sequence drafts", async () => {
    const database = createTestDatabase(false);
    try {
      const { bot } = setupBot(database.db);
      await bot.handleUpdate(command("/start", 100, 1));
      await bot.handleUpdate(command("/start", 200, 2));
      const owners = database.sqlite.prepare("SELECT id FROM users").all();
      const repository = new CampaignRepository(database.db);
      const content = {
        campaign: {
          id: crypto.randomUUID(),
          kind: "broadcast",
          title: "Legacy",
          baseRevision: 0,
          fallback: "en",
          scheduledAt: Date.now() + 60000,
          steps: [
            {
              variants: {
                en: { text: "Caption", mediaId: crypto.randomUUID() },
              },
            },
          ],
        },
        stage: "menu",
      };
      await repository.saveDraft(
        owners[0]!.id as string,
        crypto.randomUUID(),
        0,
        content,
      );
      await repository.saveDraft(
        owners[1]!.id as string,
        crypto.randomUUID(),
        0,
        { campaign: { kind: "sequence" } },
      );
      database.sqlite.exec(
        readFileSync(
          new NodeURL(
            "../migrations/0004_scheduled_message_editor.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const migrated = database.sqlite
        .prepare("SELECT content_json FROM scheduled_message_drafts")
        .get()!;
      expect(JSON.parse(migrated.content_json as string)).toMatchObject({
        variants: content.campaign.steps[0]!.variants,
        scheduledAt: content.campaign.scheduledAt,
      });
      expect(
        database.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(1);
    } finally {
      database.sqlite.close();
    }
  });
  it("handles leap days, month/year navigation and localized labels", () => {
    const nonce = crypto.randomUUID();
    const action = (name: string, value?: string) =>
      `s:${name}:${nonce}:999999${value ? `:${value}` : ""}`;
    const calendar = scheduleCalendar("2028-02", "Europe/Berlin", "ua", action);
    const buttons = calendar.inline_keyboard.flat();
    expect(buttons.some((button) => button.text === "29")).toBe(true);
    expect(calendarMonthLabel("2028-02", "en")).toBe("February 2028");
    for (const button of [
      ...buttons,
      ...timeKeyboard(60, "minute", action).inline_keyboard.flat(),
    ]) {
      const data = "callback_data" in button ? button.callback_data : "";
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
      expect(parseCallback(data)).toBeDefined();
    }
    expect(parseCallback(action("day", "2027-02-29"))).toBeUndefined();
    expect(parseCallback(action("hour", "24"))).toBeUndefined();
    expect(parseCallback(action("minute", "60"))).toBeUndefined();
  });
  it("uses the configured local date and handles DST gaps and repeated times explicitly", () => {
    expect(localToday("Europe/Berlin", Date.parse("2026-09-20T23:30Z"))).toBe(
      "2026-09-21",
    );
    expect(localTimeCandidates("2027-03-28", 2, 30, "Europe/Berlin")).toEqual(
      [],
    );
    expect(localTimeCandidates("2026-10-25", 2, 30, "Europe/Berlin")).toEqual([
      Date.parse("2026-10-25T00:30Z"),
      Date.parse("2026-10-25T01:30Z"),
    ]);
    expect(localTimeCandidates("2027-01-01", 10, 0, "Europe/Berlin")).toEqual([
      Temporal.Instant.from("2027-01-01T09:00Z").epochMilliseconds,
    ]);
  });
});
