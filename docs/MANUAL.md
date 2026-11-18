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
- **Today** also has an "Also due" card (checklist steps and suggestions, plus when those areas are on) grant payments and reports due, donors to thank, pledge payments, donor follow-ups, minutes to write, the next board meeting, unsigned conflict statements, and Form 990 items due. Each line opens the right screen.
- **Process Library** (Library): three tabs.
  - *How we work*: each recurring job as a checklist with an owner, when it's
    used, steps (a step can carry "day N", its due date counted from the start),
    and a review date. Ten starter checklists cover consulting, InstitutionalOS,
    monthly close, grants, fundraising, board meetings, year-end and the 990,
    and onboarding. "Ready to start" suggests a checklist when the data calls for
    it (a deal reaches Diagnostic, a grant is approved, a board meeting is three
    weeks out, a new board member, month-end, December); start it or mark it
    not needed. Editing a checklist's steps makes a new version; checklists
    already started keep theirs.
  - *In progress*: every checklist you've started, its progress, and its next
    step. Overdue and upcoming steps also appear on Today under "Also due".
  - *Messages to approve*: nothing goes out on its own. When a step that sends
    a message comes up (or a follow-up is due five days after a message with
    no response, at most two), a draft waits here. Edit the To, subject, and
    message, then "Approve and open in my email" (your email app opens with it
    filled in; press send there) or, once your domain is verified with Resend,
    "Approve and send". "Don't send" sets it aside.
  - *Steps that tick themselves*: on a checklist, a step marked "Ticks itself"
    checks off when the system sees it happen (an invoice sent, a deal linked
    to InstitutionalOS, a check-in logged in the client portal, a conflict
    statement signed, a grantee report submitted, minutes approved). A step
    with a button opens the letter, report, or screen it needs. The Activity
    list on each checklist records every tick, draft, and approval.
  - *Grantee reports*: each interim and final report has a private link
    ("Copy report link" on the grant). Grantees submit there without an
    account; the report is marked received and the grant checklist ticks.
  - *What we deliver*: client materials, marked client-safe or internal. Links
    flagged "Private link" open only for you; move those files to a shared Drive
    folder and paste the new links.
