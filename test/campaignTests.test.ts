import { Api, GrammyError } from "grammy";
import {
  createTestDatabase,
  setupBot,
  callback,
  command,
  lastCampaignReport,
} from "./courseTestUtils.js";
import { CourseRepository } from "../src/repositories/courseRepository.js";
import { CampaignRepository } from "../src/repositories/campaignRepository.js";
import { CampaignTestRepository } from "../src/repositories/campaignTestRepository.js";
import type { Campaign } from "../src/models/campaign.js";
import type { CampaignTest } from "../src/models/campaignTest.js";
import { deliverBatch, runScheduled } from "../src/services/deliveryService.js";
import { catalogs } from "../src/bot/i18n.js";

describe("private campaign tests", () => {
  let database: ReturnType<typeof createTestDatabase>;
  let setup: ReturnType<typeof setupBot>;
  let repo: CampaignTestRepository;
  let users: CourseRepository;
  let owner: string;
  let now: number;
  let sendBatch: ReturnType<typeof vi.fn>;
  function campaign(offsets = [0, 1440]): Campaign {
    return {
      id: crypto.randomUUID(),
      title: "Private rehearsal",
      kind: "sequence",
      baseRevision: 0,
      fallback: "en",
      steps: offsets.map((offset, i) => ({
        id: crypto.randomUUID(),
        offsetMinutes: offset,
        variants: {
          en: { text: `Step ${i + 1}` },
          uk: { text: `Step in Ukrainian ${i + 1}` },
        },
      })),
    };
  }
  function batch(id: string) {
    const message = {
      id: crypto.randomUUID(),
      body: { testDeliveryId: id },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    return {
      message,
      value: { messages: [message] } as unknown as MessageBatch<unknown>,
    };
  }
  async function job(run: CampaignTest) {
    await repo.materialize(now);
    return (await repo.deliveries(run.id)).at(-1)!;
  }
  async function start(
    content = campaign(),
    mode: "real" | "fast" = "fast",
    language: "en" | "ua" = "en",
  ) {
    return (await repo.start(
      owner,
      crypto.randomUUID(),
      content,
      mode,
      language,
      now,
    ))!;
  }
  beforeEach(async () => {
    now = 1_900_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    database = createTestDatabase();
    setup = setupBot(database.db);
    users = new CourseRepository(setup.env);
    repo = new CampaignTestRepository(database.db);
    await setup.bot.handleUpdate(command("/start", 100));
    owner = database.sqlite.prepare("SELECT id FROM users").get()!.id as string;
    await setup.bot.handleUpdate(command("/start", 300, 2));
    sendBatch = vi.fn().mockResolvedValue(undefined);
    setup.env.COURSE_QUEUE = { sendBatch } as unknown as Queue;
  });
  afterEach(() => {
    database.sqlite.close();
    vi.restoreAllMocks();
  });

  it("runs through Cron and queue with fixed content and language, without changing live campaigns or users", async () => {
    const content = campaign();
    const run = await start(content, "fast", "ua");
    expect(run.locale).toBe("ua");
    expect((await repo.get(run.id))!.locale).toBe("ua");
    expect((await repo.latest(owner))!.locale).toBe("ua");
    content.steps[0]!.variants.uk!.text = "Edited after start";
    await runScheduled(setup.env);
    const first = (await repo.deliveries(run.id))[0]!;
    expect(sendBatch).toHaveBeenCalledWith([
      { body: { testDeliveryId: first.id }, delaySeconds: 0 },
    ]);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 44 });
    const api = { sendMessage } as unknown as Api;
    const delivery = batch(first.id);
    await deliverBatch(delivery.value, setup.env, api);
    await deliverBatch(delivery.value, setup.env, api);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
      100,
      "Step in Ukrainian 1",
      {},
    );
    expect((await repo.get(run.id))!.step).toBe(1);
    expect((await repo.get(run.id))!.due_at).toBe(now + 2_000);
    expect(await repo.deliveries(run.id)).toHaveLength(2);
    expect(sendBatch).toHaveBeenLastCalledWith([
      {
        body: { testDeliveryId: (await repo.deliveries(run.id))[1]!.id },
        delaySeconds: 2,
      },
    ]);
    now += 2_000;
    await deliverBatch(
      batch((await repo.deliveries(run.id))[1]!.id).value,
      setup.env,
      api,
    );
    expect(sendMessage).toHaveBeenLastCalledWith(
      100,
      "Step in Ukrainian 2",
      {},
    );
    expect((await repo.get(run.id))!.state).toBe("completed");
    for (const table of [
      "campaigns",
      "enrollments",
      "deliveries",
      "broadcast_runs",
    ])
      expect(
        database.sqlite.prepare(`SELECT * FROM ${table}`).all(),
      ).toHaveLength(0);
    expect(await users.getUser(owner)).toMatchObject({
      is_admin: 1,
      started_at: null,
      last_delivery_at: 0,
    });
  });

  it("uses real offsets from test start and enforces normal spacing for equal offsets", async () => {
    const run = await start(campaign([5, 5, 1440]), "real");
    await repo.materialize(now);
    expect(await repo.deliveries(run.id)).toHaveLength(0);
    now += 300_000;
    const first = await job(run);
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    } as unknown as Api;
    await deliverBatch(batch(first.id).value, setup.env, api);
    expect((await repo.get(run.id))!.due_at).toBe(now + 60_000);
    now += 60_000;
    await deliverBatch(batch((await job(run)).id).value, setup.env, api);
    expect((await repo.get(run.id))!.due_at).toBe(
      run.started_at + 1440 * 60_000,
    );
  });

  it("respects a future broadcast time and supports accelerated tests of past broadcasts", async () => {
    const content = {
      ...campaign([0]),
      kind: "broadcast" as const,
      scheduledAt: now + 3_600_000,
    };
    const run = await start(content, "real");
    await repo.materialize(now);
    expect(await repo.deliveries(run.id)).toHaveLength(0);
    now = content.scheduledAt;
    expect((await job(run)).available_at).toBe(now);
    await repo.cancel(run.id, owner);
    expect(await repo.start(owner, "past", content, "real", "en")).toBeNull();
    expect(
      await repo.start(owner, "past-fast", content, "fast", "en"),
    ).toMatchObject({ due_at: now });
  });

  it("keeps the snapshot across restarts, allows one active run per admin and deduplicates start requests", async () => {
    const content = campaign();
    const run = (await repo.start(owner, "update", content, "fast", "en"))!;
    expect((await repo.start(owner, "update", content, "fast", "en"))!.id).toBe(
      run.id,
    );
    expect(
      (await repo.start(owner, "another", campaign(), "real", "ua"))!.id,
    ).toBe(run.id);
    expect(await new CampaignTestRepository(database.db).latest(owner)).toEqual(
      run,
    );
    await setup.bot.handleUpdate(command("/start", 200, 3));
    const secondAdmin = database.sqlite
      .prepare("SELECT id FROM users WHERE is_admin = 1 AND id != ?")
      .get(owner)!.id as string;
    expect(
      (await repo.start(secondAdmin, "other", content, "fast", "en"))!.owner_id,
    ).toBe(secondAdmin);
    await repo.cancel(run.id, owner);
    expect(
      (await repo.start(owner, "update", content, "fast", "en"))!.state,
    ).toBe("cancelled");
    expect((await start()).id).not.toBe(run.id);
  });

  it("rejects ordinary users, foreign test controls and stale draft buttons", async () => {
    const campaigns = new CampaignRepository(database.db);
    const nonce = crypto.randomUUID();
    await campaigns.saveDraft(owner, nonce, 0, {
      campaign: campaign(),
      stage: "menu",
    });
    await setup.bot.handleUpdate(callback(`ct:fast:${nonce}:1`, 300, 4));
    expect(setup.calls.at(-1)!.payload.text).toBe(catalogs.en.denied);
    await setup.bot.handleUpdate(callback(`ct:fast:${nonce}:2`, 100, 5));
    expect(setup.calls.at(-1)!.payload.text).toBe(catalogs.en.conflict);
    expect(await repo.latest(owner)).toBeNull();
    const run = await start();
    await setup.bot.handleUpdate(callback(`ct:stop:${run.id}`, 200, 6));
    expect((await repo.get(run.id))!.state).toBe("active");
    expect(setup.calls.at(-1)!.payload.text).not.toContain("Private rehearsal");
    const standard = database.sqlite
      .prepare("SELECT id FROM users WHERE is_admin = 0")
      .get()!.id as string;
    expect(
      await repo.start(standard, "forged", campaign(), "fast", "en"),
    ).toBeNull();
  });

  it.each(["en", "ua"] as const)(
    "starts from a draft without publishing and renders %s test controls",
    async (language) => {
      await setup.bot.handleUpdate(callback(`locale:${language}`, 100, 4));
      const campaigns = new CampaignRepository(database.db);
      const nonce = crypto.randomUUID();
      await campaigns.saveDraft(owner, nonce, 0, {
        campaign: campaign(),
        stage: "menu",
        selected: 0,
        language,
        adding: false,
      });
      await setup.bot.handleUpdate(callback(`d:test:${nonce}:1`, 100, 5));
      expect(setup.calls.at(-1)!.method).toBe("sendPhoto");
      expect(lastCampaignReport().subtitle).toBe(
        catalogs[language].reportTestCampaign,
      );
      expect(lastCampaignReport().rows).toHaveLength(2);
      const options = setup.calls.at(-1)!.payload;
      expect(options.caption).toBe(catalogs[language].testConfirm);
      expect(options.caption.split("\n")).toHaveLength(5);
      expect(options.caption.length).toBeLessThanOrEqual(1024);
      expect(options.reply_markup.inline_keyboard.slice(0, 2)).toEqual([
        [
          {
            text: catalogs[language].testFast,
            callback_data: `ct:fast:${nonce}:1`,
          },
        ],
        [
          {
            text: catalogs[language].testReal,
            callback_data: `ct:real:${nonce}:1`,
          },
        ],
      ]);
      expect(await repo.latest(owner)).toBeNull();
      await setup.bot.handleUpdate(callback(`ct:fast:${nonce}:1`, 100, 7));
      const run = (await repo.latest(owner))!;
      expect(run.locale).toBe(language);
      expect(sendBatch).toHaveBeenCalledOnce();
      await setup.bot.handleUpdate(command("/test", 100, 8, language));
      expect(setup.calls.at(-1)!.method).toBe("sendPhoto");
      expect(lastCampaignReport().fields).toContainEqual({
        label: catalogs[language].testProgress,
        value: "0/2",
      });
      expect(
        database.sqlite.prepare("SELECT * FROM campaigns").all(),
      ).toHaveLength(0);
      expect(await campaigns.draft(owner)).not.toBeNull();
      await setup.bot.handleUpdate(callback(`ct:stop:${run.id}`, 100, 9));
      expect((await repo.get(run.id))!.state).toBe("cancelled");
    },
  );

  it.each(["cancel", "revoke", "block"])(
    "prevents queued sends after %s",
    async (reason) => {
      const run = await start();
      const delivery = await job(run);
      if (reason === "cancel") await repo.cancel(run.id, owner);
      if (reason === "revoke") setup.env.ADMIN_USER_IDS = [200];
      if (reason === "block") await users.setBlocked(100, true, now);
      const sendMessage = vi.fn();
      const queued = batch(delivery.id);
      await deliverBatch(queued.value, setup.env, {
        sendMessage,
      } as unknown as Api);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(queued.message.ack).toHaveBeenCalledOnce();
      expect((await repo.get(run.id))!.state).toBe("cancelled");
    },
  );

  it("rechecks cancellation immediately before sending", async () => {
    const run = await start();
    const delivery = await job(run);
    const original = CampaignTestRepository.prototype.get;
    let reads = 0;
    vi.spyOn(CampaignTestRepository.prototype, "get").mockImplementation(
      async function (this: CampaignTestRepository, id) {
        if (++reads === 2) await repo.cancel(run.id, owner);
        return original.call(this, id);
      },
    );
    const sendMessage = vi.fn();
    await deliverBatch(batch(delivery.id).value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(sendMessage).not.toHaveBeenCalled();
    expect((await repo.deliveries(run.id))[0]!.state).toBe("skipped");
  });

  it.each(["photo", "video"] as const)(
    "uses verified %s media and language fallback",
    async (type) => {
      const input = {
        type,
        fileId: "saved-file",
        uniqueId: "unique",
        width: 100,
        height: 100,
        duration: 5,
      };
      const asset = await users.saveMedia(owner, 12345, input);
      await users.verifyMedia(asset, input);
      const content = campaign([0]);
      content.steps[0]!.variants.en = { text: "Caption", mediaId: asset.id };
      delete content.steps[0]!.variants.uk;
      const run = await start(content, "fast", "ua");
      const file = {
        file_id: "fresh-file",
        file_unique_id: "unique",
        width: 100,
        height: 100,
        duration: 5,
      };
      const send = vi.fn().mockResolvedValue({
        message_id: 42,
        ...(type === "photo" ? { photo: [file] } : { video: file }),
      });
      await deliverBatch(batch((await job(run)).id).value, setup.env, {
        [type === "photo" ? "sendPhoto" : "sendVideo"]: send,
      } as unknown as Api);
      expect(send).toHaveBeenCalledWith(100, "saved-file", {
        caption: "Caption",
      });
      expect((await repo.get(run.id))!.state).toBe("completed");
      expect(await users.mediaFileId((await users.getMedia(asset.id))!)).toBe(
        "fresh-file",
      );
    },
  );

  it.each(["transient", "unknown", "permanent"])(
    "records a %s send outcome without advancing",
    async (kind) => {
      const run = await start();
      const queued = batch((await job(run)).id);
      const error =
        kind === "unknown"
          ? new Error("connection lost")
          : new GrammyError(
              "Rejected",
              {
                ok: false,
                error_code: kind === "transient" ? 429 : 400,
                description: "Rejected",
                parameters: { retry_after: 30 },
              },
              "sendMessage",
              {},
            );
      const sendMessage = vi.fn().mockRejectedValue(error);
      await deliverBatch(queued.value, setup.env, {
        sendMessage,
      } as unknown as Api);
      expect((await repo.get(run.id))!.step).toBe(0);
      expect((await repo.deliveries(run.id))[0]!.state).toBe(
        kind === "transient"
          ? "pending"
          : kind === "unknown"
            ? "unknown"
            : "failed",
      );
      if (kind === "transient")
        expect(queued.message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
      else {
        await deliverBatch(queued.value, setup.env, {
          sendMessage,
        } as unknown as Api);
        expect(sendMessage).toHaveBeenCalledOnce();
      }
    },
  );

  it("holds expired send leases and retries queue dispatch after a failed enqueue", async () => {
    const run = await start();
    const delivery = await job(run);
    sendBatch.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(repo.dispatch(setup.env.COURSE_QUEUE!, now)).rejects.toThrow();
    await repo.dispatch(setup.env.COURSE_QUEUE!, now);
    expect(sendBatch).toHaveBeenCalledTimes(2);
    await repo.claim(delivery.id, crypto.randomUUID(), now);
    now += 60_001;
    await repo.materialize(now);
    expect((await repo.deliveries(run.id))[0]!.state).toBe("unknown");
    expect((await repo.get(run.id))!.step).toBe(0);
  });

  it("fences a draft changed between confirmation and insertion", async () => {
    const campaigns = new CampaignRepository(database.db);
    const nonce = crypto.randomUUID();
    const content = campaign();
    await campaigns.saveDraft(owner, nonce, 0, {
      campaign: content,
      stage: "menu",
    });
    await campaigns.saveDraft(owner, nonce, 1, {
      campaign: { ...content, title: "Changed" },
      stage: "menu",
    });
    expect(
      await repo.start(owner, "stale", content, "fast", "en", now, {
        nonce,
        revision: 1,
      }),
    ).toBeNull();
    expect(await repo.latest(owner)).toBeNull();
  });

  it("completes a quick test from the editor without any Cron triggers or language prompt", async () => {
    const campaigns = new CampaignRepository(database.db);
    const nonce = crypto.randomUUID();
    await campaigns.saveDraft(owner, nonce, 0, {
      campaign: campaign([0, 60, 1440]),
      stage: "menu",
      selected: 0,
      language: "en",
    });
    await setup.bot.handleUpdate(callback(`d:test:${nonce}:1`, 100, 5));
    const buttons = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
    expect(buttons).toContain(`ct:fast:${nonce}:1`);
    expect(buttons).not.toContain("ct:choose");
    await setup.bot.handleUpdate(callback(`ct:fast:${nonce}:1`, 100, 6));
    const run = (await repo.latest(owner))!;
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 5 });
    for (let step = 0; step < 3; step++) {
      const queued = sendBatch.mock.calls[step]![0][0];
      expect(queued.delaySeconds).toBe(step ? 2 : 0);
      now += queued.delaySeconds * 1000;
      await deliverBatch(batch(queued.body.testDeliveryId).value, setup.env, {
        sendMessage,
      } as unknown as Api);
    }
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect((await repo.get(run.id))!.state).toBe("completed");
    await setup.bot.handleUpdate(callback(`ct:status:${run.id}`, 100, 7));
    const status = JSON.stringify(lastCampaignReport());
    expect(status).toContain("Europe/Berlin");
    expect(status).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("recovers a failed quick continuation without re-sending the previous message", async () => {
    const run = await start();
    const queued = batch((await job(run)).id);
    sendBatch.mockRejectedValueOnce(new Error("queue unavailable"));
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 9 });
    await deliverBatch(queued.value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(queued.message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect((await repo.deliveries(run.id))[0]!.state).toBe("sent");
    now += 5_000;
    await deliverBatch(queued.value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(queued.message.ack).toHaveBeenCalledOnce();
  });

  it("retries an early quick queue message and preserves its due time", async () => {
    const run = await start();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    await deliverBatch(batch((await job(run)).id).value, setup.env, {
      sendMessage,
    } as unknown as Api);
    const early = batch((await repo.deliveries(run.id))[1]!.id);
    await deliverBatch(early.value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(early.message.retry).toHaveBeenCalledWith({ delaySeconds: 2 });
    expect(early.message.ack).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("adds a message directly and offers translations only as an optional action", async () => {
    const campaigns = new CampaignRepository(database.db);
    const nonce = crypto.randomUUID();
    await campaigns.saveDraft(owner, nonce, 0, {
      campaign: campaign([0]),
      stage: "menu",
      selected: 0,
      language: "en",
    });
    await setup.bot.handleUpdate(callback(`d:resume:${nonce}:1`, 100, 5));
    const keyboard = JSON.stringify(setup.calls.at(-1)!.payload.reply_markup);
    expect(keyboard).toContain(`d:add:${nonce}:1`);
    expect(keyboard).not.toMatch(/d:lang/);
    await setup.bot.handleUpdate(callback(`d:translations:${nonce}:1`, 100, 6));
    const translations = JSON.stringify(
      setup.calls.at(-1)!.payload.reply_markup,
    );
    expect(translations).toContain("Українська");
    expect(translations).toContain("English");
    expect(translations).not.toContain("Polski");
    await setup.bot.handleUpdate(callback(`d:add:${nonce}:1`, 100, 7));
    expect(setup.calls.at(-1)!.payload.text).toBe(catalogs.en.enterMessageName);
    expect(
      JSON.parse((await campaigns.draft(owner))!.content_json),
    ).toMatchObject({ stage: "name", adding: true });
  });

  it("records an in-flight success without undoing cancellation", async () => {
    const run = await start();
    const delivery = await job(run);
    const sendMessage = vi.fn().mockImplementation(async () => {
      await repo.cancel(run.id, owner);
      return { message_id: 47 };
    });
    await deliverBatch(batch(delivery.id).value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect((await repo.get(run.id))!.state).toBe("cancelled");
    expect((await repo.deliveries(run.id))[0]!.state).toBe("sent");
    await setup.bot.handleUpdate(command("/test", 100, 5));
    expect(lastCampaignReport().fields).toContainEqual({
      label: "Messages sent",
      value: "1/2",
    });
    now += 120_000;
    await repo.materialize(now);
    expect(await repo.deliveries(run.id)).toHaveLength(1);
  });

  it("holds invalid media before sending and keeps uncertain database commits from being resent", async () => {
    const content = campaign([0]);
    content.steps[0]!.variants.en!.mediaId = crypto.randomUUID();
    const run = await start(content);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 45 });
    await deliverBatch(batch((await job(run)).id).value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(sendMessage).not.toHaveBeenCalled();
    expect((await repo.deliveries(run.id))[0]!.state).toBe("failed");
    await repo.cancel(run.id, owner);
    const next = await start(campaign([0]));
    const queued = batch((await job(next)).id);
    vi.spyOn(
      CampaignTestRepository.prototype,
      "complete",
    ).mockRejectedValueOnce(new Error("db unavailable"));
    await deliverBatch(queued.value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect((await repo.deliveries(next.id))[0]!.state).toBe("unknown");
    await deliverBatch(queued.value, setup.env, {
      sendMessage,
    } as unknown as Api);
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
