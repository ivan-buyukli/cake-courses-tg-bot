# Interaction Review

This document reviews the Telegram interactive flows, session behavior, callback safety, and known UX limitations.

## /start Main Menu Behavior

`/start` sends a short welcome message with a persistent reply keyboard. The menu actions route to existing flows instead of duplicating business logic:

- **Add subscription** starts the `/add` conversation.
- **Manage subscriptions** opens the `/list` inline list manager. `/list_full` is a compatibility alias.
- **Spending report** runs `/report`.
- **Upcoming payments** runs `/reminders`.
- **Settings** starts `/settings`.
- **Help** shows `/help`.

The persistent reply keyboard is the closest Telegram-supported behavior to showing choices when a user returns to the chat. Bots cannot detect that a user has opened or returned to the chat screen, so the bot cannot proactively pop up a fresh menu without an incoming update.

## /add Conversation Behavior

The `/add` command starts a multi-step conversation when called without arguments:

1. **Name** — asks for subscription name. Empty input is rejected.
2. **Price** — asks for price. User can enter a number or tap **Skip price**. Legacy `skip` text is still accepted.
3. **Currency** — inline keyboard with common currencies (CNY, USD, HKD, TWD, EUR, JPY, GBP, SGD). User can choose **Other** to type a custom 3-letter code, return to the picker, or cancel. **Leave unset** is available if no price was set. Currency is required if price was set.
4. **Billing cycle** — inline keyboard with Weekly, Monthly, Quarterly, Yearly, Custom, and Advanced interval. Advanced interval shows presets (30 days, 4 weeks, 6 months, 1 year) before custom text input. **Other** accepts `every 30 days`, `every 4 weeks`, `every 6 months`, `30d`, `4w`, `6m`, `2y`, or `every 2 years`.
5. **Next billing date** — inline calendar keyboard. User can navigate by month or year, pick a day, or select **Today**.
6. **Billing date preview** — shows the next five expected billing dates. User can confirm, go back to change cycle/date, or cancel.
7. **Trial flag** — asks whether this is a trial subscription.
8. **Auto-renewal flag** — asks whether this subscription auto-renews.
9. **Review** — shows a summary with Confirm/Cancel inline buttons.

If the user sends `/cancel` at any step, the conversation exits immediately and **no partial subscription is saved**.

If validation fails, the flow remains on the current step and asks for a new
value. The review is one persistent panel: trial/renewal toggles and field edits
update it in place.

### Legacy one-line usage
`/add Netflix 12.99 CNY monthly 2026-06-01` still works and bypasses the conversation.
Interval cycles also work in one-line usage, for example `/add Gym 30 CNY 30d 2026-06-01`.
One-line usage creates active, paid, auto-renewing subscriptions.

## Edit Conversation Behavior

Editing is available from the inline list manager:

### Inline edit menu (callback-based)
1. User clicks a subscription from `/list`, then clicks **Edit**.
2. Bot shows an inline keyboard: Name, Price, Currency, Cycle, Next billing date, Reminder policy, Back.
3. Clicking a text field starts `editField` conversation.
4. Clicking **Cycle** starts `editCycle` conversation with an inline keyboard.
5. Clicking **Reminder policy** starts `editReminder` and offers either the
   default repeated reminder window or one reminder on D-1.

Trial and auto-renewal are direct actions on the `/list` detail view instead of edit-menu fields.

### editField conversation
- Prompts for the new value.
- Validates input (name non-empty, price non-negative, currency 3-letter, date YYYY-MM-DD).
- Currency uses the shared picker; custom currency input can return to the picker.
- Saves only after valid input.
- `/cancel` aborts without saving.

### editCycle conversation
- Shows inline keyboard with cycle options.
- Saves immediately after selection for fixed cycles.
- For Advanced interval, shows common presets first; custom interval text remains available behind **Other**.
- The cycle selector and advanced interval selector both provide back/cancel
  controls, and `/cancel` or `Cancel` aborts without saving.

## `/list` and `/list_full` Behavior

`/list` opens the paginated inline list manager. `/list_full` invokes the same
handler for compatibility, while `/list_text` preserves the text-only view:

