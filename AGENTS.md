# Agent Guide: Subscription Bot

This document contains the background, structure, coding styles, and conventions needed to work effectively on this codebase.

## Project Overview

A privacy-oriented Telegram bot for managing personal subscription services. Runs on Cloudflare Workers with application-level encryption. Every user's data is encrypted with a per-user key derived from a master secret before being stored in Cloudflare KV. Telegram user IDs are hashed with HMAC-SHA-256 before being used as KV keys.

## Tech Stack

- **Runtime**: Cloudflare Workers (compatibility_flags: ["nodejs_compat"])
- **Language**: TypeScript (ESNext, moduleResolution: "Bundler")
- **Telegram SDK**: grammY + @grammyjs/conversations
- **Storage**: Cloudflare KV only (no D1, no Durable Objects, no R2)
- **Background delivery**: Cloudflare Queues for renewal reminders, produced by Cron Triggers
- **Validation**: Zod
- **Testing**: Vitest with globals
- **Crypto**: Web Crypto API (AES-GCM, HKDF, HMAC-SHA-256)
- **Package Manager**: pnpm
- **CLI**: wrangler

## Project Structure

```
src/
├── bot/              # Telegram bot setup, commands, conversations, callbacks, middleware
│   ├── commands/     # Command handlers: /start, /help, /add, /list, /list_full, /export, /report, /report_text, /reminders, /settings, /delete_me, admin/dev commands
│   ├── conversations/# Multi-step interactive flows: add, edit field/cycle, resume, settings
│   ├── callbacks/    # Inline button callbacks: sub, edit, delete, privacy
│   └── middleware/   # requestContext, auth, rateLimit, errorHandler
├── handlers/         # Worker entry points: webhook, scheduled, health
├── queues/           # Reminder Queue producer/consumer orchestration
├── services/         # Business logic: subscriptionService, privacyService
├── repositories/     # KV storage access layer with index management
├── crypto/           # Encryption, hashing, key derivation, master key parsing
├── models/           # TypeScript type definitions for Subscription, BillingCycle
├── schemas/          # Zod validation schemas (envSchema, etc.)
├── utils/            # Helpers: logger, callback parsers, date validation, keyboards
└── types/            # Shared type definitions: Env, BotContext, BaseBotContext, SessionData

test/                 # Vitest tests mirroring src structure
docs/                 # Architecture, privacy, commands, interaction review docs
```

## Build & Test

```bash
# Install
pnpm install

# Dev server (uses local KV emulation)
pnpm dev

# Run tests
pnpm test:run

# Type check
pnpm types:check

# Lint
pnpm lint
pnpm lint:fix

# Format
pnpm format
pnpm format:check

# Deploy
pnpm deploy
```

All three must pass before merging:
- `pnpm types:check` — strict TypeScript with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- `pnpm test:run` — 550+ tests across 46 files
- `pnpm lint` — ESLint with `@typescript-eslint/recommended`

## Environment Variables

