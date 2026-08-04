# Subscription Bot

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ecwu/subscription-bot)

A privacy-oriented Telegram bot for managing personal subscription services. Runs on Cloudflare Workers, stores data in Cloudflare KV, encrypts sensitive payloads at the application layer, and hashes Telegram user IDs before using them in storage keys.

## Tech Stack

- **Runtime**: Cloudflare Workers (`nodejs_compat`)
- **Language**: TypeScript (strict)
- **Telegram SDK**: grammY + @grammyjs/conversations
- **Storage**: Cloudflare KV
- **Validation**: Zod
- **Testing**: Vitest
- **Crypto**: Web Crypto API (AES-GCM, HKDF, HMAC-SHA-256)
- **Reports**: SVG + resvg PNG rendering

## Project Structure

```
src/
├── bot/              # Telegram bot setup, commands, conversations, callbacks, keyboards, middleware, KV session storage
├── handlers/         # Worker fetch/scheduled/health handlers
├── services/         # Subscription, reminder, report, export, privacy, Telegram API logic
├── repositories/     # KV storage access layer and config readers
├── crypto/           # Encryption, hashing, key derivation, master key parsing
├── models/           # TypeScript type definitions
├── schemas/          # Zod validation schemas
├── utils/            # Parsers, formatting, date/math helpers, report rendering
└── types/            # Shared Env and grammY context types
```

## Features

- Add subscriptions interactively or with one-line commands.
- Track fixed cycles (`weekly`, `monthly`, `quarterly`, `yearly`), manual `custom` cycles, and interval cycles such as `30d`, `4w`, `6m`, `2y`, `every 30 days`, and `每30天`.
- Mark subscriptions as trial or non-auto-renewing so reports and reminder wording match the real billing state.
- Pause and resume subscriptions from the inline list manager. Paused subscriptions are excluded from reminders, date advancement, and spending reports.
- Manage subscriptions from the paginated `/list` panel (`/list_full` remains
  a compatibility alias), use `/list_text` for a compact text-only list, and
  download a JSON export file without Telegram's message-length limit.
- Use structured Rich Messages for help, upcoming renewals, and text reports
  when supported; Telegram API rejection automatically falls back to equivalent
  plain text with the same action keyboard.
- Keep personal data private: subscription commands and legacy callbacks stop
  before session/profile/KV middleware in groups and direct users to the bot's
  private chat.
- Send scheduled renewal reminders through Cloudflare Cron Triggers.

## Development

```bash
# Install dependencies
pnpm install

# Run dev server
pnpm dev

# Push the core slash-command menu to all private chats
pnpm command:push

# Run tests
pnpm test:run

# Type check
pnpm types:check

# Lint
pnpm lint

# Format
pnpm format

# Inspect package and artifact contributions to the Worker bundle
pnpm bundle:analyze

# Enforce the 2 MiB gzip upload budget
pnpm bundle:check
```

Before merging a code change, run:

```bash
pnpm types:check
pnpm test:run
pnpm lint
pnpm format:check
pnpm audit
pnpm bundle:check
```

The published private-chat command menu is intentionally limited to
`start`, `menu`, `add`, `list`, `report`, `reminders`, `settings`, and `help`.
Advanced commands remain available through help and the settings privacy panel.

## Worker Bundle Budget

Cloudflare Free Workers have a 3 MiB compressed script limit. This project keeps
a stricter 2 MiB gzip budget so new features cannot consume the platform limit
without an explicit decision.

The optimized Wrangler 4.107.0 baseline is 2.66 MiB raw / 1.23 MiB gzip. The
normal operating target is at most 1.35 MiB gzip; 2 MiB is the hard failure
threshold.

Wrangler minification is enabled in `wrangler.toml`. `pnpm bundle:analyze`
performs a dry-run build and reports:

- Wrangler's total raw and gzip upload size
- each npm package's uncompressed contribution to the JavaScript bundle
- separate raw and local gzip measurements for JavaScript, WebAssembly, and fonts

