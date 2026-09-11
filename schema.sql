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