| Variable | Required | Format / Notes |
|----------|----------|----------------|
| `BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | High-entropy random string |
| `ENCRYPTION_KEY` | Yes | Base64url-encoded 32-byte value. Validated at startup by `parseMasterKey()`. |
| `USER_HASH_SECRET` | Yes | High-entropy random string |
| `ADMIN_USER_ID` | No | Telegram user ID granted admin privileges (e.g. for future admin-only commands) |
| `APP_ENV` | No | `development` (default), `production`, `test` |
| `REMINDER_DAYS_AHEAD` | No | Non-negative number of days ahead to include in reminders (default: `3`) |

For local development, secrets go in `.dev.vars`. For production, use `wrangler secret put`.

## Critical Architecture Rules

### 1. Privacy: Never log raw identifiers
The following are **never** logged:
- Raw Telegram user IDs, usernames, chat IDs, or message text
- `userKey` (hashed user identifier)
- Subscription names, prices, decrypted notes
- `ENCRYPTION_KEY`, `USER_HASH_SECRET`, `BOT_TOKEN`

What **is** logged:
- `requestId` (UUID per update)
- `subId` (UUID) and `shortId` (first 8 chars)
- `updateId`
- Error messages (sanitized)
- Boolean flags like `hasUserKey`, `hasFrom`

### 2. KV keys never contain raw Telegram IDs
All KV keys use `hashUserId(telegramUserId, USER_HASH_SECRET)` which produces a base64url-encoded HMAC-SHA-256 hash (43 characters). See `src/crypto/userHash.ts`.

### 3. All subscription data is encrypted at rest
Per-user encryption keys are derived via HKDF-SHA-256 from `ENCRYPTION_KEY` and the user's hash. Payloads are encrypted with AES-GCM-256. See `src/crypto/encryption.ts` and `src/crypto/keyDerivation.ts`.

### 4. Application-level encryption with AES-GCM + HKDF
`encrypt(data, userKey, masterKey)` and `decrypt(encryptedPayload, userKey, masterKey)` are the only data encryption functions. `deriveUserKey(userKey, masterKey)` produces a 32-byte key.

### 5. Cloudflare Workers constraints
- Sessions are stored in encrypted Cloudflare KV with a 1-hour TTL; conversations can still expire after inactivity and KV remains eventually consistent.
- KV operations are async and may have eventual consistency.
- No D1, Durable Objects, or R2 are used. Queues are used only to decouple
  scheduled reminder discovery from Telegram delivery.
- Queue payloads contain only hashed user keys, subscription UUIDs, and dates;
  never include plaintext subscription data, raw Telegram IDs, or chat IDs.
- Queue consumers must validate messages and explicitly call `ack()` or
  `retry()` for every message. Transient Telegram failures must not advance a
  subscription before the retry succeeds.

## Context Types

Two context types exist:

```typescript
// Base context with custom properties (WITHOUT conversation controls)
// Use this INSIDE conversation functions
export type BaseBotContext = Context &
  SessionFlavor<SessionData> & {
    env: Env;
    userKey?: string;
    requestId: string;
  };

// Full context used in middleware and command handlers
// Has conversation controls via ConversationFlavor
export type BotContext = ConversationFlavor<BaseBotContext>;
```

## grammY Conversations: Critical Pattern

**grammY conversations do NOT inherit custom middleware properties.** `ctx.userKey`, `ctx.env`, and `ctx.requestId` are `undefined` inside conversation functions because `@grammyjs/conversations` reconstructs fresh context objects for replays.

**The ONLY way to access outside context data inside a conversation is via `conversation.external()`:**

```typescript
async function myConversation(conversation: Conversation, ctx: BaseBotContext) {
  // WRONG: ctx.userKey is undefined here
  // const repo = createSubscriptionRepository(ctx.env.SUBSCRIPTION_KV);

  // CORRECT: use conversation.external()
  const { userKey, encryptionKey, requestId } = await conversation.external(
    (outsideCtx) => ({
      userKey: outsideCtx.userKey!,
      encryptionKey: outsideCtx.env.ENCRYPTION_KEY,
      requestId: outsideCtx.requestId,
    })
  );

  // All KV/crypto operations must also be inside external()
  const result = await conversation.external(async (outsideCtx) => {
    const repo = createSubscriptionRepository(outsideCtx.env.SUBSCRIPTION_KV);
    const service = createSubscriptionService(repo, userKey, encryptionKey, requestId);
    return service.createSubscription({ ... });
  });
}
```

Repository and service objects **must** be created inside the `external()` callback using `outsideCtx.env.SUBSCRIPTION_KV`. Closure-captured `repo`/`service` created from the conversation `ctx` will fail because `ctx.env` is undefined.

## Reusable Interaction Controls

When adding or changing interactive flows, **prefer existing selectors, buttons, menus, and helpers before creating new inline keyboards or callback namespaces**. New one-off keyboards should be rare; add them only when the existing control cannot represent the workflow cleanly.

Reusable controls:

- `src/bot/conversations/dateInput.ts`
  - `collectDateInput()` for flows where users can type a date or expand a calendar.
  - `dateKeyboard()` for the shared calendar layout.
  - Uses shared `adddate:*` callbacks.
- `src/bot/conversations/currencyInput.ts`
  - `collectCurrencyInput()` for selecting a currency from common buttons or entering a custom 3-letter code.
  - Uses `currencyKeyboard()` and shared `addcurrency:*` callbacks.
- `src/bot/conversations/cycleInput.ts`
  - `collectCycleInput()` and `cycleKeyboard()` for weekly/monthly/quarterly/yearly/custom/advanced interval selection.
  - Reuse it for both add and edit flows even if callback payloads differ.
- `src/bot/keyboards/editFields.ts`
  - `EDITABLE_FIELDS` is the source of truth for editable subscription fields.
  - `editableFieldsKeyboard()` builds edit menus for normal detail views and list manager views.
- `src/bot/keyboards/confirmationKeyboard.ts`
  - `confirmationKeyboard()` for standard `<prefix>:confirm:<data>` / `<prefix>:cancel:<data>` callbacks.
  - `binaryActionKeyboard()` for two-button confirm/cancel style actions with custom callback data.
- `src/utils/conversationInput.ts`
  - `isCancelInput()` for recognizing `/cancel` and `取消`.

Before adding a new selector:

1. Check whether date, currency, cycle, edit-field, confirm/cancel, or cancel-text behavior already exists above.
2. If a new option is needed, extend the shared control and its tests instead of duplicating a local keyboard.
3. If callback formats change, update `src/utils/callbackParser.ts`, `src/bot/createBot.ts` stale fallback handlers, tests, and `docs/interaction-review.md`.
4. Keep button text and layout consistent across `/add`, edit flows, list manager, and `/settings`.

## Middleware Order (in createBot)

```typescript
bot.use(sequentialize(getSessionKey));
bot.use(session({ initial: () => ({}), getSessionKey, storage: new KvSessionStorage(...) }));
bot.use(requestContext(env));    // Sets ctx.env, ctx.userKey, ctx.requestId
bot.use(auth);                    // Sets ctx.isAdmin based on ADMIN_USER_ID
bot.use(rateLimiter());           // Per-isolate best-effort rate limiting
bot.use(errorHandler);            // Catches errors in downstream middleware
bot.use(conversations());         // Enables conversation plugin

