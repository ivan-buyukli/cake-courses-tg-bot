import { describe, it, expect } from "vitest";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import type { KVNamespace } from "@cloudflare/workers-types";

interface MockKV extends KVNamespace {
  putOptions: Map<string, { expirationTtl?: number }>;
}

function createMockKV(): MockKV {
  const store = new Map<string, string>();
  const putOptions = new Map<string, { expirationTtl?: number }>();

  return {
    putOptions,
    get: async (key: string) => store.get(key) ?? null,
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ) => {
      store.set(key, value);
      if (options) putOptions.set(key, options);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const prefix = options?.prefix ?? "";
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as MockKV;
}

describe("reminderRepository", () => {
  it("adds a reminder entry", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    const entries = await repo.listEntries("2026-06-01");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ userKey: "user-1", subscriptionId: "sub-1" });
  });

  it("deduplicates entries for the same userKey + subscriptionId", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    const entries = await repo.listEntries("2026-06-01");

    expect(entries).toHaveLength(1);
  });

  it("removes a reminder entry", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    await repo.addEntry("2026-06-01", "user-1", "sub-2");

    await repo.removeEntry("2026-06-01", "user-1", "sub-1");
    const entries = await repo.listEntries("2026-06-01");

    expect(entries).toHaveLength(1);
    expect(entries[0].subscriptionId).toBe("sub-2");
  });

  it("removing a non-existent entry is a no-op", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.removeEntry("2026-06-01", "user-1", "sub-1");
    const entries = await repo.listEntries("2026-06-01");

    expect(entries).toHaveLength(0);
  });

  it("lists entries for a specific date only", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    await repo.addEntry("2026-06-02", "user-1", "sub-2");

    const entries1 = await repo.listEntries("2026-06-01");
    const entries2 = await repo.listEntries("2026-06-02");

    expect(entries1).toHaveLength(1);
    expect(entries2).toHaveLength(1);
    expect(entries1[0].subscriptionId).toBe("sub-1");
    expect(entries2[0].subscriptionId).toBe("sub-2");
  });

  it("lists unique well-formed dates through maxDate", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.addEntry("2026-06-01", "user-1", "sub-1");
    await repo.addEntry("2026-06-01", "user-2", "sub-2");
    await repo.addEntry("2026-06-02", "user-1", "sub-3");
    await repo.addEntry("2026-06-03", "user-1", "sub-4");
    await kv.put("reminders:date:2026-06-01", "[]");
    await kv.put("reminders:date:not-a-date:user:sub", "1");

    await expect(repo.listDatesThrough("2026-06-02")).resolves.toEqual([
      "2026-06-01",
      "2026-06-02",
    ]);
  });

  it("marks and checks sent status", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    const alreadySent = await repo.hasSent(
      "user-1",
      "sub-1",
      "2026-06-04",
      "2026-06-01",
    );
    expect(alreadySent).toBe(false);

    await repo.markSent("user-1", "sub-1", "2026-06-04", "2026-06-01");

    const nowSent = await repo.hasSent(
      "user-1",
      "sub-1",
      "2026-06-04",
      "2026-06-01",
    );
    expect(nowSent).toBe(true);
  });

  it("sets a TTL on sent markers", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.markSent("user-1", "sub-1", "2026-06-04", "2026-06-01");

    expect(
      kv.putOptions.get("reminder:sent:v2:user-1:sub-1:2026-06-04:2026-06-01"),
    ).toEqual({ expirationTtl: 60 * 60 * 24 * 45 });
  });

  it("sent markers are keyed by user, subscription, billing date, and local reminder date", async () => {
    const kv = createMockKV();
    const repo = createReminderRepository(kv);

    await repo.markSent("user-1", "sub-1", "2026-06-04", "2026-06-01");

    expect(
      await repo.hasSent("user-1", "sub-1", "2026-06-04", "2026-06-01"),
    ).toBe(true);
    expect(
      await repo.hasSent("user-1", "sub-1", "2026-06-04", "2026-06-02"),
    ).toBe(false);
    expect(
      await repo.hasSent("user-1", "sub-1", "2026-07-04", "2026-06-01"),
    ).toBe(false);
    expect(
      await repo.hasSent("user-1", "sub-2", "2026-06-04", "2026-06-01"),
    ).toBe(false);
    expect(
      await repo.hasSent("user-2", "sub-1", "2026-06-04", "2026-06-01"),
    ).toBe(false);
  });
});
