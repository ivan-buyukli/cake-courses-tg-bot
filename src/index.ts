import { Env } from "./types/env.js";
import { handleWebhook } from "./handlers/webhook.js";
import { handleScheduled } from "./handlers/scheduled.js";
import { handleHealth } from "./handlers/health.js";
import { handleReminderQueue } from "./queues/reminderQueue.js";
import { log } from "./utils/logger.js";
import { validateEnv } from "./schemas/envSchema.js";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const validatedEnv = validateEnv(env);
      const url = new URL(request.url);

      log("info", "Incoming request", {
        requestId,
        method: request.method,
        path: url.pathname,
      });

      switch (url.pathname) {
        case "/health":
          return handleHealth();
        case "/telegram/webhook":
          return handleWebhook(request, validatedEnv);
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      log("error", "Unhandled error in fetch handler", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const validatedEnv = validateEnv(env);
    await handleScheduled(controller, validatedEnv);
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const validatedEnv = validateEnv(env);
    await handleReminderQueue(batch, validatedEnv);
  },
} satisfies ExportedHandler<Env, unknown>;
