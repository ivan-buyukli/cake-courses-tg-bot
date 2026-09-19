import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import { addCommand } from "../src/bot/commands/add.js";
import { deleteMeCommand } from "../src/bot/commands/deleteMe.js";
import { helpCommand } from "../src/bot/commands/help.js";
import {
  listCommand,
  listFullCommand,
  listTextCommand,
} from "../src/bot/commands/list.js";
import { remindersCommand } from "../src/bot/commands/reminders.js";
import { settingsCommand } from "../src/bot/commands/settings.js";
import { createReminderRepository } from "../src/repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../src/repositories/subscriptionRepository.js";
import { createSubscriptionService } from "../src/services/subscriptionService.js";
import type { Subscription } from "../src/models/subscription.js";
import type { BotContext } from "../src/types/context.js";
import type { Env } from "../src/types/env.js";

const VALID_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64url",
);

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (options?: { prefix?: string }) => {
      const prefix = options?.prefix ?? "";
      const keys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function createEnv(kv: KVNamespace, overrides: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ENCRYPTION_KEY: VALID_KEY,
    USER_HASH_SECRET: "hash-secret",
    SUBSCRIPTION_KV: kv,
    APP_ENV: "test",
    ...overrides,
  };
}

function createContext(
  kv: KVNamespace,
  text: string,
  overrides: Partial<BotContext> = {},
): BotContext {
  return {
    env: createEnv(kv),
    userKey: "user-key",
    requestId: "request-id",
    msg: { text },
    reply: vi.fn(),
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as BotContext;
}

function createSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Netflix",
    price: 12.99,
    currency: "USD",
    billingCycle: "monthly",
    nextBillingDate: "2026-06-05",
    category: "Video",
    note: "family plan",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seedSubscription(
  kv: KVNamespace,
  sub: Subscription,
): Promise<void> {
  const repo = createSubscriptionRepository(kv);
  const reminderRepo = createReminderRepository(kv);
  const service = createSubscriptionService(repo, reminderRepo);
  await service.create("user-key", sub, VALID_KEY);
}

describe("simple commands", () => {
  it("sends help text with the main command groups", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/help");

    await helpCommand(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text).toContain("/add <Name>");
    expect(text).toContain("/list_text");
    expect(text).toContain("/delete_me");
  });

  it("deleteMeCommand refuses unknown users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/delete_me", { userKey: undefined });

    await deleteMeCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Unable to identify your account. Please try again later.",
    );
  });

  it("deleteMeCommand sends the privacy confirmation keyboard", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/delete_me");

    await deleteMeCommand(ctx);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(text).toContain("permanently delete");
    expect(JSON.stringify(options.reply_markup)).toContain(
      "privacy:delete_confirm",
    );
    expect(JSON.stringify(options.reply_markup)).toContain(
      "privacy:delete_cancel",
    );
  });

  it("settingsCommand refuses unknown users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/settings", { userKey: undefined });

    await settingsCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Unable to identify your account. Please try again later.",
    );
    expect(ctx.conversation.enter).not.toHaveBeenCalled();
  });

  it("settingsCommand enters the settings conversation", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/settings");

    await settingsCommand(ctx);

    expect(ctx.conversation.enter).toHaveBeenCalledWith("settings");
  });
});

describe("addCommand", () => {
  it("refuses unknown users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/add Netflix 12 USD monthly 2026-06-01", {
      userKey: undefined,
    });

    await addCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Unable to identify your account. Please try again later.",
    );
  });

  it("enters the interactive add conversation when no args are provided", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/add");

    await addCommand(ctx);

    expect(ctx.conversation.enter).toHaveBeenCalledWith("add");
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("returns validation feedback for malformed one-line input", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/add Netflix nope USD monthly 2026-06-01");

    await addCommand(ctx);

    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyText).toContain("Price");
  });

  it("creates a subscription from one-line input", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/add Netflix 12.99 USD monthly 2026-06-01");

    await addCommand(ctx);

    const repo = createSubscriptionRepository(kv);
    const reminderRepo = createReminderRepository(kv);
    const service = createSubscriptionService(repo, reminderRepo);
    const subs = await service.list("user-key", VALID_KEY);

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      name: "Netflix",
      price: 12.99,
      currency: "USD",
      billingCycle: "monthly",
      nextBillingDate: "2026-06-01",
      status: "active",
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Subscription added"),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("/settings"),
    );
  });
});

