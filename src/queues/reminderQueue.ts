import { array, literal, object, string } from "zod";
import { createReminderRepository } from "../repositories/reminderRepository.js";
import { createSubscriptionRepository } from "../repositories/subscriptionRepository.js";
import { createUserRepository } from "../repositories/userRepository.js";
import {
  getReminderDaysAhead,
  processReminderQueueEntries,
  type ReminderEntryInput,
} from "../services/reminderService.js";
import { createSubscriptionService } from "../services/subscriptionService.js";
import type { ValidatedEnv } from "../types/env.js";
import {
  REMINDER_QUEUE_MESSAGE_VERSION,
  type ReminderQueueMessage,
} from "../types/reminderQueue.js";
import { log } from "../utils/logger.js";

const MAX_ENTRIES_PER_MESSAGE = 100;
const MAX_MESSAGES_PER_BATCH = 100;
const MAX_MESSAGE_BYTES = 120_000;
const MAX_BATCH_BYTES = 240_000;
const QUEUE_MESSAGE_METADATA_BYTES = 100;
const BASE_RETRY_DELAY_SECONDS = 60;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;

const reminderQueueEntrySchema = object({
  entry: object({
    userKey: string().min(1),
    subscriptionId: string().min(1),
  }),
  date: string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const reminderQueueMessageSchema = object({
  version: literal(REMINDER_QUEUE_MESSAGE_VERSION),
  entries: array(reminderQueueEntrySchema).min(1).max(MAX_ENTRIES_PER_MESSAGE),
}).superRefine((message, ctx) => {
  const userKey = message.entries[0]?.entry.userKey;
  if (
    userKey !== undefined &&
    message.entries.some((item) => item.entry.userKey !== userKey)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "all reminder entries in a queue message must share a userKey",
      path: ["entries"],
    });
  }
});

function buildQueueMessages(
  inputs: ReminderEntryInput[],
): ReminderQueueMessage[] {
  const entriesByUser = new Map<string, ReminderEntryInput[]>();

  for (const input of inputs) {
    const existing = entriesByUser.get(input.entry.userKey);
    if (existing) {
      existing.push(input);
    } else {
      entriesByUser.set(input.entry.userKey, [input]);
    }
  }

  const messages: ReminderQueueMessage[] = [];
  for (const entries of entriesByUser.values()) {
    for (
      let index = 0;
      index < entries.length;
      index += MAX_ENTRIES_PER_MESSAGE
    ) {
      messages.push({
        version: REMINDER_QUEUE_MESSAGE_VERSION,
        entries: entries.slice(index, index + MAX_ENTRIES_PER_MESSAGE),
      });
    }
  }

  return messages;
}

function serializedSize(message: ReminderQueueMessage): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

export async function enqueueReminderEntries(
  queue: Queue<ReminderQueueMessage>,
  inputs: ReminderEntryInput[],
): Promise<number> {
  const messages = buildQueueMessages(inputs);
  let batch: MessageSendRequest<ReminderQueueMessage>[] = [];
  let batchBytes = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await queue.sendBatch(batch);
    batch = [];
    batchBytes = 0;
  };

  for (const message of messages) {
    const messageBytes = serializedSize(message) + QUEUE_MESSAGE_METADATA_BYTES;
    if (messageBytes > MAX_MESSAGE_BYTES) {
      throw new Error("Reminder queue message exceeds the safe size limit");
    }

    if (
      batch.length >= MAX_MESSAGES_PER_BATCH ||
      batchBytes + messageBytes > MAX_BATCH_BYTES
    ) {
      await flush();
    }

    batch.push({ body: message, contentType: "json" });
    batchBytes += messageBytes;
  }

  await flush();
  return messages.length;
}

function retryDelaySeconds(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    BASE_RETRY_DELAY_SECONDS * 2 ** exponent,
    MAX_RETRY_DELAY_SECONDS,
  );
}

export async function handleReminderQueue(
  batch: MessageBatch<unknown>,
  env: ValidatedEnv,
): Promise<void> {
  const reminderRepo = createReminderRepository(env.SUBSCRIPTION_KV);
  const subRepo = createSubscriptionRepository(env.SUBSCRIPTION_KV);
  const userRepo = createUserRepository(env.SUBSCRIPTION_KV);
  const subscriptionService = createSubscriptionService(subRepo, reminderRepo);
  const daysAhead = getReminderDaysAhead(env);

  for (const message of batch.messages) {
    const parsed = reminderQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log("warn", "Discarding invalid reminder queue message", {
        messageId: message.id,
        issueCount: parsed.error.issues.length,
      });
      message.ack();
      continue;
    }

    try {
      const result = await processReminderQueueEntries(
        env,
        reminderRepo,
        subRepo,
        userRepo,
        subscriptionService,
        parsed.data.entries,
        daysAhead,
      );

      if (result.retryableFailure) {
        const delaySeconds = retryDelaySeconds(message.attempts);
        log("warn", "Retrying reminder queue message", {
          messageId: message.id,
          attempts: message.attempts,
          delaySeconds,
          entryCount: parsed.data.entries.length,
        });
        message.retry({ delaySeconds });
        continue;
      }

      message.ack();
      log("info", "Reminder queue message processed", {
        messageId: message.id,
        entryCount: parsed.data.entries.length,
        sentCount: result.sent,
        messageCount: result.messages,
        advancedCount: result.advanced,
      });
    } catch (error) {
      const delaySeconds = retryDelaySeconds(message.attempts);
      log("error", "Reminder queue processing failed", {
        messageId: message.id,
        attempts: message.attempts,
        delaySeconds,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry({ delaySeconds });
    }
  }
}