Package-level gzip attribution is intentionally not reported because JavaScript
is compressed as a shared stream. Run `pnpm bundle:check` before deployment;
`pnpm deploy` runs the same check automatically.

## Environment Variables

| Variable | Required | Format / Notes |
|----------|----------|----------------|
| `BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | High-entropy random string |
| `ENCRYPTION_KEY` | Yes | Base64url-encoded 32-byte value |
| `USER_HASH_SECRET` | Yes | High-entropy random string |
| `ADMIN_USER_ID` | No | Telegram user ID marked as admin |
| `APP_ENV` | No | `development` (default), `production`, `test` |
| `REMINDER_DAYS_AHEAD` | No | Days before renewal to start daily reminders through the billing date (default: 3) |
| `XCURRENCY_API_KEY` | No | XCurrency commercial data API key for admin-triggered exchange-rate sync |

Secrets belong in `.dev.vars` locally and in Wrangler secrets for production:

```bash
wrangler secret put BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put ENCRYPTION_KEY
wrangler secret put USER_HASH_SECRET
wrangler secret put XCURRENCY_API_KEY
```

## Report Exchange Rates

`/report` generates one PNG overview with upcoming 30-day due spending, monthly subscription run rate, future 12-month projected spending, upcoming line items, and distribution charts. `/report_text` generates a Telegram text version with upcoming 30-day line items and 12-month projected line items.

Known currencies are converted to the user's default report currency from `/settings` using exchange rates stored in KV. Exchange rates are maintained with USD as the base (`1 USD = N currency`), then converted from the source currency to USD and from USD to the selected default currency.

The bot supports two exchange-rate sources:
- XCurrency live rates stored at `config:exchange-rates:xcurrency:v1`
- Manually maintained rates stored at `config:exchange-rates:v1`

When both exist and are valid, XCurrency rates are used. If XCurrency rates are missing or invalid, reports fall back to the manual config.

Admins can sync XCurrency rates with:

```text
/admin_sync_exchange_rates
```

The command requires `XCURRENCY_API_KEY`. If the key is missing, the command skips without writing KV. The XCurrency endpoint returns USD-quoted rates (`1 currency = N USD`), and the bot stores their inverse so the existing report format remains `1 USD = N currency`.

Seed or update the manual fallback key `config:exchange-rates:v1` with JSON like:

```json
{ "base": "USD", "rates": { "USD": 1, "CNY": 7.2, "EUR": 0.923 } }
```

For local `wrangler dev` storage:

```bash
pnpm wrangler kv key put config:exchange-rates:v1 '{"base":"USD","rates":{"USD":1,"CNY":7.2,"EUR":0.923}}' --binding SUBSCRIPTION_KV --local
pnpm wrangler kv key get config:exchange-rates:v1 --binding SUBSCRIPTION_KV --local
```

Missing currencies are shown where possible but are not included in converted default-currency totals. Paused subscriptions, trial subscriptions, non-auto-renewing subscriptions, custom cycles, and entries without price/currency are excluded from calculated spending totals.

## Billing Cycles

Subscriptions support fixed cycles (`weekly`, `monthly`, `quarterly`, `yearly`),
`custom` cycles that do not auto-advance, and interval cycles in days, weeks, months, or years. One-line commands accept examples such as `30d`, `4w`, `6m`, `2y`, `every 30 days`, `every 4 weeks`, `every 6 months`, `每30天`, `每4周`, `每6个月`, and `每2年`.

### Generating ENCRYPTION_KEY

The master encryption key must be exactly 32 bytes (256 bits), base64url-encoded:

```bash
node -e "console.log(Buffer.from(crypto.randomBytes(32)).toString('base64url'))"
```

This key is used for application-level encryption. KV-backed session data derives a per-session AES-GCM key from it with HKDF. Never commit it to version control.

## Architecture

See `docs/architecture.md` for system design.

## Privacy

See `docs/privacy.md` for data handling and encryption details.

## Commands

See `docs/commands.md` for the full command reference.

## Scaffold Review

See `docs/scaffold-review.md` for the latest security and correctness audit.
