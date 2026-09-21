import { createBot } from "./bot/createBot.js";
import {
  validateEnv,
  type Bindings,
  type CourseEnv,
} from "./schemas/envSchema.js";
import { CourseRepository } from "./repositories/courseRepository.js";
import { equalSecret } from "./crypto/privacy.js";
import { z } from "zod";
import type { Update } from "grammy/types";
import { runScheduled, deliverBatch } from "./services/deliveryService.js";

const updateSchema = z
  .object({ update_id: z.number().int().nonnegative() })
  .passthrough();
const MAX_UPDATE_BYTES = 512 * 1024;

async function readUpdate(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Invalid update");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPDATE_BYTES) {
      await reader.cancel();
      throw new RangeError("Update too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

type BotFactory = typeof createBot;

function errorSummary(error: unknown): {
  category: string;
  step?: string;
} {
  const message =
    error instanceof Error && typeof error.message === "string"
      ? error.message
      : "";
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const text = `${message} ${cause}`.toLowerCase();
  const stepMatch = /^Scheduled step failed: ([a-z-]+)$/.exec(message);
  let category = "unknown";
  if (text.includes("configuration is incomplete or invalid")) {
    category = "configuration";
  } else if (text.includes("delivery queue is not configured")) {
    category = "missing-queue-binding";
  } else if (
    text.includes("no such table") ||
    text.includes("no such column")
  ) {
    category = "database-schema";
  } else if (text.includes("d1_") || text.includes("database")) {
    category = "database";
  } else if (text.includes("queue") || text.includes("sendbatch")) {
    category = "queue";
  }
  return {
    category,
    ...(stepMatch ? { step: stepMatch[1] } : {}),
  };
}

export function createWorker(factory: BotFactory = createBot) {
  return {
    async fetch(request: Request, rawEnv: Bindings): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/health")
        return Response.json({ service: "course-bot", status: "ok" });
      if (!["/telegram/webhook", "/ready"].includes(path))
        return new Response("Not Found", { status: 404 });
      if (request.method !== (path === "/ready" ? "GET" : "POST"))
        return new Response("Method Not Allowed", { status: 405 });
      let env: CourseEnv;
      try {
        env = validateEnv(rawEnv);
      } catch {
        return Response.json(
          { error: "Configuration incomplete" },
          { status: 503 },
        );
      }
      if (path === "/ready") {
        try {
          await env.COURSE_DB.prepare(
            "SELECT id FROM campaign_versions LIMIT 1",
          ).first();
          await env.COURSE_DB.prepare(
            "SELECT id FROM campaign_test_deliveries LIMIT 1",
          ).first();
          await env.COURSE_DB.prepare(
            "SELECT owner_id FROM scheduled_message_drafts LIMIT 1",
          ).first();
          await env.COURSE_DB.prepare(
            "SELECT owner_id FROM admin_editor_state LIMIT 1",
          ).first();
          return Response.json({
            status: "ready",
            adminConfigured: env.ADMIN_USER_IDS.length > 0,
            checkoutEnabled: false,
            schedulingEnabled: !!env.COURSE_QUEUE,
          });
        } catch {
          return Response.json(
            { error: "Database migrations required" },
            { status: 503 },
          );
        }
      }
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || !(await equalSecret(secret, env.TELEGRAM_WEBHOOK_SECRET)))
        return new Response("Unauthorized", { status: 401 });
      let update: Update;
      try {
        update = updateSchema.parse(await readUpdate(request)) as Update;
      } catch (error) {
        return new Response("Invalid update", {
          status: error instanceof RangeError ? 413 : 400,
        });
      }
      const repo = new CourseRepository(env);
      const lease = crypto.randomUUID();
      let claimed = false;
      try {
        const state = await repo.claimUpdate(update.update_id, lease);
        if (state === "done") return new Response("OK");
        if (state === "busy")
          return new Response("Retry later", {
            status: 503,
            headers: { "Retry-After": "5" },
          });
        claimed = true;
        const bot = factory(env);
        await bot.init();
        await bot.handleUpdate(update);
        await repo.finishUpdate(update.update_id, lease);
        return new Response("OK");
      } catch {
        if (claimed) {
          try {
            await repo.releaseUpdate(update.update_id, lease);
          } catch {
            /* Lease expiry permits recovery after a database outage. */
          }
        }
        console.error(
          JSON.stringify({
            level: "error",
            message: "Telegram update failed",
            requestId: lease,
            updateId: update.update_id,
          }),
        );
        return new Response("Retry later", { status: 503 });
      }
    },
    async scheduled(
      _controller: ScheduledController,
      rawEnv: Bindings,
    ): Promise<void> {
      try {
        await runScheduled(validateEnv(rawEnv));
      } catch (error) {
        const summary = errorSummary(error);
        console.error(
          JSON.stringify({
            level: "error",
            message: "Campaign dispatch failed",
            ...summary,
          }),
        );
        throw new Error("Campaign dispatch failed", { cause: error });
      }
    },
    async queue(batch: MessageBatch<unknown>, rawEnv: Bindings): Promise<void> {
      try {
        await deliverBatch(batch, validateEnv(rawEnv));
      } catch {
        console.error(
          JSON.stringify({ level: "error", message: "Delivery batch failed" }),
        );
        batch.retryAll({ delaySeconds: 30 });
      }
    },
  } satisfies ExportedHandler<Bindings>;
}

export default createWorker();
