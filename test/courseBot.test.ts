import {
  createTestDatabase,
  setupBot,
  command,
  callback,
  testBindings,
} from "./courseTestUtils.js";
import { CourseRepository } from "../src/repositories/courseRepository.js";
import { catalogs, detectLocale } from "../src/bot/i18n.js";
import { parseCallback } from "../src/utils/callbackParser.js";
import { validateEnv } from "../src/schemas/envSchema.js";
import { createWorker } from "../src/index.js";
import { CampaignRepository } from "../src/repositories/campaignRepository.js";
import type { Update } from "grammy/types";

describe("course bot", () => {
  let database: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    database = createTestDatabase();
  });
  afterEach(() => {
    database.sqlite.close();
  });

  it.each(["en", "ua"])(
    "starts and renders the %s interface",
    async (locale) => {
      const { bot, calls } = setupBot(database.db);
      await bot.handleUpdate(command("/start", 300, 1, locale));
      expect(calls.at(-1)?.payload.text).toBe(
        catalogs[locale as keyof typeof catalogs].welcome,
      );
      expect(
        database.sqlite.prepare("SELECT started_at FROM users").get()
          ?.started_at,
      ).toBeTruthy();
    },
  );

  it.each(["ua", "uk"])(
    "preserves stop and supports explicit language selection through %s",
    async (locale) => {
      const { bot, calls } = setupBot(database.db);
      await bot.handleUpdate(command("/start", 300, 1));
      await bot.handleUpdate(command("/stop", 300, 2));
      await bot.handleUpdate(command("/start", 300, 3));
      expect(
        database.sqlite.prepare("SELECT opted_out FROM users").get()?.opted_out,
      ).toBe(1);
      await bot.handleUpdate(callback(`locale:${locale}`, 300, 4));
      await bot.handleUpdate(command("/help", 300, 5, "en"));
      expect(calls.at(-1)?.payload.text).toBe(catalogs.ua.help);
    },
  );

  it.each([100, 200])(
    "authorizes admin %i and sends the user report as a text file",
    async (admin) => {
      const { bot, calls } = setupBot(database.db);
      await bot.handleUpdate(command("/start", 300));
      await bot.handleUpdate(command("/start", admin, 2));
      await bot.handleUpdate(command("/users", admin, 3));
      const document = calls.find((c) => c.method === "sendDocument")!;
      expect(document.payload.document.filename).toBe("users-all.txt");
      const report = new TextDecoder().decode(
        await document.payload.document.toRaw(),
      );
      expect(report).toContain("@test_user");
      expect(report).toContain("First interaction");
      expect(report).toContain("Last interaction");
      expect(report).toContain("Language");
      expect(calls.some((c) => c.method === "sendRichMessage")).toBe(false);
      expect(JSON.stringify(document.payload.reply_markup)).not.toContain(
        "user:",
      );
      expect(
        database.sqlite
          .prepare("SELECT started_at FROM users WHERE is_admin = 1")
          .get()?.started_at,
      ).toBeNull();
    },
  );

  it("rejects admin commands and forged callbacks from ordinary users", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(command("/users"));
    await bot.handleUpdate(callback("users:all:0", 300, 2));
    await bot.handleUpdate(callback("c:new:sequence", 300, 3));
    expect(
      calls
        .filter((c) => c.method === "sendMessage")
        .every((c) => c.payload.text === catalogs.en.denied),
    ).toBe(true);
    expect(
      calls.filter((c) => c.method === "answerCallbackQuery"),
    ).toHaveLength(2);
    expect(
      database.sqlite.prepare("SELECT * FROM admin_uploads").all(),
    ).toHaveLength(0);
    expect(calls.some((c) => c.method === "sendDocument")).toBe(false);
  });

  it("exports all pages and applies filters, including an empty result", async () => {
    const { bot, calls, env } = setupBot(database.db);
    const repo = new CourseRepository(env);
    for (let i = 0; i < 25; i++) {
      const update = command("/start", 300 + i, i + 1);
      update.message!.from!.first_name = `Person ${i}`;
      await bot.handleUpdate(update);
    }
    await repo.setBlocked(324, true, 1_800_000_100_000);
    await bot.handleUpdate(command("/users", 100, 30));
    const all = calls.at(-1)!.payload.document;
    const report = new TextDecoder().decode(await all.toRaw());
    for (let i = 0; i < 25; i++) expect(report).toContain(`Person ${i}`);
    await bot.handleUpdate(callback("users:blocked:0", 100, 31));
    const blocked = new TextDecoder().decode(
      await calls.at(-1)!.payload.document.toRaw(),
    );
    expect(blocked).toContain("Person 24");
    expect(blocked).not.toContain("Person 0");
    await bot.handleUpdate(callback("users:paid:0", 100, 32));
    expect(
      new TextDecoder().decode(await calls.at(-1)!.payload.document.toRaw()),
    ).toContain(catalogs.en.noUsers);
  });

  it.each(["en", "ua"])(
    "removes obsolete menu controls in %s",
    async (locale) => {
      const { bot, calls } = setupBot(database.db);
      await bot.handleUpdate(command("/menu", 300, 1, locale));
      const menu = JSON.stringify(calls.at(-1)!.payload.reply_markup);
      expect(menu).toContain("nav:my_course");
      expect(menu).not.toContain("nav:course");
      await bot.handleUpdate(command("/admin", 100, 2, locale));
      expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).not.toContain(
        "deliveries:",
      );
      expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).not.toContain(
        "media:",
      );
      for (const data of [
        "nav:course",
        "deliveries:0",
        "user:00000000-0000-4000-8000-000000000000",
        "media:0",
        "upload:begin",
        "upload:cancel:00000000-0000-4000-8000-000000000000",
        "preview:00000000-0000-4000-8000-000000000000",
      ])
        expect(parseCallback(data)).toBeUndefined();
      expect(catalogs[locale as keyof typeof catalogs].help).not.toContain(
        "/course ",
      );
      expect(catalogs[locale as keyof typeof catalogs].adminHelp).not.toContain(
        "/media",
      );
    },
  );

  it("ignores groups and edited commands without writing personal data", async () => {
    const { bot } = setupBot(database.db);
    const group = command("/start");
    group.message!.chat = { id: -1, type: "group", title: "Test" };
    await bot.handleUpdate(group);
    const original = command("/start");
    await bot.handleUpdate({
      update_id: 2,
      edited_message: { ...original.message!, edit_date: 1_800_000_010 },
    });
    expect(database.sqlite.prepare("SELECT * FROM users").all()).toHaveLength(
      0,
    );
  });

  it("records the affected private chat's block status", async () => {
    const { bot } = setupBot(database.db);
    const base = command("/start");
    await bot.handleUpdate(base);
    await bot.handleUpdate({
      update_id: 2,
      my_chat_member: {
        chat: base.message!.chat,
        from: base.message!.from!,
        date: 1_800_000_010,
        old_chat_member: {
          status: "member",
          user: { id: 12345, is_bot: true, first_name: "Bot" },
        },
        new_chat_member: {
          status: "kicked",
          user: { id: 12345, is_bot: true, first_name: "Bot" },
          until_date: 0,
        },
      },
    });
    expect(
      database.sqlite.prepare("SELECT blocked FROM users").get()?.blocked,
    ).toBe(1);
  });

  it("uploads and previews a large video directly in the campaign editor", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(callback("c:new:sequence", 100));
    await bot.handleUpdate(command("Video campaign", 100, 2));
    const draft = () =>
      database.sqlite.prepare("SELECT * FROM campaign_drafts").get()!;
    await bot.handleUpdate(
      callback(`d:add:${draft().nonce}:${draft().revision}`, 100, 3),
    );
    await bot.handleUpdate(command("Welcome video", 100, 4));
    const base = command("/start", 100, 2);
    const upload: Update = {
      update_id: 5,
      message: {
        message_id: 2,
        date: 1_800_000_002,
        chat: base.message!.chat,
        from: base.message!.from!,
        video: {
          file_id: "large_video",
          file_unique_id: "video_unique",
          file_size: 800_000_000,
          width: 1920,
          height: 1080,
          duration: 120,
        },
      },
    };
    await bot.handleUpdate(upload);
    const asset = database.sqlite.prepare("SELECT * FROM media_assets").get()!;
    expect(asset.state).toBe("ready");
    await bot.handleUpdate(
      callback(`d:preview:${draft().nonce}:${draft().revision}`, 100, 6),
    );
    expect(
      calls.filter((c) => c.method === "sendVideo").map((c) => c.payload.video),
    ).toEqual(["large_video", "large_video"]);
    expect(calls.some((c) => c.method === "getFile")).toBe(false);
  });

  it("rejects obsolete media buttons and ignores uploads outside the editors", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(command("/media", 100));
    expect(calls.at(-1)?.payload.text).toBe(catalogs.en.help);
    for (const data of [
      "media:0",
      "upload:begin",
      `preview:${crypto.randomUUID()}`,
    ]) {
      await bot.handleUpdate(callback(data, 100, 2));
      expect(calls.at(-1)?.payload.text).toBe(catalogs.en.expired);
      expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(
        "nav:menu",
      );
    }
    const upload = command("/start", 100, 3);
    delete upload.message!.text;
    delete upload.message!.entities;
    upload.message!.photo = [
      {
        file_id: "orphan_photo",
        file_unique_id: "orphan_unique",
        width: 100,
        height: 100,
      },
    ];
    await bot.handleUpdate(upload);
    expect(calls.at(-1)?.payload.text).toBe(catalogs.en.help);
    expect(
      database.sqlite.prepare("SELECT * FROM media_assets").all(),
    ).toHaveLength(0);
    expect(
      database.sqlite.prepare("SELECT * FROM admin_uploads").all(),
    ).toHaveLength(0);
  });

  it("leaves checkout unavailable and does not fabricate payment state", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(command("/buy"));
    expect(calls.at(-1)?.payload.text).toBe(catalogs.en.checkoutUnavailable);
    expect(
      database.sqlite.prepare("SELECT payment_status FROM users").get()
        ?.payment_status,
    ).toBe("unknown");
  });

  it("keeps menus on cancellations, errors, and ordinary user replies", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(command("/admin", 100, 1));
    expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).not.toContain(
      "ct:latest",
    );
    const repo = new CampaignRepository(database.db);
    const owner = database.sqlite.prepare("SELECT id FROM users").get()!
      .id as string;
    const campaign = {
      id: crypto.randomUUID(),
      title: "Cancel me",
      kind: "sequence" as const,
      baseRevision: 0,
      fallback: "en" as const,
      steps: [
        {
          id: crypto.randomUUID(),
          offsetMinutes: 0,
          variants: { en: { text: "Test" } },
        },
      ],
    };
    await repo.publish(campaign, owner);
    await bot.handleUpdate(callback(`archive:confirm:${campaign.id}`, 100, 2));
    expect(calls.at(-1)!.payload.text).toBe(catalogs.en.cancelled);
    expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).toContain(
      "c:list:sequence",
    );
    for (const update of [
      command("/cancel", 100, 3),
      callback("invalid:button", 100, 4),
      command("/buy", 300, 5),
      command("/my_course", 300, 6),
    ]) {
      await bot.handleUpdate(update);
      expect(
        calls.at(-1)!.payload.reply_markup.inline_keyboard.length,
      ).toBeGreaterThan(0);
    }
  });

  it("offers only named Ukrainian/English languages and handles retired Polish preferences", async () => {
    const { bot, calls } = setupBot(database.db);
    await bot.handleUpdate(command("/language", 300, 1));
    const labels = calls
      .at(-1)!
      .payload.reply_markup.inline_keyboard.flat()
      .map((button: { text: string }) => button.text);
    expect(labels).toEqual(["Українська", "English", catalogs.en.mainMenu]);
    expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).toContain(
      "locale:ua",
    );
    expect(JSON.stringify(calls.at(-1)!.payload.reply_markup)).not.toContain(
      "locale:uk",
    );
    database.sqlite
      .prepare("UPDATE users SET locale = 'pl', locale_explicit = 1")
      .run();
    await bot.handleUpdate(command("/help", 300, 2, "pl"));
    expect(calls.at(-1)!.payload.text).toBe(catalogs.en.help);
    expect(
      database.sqlite.prepare("SELECT locale FROM users").get()!.locale,
    ).toBe("en");
    expect(parseCallback("locale:pl")).toBeUndefined();
  });
});

