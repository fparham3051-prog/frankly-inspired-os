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
