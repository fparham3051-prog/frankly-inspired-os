CREATE TABLE IF NOT EXISTS pipeline (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  org TEXT DEFAULT '',
  source TEXT DEFAULT '',
  track TEXT DEFAULT 'undecided',
  stage TEXT DEFAULT 'lead',
  next_step TEXT DEFAULT '',
  next_step_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS scorecard (
  id TEXT PRIMARY KEY,
  week_of TEXT,
  calls INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  active INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  referrals INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS rocks (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '',
  quarter TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'on-track',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  org TEXT DEFAULT '',
  source TEXT DEFAULT 'linkedin',
  status TEXT DEFAULT 'new',
  link TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT
);

-- source_ref: a stable id (e.g. a Gmail message id) automated lead capture uses to
-- avoid creating duplicate prospects when it re-scans the same emails.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS source_ref TEXT UNIQUE;

-- archived_at: soft-delete marker. "Remove" in the UI sets this instead of
-- actually deleting the row, so a misclick or a bad bulk import is always
-- recoverable, it just stops showing up in /api/state. Applied to every
-- table the UI (or the lead-import automation) can delete from.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE rocks ADD COLUMN IF NOT EXISTS archived_at TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS archived_at TEXT;

-- archived_reason: which of the two things that set archived_at on a
-- prospect actually happened - 'promoted' when POST
-- /api/prospects/:id/promote turned it into a pipeline record, '' (the
-- default) for an ordinary manual Remove. Without this, archived_at alone
-- can't tell a real promotion from a plain deletion, and the Forecasting
-- view's prospect-velocity trend (time from logged to promoted) needs that
-- distinction to stay honest.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS archived_reason TEXT DEFAULT '';

-- deal_value: the dollar value of an engagement once it's real - a signed
-- coaching retainer, a consulting project fee, an InstitutionalOS
-- Assessment fee. Optional and 0 by default, like the gift case-study
-- fields below: nothing here is estimated on Franklin's behalf, it only
-- feeds the Forecasting view's deal-size trend once he fills it in for a
-- Graduated record.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS deal_value NUMERIC DEFAULT 0;

CREATE TABLE IF NOT EXISTS digest (
  id TEXT PRIMARY KEY,
  category TEXT,
  headline TEXT,
  summary TEXT,
  source TEXT,
  url TEXT,
  logged_at TEXT
);

CREATE TABLE IF NOT EXISTS vision (
  id TEXT PRIMARY KEY DEFAULT 'main',
  values_text TEXT DEFAULT '',
  focus TEXT DEFAULT '',
  ten_year TEXT DEFAULT '',
  marketing TEXT DEFAULT '',
  three_year TEXT DEFAULT '',
  one_year TEXT DEFAULT '',
  updated_at TEXT
);

-- gifts: the weekly "major named gift" ticker behind the Giving Landscape view.
-- This is NOT a national statistic, it is Frankly Inspired's own log of publicly
-- announced major gifts (added by hand, or upserted by the weekly Field
-- Intelligence research pass the same way the digest table is). state and
-- category use fixed short keys the frontend maps to labels, matching the
-- Giving USA recipient-subsector categories so the practice's own tracking
-- lines up with the national reference chart next to it.
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  donor TEXT DEFAULT '',
  org TEXT DEFAULT '',
  state TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  amount NUMERIC DEFAULT 0,
  headline TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  source TEXT DEFAULT '',
  url TEXT DEFAULT '',
  announced_at TEXT,
  logged_at TEXT,
  archived_at TEXT
);

-- Case-study fields: turns a ticker row into something usable in an actual
-- client conversation, not just a logged fact. All optional/blank by default
-- since the manual "log a gift" form doesn't require them - the weekly
-- research pass is what reliably fills these in, since it's already reading
-- the source article closely enough to answer them.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS gift_type TEXT DEFAULT '';
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS restriction TEXT DEFAULT '';
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS impact TEXT DEFAULT '';
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS trend_signal TEXT DEFAULT '';
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS playbook TEXT DEFAULT '';

-- public_ok: opt-in flag for the unauthenticated public Giving Landscape page
-- (GET /api/public/giving-landscape and /giving-landscape in server.js).
-- Defaults to false on purpose - a gift the weekly Field Intelligence pass
-- logs, or one added by hand, never becomes visible on that page until
-- Franklin reviews that specific row and turns it on. The public endpoint
-- only ever selects the gift-fact columns (donor/org/state/category/amount/
-- headline/summary/source/url/announced_at) - it never selects gift_type,
-- restriction, impact, trend_signal, or playbook, so a row being public
-- never exposes Frankly Inspired's own case-study analysis of it, only the
-- same fact of the gift that was already publicly announced.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS public_ok BOOLEAN DEFAULT false;

-- higher_ed: an independent yes/no tag, layered on top of the Giving USA
-- "education" category rather than splitting it into a new category key.
-- Giving USA's own published education figure (and the year-by-year history
-- in NATIONAL_CATEGORY_GIVING_BY_YEAR on the frontend) covers K-12, higher
-- ed, and libraries together with no public higher-ed-only breakdown to
-- benchmark against, so inventing a "higher-education" category key would
-- silently break the national comparison bars for every category value this
-- app has ever logged. This column instead lets a gift to a college or
-- university be flagged and filtered for on its own, without touching the
-- category taxonomy the national reference chart depends on.
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS higher_ed BOOLEAN DEFAULT false;

