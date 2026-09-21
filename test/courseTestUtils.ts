import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { validateEnv, type Bindings } from "../src/schemas/envSchema.js";
import { createBot } from "../src/bot/createBot.js";
import type { Update, UserFromGetMe } from "grammy/types";
import { renderCampaignReport } from "../src/bot/ui/campaignReportImage.js";

vi.mock("../src/bot/ui/campaignReportImage.js", () => ({
  renderCampaignReport: vi
    .fn()
    .mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
}));

export function lastCampaignReport() {
  return vi.mocked(renderCampaignReport).mock.lastCall![0];
}

export function createTestDatabase(includeEditorMigration = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new NodeURL("../migrations/0001_foundation.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new NodeURL("../migrations/0002_campaigns.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new NodeURL("../migrations/0003_campaign_tests.sql", import.meta.url),
      "utf8",
    ),
  );
  if (includeEditorMigration)
    sqlite.exec(
      readFileSync(
        new NodeURL(
          "../migrations/0004_scheduled_message_editor.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  class Statement {
    constructor(
      readonly sql: string,
      readonly params: (string | number | null)[] = [],
    ) {}
    bind(...params: (string | number | null)[]) {
      return new Statement(this.sql, params);
    }
    async first<T>() {
      return (sqlite.prepare(this.sql).get(...this.params) ?? null) as T | null;
    }
    async all<T>() {
      return {
        results: sqlite.prepare(this.sql).all(...this.params) as T[],
        success: true,
        meta: {},
      };
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.params);
      return {
        results: [],
        success: true,
        meta: { changes: Number(result.changes) },
      };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

export function testBindings(db: D1Database): Bindings {
  return {
    COURSE_DB: db,
    BOT_TOKEN: "12345:test_token_that_is_not_a_real_secret",
    TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret_".repeat(3),
    USER_HASH_SECRET: "test_hash_secret_".repeat(3),
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    ADMIN_USER_IDS: "100,200",
    APP_ENV: "test",
  };
}

export const botInfo: UserFromGetMe = {
  id: 12345,
  is_bot: true,
  first_name: "Test course bot",
  username: "course_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export function command(
  text: string,
  userId = 300,
  updateId = 1,
  language = "en",
): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_800_000_000 + updateId,
      chat: { id: userId, type: "private", first_name: "Test" },
      from: {
        id: userId,
        is_bot: false,
        first_name: "Test User",
        username: "test_user",
        language_code: language,
      },
      text,
      entities: [
        { type: "bot_command", offset: 0, length: text.split(" ")[0]!.length },
      ],
    },
  };
}

export function callback(data: string, userId = 300, updateId = 1): Update {
  const base = command("/start", userId, updateId);
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: base.message!.from!,
      chat_instance: "test",
      data,
      message: { ...base.message!, from: botInfo },
    },
  };
}

export function setupBot(db: D1Database) {
  const env = validateEnv(testBindings(db));
  const bot = createBot(env, { botInfo });
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const input = payload as any;
    const result: any = {
      message_id: calls.length,
      date: 1_800_000_000,
      chat: { id: input.chat_id ?? 300, type: "private" },
    };
    if (method === "sendPhoto")
      result.photo = [
        {
          file_id: input.photo,
          file_unique_id: "photo_unique",
          width: 1200,
          height: 800,
        },
      ];
    if (method === "sendVideo")
      result.video = {
        file_id: input.video,
        file_unique_id: "video_unique",
        width: 1920,
        height: 1080,
        duration: 120,
      };
    return {
      ok: true,
      result: method === "answerCallbackQuery" ? true : result,
    } as any;
  });
  return { env, bot, calls };
}
