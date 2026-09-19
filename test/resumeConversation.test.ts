import { describe, expect, it } from "vitest";
import {
  buildResumePrompt,
  buildResumeSuccessMessage,
} from "../src/bot/conversations/resumeConversation.js";
import type { Subscription } from "../src/models/subscription.js";

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Netflix",
    price: 12.99,
    currency: "EUR",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-01",
    status: "paused",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resumeConversation text", () => {
  it("uses button-oriented prompt without asking for typed confirmation", () => {
    const prompt = buildResumePrompt(createSub());

    expect(prompt).toContain(
      "Resume with the current date, or choose a new date:",
    );
    expect(prompt).not.toContain("Send“Confirm”");
  });

  it("explains retained trial and non-renewing flags", () => {
    const prompt = buildResumePrompt(
      createSub({ isTrial: true, autoRenew: false }),
    );

    expect(prompt).toContain("still marked as a trial");
    expect(prompt).toContain("still has auto-renewal disabled");
  });

  it("shows retained status after resume", () => {
    const message = buildResumeSuccessMessage(
      createSub({ status: "active", isTrial: true, autoRenew: false }),
    );

    expect(message).toContain("Unchanged status: Trial, Auto-renewal disabled");
  });
});
