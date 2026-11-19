# Projects & Team

The project and team workspace (built and tested as the "Flow Hub" on claude.ai)
now runs inside the operations app at **/hub/**. Same sign-in, same phone app,
same database and nightly backup. Open it from the "Projects & Team" link in the
top switcher or the left rail.

## What it does
- **Projects:** portfolio with health, seven views per project (overview, list,
  board, timeline, table, files, request form), templates, duplicate, baselines.
- **Tasks:** one owner and a status everyone sees (assigned → seen → in progress
  → review → done, or blocked with a reason), subtasks, collaborators, start and
  due dates, milestones, "waits for" links (a slip moves the tasks that wait),
  checklists, comments with @mentions, files, approvals, time logging.
- **Team:** shared calendar, team board by person, workload against weekly hours,
  daily check-ins and 1:1 coaching (private to the person and the owner).
- **Automation:** rules (when → then), date rules (coming up, overdue), request
  forms, a weekday morning digest.
- **Reporting:** dashboards, goals, client status page, work insights (time and
  cost by phase), benchmarks, usability tests.
- **Claude:** plan a project from a brief, suggest missing tasks, draft a status
  update, answer questions about the work (uses the practice's AI relay and its
  daily limit).

## How it fits the rest of the operations app
| In Projects & Team | Comes from |
|---|---|
| Team members | Sign-in accounts (Settings → People). Add or remove people there. |
| Clients a project or task links to | Pipeline deals (Pipeline & Money). Clicking one opens the pipeline. |
| Time logged on a task linked to a deal | Also written to that deal's time entries, so Pipeline & Money counts it. |
| Invoices | Stay in Pipeline & Money. The hub's own pipeline, revenue and outbox screens are turned off here. |
| Email | The Gmail account connected in Settings → Connected email, only after the owner turns on "Allow Projects & Team to send email" (Projects & Team → Setup). |

## Run the practice flows through it
Records from Run the practice show up in Projects & Team as real tasks and
goals, with owners, due dates, comments, time and status. Changes made in either
place reach the other within about 15 seconds.

| In Run the practice | In Projects & Team | Changes that go back |
|---|---|---|
| A deal's next step (open deals: lead, discovery, assessment, engaged) | A task in **Pipeline next steps**, in the section for the deal's stage, with the client shown | Rename or re-date it and the deal's next step changes. Finish it and the deal's next step is cleared so you can set the next one. Change the stage in Pipeline & Money. |
| Delivery sessions (Pipeline & Money → Delivery) | Tasks in a **Delivery: client** project, sections Not started / Scheduled / Complete | Name, session date and status, both ways. Finishing one marks it Complete. |
| Issues (Priorities & Vision) | Tasks in **Issues (Weekly Meeting)** | Finishing one marks it solved; reopening reopens it; renaming renames it. |
| Quarterly priorities (Rocks) | **Goals**, shown with their quarter | Title, due date, and a check-in's on-track / off-track / done. |
| Checklist steps (running checklists, and ones finished in the last 30 days) | Tasks in **Checklists**, one section per checklist | Ticking a step ticks it there (finishing every step completes the checklist); due date and wording too. |
| Board & Governance annual checklist | Tasks in **Board & Governance checklist**, by fiscal year | Done and due date. |
| Grantee reports due | Tasks in **Grant reports due** | Finishing one marks the report received. |
| Donor touches with a next step | Tasks in **Donor follow-ups** | Done and due date. |
| Prospects (except "not a fit") | "Reach out to …" tasks in **Prospects to reach**, section = status | Finishing one marks the prospect contacted; moving it to another section changes its status. Promote to a deal in Prospecting. |

- Every mirrored task starts owned by the owner account (Franklin) and already marked seen.
  Reassign them like any task.
- Anything added in the hub (owner, collaborators, comments, checklist, time,
  files) is kept when the source record changes.
- When a record leaves Run the practice (deal closed or archived, issue or
  session archived), its unfinished task is taken off the lists but kept.
- Deleting a mirrored task hides it until its source record changes again.
- The **Weekly Meeting** brief now also flags blocked tasks, projects off track
  or at risk, project tasks past due, and approvals waiting two days or more.

## Who sees and changes what
| | Owner | Staff | Board |
|---|---|---|---|
| Projects, tasks, calendar, goals, dashboards | see and change | see and change | see only |
| Rules, workspace settings, cost rates | see and change | see rules, not rates | see rules |
| Check-ins, coaching notes, activity log | everyone's | their own | none |
| Own team extras (weekly hours, digest) | everyone's | their own | — |

Enforced on the server (`hub.js`), not only in the page.

## Server pieces
- `hub.js` mounts the page and these endpoints: `GET /api/hub/sync`,
  `POST /api/hub/write`, `POST /api/hub/ai`, `POST /api/hub/email`,
  `POST|GET|DELETE /api/hub/files`, `POST /api/admin/hub-digest` (status key).
- Tables `hub_docs` (one row per document, tombstones for deletes, a forward-only
  clock for sync) and `hub_files` (attachments, 10 MB each). Both are in the
  nightly full-system backup; files are exported as base64 and turned back into
  bytes by `scripts/restore-backup.js`.
- Open pages check for changes every 4 seconds (20 when the tab is hidden), so
  teammates see each other's updates within a few seconds. "Who's here" uses the
  same call.
- The morning digest runs inside the automation tick: weekdays after 7am ET, once
  a day, to people who turned it on, only when hub email is on.

## Page pieces
- `public/hub/` is the hub page. `js/fios.js` connects it to the endpoints above
  (it stands in for claude.ai's page tools); `js/fios-ui.js` adjusts wording and
  hides screens that the operations app already covers. The rest is the same code
  that runs on claude.ai.
- `public/hub/tests.html` runs the hub's 29 self-checks in the browser (local copy,
  no real data). `public/hub/demo.html` is the fictional demo workspace for pilot
  conversations (stays in the visitor's browser).

## Moving data over from the claude.ai version
On claude.ai: Projects & Team → Setup → Privacy & data → Back up. Here: the same
page → Restore, then check people and client links (claude.ai teammates and
clients have different ids).

## Known limits
- Rules and date rules run in the browser of whoever is using the hub.
- Google Calendar sync is not connected here yet; the team calendar is shared
  inside the hub.
- Request forms are for signed-in people only.

## On the Today page

Today has a **Your tasks** card fed by `GET /api/hub/today`: your tasks in Projects & Team that are blocked, waiting on your approval, overdue, due today, or due in the next three days. Deal next steps and checklist steps are left out there because Today already has their own cards. Each row opens the task in Projects & Team (`/hub/#task/<id>`). The card also says how many projects are marked at risk or off track.

When anyone opens the operations app, it also wakes the website server and InstitutionalOS (both sleep on Render's free plan), at most once every ten minutes, so the client console and AI answers are ready when you reach for them. "Open client records" on Today now signs you straight into InstitutionalOS.

## Conversation, history and undo (v13)

**Messages** are their own records (`msgs`), attached to a task, a project or a client (`on` = `task:<id>`, `project:<id>`, `client:<id>`). Replies point at the first message (`parent`). Anyone can react (`reacts`, id `<message>.<person>.<reaction>`), mark a message as the decision, or turn it into a task. Only the author can edit or delete the words; the server keeps the author as whoever posted. Old comments that lived inside tasks were moved into messages automatically.

Where you see them: the task's **Conversation** panel, a project's **Discussion** tab (with every decision made on the project or its tasks), and **Discussion about this client** in the client drawer. **Inbox** (under My day) lists mentions, replies, decisions, assignments and approvals, with unread marks, plus **Recently deleted** (30 days) with Restore.

**Saves can't erase each other.** Each save says which version it started from and which fields changed. If someone saved in between, the server applies only your fields on top of theirs (status trails and time logs keep entries from both). Saves to the same document take turns on the server.

**History.** Every change to tasks, projects, goals, messages, events, dashboards, templates and rules is logged in `hub_activity` (who, when, which fields, before and after) for 180 days. A task's **History** panel lists the changes; **Undo** puts it back the way it was before that change. Deleting a task, project or goal shows an Undo bar.

**Live.** Open pages hold `GET /api/hub/stream` (server-sent events); any saved change tells them to sync at once. Polling continues every 30 seconds as a fallback (4 seconds if the stream can't connect).

Endpoints: `GET /api/hub/activity?path=&id=` (one document), `?deleted=1` (recently deleted), no query (latest 100); `POST /api/hub/restore {act}`; `GET /api/hub/stream`.

Team list: until there is a named owner account, the shared-password sign-in (user 0) stays on the team, so adding associates doesn't turn Franklin into a "former member".