-- Organizational 990 health: a gift's org is free text, so it's never
-- auto-linked to a specific EIN by name alone (too many similarly-named
-- nonprofits). org_ein_links is the one confirmed match per org name,
-- picked once in the Organization Growth Tracker's "look up financial
-- health" flow. org_financials caches the fetched ProPublica Nonprofit
-- Explorer filing data per EIN (data stored as a JSON string, matching this
-- schema's plain-TEXT convention rather than introducing jsonb) so the
-- tracker isn't re-fetching on every page load.
CREATE TABLE IF NOT EXISTS org_ein_links (
  org_name TEXT PRIMARY KEY,
  ein TEXT NOT NULL,
  matched_name TEXT DEFAULT '',
  matched_city TEXT DEFAULT '',
  matched_state TEXT DEFAULT '',
  linked_at TEXT
);

CREATE TABLE IF NOT EXISTS org_financials (
  ein TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at TEXT
);
-- automation_runs: an append-only log of what each scheduled job reported
-- about its own last run (status, a short message, how many items it
-- wrote), written by the job itself in the closing step of its prompt via
-- POST /api/admin/automation-runs. Backs the Automation Health panel on
-- the Dashboard: GET /api/automation-status reads the latest row per
-- job_key and compares it against each job's expected cadence, so a job
-- that silently stopped firing (not just one that failed loudly) is
-- visible too. job_key is a short fixed slug per automation (see
-- JOB_REGISTRY in server.js), not a foreign key to anything else here.
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL,
  job_label TEXT DEFAULT '',
  status TEXT DEFAULT '',
  message TEXT DEFAULT '',
  item_count INTEGER,
  ran_at TEXT,
  logged_at TEXT
);

-- ---------- Finance and Delivery: the two gaps the September 2026 ----------
-- architecture audit named, closed the way the Command Center concept memo
-- specced: each new table is a child of the same spine (pipeline_id), never
-- a parallel system with its own client list. A client only ever gets
-- invoices, modules, or time entries once a real Pipeline row exists for
-- them - promote a prospect (or add one directly) before logging any of
-- these three.

-- invoices: real revenue tracking. offering matches the four things Frankly
-- Inspired actually sells (see OFFERING_LABELS in app.js): InstitutionalOS
-- Diagnostic, Advisory and Implementation Retainer, Project Based
-- Engagement, 1:1 Executive Coaching. status is only ever draft, sent, or
-- paid - deliberately no stored "overdue" status, since that would need
-- something to keep it in sync every day it stays unpaid. Overdue is
-- computed client-side instead (status='sent' and due_date has passed),
-- the same derived-not-stored pattern isOverduePipeline() already uses for
-- Pipeline next-step dates.
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipeline(id),
  offering TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  issued_date TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  paid_date TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);

-- engagement_modules: delivery tracking for the five-pillar curriculum
-- (Governing Foundation, Build Before the Ask, Fundraising Fluency, Zero to
-- Portfolio, Funding Pathway Finder - document 9's Runbook and document
-- 11's Workbook, made structural). module_name is free text with those
-- five offered as quick-fill suggestions in the UI, not a fixed enum -
-- a Project Based Engagement's scope won't always match the five pillars
-- exactly, and this table shouldn't block on that.
CREATE TABLE IF NOT EXISTS engagement_modules (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipeline(id),
  module_name TEXT DEFAULT '',
  status TEXT DEFAULT 'not-started',
  session_date TEXT DEFAULT '',
  deliverable_link TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);

-- time_entries: a manual log, not a stopwatch - matching how the rest of
-- FIOS works (everything entered directly on the page).
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipeline(id),
  entry_date TEXT DEFAULT '',
  minutes INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);

