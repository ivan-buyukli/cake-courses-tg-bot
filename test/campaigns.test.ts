import { catalogs } from "../src/bot/i18n.js";
import { Api, GrammyError } from "grammy";
import {
  createTestDatabase,
  testBindings,
  setupBot,
  command,
  callback,
  lastCampaignReport,
} from "./courseTestUtils.js";
import { validateEnv } from "../src/schemas/envSchema.js";
import { CourseRepository } from "../src/repositories/courseRepository.js";
import { CampaignRepository } from "../src/repositories/campaignRepository.js";
import {
  campaignSchema,
  parseSchedule,
  type Campaign,
} from "../src/models/campaign.js";
import { deliverBatch } from "../src/services/deliveryService.js";
import { userProgress } from "../src/bot/ui/users.js";

describe("campaign publication, scheduling and delivery", () => {
  let database: ReturnType<typeof createTestDatabase>;
  let users: CourseRepository;
  let campaigns: CampaignRepository;
  let adminId: string;
  let userId: string;
  function campaign(kind: Campaign["kind"] = "sequence", offset = 0): Campaign {
    return {
      id: crypto.randomUUID(),
      kind,
      title: "Test campaign",
      baseRevision: 0,
      fallback: "en",
      steps: [
        {
          id: crypto.randomUUID(),
          offsetMinutes: offset,
          variants: {
            en: { text: "Hello" },
            uk: { text: "Welcome in Ukrainian" },
          },
        },
      ],
      ...(kind === "broadcast" ? { scheduledAt: Date.now() + 60_000 } : {}),
    };
  }
  async function register(id: number, language = "en") {
    const user = await users.touchUser(
      { telegramId: id, chatId: id, firstName: "Test" },
      language,
      Date.now(),
    );
    await users.start(user.id);
    return user.id;
  }
  function batch(id: string) {
    const message = {
      id: crypto.randomUUID(),
      body: { deliveryId: id },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    return {
      value: {
        messages: [message],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
        queue: "course-deliveries",
      } as unknown as MessageBatch<unknown>,
      message,
    };
  }
  function deliveryId(): string {
    return database.sqlite
      .prepare("SELECT id FROM deliveries ORDER BY rowid DESC LIMIT 1")
      .get()!.id as string;
  }
  beforeEach(async () => {
    database = createTestDatabase();
    users = new CourseRepository(validateEnv(testBindings(database.db)));
    campaigns = new CampaignRepository(database.db);
    adminId = await register(100);
    userId = await register(300);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    database.sqlite.close();
  });

  it("publishes an immutable version and fences concurrent corrections", async () => {
    const input = campaign();
    expect(await campaigns.publish(input, adminId)).toBe(true);
    expect(await campaigns.publish(input, adminId)).toBe(false);
    const current = (await campaigns.current(input.id))!;
    expect(current.baseRevision).toBe(1);
    expect(
      await campaigns.publish({ ...current, title: "Corrected" }, adminId),
    ).toBe(true);
    expect(
      database.sqlite.prepare("SELECT * FROM campaign_versions").all(),
    ).toHaveLength(2);
  });

  it("shows sequence progress including uncertain delivery status", async () => {
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    expect(userProgress((await users.getUser(userId))!, "en")).toContain("1/1");
    const id = deliveryId();
    const job = (await campaigns.claim(id, crypto.randomUUID(), Date.now()))!;
    await campaigns.setOutcome(job, "unknown");
    expect(
      userProgress(
        (await users.userReportPage("all")).users.find(
          (user) => user.id === userId,
        )!,
        "en",
      ),
    ).toContain("uncertain");
  });

  it("retains published content for active users and starts successors once", async () => {
    const input = campaign();
    await campaigns.publish(input, adminId);
    await campaigns.materialize(Date.now());
    const enrolled = database.sqlite
      .prepare("SELECT * FROM enrollments")
      .get()!;
    const current = (await campaigns.current(input.id))!;
    await campaigns.publish({ ...current, title: "Correction" }, adminId);
    const next = campaign();
    await campaigns.publish(next, adminId);
    await campaigns.materialize(Date.now());
    expect(
      database.sqlite.prepare("SELECT * FROM enrollments").all(),
    ).toHaveLength(1);
    expect(
      database.sqlite.prepare("SELECT version_id FROM enrollments").get()
        ?.version_id,
    ).toBe(enrolled.version_id);
    database.sqlite.prepare("UPDATE enrollments SET state = 'completed'").run();
    await campaigns.materialize(Date.now());
    await campaigns.materialize(Date.now());
    const rows = database.sqlite
      .prepare("SELECT * FROM enrollments ORDER BY rowid")
      .all();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.campaign_id).toBe(next.id);
  });

  it("enrolls newcomers only in the latest entry sequence", async () => {
    await campaigns.publish(campaign(), adminId);
    const latest = campaign();
    await campaigns.publish(latest, adminId);
    await campaigns.materialize(Date.now());
    expect(
      database.sqlite.prepare("SELECT campaign_id FROM enrollments").get()
        ?.campaign_id,
    ).toBe(latest.id);
  });

  it("keeps broadcasts separate from sequence progress and freezes recipient cutoff", async () => {
    await campaigns.publish(campaign("sequence", 60), adminId);
    await campaigns.materialize(Date.now());
    const blast = campaign("broadcast");
    await campaigns.publish(blast, adminId);
    await campaigns.materialize(blast.scheduledAt!);
    expect(
      database.sqlite.prepare("SELECT * FROM enrollments").all(),
    ).toHaveLength(2);
    expect(
      database.sqlite
        .prepare("SELECT step FROM enrollments WHERE kind = 'sequence'")
        .get()?.step,
    ).toBe(0);
    const late = await register(400);
    await campaigns.materialize(blast.scheduledAt! + 1);
    expect(
      database.sqlite
        .prepare(
          "SELECT * FROM enrollments WHERE kind = 'broadcast' AND user_id = ?",
        )
        .all(late),
    ).toHaveLength(0);
    expect(
      await campaigns.publish(
        {
          ...(await campaigns.current(blast.id))!,
          scheduledAt: Date.now() + 120_000,
        },
        adminId,
      ),
    ).toBe(false);
  });

  it("excludes opted-out, paid and admin users from promotion", async () => {
    await users.setOptOut(userId, true, Date.now(), 1);
    const paid = await register(400);
    database.sqlite
      .prepare("UPDATE users SET purchase_suppressed = 1 WHERE id = ?")
      .run(paid);
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    expect(
      database.sqlite.prepare("SELECT * FROM enrollments").all(),
    ).toHaveLength(0);
  });

  it("materializes and dispatches each due job idempotently", async () => {
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    await campaigns.materialize(Date.now());
    expect(
      database.sqlite.prepare("SELECT * FROM deliveries").all(),
    ).toHaveLength(1);
    const sendBatch = vi.fn().mockResolvedValue(undefined);
    await campaigns.dispatch({ sendBatch } as unknown as Queue, Date.now());
    await campaigns.dispatch({ sendBatch } as unknown as Queue, Date.now());
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith([
      { body: { deliveryId: deliveryId() } },
    ]);
  });

  it.each(["ua", "uk"] as const)(
    "sends %s content and advances only after success",
    async (locale) => {
      await users.setLocale(userId, "ua", Date.now(), 10);
      const content = campaign();
      content.fallback = locale;
      content.steps[0]!.variants = {
        [locale]: { text: "Welcome in Ukrainian" },
      };
      await campaigns.publish(content, adminId);
      await campaigns.materialize(Date.now());
      const sendMessage = vi.fn().mockResolvedValue({ message_id: 44 });
      const job = batch(deliveryId());
      await deliverBatch(job.value, validateEnv(testBindings(database.db)), {
        sendMessage,
      } as unknown as Api);
      expect(sendMessage).toHaveBeenCalledWith(
        300,
        "Welcome in Ukrainian",
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(job.message.ack).toHaveBeenCalledOnce();
      expect(
        database.sqlite.prepare("SELECT state, step FROM enrollments").get(),
      ).toMatchObject({ state: "completed", step: 1 });
      await deliverBatch(job.value, validateEnv(testBindings(database.db)), {
        sendMessage,
      } as unknown as Api);
      expect(sendMessage).toHaveBeenCalledOnce();
    },
  );

  it("retries explicit transient failures without advancing", async () => {
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    const job = batch(deliveryId());
    const sendMessage = vi.fn().mockRejectedValue(
      new GrammyError(
        "Rate limited",
        {
          ok: false,
          error_code: 429,
          description: "Too many requests",
          parameters: { retry_after: 30 },
        },
        "sendMessage",
        {},
      ),
    );
    await deliverBatch(job.value, validateEnv(testBindings(database.db)), {
      sendMessage,
    } as unknown as Api);
    expect(job.message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(
      database.sqlite.prepare("SELECT step FROM enrollments").get()?.step,
    ).toBe(0);
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("pending");
  });

  it("reuses and refreshes a verified media reference after delivery", async () => {
    const input = {
      type: "video" as const,
      fileId: "original",
      uniqueId: "video_unique",
      width: 1920,
      height: 1080,
      duration: 120,
    };
    const asset = await users.saveMedia(adminId, 12345, input);
    await users.verifyMedia(asset, input);
    const content = campaign();
    content.steps[0]!.variants.en = { text: "Watch", mediaId: asset.id };
    await campaigns.publish(content, adminId);
    await campaigns.materialize(Date.now());
    const sendVideo = vi.fn().mockResolvedValue({
      message_id: 45,
      video: {
        file_id: "refreshed",
        file_unique_id: "video_unique",
        width: 1920,
        height: 1080,
        duration: 120,
      },
    });
    await deliverBatch(
      batch(deliveryId()).value,
      validateEnv(testBindings(database.db)),
      { sendVideo } as unknown as Api,
    );
    expect(sendVideo).toHaveBeenCalledWith(300, "original", {
      caption: "Watch",
      reply_markup: expect.anything(),
    });
    expect(await users.mediaFileId((await users.getMedia(asset.id))!)).toBe(
      "refreshed",
    );
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("sent");
  });

  it("rejects obsolete retry buttons without changing held deliveries", async () => {
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    const id = deliveryId();
    const job = (await campaigns.claim(id, crypto.randomUUID(), Date.now()))!;
    await campaigns.setOutcome(job, "unknown");
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(
      callback(`retry:confirm:${id}:${job.attempts}`, 300, 1),
    );
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("unknown");
    await bot.handleUpdate(callback(`retry:ask:${id}:${job.attempts}`, 100, 2));
    expect(calls.at(-1)?.payload.text).toBe(catalogs.en.expired);
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("unknown");
    await bot.handleUpdate(
      callback(`retry:confirm:${id}:${job.attempts}`, 100, 3),
    );
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("unknown");
  });

  it("holds uncertain sends for review instead of silently repeating them", async () => {
    await campaigns.publish(campaign(), adminId);
    await campaigns.materialize(Date.now());
    const job = batch(deliveryId());
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("Network timeout with private data"));
    await deliverBatch(job.value, validateEnv(testBindings(database.db)), {
      sendMessage,
    } as unknown as Api);
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("unknown");
    await deliverBatch(job.value, validateEnv(testBindings(database.db)), {
      sendMessage,
    } as unknown as Api);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("rechecks a purchase or cancellation after a job is queued", async () => {
    const input = campaign();
    await campaigns.publish(input, adminId);
    await campaigns.materialize(Date.now());
    await campaigns.archive(input.id, adminId);
    const sendMessage = vi.fn();
    await deliverBatch(
      batch(deliveryId()).value,
      validateEnv(testBindings(database.db)),
      { sendMessage } as unknown as Api,
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      database.sqlite.prepare("SELECT state FROM deliveries").get()?.state,
    ).toBe("skipped");
  });

  it("does not resurrect discarded drafts from stale writes", async () => {
    const nonce = crypto.randomUUID();
    expect(await campaigns.saveDraft(adminId, nonce, 0, {})).toBe(true);
    expect(await campaigns.saveDraft(adminId, nonce, 1, { next: true })).toBe(
      true,
    );
    expect(await campaigns.saveDraft(adminId, nonce, 1, {})).toBe(false);
    await campaigns.discard(adminId, nonce);
    expect(await campaigns.saveDraft(adminId, nonce, 2, {})).toBe(false);
  });
});

describe("campaign editor", () => {
  it("opens published campaigns without creating a draft and removes cancelled editing copies", async () => {
    const database = createTestDatabase();
    try {
      const { bot, calls } = setupBot(database.db);
      await bot.handleUpdate(command("/start", 100, 1));
      await bot.handleUpdate(command("/start", 200, 2));
      const owners = database.sqlite
        .prepare("SELECT id FROM users WHERE is_admin = 1")
        .all();
      const repo = new CampaignRepository(database.db);
      const campaign: Campaign = {
        id: crypto.randomUUID(),
        kind: "sequence",
        title: "Published sequence",
        baseRevision: 0,
        fallback: "en",
        steps: [
          {
            id: crypto.randomUUID(),
            offsetMinutes: 0,
            variants: { en: { text: "Message" } },
          },
        ],
      };
      await repo.publish(campaign, owners[0]!.id as string);
      await bot.handleUpdate(callback(`c:view:${campaign.id}`, 100, 3));
      expect(calls.at(-1)!.method).toBe("sendPhoto");
      expect(lastCampaignReport().subtitle).toBe(catalogs.en.published);
      expect(
        database.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(0);
      expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).toContain(
        `c:edit:${campaign.id}`,
      );
      await bot.handleUpdate(callback(`c:edit:${campaign.id}`, 100, 4));
      await bot.handleUpdate(callback(`c:edit:${campaign.id}`, 200, 5));
      expect(
        database.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(2);
      await bot.handleUpdate(
        callback(`archive:confirm:${campaign.id}`, 100, 6),
      );
      expect(
        database.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(0);
      const keyboard = JSON.stringify(calls.at(-1)!.payload.reply_markup);
      expect(keyboard).toContain("c:new:sequence");
      expect(keyboard).not.toContain("resume");
      await bot.handleUpdate(callback(`c:edit:${campaign.id}`, 200, 7));
      expect(
        database.sqlite.prepare("SELECT * FROM campaign_drafts").all(),
      ).toHaveLength(0);
      expect(await repo.current(campaign.id)).toBeNull();
    } finally {
      database.sqlite.close();
    }
  });
  it("creates and publishes a sequence with explicit confirmation", async () => {
    const database = createTestDatabase();
    try {
      const { bot, calls } = setupBot(database.db);
      let update = 1;
      await bot.handleUpdate(command("/messages", 100, update++));
      await bot.handleUpdate(callback("c:new:sequence", 100, update++));
      for (const text of [
        "Welcome sequence",
        "Welcome message",
        "First message",
      ]) {
        const message = command(text, 100, update++);
        message.message!.entities = undefined;
        await bot.handleUpdate(message);
      }
      const timingDraft = database.sqlite
        .prepare("SELECT * FROM campaign_drafts")
        .get()!;
      await bot.handleUpdate(
        callback(
          `d:delay:${timingDraft.nonce}:${timingDraft.revision}`,
          100,
          update++,
        ),
      );
      const delay = command("0", 100, update++);
      delay.message!.entities = undefined;
      await bot.handleUpdate(delay);
      const draft = database.sqlite
        .prepare("SELECT * FROM campaign_drafts")
        .get()!;
      await bot.handleUpdate(
        callback(`d:publish:${draft.nonce}:${draft.revision}`, 100, update++),
      );
      expect(
        database.sqlite.prepare("SELECT * FROM campaigns").all(),
      ).toHaveLength(0);
      await bot.handleUpdate(
        callback(`pub:confirm:${draft.nonce}:${draft.revision}`, 100, update++),
      );
      expect(
        database.sqlite.prepare("SELECT * FROM campaigns").all(),
      ).toHaveLength(1);
      expect(calls.some((c) => c.payload.text === catalogs.en.published)).toBe(
        true,
      );
      expect(lastCampaignReport().subtitle).toBe(catalogs.en.published);
    } finally {
      database.sqlite.close();
    }
  });
  it("validates message ordering, fallback text and explicit future times", () => {
    expect(parseSchedule("2027-01-01T10:00")).toBeUndefined();
    expect(parseSchedule("2027-01-01T10:00+02:00", 0)).toBe(
      Date.parse("2027-01-01T08:00Z"),
    );
    expect(parseSchedule("2020-01-01T10:00Z")).toBeUndefined();
    expect(
      campaignSchema.safeParse({
        id: crypto.randomUUID(),
        kind: "sequence",
        title: "Title",
        fallback: "uk",
        baseRevision: 0,
        steps: [
          {
            id: crypto.randomUUID(),
            offsetMinutes: 0,
            variants: { en: { text: "Missing Ukrainian" } },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
