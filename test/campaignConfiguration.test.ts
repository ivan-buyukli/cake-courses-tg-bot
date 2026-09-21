import { Api } from "grammy";
import {
  campaignSchema,
  sequenceStepDueAt,
  type Campaign,
  type CampaignStep,
} from "../src/models/campaign.js";
import { testDueAt } from "../src/models/campaignTest.js";
import {
  createTestDatabase,
  setupBot,
  callback,
  command,
  lastCampaignReport,
} from "./courseTestUtils.js";
import { CampaignRepository } from "../src/repositories/campaignRepository.js";
import { CourseRepository } from "../src/repositories/courseRepository.js";
import { deliverBatch } from "../src/services/deliveryService.js";
import { catalogs } from "../src/bot/i18n.js";

const step = (name = "Welcome message"): CampaignStep => ({
  id: crypto.randomUUID(),
  name,
  offsetMinutes: 0,
  variants: { en: { text: "Welcome content" }, uk: { text: "Вітаємо" } },
});
const campaign = (kind: Campaign["kind"] = "sequence"): Campaign => ({
  id: crypto.randomUUID(),
  title: "Introduction",
  baseRevision: 0,
  fallback: "en",
  kind,
  steps: [step()],
  ...(kind === "broadcast" ? { scheduledAt: Date.now() + 60000 } : {}),
});

describe("named campaign messages and timing editor", () => {
  it("edits legacy Ukrainian campaigns using ua without rewriting their published snapshots", async () => {
    const db = createTestDatabase();
    try {
      const { bot, calls } = setupBot(db.db);
      await bot.handleUpdate(command("/start", 100));
      const owner = db.sqlite.prepare("SELECT id FROM users").get()!
        .id as string;
      const repo = new CampaignRepository(db.db);
      const content = campaign();
      content.fallback = "uk";
      await repo.publish(content, owner);
      const published = db.sqlite
        .prepare("SELECT content_json FROM campaign_versions")
        .get()!.content_json;
      await bot.handleUpdate(callback(`c:edit:${content.id}`, 100, 2));
      const row = () =>
        db.sqlite.prepare("SELECT * FROM campaign_drafts").get()!;
      await bot.handleUpdate(
        callback(`d:languk:${row().nonce}:${row().revision}`, 100, 3),
      );
      await bot.handleUpdate(command("Updated Ukrainian content", 100, 4));
      const draft = JSON.parse(row().content_json as string);
      expect(draft.language).toBe("ua");
      expect(draft.campaign.fallback).toBe("ua");
      expect(draft.campaign.steps[0].variants.ua.text).toBe(
        "Updated Ukrainian content",
      );
      await bot.handleUpdate(
        callback(`d:translations:${row().nonce}:${row().revision}`, 100, 5),
      );
      const markup = JSON.stringify(calls.at(-1)!.payload.reply_markup);
      expect(markup).toContain("d:langua:");
      expect(markup).not.toContain("d:languk:");
      expect(
        db.sqlite.prepare("SELECT content_json FROM campaign_versions").get()!
          .content_json,
      ).toBe(published);
    } finally {
      db.sqlite.close();
    }
  });

  it.each(["en", "ua"] as const)(
    "collects names before content, mixes timing modes and renders no language metadata in %s",
    async (locale) => {
      const db = createTestDatabase();
      try {
        const { bot, calls } = setupBot(db.db);
        let update = 1;
        const row = () =>
          db.sqlite.prepare("SELECT * FROM campaign_drafts").get()!;
        const draft = () => JSON.parse(row().content_json as string);
        const text = async (value: string) => {
          const message = command(value, 100, update++, locale);
          message.message!.entities = undefined;
          await bot.handleUpdate(message);
        };
        const click = async (action: string) => {
          const saved = row();
          await bot.handleUpdate(
            callback(
              `d:${action}:${saved.nonce}:${saved.revision}`,
              100,
              update++,
            ),
          );
        };
        await bot.handleUpdate(command("/start", 100, update++, locale));
        await bot.handleUpdate(callback("c:new:sequence", 100, update++));
        await text("Introduction");
        expect(calls.at(-1)!.payload.text).toBe(
          catalogs[locale].enterMessageName,
        );
        await text("Welcome message");
        expect(calls.at(-1)!.payload.text).toBe(catalogs[locale].enterText);
        await text("Welcome content");
        await click("delay");
        await text("0");
        await click("add");
        await text("Next-day reminder");
        await text("Remember your lesson");
        await click("calendar");
        await click("clockmp");
        await click("clockmm");
        expect(calls.at(-1)!.method).toBe("editMessageText");
        await click("applytime");
        expect(draft().campaign.steps).toMatchObject([
          { name: "Welcome message", offsetMinutes: 0 },
          {
            name: "Next-day reminder",
            calendar: {
              days: 1,
              time: "09:00",
              timeZone: "Europe/Berlin",
              anchor: "start",
            },
          },
        ]);
        await click("audience");
        await click("audunpaid");
        expect(draft().campaign.audience).toBe("unpaid");
        const report = lastCampaignReport();
        expect(report.rows[0]![0]).toBe("Welcome message");
        expect(report.rows[1]![0]).toBe("Next-day reminder");
        expect(report.columns[1]!.label).toBe(catalogs[locale].offset);
        for (const key of [
          "fallback",
          "contentLanguage",
          "reportLanguages",
        ] as const)
          expect([
            ...report.fields.map((field) => field.label),
            ...report.columns.map((column) => column.label),
          ]).not.toContain(catalogs[locale][key]);
        await click("rename");
        await text("Lesson reminder");
        expect(lastCampaignReport().rows[1]![0]).toBe("Lesson reminder");
        await click("timing");
        await click("calendar");
        await click("previous");
        await click("applytime");
        expect(draft().campaign.steps[1].calendar.anchor).toBe("previous");
        await click("test");
        expect(calls.at(-1)!.method).toBe("sendPhoto");
        expect(lastCampaignReport().rows[1]![0]).toBe("Lesson reminder");
      } finally {
        db.sqlite.close();
      }
    },
  );
});

