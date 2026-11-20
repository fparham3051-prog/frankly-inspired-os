# Data retention

What each part of the system keeps, for how long, and what happens after.
Plain rules, applied by the nightly retention run (POST /api/admin/retention
in the operations app, run by the "Nightly backup and retention" scheduled
task). Nothing about a client or a person is ever deleted automatically: the
run deletes only logs, and lists everything else for the owner to review.

| Data | Where | Kept | After that |
|---|---|---|---|
| Automation log (what each scheduled job reported) | Operations app | 180 days | Deleted automatically |
| Lead references used for the daily reconciliation | Website backend | 180 days | Deleted automatically |
| Website visit counts (page, action, date; no cookies, no IP) | Website backend | 400 days | Deleted automatically |
| Anonymous free check-up scores (no name, no email) | Website backend | Indefinitely | Used only for benchmarks and the Durability Index |
| 90-day reminder emails | Website backend | Until sent or cancelled | Deleted when sent |
| Pipeline, prospects, invoices, notes | Operations app | While useful | Archived records over a year old are listed for review |
| Prospects never contacted | Operations app | Two years | Listed for review |
| Client Diagnostic data: scores, evidence, plans, surveys | InstitutionalOS | The engagement plus three years | Delete on request or at three years (owner, by hand) |
| Accounts and sign-in settings | Operations app | While the person has access | Turn the account off in Settings > People |
| Full-system backups | Google Drive | 30 most recent | Older copies deleted by the backup task |

## Requests to delete
If a client or a visitor asks to be deleted, the owner removes them by hand in
the operations app (pipeline or prospects) and the InstitutionalOS console
(delete the organization), then confirms by email. Backups older than the
request roll off within 30 days.

## Where this is promised
- The engagement letter ("Your data" paragraph, from org.config.json > engagement.data)
- The website privacy page (visit counting and cookies)

## Storage (Settings > Storage)

How a copy stays small for years:

- **Attachments live in Google Drive.** When a Google account is connected (Settings > Connected email), new attachments on tasks and projects go to a "<name> Files" folder in that account's Drive. The database keeps only each file's name and Drive reference. Without a connection they stay in the database, as before. **Move files to Drive** moves existing ones. Files open from Projects & Team exactly as before.
- **Storage meter.** Shows the database size against the plan's size (set yours: Neon's free plan is 1,024 MB). At 70% full, the morning brief says so. That's the time to move files, archive old years, or move to a bigger plan.
- **Compressed backups.** `GET /api/admin/backup-all?gzip=1` sends the full backup gzipped, typically about a tenth of the size. `scripts/restore-backup.js` reads either form.
- **Yearly archive.** Settings > Storage downloads one file per year (`archive-YYYY.json.gz`) with everything finished that year: closed projects with their tasks and messages, paid invoices and closed pipeline records. Keep it with the organization's records. Financial and donor records are commonly kept about seven years; confirm with the organization's accountant.
- **Trim a year.** After downloading, the owner can remove that year's closed projects, tasks and messages from the live system. This works only for years that ended more than a year ago, and only after typing `DELETE <year>`. Invoices and client records are never trimmed. A trimmed year comes back only from the archive file or a backup.

Rough growth for a busy small nonprofit: 50 to 70 MB a year without attachments, about 250 to 350 MB after five years.
