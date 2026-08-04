# Scaffold Review

Date: 2026-05-18

## Findings

### 1. `requestContext.ts` — userKey derivation was missing
**Status: RESOLVED**

The middleware attached `env` and `requestId`, but `userKey` was left as a TODO. This meant no command could safely access a privacy-preserving user identifier, and any future KV access would have to hash the Telegram user ID inline (risking inconsistency or accidental raw-ID usage).

**Fix:** Implemented async `hashUserId(ctx.from.id, env.USER_HASH_SECRET)` derivation. If `ctx.from` is absent, `userKey` remains `undefined` and downstream handlers/auth must deal with it.

### 2. `auth.ts` — sets `ctx.isAdmin`
**Status: ACCEPTABLE**

Uses `ctx.from?.id` with optional chaining. Sets `ctx.isAdmin = true` when the user's Telegram ID matches `ADMIN_USER_ID`. All users are allowed to interact; admin restriction is reserved for future admin-only commands.

**Minor note:** `auth` runs after `requestContext`, so `ctx.userKey` is available, but `auth` still checks the raw Telegram user ID against `ADMIN_USER_ID`. This is correct because `ADMIN_USER_ID` is configured as a raw Telegram ID.

### 3. `errorHandler.ts` — update sanitization
**Status: ACCEPTABLE**

Does not log `ctx.update`, message text, chat content, raw Telegram user IDs, or usernames. It logs only sanitized error text and boolean flags such as `hasUserKey`.

### 4. `webhook.ts` — secret token validation
**Status: ACCEPTABLE WITH CAVEAT**

Uses a direct string comparison (`!==`). JavaScript does not have a built-in constant-time comparison primitive, and for webhook secrets the risk of timing attacks is low given network jitter and the fact that the token is a high-entropy secret.

**Caveat:** If the threat model changes, a constant-time comparison wrapper should be added.

### 5. Crypto helpers — secret format ambiguity
**Status: RESOLVED**

`encryption.ts` previously accepted any string and SHA-256 hashed it. This meant the "required format" of `ENCRYPTION_KEY` was undocumented and allowed weak short strings.

**Fix:**
- `ENCRYPTION_KEY` is now required to be a **base64url-encoded 32-byte (256-bit)** value.
- Added `parseMasterKey()` helper that decodes and validates length.
- `encryption.ts` and `keyDerivation.ts` both use the validated raw bytes directly.
- `.env.example` and README document the format and a generation command.
- `envSchema.ts` validates the format at startup using a Zod refinement.

### 6. Repository KV index consistency
**Status: MITIGATED**

Cloudflare KV does not support multi-key transactions. `subscriptionRepository.save()` writes the subscription record, then updates the index. If the index update fails (or a concurrent write races), the index can become stale.

**Mitigations applied:**
- Added comments documenting the non-atomic nature of KV operations.
- Added `rebuildIndex(userKey)` helper to reconstruct the subscription index from actual KV records.
- Added `cleanupOrphanedEntries(userKey)` helper to remove index entries pointing to missing records.
- `reminderRepository` now has a comment warning that it stores all reminders for a date in a single KV value, which could eventually exceed KV value size limits.

### 7. Placeholder clarity
**Status: ACCEPTABLE**

All non-implemented features reply with "... is not implemented yet." or contain explicit `TODO` comments. No stub pretends to be a complete feature.

### 8. `/debug_me` command
**Status: ADDED**

Added a development-only `/debug_me` command gated by `APP_ENV !== "production"`. It exposes only:
- Whether `userKey` is present (boolean, not the value)
- `requestId`
- `APP_ENV`

Does not leak Telegram user ID, username, message text, or secrets.

### 9. Rate limiting
**Status: ADDED**

Added per-isolate in-memory rate limiting (`rateLimiter` middleware). Default: 60 requests per minute per userKey. Resets on isolate recycle, which is acceptable for MVP.

### 10. Conversations and KV session storage
**Status: ADDED**

Multi-step flows (`/add`, `/list` edit actions, and list-manager resume actions) are implemented using `@grammyjs/conversations`. `/list_full` remains a compatibility alias. Fallback handlers edit expired panels with restart actions after conversations end.

The bot now uses `KvSessionStorage` instead of the default in-memory grammY session storage:
- Session keys are HMAC-hashed Telegram user IDs.
- Session values are encrypted before KV storage.
- Session values expire after 1 hour.
- `sequentialize(getSessionKey)` reduces same-user session write races.

This mitigates conversation loss on isolate changes, but KV eventual consistency still means sessions are not transactional.

### 11. Subscription lifecycle flags
**Status: ADDED**

Subscriptions now include:
- `status`: `active` or `paused`
- `isTrial`: marks trial/intro subscriptions
- `autoRenew`: marks whether billing continues automatically
- `billingAnchorDay`: preserves calendar-month billing behavior
- `billingInterval`: supports day/week/month/year interval cycles

Paused subscriptions are excluded from reminders, spending reports, and automatic date advancement. Trial and non-auto-renewing subscriptions use different reminder/report behavior.

### 12. Reports
**Status: ADDED**

`/report` generates one PNG overview with upcoming 30-day due spending, monthly subscription run rate, future 12-month projected spending, upcoming line items, and distribution charts. `/report_text` provides Telegram-safe text chunks with upcoming 30-day and projected line items.

## Remaining Risks

1. **KV Eventual Consistency:** Reads after writes may return stale data for a few seconds. This is a KV platform behavior, not a code bug. For subscription edits, it is usually acceptable.
2. **Reminder KV Value Size:** `reminderRepository` stores all daily reminders in one value. At scale, this may need sharding by user or by hour.
3. **Per-Isolate Rate Limiting:** The in-memory rate limiter resets when the isolate is recycled. This is acceptable for MVP but not a hard guarantee against abuse.
4. **KV Session Consistency:** Conversations are KV-backed and encrypted, but KV is eventually consistent. `sequentialize` helps per running instance but does not make sessions globally transactional.
5. **Session Expiration:** Session TTL is 1 hour. Users who abandon a flow for longer than that need to restart it.
6. **Non-Atomic Delete All:** `SubscriptionRepository.deleteAll()` deletes subscription records, index, and profile key sequentially. Best-effort only.
