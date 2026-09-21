# Agent Guide: Course Promotion Bot

This repository was rewritten in place from a personal subscription tracker. Do not
restore the old subscription domain or create a parallel application.

## Stack and Layout

- Node.js 24+, TypeScript ESM with .js imports, pnpm, strict TypeScript and ESLint.
- Cloudflare Workers, D1, Cron and Queues; grammY and Zod.
- No KV sessions, grammY conversations, R2, billing reports or exchange-rate services.
- src/index.ts: health/readiness, authenticated Telegram webhook, Cron and queue entry points.
- src/bot: bot setup, Ukrainian/English catalogs, campaign editor, reusable presentation.
- src/repositories: encrypted profiles/media and transactional campaigns/delivery state.
- src/services/deliveryService.ts: scheduling and Telegram delivery.
- migrations: ordered D1 schema migrations; never change an applied migration to alter existing data.
- test: Vitest with real in-memory SQLite adapter and mocked Telegram.

## Verification

Run pnpm types:check, pnpm test:run, pnpm lint, pnpm format:check and pnpm bundle:check.
The test adapter uses node:sqlite and needs Node 24+. npm run equivalents work.
Check test types with node node_modules/typescript/bin/tsc --noEmit -p tsconfig.eslint.json.
Use pnpm db:migrate:local before pnpm dev. Local Cron must be triggered manually at
/cdn-cgi/local/scheduled. Never register a live webhook or deploy without authorization.

## Privacy and Configuration

Never log raw Telegram IDs, usernames, chat IDs, message text, file IDs, user hashes,
tokens, encryption keys or webhook bodies. Use sanitized categories and opaque request IDs.
Identity and media references use the retained AES-GCM/HKDF helpers; Telegram IDs are HMAC hashed.
Operational statuses and campaign content are queryable D1 data, not application-encrypted.
Queue payloads carry internal delivery IDs only.
Do not display or overwrite .dev.vars. New config must update envSchema.ts, .env.example and README.
ADMIN_USER_IDS is a numeric allowlist; legacy ADMIN_USER_ID is a fallback. Recheck every
admin command/callback. Production requires at least one admin; development may have none.
Existing subscription KV data remains untouched and unbound.

## Domain Invariants

- First private /start registers once. Repeated /start cannot reset progress or opt-out.
- Admins are excluded from promotions. Purchase suppression overrides resume.
- Promotional broadcasts also exclude paid, opted-out and blocked users.
- Newcomers enter the latest logical sequence; existing users receive unseen successors in order.
- Published versions are immutable; active enrollments keep their version through corrections.
- Broadcast recipient cutoffs are durable. Broadcasts never advance sequence progress.
- D1 uniqueness, transactional batches and conditional leases provide concurrency control.
- Record success before advancing; uncertain network sends stay held and appear in user reports.
- Telegram sends and D1 commits are not atomic. Never promise exactly-once delivery.
- Every queue message must be acknowledged or retried.
- No delivery-review or manual-retry interface; publication requires confirmation.
- Private admin campaign tests use separate snapshots/jobs, never customer enrollments or publication.
- Recheck test ownership and current admin access; one active test per admin, with cancellation and held uncertain sends.
- Media file IDs are bot-specific; validate previews and guard refreshes against concurrent uploads.
- Reuse confirmationKeyboard and richMessage helpers; validate callback data in callbackParser.
- All new interface strings must exist in en and ua. Accept legacy/Telegram uk at boundaries;
  database locale columns and Telegram/Intl APIs retain ISO uk. Authored content has explicit fallback.
- Media uploads happen only inside the campaign/scheduled-message editors; no standalone library.
- Business records retain indefinitely by default; security credentials expire.

## Current Boundary

Checkout and website linking/synchronization remain unimplemented and intentionally disabled.
Do not invent paid status, production price/domain or grant course access from browser redirects.
The website is the course-access authority; Stripe integration needs verified provider events
and confirmed account links. Telegram external-purchase policy confirmation is a launch gate.
See docs/course-bot-plan.md for implemented behavior, remaining scope and acceptance criteria.
- Quick tests queue each next message after success with a two-second delay; real tests retain Cron timing.
- Private replies must offer navigation, except campaign test content messages; test controls retain navigation. Display dates with formatDateTime and CAMPAIGN_TIMEZONE.
- Polish is retired from the interface; preserve readability of existing immutable campaign snapshots.
