# Course Bot Architecture

The repository is rewritten in place, not a second app.
Current flow: authenticated webhook -> durable D1 update claim -> grammY ->
encrypted user/media repository -> Telegram reply -> update completion.
Group and edited-message updates do not run private user workflows.
Private my_chat_member updates refresh blocking status.

D1 is authoritative. The subscription KV and reminder queue are no longer bound.
Profiles use per-user HKDF keys and AES-GCM. Media references have a separate scope.
Logs must not contain raw identifiers, names, media IDs, tokens or webhook bodies.
Rich-message helpers retain their plain-text fallback.

Cron synchronizes admin exclusions, enrolls eligible users and materializes due deliveries.
The transactional D1 outbox is dispatched through COURSE_QUEUE. Consumers claim work,
reload eligibility and pinned content, send via Telegram, and record progress in a batch.
Queue messages contain only internal delivery IDs. A sending lease that expires is held
as unknown, not silently repeated. There is no manual retry interface.

Private admin tests use separate campaign_tests and campaign_test_deliveries tables with
immutable content snapshots. The same Cron and queue consumer dispatch both live and test
work; quick tests also queue their next step after successful delivery, with a two-second queue delay.
Quick tests therefore need no additional Cron ticks. A failed continuation is retried without resending the completed step.
Text/media sending, reference refresh and failure classification share one implementation.
Test queue payloads carry only a testDeliveryId. Tests never create customer enrollments or
published campaign versions. Admin ownership is checked on controls and the current numeric
allowlist is checked again before delivery. One active test per admin is enforced by D1.

Published campaign versions are immutable. Corrections apply to later enrollments;
active users finish their pinned version. Newcomers join the latest sequence, while
existing users take unseen successors in publication order. Broadcasts use a durable
recipient cutoff at dispatch and never advance sequence progress. All broadcasts are
currently promotional, excluding purchasers, opted-out/blocked users and admins.

Each scheduler tick processes bounded batches; backlog can delay delivery. Queue
consumer concurrency is one, with per-chat spacing and transient failure retries.
Exactly-once Telegram delivery cannot be guaranteed across a network/database boundary.

See [course-bot-plan.md](course-bot-plan.md) for planned features and implementation status.
