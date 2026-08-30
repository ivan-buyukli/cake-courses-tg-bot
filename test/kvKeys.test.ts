import { describe, it, expect } from "vitest";
import {
  userProfile,
  userDeleted,
  userSubscriptionsIndex,
  subscription,
  reminderDate,
  reminderDateEntry,
  reminderDatePrefix,
  parseReminderDateEntryKey,
  reminderSent,
} from "../src/utils/kvKeys.js";

describe("kvKeys", () => {
  it("userProfile returns correct key", () => {
    expect(userProfile("abc")).toBe("user:abc:profile");
  });

  it("userDeleted returns correct key", () => {
    expect(userDeleted("abc")).toBe("user:abc:deleted");
  });

  it("userSubscriptionsIndex returns correct key", () => {
    expect(userSubscriptionsIndex("abc")).toBe("user:abc:subs");
  });

  it("subscription returns correct key", () => {
    expect(subscription("abc", "sub_123")).toBe("user:abc:sub:sub_123");
  });

  it("reminderDate returns correct key", () => {
    expect(reminderDate("2026-06-01")).toBe("reminders:date:2026-06-01");
  });

  it("reminderDatePrefix returns correct prefix", () => {
    expect(reminderDatePrefix("2026-06-01")).toBe("reminders:date:2026-06-01:");
  });

  it("reminderDateEntry returns correct key", () => {
    expect(reminderDateEntry("2026-06-01", "user1", "sub1")).toBe(
      "reminders:date:2026-06-01:user1:sub1",
    );
  });

  it("parseReminderDateEntryKey parses entry keys", () => {
    expect(
      parseReminderDateEntryKey("reminders:date:2026-06-01:user1:sub1"),
    ).toEqual({
      date: "2026-06-01",
      userKey: "user1",
      subscriptionId: "sub1",
    });
  });

  it("parseReminderDateEntryKey rejects malformed keys", () => {
    expect(parseReminderDateEntryKey("reminders:date:2026-06-01")).toBeNull();
    expect(
      parseReminderDateEntryKey("reminders:date:not-a-date:user1:sub1"),
    ).toBeNull();
    expect(
      parseReminderDateEntryKey("reminders:date:2026-06-01:user1:sub1:extra"),
    ).toBeNull();
  });

  it("reminderSent returns correct key", () => {
    expect(reminderSent("user1", "sub1", "2026-06-04", "2026-06-01")).toBe(
      "reminder:sent:v2:user1:sub1:2026-06-04:2026-06-01",
    );
  });
});