- Each page shows up to 12 subscriptions in a compact name / amount / next-date table.
- Full names are link-style `list:select:<id>:<page>` callback buttons; only pagination remains below. Plain-text fallback uses numbered selection buttons.
- Active subscriptions sort before paused subscriptions.
- Selecting a subscription opens a compact bordered two-column field table and collapsible notes, with the name inside the table and no separate title. Returning keeps the source page; deletion clamps a now-empty final page.
- Detail actions support edit, delete, pause/resume, trial marking, auto-renewal changes, and back navigation.
- Delete still requires confirmation.
- Pause happens immediately.
- Resume starts a short confirmation/date conversation.

Expired panels are edited into a visible expired state with **Start again** and
**Back to menu** actions. Callback handlers always re-load from KV before mutating.

Scheduled reminder messages include quick renewal buttons for subscriptions whose next cycle can be calculated. Clicking the button advances the subscription by one billing cycle and moves the reminder index, so the same due date will not keep reminding on later days. The callback includes the reminder's original billing date, so stale clicks after the date was already advanced do not advance another cycle.

## Conversation Cancel Input

- Active conversations recognize `/cancel` and `Cancel` as cancellation input.
- During `/add`, cancelling before the final Confirm step guarantees **no partial data is written to KV**.
- Outside an active conversation, `/cancel` explains that no operation is in
  progress and restores the persistent main menu.

## Pause and Resume Behavior

The `/list` detail view can pause or resume a subscription. Pause marks the subscription as paused and removes it from the reminder index for its next billing date. Paused subscriptions remain visible but are excluded from reminders, automatic date advancement, and spending reports.

Resume starts `resumeConversation`:
- If the subscription is already active, the bot says so and exits.
- The bot shows the current relevant date using the subscription's date label (`Next payment`, `Trial ends / first payment`, or `Service expires`).
- User can tap `Resume with current date` to keep that date.
- User can open the shared date picker to select a different date.
- User can enter a new `YYYY-MM-DD` date before resuming.
- `/cancel` or `Cancel` aborts without saving.
- Resume preserves `isTrial` and `autoRenew`. If the subscription remains trial or non-auto-renewing, the prompt and success message explicitly mention the retained status.

## /reminders Behavior

The `/reminders` command lists subscriptions with upcoming renewals within the configured reminder window (default 3 days, controlled by `REMINDER_DAYS_AHEAD`).

- Loads all subscriptions, filters those with `nextBillingDate` between today and today + days ahead.
- Skips paused subscriptions.
- Sorts by billing date ascending.
- Shows name, price (if set), and billing date for each upcoming subscription.
- If no subscriptions are due within the window, replies "No upcoming subscription payments."
Trial subscriptions and non-auto-renewing subscriptions remain visible when due. Scheduled reminder messages use expiration-specific wording; after the scheduled task sends the due-date service-expiration reminder for a non-auto-renewing subscription, it automatically marks that subscription as paused. `/reminders` shares expiration-specific labels with scheduled notifications.

Scheduled delivery starts at the beginning of the configured window and repeats once per user-local day through the billing date. The default three-day setting therefore sends on D-3, D-2, D-1, and D. Cron scans enqueue one bounded message per user group, and the Queue consumer reloads current KV state before sending. Successful sends are deduplicated per subscription, billing date, and local reminder date. Network errors, Telegram 429 responses, and 5xx responses retry with exponential backoff without advancing the billing date; messages that exhaust the configured attempts move to the dead-letter queue.

Subscriptions follow that default behavior unless they have a project-level
override. The current override sends exactly once on D-1 at the user's normal
reminder hour. It does not send again on the billing date, but billing-date
advancement and non-renewing expiration handling still run normally. Existing
subscriptions have no override and therefore require no migration.

Single reminders use a summary; multiple reminders use a compact three-column
table sorted by date and name. Notifications and command results are split at
12 items. Renewal buttons stay below the content, one per item, with one shared
management entry. No row repeats “Send /list to manage subscriptions”. After a renewal or stale click,
only that renewal button is removed; a short result is sent without replacing
the original summary or removing unrelated buttons. Each successful delivery
chunk records its own sent markers. Transiently failed chunks do not advance
in the Queue path and retry independently of already delivered items.

