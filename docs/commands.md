# Commands

## User Commands

| Command      | Description                                      | Status        |
|-------------|--------------------------------------------------|---------------|
| `/start`    | Start the bot and show welcome message           | Implemented   |
| `/menu`     | Restore the persistent main menu                 | Implemented   |
| `/cancel`   | Cancel the active flow or restore the main menu  | Implemented   |
| `/help`     | Show list of available commands                  | Implemented   |
| `/add`      | Add a new subscription (interactive or one-line) | Implemented   |
| `/list`     | Open the inline subscription manager             | Implemented   |
| `/list_full`| Compatibility alias for `/list`                  | Implemented   |
| `/list_text`| List all subscriptions in compact text           | Implemented   |
| `/export`   | Download your subscription data as a JSON file   | Implemented   |
| `/report`   | Generate subscription spending PNG overview      | Implemented   |
| `/report_text` | Generate text spending detail report         | Implemented   |
| `/reminders`| Show upcoming renewals within reminder window    | Implemented   |
| `/settings` | Configure reminder and report defaults           | Implemented   |
| `/delete_me`| Delete all your data from the bot                | Implemented   |

## Development Commands

| Command      | Description                                      | Availability  |
|-------------|--------------------------------------------------|---------------|
| `/debug_me` | Show sanitized diagnostic info                   | Dev/Test only |

`/debug_me` is only registered when `APP_ENV !== "production"`. It never exposes raw Telegram user IDs, usernames, message text, or secrets.

## Admin Commands

| Command      | Description                                      | Availability  |
|-------------|--------------------------------------------------|---------------|
| `/diagnosis`| Check runtime configuration presence and validity | Admin only    |
| `/admin_reminders` | Show reminder timezone distribution       | Admin only    |
| `/admin_sync_exchange_rates` | Fetch and persist XCurrency live exchange rates | Admin only |

## Command Details

### `/start`

Shows a welcome message with the persistent reply keyboard. First-time users are prompted to add their first subscription and can use the bottom menu buttons. Returning users see a shorter welcome message with the same persistent menu.

### `/add`

**Interactive mode** (no arguments):
1. Asks for subscription name (non-empty).
2. Asks for price. Enter a number or tap **跳过价格** to leave unset. The old `skip` text is still accepted for compatibility.
3. Select currency via inline keyboard (includes common currencies + **其他** for custom input, with a back button from custom input).
4. Select billing cycle via inline keyboard: Weekly, Monthly, Quarterly, Yearly, Custom, or Advanced interval.
   Advanced interval first offers common presets such as 30 days, 4 weeks, 6 months, and 1 year. **其他** accepts day/week/month/year intervals such as `every 30 days`, `every 4 weeks`, `every 6 months`, `30d`, `4w`, `6m`, `2y`, `每30天`, `每4周`, `每6个月`, or `每2年`.
5. Select next billing date via inline calendar keyboard with month and year navigation.
6. Confirm the generated future billing-date preview, or go back to change the cycle/date.
7. Mark whether the subscription is a trial.
8. Mark whether it auto-renews.
9. Review summary with Confirm/Cancel buttons.

The persistent menu is hidden while typed input is expected and restored on
completion or cancellation. Invalid name, price, currency, date, interval, and
timezone input stays on the same step. `/cancel`, `取消`, and the visible cancel
buttons exit without saving partial data.

**One-line mode**:
```
/add <name> <price> <currency> <cycle> <date>
```
Example: `/add Netflix 12.99 CNY monthly 2026-06-01`

Interval examples:
- `/add Gym 30 CNY 30d 2026-06-01`
- `/add Hosting 9.99 USD every 4 weeks 2026-06-01`
- `/add Domain 80 CNY 2y 2026-06-01`

One-line `/add` always creates an active, paid, auto-renewing subscription. It does not support spaces in the name; use interactive `/add` for names with spaces, trial flags, or non-auto-renewing subscriptions.

### `/list`

