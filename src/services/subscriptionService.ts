import { SubscriptionRepository } from "../repositories/subscriptionRepository.js";
import { ReminderRepository } from "../repositories/reminderRepository.js";
import {
  Subscription,
  StoredSubscription,
  SubscriptionStatus,
} from "../models/subscription.js";
import {
  encrypt,
  decrypt,
  serializeEncryptedPayload,
  parseEncryptedPayload,
} from "../crypto/encryption.js";
import { deriveUserKey } from "../crypto/keyDerivation.js";
import { shortId } from "../utils/shortId.js";
import { getBillingAnchorDay, getNextBillingDate } from "../utils/date.js";

const DEFAULT_STATUS: SubscriptionStatus = "active";
const LIST_CONCURRENCY = 8;

export type ResolveResult =
  | { kind: "found"; id: string }
  | { kind: "ambiguous"; matches: string[] }
  | { kind: "not_found" };

export type RenewOneCycleResult =
  | { status: "renewed"; subscription: Subscription }
  | { status: "stale"; subscription: Subscription }
  | { status: "unsupported"; subscription: Subscription }
  | { status: "not_found" };

export interface SubscriptionService {
  create(
    userKey: string,
    sub: Subscription,
    encryptionKey: string,
  ): Promise<void>;
  list(userKey: string, encryptionKey: string): Promise<Subscription[]>;
  get(
    userKey: string,
    subId: string,
    encryptionKey: string,
  ): Promise<Subscription | null>;
  update(
    userKey: string,
    sub: Subscription,
    encryptionKey: string,
  ): Promise<void>;
  pause(
    userKey: string,
    subId: string,
    encryptionKey: string,
  ): Promise<Subscription | null>;
  resume(
    userKey: string,
    subId: string,
    encryptionKey: string,
    nextBillingDate?: string,
  ): Promise<Subscription | null>;
  advancePastDue(
    userKey: string,
    subId: string,
    encryptionKey: string,
    today: string,
  ): Promise<Subscription | null>;
  pauseExpiredNonRenewing(
    userKey: string,
    subId: string,
    encryptionKey: string,
  ): Promise<Subscription | null>;
  renewOneCycle(
    userKey: string,
    subId: string,
    encryptionKey: string,
    expectedBillingDate?: string,
  ): Promise<RenewOneCycleResult>;
  remove(userKey: string, subId: string): Promise<void>;
  removeAll(userKey: string): Promise<void>;
  resolveId(
    userKey: string,
    inputId: string,
    encryptionKey: string,
  ): Promise<ResolveResult>;
}