## /settings Behavior

`/settings` shows current values in a compact bordered two-column table with action-only
buttons and saves each change immediately. It
covers report currency, reminder enablement, reminder hour, timezone, and
**Privacy and data**. The privacy panel can export a JSON file or enter the existing
double-confirmation permanent deletion flow.

## Private-chat boundary

The complete product is private-chat only. A guard runs before sequentialization,
sessions, request context, and profile writes. Group/channel commands receive a
deep-link button to private chat; legacy group callbacks show an alert. Neither
path creates a session, reads subscription KV, or refreshes a profile.

## Rich Message compatibility

grammY 1.46.0 provides Bot API 10.3 compact tables and link-style text buttons.
Lists, details, reminders, settings overviews, help and text reports share rich
presentation rules. Input pickers and destructive confirmations retain their
existing controls and callback namespaces; conversations keep KV access inside
`external()`. Details refresh after editing without repeating command instructions.

`sendRichOrPlain` and `editRichOrPlain` fall back only on explicit unsupported
rich-message or invalid-format errors. Network failures, 429, 5xx and unrelated
API errors propagate instead of causing an immediate duplicate send. Long plain
reports split at 3,900 UTF-16 code units without dropping text or breaking emoji;
the final segment carries the action keyboard. Unchanged
edits succeed; other edit errors propagate. No raw Telegram descriptions are
logged by this presentation/reminder path. Draft and ephemeral APIs remain unused.

Payload and integration tests cover the new rendering, navigation and retry
behavior. Telegram client visual acceptance remains pending: verify full-name
wrapping, three-column readability, link-style callbacks, detail controls and
settings tables on mobile and desktop using test data before rollout.

## Session Behavior on Cloudflare Workers

The bot now uses `KvSessionStorage` instead of grammY's default in-memory storage.

- Session keys are derived from the HMAC-hashed Telegram user ID.
- Session values are encrypted before being written to KV.
- Session keys are prefixed with `session:`.
- Session TTL is 1 hour and refreshes on writes.
- `sequentialize(getSessionKey)` serializes updates for the same user key to reduce KV read-modify-write races.

### Impact
- Active `/add`, edit, and resume-date conversations can survive isolate changes as long as the session has not expired.
- Conversations can still expire after roughly 1 hour of inactivity.
- If a conversation expires, old inline buttons hit fallback handlers and tell the user to restart the flow.

### Remaining caveats
- KV is eventually consistent, so near-simultaneous updates may still see stale data.
- Session writes add KV latency to every update with a session key.
- Conversation state is still transient by design and should not contain long-lived business data.

## Stale Callback Handling

Callback buttons from old messages may still be clickable. The following protections are in place:

### Subscription no longer exists
All subscription-related callbacks (`sub:view`, `sub:edit`, `sub:delete`, `sub:pause`, `sub:resume`, list manager actions, `delete:confirm`) verify the subscription still exists in KV before acting. If it was deleted:
- The callback query is answered with "Subscription not found." or "Already deleted."
- The message text is edited to "Subscription not found or already deleted."

### Malformed callback data
All callbacks use `parse*CallbackData` helpers. If parsing fails:
- The callback query is answered with "Invalid callback data."
- No further action is taken.

### Expired conversation buttons

Reminder-policy buttons use `editreminder:<inherit|once1|cancel>:<subId>`.
After the edit conversation ends, stale buttons are replaced with the standard
expired-panel message and a route back to the list manager.
Buttons specific to active conversations (`cycle:`, `editcycle:`, `cycleint:`, `addprice:`, `addcurrency:`, `adddate:`, `add:confirm`, `add:cancel`) have **fallback handlers** registered after the conversation handlers. If a conversation has ended (session expired, user cancelled, or abandoned), these fallback handlers:
- Answer the callback query with "This selection has expired..."
- Prevent the Telegram loading spinner from spinning indefinitely.

`adddate:` is the shared date picker callback namespace. It is used by `/add`, edit-date, and resume-date flows so users can either type a date or expand the inline calendar.

