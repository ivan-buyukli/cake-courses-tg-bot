import { createTestDatabase, testBindings } from "./courseTestUtils.js";
import {
  CourseRepository,
  USER_REPORT_PAGE_SIZE,
} from "../src/repositories/courseRepository.js";
import { validateEnv } from "../src/schemas/envSchema.js";

describe("course repository on SQLite", () => {
  let database: ReturnType<typeof createTestDatabase>;
  let repo: CourseRepository;
  beforeEach(() => {
    database = createTestDatabase();
    repo = new CourseRepository(validateEnv(testBindings(database.db)));
  });
  afterEach(() => {
    database.sqlite.close();
  });
  const identity = {
    telegramId: 34567891,
    chatId: 34567891,
    firstName: "Private Person",
    username: "private_account",
  };

  it("encrypts identities, deduplicates users, and refreshes their profile", async () => {
    const user = await repo.touchUser(identity, "uk-UA", 1000);
    const again = await repo.touchUser(
      { ...identity, firstName: "New Name", username: undefined },
      "uk",
      2000,
    );
    expect(again.id).toBe(user.id);
    expect(user.locale).toBe("ua");
    expect(again.locale).toBe("ua");
    expect((await repo.userReportPage("all")).users[0]!.locale).toBe("ua");
    expect(await repo.identity(again)).toEqual({
      ...identity,
      firstName: "New Name",
      username: undefined,
    });
    const stored = JSON.stringify(
      database.sqlite.prepare("SELECT * FROM users").all(),
    );
    for (const value of [
      "Private Person",
      "New Name",
      "private_account",
      "34567891",
    ])
      expect(stored).not.toContain(value);
  });

  it("keeps explicit language across updates and rejects older preferences", async () => {
    const user = await repo.touchUser(identity, "en", 1000);
    await repo.setLocale(user.id, "ua", 2000, 2);
    await repo.setLocale(user.id, "en", 2000, 1);
    const again = await repo.touchUser(identity, "en", 3000);
    expect(again.locale).toBe("ua");
    expect(again.locale_explicit).toBe(1);
  });

  it("starts once without resetting opt-out and does not enroll admins", async () => {
    const user = await repo.touchUser(identity, "en", 1000);
    await repo.start(user.id);
    const first = await repo.getUser(user.id);
    await repo.setOptOut(user.id, true, 2000, 2);
    await repo.start(user.id);
    await repo.setOptOut(user.id, false, 1000, 1);
    const again = await repo.getUser(user.id);
    expect(again?.started_at).toBe(first?.started_at);
    expect(again?.opted_out).toBe(1);
    const admin = await repo.touchUser(
      { ...identity, telegramId: 100, chatId: 100 },
      "en",
      1000,
    );
    await repo.start(admin.id);
    expect((await repo.getUser(admin.id))?.started_at).toBeNull();
  });

  it("does not clear purchase suppression when resuming", async () => {
    const user = await repo.touchUser(identity, "en", 1000);
    database.sqlite
      .prepare(
        "UPDATE users SET purchase_suppressed = 1, payment_status = 'paid' WHERE id = ?",
      )
      .run(user.id);
    await repo.setOptOut(user.id, false, 3000, 3);
    expect((await repo.getUser(user.id))?.purchase_suppressed).toBe(1);
  });

  it("preserves a newer blocking event when an older message is retried", async () => {
    const user = await repo.touchUser(identity, "en", 1000);
    await repo.setBlocked(identity.telegramId, true, 3000);
    await repo.touchUser(identity, "en", 2000);
    expect((await repo.getUser(user.id))?.blocked).toBe(1);
    await repo.setBlocked(identity.telegramId, false, 4000);
    expect((await repo.getUser(user.id))?.blocked).toBe(0);
  });

  it("bounds reports and pages by a stable cutoff, including filters", async () => {
    database.sqlite.exec(`
      WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 1001)
      INSERT INTO users(id, user_key, identity_cipher, locale, is_admin, first_seen_at, last_seen_at, profile_event_at, reachability_event_at)
      SELECT 'fixture-' || n, 'key-' || n, 'unused-cipher', 'uk', 0, 1000, 1000, 1000, 1000 FROM numbers;
      INSERT INTO user_ordinals(user_id) SELECT id FROM users ORDER BY id;
    `);
    const queries = vi.spyOn(database.db, "prepare");
    const first = await repo.userReportPage("all");
    expect(queries).toHaveBeenCalledTimes(2);
    await repo.touchUser(identity, "en", 2000);
    queries.mockClear();
    const second = await repo.userReportPage("all", {
      after: first.nextAfter!,
      cutoff: first.cutoff,
    });
    expect(queries).toHaveBeenCalledTimes(1);
    queries.mockRestore();
    const third = await repo.userReportPage("all", {
      after: second.nextAfter!,
      cutoff: first.cutoff,
    });
    expect(first.users).toHaveLength(USER_REPORT_PAGE_SIZE);
    expect(second.users).toHaveLength(USER_REPORT_PAGE_SIZE);
    expect(third.users).toHaveLength(1);
    expect(third.nextAfter).toBeUndefined();
    expect(
      new Set(
        [...first.users, ...second.users, ...third.users].map((u) => u.id),
      ).size,
    ).toBe(1001);
    database.sqlite
      .prepare("UPDATE users SET blocked = 1 WHERE id = ?")
      .run(third.users[0]!.id);
    const blocked = await repo.userReportPage("blocked");
    expect(blocked.users).toHaveLength(1);
    expect(blocked.nextAfter).toBeUndefined();
    expect((await repo.userReportPage("paid")).users).toHaveLength(0);
  });

  it("claims an update once and fences an old lease", async () => {
    expect(await repo.claimUpdate(7, "a")).toBe("claimed");
    expect(await repo.claimUpdate(7, "b")).toBe("busy");
    await repo.releaseUpdate(7, "wrong");
    expect(await repo.claimUpdate(7, "b")).toBe("busy");
    await repo.releaseUpdate(7, "a");
    expect(await repo.claimUpdate(7, "b")).toBe("claimed");
    await repo.finishUpdate(7, "a");
    expect(await repo.claimUpdate(7, "c")).toBe("busy");
    await repo.finishUpdate(7, "b");
    expect(await repo.claimUpdate(7, "c")).toBe("done");
  });

  it("stores large media as encrypted references and validates with a returned ID", async () => {
    const user = await repo.touchUser(
      { ...identity, telegramId: 100 },
      "en",
      1000,
    );
    const input = {
      type: "video" as const,
      fileId: "secret_file",
      uniqueId: "video_unique",
      width: 1920,
      height: 1080,
      size: 800_000_000,
      duration: 100,
    };
    const asset = await repo.saveMedia(user.id, 12345, input);
    expect(asset.state).toBe("pending");
    expect(asset.file_id_cipher).not.toContain("secret_file");
    expect(await repo.mediaFileId(asset)).toBe("secret_file");
    await repo.verifyMedia(asset, { ...input, fileId: "new_file" });
    const current = (await repo.getMedia(asset.id))!;
    expect(current.state).toBe("ready");
    expect(await repo.mediaFileId(current)).toBe("new_file");
    const repeated = await repo.saveMedia(user.id, 12345, input);
    expect(repeated.id).toBe(asset.id);
    await repo.verifyMedia(current, input);
    expect((await repo.getMedia(asset.id))?.state).toBe("pending");
    await expect(
      repo.verifyMedia(repeated, { ...input, uniqueId: "other" }),
    ).rejects.toThrow("Media identity mismatch");
    expect(
      database.sqlite.prepare("SELECT * FROM audit_events").all(),
    ).toHaveLength(2);
  });
});
