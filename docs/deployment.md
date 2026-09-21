# Cloudflare Deployment Checklist

This deploys the messaging bot to **Cloudflare Workers**, not Pages. Checkout,
website account linking and payment synchronization are still disabled.

## 1. Choose the production account and bot

- Use Node.js 24+. Install dependencies with the pinned pnpm version and
  `pnpm install --frozen-lockfile`, or use the already-installed dependencies.
  All `npm run` scripts, including deployment, work without pnpm on PATH.
- Workers Paid is recommended for PNG rendering. Free has a 10 ms CPU limit;
  a successful local test or bundle check does not prove production CPU usage.
- Confirm the production Telegram bot and both numeric admin IDs. A bot has one
  webhook: changing it to production disconnects its existing local tunnel.
- Decide whether production should start empty or retain local users/campaigns.
  Local D1 data is not automatically uploaded. For a data transfer, stop writers,
  back up/export and import separately, preserve the encryption/hash keys, and
  use the same bot for existing media references. Do not import test data blindly.

## 2. Create Cloudflare resources

Run these yourself against the intended account, only for resources not already present:

```sh
npx wrangler login
npx wrangler d1 create course-promotion-bot
npx wrangler queues create course-deliveries
npx wrangler queues create course-deliveries-dlq
```

Put the returned D1 ID into `wrangler.toml` under `COURSE_DB`. The all-zero ID is
only a local placeholder. Keep the producer/consumer queue names consistent.
Confirm `CAMPAIGN_TIMEZONE`; `Europe/Berlin` is currently configured. Leave
`APP_ENV=production`, the every-minute Cron and `max_concurrency=1` in place.

```sh
npm run deploy:check
npm run db:migrate:remote
```

Migrations are explicit: neither app startup nor deployment applies them.
The configuration check is local-only. It cannot verify your account, remote
resource existence, remote schema, secrets or webhook.

## 3. Configure production secrets

Use the Cloudflare dashboard or the interactive commands below. Do not put
secrets in `wrangler.toml`, shell arguments, screenshots or source control.
Wrangler may prompt to create the Worker when adding its first secret.

```sh
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put USER_HASH_SECRET
npx wrangler secret put ADMIN_USER_IDS
```

- `ADMIN_USER_IDS`: both positive numeric Telegram IDs, comma-separated.
- `ENCRYPTION_KEY`: exactly 32 random bytes in base64url form (43 characters).
- `USER_HASH_SECRET`: at least 32 characters.
- `TELEGRAM_WEBHOOK_SECRET`: 32-256 letters, digits, underscores or hyphens;
  the identical value must be supplied during Telegram webhook registration.
- Preserve existing encryption/hash keys when retaining existing D1 records.
  Replacing them without a data migration makes identities/media unreadable
  or breaks identity matching.

`.dev.vars` remains local. Do not bulk-upload it: its development `APP_ENV`
must not override production settings. Optional `COURSE_WEBSITE_URL` does not
enable checkout on its own.

## 4. Verify and deploy

```sh
npm run types:check
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.eslint.json
npm run test:run
npm run lint
npm run format:check
npm run bundle:check
npm run deploy
```

`deploy` runs the configuration guard and bundle dry-run before uploading.
Deployment and secret commands change Cloudflare; the verification commands do not.

Open the deployed Worker's `/ready` endpoint. It must return HTTP 200 with
`adminConfigured: true` and `schedulingEnabled: true`. `checkoutEnabled: false`
is expected for the current release. `/health` alone does not prove readiness.

## 5. Connect Telegram and smoke-test

Use Telegram's `setWebhook` with:

- `url`: `https://YOUR-WORKER-HOST/telegram/webhook`
- `secret_token`: the same production `TELEGRAM_WEBHOOK_SECRET`
- `allowed_updates`: `["message", "callback_query", "my_chat_member"]`

Keep pending updates unless you deliberately want to discard them. Verify the
registered URL and delivery errors with `getWebhookInfo`; never post a bot token
or an unsanitized response publicly. Updating command menus is optional; ensure
`npm run command:push` targets the intended bot before running it.

Test both admins and a separate standard user:

- English/Ukrainian menus, admin access and user report downloads.
  Reports over 500 users use numbered files and a **Next part** button, avoiding
  unbounded queries and memory in a single request. Newly registered users are
  excluded after the first part's cutoff; status changes are reflected per part.
- Campaign PNGs, quick tests, and scheduled messages with real photos/videos.
- Automatic Cron/queue delivery without a local manual trigger, and stop/resume.
- Failure visibility in user reports and the dead-letter queue. A held uncertain
  send is not automatically retried; exactly-once delivery is not promised.

Inspect Cloudflare CPU/errors and queue backlog. Set up error/DLQ monitoring and
verify a D1 backup/restore procedure before inviting customers.

## Remaining client decisions

Before a paid-course launch, provide the website's account-linking/payment-event
contract, Stripe account/price configuration, support contact and purchase terms.
Confirm the external purchase flow and retention/deletion requirements. Those
decisions unlock additional implementation; they are not solved by deployment.

References: [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/),
[Queues setup](https://developers.cloudflare.com/queues/get-started/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/),
[Telegram webhook registration](https://core.telegram.org/bots/api#setwebhook).
