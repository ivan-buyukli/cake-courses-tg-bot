import { hashUserId } from "../crypto/userHash.js";
import { seal, open } from "../crypto/privacy.js";
import { detectLocale, isoLanguageCode, type Locale } from "../bot/i18n.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import type {
  Identity,
  UserRecord,
  MediaInput,
  MediaRecord,
} from "../models/course.js";

export const PAGE_SIZE = 8;
export const userFilters = ["all", "blocked", "stopped", "paid"] as const;
export type UserFilter = (typeof userFilters)[number];
const filterSql: Record<UserFilter, string> = {
  all: "1 = 1",
  blocked: "blocked = 1",
  stopped: "opted_out = 1",
  paid: "payment_status = 'paid'",
};
const progressSql = `(SELECT json_object('title', json_extract(v.content_json, '$.title'),
  'step', e.step, 'total', json_array_length(v.content_json, '$.steps'), 'state', e.state,
  'delivery', (SELECT d.state FROM deliveries d WHERE d.enrollment_id = e.id AND d.step = e.step))
  FROM enrollments e JOIN campaign_versions v ON v.id = e.version_id
  JOIN campaigns c ON c.id = e.campaign_id
  WHERE e.user_id = users.id AND e.kind = 'sequence' ORDER BY c.ordinal DESC LIMIT 1) AS sequence_progress`;

export class CourseRepository {
  constructor(private readonly env: CourseEnv) {}
  private get db(): D1Database {
    return this.env.COURSE_DB;
  }

  async touchUser(
    identity: Identity,
    language: string | undefined,
    eventAt: number,
  ): Promise<UserRecord> {
    const userKey = await hashUserId(
      identity.telegramId,
      this.env.USER_HASH_SECRET,
    );
    const cipher = await seal(identity, userKey, this.env.ENCRYPTION_KEY);
    const now = Date.now();
    const row = await this.db
      .prepare(`
      INSERT INTO users (id, user_key, identity_cipher, locale, is_admin, first_seen_at, last_seen_at, profile_event_at, reachability_event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_key) DO UPDATE SET
        identity_cipher = CASE WHEN excluded.profile_event_at >= profile_event_at THEN excluded.identity_cipher ELSE identity_cipher END,
        locale = CASE WHEN locale = 'pl' THEN 'en' WHEN locale_explicit = 0 AND excluded.profile_event_at >= profile_event_at THEN excluded.locale ELSE locale END,
        is_admin = excluded.is_admin,
        last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
        profile_event_at = MAX(profile_event_at, excluded.profile_event_at),
        blocked = CASE WHEN excluded.reachability_event_at >= reachability_event_at THEN 0 ELSE blocked END,
        reachability_event_at = MAX(reachability_event_at, excluded.reachability_event_at)
      RETURNING *
    `)
      .bind(
        crypto.randomUUID(),
        userKey,
        cipher,
        isoLanguageCode(detectLocale(language)),
        Number(this.env.ADMIN_USER_IDS.includes(identity.telegramId)),
        now,
        now,
        eventAt,
        eventAt,
      )
      .first<UserRecord>();
    if (!row) throw new Error("User persistence failed");
    await this.db
      .prepare("INSERT OR IGNORE INTO user_ordinals(user_id) VALUES (?)")
      .bind(row.id)
      .run();
    return { ...row, locale: detectLocale(row.locale) };
  }

  identity(user: UserRecord): Promise<Identity> {
    return open<Identity>(
      user.identity_cipher,
      user.user_key,
      this.env.ENCRYPTION_KEY,
    );
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const user = await this.db
      .prepare(`SELECT users.*, ${progressSql} FROM users WHERE id = ?`)
      .bind(id)
      .first<UserRecord>();
    return user ? { ...user, locale: detectLocale(user.locale) } : null;
  }