describe("configuration and translation boundaries", () => {
  it("has identical nonempty translation keys for all supported languages", () => {
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(
        Object.keys(catalogs.en).sort(),
      );
      expect(Object.values(catalog).every((value) => value.length > 0)).toBe(
        true,
      );
    }
    expect(detectLocale("uk-UA")).toBe("ua");
    expect(detectLocale("ua")).toBe("ua");
    expect(detectLocale("pl_PL")).toBe("en");
    expect(detectLocale("fr")).toBe("en");
  });
  it("matches Ukrainian emojis in the English catalog", () => {
    const emojis = (value: string) =>
      value.match(
        /[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?/gu,
      ) ?? [];
    for (const key of Object.keys(
      catalogs.ua,
    ) as (keyof typeof catalogs.ua)[]) {
      expect(emojis(catalogs.en[key]), key).toEqual(emojis(catalogs.ua[key]));
    }
  });
  it("rejects malformed callback data", () => {
    for (const value of [
      "users:any:0",
      "users:all:-1",
      "users:all:1e3",
      "locale:fr",
      "preview:abc",
      "nav:admin:extra",
    ])
      expect(parseCallback(value)).toBeUndefined();
  });
  it("validates configuration without leaking secrets and supports the old admin key", () => {
    const database = createTestDatabase();
    try {
      const raw = testBindings(database.db);
      expect(validateEnv(raw).ADMIN_USER_IDS).toEqual([100, 200]);
      expect(
        validateEnv({ ...raw, ADMIN_USER_IDS: undefined, ADMIN_USER_ID: "100" })
          .ADMIN_USER_IDS,
      ).toEqual([100]);
      expect(
        validateEnv({ ...raw, ADMIN_USER_IDS: "" }).ADMIN_USER_IDS,
      ).toEqual([]);
      for (const changes of [
        { ADMIN_USER_IDS: "100,100" },
        { ADMIN_USER_IDS: "", APP_ENV: "production" },
        { ENCRYPTION_KEY: "sensitive_bad_key" },
        { CAMPAIGN_TIMEZONE: "invalid" },
        { COURSE_WEBSITE_URL: "http://example.com" },
      ]) {
        expect(() => validateEnv({ ...raw, ...changes })).toThrow(
          "Course bot configuration is incomplete or invalid",
        );
      }
    } finally {
      database.sqlite.close();
    }
  });
});