function normalizeStatus(sub: Subscription): Subscription {
  return {
    ...sub,
    status: sub.status ?? DEFAULT_STATUS,
    isTrial: sub.isTrial ?? false,
    autoRenew: sub.autoRenew ?? true,
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function createSubscriptionService(
  repo: SubscriptionRepository,
  reminderRepo: ReminderRepository,
): SubscriptionService {
  function withBillingAnchorDay(sub: Subscription): Subscription {
    return {
      ...sub,
      billingAnchorDay:
        sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate),
    };
  }

  async function decryptStored(
    stored: StoredSubscription,
    derivedKey: string,
  ): Promise<Subscription> {
    const encrypted = parseEncryptedPayload(stored.encryptedPayload);
    const decrypted = await decrypt(encrypted, derivedKey);
    const parsed = JSON.parse(decrypted) as Subscription;
    const normalized = normalizeStatus(parsed);
    return withBillingAnchorDay(normalized);
  }

  async function persist(
    userKey: string,
    sub: Subscription,
    encryptionKey: string,
  ): Promise<Subscription> {
    const previous = await repo.get(userKey, sub.id);
    const normalizedSub = normalizeStatus(sub);
    const billingAnchorDay =
      normalizedSub.billingAnchorDay ??
      getBillingAnchorDay(normalizedSub.nextBillingDate);
    const savedSub = { ...normalizedSub, billingAnchorDay };
    const derivedKey = await deriveUserKey(encryptionKey, userKey);
    const encrypted = await encrypt(JSON.stringify(savedSub), derivedKey);
    const stored: StoredSubscription = {
      id: savedSub.id,
      encryptedPayload: serializeEncryptedPayload(encrypted),
      nextBillingDate: savedSub.nextBillingDate,
      billingCycle: savedSub.billingCycle,
      billingInterval: savedSub.billingInterval,
      billingAnchorDay,
      status: savedSub.status,
      isTrial: savedSub.isTrial,
      autoRenew: savedSub.autoRenew,
      createdAt: savedSub.createdAt,
      updatedAt: savedSub.updatedAt,
    };
    const shouldHaveReminder = savedSub.status === "active";
    const previousDate = previous?.nextBillingDate;
    const reminderDateChanged = previousDate !== savedSub.nextBillingDate;
    const needsReminderEntry =
      shouldHaveReminder &&
      (!previous || previous.status === "paused" || reminderDateChanged);

    // KV cannot atomically update the encrypted record and its reminder index.
    // Add the new index first so a partial failure can only leave a stale entry,
    // which reminder processing safely rejects, instead of losing the reminder.
    if (needsReminderEntry) {
      await reminderRepo.addEntry(
        savedSub.nextBillingDate,
        userKey,
        savedSub.id,
      );
    }

    await repo.save(userKey, stored);

    // Removing an obsolete index last is also fail-safe: if deletion fails,
    // the stale entry is ignored because its date/status no longer matches.
    if (previous && (!shouldHaveReminder || reminderDateChanged)) {
      await reminderRepo.removeEntry(
        previous.nextBillingDate,
        userKey,
        savedSub.id,
      );
    }

    return savedSub;
  }

  return {
    async create(
      userKey: string,
      sub: Subscription,
      encryptionKey: string,
    ): Promise<void> {
      await persist(userKey, sub, encryptionKey);
    },

    async list(
      userKey: string,
      encryptionKey: string,
    ): Promise<Subscription[]> {
      const ids = await repo.listIds(userKey);
      if (ids.length === 0) return [];

      const derivedKey = await deriveUserKey(encryptionKey, userKey);
      const subs = await mapConcurrent(ids, LIST_CONCURRENCY, async (id) => {
        const stored = await repo.get(userKey, id);
        if (!stored) return null;
        return decryptStored(stored, derivedKey);
      });
      return subs.filter((sub): sub is Subscription => sub !== null);
    },

    async get(
      userKey: string,
      subId: string,
      encryptionKey: string,
    ): Promise<Subscription | null> {
      const stored = await repo.get(userKey, subId);
      if (!stored) return null;
      const derivedKey = await deriveUserKey(encryptionKey, userKey);
      return decryptStored(stored, derivedKey);
    },

    async update(
      userKey: string,
      sub: Subscription,
      encryptionKey: string,
    ): Promise<void> {
      await persist(userKey, sub, encryptionKey);
    },

    async pause(
      userKey: string,
      subId: string,
      encryptionKey: string,
    ): Promise<Subscription | null> {
      const sub = await this.get(userKey, subId, encryptionKey);
      if (!sub) return null;
      if (sub.status === "paused") return sub;

      const now = new Date().toISOString();
      const updated: Subscription = {
        ...sub,
        status: "paused",
        updatedAt: now,
      };
      await this.update(userKey, updated, encryptionKey);

      return updated;
    },

    async resume(
      userKey: string,
      subId: string,
      encryptionKey: string,
      nextBillingDate?: string,
    ): Promise<Subscription | null> {
      const sub = await this.get(userKey, subId, encryptionKey);
      if (!sub) return null;
      if (sub.status === "active") return sub;

      const now = new Date().toISOString();
      const newDate = nextBillingDate ?? sub.nextBillingDate;
      const updated: Subscription = {
        ...sub,
        status: "active",
        nextBillingDate: newDate,
        billingAnchorDay: getBillingAnchorDay(newDate),
        updatedAt: now,
      };
      await this.update(userKey, updated, encryptionKey);

      return updated;
    },

    async advancePastDue(
      userKey: string,
      subId: string,
      encryptionKey: string,
      today: string,
    ): Promise<Subscription | null> {
      const sub = await this.get(userKey, subId, encryptionKey);
      if (!sub) return null;
      if (sub.status === "paused") return sub;
      if (sub.isTrial || sub.autoRenew === false) return sub;

      if (sub.nextBillingDate > today) return sub;

      let nextBillingDate = sub.nextBillingDate;
      const billingAnchorDay =
        sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate);

      while (nextBillingDate <= today) {
        const next = getNextBillingDate(
          nextBillingDate,
          sub.billingCycle,
          billingAnchorDay,
          sub.billingInterval,
        );
        if (!next) return sub;
        nextBillingDate = next;
      }

      const updated: Subscription = {
        ...sub,
        nextBillingDate,
        billingAnchorDay,
        updatedAt: new Date().toISOString(),
      };
      await this.update(userKey, updated, encryptionKey);
      return updated;
    },

    async pauseExpiredNonRenewing(
      userKey: string,
      subId: string,
      encryptionKey: string,
    ): Promise<Subscription | null> {
      const sub = await this.get(userKey, subId, encryptionKey);
      if (!sub) return null;
      if (sub.status === "paused") return sub;
      if (sub.autoRenew !== false) return sub;

      return this.pause(userKey, subId, encryptionKey);
    },

    async renewOneCycle(
      userKey: string,
      subId: string,
      encryptionKey: string,
      expectedBillingDate?: string,
    ): Promise<RenewOneCycleResult> {
      const sub = await this.get(userKey, subId, encryptionKey);
      if (!sub) return { status: "not_found" };

      if (
        expectedBillingDate !== undefined &&
        sub.nextBillingDate !== expectedBillingDate
      ) {
        return { status: "stale", subscription: sub };
      }

      const billingAnchorDay =
        sub.billingAnchorDay ?? getBillingAnchorDay(sub.nextBillingDate);
      const nextBillingDate = getNextBillingDate(
        sub.nextBillingDate,
        sub.billingCycle,
        billingAnchorDay,
        sub.billingInterval,
      );

      if (!nextBillingDate) {
        return { status: "unsupported", subscription: sub };
      }

      const updated: Subscription = {
        ...sub,
        status: "active",
        isTrial: false,
        nextBillingDate,
        billingAnchorDay,
        updatedAt: new Date().toISOString(),
      };
      await this.update(userKey, updated, encryptionKey);
      return { status: "renewed", subscription: updated };
    },

    async remove(userKey: string, subId: string): Promise<void> {
      const stored = await repo.get(userKey, subId);
      if (stored) {
        await reminderRepo.removeEntry(stored.nextBillingDate, userKey, subId);
      }
      await repo.delete(userKey, subId);
    },

    async removeAll(userKey: string): Promise<void> {
      const ids = await repo.listIds(userKey);
      for (const subId of ids) {
        const stored = await repo.get(userKey, subId);
        if (stored) {
          await reminderRepo.removeEntry(
            stored.nextBillingDate,
            userKey,
            subId,
          );
        }
      }
      await repo.deleteAll(userKey);
    },

    async resolveId(
      userKey: string,
      inputId: string,
      encryptionKey: string,
    ): Promise<ResolveResult> {
      const allSubs = await this.list(userKey, encryptionKey);

      const exact = allSubs.find((s) => s.id === inputId);
      if (exact) {
        return { kind: "found", id: exact.id };
      }

      const matches = allSubs.filter((s) => shortId(s.id) === inputId);
      if (matches.length === 1) {
        return { kind: "found", id: matches[0].id };
      }
      if (matches.length > 1) {
        return {
          kind: "ambiguous",
          matches: matches.map((s) => shortId(s.id)),
        };
      }

      const prefixMatches = allSubs.filter((s) => s.id.startsWith(inputId));
      if (prefixMatches.length === 1) {
        return { kind: "found", id: prefixMatches[0].id };
      }
      if (prefixMatches.length > 1) {
        return {
          kind: "ambiguous",
          matches: prefixMatches.map((s) => shortId(s.id)),
        };
      }

      return { kind: "not_found" };
    },
  };
}