  async start(id: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE users SET started_at = COALESCE(started_at, ?) WHERE id = ? AND is_admin = 0",
      )
      .bind(Date.now(), id)
      .run();
  }

  async setLocale(
    id: string,
    locale: Locale,
    eventAt: number,
    updateId: number,
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE users SET locale = ?, locale_explicit = 1, locale_event_at = ?, locale_update_id = ?
      WHERE id = ? AND (locale_event_at < ? OR (locale_event_at = ? AND locale_update_id < ?))`)
      .bind(
        isoLanguageCode(locale),
        eventAt,
        updateId,
        id,
        eventAt,
        eventAt,
        updateId,
      )
      .run();
  }

  async setOptOut(
    id: string,
    stopped: boolean,
    eventAt: number,
    updateId: number,
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE users SET opted_out = ?, preference_event_at = ?, preference_update_id = ?
      WHERE id = ? AND (preference_event_at < ? OR (preference_event_at = ? AND preference_update_id < ?))`)
      .bind(Number(stopped), eventAt, updateId, id, eventAt, eventAt, updateId)
      .run();
  }

  async setBlocked(
    telegramId: number,
    blocked: boolean,
    eventAt: number,
  ): Promise<void> {
    const key = await hashUserId(telegramId, this.env.USER_HASH_SECRET);
    await this.db
      .prepare(`UPDATE users SET blocked = ?, reachability_event_at = ?
      WHERE user_key = ? AND reachability_event_at <= ?`)
      .bind(Number(blocked), eventAt, key, eventAt)
      .run();
  }

  async listUsers(
    filter: UserFilter,
    page: number,
  ): Promise<{ users: UserRecord[]; hasNext: boolean }> {
    const { results } = await this.db
      .prepare(`SELECT users.*, ${progressSql} FROM users WHERE ${filterSql[filter]}
      ORDER BY first_seen_at, id LIMIT ? OFFSET ?`)
      .bind(PAGE_SIZE + 1, page * PAGE_SIZE)
      .all<UserRecord>();
    return {
      users: results.slice(0, PAGE_SIZE).map((user) => ({
        ...user,
        locale: detectLocale(user.locale),
      })),
      hasNext: results.length > PAGE_SIZE,
    };
  }

  async claimUpdate(
    updateId: number,
    leaseToken: string,
  ): Promise<"claimed" | "done" | "busy"> {
    const now = Date.now();
    const claimed = await this.db
      .prepare(`INSERT INTO processed_updates (update_id, state, lease_token, lease_until, updated_at)
      VALUES (?, 'processing', ?, ?, ?)
      ON CONFLICT(update_id) DO UPDATE SET lease_token = excluded.lease_token, lease_until = excluded.lease_until, updated_at = excluded.updated_at
      WHERE state = 'processing' AND lease_until <= ? RETURNING update_id`)
      .bind(updateId, leaseToken, now + 120_000, now, now)
      .first();
    if (claimed) return "claimed";
    const existing = await this.db
      .prepare("SELECT state FROM processed_updates WHERE update_id = ?")
      .bind(updateId)
      .first<{ state: string }>();
    return existing?.state === "done" ? "done" : "busy";
  }

  async finishUpdate(updateId: number, leaseToken: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE processed_updates SET state = 'done', updated_at = ? WHERE update_id = ? AND lease_token = ?",
      )
      .bind(Date.now(), updateId, leaseToken)
      .run();
  }

  async releaseUpdate(updateId: number, leaseToken: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE processed_updates SET lease_until = 0 WHERE update_id = ? AND lease_token = ? AND state = 'processing'",
      )
      .bind(updateId, leaseToken)
      .run();
  }

  async saveMedia(
    ownerId: string,
    botId: number,
    input: MediaInput,
  ): Promise<MediaRecord> {
    const botKey = await hashUserId(botId, this.env.USER_HASH_SECRET);
    const scope = `media:${botKey}:${input.type}:${input.uniqueId}`;
    const cipher = await seal(input.fileId, scope, this.env.ENCRYPTION_KEY);
    const id = crypto.randomUUID();
    const now = Date.now();
    const results = await this.db.batch([
      this.db
        .prepare(`INSERT INTO media_assets (id, owner_id, bot_key, file_unique_id, media_type, file_id_cipher, file_size, width, height, duration, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bot_key, file_unique_id, media_type) DO UPDATE SET file_id_cipher = excluded.file_id_cipher, state = 'pending'
        RETURNING *`)
        .bind(
          id,
          ownerId,
          botKey,
          input.uniqueId,
          input.type,
          cipher,
          input.size ?? null,
          input.width,
          input.height,
          input.duration ?? null,
          now,
        ),
      this.db
        .prepare(
          "INSERT INTO audit_events(id, actor_id, action, resource_id, created_at) VALUES (?, ?, 'media.upload', (SELECT id FROM media_assets WHERE bot_key = ? AND file_unique_id = ? AND media_type = ?), ?)",
        )
        .bind(
          crypto.randomUUID(),
          ownerId,
          botKey,
          input.uniqueId,
          input.type,
          now,
        ),
    ]);
    return results[0]!.results[0] as unknown as MediaRecord;
  }

  getMedia(id: string): Promise<MediaRecord | null> {
    return this.db
      .prepare("SELECT * FROM media_assets WHERE id = ?")
      .bind(id)
      .first<MediaRecord>();
  }

  mediaFileId(asset: MediaRecord): Promise<string> {
    return open<string>(
      asset.file_id_cipher,
      `media:${asset.bot_key}:${asset.media_type}:${asset.file_unique_id}`,
      this.env.ENCRYPTION_KEY,
    );
  }

  async verifyMedia(asset: MediaRecord, returned: MediaInput): Promise<void> {
    if (
      asset.file_unique_id !== returned.uniqueId ||
      asset.media_type !== returned.type
    )
      throw new Error("Media identity mismatch");
    const cipher = await seal(
      returned.fileId,
      `media:${asset.bot_key}:${asset.media_type}:${asset.file_unique_id}`,
      this.env.ENCRYPTION_KEY,
    );
    // An older preview must not validate or overwrite a concurrent re-upload.
    await this.db
      .prepare(
        "UPDATE media_assets SET file_id_cipher = ?, state = 'ready', validated_at = ? WHERE id = ? AND file_id_cipher = ?",
      )
      .bind(cipher, Date.now(), asset.id, asset.file_id_cipher)
      .run();
  }

  async invalidateMedia(asset: MediaRecord): Promise<void> {
    await this.db
      .prepare(
        "UPDATE media_assets SET state = 'needs_upload' WHERE id = ? AND file_id_cipher = ?",
      )
      .bind(asset.id, asset.file_id_cipher)
      .run();
  }
}
