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
