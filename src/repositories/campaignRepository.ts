import {
  campaignSchema,
  sequenceStepDueAt,
  type Campaign,
  type CampaignRow,
  type Enrollment,
  type Delivery,
} from "../models/campaign.js";
import { audienceSql } from "./audienceSql.js";

export const eligible =
  "u.started_at IS NOT NULL AND u.is_admin = 0 AND u.opted_out = 0 AND u.blocked = 0 AND u.purchase_suppressed = 0 AND u.payment_status != 'paid'";

export class CampaignRepository {
  constructor(readonly db: D1Database) {}
  async list(kind: Campaign["kind"]): Promise<CampaignRow[]> {
    return (
      await this.db
        .prepare(
          "SELECT * FROM campaigns WHERE kind = ? ORDER BY ordinal DESC LIMIT 30",
        )
        .bind(kind)
        .all<CampaignRow>()
    ).results;
  }
  async current(id: string): Promise<Campaign | null> {
    const row = await this.db
      .prepare(
        "SELECT v.content_json FROM campaigns c JOIN campaign_versions v ON v.id = c.current_version WHERE c.id = ? AND c.archived = 0",
      )
      .bind(id)
      .first<{ content_json: string }>();
    return row ? campaignSchema.parse(JSON.parse(row.content_json)) : null;
  }
  async version(id: string): Promise<Campaign> {
    const row = await this.db
      .prepare("SELECT content_json FROM campaign_versions WHERE id = ?")
      .bind(id)
      .first<{ content_json: string }>();
    if (!row) throw new Error("Missing campaign version");
    return campaignSchema.parse(JSON.parse(row.content_json));
  }
  async publish(
    input: Campaign,
    actor: string,
    draft?: { nonce: string; revision: number; scheduled?: boolean },
  ): Promise<boolean> {
    const campaign = campaignSchema.parse(input);
    if (campaign.kind === "broadcast" && campaign.scheduledAt! <= Date.now())
      return false;
    const mediaIds = [
      ...new Set(
        campaign.steps.flatMap((step) =>
          Object.values(step.variants).flatMap((variant) =>
            variant?.mediaId ? [variant.mediaId] : [],
          ),
        ),
      ),
    ];
    if (mediaIds.length) {
      const ready = await this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM media_assets WHERE state = 'ready' AND id IN (${mediaIds.map(() => "?").join(",")})`,
        )
        .bind(...mediaIds)
        .first<{ count: number }>();
      if (ready?.count !== mediaIds.length) return false;
    }
    const versionId = crypto.randomUUID();
    const revision = campaign.baseRevision + 1;
    const now = Date.now();
    const draftTable = draft?.scheduled
      ? "scheduled_message_drafts"
      : "campaign_drafts";
    const draftFence = draft
      ? `EXISTS (SELECT 1 FROM ${draftTable} WHERE owner_id = ? AND nonce = ? AND revision = ?)`
      : "1";
    // The version pointer is a unique publication token that fences concurrent editors.
    const results = await this.db.batch([
      this.db
        .prepare(`INSERT INTO campaigns(id, kind, title, revision, current_version, published_at, created_by)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${draftFence} ON CONFLICT(id) DO UPDATE SET title = excluded.title,
        revision = excluded.revision, current_version = excluded.current_version, published_at = excluded.published_at
        WHERE campaigns.revision = ? AND campaigns.archived = 0
        AND (campaigns.kind = 'sequence' OR NOT EXISTS (SELECT 1 FROM broadcast_runs WHERE campaign_id = campaigns.id)) RETURNING id`)
        .bind(
          campaign.id,
          campaign.kind,
          campaign.title,
          revision,
          versionId,
          now,
          actor,
          ...(draft ? [actor, draft.nonce, draft.revision] : []),
          campaign.baseRevision,
        ),
      this.db
        .prepare(`INSERT INTO campaign_versions(id, campaign_id, revision, content_json, published_at)
        SELECT ?, id, ?, ?, ? FROM campaigns WHERE id = ? AND current_version = ?`)
        .bind(
          versionId,
          revision,
          JSON.stringify({ ...campaign, baseRevision: revision }),
          now,
          campaign.id,
          versionId,
        ),
      this.db
        .prepare(`INSERT INTO audit_events(id, actor_id, action, resource_id, created_at)
        SELECT ?, ?, 'campaign.publish', id, ? FROM campaigns WHERE id = ? AND current_version = ?`)
        .bind(crypto.randomUUID(), actor, now, campaign.id, versionId),
    ]);
    return results[0]!.results.length > 0;
  }
  async archive(id: string, actor: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("UPDATE campaigns SET archived = 1 WHERE id = ?")
        .bind(id),
      this.db
        .prepare(
          "DELETE FROM campaign_drafts WHERE json_extract(content_json, '$.campaign.id') = ?",
        )
        .bind(id),
      this.db
        .prepare(
          "DELETE FROM scheduled_message_drafts WHERE json_extract(content_json, '$.id') = ?",
        )
        .bind(id),
      this.db
        .prepare(
          "UPDATE enrollments SET state = 'cancelled' WHERE campaign_id = ? AND state = 'active'",
        )
        .bind(id),
      this.db
        .prepare(
          "INSERT INTO audit_events(id, actor_id, action, resource_id, created_at) VALUES (?, ?, 'campaign.archive', ?, ?)",
        )
        .bind(crypto.randomUUID(), actor, id, Date.now()),
    ]);
  }
  async saveDraft(
    owner: string,
    nonce: string,
    revision: number,
    content: unknown,
  ): Promise<boolean> {
    const row =
      revision === 0
        ? await this.db
            .prepare(
              "INSERT OR IGNORE INTO campaign_drafts(owner_id, nonce, revision, content_json) VALUES (?, ?, 1, ?) RETURNING revision",
            )
            .bind(owner, nonce, JSON.stringify(content))
            .first()
        : await this.db
            .prepare(
              "UPDATE campaign_drafts SET revision = revision + 1, content_json = ? WHERE owner_id = ? AND nonce = ? AND revision = ? RETURNING revision",
            )
            .bind(JSON.stringify(content), owner, nonce, revision)
            .first();
    return !!row;
  }
  draft(
    owner: string,
  ): Promise<{ nonce: string; revision: number; content_json: string } | null> {
    return this.db
      .prepare(
        "SELECT nonce, revision, content_json FROM campaign_drafts WHERE owner_id = ?",
      )
      .bind(owner)
      .first();
  }
  async discard(owner: string, nonce: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM campaign_drafts WHERE owner_id = ? AND nonce = ?")
      .bind(owner, nonce)
      .run();
  }
  async enrollment(id: string): Promise<Enrollment | null> {
    return this.db
      .prepare("SELECT * FROM enrollments WHERE id = ?")
      .bind(id)
      .first<Enrollment>();
  }
  async materialize(now: number): Promise<void> {
    // A paid user cannot become eligible again just by resuming or receiving a refund.
    await this.db
      .prepare(
        "UPDATE enrollments SET state = 'converted' WHERE state = 'active' AND user_id IN (SELECT id FROM users WHERE purchase_suppressed = 1)",
      )
      .run();
    const candidates = await this.db
      .prepare(`SELECT u.id AS user_id, u.last_delivery_at, c.id AS campaign_id, c.current_version
      FROM users u JOIN campaigns c ON c.kind = 'sequence' AND c.archived = 0
      JOIN campaign_versions cv ON cv.id = c.current_version
      WHERE ${eligible} AND ${audienceSql("cv.content_json")} AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.kind = 'sequence' AND e.state = 'active')
      AND c.ordinal = CASE WHEN EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.kind = 'sequence')
        THEN (SELECT MIN(n.ordinal) FROM campaigns n JOIN campaign_versions nv ON nv.id = n.current_version WHERE n.kind = 'sequence' AND n.archived = 0 AND ${audienceSql("nv.content_json")} AND n.ordinal >
          (SELECT MAX(p.ordinal) FROM enrollments e JOIN campaigns p ON p.id = e.campaign_id WHERE e.user_id = u.id AND e.kind = 'sequence'))
        ELSE (SELECT MAX(n.ordinal) FROM campaigns n JOIN campaign_versions nv ON nv.id = n.current_version WHERE n.kind = 'sequence' AND n.archived = 0 AND ${audienceSql("nv.content_json")}) END
      ORDER BY u.first_seen_at, u.id LIMIT 10`)
      .all<{
        user_id: string;
        last_delivery_at: number;
        campaign_id: string;
        current_version: string;
      }>();
    for (const candidate of candidates.results) {
      const campaign = await this.version(candidate.current_version);
      const startAt = Math.max(now, candidate.last_delivery_at + 60_000);
      await this.db
        .prepare(`INSERT OR IGNORE INTO enrollments(id, user_id, campaign_id, version_id, kind, started_at, due_at)
        SELECT ?, u.id, ?, ?, 'sequence', ?, ? FROM users u WHERE u.id = ? AND ${eligible} AND ${audienceSql("?")}`)
        .bind(
          crypto.randomUUID(),
          candidate.campaign_id,
          candidate.current_version,
          startAt,
          sequenceStepDueAt(campaign.steps[0]!, startAt),
          candidate.user_id,
          JSON.stringify(campaign),
        )
        .run();
    }
    const broadcasts = await this.db
      .prepare(`SELECT c.id, c.current_version, v.content_json FROM campaigns c
      JOIN campaign_versions v ON v.id = c.current_version LEFT JOIN broadcast_runs r ON r.campaign_id = c.id
      WHERE c.kind = 'broadcast' AND c.archived = 0 AND COALESCE(r.finished, 0) = 0
      AND json_extract(v.content_json, '$.scheduledAt') <= ? ORDER BY c.ordinal LIMIT 2`)
      .bind(now)
      .all<{ id: string; current_version: string; content_json: string }>();
    for (const row of broadcasts.results) {
      await this.db
        .prepare(
          "INSERT OR IGNORE INTO broadcast_runs(campaign_id, cutoff) SELECT ?, COALESCE(MAX(ordinal), 0) FROM user_ordinals",
        )
        .bind(row.id)
        .run();
      const run = (await this.db
        .prepare(
          "SELECT cutoff, cursor FROM broadcast_runs WHERE campaign_id = ?",
        )
        .bind(row.id)
        .first<{ cutoff: number; cursor: number }>())!;
      const recipients = (
        await this.db
          .prepare(
            "SELECT ordinal, user_id AS id FROM user_ordinals WHERE ordinal > ? AND ordinal <= ? ORDER BY ordinal LIMIT 100",
          )
          .bind(run.cursor, run.cutoff)
          .all<{ ordinal: number; id: string }>()
      ).results;
      const statements = [
        this.db
          .prepare(`INSERT OR IGNORE INTO enrollments(id, user_id, campaign_id, version_id, kind, started_at, due_at)
        SELECT json_extract(j.value, '$.enrollmentId'), u.id, ?, ?, 'broadcast', ?, ?
        FROM json_each(?) j JOIN users u ON u.id = json_extract(j.value, '$.userId') WHERE ${eligible} AND ${audienceSql("?")}`)
          .bind(
            row.id,
            row.current_version,
            now,
            now,
            JSON.stringify(
              recipients.map((user) => ({
                enrollmentId: crypto.randomUUID(),
                userId: user.id,
              })),
            ),
            row.content_json,
          ),
      ];
      statements.push(
        this.db
          .prepare(
            "UPDATE broadcast_runs SET cursor = ?, finished = ? WHERE campaign_id = ? AND cursor = ?",
          )
          .bind(
            recipients.at(-1)?.ordinal ?? run.cursor,
            Number(recipients.length < 100),
            row.id,
            run.cursor,
          ),
      );
      await this.db.batch(statements);
    }
    await this.db
      .prepare(`INSERT OR IGNORE INTO deliveries(id, enrollment_id, step, available_at)
      SELECT lower(hex(randomblob(16))), e.id, e.step, e.due_at FROM enrollments e JOIN users u ON u.id = e.user_id
      JOIN campaigns c ON c.id = e.campaign_id JOIN campaign_versions v ON v.id = e.version_id
      WHERE e.state = 'active' AND e.due_at <= ? AND c.archived = 0 AND ${eligible} AND ${audienceSql("v.content_json")}
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.enrollment_id = e.id AND d.step = e.step)
      ORDER BY e.due_at LIMIT 100`)
      .bind(now)
      .run();
    await this.db
      .prepare(
        "UPDATE deliveries SET state = 'unknown' WHERE state = 'sending' AND lease_until < ?",
      )
      .bind(now)
      .run();
  }
  async dispatch(queue: Queue, now: number): Promise<void> {
    const rows = (
      await this.db
        .prepare(`SELECT d.id FROM deliveries d JOIN enrollments e ON e.id = d.enrollment_id
      JOIN users u ON u.id = e.user_id JOIN campaigns c ON c.id = e.campaign_id
      JOIN campaign_versions v ON v.id = e.version_id
      WHERE d.state = 'pending' AND d.available_at <= ? AND d.enqueued_at < ? AND e.state = 'active' AND c.archived = 0 AND ${eligible} AND ${audienceSql("v.content_json")}
      ORDER BY CASE e.kind WHEN 'broadcast' THEN 0 ELSE 1 END, d.available_at LIMIT 50`)
        .bind(now, now - 300_000)
        .all<{ id: string }>()
    ).results;
    if (rows.length) {
      await queue.sendBatch(
        rows.map((row) => ({ body: { deliveryId: row.id } })),
      );
      await this.db
        .prepare(
          `UPDATE deliveries SET enqueued_at = ? WHERE id IN (${rows.map(() => "?").join(",")}) AND state = 'pending'`,
        )
        .bind(now, ...rows.map((row) => row.id))
        .run();
    }
  }
  async claim(
    id: string,
    token: string,
    now: number,
  ): Promise<Delivery | null> {
    return this.db
      .prepare(`UPDATE deliveries SET state = 'sending', lease_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE id = ? AND state = 'pending' AND available_at <= ? RETURNING *`)
      .bind(token, now + 60_000, id, now)
      .first<Delivery>();
  }
  async setOutcome(
    job: Delivery,
    state: string,
    availableAt = Date.now(),
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE deliveries SET state = ?, available_at = ?, enqueued_at = 0 WHERE id = ? AND lease_token = ? AND state = 'sending'",
      )
      .bind(state, availableAt, job.id, job.lease_token)
      .run();
  }
  async complete(
    job: Delivery,
    enrollment: Enrollment,
    campaign: Campaign,
    messageId: number,
  ): Promise<void> {
    const now = Date.now();
    const next = campaign.steps[enrollment.step + 1];
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE deliveries SET state = 'sent', message_id = ? WHERE id = ? AND lease_token = ? AND state = 'sending'",
        )
        .bind(messageId, job.id, job.lease_token),
      this.db
        .prepare(`UPDATE enrollments SET step = step + 1, state = ?, due_at = ? WHERE id = ? AND step = ?
        AND EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND lease_token = ? AND state = 'sent')`)
        .bind(
          next ? "active" : "completed",
          next ? sequenceStepDueAt(next, enrollment.started_at, now) : now,
          enrollment.id,
          job.step,
          job.id,
          job.lease_token,
        ),
      this.db
        .prepare(
          "UPDATE users SET last_delivery_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM deliveries WHERE id = ? AND lease_token = ? AND state = 'sent')",
        )
        .bind(now, enrollment.user_id, job.id, job.lease_token),
    ]);
  }
}