-- revenue_booked / revenue_collected: the two new Scorecard measurables the
-- concept memo calls for, so money shows up in the same weekly rhythm calls
-- made and new leads already do. Both optional, 0 by default, same
-- convention as deal_value above - nothing here is estimated on Franklin's
-- behalf, it only reflects what he logs.
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS revenue_booked NUMERIC DEFAULT 0;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS revenue_collected NUMERIC DEFAULT 0;

-- ---------- Encounters: a dated contact report for every real touch an ----------
-- engagement has with its actual point of contact, built on a peer's
-- recommendation. Same spine pattern as invoices, engagement_modules, and
-- time_entries: every encounter belongs to a real Pipeline row. Unlike
-- those three, an encounter can also *create* that Pipeline row on the
-- spot (see POST /api/encounters) for a first-ever touch that hasn't been
-- added to Pipeline yet, so logging a new contact never has to wait on a
-- separate step first.
--
-- interaction_type (how contact happened: call, meeting, email, letter,
-- event, social, other) and relationship_stage (where it left the
-- relationship: identification, cultivation, solicitation, stewardship)
-- are two independent fields on purpose, not one merged "category" - the
-- same distinction Field Intelligence's own gift categories keep separate
-- from a gift's restriction type. next_step is free text with suggestions
-- offered client-side by relationship_stage, the same quick-fill-not-enum
-- pattern as engagement_modules.module_name. summary is where the
-- conversation itself gets paraphrased, in the fundraiser's own words.
CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipeline(id),
  contact_name TEXT DEFAULT '',
  occurred_at TEXT DEFAULT '',
  interaction_type TEXT DEFAULT 'call',
  relationship_stage TEXT DEFAULT 'identification',
  reason TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  next_step_date TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  logged_by TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_encounters_pipeline_id ON encounters(pipeline_id);

-- ---------- The President's Desk: ported from the standalone Claude Artifact ----------
-- (claude.ai/artifact/2eettWspqNgnW7BvmduzYJ, then called "Advancement Desk") into a
-- native FIOS feature, September 2026; renamed October 2026. Nearly everything it
-- shows (glossary, domain notes, quiz bank, field notes, people, jobs, org intel,
-- gift playbook, doctoral prep, policy & leadership) is static reference content
-- that ships in app.js, the same way FIOS's own reference views work - not a table.
-- Only the handful of things a person actually checks off or completes need to live
-- here, replacing what the old artifact tracked in localStorage on that one browser.

-- advancement_state: a single JSON-blob row (same convention as org_financials.data
-- above) holding the two small toggle sets the artifact used to keep client-side:
-- which This Week events are marked registered, and which certifications are marked
-- "pursuing." Both are small and personal, with no natural per-item table of their
-- own, so one blob beats two near-empty tables.
CREATE TABLE IF NOT EXISTS advancement_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  week_progress TEXT DEFAULT '{}',
  cred_pursuing TEXT DEFAULT '{}',
  updated_at TEXT
);

-- quiz_attempts: every completed Practice Test run, replacing the artifact's
-- localStorage "last attempt only" cache with real history - the exact gap the
-- September 2026 Command Center concept memo flagged (no quiz-attempt history, no
-- trend). domain_breakdown is a JSON string (this schema's usual convention for a
-- nested shape) mapping each tested domain to {right, total} for that attempt.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  exam_key TEXT NOT NULL,
  exam_label TEXT DEFAULT '',
  score INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  domain_breakdown TEXT DEFAULT '{}',
  taken_at TEXT,
  created_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_exam_key ON quiz_attempts(exam_key);

