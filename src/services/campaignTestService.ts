import type { Api } from "grammy";
import { campaignSchema, localizedVariant } from "../models/campaign.js";
import type { TestDelivery } from "../models/campaignTest.js";
import type { CourseEnv } from "../schemas/envSchema.js";
import { CampaignTestRepository } from "../repositories/campaignTestRepository.js";
import { CourseRepository } from "../repositories/courseRepository.js";
import { deliveryFailure, sendCampaignMessage } from "./campaignMessage.js";
import { detectLocale } from "../bot/i18n.js";

export async function deliverCampaignTest(
  message: Message<unknown>,
  id: string,
  env: CourseEnv,
  api: Api,
): Promise<void> {
  const tests = new CampaignTestRepository(env.COURSE_DB);
  const users = new CourseRepository(env);
  let job: TestDelivery | null = null;
  let sending = false;
  try {
    job = await tests.claim(id, crypto.randomUUID(), Date.now());
    if (!job) {
      const existing = await tests.delivery(id);
      if (existing?.state === "pending" && existing.available_at > Date.now()) {
        message.retry({
          delaySeconds: Math.min(
            43_200,
            Math.max(1, Math.ceil((existing.available_at - Date.now()) / 1000)),
          ),
        });
        return;
      }
      if (env.COURSE_QUEUE) await tests.continueQuickTest(id, env.COURSE_QUEUE);
      message.ack();
      return;
    }
    const run = await tests.get(job.test_id);
    const user = run ? await users.getUser(run.owner_id) : null;
    const identity = user ? await users.identity(user) : null;
    if (
      !run ||
      run.state !== "active" ||
      run.step !== job.step ||
      !user ||
      !identity ||
      !env.ADMIN_USER_IDS.includes(identity.telegramId) ||
      user.blocked
    ) {
      await tests.setOutcome(job, "skipped");
      if (run) await tests.cancel(run.id, run.owner_id);
      message.ack();
      return;
    }
    const campaign = campaignSchema.parse(JSON.parse(run.content_json));
    if (
      run.mode === "real" &&
      campaign.kind === "broadcast" &&
      Date.now() > campaign.scheduledAt! + 86_400_000
    ) {
      await tests.setOutcome(job, "failed");
      message.ack();
      return;
    }
    const step = campaign.steps[job.step]!;
    const variant =
      localizedVariant(step.variants, detectLocale(run.locale)) ??
      localizedVariant(step.variants, campaign.fallback);
    if (!variant) throw new Error("Missing message content");
    const claimed = job;
    await sendCampaignMessage(
      api,
      env,
      identity.chatId,
      variant,
      async () => {
        // Cancellation may arrive while media is being decrypted or the send is paced.
        if ((await tests.get(run.id))?.state !== "active") {
          await tests.setOutcome(claimed, "skipped");
          return false;
        }
        sending = true;
        return true;
      },
      (messageId) => tests.complete(claimed, run, campaign, messageId),
    );
    try {
      if (env.COURSE_QUEUE) await tests.continueQuickTest(id, env.COURSE_QUEUE);
      message.ack();
    } catch {
      // Retry dispatch of the next step without repeating the recorded send.
      message.retry({ delaySeconds: 5 });
    }
  } catch (error) {
    if (!job) {
      message.retry({ delaySeconds: 30 });
      return;
    }
    const failure = deliveryFailure(error, sending, job.attempts);
    try {
      if (failure.blocked) {
        const run = await tests.get(job.test_id);
        const user = run ? await users.getUser(run.owner_id) : null;
        if (user)
          await users.setBlocked(
            (await users.identity(user)).telegramId,
            true,
            Date.now(),
          );
      }
      const state = failure.blocked ? "failed" : failure.state;
      await tests.setOutcome(
        job,
        state,
        Date.now() + (failure.retryDelay ?? 0) * 1000,
      );
      if (state === "pending" && failure.retryDelay)
        message.retry({ delaySeconds: failure.retryDelay });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