Displays a compact bordered three-column table (subscription, amount, next date), with
12 subscriptions per page. Full names are link-style callback buttons; the
keyboard below contains only pagination. Trial, non-renewing and paused states
appear beside names; paused dates show “已暂停”, unknown amounts “—”, and zero
amounts remain visible. The plain-text fallback uses numbered selection buttons.
Selecting a name opens a compact bordered two-column field table with collapsible notes and no separate title. All
edit, delete, pause/resume, trial, auto-renewal and back actions remain visible.
Returning preserves the page; deleting its last item clamps to the last page.

### `/list_full`

Compatibility alias that invokes the same handler as `/list`, so existing
commands and old documentation links remain valid.

### `/list_text`

Displays subscriptions sorted by status and next billing date as compact text.
Active subscriptions are shown before paused subscriptions.

The `/list` manager actions include:
- Edit
- Delete
- Pause or Resume
- Mark or unmark trial
- Enable or disable auto-renewal
- Back to list

The edit menu supports name, price, currency, cycle, next billing date, and
project-level reminder policy. Reminder policy can inherit the default repeated
window or send only once, one day before billing.

**Interactive mode**:
Click **编辑** from a `/list` detail view. Text/date/cycle edits receive a
serializable source-panel reference. After saving, the bot edits that original
detail panel and restores the persistent main menu instead of sending a second
copy of the detail.

The detail view also supports deleting, pausing, and resuming a subscription without typed IDs. Delete shows a confirmation inline keyboard before deleting. Pause happens immediately. Resume starts a short confirmation/date conversation.

Paused subscriptions remain stored and visible, but are excluded from:
- Scheduled reminders
- Automatic past-due date advancement
- Spending reports

The resume conversation shows inline buttons to resume with the existing date, open the shared date picker, or cancel. The user may also type a new date in `YYYY-MM-DD` format. The subscription is then marked active and re-added to the reminder index. Resume does not change trial or auto-renewal flags; if either flag is retained, the bot says so before and after restoring the subscription.

### `/export`

Sends `subscription-export-YYYY-MM-DD.json` as a Telegram document after an
`upload_document` chat action. The export is no longer limited by the 4096-unit
text message limit.

The export does **not** include `userKey`, raw Telegram ID, `chat_id`, or encrypted payloads. Export version `2` includes status, trial, auto-renewal, billing anchor, and interval metadata on subscriptions.

### `/report`

Generates a PNG overview report from the current subscription list:
- 未来 30 天扣款：actual payment amounts due from today through the next 30 days.
- 月均订阅成本：active auto-renewing subscriptions converted to a monthly run rate.
- 未来 12 个月预期：projected actual charges over the next 12 months.
- Upcoming line items, 30-day due-date distribution, and yearly month trend.

Subscriptions without price or currency, and subscriptions with `custom` billing cycle, are excluded from the calculated total but counted in the report. Trial subscriptions and subscriptions with auto-renewal disabled are also excluded from spending totals and surfaced as excluded counts.

Multi-currency conversion uses exchange rates stored in KV. The bot checks the XCurrency live-rate key `config:exchange-rates:xcurrency:v1` first, then falls back to the manually maintained key `config:exchange-rates:v1`:

```json
{ "base": "USD", "rates": { "USD": 1, "CNY": 7.2, "EUR": 0.923 } }
```

Rates are maintained with USD as the exchange-rate base (`1 USD = N currency`). Report totals use the user's default currency from `/settings`: source currency amounts are converted to USD first, then from USD to that default currency. Currencies missing from the exchange-rate config remain visible in the per-currency section but are not converted into the default-currency total.

Admins can refresh the XCurrency key with `/admin_sync_exchange_rates` when `XCURRENCY_API_KEY` is configured. The XCurrency API returns USD-quoted values (`1 currency = N USD`), and the bot stores their inverse to keep the internal format unchanged.

The bot sends `upload_photo` before rendering. The resulting photo includes
buttons for the text details and report settings. If PNG generation or photo
sending fails, the bot falls back to a plain-text summary.

### `/report_text`

