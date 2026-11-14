# Operating system manual

## The three apps, one front door
Every app has the same top bar: **Operations** (this app), **Clients**
(InstitutionalOS console, opened already signed in), **Website**.

## Operations app (frankly-inspired-os)
- **Today** (opens first): your next steps, money due, and clients who need you.
- **Daily Briefing**, **Overview** (the counts), and the rest of the menu:
  Pipeline & Money (Pipeline, Money, Delivery, Insights), Weekly Meeting,
  Priorities & Vision, InstitutionalOS, Donor Analysis, Giving Landscape,
  Field Intelligence, Playbooks, Processes.
- **Insights > Funnel**: website visits, check-ups started, leads,
  conversations, Diagnostics, and revenue for any month, with a six-month
  trend. **Open the monthly report** prints a board-ready report.
- **Pipeline > Letter** (on each record): a proposal and engagement letter
  built from the record and the offer, editable before printing.
- **Settings**: your password and two-step sign-in; for the owner, People
  (owner, staff, board), sign-in rules, and the organization profile.
- **My Desk**: the owner's personal development space, opened from the top bar.

## InstitutionalOS (grantpass-backend)
- Console: each client in five tabs (Home, Health, Priority, 90-Day Plan,
  Evidence), the same tabs the client sees in their portal.
- Client portal, funder report, and leader survey are private links made in the
  console.

## Daily and weekly rhythm
- Morning: open Today.
- Weekly: Weekly Meeting; each client's 15-minute check-in happens in their portal.
- Monthly: Insights > Funnel, then print the monthly report.

## Scheduled tasks (run on their own)
| Task | When | What |
|---|---|---|
| Morning Sites Health Check | 4:51am ET daily | Checks every service, catches up deploys, runs the reconciliation |
| Daily reminders | 11:17am ET daily | 90-day re-check emails and client weekly check-in reminders |
| Nightly backup and retention | 2:37am ET daily | Saves a full-system backup to Google Drive, keeps 30, applies data retention |
| Weekly DMV market scan refresh | Sundays 2:23am ET | Refreshes the market scan |

## Backups
- What: every table in all three databases, one JSON file per night, from
  `GET /api/admin/backup-all` (header `X-Admin-Token: ADMIN_TOKEN_BACKUP`).
- Where: Google Drive folder "Frankly Inspired Backups", the 30 most recent.
- Restore (into a new, empty database; start the app once first so tables exist):
  - Operations: `DATABASE_URL=... node scripts/restore-backup.js backup.json operations`
  - Website backend: `DATABASE_URL=... node scripts/restore-backup.js backup.json website`
  - InstitutionalOS: `DATABASE_URL=... python3 scripts/restore_backup.py backup.json`
  Then point the service at the restored database. Tested Nov 14, 2026.

## Tests (run before every deploy)
- Operations: `TEST_DATABASE_URL=postgres://.../fios_test npm test` (18 checks)
- InstitutionalOS: `TEST_DATABASE_URL=postgres://.../ios_test python3 tests/run_tests.py` (9 checks)
- Website: `npm test` (build plus link, title, heading, and description checks on every page)
- The same tests run on GitHub on every push (Actions > Tests) once Actions are turned on for the repositories.

## Also see
- docs/SECURITY.md: sign-in, roles, keys, and how to change a key
- docs/DATA-RETENTION.md: what is kept and for how long
- docs/NEW-ORGANIZATION.md: setting the system up for another organization
