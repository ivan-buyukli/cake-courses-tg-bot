# Course Promotion Bot

In-place rewrite of the subscription bot for an externally hosted online course.
The existing crypto and Telegram presentation helpers are reused; subscription commands,
KV repositories, billing reminders, and spending reports are removed.

## Local development

Requires Node.js 24+ and pnpm. Equivalent npm run commands work with existing dependencies.

1. Install dependencies: `pnpm install --frozen-lockfile`.
2. Keep your existing secrets in `.dev.vars`; see [.env.example](.env.example).
3. Set `ADMIN_USER_IDS=first_numeric_id,second_numeric_id`.
   Legacy `ADMIN_USER_ID` works when the new variable is absent.
   Empty admin configuration grants nobody admin access locally and is rejected in production.
4. Run `pnpm db:migrate:local`.
5. Run `pnpm dev` (default http://127.0.0.1:8787).
   Use `npm run dev -- --port 8788` if that port is occupied.

`GET /health` checks the process. `GET /ready` checks configuration and the D1 schema.
Neither endpoint exposes credentials. /start is a Telegram command, not a browser route.

Telegram needs an HTTPS deployment/tunnel and a webhook registered at
`https://YOUR_HOST/telegram/webhook`, with the configured webhook secret and
`allowed_updates: ["message", "callback_query", "my_chat_member"]`.
Starting a local server does not register or change your webhook.
`pnpm command:push` updates localized private-chat command menus on the configured bot.

## Current implementation

- Encrypted profiles and media references in D1.
- Persistent registration, opt-out, explicit language and block/unblock tracking.
- Ukrainian (`ua`) and English (`en`) user/admin interfaces.
- Two-admin allowlist and downloadable text user reports with status filters.
- Photo/video uploads within message editors, preview validation and repeated sending by Telegram file ID.
- Authenticated webhook, bounded bodies and durable update claims.
- Persistent localized message drafts, preview, confirmed publication and cancellation.
- Immutable sequence versions, successor enrollment and independent calendar broadcasts.
- Queued delivery with pacing, transient retries and held failed/uncertain sends.
- Private admin campaign tests with real or accelerated timing, progress and cancellation.
- Published/draft campaign overviews, test setup and test status as PNG images.
  Reports show message names and timing, without language metadata. New campaign
  messages require an admin-defined name before entering the content; existing
  unnamed snapshots show a content excerpt and remain unchanged.
  Long reports use multiple pages. Fonts and rendering are bundled locally; rendering
  failures fall back to text with navigation. User exports remain text files.
- Actual sequence progress and delivery status in the admin user list.

Use `/messages` for relative sequences. Published campaigns open read-only; choose
Edit campaign to create an editing copy. Cancelling a campaign removes its editing copies.
Use **Deliveries** or `/deliveries` (`/broadcasts` remains an alias) for standalone
scheduled messages: send text/photo/video, choose a date and time in one editable calendar panel,
then confirm. This editor has separate persistent drafts and never advances sequence progress.
The calendar uses `CAMPAIGN_TIMEZONE`, rejects nonexistent DST times and offers both
UTC offsets for repeated times. Broadcasts expire 24 hours after their scheduled time.

Upload photos/videos directly while composing a campaign or scheduled message; there is
no standalone media library or `/media` command. Existing media references remain usable.
The app uses `ua` for Ukrainian and accepts legacy `uk` preferences/content. Existing
database locale columns retain `uk`, as do Telegram command-menu API calls and Intl
formatting. No database migration is required for this language-code change.

Each campaign message supports a minute offset from campaign start or a local day/time
rule (for example, day 1 at 09:00 Europe/Berlin). Day/time rules can reference campaign
start or the previous successful message. Relative rules shift nonexistent spring times
forward and use the first occurrence of repeated autumn times; overdue steps retain
minimum spacing and never overtake the previous step. Quick tests still use two-second intervals.

Both editors offer recipient filters: all eligible non-purchasers, verified unpaid,
payment pending, or unknown status. Admins, blocked/opted-out users and purchasers remain
excluded. Unknown is not treated as verified unpaid; payment synchronization is still
unimplemented. Filters are checked at enrollment/dispatch and immediately before sending,
using the immutable published version. These fields require no new database migration.
Use `/users` to download a UTF-8 text report with all matching users and their details.
Reports over 500 users are split into numbered files; choose **Next part** to continue.
The report fixes the registration cutoff at the first part, while statuses are read
when each part is generated. Each request uses at most two report queries and retains
at most 500 users in memory; no single request scans all report pages.
Failed and uncertain deliveries remain held; there is no manual retry interface.
Locally trigger Cron with `http://127.0.0.1:8787/cdn-cgi/local/scheduled`.
Wrangler does not automatically run local Cron triggers.

### Testing a campaign

Open `/messages`, select a campaign and Edit campaign (or create a draft), then choose
**Test campaign**. The admin's current language is used automatically, with the campaign fallback when needed. Confirm with a timing mode:
- **Real timing** uses the sequence's configured offsets from test start, or the broadcast's future date/time.
- **Quick test** makes the first message due immediately and queues each next message about two seconds after the previous send. It does not wait for Cron.

The test sends only to the admin who started it. Each admin can have one active test.
The campaign snapshot and chosen language are fixed for the run; edits and publication do not change it.
Customer enrollments, payment state and live campaign publication are unaffected.
The test response includes progress, Refresh and Stop buttons. `/test` also reopens this view.
Cancellation stops unsent work; a Telegram request already in flight may still arrive.
Failed or uncertain sends stay held. Stop the test and start a new one after correcting the campaign.

Run `npm run db:migrate:local` to apply all pending migrations before running this version.
Tests share the live Cron/queue pipeline and Telegram sender. Due first messages are queued when a test starts.
For real-timing tests and normal campaigns locally, trigger `/cdn-cgi/local/scheduled` periodically, for example in Git Bash:

```sh
while true; do curl -fsS "http://127.0.0.1:8787/cdn-cgi/local/scheduled"; sleep 60; done
```

The production Cron runs every minute. Backlog and Telegram retries can delay sends.
Quick tests check content and delivery order; use real timing to check the configured schedule.

Checkout, website linking/payment synchronization, and deletion/anonymization remain
unavailable until their implementation and client configuration are complete.
The bot does not fabricate payment status or collect card details.
See [the plan](docs/course-bot-plan.md) for implementation status.

## Interface and dates

Language choices are **Українська** and **English**. Existing Polish interface preferences fall back to English;
old stored campaign snapshots remain readable. Adding a message goes directly to content entry.
Optional English/Ukrainian variants are available through **Translations** on the selected message.

Private replies and live scheduled messages include navigation. Campaign test content messages have no
menu attached; navigation remains on the test controls. Cancelling a campaign or finishing an action
leaves a menu available. The standalone My test run menu button has been removed.

Dates in messages and reports use the configured `CAMPAIGN_TIMEZONE`, defaulting to `Europe/Berlin`,
for example `20 Sept 2026, 14:30:00 (Europe/Berlin)`. Daylight-saving time is handled automatically.
Telegram does not supply a user's timezone; this is the bot's shared display timezone.
No database migration is needed for these interface and quick-test changes.

## Verification

```sh
pnpm types:check
pnpm test:run
pnpm lint
pnpm format:check
pnpm bundle:check
```

Tests use real in-memory SQLite through a D1-compatible adapter and mocked Telegram.
Passing these tests does not prove live Telegram or Stripe integration.

## Deployment and data

Follow [the production deployment checklist](docs/deployment.md) for account setup,
remote migrations, secrets, webhook registration and live smoke tests.
`npm run deploy:check` validates local production bindings without contacting Cloudflare.
`npm run deploy` works with either npm or pnpm and checks configuration and bundle size
before uploading. Production requires a working delivery queue binding as well as admins.

wrangler.toml uses a local-only D1 ID placeholder. Create a real database, replace the ID,
apply remote migrations, and configure production secrets/admins before deployment.
Old local/remote subscription KV data is not deleted or migrated and is no longer bound.

Business records have indefinite retention by default; temporary security state expires.
The admin retains original media separately. A file ID is not an independent backup.
Finalize privacy/deletion policies, support/terms, and confirmation of the external
purchase flow before public launch.

Telegram sending and database completion cannot commit together. After an uncertain
send, webhook/queue retries may duplicate a message; exactly-once delivery is not promised.
