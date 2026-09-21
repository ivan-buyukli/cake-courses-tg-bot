# Course Bot Commands

Implemented interfaces support Ukrainian (`ua`) and English (`en`).

| Command | Behavior |
|---|---|
| /start, /menu | Register once / open the menu; admins are not enrolled |
| /language | Persist language preference |
| /stop, /resume | Persist opt-out; purchase suppression remains effective |
| /help | Localized command list |
| /buy, /my_course | Unavailable/unknown until website integration |
| /terms, /support | Unconfigured until client details arrive |
| /privacy | Data-handling notice |
| /admin | Admin menu |
| /users | Download a UTF-8 text table with profile details, progress, payment and interaction dates; reports over 500 users have numbered files and a Next part button |
| /messages | Create/edit localized relative sequences, preview and confirm publication |
| /deliveries, /broadcasts | Standalone scheduled message editor with calendar, hour/minute picker, media preview and confirmation |
| /test | Admin's own campaign test progress, refresh and stop; start from Test campaign in the editor |
| /cancel | Cancel the active message editor |

Every admin command and callback checks the numeric-ID allowlist.
No subscription-management commands remain.