describe("Worker webhook", () => {
  let database: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    database = createTestDatabase();
  });
  afterEach(() => {
    database.sqlite.close();
  });
  function request(
    body: unknown,
    secret: string = String(testBindings(database.db).TELEGRAM_WEBHOOK_SECRET),
  ) {
    return new Request("https://example.com/telegram/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(body),
    });
  }

  it("authenticates and deduplicates updates before invoking the bot", async () => {
    const setup = setupBot(database.db);
    const factory = vi.fn(() => setup.bot);
    const worker = createWorker(factory);
    const env = testBindings(database.db);
    expect(
      (await worker.fetch(request(command("/start"), "incorrect"), env)).status,
    ).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    expect((await worker.fetch(request(command("/start")), env)).status).toBe(
      200,
    );
    expect((await worker.fetch(request(command("/start")), env)).status).toBe(
      200,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("responds with a retry when a lease is held and retries failures without logging PII", async () => {
    const setup = setupBot(database.db);
    const repo = new CourseRepository(setup.env);
    await repo.claimUpdate(1, "busy");
    const worker = createWorker(() => setup.bot);
    expect(
      (
        await worker.fetch(
          request(command("/start")),
          testBindings(database.db),
        )
      ).status,
    ).toBe(503);
    await repo.releaseUpdate(1, "busy");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = vi
      .spyOn(setup.bot, "handleUpdate")
      .mockRejectedValueOnce(new Error("private_token raw_user_name"));
    try {
      expect(
        (
          await worker.fetch(
            request(command("/start")),
            testBindings(database.db),
          )
        ).status,
      ).toBe(503);
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /private_token|raw_user_name/,
      );
      expect(
        (
          await worker.fetch(
            request(command("/start")),
            testBindings(database.db),
          )
        ).status,
      ).toBe(200);
      expect(handle).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("validates payloads, methods and readiness", async () => {
    const worker = createWorker();
    const env = testBindings(database.db);
    expect((await worker.fetch(request({ update_id: -1 }), env)).status).toBe(
      400,
    );
    expect(
      (
        await worker.fetch(
          request({ update_id: 1, payload: "x".repeat(600_000) }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await worker.fetch(
          new Request("https://example.com/telegram/webhook"),
          env,
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request("https://example.com/stripe/webhook", { method: "POST" }),
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (await worker.fetch(new Request("https://example.com/ready"), env))
        .status,
    ).toBe(200);
  });
});
