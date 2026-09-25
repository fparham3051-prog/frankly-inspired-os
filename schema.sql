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

-- coaching_sessions: the one real logging gap the September 2026 series sync
-- named (document 16) - 1:1 Executive Coaching, the fourth and newest of the
-- practice's four real offerings, had no record anywhere in FIOS. A session
-- is ad hoc, not a fixed five-module sequence (document 19 gives it a topic
-- menu instead of a curriculum), so this stays a flat log per engagement
-- rather than being forced into the engagement_modules shape. Same spine as
-- everything else: a child of pipeline_id, never a parallel client list.
CREATE TABLE IF NOT EXISTS coaching_sessions (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipeline(id),
  session_date TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT
);

-- delivery_public_ok: opt-in flag for the unauthenticated public Delivery
-- status page (GET /api/public/delivery-status/:id and /delivery-status/:id
-- in server.js), same pattern as gifts.public_ok. Defaults to false on
-- purpose - an engagement never becomes visible on that page until Franklin
-- explicitly turns it on for that one Pipeline record from the Delivery tab.
-- The public route only ever selects the engagement's name/org and each
-- logged module's name and status - it never selects module notes,
-- deliverable links, session dates, time entries, invoices, or coaching
-- sessions, so turning this on for one engagement never exposes anything
-- beyond bare progress for that one client.
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS delivery_public_ok BOOLEAN DEFAULT false;

-- gift_pattern_digests: the weekly cross-gift synthesis that sits above the
-- Weekly Gift Ticker - not a new gift record, but a standing read of what the
-- last rolling window of tracked gifts implies together (where the money's
-- coming from, what it means for reading the next gift, and portfolio
-- implications for a client's own major-gift strategy). Same single-row
-- upsert-by-fixed-id pattern as vision (id defaults to 'main') since this is
-- always "the current reading," never a growing log the way gifts itself is -
-- each weekly run replaces it rather than adding to it. Internal only: no
-- public route ever selects from this table.
CREATE TABLE IF NOT EXISTS gift_pattern_digests (
  id TEXT PRIMARY KEY DEFAULT 'main',
  content TEXT DEFAULT '',
  window_label TEXT DEFAULT '',
  gift_count INTEGER DEFAULT 0,
  generated_at TEXT
);