-- week_events: the President's Desk "This Week" panel's calendar holds -
-- replaces the September-migration hardcoded WEEK_EVENTS array that used
-- to live in app.js. Populated by the "Weekly calendar prep briefing"
-- scheduled task, which already pulls Franklin's real Google Calendar for
-- the week ahead - this is that same pull, upserted here so the panel
-- shows it too instead of only that run's own chat reply. Nothing here is
-- ever manually deleted: the frontend only renders rows whose starts_at
-- falls in the week ahead (the same derived-not-stored pattern invoices
-- uses for "overdue"), so a past event just drops out of view on its own;
-- the admin endpoint prunes anything more than 21 days past so the table
-- itself doesn't grow forever.
CREATE TABLE IF NOT EXISTS week_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT DEFAULT '',
  location TEXT DEFAULT '',
  url TEXT DEFAULT '',
  status TEXT DEFAULT 'neutral',
  status_label TEXT DEFAULT '',
  cta TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

-- gift_pattern_digests: a single JSON-ish blob row (same convention as
-- advancement_state) holding the standing "Gift Patterns & Portfolio
-- Implications" synthesis in the Field Intelligence tab, right below the
-- weekly news digest. Replaced in full every week by the Weekly Gift
-- Patterns synthesis scheduled task - this is one standing record, not a
-- growing log, matching how that automation's own prompt already
-- describes it (it was writing to this panel for weeks before the panel,
-- or this table, actually existed server-side - every run 404'd).
CREATE TABLE IF NOT EXISTS gift_pattern_digests (
  id TEXT PRIMARY KEY DEFAULT 'main'
);
-- Defensive ADD COLUMN IF NOT EXISTS rather than folding these into the
-- CREATE TABLE above: a gift_pattern_digests table already existed in this
-- live database from an earlier, never-finished attempt at this same
-- feature, with a different/incomplete column set - CREATE TABLE IF NOT
-- EXISTS silently no-ops against an existing table, so the first deploy of
-- this feature crashed the whole server on boot with "column updated_at
-- does not exist". Each ADD COLUMN below is safe to run every boot
-- whether the column is already there or not.
ALTER TABLE gift_pattern_digests ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
ALTER TABLE gift_pattern_digests ADD COLUMN IF NOT EXISTS window_label TEXT DEFAULT '';
ALTER TABLE gift_pattern_digests ADD COLUMN IF NOT EXISTS gift_count INTEGER DEFAULT 0;
ALTER TABLE gift_pattern_digests ADD COLUMN IF NOT EXISTS updated_at TEXT;

-- ---------- Offer alignment with franklyinspired.associates (Nov 2026) ----------
-- interest: which offer a website lead asked about, using the same keys as
-- invoices.offering (institutionalos-diagnostic, retainer, project,
-- coaching, speaking). org_stage: the lifecycle stage the visitor picked in
-- a free tool (build, fund, sustain). Promoting a prospect copies these
-- onto the pipeline row as its track and diagnostic_stage, so a lead never
-- has to be re-classified by hand. diagnostic_stage also sets the default
-- Diagnostic invoice amount (Build $2,000; Fund and Sustain $2,500).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS interest TEXT DEFAULT '';
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS org_stage TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS diagnostic_stage TEXT DEFAULT '';

-- trigger_key: the situation a website visitor picked ("What's happening
-- right now?" on every free tool): expansion, funder, founder, strain,
-- transition, checkup.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS trigger_key TEXT DEFAULT '';

-- Problem log: one row per market interview, discovery call, or Diagnostic.
-- It is where the practice's "problem rate" comes from: how often each
-- trigger shows up, and how often the verified constraint differs from
-- the problem leadership first named (the hidden-problem rate).
CREATE TABLE IF NOT EXISTS problem_log (
  id TEXT PRIMARY KEY,
  logged_on TEXT,
  kind TEXT DEFAULT 'interview',
  organization TEXT DEFAULT '',
  org_type TEXT DEFAULT '',
  org_size TEXT DEFAULT '',
  trigger_key TEXT DEFAULT '',
  presenting_problem TEXT DEFAULT '',
  verified_constraint TEXT DEFAULT '',
  differs BOOLEAN,
  at_stake TEXT DEFAULT '',
  who_pays TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);

-- Self-assessment by dimension (JSON {strategy: 62, ...}) from the free tool
-- or scorecard a lead came through; carried onto the deal and on to the
-- InstitutionalOS client, where it is shown beside the verified scores.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS self_scores TEXT DEFAULT '';

-- The deal's link to its InstitutionalOS client. Created automatically when
-- the deal reaches the Diagnostic stage ("assessment"); kept current by
-- InstitutionalOS pushing results back to /api/admin/ios-sync.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS trigger_key TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS self_scores TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_org_id INTEGER;
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_portal_url TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_overall NUMERIC;
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_decision TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_constraint TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_next_session TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_record TEXT DEFAULT '';
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_synced_at TEXT;
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_link_error TEXT DEFAULT '';

-- A Problem Log row written by InstitutionalOS carries source_ref
-- 'ios:<org id>', so each Diagnostic has exactly one entry and the
-- hidden-problem rate comes from one place.
ALTER TABLE problem_log ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS problem_log_source_ref ON problem_log (source_ref);

-- Client feedback from the website's /feedback form, with the publishing
-- permission the client chose (named, anonymous, private).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  source_ref TEXT UNIQUE,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  role TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  rating INTEGER,
  result TEXT DEFAULT '',
  quote TEXT DEFAULT '',
  permission TEXT DEFAULT 'private',
  status TEXT DEFAULT 'new',
  created_at TEXT,
  archived_at TEXT
);

-- The InstitutionalOS 90-Day Improvement Plan status for a linked deal (JSON,
-- pushed by InstitutionalOS): target, actions done/blocked/overdue, last
-- check-in, 90-day review and reassessment dates, and the one next action.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS ios_plan TEXT DEFAULT '';

-- DMV market scan (marketScan.js): public charities in the DC, Maryland and
-- Northern Virginia market from the IRS Business Master File, with signals
-- from their e-filed 990s (ProPublica). Internal research only.
CREATE TABLE IF NOT EXISTS market_orgs (
  ein TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  area TEXT DEFAULT '',
  ntee TEXT DEFAULT '',
  bmf_revenue NUMERIC,
  bmf_assets NUMERIC,
  ruling TEXT DEFAULT '',
  tax_period TEXT DEFAULT '',
  roster_seen_at TEXT,
  enriched_at TEXT,
  enrich_error TEXT DEFAULT '',
  signals TEXT,
  public_score NUMERIC,
  growth_flag TEXT DEFAULT '',
  situation TEXT DEFAULT '',
  fit INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  notes TEXT DEFAULT '',
  prospect_id TEXT,
  ios_org_id INTEGER,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS market_orgs_fit ON market_orgs (fit DESC, bmf_revenue DESC);
CREATE TABLE IF NOT EXISTS market_scan_state (
  id TEXT PRIMARY KEY,
  data TEXT
);

-- A deal that started in the market scan keeps its EIN, so linking it to
-- InstitutionalOS adopts the demo client made from public data.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS scan_ein TEXT DEFAULT '';

-- People who can sign in, with a role (owner, staff, board) and optional
-- two-step sign-in. See accounts.js.
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  pass_hash TEXT NOT NULL,
  totp_secret TEXT DEFAULT '',
  totp_on BOOLEAN DEFAULT false,
  disabled BOOLEAN DEFAULT false,
  created_at TEXT,
  last_login_at TEXT
);

-- Small owner settings (shared password on/off, data-retention run log).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- =====================================================================
-- Foundation areas (foundation.js). Switched on per organization in
-- org.config.json "modules" (grantmaking, fundraising) or in Settings.
-- Dates are YYYY-MM-DD text like the rest of this schema; money is NUMERIC.
-- =====================================================================

-- Grantmaking: programs -> applications -> reviews -> award (payments, reports).
CREATE TABLE IF NOT EXISTS gm_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  purpose TEXT DEFAULT '',
  eligibility TEXT DEFAULT '',
  budget NUMERIC DEFAULT 0,
  max_award NUMERIC DEFAULT 0,
  opens_on TEXT DEFAULT '',
  closes_on TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',          -- draft | open | closed
  accepts_online BOOLEAN DEFAULT false, -- public form at /apply/<slug>
  criteria TEXT DEFAULT '[]',           -- JSON [{key,label}], each scored 1-5
  questions TEXT DEFAULT '[]',          -- JSON [{key,label}] asked on the form
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS gm_applications (
  id TEXT PRIMARY KEY,
  program_id TEXT REFERENCES gm_programs(id),
  org_name TEXT NOT NULL,
  ein TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  annual_budget NUMERIC DEFAULT 0,
  project_title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  amount_requested NUMERIC DEFAULT 0,
  answers TEXT DEFAULT '{}',             -- JSON {questionKey: text}
  status TEXT DEFAULT 'received',        -- received | screening | in-review | approved | declined | withdrawn
  source TEXT DEFAULT 'staff',           -- staff | online
  decision_notes TEXT DEFAULT '',
  decided_at TEXT DEFAULT '',
  amount_awarded NUMERIC DEFAULT 0,
  award_start TEXT DEFAULT '',
  award_end TEXT DEFAULT '',
  agreement_signed_on TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS gm_applications_program ON gm_applications (program_id);
CREATE TABLE IF NOT EXISTS gm_reviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES gm_applications(id),
  reviewer TEXT NOT NULL,
  scores TEXT DEFAULT '{}',              -- JSON {criterionKey: 1-5}
  recommendation TEXT DEFAULT '',        -- fund | fund-with-changes | decline
  comment TEXT DEFAULT '',
  conflict BOOLEAN DEFAULT false,        -- reviewer declared a conflict of interest
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (application_id, reviewer)
);
CREATE TABLE IF NOT EXISTS gm_payments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES gm_applications(id),
  due_on TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  paid_on TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  condition TEXT DEFAULT '',             -- e.g. "after interim report"
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS gm_reports (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES gm_applications(id),
  kind TEXT DEFAULT 'final',             -- interim | final | other
  due_on TEXT DEFAULT '',
  received_on TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  created_at TEXT
);

-- Fundraising: donors, campaigns (funds), pledges, gifts, and touches.
CREATE TABLE IF NOT EXISTS fr_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal NUMERIC DEFAULT 0,
  fund_type TEXT DEFAULT 'unrestricted', -- unrestricted | restricted | capital | endowment | event
  starts_on TEXT DEFAULT '',
  ends_on TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS fr_donors (
  id TEXT PRIMARY KEY,
  kind TEXT DEFAULT 'individual',        -- individual | family | foundation | corporation | government | daf | other
  name TEXT NOT NULL,
  salutation TEXT DEFAULT '',            -- "Dear Ms. Lee"
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  owner TEXT DEFAULT '',                 -- who manages the relationship
  stage TEXT DEFAULT '',                 -- identify | qualify | cultivate | solicit | steward
  capacity NUMERIC DEFAULT 0,            -- estimated ask amount
  notes TEXT DEFAULT '',
  no_solicit BOOLEAN DEFAULT false,
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS fr_donors_email ON fr_donors (lower(email));
CREATE TABLE IF NOT EXISTS fr_pledges (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES fr_donors(id),
  campaign_id TEXT REFERENCES fr_campaigns(id),
  total NUMERIC DEFAULT 0,
  pledged_on TEXT DEFAULT '',
  frequency TEXT DEFAULT 'one-time',     -- one-time | monthly | quarterly | annual
  installments INTEGER DEFAULT 1,
  first_due TEXT DEFAULT '',
  status TEXT DEFAULT 'open',            -- open | fulfilled | written-off
  notes TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);
CREATE SEQUENCE IF NOT EXISTS fr_receipt_seq START 1001;
CREATE TABLE IF NOT EXISTS fr_gifts (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES fr_donors(id),
  campaign_id TEXT REFERENCES fr_campaigns(id),
  pledge_id TEXT REFERENCES fr_pledges(id),
  amount NUMERIC NOT NULL DEFAULT 0,
  received_on TEXT DEFAULT '',
  method TEXT DEFAULT 'check',           -- check | cash | card | ach | wire | stock | daf | in-kind | other
  reference TEXT DEFAULT '',             -- check number, transaction id
  restriction TEXT DEFAULT '',
  in_kind_description TEXT DEFAULT '',
  goods_services_value NUMERIC DEFAULT 0,
  receipt_no INTEGER UNIQUE DEFAULT nextval('fr_receipt_seq'),
  ack_sent_on TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS fr_gifts_donor ON fr_gifts (donor_id);
CREATE TABLE IF NOT EXISTS fr_touches (
  id TEXT PRIMARY KEY,
  donor_id TEXT NOT NULL REFERENCES fr_donors(id),
  on_date TEXT DEFAULT '',
  kind TEXT DEFAULT 'note',              -- meeting | call | email | event | ask | note
  summary TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  next_on TEXT DEFAULT '',
  done BOOLEAN DEFAULT false,
  created_at TEXT
);

-- =====================================================================
-- Governance (governance.js): board roster, meetings with agendas, attendance,
-- motions and minutes; yearly conflict-of-interest statements; the Form 990
-- checklist; and the board policy register. Module key: governance.
-- =====================================================================
CREATE TABLE IF NOT EXISTS gov_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  role TEXT DEFAULT 'member',            -- chair | vice-chair | treasurer | secretary | member | staff
  voting BOOLEAN DEFAULT true,
  committees TEXT DEFAULT '',
  term_start TEXT DEFAULT '',
  term_end TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS gov_meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'regular',           -- regular | annual | special | committee
  starts_at TEXT DEFAULT '',             -- YYYY-MM-DDTHH:MM, local time
  duration_min INTEGER DEFAULT 90,
  location TEXT DEFAULT '',
  agenda TEXT DEFAULT '',                -- one item per line
  status TEXT DEFAULT 'scheduled',       -- scheduled | held | cancelled
  attendance TEXT DEFAULT '{}',          -- JSON {memberId: present | absent | excused}
  guests TEXT DEFAULT '',
  conflicts_declared TEXT DEFAULT '',
  minutes TEXT DEFAULT '',
  minutes_approved_on TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS gov_motions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES gov_meetings(id),
  motion TEXT NOT NULL,
  moved_by TEXT DEFAULT '',
  seconded_by TEXT DEFAULT '',
  result TEXT DEFAULT 'passed',          -- passed | failed | tabled
  yes_votes INTEGER DEFAULT 0,
  no_votes INTEGER DEFAULT 0,
  abstain_votes INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS gov_coi (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES gov_members(id),
  year INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,            -- private link the member signs from
  sent_on TEXT DEFAULT '',
  signed_on TEXT DEFAULT '',
  signed_name TEXT DEFAULT '',
  no_conflicts BOOLEAN DEFAULT false,
  disclosures TEXT DEFAULT '',
  created_at TEXT,
  UNIQUE (member_id, year)
);
CREATE TABLE IF NOT EXISTS gov_checklist (
  id TEXT PRIMARY KEY,
  fiscal_year TEXT NOT NULL,             -- label, e.g. "2026" or "FY27"
  item_key TEXT DEFAULT '',
  label TEXT NOT NULL,
  detail TEXT DEFAULT '',
  due_on TEXT DEFAULT '',
  done_on TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS gov_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adopted_on TEXT DEFAULT '',
  last_reviewed TEXT DEFAULT '',
  review_every_months INTEGER DEFAULT 24,
  link TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);

-- =====================================================================
-- Process library (processes.js). "How we work": processes as checklists,
-- each with an owner, when it's used, and a review date; "runs" are one use
-- of a checklist for a client, grant, meeting, or month. "What we deliver":
-- client materials, internal or client-safe.
-- =====================================================================
CREATE TABLE IF NOT EXISTS proc_processes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT DEFAULT 'consulting',        -- consulting | institutionalos | grants | fundraising | board | operations
  purpose TEXT DEFAULT '',
  used_when TEXT DEFAULT '',             -- plain words: when this process starts
  owner TEXT DEFAULT '',
  steps TEXT DEFAULT '[]',               -- JSON [{text, days}] days = due this many days after starting ("" = no date)
  doc_link TEXT DEFAULT '',
  suggest_on TEXT DEFAULT '',            -- pipeline:lead | pipeline:assessment | pipeline:engaged | pipeline:graduated | grant:approved | meeting:upcoming | member:new | month:end | year:end
  review_every_months INTEGER DEFAULT 12,
  last_reviewed TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS proc_runs (
  id TEXT PRIMARY KEY,
  process_id TEXT REFERENCES proc_processes(id),
  process_name TEXT DEFAULT '',
  subject_kind TEXT DEFAULT 'other',     -- pipeline | grant | meeting | member | month | year | other
  subject_id TEXT DEFAULT '',
  subject_label TEXT DEFAULT '',
  started_on TEXT DEFAULT '',
  steps TEXT DEFAULT '[]',               -- JSON [{text, dueOn, doneOn, by}]
  completed_on TEXT DEFAULT '',
  skipped BOOLEAN DEFAULT false,         -- "not needed" for a suggestion
  owner TEXT DEFAULT '',
  created_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS proc_runs_subject ON proc_runs (process_id, subject_kind, subject_id);
CREATE TABLE IF NOT EXISTS lib_materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'curriculum',        -- curriculum | workbook | playbook | strategy | template | policy | other
  audience TEXT DEFAULT 'internal',      -- internal | client-safe
  area TEXT DEFAULT 'consulting',
  link TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);
