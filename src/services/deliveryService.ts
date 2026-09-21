import { Api } from "grammy";
import { z } from "zod";
import type { CourseEnv } from "../schemas/envSchema.js";
import { CourseRepository } from "../repositories/courseRepository.js";
import { CampaignRepository } from "../repositories/campaignRepository.js";
import { hashUserId } from "../crypto/userHash.js";
import { CampaignTestRepository } from "../repositories/campaignTestRepository.js";
import { deliverCampaignTest } from "./campaignTestService.js";
import { deliveryFailure, sendCampaignMessage } from "./campaignMessage.js";
import { navigationKeyboard } from "../bot/keyboards/navigationKeyboard.js";
import { matchesAudience } from "../models/audience.js";
import { localizedVariant } from "../models/campaign.js";

const deliveryId = z.string().regex(/^[\da-f]{32}$/);
const queueMessage = z.union([
  z.object({ deliveryId }).strict(),
  z.object({ testDeliveryId: deliveryId }).strict(),
]);

export async function runScheduled(env: CourseEnv): Promise<void> {
  if (!env.COURSE_QUEUE) throw new Error("Delivery queue is not configured");
  const keys = [];
  for (const id of env.ADMIN_USER_IDS)
    keys.push(await hashUserId(id, env.USER_HASH_SECRET));
  const predicate = keys.length
    ? `user_key IN (${keys.map(() => "?").join(",")})`
    : "0";
  await env.COURSE_DB.prepare(`UPDATE users SET is_admin = (${predicate})`)
    .bind(...keys)
    .run();
  const repo = new CampaignRepository(env.COURSE_DB);
  await repo.materialize(Date.now());
  await repo.dispatch(env.COURSE_QUEUE, Date.now());
  const tests = new CampaignTestRepository(env.COURSE_DB);
  await tests.materialize(Date.now());
  await tests.dispatch(env.COURSE_QUEUE, Date.now());
}

export async function deliverBatch(
  batch: MessageBatch<unknown>,
  env: CourseEnv,
  api = new Api(env.BOT_TOKEN, { timeoutSeconds: 15 }),
): Promise<void> {
  const campaigns = new CampaignRepository(env.COURSE_DB);
  const users = new CourseRepository(env);
  for (const message of batch.messages) {
    const body = queueMessage.safeParse(message.body);
    if (!body.success) {
      message.ack();
      continue;
    }
    if ("testDeliveryId" in body.data) {
      await deliverCampaignTest(message, body.data.testDeliveryId, env, api);
      continue;
    }
    let job: Awaited<ReturnType<CampaignRepository["claim"]>> = null;
    let sending = false;
    try {
      job = await campaigns.claim(
        body.data.deliveryId,
        crypto.randomUUID(),
        Date.now(),
      );
      if (!job) {
        message.ack();
        continue;
      }
      const enrollment = await campaigns.enrollment(job.enrollment_id);
      if (
        !enrollment ||
        enrollment.state !== "active" ||
        enrollment.step !== job.step
      ) {
        await campaigns.setOutcome(job, "skipped");
        message.ack();
        continue;
      }
      const active = await env.COURSE_DB.prepare(
        "SELECT id FROM campaigns WHERE id = ? AND archived = 0",
      )
        .bind(enrollment.campaign_id)
        .first();
      const user = await users.getUser(enrollment.user_id);
      if (
        !user ||
        !active ||
        user.is_admin ||
        user.purchase_suppressed ||
        user.payment_status === "paid"
      ) {
        await campaigns.setOutcome(job, "skipped");
        message.ack();
        continue;
      }
      if (user.blocked || user.opted_out) {
        await campaigns.setOutcome(
          job,
          enrollment.kind === "broadcast" ? "skipped" : "pending",
        );
        message.ack();
        continue;
      }
      if (Date.now() - user.last_delivery_at < 1500) {
        await campaigns.setOutcome(
          job,
          "pending",
          user.last_delivery_at + 1500,
        );
        message.retry({ delaySeconds: 2 });
        continue;
      }
      const campaign = await campaigns.version(enrollment.version_id);
      if (!matchesAudience(user, campaign.audience)) {
        await campaigns.setOutcome(
          job,
          enrollment.kind === "broadcast" ? "skipped" : "pending",
        );
        message.ack();
        continue;
      }
      if (
        enrollment.kind === "broadcast" &&
        Date.now() > campaign.scheduledAt! + 86_400_000
      ) {
        await campaigns.setOutcome(job, "skipped");
        message.ack();
        continue;
      }
      const step = campaign.steps[job.step];
      const variant =
        step &&
        (localizedVariant(step.variants, user.locale) ??
          localizedVariant(step.variants, campaign.fallback));
      if (!variant) throw new Error("Missing message content");
      const identity = await users.identity(user);
      const claimed = job;
      await sendCampaignMessage(
        api,
        env,
        identity.chatId,
        variant,
        async () => {
          const currentUser = await users.getUser(enrollment.user_id);
          const currentEnrollment = await campaigns.enrollment(enrollment.id);
          const currentCampaign = await campaigns.current(
            enrollment.campaign_id,
          );
          if (
            !currentUser ||
            !currentCampaign ||
            currentEnrollment?.state !== "active" ||
            currentUser.is_admin ||
            currentUser.purchase_suppressed ||
            currentUser.payment_status === "paid"
          ) {
            await campaigns.setOutcome(claimed, "skipped");
            return false;
          }
          if (
            currentUser.blocked ||
            currentUser.opted_out ||
            !matchesAudience(currentUser, campaign.audience)
          ) {
            await campaigns.setOutcome(
              claimed,
              enrollment.kind === "broadcast" ? "skipped" : "pending",
            );
            return false;
          }
          sending = true;
          return true;
        },
        (messageId) =>
          campaigns.complete(claimed, enrollment, campaign, messageId),
        navigationKeyboard(user.locale),
      );
      message.ack();
    } catch (error) {
      if (!job) {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const { state, retryDelay, blocked } = deliveryFailure(
        error,
        sending,
        job.attempts,
      );
      if (blocked) {
        const enrollment = await campaigns.enrollment(job.enrollment_id);
        if (enrollment) {
          const user = await users.getUser(enrollment.user_id);
          if (user)
            await users.setBlocked(
              (await users.identity(user)).telegramId,
              true,
              Date.now(),
            );
        }
      }
      try {
        await campaigns.setOutcome(
          job,
          state,
          Date.now() + (retryDelay ?? 0) * 1000,
        );
        if (state === "pending" && retryDelay)
          message.retry({ delaySeconds: retryDelay });
        else message.ack();
      } catch {
        message.retry({ delaySeconds: 30 });
      }
    }
  }
}
