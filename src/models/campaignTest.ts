import type { Locale } from "../bot/i18n.js";
import { sequenceStepDueAt, type Campaign } from "./campaign.js";

export type TestMode = "real" | "fast";
export const QUICK_TEST_INTERVAL = 2_000;
export interface CampaignTest {
  id: string;
  owner_id: string;
  request_key: string;
  content_json: string;
  locale: Locale;
  mode: TestMode;
  state: "active" | "completed" | "cancelled";
  step: number;
  started_at: number;
  due_at: number;
}
export interface TestDelivery {
  id: string;
  test_id: string;
  step: number;
  state: "pending" | "sending" | "sent" | "failed" | "unknown" | "skipped";
  lease_token: string;
  attempts: number;
  available_at: number;
  sent_at: number | null;
}

export function testDueAt(
  campaign: Campaign,
  mode: TestMode,
  startedAt: number,
  step: number,
  previousSentAt?: number,
): number {
  if (mode === "fast")
    return Math.max(
      startedAt + step * QUICK_TEST_INTERVAL,
      previousSentAt === undefined
        ? startedAt
        : previousSentAt + QUICK_TEST_INTERVAL,
    );
  if (mode === "real" && campaign.kind === "sequence") {
    const previous =
      previousSentAt ??
      (step > 0 ? testDueAt(campaign, mode, startedAt, step - 1) : undefined);
    return sequenceStepDueAt(campaign.steps[step]!, startedAt, previous);
  }
  const planned =
    campaign.kind === "broadcast"
      ? campaign.scheduledAt!
      : startedAt + campaign.steps[step]!.offsetMinutes * 60_000;
  return previousSentAt === undefined
    ? planned
    : Math.max(planned, previousSentAt + 60_000);
}
