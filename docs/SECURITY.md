# Security

## Sign-in
- **Operations app:** each person has their own email and password, with a role:
  Owner (everything), Staff (runs the practice; no people, settings, or My Desk),
  Board (view only, no My Desk). Settings > People adds and turns off accounts.
- **Two-step sign-in:** Settings > Your account. Uses any authenticator app
  (Google Authenticator, Microsoft Authenticator, 1Password). When an owner turns it
  on, the original shared practice password stops working, so it can't be used to
  skip the code.
- **InstitutionalOS console:** opened from the switcher's "Clients" link, already
  signed in (one sign-in). The operations app asks InstitutionalOS for a 12-hour
  console session with the integration key; board accounts aren't given one.
- **Client portal, funder report, leader survey:** private links with long random
  tokens; no password. Send them only to the people they're for.
- Sign-in attempts are limited per network address (8 per 15 minutes).

## Keys between the apps (names only; values live in Render > Environment)
| Purpose | Set on | Must match |
|---|---|---|
| Operations ↔ InstitutionalOS | grantpass-backend `INTEGRATION_KEY` | frankly-inspired-os `GRANTPASS_INTEGRATION_KEY`, frankly-inspired-api `GRANTPASS_INTEGRATION_KEY` |
| InstitutionalOS → Operations results | grantpass-backend `OS_IOS_TOKEN` | frankly-inspired-os `ADMIN_TOKEN_IOS` |
| Operations ↔ website backend; reminder runs | frankly-inspired-api `REMINDER_SECRET` | frankly-inspired-os `WEBSITE_ADMIN_SECRET`; the reminder scheduled task |
| Daily reconciliation (read-only) | frankly-inspired-os `ADMIN_TOKEN_STATUS` | the morning health-check scheduled task |
| Nightly backup and retention | frankly-inspired-os `ADMIN_TOKEN_BACKUP` | the backup scheduled task |
| Sessions | each app's `SESSION_SECRET` / token secret | nothing else |

## Changing a key
Generate a new random value (40+ characters), set it on both sides of the row
above at the same time, redeploy both services, update the scheduled task that
uses it, then run the operations app's Systems Check. Change keys at least once a
year, and right away if one is ever pasted into an email, a chat, or a document.

## Backups
Nightly full-system backup to Google Drive (see docs/MANUAL.md > Backups). Restore
steps are in docs/MANUAL.md and were tested on Nov 14, 2026 (all three databases
restored row-for-row into empty databases).
