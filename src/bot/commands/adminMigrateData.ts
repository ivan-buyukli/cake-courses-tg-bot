import type { KVNamespace } from "@cloudflare/workers-types";
import type { BotContext } from "../../types/context.js";
import type { StoredSubscription } from "../../models/subscription.js";
import type { StoredUserProfile } from "../../models/user.js";
import type { ReminderEntry } from "../../repositories/reminderRepository.js";
import {
  decrypt,
  encrypt,
  parseEncryptedPayload,
  serializeEncryptedPayload,
} from "../../crypto/encryption.js";
import { deriveUserKey } from "../../crypto/keyDerivation.js";
import {
  parseReminderDateEntryKey,
  reminderDateEntry,
  userSubscriptionsIndex,
  userProfile,
} from "../../utils/kvKeys.js";
import { createLogger } from "../../utils/logger.js";

interface MigrationResult {
  profilesMigrated: number;
  subscriptionsMigrated: number;
  reminderEntriesMigrated: number;
  subscriptionIndexesRebuilt: number;
  reminderEntriesRebuilt: number;
  legacyReminderKeysDeleted: number;
  skipped: number;
}

function getUserKeyFromProfileKey(key: string): string | null {
  const match = /^user:([^:]+):profile$/.exec(key);
  return match?.[1] ?? null;
}

function getSubscriptionParts(
  key: string,
): { userKey: string; subId: string } | null {
  const match = /^user:([^:]+):sub:([^:]+)$/.exec(key);
  if (!match) return null;
  return { userKey: match[1], subId: match[2] };
}

function getLegacyReminderDate(key: string): string | null {
  const match = /^reminders:date:(\d{4}-\d{2}-\d{2})$/.exec(key);
  return match?.[1] ?? null;
}

async function listAllKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await kv.list({ prefix, cursor, limit: 1000 });
    for (const key of list.keys) keys.push(key.name);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return keys;
}

async function migrateEncryptedPayload(
  encryptedPayload: string,
  masterKey: string,
  userKey: string,
): Promise<string | null> {
  const encrypted = parseEncryptedPayload(encryptedPayload);
  const derivedKey = await deriveUserKey(masterKey, userKey);

  try {
    await decrypt(encrypted, derivedKey);
    return null;
  } catch {
    const plaintext = await decrypt(encrypted, masterKey);
    const migrated = await encrypt(plaintext, derivedKey);
    return serializeEncryptedPayload(migrated);
  }
}

async function rebuildIndexesFromSubscriptions(
  kv: KVNamespace,
): Promise<
  Pick<
    MigrationResult,
    "subscriptionIndexesRebuilt" | "reminderEntriesRebuilt" | "skipped"
  >
> {
  const result = {
    subscriptionIndexesRebuilt: 0,
    reminderEntriesRebuilt: 0,
    skipped: 0,
  };
  const idsByUser = new Map<string, string[]>();
  const subKeys = await listAllKeys(kv, "user:");

  for (const key of subKeys) {
    const subParts = getSubscriptionParts(key);
    if (!subParts) continue;

    const data = await kv.get(key);
    if (!data) continue;

    try {
      const stored = JSON.parse(data) as StoredSubscription;
      const ids = idsByUser.get(subParts.userKey) ?? [];
      if (!ids.includes(subParts.subId)) ids.push(subParts.subId);
      idsByUser.set(subParts.userKey, ids);

      if ((stored.status ?? "active") !== "active") continue;

      const reminderKey = reminderDateEntry(
        stored.nextBillingDate,
        subParts.userKey,
        subParts.subId,
      );
      if (await kv.get(reminderKey)) continue;

      await kv.put(reminderKey, "1");
      result.reminderEntriesRebuilt += 1;
    } catch {
      result.skipped += 1;
    }
  }

  for (const [userKey, ids] of idsByUser.entries()) {
    const sortedIds = [...ids].sort();
    const indexKey = userSubscriptionsIndex(userKey);
    const existing = await kv.get(indexKey);
    let existingIds: string[] = [];
    let needsRebuild = !existing;

    if (existing) {
      try {
        existingIds = JSON.parse(existing) as string[];
      } catch {
        needsRebuild = true;
      }
    }

    if (
      needsRebuild ||
      JSON.stringify([...existingIds].sort()) !== JSON.stringify(sortedIds)
    ) {
      await kv.put(indexKey, JSON.stringify(sortedIds));
      result.subscriptionIndexesRebuilt += 1;
    }
  }

  return result;
}