`addcurrency:` is the shared currency picker callback namespace. It is used by `/add`, edit-currency, and default-currency settings flows so all currency selections use the same inline button layout.

`addprice:` handles price skip/cancel buttons in `/add`. `cycleint:` handles Advanced interval presets, custom entry, back, and cancel buttons.

### Uncaught errors
All callback handlers are wrapped in `try/catch`. If an unexpected error occurs:
- The callback query is answered with "Something went wrong."
- The error is logged (without sensitive data).
- No uncaught exception propagates to the user.

## Repeated Callback Clicks

### Delete confirmation — idempotent
1. User clicks **Delete** → confirmation keyboard appears.
2. User clicks **Confirm** → subscription is deleted, message edited to " has been deleted."
3. User clicks **Confirm** again → bot checks KV, finds nothing, answers "Already deleted." and edits message to "Subscription not found or already deleted."
4. No crash, no double-deletion.

### Edit after deletion
If a user clicks **Edit** on a `/list` message for a subscription that was already deleted:
- Bot answers "Subscription not found."
- Message is edited to "Subscription not found or already deleted."

### Cancel after action completed
If a user clicks **Cancel** on a delete confirmation after the subscription was already deleted:
- The delete-cancel handler simply answers "Cancelled." and edits the message to "Delete cancelled."
- This is harmless; the subscription is already gone.

## Callback Query UX

- **All** callback handlers call `answerCallbackQuery` (directly or via `safeAnswerCallbackQuery`).
- Telegram stops showing the loading spinner immediately.
- No sensitive data (subscription names, prices, user IDs) is placed in callback query responses.
- Message edits use `safeEditMessageText` which silently ignores errors if the message was already edited or deleted.

## Privacy / Logging Review

The following are **never** logged:
- Raw Telegram user IDs, usernames, or chat IDs.
- `userKey` (hashed user identifier).
- Message text content.
- Subscription names, prices, or decrypted notes.
- `ENCRYPTION_KEY`, `USER_HASH_SECRET`, or `BOT_TOKEN`.

What **is** logged:
- `requestId` (UUID per update).
- `subId` (UUID) and `shortId` (first 8 chars) for audit trails.
- `updateId` for tracing.
- Error messages (sanitized).

## Remaining UX Limitations

1. **Coarse conversation timeout.** KV session TTL is 1 hour and refreshes on writes. There is no per-conversation timeout message; abandoned flows simply expire later.

2. **KV eventual consistency.** Session and subscription state are stored in KV, which is eventually consistent. `sequentialize` helps within the same running instance but does not make KV transactional.

3. **Multiple historical panels.** The actively edited panel is updated in
   place, and expired panels are visibly disabled, but much older manager
   messages can still show an earlier snapshot until clicked.

4. **No batch operations.** `/list` supports one subscription at a time. There is no multi-select edit/delete flow.

5. **No undo.** Deletion is permanent. The confirmation step mitigates accidental clicks, but there is no trash bin or recovery.

6. **Rate limiting is per-isolate.** The in-memory rate limiter resets when the isolate is recycled. This is acceptable for MVP but not a hard guarantee against abuse.

7. **No undo for confirmed deletion.** Button styles and double confirmation
   reduce accidental deletion, but a completed privacy deletion cannot be
   reversed.

## Validation Messages

All validation errors are user-facing and specific (messages are in English as shown to users):

| Field | Invalid input | Message |
|-------|--------------|---------|
| Name | empty | "Subscription name cannot be empty." |
| Price (add) | negative / non-numeric | "Enter a non-negative number, or select Skip price." |
| Price (edit) | negative / non-numeric | "Enter a non-negative number." |
| Currency (add) | not 3-letter | "Enter a 3-letter currency code, such as CNY or USD." |
| Currency (edit) | not 3-letter | "Enter a 3-letter currency code, such as CNY or USD." |
| Date (add) | wrong format | "Use YYYY-MM-DD format, e.g. 2026-06-01." |
| Date (edit) | wrong format | "Use YYYY-MM-DD format, e.g. 2026-06-01." |
| Cycle | invalid button | "Choose a billing cycle using the buttons." |