Generates a structured Rich Message with summary tables and collapsible monthly
details. The upcoming table shows at most 30 items and labels the displayed
range when truncated; totals still include all items. Explicit rich-format
rejections fall back to equivalent plain text with the same action keyboard:
- Upcoming 30-day due line items, sorted by billing date.
- Converted upcoming 30-day total in the user's default currency.
- Future 12-month projection grouped by month.
- Trial and non-auto-renewing counts excluded from totals.

### `/reminders`

Lists subscriptions with upcoming renewals within the configured reminder window (default 3 days, controlled by `REMINDER_DAYS_AHEAD`).
Paused subscriptions are excluded. Trial subscriptions and non-auto-renewing subscriptions are included when their date is within the window. Scheduled reminder messages use trial-expiration or service-expiration wording; after the scheduled task sends the due-date service-expiration reminder for a non-auto-renewing subscription, it automatically marks that subscription as paused. Both command results and scheduled notifications label each item as 扣款, 体验到期 or 服务到期.

Scheduled delivery starts `REMINDER_DAYS_AHEAD` days before the billing date and repeats once per user-local day through the billing date. With the default value of `3`, eligible dates are D-3, D-2, D-1, and D. Failed Telegram sends are not marked as delivered and remain retryable during the same local dispatch window.

A subscription can override this behavior from `/list` → **编辑** →
**提醒方式**. The one-day override sends only at D-1 and does not send again on
the billing date. Subscriptions without an override continue to inherit the
default reminder window.

Reminder messages use a single-item summary or compact bordered three-column table,
sorted by date and name and split into at most 12 items per message. Below the
content, **已续费 · 名称** buttons remain one per row for calculable cycles, plus
one management entry. Successful or stale renewal removes only that button and
sends a short result, preserving the original summary and all other actions.
Partial delivery records and advances only successful chunks on transient
failure; Queue retries reload current state and skip delivered items.

### `/settings`

Shows current values in a two-column table, with separate action-only buttons.
Changes save immediately; the existing pickers remain available for:
- Default report currency
- Reminder enablement
- Reminder hour
- Timezone, using supported IANA timezones or custom UTC offsets such as `+8`, `-5`, and `+5:30`

Settings are stored in the encrypted user profile. Defaults are `USD`, reminders enabled, `09:00`, and `UTC`.

### `/delete_me`

Requires confirmation via inline keyboard before permanently deleting all user data:
- All subscription records
- User profile
- Associated reminder entries

### Cancelling Conversations

During active conversations, sending `/cancel` or `取消` aborts the current flow without saving partial input.

## Admin

If `ADMIN_USER_ID` is configured, that Telegram user is marked as admin (`ctx.isAdmin`).
Admin-only commands reject all other users.

### `/diagnosis`

Checks whether required runtime configuration and report currency constants are present and valid:
- `BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`
- `USER_HASH_SECRET`
- `ADMIN_USER_ID`
- `SUBSCRIPTION_KV`
- `REMINDER_QUEUE`
- `APP_ENV`
- `REMINDER_DAYS_AHEAD`
- `XCURRENCY_API_KEY`
- `EXCHANGE_RATE_BASE_CURRENCY`
- `DEFAULT_REPORT_CURRENCY`
- KV exchange-rate config, preferring `config:exchange-rates:xcurrency:v1` and falling back to `config:exchange-rates:v1`

There is no global currency environment variable. User default currency is stored per user in encrypted profile settings, and report exchange rates are stored in KV. `/diagnosis` checks the static report currency constants and validates the effective KV exchange-rate config when the KV binding is available.

The report only includes status and validation messages. It never prints secret values, raw Telegram user IDs, usernames, message text, chat IDs, `userKey`, or exchange-rate values.

### `/admin_reminders`

Scans upcoming reminder index entries and reports timezone distribution for users with reminders enabled. It is intended for operational checks and does not expose raw user IDs or subscription details.

### `/admin_sync_exchange_rates`

Fetches all fiat currency rates from XCurrency commercial data with quote currency `USD`, converts them into the bot's internal `1 USD = N currency` format, and persists them to `config:exchange-rates:xcurrency:v1`.

If `XCURRENCY_API_KEY` is not configured, the command terminates without writing KV. The command only reports currency count and API timestamp; it does not print API keys or rate values.