describe("relative clock timing", () => {
  const calendarStep = (
    anchor: "start" | "previous" = "start",
    time = "09:00",
  ): CampaignStep => ({
    ...step("Morning reminder"),
    calendar: { days: 1, time, timeZone: "Europe/Berlin", anchor },
  });
  it("uses local calendar days rather than 24-hour durations", () => {
    const start = Date.parse("2027-03-27T08:00:00Z");
    expect(sequenceStepDueAt(calendarStep(), start)).toBe(
      Date.parse("2027-03-28T07:00:00Z"),
    );
    expect(
      sequenceStepDueAt(calendarStep(), Date.parse("2026-10-24T07:00Z")),
    ).toBe(Date.parse("2026-10-25T08:00Z"));
  });
  it("supports campaign-start and previous-success anchors without reordering overdue sends", () => {
    const start = Date.parse("2026-09-20T20:00Z");
    const previous = Date.parse("2026-09-22T20:00Z");
    expect(sequenceStepDueAt(calendarStep(), start)).toBe(
      Date.parse("2026-09-21T07:00Z"),
    );
    expect(sequenceStepDueAt(calendarStep(), start, previous)).toBe(
      previous + 60000,
    );
    expect(sequenceStepDueAt(calendarStep("previous"), start, previous)).toBe(
      Date.parse("2026-09-23T07:00Z"),
    );
  });
  it("handles DST gaps/repeated times deterministically and keeps quick tests fast", () => {
    expect(
      sequenceStepDueAt(
        calendarStep("start", "02:30"),
        Date.parse("2027-03-27T08:00Z"),
      ),
    ).toBe(Date.parse("2027-03-28T01:30Z"));
    expect(
      sequenceStepDueAt(
        calendarStep("start", "02:30"),
        Date.parse("2026-10-24T07:00Z"),
      ),
    ).toBe(Date.parse("2026-10-25T00:30Z"));
    const input = { ...campaign(), steps: [step(), calendarStep("previous")] };
    const start = Date.parse("2026-09-20T07:00Z");
    expect(testDueAt(input, "fast", start, 1, start)).toBe(start + 2000);
    expect(testDueAt(input, "real", start, 1, start)).toBe(
      sequenceStepDueAt(input.steps[1]!, start, start),
    );
    expect(
      campaignSchema.safeParse({
        ...input,
        steps: [
          {
            ...calendarStep(),
            calendar: { ...calendarStep().calendar, time: "25:00" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("recipient selection", () => {
  let db: ReturnType<typeof createTestDatabase>;
  let setup: ReturnType<typeof setupBot>;
  let repo: CampaignRepository;
  let owner: string;
  let now: number;
  const register = async (id: number, status: string) => {
    await setup.bot.handleUpdate(command("/start", id, id));
    const user = await new CourseRepository(setup.env).touchUser(
      { telegramId: id, chatId: id, firstName: "Fixture" },
      "en",
      now,
    );
    db.sqlite
      .prepare("UPDATE users SET payment_status = ? WHERE id = ?")
      .run(status, user.id);
    return user.id;
  };
  beforeEach(async () => {
    now = Date.parse("2026-09-20T10:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    db = createTestDatabase();
    setup = setupBot(db.db);
    repo = new CampaignRepository(db.db);
    owner = await register(100, "unknown");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.sqlite.close();
  });
  it("enrolls each newcomer in the latest sequence matching their payment segment", async () => {
    const unknown = await register(300, "unknown");
    const unpaid = await register(400, "unpaid");
    const paid = await register(500, "paid");
    const general = campaign();
    const targeted = { ...campaign(), audience: "unpaid" as const };
    await repo.publish(general, owner);
    await repo.publish(targeted, owner);
    await repo.materialize(now);
    expect(
      db.sqlite
        .prepare("SELECT campaign_id FROM enrollments WHERE user_id = ?")
        .get(unknown)!.campaign_id,
    ).toBe(general.id);
    expect(
      db.sqlite
        .prepare("SELECT campaign_id FROM enrollments WHERE user_id = ?")
        .get(unpaid)!.campaign_id,
    ).toBe(targeted.id);
    expect(
      db.sqlite
        .prepare("SELECT id FROM enrollments WHERE user_id = ?")
        .get(paid),
    ).toBeUndefined();
  });
  it.each(["sequence", "broadcast"] as const)(
    "filters %s recipients and rechecks payment immediately before sending",
    async (kind) => {
      const unpaid = await register(300, "unpaid");
      await register(400, "unknown");
      const input = { ...campaign(kind), audience: "unpaid" as const };
      await repo.publish(input, owner);
      now += 60001;
      await repo.materialize(now);
      expect(
        db.sqlite.prepare("SELECT user_id FROM enrollments").all(),
      ).toEqual([{ user_id: unpaid }]);
      const id = db.sqlite.prepare("SELECT id FROM deliveries").get()!
        .id as string;
      const original = CourseRepository.prototype.getUser;
      let reads = 0;
      vi.spyOn(CourseRepository.prototype, "getUser").mockImplementation(
        async function (this: CourseRepository, userId: string) {
          if (++reads === 2)
            db.sqlite
              .prepare(
                "UPDATE users SET payment_status = 'pending' WHERE id = ?",
              )
              .run(userId);
          return original.call(this, userId);
        },
      );
      const sendMessage = vi.fn();
      const ack = vi.fn();
      await deliverBatch(
        {
          messages: [{ body: { deliveryId: id }, ack, retry: vi.fn() }],
        } as unknown as MessageBatch<unknown>,
        setup.env,
        { sendMessage } as unknown as Api,
      );
      expect(sendMessage).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledOnce();
      expect(
        db.sqlite.prepare("SELECT state FROM deliveries").get()!.state,
      ).toBe(kind === "sequence" ? "pending" : "skipped");
      expect(
        db.sqlite.prepare("SELECT step FROM enrollments").get()!.step,
      ).toBe(0);
    },
  );
  it("keeps an active enrollment's audience and named timing snapshot after corrections", async () => {
    const unpaid = await register(300, "unpaid");
    const input = { ...campaign(), audience: "unpaid" as const };
    await repo.publish(input, owner);
    await repo.materialize(now);
    const enrolled = db.sqlite
      .prepare("SELECT version_id FROM enrollments WHERE user_id = ?")
      .get(unpaid)!;
    const current = (await repo.current(input.id))!;
    await repo.publish(
      {
        ...current,
        audience: "unknown",
        steps: [
          {
            ...current.steps[0]!,
            name: "New title",
            calendar: {
              days: 1,
              time: "09:00",
              timeZone: "Europe/Berlin",
              anchor: "start",
            },
          },
        ],
      },
      owner,
    );
    expect(
      (await repo.version(enrolled.version_id as string)).steps[0]!.name,
    ).toBe("Welcome message");
    const sendBatch = vi.fn();
    await repo.dispatch({ sendBatch } as unknown as Queue, now);
    expect(sendBatch).toHaveBeenCalledOnce();
  });
});
