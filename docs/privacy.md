# Privacy and Retention

Profiles (Telegram ID, chat ID, username and names) use AES-GCM encryption with
per-user HKDF keys. User lookup uses HMAC hashes. Media IDs have a separate encrypted
scope. These values and secrets never appear in application logs.

Locale, timestamps, display-role flags, messaging preferences, payment state and
media metadata are operational D1 fields. Authorization uses the configured allowlist.
Only authorized admins can view decrypted profiles.

Business records are retained indefinitely by default; temporary upload sessions and
security leases expire. Original media belongs to the admin and needs a separate backup.

A deletion/anonymization workflow and final privacy notice must be completed before
public launch. Existing subscription KV data remains untouched and is no longer used.