// Then register conversations, commands, callbacks
```

`errorHandler` must run BEFORE the middleware it protects (`conversations`, commands). It catches errors in `next()`, not before it.

## Command Reference

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/add [name price currency cycle date]` | Add subscription (interactive or one-line) |
| `/list` | List all subscriptions as compact text |
| `/list_full` | Manage subscriptions with inline detail/action buttons |
| `/export` | Export all data as encrypted JSON |
| `/report` | Generate PNG spending reports |
| `/report_text` | Generate text spending reports |
| `/reminders` | Show upcoming reminders |
| `/settings` | Configure reminder and report defaults |
| `/delete_me` | Delete all user data (requires confirmation) |
| `/diagnosis` | Admin-only runtime configuration diagnosis |
| `/admin_reminders` | Admin-only reminder timezone distribution |
| `/debug_me` | Dev-only diagnostic info (not in production) |

## BillingCycle

Valid values: `"weekly"`, `"monthly"`, `"quarterly"`, `"yearly"`, `"custom"`, `"interval"`.

## Callback Data Formats

All callbacks use typed `parse*CallbackData` helpers from `src/utils/callbackParser.ts`:

| Pattern | Example | Handler |
|---------|---------|---------|
| `sub:view:<subId>` | `sub:view:abc-123` | `subViewCallback` |
| `sub:edit:<subId>` | `sub:edit:abc-123` | `subEditCallback` |
| `sub:delete:<subId>` | `sub:delete:abc-123` | `subDeleteCallback` |
| `edit:<field>:<subId>` | `edit:name:abc-123` | `editFieldCallback` |
| `editcycle:<cycle>:<subId>` | `editcycle:monthly:abc-123` | `editCycleConversation` |
| `delete:confirm:<subId>` | `delete:confirm:abc-123` | `deleteConfirmCallback` |
| `delete:cancel:<subId>` | `delete:cancel:abc-123` | `deleteCancelCallback` |
| `privacy:delete_confirm` | `privacy:delete_confirm` | `privacyDeleteConfirmCallback` |
| `privacy:delete_cancel` | `privacy:delete_cancel` | `privacyDeleteCancelCallback` |
| `cycle:<cycle>` | `cycle:monthly` | `addConversation` |
| `addcurrency:<currency>` | `addcurrency:CNY` | Shared currency picker |
| `adddate:pick:<date>` | `adddate:pick:2026-06-01` | Shared date picker |
| `add:confirm` | `add:confirm` | `addConversation` |
| `add:cancel` | `add:cancel` | `addConversation` |

