# Setting this system up for another organization

The system is three apps that share one organization profile:

| App | Repository | What it is |
|---|---|---|
| Operations | frankly-inspired-os | The internal operating system: Today, pipeline and money, weekly meeting, priorities, research, people and roles |
| InstitutionalOS | grantpass-backend (API + `dashboard/` pages) | Scoring, 90-day plans, client portal, funder report, leader survey |
| Website | frankly-inspired-website (+ frankly-inspired-backend for forms and counts) | The public site and free check-up |

Everything that names the organization, its brand, its links, its offers, and
which areas are switched on lives in **`org.config.json`**. Each app keeps an
identical copy: `frankly-inspired-os/org.config.json`,
`grantpass-backend/dashboard/org.config.json`,
`frankly-inspired-website/src/org.config.json`.

## Checklist (about half a day)

1. **Copy the repositories** on GitHub (use "Use this template" or fork), one set per organization.
2. **Edit `org.config.json`** in all three copies (identical):
   - `org`: type (`consulting` or `foundation`), names, leader, email, phone, region
   - `brand`: colors and fonts
   - `links`: the new addresses (website, operations, clients, booking)
   - `modules`: turn areas on or off (see below)
   - `offers`: what the organization offers, with prices and the scope lines the engagement letter prints
   - `terms`: what to call the people and records (Client, Grantee, Donor...)
   - `engagement`: payment, confidentiality, data, and ending terms for letters
3. **Create the Render services** (two web services, one static site, one static site for the website, two Postgres databases) from the copied repositories. Use the same build and start commands as the originals.
4. **Set the keys** listed in docs/SECURITY.md on each service. Generate new values; never reuse another organization's keys.
5. **First sign-in:** open the operations app, sign in with `ADMIN_PASSWORD`, go to Settings > People, add yourself as Owner, sign in with your email, turn on two-step sign-in (this also turns off the shared password).
6. **InstitutionalOS:** open the console, register the owner's email, and set `INTEGRATION_USER_EMAIL` on the InstitutionalOS API to that email.
7. **Connect email:** in Google Cloud, create an OAuth client (Google Auth Platform: fill in Branding, Audience External and published "In production", a Web application client with the redirect address shown in Settings > Connected email, and the Gmail API enabled). Paste the Client ID and secret in Settings > Connected email and connect the account messages should go out from.
8. **Scheduled tasks:** copy the tasks (morning health check, daily reminders, nightly backup and retention, checklist automation every 3 hours, weekly market scan if used), changing the addresses and keys.
9. **Run the tests** in each repository (`npm test`, `python3 tests/run_tests.py`) against an empty test database, then deploy.
10. **Custom addresses:** add the domain to each Render service and the CNAME records at the domain registrar.

## Modules

| Module | Consulting practice | Foundation |
|---|---|---|
| `consulting` (offers, engagement letters) | on | off |
| `institutionalos` (scores, 90-day plans, portal) | on: clients | on: grantees (capacity building) |
| `marketScan` (DMV nonprofit research) | on | on: finding grantees |
| `donorAnalysis` (LYBUNT/SYBUNT, retention) | optional | on: the foundation's own donors |
| `givingLandscape`, `fieldIntelligence` | on | on |
| `myDesk` (owner's personal development) | on | per person |
| `grantmaking` (programs, applications, reviews, awards, payments, reports) | optional | on |
| `fundraising` (donors, gifts, pledges, campaigns, thank-you letters) | optional | on |
| `governance` (board roster, meetings and minutes, conflict-of-interest statements, Form 990 checklist, policies) | optional | on |

Areas can also be switched on or off in **Settings > Areas** without editing the file.

## For the First Choice Construction foundation (grants and fundraising)

What already maps over:
- **Grantees** are InstitutionalOS organizations: intake, evidence-based scores,
  a 90-day plan, a portal, and a funder report the foundation reads.
- **The foundation's donors and gifts** fit the pipeline (prospect to gift) and
  Donor Analysis; Money tracks pledges and receipts the way it tracks invoices.
- **Board** members get Board accounts (view only) in the operations app; the
  monthly report is the board pack.
- **Priorities & Vision** and the Weekly Meeting run the foundation's own work.

Built and ready (Grants and Fundraising in the left menu, under Foundation):
- **Grants**: programs with a budget, dates, scoring criteria, and extra
  questions; a public application form at `/apply/<program>` (or enter
  applications by hand); each reviewer scores 1 to 5 per criterion and can
  declare a conflict of interest; approve with an amount, period, payment
  schedule, and interim/final reports; award and decline letters with standard
  conditions (`grantmaking.conditions` in the profile); budget, committed,
  paid, and what's due on the Overview.
- **Fundraising**: donors (with stage, possible ask, and relationship owner),
  gifts with receipt numbers, pledges paid in installments, campaigns and funds
  with goals, conversations and next steps, thank-you letters with IRS receipt
  wording (set `fundraising.ein` once the foundation has its 501(c)(3)
  determination), year-over-year totals, donor retention, "gave last year, not
  yet this year," CSV import from a spreadsheet and CSV export.
- Set `fundraising.fiscalYearStartMonth` if the foundation's year isn't
  January to December.
- First Choice Construction's own gifts to the foundation: record the company
  as a donor (type Company) and use a campaign such as "Corporate match" so they
  are tracked separately from community gifts.
- **Board & Governance**: the board roster with roles and terms; a year of
  meetings planned in one step, each with an agenda, attendance and quorum
  (a majority of voting members unless `governance.quorum` says otherwise),
  conflicts declared, minutes, motions and votes, and printable agenda and
  minutes; calendar files for every meeting; yearly conflict-of-interest
  statements that each member signs from a private link (no account needed);
  a Form 990 checklist with due dates from the fiscal year (the 990 is due the
  15th day of the fifth month after year-end); and a policy register with
  review dates. Set the foundation's own conflict-of-interest wording in
  `governance.coiStatement` once the board adopts its policy.

Still to build: nothing in this list. Accounts-dependent items (e-signature,
online payments, accounting sync) are tracked separately.