- **Settings > Areas** (owner): turn whole areas on or off.
- **Grants** (Foundation): Overview (budget, committed, paid, what's due),
  Applications (filter, open one to review, decide, and track it), Active
  grants, Programs (set up a program; tick "Take applications online" for a
  public form at `/apply/<program>`). Letters print from each application.
- **Fundraising** (Foundation): Overview (raised this year vs. last, donors,
  retention, thank-yous waiting, pledges due, who to contact next, who gave last
  year but not yet this year), Gifts (record a gift; print thank-you letters;
  import or download CSV), Donors (profiles with history and next steps),
  Pledges, Campaigns. Thank every donor within 48 hours: the Overview's "Print
  all letters" button, then "Mark as thanked" on the letter page.
- **Board & Governance** (Foundation): Overview (next meeting, what needs
  attention), Meetings (plan a year, open one to take attendance, write
  minutes, record motions; print the agenda and minutes; download calendar
  files), Board members, Conflict of interest (create the year's statements,
  then copy or email each member their private signing link), Form 990 (start
  a year's checklist; tick items off), Policies (add the standard set, record
  adoption and reviews).

- **Contacts**: one record per person and organization, built automatically
  from the pipeline, prospects, grant applications, donors and the board (the
  same person in several places is one record). Open a person for their deals,
  grants, gifts, board role, checklists, messages and feedback. Fixing an email
  here updates their board, donor and grant records, open checklists and any
  message waiting for approval. Merge duplicates from the person's page.
- **Prospect report** (Contacts > Prospect report): every prospect across the system in one Google Sheet, a tab per area (website leads, all prospects, pipeline, Diagnostics, DMV market scan, contacts, grant applicants, donors) plus a summary. Create it once, share it with the team from the same screen; it refreshes itself daily. Each tab also downloads as a spreadsheet file. Internal only: the market scan tab names organizations with private ratings.
- **Connected email** (Settings, owner): connect one or more Google accounts so
  approved messages go out from your own address (including a "Send mail as"
  business address), sit in your Sent folder, keep follow-ups in the same
  thread, and replies show up on the checklist, the person, and Today. Nothing
  is sent without approval. Without a connection, approving opens the message
  in your email program.
- **System setup checklist** (Process Library > In progress): the owner's one-time setup work, dated over about six weeks, started automatically. Gmail, the test message, and two-step sign-in tick themselves; the rest you tick.
- **AI assistance** (Settings > AI assistance; switch it off under Areas). Requests go through the website server, which holds the Anthropic key; a daily limit (AI_DAILY_LIMIT, default 150 requests) caps use. Every message AI writes waits in Messages to approve, marked "AI draft".
  - *Lead brief and first reply*: new website leads get a brief (who, what their scores say, likely constraint as a guess, next step, fit) on their Prospecting row and a first-reply draft. Pop-up sign-ups get a short welcome draft.
  - *Pre-call brief*: written the day before a deal's dated next step (lead, discovery, Diagnostic stages); shows on Today and on the deal's AI page (the AI button on each Pipeline row).
  - *Call notes to records*: paste notes on the deal's AI page; review the proposed stage, next step, problem log entry, and follow-up; Apply.
  - *Diagnostic first pass*: upload documents on the deal's AI page; get seven-area pre-scores with evidence, a proposed binding constraint, a draft memo, a draft 90-day plan, and questions to verify. Documents are not stored.
  - *Reading replies*: Gmail replies are summarized and classified; an answer is drafted in the same thread; a yes or scheduling reply moves a Lead deal to Discovery call; "unsubscribe" removes a field-notes subscriber.
  - *Field Notes* (rail): a draft each month (after the 3rd) from the problem log, without names; edit, publish to the website's Insights page, then email subscribers with one approval.
  - *Foundation*: AI first read on each grant application (criteria, strengths, concerns, questions, a lean); summaries of received grantee reports; "Draft the minutes from my notes" on a meeting.
  - *Ask the system* (Today): questions answered only from the system's data.
- **Automation runs on its own**: every 15 minutes while the app is awake, and
  every 3 hours from a scheduled task, the system refreshes contacts, ticks
  checklist steps it can see are done, drafts messages and follow-ups for
  approval, and checks Gmail for replies (`POST /api/admin/tick`, status key).

- **Projects & Team** (`/hub/`, top switcher and left rail): projects, tasks with
  owners and seen/blocked status, timeline, workload, team calendar, check-ins and
  coaching, rules, goals, dashboards, client status pages, and Claude planning.
  People come from Settings → People, clients from the pipeline, and time logged
  on a task linked to a deal lands in that deal's time entries. Deal next steps,
  delivery sessions, issues and quarterly priorities show up there as tasks and
  goals and stay in step both ways. See docs/PROJECTS-AND-TEAM.md.

## InstitutionalOS (grantpass-backend)
- Console: each client in five tabs (Home, Health, Priority, 90-Day Plan,
  Evidence), the same tabs the client sees in their portal.
- Client portal, funder report, and leader survey are private links made in the
  console.

## Daily and weekly rhythm
- Morning: open Today.
- Weekly (Monday): Weekly Meeting, about 15 minutes. The system prepares it
  early Monday: last week's numbers counted from the data (conversations from
  Prospect Reports, new leads and referrals from Prospecting and the pipeline,
  wins and losses from deal stage changes, revenue booked and collected from
  invoices), the four-week average, what needs attention (overdue invoices,
  deals with late next steps or no activity, priorities off track or due soon,
  overdue checklist steps, messages waiting), and up to three suggested issues.
  With AI on, a short summary at the top. Today shows "Weekly Meeting" until
  you close it. Your part: confirm or correct the numbers, mark each priority,
  add the issue that matters, and save the one decision. Confirmed numbers are
  never overwritten; past decisions are listed on the Recap step.
- Each client's 15-minute check-in happens in their portal.
- After any call: if you use a note-taker (Google Meet's Gemini notes, Zoom AI
  Companion, Fathom, Otter, Fireflies, Read.ai), its emailed summary is picked
  up from your connected Gmail every few hours (or "Check email now"), matched
  to the deal by attendee email or the organization's name in the title, and
  turned into a proposal: deal notes, stage, next step, a problem log entry,
  and a follow-up draft. It waits in Meeting notes (Today shows the count;
  also linked from Prospect Reports) until you press Apply, which also logs
  the meeting as a conversation for the Weekly Log. Titles containing
  "coaching", "confidential", or "private" are skipped and never stored; the
  raw email text is cleared once a summary is applied or dismissed. Maryland
  requires everyone on a call to agree before it's recorded: say so at the
  start or put it in the invitation.
- Monthly: Insights > Funnel, then print the monthly report.

## Scheduled tasks (run on their own)
| Task | When | What |
|---|---|---|
| Morning Sites Health Check | 4:51am ET daily | Checks every service, catches up deploys, runs the reconciliation |
| Daily reminders | 11:17am ET daily | 90-day re-check emails and client weekly check-in reminders |
| Nightly backup and retention | 2:37am ET daily | Saves a full-system backup to Google Drive, keeps 30, applies data retention |
| Weekly DMV market scan refresh | Sundays 2:23am ET | Refreshes the market scan |
| Checklist automation | every 3 hours | Runs the automation pass (also picks up meeting summaries, fills in last week's Weekly Log, and prepares the meeting brief); notifies only when new messages are waiting or replies came in |

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
- docs/PROJECTS-AND-TEAM.md: the project and team workspace
- docs/SECURITY.md: sign-in, roles, keys, and how to change a key
- docs/DATA-RETENTION.md: what is kept and for how long
- docs/NEW-ORGANIZATION.md: setting the system up for another organization