## Stale Callback Handling

All subscription-related callbacks verify the subscription still exists before acting. Expired conversation buttons have fallback handlers that answer with "This selection has expired...". All callbacks call `answerCallbackQuery` to stop Telegram's loading spinner.

## Export Format

`/export` returns JSON with `version`, `exportedAt`, `subscriptions`. Sent as MarkdownV2 code block. Size limited to ~4000 chars (Telegram message limit is 4096 UTF-16 code units). Export must NOT include `userKey`, raw Telegram ID, `chat_id`, or encrypted payloads.

## Testing Conventions

- Tests live in `test/` and mirror `src/` structure
- Use `vitest` with `globals: true`
- Mock KV, crypto, and Telegram contexts as needed
- Use `createMockEnv()` pattern for environment objects
- Never use real secrets in tests
- Validate callback parsers, service logic, crypto round-trips, and conversation validators

## Code Style

- Strict TypeScript: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- Unused args prefix with `_`
- `no-explicit-any` is allowed (`"off"` in ESLint)
- Use `.js` extensions in imports (Node.js ESM)
- Prefer `const` and `async/await`
- Use Zod for runtime validation
- Use `crypto.randomUUID()` for IDs

## Common Gotchas

1. **Conversation context isolation**: `ctx.userKey`, `ctx.env`, `ctx.requestId` are undefined inside conversation functions. Always use `conversation.external()`.

2. **KV namespace in wrangler.toml**: The binding ID and preview_id must be real values. If empty, comment out the binding or `wrangler dev` will fail.

3. **ENCRYPTION_KEY format**: Must be exactly 32 bytes base64url-encoded. `parseMasterKey()` validates this at runtime. `envSchema` validates at startup.

4. **In-memory rate limiting**: Resets on isolate recycle. Acceptable for MVP but not a hard guarantee.

5. **Session expiration and consistency**: Conversations are KV-backed and can survive isolate changes, but they expire after roughly 1 hour of inactivity and KV is still eventually consistent.

6. **Delete all is non-atomic**: `SubscriptionRepository.deleteAll()` deletes subscription records, index, and profile key sequentially. Best-effort only.

7. **Webhook secret validation**: Simple `!==` comparison is acceptable for high-entropy secrets.

8. **Scheduled reminders**: Cron is configured in `wrangler.toml` (`*/30 * * * *`). The `scheduled` handler scans reminder indexes and enqueues per-user work. The Queue consumer reloads current KV state, sends through `reminderService`, explicitly acknowledges or retries each message, and uses the configured dead-letter queue after retry exhaustion.

## Documentation Files

- `docs/architecture.md` — System design and data flow
- `docs/privacy.md` — Data handling and encryption details
- `docs/commands.md` — Full command reference
- `docs/interaction-review.md` — UX flows, session behavior, stale callbacks, validation messages
- `docs/scaffold-review.md` — Security and correctness audit

## When Modifying This Codebase

1. Run `pnpm types:check`, `pnpm test:run`, `pnpm lint` after any change.
2. If you modify callback data formats, update `src/utils/callbackParser.ts` and add tests in `test/callbackDataParsers.test.ts`.
3. If you add new commands, register them in `src/bot/createBot.ts` and add tests.
4. If you add new env vars, add them to `Env` interface, `envSchema`, `.env.example`, and `README.md`.
5. If you modify privacy-related code, verify no raw IDs or secrets leak into logs or error messages.
6. If you work with conversations, always test the `conversation.external()` pattern.
7. If you add interactive buttons, reuse the shared controls in **Reusable Interaction Controls** first.