export async function migrateHistoricalData(
  kv: KVNamespace,
  encryptionKey: string,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    profilesMigrated: 0,
    subscriptionsMigrated: 0,
    reminderEntriesMigrated: 0,
    subscriptionIndexesRebuilt: 0,
    reminderEntriesRebuilt: 0,
    legacyReminderKeysDeleted: 0,
    skipped: 0,
  };

  const userKeys = await listAllKeys(kv, "user:");
  for (const key of userKeys) {
    const profileUserKey = getUserKeyFromProfileKey(key);
    const subParts = getSubscriptionParts(key);
    if (!profileUserKey && !subParts) continue;

    const data = await kv.get(key);
    if (!data) continue;

    try {
      if (profileUserKey) {
        const stored = JSON.parse(data) as StoredUserProfile;
        const migratedPayload = await migrateEncryptedPayload(
          stored.encryptedPayload,
          encryptionKey,
          profileUserKey,
        );
        if (!migratedPayload && stored.userKey === undefined) continue;

        const storedWithoutUserKey: StoredUserProfile = {
          encryptedPayload: stored.encryptedPayload,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        };
        const migrated: StoredUserProfile = {
          ...storedWithoutUserKey,
          encryptedPayload: migratedPayload ?? stored.encryptedPayload,
          updatedAt: new Date().toISOString(),
        };
        await kv.put(userProfile(profileUserKey), JSON.stringify(migrated));
        result.profilesMigrated += 1;
        continue;
      }

      if (subParts) {
        const stored = JSON.parse(data) as StoredSubscription;
        const migratedPayload = await migrateEncryptedPayload(
          stored.encryptedPayload,
          encryptionKey,
          subParts.userKey,
        );
        if (!migratedPayload) continue;

        const migrated: StoredSubscription = {
          ...stored,
          id: subParts.subId,
          encryptedPayload: migratedPayload,
          updatedAt: new Date().toISOString(),
        };
        await kv.put(key, JSON.stringify(migrated));
        result.subscriptionsMigrated += 1;
      }
    } catch {
      result.skipped += 1;
    }
  }

  const reminderKeys = await listAllKeys(kv, "reminders:date:");
  for (const key of reminderKeys) {
    if (parseReminderDateEntryKey(key)) continue;
    const date = getLegacyReminderDate(key);
    if (!date) continue;

    const data = await kv.get(key);
    if (!data) continue;

    try {
      const entries = JSON.parse(data) as ReminderEntry[];
      for (const entry of entries) {
        await kv.put(
          reminderDateEntry(date, entry.userKey, entry.subscriptionId),
          "1",
        );
        result.reminderEntriesMigrated += 1;
      }
      await kv.delete(key);
      result.legacyReminderKeysDeleted += 1;
    } catch {
      result.skipped += 1;
    }
  }

  const rebuildResult = await rebuildIndexesFromSubscriptions(kv);
  result.subscriptionIndexesRebuilt = rebuildResult.subscriptionIndexesRebuilt;
  result.reminderEntriesRebuilt = rebuildResult.reminderEntriesRebuilt;
  result.skipped += rebuildResult.skipped;

  return result;
}

export async function adminMigrateDataCommand(ctx: BotContext): Promise<void> {
  const logger = createLogger(ctx.requestId);

  if (!ctx.isAdmin) {
    await ctx.reply("This command is only available to admins.");
    logger.warn("Non-admin attempted data migration command");
    return;
  }

  const result = await migrateHistoricalData(
    ctx.env.SUBSCRIPTION_KV,
    ctx.env.ENCRYPTION_KEY,
  );

  await ctx.reply(
    [
      "Historical data migration complete.",
      `User profiles: ${result.profilesMigrated}`,
      `Subscription: ${result.subscriptionsMigrated}`,
      `Reminder entries: ${result.reminderEntriesMigrated}`,
      `Subscription indexes rebuilt: ${result.subscriptionIndexesRebuilt}`,
      `Reminder indexes rebuilt: ${result.reminderEntriesRebuilt}`,
      `Legacy reminder keys deleted: ${result.legacyReminderKeysDeleted}`,
      `Skipped: ${result.skipped}`,
    ].join("\n"),
  );
  logger.info("Historical data migration complete", {
    profilesMigrated: result.profilesMigrated,
    subscriptionsMigrated: result.subscriptionsMigrated,
    reminderEntriesMigrated: result.reminderEntriesMigrated,
    subscriptionIndexesRebuilt: result.subscriptionIndexesRebuilt,
    reminderEntriesRebuilt: result.reminderEntriesRebuilt,
    legacyReminderKeysDeleted: result.legacyReminderKeysDeleted,
    skipped: result.skipped,
  });
}