describe("listCommand and listFullCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("listCommand refuses unknown users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/list", { userKey: undefined });

    await listCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Unable to identify your account. Please try again later.",
    );
  });

  it("listCommand reports an empty subscription list", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/list");

    await listCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "You have not added any subscriptions yet.",
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("listCommand lists active subscriptions before paused subscriptions", async () => {
    const kv = createMockKV();
    await seedSubscription(
      kv,
      createSub({
        id: "paused",
        name: "Paused Service",
        status: "paused",
        nextBillingDate: "2026-06-02",
      }),
    );
    await seedSubscription(
      kv,
      createSub({
        id: "active-late",
        name: "Late Active",
        nextBillingDate: "2026-06-10",
      }),
    );
    await seedSubscription(
      kv,
      createSub({
        id: "active-early",
        name: "Early Active",
        nextBillingDate: "2026-06-03",
      }),
    );
    const ctx = createContext(kv, "/list");

    await listTextCommand(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text.indexOf("Early Active")).toBeLessThan(
      text.indexOf("Late Active"),
    );
    expect(text.indexOf("Late Active")).toBeLessThan(
      text.indexOf("Paused subscriptions"),
    );
    expect(text).toContain("Paused Service");
  });

  it("listFullCommand sends a paginated inline manager", async () => {
    const kv = createMockKV();
    await seedSubscription(kv, createSub({ id: "sub-full" }));
    const ctx = createContext(kv, "/list_full");

    await listFullCommand(ctx);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(text).toContain("Your subscriptions");
    expect(JSON.stringify(options.reply_markup)).toContain(
      "list:select:sub-full:0",
    );
  });

  it("listCommand opens the same manager as the compatibility alias", async () => {
    const kv = createMockKV();
    await seedSubscription(kv, createSub({ id: "sub-list" }));
    const listCtx = createContext(kv, "/list");
    const legacyCtx = createContext(kv, "/list_full");

    await listCommand(listCtx);
    await listFullCommand(legacyCtx);

    expect(listCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Your subscriptions"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(
      JSON.stringify(
        (listCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1],
      ),
    ).toContain("list:select:sub-list:0");
    expect(legacyCtx.reply).toHaveBeenCalledTimes(1);
  });
});

describe("remindersCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses unknown users", async () => {
    const kv = createMockKV();
    const ctx = createContext(kv, "/reminders", { userKey: undefined });

    await remindersCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Unable to identify your account. Please try again later.",
    );
  });

  it("reports when there are no upcoming renewals", async () => {
    const kv = createMockKV();
    await seedSubscription(
      kv,
      createSub({ id: "future", nextBillingDate: "2026-07-01" }),
    );
    const ctx = createContext(kv, "/reminders");

    await remindersCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "No upcoming subscription payments.",
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("lists upcoming active renewals within the configured window", async () => {
    const kv = createMockKV();
    await seedSubscription(
      kv,
      createSub({ id: "due", name: "Due Soon", nextBillingDate: "2026-06-03" }),
    );
    await seedSubscription(
      kv,
      createSub({
        id: "paused",
        name: "Paused Soon",
        status: "paused",
        nextBillingDate: "2026-06-02",
      }),
    );
    await seedSubscription(
      kv,
      createSub({ id: "later", name: "Later", nextBillingDate: "2026-06-10" }),
    );
    const ctx = createContext(kv, "/reminders", {
      env: createEnv(kv, { REMINDER_DAYS_AHEAD: "3" }),
    });

    await remindersCommand(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(text).toContain("Due Soon");
    expect(text).toContain("12.99 USD");
    expect(text).not.toContain("Paused Soon");
    expect(text).not.toContain("Later");
  });
});
