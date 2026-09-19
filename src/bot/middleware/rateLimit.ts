import { Middleware } from "grammy";
import { BotContext } from "../../types/context.js";

/**
 * Simple in-memory rate limiter scaffold.
 *
 * Limits each userKey to at most `maxRequests` within `windowMs`.
 * Uses an in-memory Map keyed by userKey (not raw Telegram user ID).
 *
 * NOTE: This is per-isolate / per-Worker best-effort rate limiting.
 * For production-grade rate limiting across all isolates,
 * use KV, Durable Objects, or an external rate limit service.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 60,
  windowMs: 60_000, // 1 minute
};

export function rateLimiter(
  options: RateLimitOptions = DEFAULT_OPTIONS,
): Middleware<BotContext> {
  return async (ctx, next) => {
    // Skip rate limiting for webhooks/health checks that don't have a user
    const userKey = ctx.userKey;
    if (!userKey) {
      await next();
      return;
    }

    const now = Date.now();
    const entry = store.get(userKey);

    if (!entry || now >= entry.resetAt) {
      // New window
      store.set(userKey, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      await next();
      return;
    }

    if (entry.count >= options.maxRequests) {
      await ctx.reply("Too many requests. Please wait a moment and try again.");
      return;
    }

    entry.count += 1;
    await next();
  };
}
