-- AoS Kampagnen-Manager · Schema für Cloudflare D1 (SQLite)
-- Im Cloudflare-Dashboard: Storage & Databases → D1 → aos-kampagne → Console → einfügen → Execute

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  pack TEXT NOT NULL DEFAULT 'rc',
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  points_limit INTEGER NOT NULL DEFAULT 1000,
  unit_limit INTEGER NOT NULL DEFAULT 350,
  slots INTEGER NOT NULL DEFAULT 4,
  allow_unique INTEGER NOT NULL DEFAULT 0,
  current_round INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'lobby',
  winner_player_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  faction TEXT,
  location_key TEXT,
  prev_location_key TEXT,
  pending_move TEXT,
  moved_round INTEGER NOT NULL DEFAULT 0,
  vault INTEGER NOT NULL DEFAULT 0,
  vault_total INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  roster_locked INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (campaign_id, slot)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id TEXT,
  player_id TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  owner_player_id TEXT,
  UNIQUE (campaign_id, key)
);

CREATE TABLE IF NOT EXISTS roster_units (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  catalog_name TEXT,
  name TEXT NOT NULL,
  faction TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  models INTEGER NOT NULL DEFAULT 1,
  reinforced INTEGER NOT NULL DEFAULT 0,
  is_hero INTEGER NOT NULL DEFAULT 0,
  is_general INTEGER NOT NULL DEFAULT 0,
  regiment_of TEXT,
  auxiliary INTEGER NOT NULL DEFAULT 0,
  path TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  renown INTEGER NOT NULL DEFAULT 0,
  battle_wounds INTEGER NOT NULL DEFAULT 0,
  drained INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pvp',
  location_a TEXT,
  location_b TEXT,
  player_a TEXT,
  player_b TEXT,
  guest_name TEXT,
  table_key TEXT,
  battleplan TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  result TEXT,
  vp_a INTEGER,
  vp_b INTEGER,
  report TEXT NOT NULL DEFAULT '{}',
  aftermath_a TEXT NOT NULL DEFAULT '{}',
  aftermath_b TEXT NOT NULL DEFAULT '{}',
  done_a INTEGER NOT NULL DEFAULT 0,
  done_b INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  round INTEGER,
  player_id TEXT,
  kind TEXT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_players_campaign ON players(campaign_id);
CREATE INDEX IF NOT EXISTS idx_units_player ON roster_units(player_id);
CREATE INDEX IF NOT EXISTS idx_units_campaign ON roster_units(campaign_id);
CREATE INDEX IF NOT EXISTS idx_locations_campaign ON locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_matches_campaign ON matches(campaign_id, round);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
