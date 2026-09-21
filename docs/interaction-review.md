# Course Bot Interaction Review

- Both configured admins have the same permissions; mutations are attributed to actors.
- The initial locale follows Telegram when supported, otherwise English.
- Explicit /language selection survives later updates.
- /start does not reset registration or opt-out.
- Group and edited-message commands cannot run personal workflows.
- Callback data is parsed; callbacks are answered, including stale selections.
- Stale upload cancellation cannot cancel a newer session.
- Media is previewed by file ID before becoming ready.
- An older preview cannot overwrite a concurrent file-reference update.
- Unknown payment is not labeled unpaid or paid.
- `c:*`, `d:*`, `pub:*` and `archive:*` callbacks drive persistent revision-fenced drafts.
- /users sends a UTF-8 text table containing all matching users and their profile details.
- Individual user selection, delivery review, manual retries and the Course menu are removed.
- Old callbacks for removed actions expire without changing delivery state.
- Test campaign uses the admin's language automatically and confirms real or quick timing before starting.
- Each admin can view/stop only their own private test. Stale draft revisions cannot start a test.
- Test snapshots survive editing and restarts; current admin access is checked before queued sends.
- Active sequences retain published content; corrected versions do not replay completed work.
- Promotional broadcasts expire after 24 hours and require an explicit timezone offset.
- Campaign lists currently show the most recent 30 items. Albums, rich text entities,
  service announcements, detailed delivery history and editor reorder/duplicate controls
  are not yet implemented. Separate text after media requires another sequence step.

See the plan's implementation status before treating a planned flow as available.
- Empty private replies receive the appropriate menu; other inline keyboards include a way back to it.
- Dates use the configured IANA timezone with DST; raw ISO timestamps are not shown in reports or campaign summaries.
- Quick tests chain through queue delays without Cron. Optional translations are separate from Add message.
