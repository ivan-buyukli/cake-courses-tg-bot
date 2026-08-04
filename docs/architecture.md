# Architecture

## Overview

The Subscription Bot is a Cloudflare Worker that receives Telegram updates via webhooks, stores encrypted user data in Cloudflare KV, and sends reminders via Cron Triggers. Telegram user IDs are HMAC-hashed before they appear in KV keys.

## Components

### Worker Entrypoint (`src/index.ts`)

- `fetch`: Routes HTTP requests to health, webhook, or 404 handlers.
- `scheduled`: Delegates to the reminder service for daily cron processing (`0 8 * * *`).

### Bot Layer (`src/bot/`)

- `createBot.ts`: Configures the grammY bot with middleware, commands, conversations, and callbacks.
- `commands/`: Full command handlers (`/start`, `/menu`, `/cancel`, `/help`, `/add`, `/list`, `/list_full`, `/list_text`, `/export`, `/report`, `/report_text`, `/reminders`, `/settings`, `/delete_me`, `/diagnosis`, `/admin_reminders`, `/debug_me`).
- `conversations/`: Multi-step interactive flows (`addConversation`, `editFieldConversation`, `editCycleConversation`, `resumeConversation`).
- `callbacks/`: Inline keyboard callback handlers (`sub`, `edit`, `delete`, `privacy`, list manager).
- `keyboards/`: Reusable keyboard builders for inline buttons.
- `middleware/`: Cross-cutting concerns (`sequentialize`, `requestContext`, `auth`, `rateLimit`, `errorHandler`).
- `session/`: KV-backed grammY session storage with encrypted session values and a 1-hour TTL.

### Handlers (`src/handlers/`)

- `webhook.ts`: Validates Telegram secret token and passes updates to grammY.
- `scheduled.ts`: Cron handler that sends at most one reminder per user-local day from the configured window start through the billing date, then advances eligible past-due subscriptions.
- `health.ts`: Simple health check endpoint.

### Services (`src/services/`)

Business logic layer:
- `subscriptionService.ts`: Encrypts/decrypts subscription payloads, manages CRUD, resolves IDs (short/prefix/UUID), pauses/resumes subscriptions, advances eligible past-due dates, and coordinates reminder index updates.
- `reminderService.ts`: Processes reminders: loads entries, skips stale/paused records, decrypts subscriptions, sends Telegram messages via `telegramService`, and records sent markers by billing date and user-local reminder date.
- `reportService.ts`: Builds report data (monthly subscription run rate, upcoming 30-day due spending, future 12-month projected spending, per-currency totals, day/month distributions) and formats text fallback/detail reports.
- `exportService.ts`: Aggregates user data for export.
- `privacyService.ts`: Handles data export and full deletion.
- `telegramService.ts`: Low-level Telegram Bot API client for sending messages.

### Repositories (`src/repositories/`)

Data access layer over Cloudflare KV:
- `subscriptionRepository.ts`: CRUD for subscriptions with index management, plus `rebuildIndex` and `cleanupOrphanedEntries` for repair.
- `userRepository.ts`: User profile storage (encrypted chat ID, first/last seen timestamps).
- `reminderRepository.ts`: Reminder list management per date, plus sent-marker tracking.
- `reportConfigRepository.ts`: Reads exchange-rate config from KV for `/report` currency conversion, preferring XCurrency live-rate config over the manual fallback.

### Crypto (`src/crypto/`)

- `encryption.ts`: AES-GCM encrypt/decrypt with Web Crypto using validated base64url 32-byte keys.
- `keyDerivation.ts`: HKDF-based key derivation used by KV-backed session storage.
- `userHash.ts`: HMAC-SHA-256 for deterministic user ID hashing.
- `masterKey.ts`: Validates and parses the base64url-encoded master key.

### Models & Schemas (`src/models/`, `src/schemas/`)

TypeScript interfaces and Zod schemas for:
- `Subscription` / `StoredSubscription`, including `status`, `isTrial`, `autoRenew`, `billingInterval`, and `billingAnchorDay`
- `UserProfile`
- `Reminder`
- Environment validation

### Utils (`src/utils/`)

- `kvKeys.ts`: Pure functions for KV key naming conventions.
- `date.ts`: Date arithmetic helpers.
- `money.ts`: Currency formatting helpers.
- `logger.ts`: Structured JSON logging.
- `errors.ts`: Custom error classes.
- `shortId.ts`: Short ID generation (first 8 chars of UUID).
- `commandParser.ts`: Argument parser for one-line `/add` commands.
- `callbackParser.ts`: Typed callback data parsers.
- `formatSubscription.ts`: Human-readable subscription formatting.
- `labels.ts`: Localized labels for billing cycles and other enums.
- `billingCycle.ts`: Billing cycle and interval parsing.
- `subscriptionFlags.ts`: Status/trial/auto-renewal helpers and date labels.
- `reportPng.ts` / `reportSvg.ts`: Report image rendering.

## Data Flow

### Command Flow

```
Telegram → Webhook → Bot (grammY) → Middleware → Command/Callback
                                          ↓
                                     Service Layer
                                          ↓
                                Repository (KV)
```

### Session Flow

```
Telegram update → sequentialize(getSessionKey)
                       ↓
                 session middleware
                       ↓
             KvSessionStorage read/write
                       ↓
       KV key: session:<hashed Telegram user ID>
       value: encrypted JSON, 1-hour TTL
```

The session key is the same HMAC-hashed user key used elsewhere. Session values are encrypted before storage and the TTL is refreshed on writes. `sequentialize` serializes updates for the same session key to reduce read-modify-write races.

### Reminder Flow

```
Cron Trigger → scheduled handler → reminderService
                                        ↓
                              reminderRepository.listEntries(date)
                                        ↓
                              subscriptionRepository.get + decrypt
                                        ↓
                              userRepository.getUserProfile + decrypt
                                        ↓
                              telegramService.sendMessage
                                        ↓
                              reminderRepository.markSent
                                        ↓
                         subscriptionService.advancePastDue
```

Paused subscriptions are skipped. Trial subscriptions and non-auto-renewing subscriptions still receive date-based reminders, but the reminder text describes a trial expiration or service expiration instead of a normal charge. After reminders are processed, the scheduled handler advances active, auto-renewing, non-trial subscriptions whose billing date is past due.

### Report Flow

```
/report or /report_text
        ↓
subscriptionService.list + decrypt
        ↓
reportConfigRepository.getExchangeRates
        ↓
KV config: config:exchange-rates:xcurrency:v1, then config:exchange-rates:v1
        ↓
reportService build data
        ↓
PNG overview via reportSvg/reportPng or Telegram text chunks
```

Spending totals exclude paused, trial, non-auto-renewing, custom-cycle, and incomplete price/currency subscriptions. Exchange rates are maintained with USD as the base (`1 USD = N currency`), then converted to the user's default report currency via USD. Reports prefer XCurrency rates stored at `config:exchange-rates:xcurrency:v1` and fall back to manual rates stored at `config:exchange-rates:v1`. Missing exchange rates keep a currency visible where possible but exclude it from converted default-currency totals.

## Security

- All subscription payloads are encrypted at the application level before KV storage.
- User IDs are hashed with HMAC before use as KV keys.
- User profile and session payloads are encrypted at rest.
- Webhook requests are validated via secret token.
- `ADMIN_USER_ID` marks one raw Telegram user ID as admin for future gated commands.
- Per-isolate in-memory rate limiting is applied to all user requests.
