-- AoS Kampagnen-Manager · Ergänzung für bestehende Datenbanken (Sicherheit & Einstellungen)
-- Die App führt diese Schritte beim ersten Aufruf nach dem Update selbst aus.
-- Nur falls du es von Hand machen willst: Cloudflare-Dashboard → Storage & Databases → D1
-- → aos-kampagne → Console → einfügen → Execute.

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

-- Nur EINMAL ausführen (meldet „duplicate column name“, wenn die Spalte schon da ist – dann ist alles gut):
ALTER TABLE campaigns ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
