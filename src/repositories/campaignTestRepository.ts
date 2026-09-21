import { campaignSchema, type Campaign } from "../models/campaign.js";
import {
  testDueAt,
  type CampaignTest,
  type TestDelivery,
  type TestMode,
} from "../models/campaignTest.js";
import { detectLocale, isoLanguageCode, type Locale } from "../bot/i18n.js";

function normalizeLocale(run: CampaignTest | null): CampaignTest | null {
  return run ? { ...run, locale: detectLocale(run.locale) } : null;
}

export class CampaignTestRepository {
  constructor(readonly db: D1Database) {}

  async start(
    owner: string,
    requestKey: string,
    input: Campaign,
    mode: TestMode,
    locale: Locale,
    now = Date.now(),
    source?: { nonce: string; revision: number },
  ): Promise<CampaignTest | null> {
    const campaign = campaignSchema.parse(input);
    if (
      mode === "real" &&
      campaign.kind === "broadcast" &&
      campaign.scheduledAt! <= now
    )
      return null;
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(`INSERT OR IGNORE INTO campaign_tests(id, owner_id, request_key, content_json, locale, mode, started_at, due_at)
        SELECT ?, id, ?, ?, ?, ?, ?, ? FROM users WHERE id = ? AND is_admin = 1
        AND (? IS NULL OR EXISTS (SELECT 1 FROM campaign_drafts WHERE owner_id = users.id AND nonce = ? AND revision = ?))`)
        .bind(
          id,
          requestKey,
          JSON.stringify(campaign),
          isoLanguageCode(locale),
          mode,
          now,
          testDueAt(campaign, mode, now, 0),
          owner,
          source?.nonce ?? null,
          source?.nonce ?? null,
          source?.revision ?? null,
        ),
      this.db
        .prepare(`INSERT INTO audit_events(id, actor_id, action, resource_id, created_at)
        SELECT ?, owner_id, 'campaign.test.start', id, ? FROM campaign_tests WHERE id = ?`)
        .bind(crypto.randomUUID(), now, id),
    ]);
    return this.db
      .prepare(`SELECT * FROM campaign_tests WHERE owner_id = ? AND (request_key = ? OR state = 'active')
      ORDER BY CASE WHEN request_key = ? THEN 0 ELSE 1 END LIMIT 1`)
      .bind(owner, requestKey, requestKey)
      .first<CampaignTest>()
      .then(normalizeLocale);
  }

  get(id: string): Promise<CampaignTest | null> {
    return this.db
      .prepare("SELECT * FROM campaign_tests WHERE id = ?")
      .bind(id)
      .first<CampaignTest>()
      .then(normalizeLocale);
  }

  latest(owner: string): Promise<CampaignTest | null> {
    return this.db
      .prepare(
        "SELECT * FROM campaign_tests WHERE owner_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
      )
      .bind(owner)
      .first<CampaignTest>()
      .then(normalizeLocale);
  }

  async cancel(id: string, owner: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE campaign_tests SET state = 'cancelled' WHERE id = ? AND owner_id = ? AND state = 'active'",
        )
        .bind(id, owner),
      this.db
        .prepare(`UPDATE campaign_test_deliveries SET state = 'skipped' WHERE test_id = ? AND state = 'pending'
        AND EXISTS (SELECT 1 FROM campaign_tests WHERE id = ? AND owner_id = ? AND state = 'cancelled')`)
        .bind(id, id, owner),
    ]);
  }

  async materialize(now: number, testId?: string): Promise<void> {
    await this.db
      .prepare(`UPDATE campaign_tests SET state = 'cancelled' WHERE state = 'active'
      AND owner_id IN (SELECT id FROM users WHERE is_admin = 0)`)
      .run();
    await this.db
      .prepare(
        `UPDATE campaign_test_deliveries SET state = 'unknown' WHERE state = 'sending' AND lease_until < ?`,
      )
      .bind(now)
      .run();
    await this.db
      .prepare(`INSERT OR IGNORE INTO campaign_test_deliveries(id, test_id, step, available_at)
      SELECT lower(hex(randomblob(16))), t.id, t.step, t.due_at FROM campaign_tests t JOIN users u ON u.id = t.owner_id
      WHERE t.state = 'active' AND (t.due_at <= ? OR t.mode = 'fast') AND u.is_admin = 1 AND u.blocked = 0
      AND (? IS NULL OR t.id = ?)`)
      .bind(now, testId ?? null, testId ?? null)
      .run();
  }

  async dispatch(queue: Queue, now: number, testId?: string): Promise<void> {
    const { results } = await this.db
      .prepare(`SELECT d.id, d.available_at FROM campaign_test_deliveries d
      JOIN campaign_tests t ON t.id = d.test_id JOIN users u ON u.id = t.owner_id
      WHERE d.state = 'pending' AND (d.available_at <= ? OR t.mode = 'fast') AND d.enqueued_at < ? AND t.state = 'active'
      AND u.is_admin = 1 AND u.blocked = 0 AND (? IS NULL OR t.id = ?) ORDER BY d.available_at LIMIT 10`)
      .bind(now, now - 300_000, testId ?? null, testId ?? null)
      .all<{ id: string; available_at: number }>();
    if (!results.length) return;
    await queue.sendBatch(
      results.map(({ id, available_at }) => ({
        body: { testDeliveryId: id },
        delaySeconds: Math.min(
          43_200,
          Math.max(0, Math.ceil((available_at - now) / 1000)),
        ),
      })),
    );
    await this.db
      .prepare(`UPDATE campaign_test_deliveries SET enqueued_at = ? WHERE state = 'pending'
      AND id IN (${results.map(() => "?").join(",")})`)
      .bind(now, ...results.map(({ id }) => id))
      .run();
  }

  claim(id: string, token: string, now: number): Promise<TestDelivery | null> {
    return this.db
      .prepare(`UPDATE campaign_test_deliveries SET state = 'sending', lease_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE id = ? AND state = 'pending' AND available_at <= ? RETURNING *`)
      .bind(token, now + 60_000, id, now)
      .first<TestDelivery>();
  }

  delivery(id: string): Promise<TestDelivery | null> {
    return this.db
      .prepare("SELECT * FROM campaign_test_deliveries WHERE id = ?")
      .bind(id)
      .first<TestDelivery>();
  }

  async continueQuickTest(deliveryId: string, queue: Queue): Promise<void> {
    const previous = await this.delivery(deliveryId);
    if (previous?.state !== "sent") return;
    const run = await this.get(previous.test_id);
    if (run?.mode !== "fast" || run.state !== "active") return;
    await this.materialize(Date.now(), run.id);
    await this.dispatch(queue, Date.now(), run.id);
  }

  async setOutcome(
    job: TestDelivery,
    state: string,
    availableAt = Date.now(),
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE campaign_test_deliveries SET state = ?, available_at = ?, enqueued_at = 0
      WHERE id = ? AND lease_token = ? AND state = 'sending'`)
      .bind(state, availableAt, job.id, job.lease_token)
      .run();
  }

  async complete(
    job: TestDelivery,
    run: CampaignTest,
    campaign: Campaign,
    messageId: number,
  ): Promise<void> {
    const now = Date.now();
    const hasNext = job.step + 1 < campaign.steps.length;
    await this.db.batch([
      this.db
        .prepare(`UPDATE campaign_test_deliveries SET state = 'sent', message_id = ?, sent_at = ?
        WHERE id = ? AND lease_token = ? AND state = 'sending'`)
        .bind(messageId, now, job.id, job.lease_token),
      this.db
        .prepare(`UPDATE campaign_tests SET step = step + 1, state = ?, due_at = ? WHERE id = ? AND step = ? AND state = 'active'
        AND EXISTS (SELECT 1 FROM campaign_test_deliveries WHERE id = ? AND lease_token = ? AND state = 'sent')`)
        .bind(
          hasNext ? "active" : "completed",
          hasNext
            ? testDueAt(campaign, run.mode, run.started_at, job.step + 1, now)
            : now,
          run.id,
          job.step,
          job.id,
          job.lease_token,
        ),
    ]);
  }

  async deliveries(id: string): Promise<TestDelivery[]> {
    return (
      await this.db
        .prepare(
          "SELECT * FROM campaign_test_deliveries WHERE test_id = ? ORDER BY step",
        )
        .bind(id)
        .all<TestDelivery>()
    ).results;
  }
}
