// Schnittstelle (Cloudflare Workers / Pages Functions) für den AoS Kampagnen-Manager.
// Der Browser spricht nie direkt mit der Datenbank: jede Anfrage läuft hier durch,
// prüft die Sitzung und liefert nur Daten der eigenen Kampagne.
//
// Sicherheits-Grundsätze:
//  - Niemand außerhalb einer Kampagne kann sie lesen oder ändern; Spieler ändern nur ihr eigenes Roster.
//  - Logins sind gegen Durchprobieren gesperrt (Sperre pro Platz/Name und pro IP).
//  - Der Kampagnen-Fortschritt (Bilanz, freigeschaltete Zonen/Routen, Finale, Sieger) wird ausschließlich
//    hier aus den eingetragenen Ergebnissen berechnet – der Browser kann ihn nicht setzen.
//  - Würfel und Aftermath-Buchhaltung laufen wie am Spieltisch auf Vertrauen, aber jede Änderung an
//    Währung und Vorräten steht mit dem echten Betrag im Spielverlauf.
import { PACKS, packOf, allowedTargets, encounterTable, battleplanChoices } from '../public/js/packs.js';
import { unitPoints, battleSnapshot, campaignProgress, JOB_TYPES } from '../public/js/core.js';
import { SCHEMA, TABLES } from './schema.js';

const SESSION_DAYS = 60;
const PBKDF2_ITER = 10000; // Cloudflare-Free-Tarif: knappe Rechenzeit. Den Schutz vor Durchprobieren leistet die Login-Sperre.
const MAX_BODY = 200000; // Zeichen pro Anfrage
const MAX_UNITS = 80; // Einheiten pro Roster
const MAX_STATE = 60000; // Zeichen für Aftermath-Stand / Spielbericht

// ---------- Tabellen anlegen bzw. ergänzen (einmal pro Start) ----------
const schemaReady = new WeakSet();
async function ensureSchema(env) {
  if (schemaReady.has(env.DB)) return;
  const have = new Set((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r => r.name));
  if (!TABLES.every(t => have.has(t))) await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
  // Später hinzugekommene Spalten für bestehende Datenbanken nachziehen
  try { await env.DB.prepare('SELECT options FROM campaigns LIMIT 1').first(); } catch {
    try { await env.DB.prepare("ALTER TABLE campaigns ADD COLUMN options TEXT NOT NULL DEFAULT '{}'").run(); } catch (e) {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  schemaReady.add(env.DB);
}

// ---------- Hilfsfunktionen ----------
const SEC_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...SEC_HEADERS, ...headers } });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 Zeichen: gleichmäßig verteilt
  return [...crypto.getRandomValues(new Uint8Array(6))].map(b => abc[b % abc.length]).join('');
};
const parse = (s, d = {}) => { try { const v = s ? JSON.parse(s) : d; return v && typeof v === 'object' ? v : d; } catch { return d; } };
const randInt = n => { const lim = Math.floor(0x100000000 / n) * n; let x; do { x = crypto.getRandomValues(new Uint32Array(1))[0]; } while (x >= lim); return x % n; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = typeof v === 'boolean' ? (v ? 1 : 0) : parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// Einzeiliger Text: Steuerzeichen raus, gekürzt
const str = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
// Mehrzeiliger Text (Notizen)
const text = (v, max = 1000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const isId = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const nowSec = () => Math.floor(Date.now() / 1000);
const signed = n => (n > 0 ? '+' : '−') + Math.abs(n);

async function hashSecret(secret, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function sessionCookie(token, req) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `sess=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
const clientIp = req => str(req.headers.get('cf-connecting-ip') || 'lokal', 60);

// ---------- Schutz vor Durchprobieren ----------
// rate_limits: pro Schlüssel ein Zähler im Zeitfenster. Wird die Grenze erreicht, ist der Schlüssel gesperrt;
// jede weitere Sperre dauert doppelt so lange (bis maxBlock).
function waitText(sec) { return sec >= 5400 ? `${Math.round(sec / 3600)} Stunden` : sec >= 90 ? `${Math.round(sec / 60)} Minuten` : `${Math.max(1, sec)} Sekunden`; }
async function assertNotBlocked(env, key) {
  const r = await env.DB.prepare('SELECT blocked_until FROM rate_limits WHERE key=?').bind(key).first();
  const left = r ? r.blocked_until - nowSec() : 0;
  if (left > 0) fail(429, `Zu viele Versuche. Bitte in ${waitText(left)} noch einmal probieren.`);
}
async function strike(env, key, max, windowSec, baseBlock, maxBlock = 86400) {
  const t = nowSec();
  const r = await env.DB.prepare(`INSERT INTO rate_limits (key, count, window_start, blocked_until, strikes) VALUES (?1, 1, ?2, 0, 0)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start + ?3 < ?2 THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start + ?3 < ?2 THEN ?2 ELSE rate_limits.window_start END
    RETURNING count, strikes`).bind(key, t, windowSec).first();
  if (!r || r.count < max) return 0;
  const block = Math.min(maxBlock, baseBlock * 2 ** Math.min(r.strikes, 12));
  await env.DB.prepare('UPDATE rate_limits SET blocked_until=?, strikes=strikes+1, count=0, window_start=? WHERE key=?').bind(t + block, t, key).run();
  return block;
}
const clearStrikes = (env, key) => env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind(key).run();
// Gelegentlich aufräumen: abgelaufene Sitzungen und alte Zähler
async function maybeCleanup(env) {
  if (randInt(50) !== 0) return;
  const t = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare('DELETE FROM rate_limits WHERE blocked_until < ? AND window_start < ?').bind(t, t - 2 * 86400),
  ]);
}

// ---------- Einstellungen ----------
async function getSetting(env, key, def) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return r ? r.value : def;
}
const setSetting = (env, key, value) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, String(value)).run();
const campaignOptions = c => { const o = parse(c.options); return { guest_final: !!o.guest_final }; };

// ---------- Sitzungen ----------
async function loadSession(env, req) {
  const token = getCookie(req, 'sess');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')").bind(token).first();
  return s || null;
}
async function upsertSession(env, req, patch) {
  const cur = await loadSession(env, req);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  if (cur) {
    const admin_id = patch.admin_id !== undefined ? patch.admin_id : cur.admin_id;
    const player_id = patch.player_id !== undefined ? patch.player_id : cur.player_id;
    await env.DB.prepare('UPDATE sessions SET admin_id=?, player_id=?, expires_at=? WHERE token=?').bind(admin_id, player_id, exp, cur.token).run();
    return cur.token;
  }
  const token = rid(32);
  await env.DB.prepare('INSERT INTO sessions (token, admin_id, player_id, expires_at) VALUES (?,?,?,?)')
    .bind(token, patch.admin_id || null, patch.player_id || null, exp).run();
  return token;
}

const bump = (env, cid) => env.DB.prepare('UPDATE campaigns SET version=version+1 WHERE id=?').bind(cid);
const logStmt = (env, cid, round, pid, kind, txt) =>
  env.DB.prepare('INSERT INTO events (campaign_id, round, player_id, kind, text) VALUES (?,?,?,?,?)').bind(cid, round, pid, kind, str(txt, 600));

async function getCampaign(env, cid) {
  const c = isId(cid) ? await env.DB.prepare('SELECT * FROM campaigns WHERE id=?').bind(cid).first() : null;
  if (!c) fail(404, 'Kampagne nicht gefunden');
  return c;
}

// Wer bin ich und auf welche Kampagne darf ich zugreifen?
async function ctxFor(env, req, url, needCampaign = true) {
  const s = await loadSession(env, req);
  if (!s) fail(401, 'Nicht angemeldet');
  let admin = null, player = null;
  if (s.admin_id) admin = await env.DB.prepare('SELECT id, name FROM admins WHERE id=?').bind(s.admin_id).first();
  if (s.player_id) player = await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(s.player_id).first();
  if (!admin && !player) fail(401, 'Nicht angemeldet');
  let cid = url.searchParams.get('cid');
  if (!cid && player) cid = player.campaign_id;
  if (!needCampaign) return { s, admin, player, cid };
  if (!cid) fail(400, 'Keine Kampagne gewählt');
  if (!admin && (!player || player.campaign_id !== cid)) fail(403, 'Kein Zugriff auf diese Kampagne');
  if (player && player.campaign_id !== cid) player = null; // Master schaut fremde Kampagne an
  const campaign = await getCampaign(env, cid);
  return { s, admin, player, cid, campaign };
}

// ---------- Kampagne anlegen ----------
async function createCampaign(env, body) {
  const pack = PACKS[body.pack] ? body.pack : 'rc';
  const p = packOf(pack);
  const id = rid();
  let invite = code();
  for (let i = 0; i < 5; i++) {
    const ex = await env.DB.prepare('SELECT 1 FROM campaigns WHERE invite_code=?').bind(invite).first();
    if (!ex) break; invite = code();
  }
  const name = str(body.name, 60) || p.name + ' Kampagne';
  const stmts = [env.DB.prepare('INSERT INTO campaigns (id, pack, name, invite_code, points_limit, unit_limit, slots, allow_unique, options) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, pack, name, invite, clampInt(body.points_limit, 300, 5000, 1000), clampInt(body.unit_limit, 0, 5000, pack === 'rc' ? 350 : 0),
      clampInt(body.slots, 2, 4, 4), body.allow_unique ? 1 : 0, JSON.stringify({ guest_final: !!body.guest_final }))];
  for (const n of p.nodes) {
    stmts.push(env.DB.prepare('INSERT INTO locations (id, campaign_id, key, name, zone, x, y) VALUES (?,?,?,?,?,?,?)')
      .bind(rid(), id, n.key, n.name, n.zone, n.x, n.y));
  }
  stmts.push(logStmt(env, id, 0, null, 'campaign', `Kampagne „${name}“ (${p.name}) wurde angelegt.`));
  await env.DB.batch(stmts);
  return { id, invite_code: invite, name, pack };
}

// ---------- Zustand für die Oberfläche ----------
async function stateFor(env, ctx, sinceVersion) {
  const c = ctx.campaign;
  if (sinceVersion && Number(sinceVersion) === c.version) return { unchanged: true, version: c.version };
  const [players, locs, units, matches, events] = await Promise.all([
    env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all(),
    env.DB.prepare('SELECT key, name, zone, x, y, owner_player_id FROM locations WHERE campaign_id=?').bind(c.id).all(),
    env.DB.prepare('SELECT * FROM roster_units WHERE campaign_id=? ORDER BY sort, created_at').bind(c.id).all(),
    env.DB.prepare('SELECT * FROM matches WHERE campaign_id=? ORDER BY round DESC, created_at').bind(c.id).all(),
    env.DB.prepare('SELECT * FROM events WHERE campaign_id=? ORDER BY id DESC LIMIT 300').bind(c.id).all(),
  ]);
  const meId = ctx.player ? ctx.player.id : null;
  return {
    version: c.version,
    me: { player_id: meId, admin: ctx.admin ? { id: ctx.admin.id, name: ctx.admin.name } : null },
    campaign: { id: c.id, pack: c.pack, name: c.name, invite_code: c.invite_code, points_limit: c.points_limit, unit_limit: c.unit_limit, slots: c.slots, allow_unique: !!c.allow_unique, current_round: c.current_round, phase: c.phase, winner_player_id: c.winner_player_id, options: campaignOptions(c) },
    players: players.results.map(p => ({
      id: p.id, slot: p.slot, name: p.display_name, faction: p.faction, location_key: p.location_key, prev_location_key: p.prev_location_key,
      moved: p.moved_round === c.current_round && !!p.pending_move,
      // Der gewählte Zug bleibt bis zum Aufdecken geheim – nur der Spieler selbst sieht ihn.
      pending_move: p.id === meId ? p.pending_move : null,
      vault: p.vault, vault_total: p.vault_total, wins: p.wins, draws: p.draws, losses: p.losses, roster_locked: !!p.roster_locked,
      data: parse(p.data),
    })),
    locations: locs.results,
    units: units.results.map(u => ({ ...u, data: parse(u.data) })),
    matches: matches.results.map(m => ({ ...m, report: parse(m.report), aftermath_a: parse(m.aftermath_a), aftermath_b: parse(m.aftermath_b) })),
    events: events.results,
  };
}

// ---------- Rundenlogik ----------
function generalRank(units, pid) {
  const g = units.find(u => u.player_id === pid && u.is_general);
  return g ? g.rank : 0;
}

// Deckt alle Züge auf und erzeugt die Begegnungen. Der Phasenwechsel ist atomar:
// rufen zwei Anfragen gleichzeitig auf, gewinnt genau eine – es entstehen keine doppelten Spiele.
async function resolveMoves(env, c, by) {
  const claim = await env.DB.prepare("UPDATE campaigns SET phase='resolving' WHERE id=? AND phase='move' AND current_round=?").bind(c.id, c.current_round).run();
  if (!claim.meta || !claim.meta.changes) return false;
  try {
    await buildEncounters(env, c, by);
  } catch (e) {
    await env.DB.prepare("UPDATE campaigns SET phase='move' WHERE id=? AND phase='resolving'").bind(c.id).run();
    throw e;
  }
  return true;
}

async function buildEncounters(env, c, by) {
  const p = packOf(c.pack);
  const opts = campaignOptions(c);
  const players = (await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all()).results;
  const units = (await env.DB.prepare('SELECT player_id, is_general, rank FROM roster_units WHERE campaign_id=?').bind(c.id).all()).results;
  const nodeByKey = Object.fromEntries(p.nodes.map(n => [n.key, n]));
  const stmts = [];
  // Neue Positionen festlegen
  const pos = {};
  for (const pl of players) {
    let target = (pl.moved_round === c.current_round && pl.pending_move) ? pl.pending_move : pl.location_key;
    if (target && !nodeByKey[target]) target = pl.location_key && nodeByKey[pl.location_key] ? pl.location_key : null;
    pos[pl.id] = target;
    stmts.push(env.DB.prepare('UPDATE players SET prev_location_key=location_key, location_key=?, pending_move=NULL WHERE id=?').bind(target, pl.id));
    const nm = target ? nodeByKey[target].name : 'Lager';
    stmts.push(logStmt(env, c.id, c.current_round, pl.id, 'move', `${pl.display_name} zieht nach ${nm}.`));
  }
  // Gruppen nach Feld
  const groups = {};
  for (const pl of players) { const k = pos[pl.id] || '_camp_' + pl.id; (groups[k] = groups[k] || []).push(pl); }
  const solo = [];
  const matches = [];
  for (const list of Object.values(groups)) {
    shuffle(list);
    while (list.length >= 2) {
      const a = list.shift(), b = list.shift();
      matches.push({ kind: 'pvp', a, b, la: pos[a.id], lb: pos[b.id] });
    }
    if (list.length) solo.push(list[0]);
  }
  shuffle(solo);
  while (solo.length >= 2) { const a = solo.shift(), b = solo.shift(); matches.push({ kind: 'pair', a, b, la: pos[a.id], lb: pos[b.id] }); }
  if (solo.length) { const a = solo.shift(); matches.push({ kind: 'guest', a, b: null, la: pos[a.id], lb: null }); }

  for (const m of matches) {
    let table = null, bp = null;
    if (p.id === 'rc') {
      const za = m.la ? nodeByKey[m.la].zone : 'outskirts';
      const zb = m.lb ? nodeByKey[m.lb].zone : za;
      table = encounterTable(m.kind, za, zb, opts.guest_final);
      if (table === 'claw') bp = p.finalBattleplan;
    } else {
      table = 'bw';
      const common = battleplanChoices('bw', { player_b: m.b ? m.b.id : null }, parse(m.a.data), m.b ? parse(m.b.data) : null, opts);
      let pick = null;
      if (m.kind === 'pvp' || m.kind === 'guest') pick = m.la;
      else {
        // Der Spieler mit dem niedrigeren General-Rang wählt: sein Feld hat Vorrang (in der App noch änderbar)
        const ra = generalRank(units, m.a.id), rb = generalRank(units, m.b.id);
        pick = (ra <= rb ? [m.la, m.lb] : [m.lb, m.la]).find(k => k && common.includes(nodeByKey[k].name)) || null;
      }
      const name = pick && nodeByKey[pick] ? nodeByKey[pick].name : null;
      bp = name && common.includes(name) ? name : null;
    }
    const id = rid();
    stmts.push(env.DB.prepare('INSERT INTO matches (id, campaign_id, round, kind, location_a, location_b, player_a, player_b, guest_name, table_key, battleplan) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, c.id, c.current_round, m.kind, m.la, m.lb, m.a.id, m.b ? m.b.id : null, m.kind === 'guest' ? 'Gastspieler' : null, table, bp));
    const where = m.kind === 'pvp' ? `auf ${m.la ? nodeByKey[m.la].name : 'dem Lager'}` : m.kind === 'pair' ? 'über die Karte hinweg' : '';
    const txt = m.kind === 'guest'
      ? `Begegnung: ${m.a.display_name} kämpft gegen einen Gastspieler.`
      : `Begegnung: ${m.a.display_name} gegen ${m.b.display_name} ${where}.`;
    stmts.push(logStmt(env, c.id, c.current_round, null, 'match', txt));
  }
  stmts.push(env.DB.prepare("UPDATE campaigns SET phase='battle' WHERE id=?").bind(c.id));
  stmts.push(logStmt(env, c.id, c.current_round, null, 'round', `Runde ${c.current_round}: Züge aufgedeckt${by ? ' (' + by + ')' : ''}.`));
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
}

async function maybeResolve(env, cid) {
  const c = await getCampaign(env, cid);
  if (c.phase !== 'move') return;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN moved_round=? AND pending_move IS NOT NULL THEN 1 ELSE 0 END) AS m FROM players WHERE campaign_id=?').bind(c.current_round, cid).first();
  if (r.n > 0 && r.n === r.m) await resolveMoves(env, c, null);
}

async function maybeNextRound(env, cid, force) {
  const c = await getCampaign(env, cid);
  if (c.phase !== 'battle') return;
  const ms = (await env.DB.prepare('SELECT * FROM matches WHERE campaign_id=? AND round=?').bind(cid, c.current_round).all()).results;
  const complete = ms.every(m => m.status === 'done' && m.done_a && (m.player_b ? m.done_b : true));
  if (!complete && !force) return;
  // Atomar: nur eine Anfrage schaltet die Runde weiter
  const upd = await env.DB.prepare("UPDATE campaigns SET current_round=?, phase='move' WHERE id=? AND phase='battle' AND current_round=?").bind(c.current_round + 1, cid, c.current_round).run();
  if (!upd.meta || !upd.meta.changes) return;
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET pending_move=NULL WHERE campaign_id=?').bind(cid),
    logStmt(env, cid, c.current_round + 1, null, 'round', `Runde ${c.current_round + 1} beginnt – alle wählen geheim ihr nächstes Ziel.`),
    bump(env, cid),
  ]);
}

// ---------- Spielbericht ----------
const REPORT_NUMS = { bp_roll: [1, 6], twist_roll: [1, 6], guest_points: [0, 100000], guest_killed_points: [0, 100000], renown_a: [0, 10000], renown_b: [0, 10000] };
// Übernimmt nur bekannte Felder; Einheiten werden einzeln zusammengeführt, damit zwei Geräte,
// die gleichzeitig an der Aufstellung arbeiten, sich nichts gegenseitig überschreiben.
function mergeReport(prev, patch, unitIds, { withStatus = true } = {}) {
  const out = { ...prev };
  if (!patch || typeof patch !== 'object') return out;
  if ('twist' in patch) out.twist = patch.twist ? str(patch.twist, 60) : null;
  for (const [k, [lo, hi]] of Object.entries(REPORT_NUMS)) if (k in patch) out[k] = clampInt(patch[k], lo, hi, 0);
  if (patch.units && typeof patch.units === 'object') {
    const units = { ...(prev.units || {}) };
    for (const [id, r] of Object.entries(patch.units)) {
      if (!unitIds.has(id) || !r || typeof r !== 'object') continue;
      const u = { ...(units[id] || {}) };
      if (withStatus && 'status' in r) u.status = r.status === 'reserve' ? 'reserve' : 'field';
      for (const k of ['destroyed', 'token', 'contaminated', 'untimely']) if (k in r) u[k] = !!r[k];
      if ('lost' in r) u.lost = clampInt(r.lost, 0, 1000, 0);
      if ('purify' in r) u.purify = clampInt(r.purify, 0, 9, 0);
      units[id] = u;
    }
    out.units = units;
  }
  return out;
}

// Ergebnis eintragen (oder korrigieren): Bericht festhalten, dann den gesamten Fortschritt neu berechnen.
async function applyResult(env, c, m, body, actorName) {
  const p = packOf(c.pack);
  const opts = campaignOptions(c);
  const result = ['a', 'b', 'draw', 'a_minor', 'b_minor'].includes(body.result) ? body.result : fail(400, 'Ungültiges Ergebnis');
  if (p.id === 'rc' && result.endsWith('_minor')) fail(400, 'In Ravaged Coast gibt es keine kleinen Siege.');
  const players = (await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all()).results;
  const pa = players.find(x => x.id === m.player_a) || null;
  const pb = m.player_b ? players.find(x => x.id === m.player_b) || null : null;
  const bp = str(body.battleplan, 80) || m.battleplan;
  if (!bp) fail(400, 'Bitte zuerst den Schlachtplan festlegen.');
  const choices = battleplanChoices(c.pack, m, pa ? parse(pa.data) : {}, pb ? parse(pb.data) : null, opts);
  if (!choices.includes(bp)) fail(400, `„${bp}“ kann in dieser Begegnung nicht gespielt werden.`);
  const vp = v => (v === null || v === undefined || v === '' ? null : clampInt(v, 0, 9999, null));

  const unitRows = (await env.DB.prepare('SELECT * FROM roster_units WHERE campaign_id=? AND player_id IN (?,?)').bind(c.id, m.player_a, m.player_b || '').all()).results
    .map(u => ({ ...u, data: parse(u.data) }));
  const unitIds = new Set(unitRows.map(u => u.id));
  const wasDone = m.status === 'done';
  let report = mergeReport(parse(m.report), body.report, unitIds, { withStatus: false });
  // Beim ersten Eintragen festhalten, wer mitgekämpft hat (bei einer Korrektur bleibt dieser Stand bestehen)
  if (!wasDone || !report.snapshot) {
    report = battleSnapshot(m, report, { a: unitRows.filter(u => u.player_id === m.player_a), b: m.player_b ? unitRows.filter(u => u.player_id === m.player_b) : null });
  }
  const stmts = [];
  stmts.push(env.DB.prepare("UPDATE matches SET status='done', result=?, vp_a=?, vp_b=?, battleplan=?, report=?, finished_at=COALESCE(finished_at, datetime('now')) WHERE id=?")
    .bind(result, vp(body.vp_a), vp(body.vp_b), bp, JSON.stringify(report), m.id));

  // Fortschritt aller Spieler aus dem gesamten Spielverlauf neu berechnen
  const all = (await env.DB.prepare('SELECT * FROM matches WHERE campaign_id=?').bind(c.id).all()).results
    .map(x => (x.id === m.id ? { ...x, status: 'done', result, battleplan: bp, finished_at: x.finished_at || '9999' } : x));
  const prog = campaignProgress(c.pack, players.map(x => x.id), all, opts);
  const winSide = result.startsWith('a') ? 'a' : result.startsWith('b') ? 'b' : null;
  for (const pl of players) {
    const s = prog.stats[pl.id];
    const d = parse(pl.data);
    d.fought = s.fought; d.won_bps = s.won_bps;
    if (p.id === 'rc') d.won_tables = s.won_tables;
    if (p.id === 'bw') d.unlocked = s.unlocked;
    if (s.trophy) d.trophy = true; else delete d.trophy;
    // Position: Wer ein Duell auf demselben Feld verliert, zieht sich auf sein vorheriges Feld zurück.
    let loc = pl.location_key;
    const side = pl.id === m.player_a ? 'a' : pl.id === m.player_b ? 'b' : null;
    if (side && m.round === c.current_round && c.phase !== 'move') {
      const here = side === 'a' ? m.location_a : m.location_b;
      const lost = winSide && winSide !== side;
      loc = lost && m.kind === 'pvp' && pl.prev_location_key && pl.prev_location_key !== here ? pl.prev_location_key : here;
    }
    stmts.push(env.DB.prepare('UPDATE players SET wins=?, losses=?, draws=?, data=?, location_key=? WHERE id=?')
      .bind(s.wins, s.losses, s.draws, JSON.stringify(d), loc, pl.id));
  }
  stmts.push(env.DB.prepare('UPDATE locations SET owner_player_id=NULL WHERE campaign_id=?').bind(c.id));
  for (const [key, pid] of Object.entries(prog.owners)) stmts.push(env.DB.prepare('UPDATE locations SET owner_player_id=? WHERE campaign_id=? AND key=?').bind(pid, c.id, key));

  const major = result === 'a' || result === 'b';
  const nameOf = s => (s === 'a' ? (pa ? pa.display_name : '?') : (pb ? pb.display_name : (m.guest_name || 'Gastspieler')));
  const resTxt = winSide ? `${nameOf(winSide)} gewinnt (${major ? 'großer' : 'kleiner'} Sieg)` : 'Unentschieden';
  const vpTxt = vp(body.vp_a) != null && vp(body.vp_b) != null ? ` (${vp(body.vp_a)}:${vp(body.vp_b)} SP)` : '';
  stmts.push(logStmt(env, c.id, m.round, null, 'result', `${wasDone ? 'Ergebnis korrigiert' : 'Ergebnis'} „${bp}“: ${nameOf('a')} vs. ${nameOf('b')} – ${resTxt}${vpTxt}. Eingetragen von ${actorName}.`));
  // Kampagnensieg (oder Rücknahme nach einer Korrektur)
  if (prog.winner && c.winner_player_id !== prog.winner) {
    const w = players.find(x => x.id === prog.winner);
    stmts.push(env.DB.prepare("UPDATE campaigns SET phase='finished', winner_player_id=? WHERE id=?").bind(prog.winner, c.id));
    stmts.push(logStmt(env, c.id, m.round, prog.winner, 'victory', `🏆 ${w.display_name} gewinnt die Kampagne mit einem großen Sieg in „${p.finalBattleplan}“!`));
  } else if (!prog.winner && c.phase === 'finished') {
    stmts.push(env.DB.prepare("UPDATE campaigns SET phase='battle', winner_player_id=NULL WHERE id=?").bind(c.id));
    stmts.push(logStmt(env, c.id, m.round, null, 'round', 'Der Kampagnensieg wurde nach einer Korrektur zurückgenommen.'));
  }
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
}

// ---------- Roster-Operationen ----------
const UNIT_TEXT = { name: 80, path: 60, regiment_of: 40, catalog_name: 120, faction: 60 };
const UNIT_INT = {
  points: [0, 5000], models: [1, 400], reinforced: [0, 1], is_hero: [0, 1], is_general: [0, 1], auxiliary: [0, 1],
  rank: [0, 4], renown: [0, 2000], battle_wounds: [0, 99], drained: [0, 1], sort: [0, 2000000000],
};
function cleanUnitFields(f) {
  const o = {};
  if (!f || typeof f !== 'object') return o;
  for (const [k, max] of Object.entries(UNIT_TEXT)) if (k in f) o[k] = f[k] == null || f[k] === '' ? null : str(f[k], max);
  for (const [k, [lo, hi]] of Object.entries(UNIT_INT)) if (k in f) o[k] = clampInt(f[k], lo, hi, lo);
  if ('name' in o && !o.name) o.name = 'Einheit';
  return o;
}

const strOrNull = (v, max) => (v == null || v === '' ? null : str(v, max));
function cleanWeapon(w) {
  if (!w || typeof w !== 'object') return null;
  const dice = d => ({ d: clampInt(d && d.d, 0, 6, 0), p: clampInt(d && d.p, -20, 40, 0) });
  return {
    type: w.type === 'ranged' ? 'ranged' : 'melee', name: str(w.name, 80), rng: clampInt(w.rng, 0, 30, 0),
    atk: dice(w.atk), hit: clampInt(w.hit, 2, 6, 4), wnd: clampInt(w.wnd, 2, 6, 3), rnd: clampInt(w.rnd, 0, 4, 1), dmg: dice(w.dmg),
    abilities: (Array.isArray(w.abilities) ? w.abilities : []).slice(0, 12).map(a => str(a, 60)).filter(Boolean),
  };
}
// Nur bekannte Zusatzfelder einer Einheit, jeweils auf sinnvolle Werte begrenzt. null = Feld löschen.
const UNIT_DATA = {
  keywords: v => str(v, 300), notes_src: v => str(v, 400), legends: v => !!v, reinforce: v => !!v, ror: v => !!v,
  hungry: v => !!v, concoction_bought: v => !!v,
  trait: v => strOrNull(v, 120), artefact: v => strOrNull(v, 120), concoction: v => strOrNull(v, 80),
  notes: v => (v == null || v === '' ? null : text(v, 1000)),
  lost: v => clampInt(v, 0, 800, 0),
  rest_round: v => (v == null ? null : clampInt(v, 0, 100000, null)),
  abilities: v => (Array.isArray(v) ? v.slice(0, 4).map(a => (a ? str(a, 120) : null)) : []),
  scars: v => { const o = {}; if (v && typeof v === 'object') for (const k of ['serious', 'severe', 'critical']) if (v[k]) o[k] = str(v[k], 300); return o; },
  job: v => (v && typeof v === 'object' && JOB_TYPES.includes(v.type) && v.type !== 'fight' ? { round: clampInt(v.round, 0, 100000, 0), type: v.type } : null),
  weapon: cleanWeapon,
};
function patchUnitData(cur, patch) {
  const out = { ...cur };
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, v] of Object.entries(patch)) {
    if (!UNIT_DATA[k]) continue;
    const nv = v === null ? null : UNIT_DATA[k](v);
    if (nv === null || nv === undefined) delete out[k]; else out[k] = nv;
  }
  return out;
}
// Spielerdaten, die der Spieler selbst pflegt. Fortschritt (unlocked, won_tables, trophy …) gehört dem Server.
const PLAYER_DATA = {
  formation: v => str(v, 160), terrain: v => str(v, 160), landmark: v => str(v, 200), regiment_ghyran: v => str(v, 200),
  next_ability: v => strOrNull(v, 400),
  tome: v => (Array.isArray(v) ? v.slice(0, 12).map(t => ({ name: str(t && t.name, 120), kind: ['Zauber', 'Gebet', 'Beschwörung'].includes(t && t.kind) ? t.kind : 'Zauber' })).filter(t => t.name) : []),
  ingredients: v => { const o = {}; if (v && typeof v === 'object') for (const [k, n] of Object.entries(v).slice(0, 24)) { const c = clampInt(n, 0, 99, 0); if (c > 0) o[str(k, 60)] = c; } return o; },
};
const STOCKS = { food: 'Nahrung', gold: 'Gold', food_total: null, gold_total: null };

async function rosterOps(env, ctx, body) {
  const c = ctx.campaign, isAdmin = !!ctx.admin;
  const p = packOf(c.pack);
  let pid = ctx.player ? ctx.player.id : null;
  if (body.player_id && body.player_id !== pid) {
    if (!isAdmin) fail(403, 'Du kannst nur dein eigenes Roster ändern.');
    pid = str(body.player_id, 40);
  }
  if (!pid) fail(403, 'Kein Spieler');
  const pl = await env.DB.prepare('SELECT * FROM players WHERE id=? AND campaign_id=?').bind(pid, c.id).first();
  if (!pl) fail(404, 'Spieler nicht gefunden');
  const locked = !!pl.roster_locked;
  const strict = locked && !isAdmin; // nach dem Abschluss: Grunddaten der Einheiten sind fest
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 80) : [];
  const rows = (await env.DB.prepare('SELECT * FROM roster_units WHERE player_id=? AND campaign_id=?').bind(pid, c.id).all()).results;
  const units = new Map(rows.map(u => [u.id, { ...u, data: parse(u.data) }]));
  const stmts = [];
  const created = [];
  let dVault = 0, dTotal = 0, setVault = null, setTotal = null;
  const pdata = parse(pl.data);
  const dStock = { food: 0, gold: 0 };
  let dataChanged = false, lockNow = null, newGeneral = null;
  const auto = []; // automatische Verlaufs-Notizen, falls der Browser keine mitschickt

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'add') {
      if (units.size >= MAX_UNITS) fail(400, `Höchstens ${MAX_UNITS} Einheiten pro Roster.`);
      const u = cleanUnitFields(op.unit || {});
      if (strict) { u.is_general = 0; u.rank = 0; u.renown = 0; u.battle_wounds = 0; u.path = null; u.reinforced = 0; }
      if (u.regiment_of && !units.has(u.regiment_of)) u.regiment_of = null;
      const data = patchUnitData({}, op.unit && op.unit.data);
      const nid = rid();
      const row = { id: nid, player_id: pid, catalog_name: u.catalog_name ?? null, name: u.name || 'Einheit', faction: u.faction ?? null, points: u.points || 0, models: u.models || 1,
        reinforced: u.reinforced || 0, is_hero: u.is_hero || 0, is_general: u.is_general || 0, regiment_of: u.regiment_of ?? null, auxiliary: u.auxiliary || 0, path: u.path ?? null,
        rank: u.rank || 0, renown: u.renown || 0, battle_wounds: u.battle_wounds || 0, drained: u.drained || 0, data };
      units.set(nid, row);
      created.push({ tmp: op.unit && op.unit.tmp_id ? str(op.unit.tmp_id, 40) : null, id: nid });
      if (row.is_general) newGeneral = nid;
      stmts.push(env.DB.prepare(`INSERT INTO roster_units (id, player_id, campaign_id, catalog_name, name, faction, points, models, reinforced, is_hero, is_general, regiment_of, auxiliary, path, rank, renown, battle_wounds, drained, data, sort)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nid, pid, c.id, row.catalog_name, row.name, row.faction, row.points, row.models, row.reinforced, row.is_hero, row.is_general,
        row.regiment_of, row.auxiliary, row.path, row.rank, row.renown, row.battle_wounds, row.drained, JSON.stringify(data), u.sort || Math.floor(Date.now() / 1000) % 2000000000));
      auto.push(`+ ${row.name} (${unitPoints(row)} Pkt)`);
    } else if (op.op === 'update') {
      const uid = str(op.id, 40);
      const cur = units.get(uid);
      if (!cur) continue; // fremde oder inzwischen entfernte Einheit
      const f = cleanUnitFields(op.fields || {});
      if (strict) for (const k of ['points', 'models', 'catalog_name', 'faction', 'is_hero']) delete f[k];
      if ('regiment_of' in f && f.regiment_of && (!units.has(f.regiment_of) || f.regiment_of === uid)) f.regiment_of = null;
      if (f.is_general && !cur.is_hero && !('is_hero' in f && f.is_hero)) delete f.is_general;
      const keys = Object.keys(f);
      if (keys.length) {
        stmts.push(env.DB.prepare(`UPDATE roster_units SET ${keys.map(k => k + '=?').join(', ')} WHERE id=? AND player_id=?`).bind(...keys.map(k => f[k]), uid, pid));
        Object.assign(cur, f);
        if (f.is_general) newGeneral = uid;
      }
      if (op.data && typeof op.data === 'object') {
        // Nur die geänderten Felder übernehmen (null = Feld löschen), damit ein veralteter Stand nichts überschreibt
        cur.data = patchUnitData(cur.data, op.data);
        const js = JSON.stringify(cur.data);
        if (js.length > 8000) fail(400, 'Zu viele Zusatzdaten an einer Einheit.');
        stmts.push(env.DB.prepare('UPDATE roster_units SET data=? WHERE id=? AND player_id=?').bind(js, uid, pid));
      }
    } else if (op.op === 'remove') {
      const uid = str(op.id, 40);
      const cur = units.get(uid);
      if (!cur) continue;
      units.delete(uid);
      if (newGeneral === uid) newGeneral = null;
      stmts.push(env.DB.prepare('DELETE FROM roster_units WHERE id=? AND player_id=?').bind(uid, pid));
      // Stirbt oder geht ein Regimentsführer, werden seine Einheiten zu Hilfseinheiten
      stmts.push(env.DB.prepare('UPDATE roster_units SET regiment_of=NULL, auxiliary=1 WHERE regiment_of=? AND player_id=?').bind(uid, pid));
      for (const x of units.values()) if (x.regiment_of === uid) { x.regiment_of = null; x.auxiliary = 1; }
      auto.push(`− ${cur.name}`);
    } else if (op.op === 'player') {
      const f = op.fields && typeof op.fields === 'object' ? op.fields : {};
      if ('vault_delta' in f) dVault += clampInt(f.vault_delta, -20000, 20000, 0);
      if ('vault_total_delta' in f) dTotal += clampInt(f.vault_total_delta, 0, 20000, 0);
      if (isAdmin && 'vault' in f) setVault = clampInt(f.vault, 0, 1000000, pl.vault);
      if (isAdmin && 'vault_total' in f) setTotal = clampInt(f.vault_total, 0, 1000000, pl.vault_total);
      if ('faction' in f && (!locked || isAdmin)) stmts.push(env.DB.prepare('UPDATE players SET faction=? WHERE id=?').bind(str(f.faction, 60) || null, pid));
      if ('roster_locked' in f) {
        if (!f.roster_locked && locked && !isAdmin) fail(403, 'Nur der Master kann ein abgeschlossenes Roster wieder öffnen');
        lockNow = f.roster_locked ? 1 : 0;
      }
      if (f.data_delta && typeof f.data_delta === 'object') {
        // Zahlen-Vorräte (Nahrung, Gold) hoch-/runterzählen
        for (const k of Object.keys(STOCKS)) {
          if (!(k in f.data_delta)) continue;
          const isFood = k.startsWith('food');
          const base = pdata[k] == null ? (isFood ? c.points_limit : 0) : Number(pdata[k]) || 0;
          const dv = clampInt(f.data_delta[k], k.endsWith('_total') ? 0 : -1000000, 1000000, 0);
          const nv = base + dv;
          if (nv < 0) fail(400, isFood ? `Nicht genug Nahrung (es fehlen ${-nv}).` : `Nicht genug Gold (es fehlen ${-nv}).`);
          pdata[k] = nv;
          if (k in dStock) dStock[k] += dv;
          dataChanged = true;
        }
      }
      if (isAdmin && f.data_set && typeof f.data_set === 'object') {
        for (const k of ['food', 'gold']) if (k in f.data_set) { const nv = clampInt(f.data_set[k], 0, 10000000, 0); dStock[k] += nv - (Number(pdata[k]) || 0); pdata[k] = nv; dataChanged = true; }
      }
      if (f.data && typeof f.data === 'object') {
        for (const [k, v] of Object.entries(f.data)) {
          if (!PLAYER_DATA[k]) continue; // Fortschritt und Vorräte lassen sich hier nicht setzen
          const nv = v === null ? null : PLAYER_DATA[k](v);
          if (nv === null || nv === '') delete pdata[k]; else pdata[k] = nv;
          dataChanged = true;
        }
      }
    }
  }

  // Währung: nie ins Minus; „insgesamt gesammelt“ kann nicht stärker steigen als der Vorrat
  if (!isAdmin) dTotal = Math.min(dTotal, Math.max(0, dVault));
  const vaultAfter = (setVault != null ? setVault : pl.vault) + dVault;
  if (vaultAfter < 0) fail(400, `Nicht genug ${p.currency.name} (es fehlen ${-vaultAfter}).`);
  if (setVault != null || setTotal != null) {
    stmts.push(env.DB.prepare('UPDATE players SET vault=?, vault_total=? WHERE id=?').bind(vaultAfter, (setTotal != null ? setTotal : pl.vault_total) + dTotal, pid));
  } else if (dVault || dTotal) {
    stmts.push(env.DB.prepare('UPDATE players SET vault=vault+?, vault_total=vault_total+? WHERE id=?').bind(dVault, dTotal, pid));
  }
  if (dataChanged) {
    const js = JSON.stringify(pdata);
    if (js.length > 30000) fail(400, 'Zu viele Zusatzdaten.');
    stmts.push(env.DB.prepare('UPDATE players SET data=? WHERE id=?').bind(js, pid));
  }
  // Es gibt immer höchstens einen General
  if (newGeneral && units.has(newGeneral)) {
    stmts.push(env.DB.prepare('UPDATE roster_units SET is_general=0 WHERE player_id=? AND id<>?').bind(pid, newGeneral));
    stmts.push(env.DB.prepare('UPDATE roster_units SET auxiliary=0, regiment_of=NULL WHERE id=? AND player_id=?').bind(newGeneral, pid));
    for (const x of units.values()) x.is_general = x.id === newGeneral ? 1 : 0;
  }
  if (lockNow === 1 && !locked) {
    // Roster abschließen: die wichtigsten Aufstellungsregeln prüft auch der Server
    if (!isAdmin) {
      const us = [...units.values()];
      const pts = us.reduce((a, u) => a + unitPoints(u), 0);
      if (pts > c.points_limit) fail(400, `Zu viele Punkte: ${pts} / ${c.points_limit}.`);
      const gens = us.filter(u => u.is_general);
      if (gens.length !== 1 || !gens[0].is_hero) fail(400, 'Das Roster braucht genau einen General (einen Helden).');
      if (c.unit_limit) {
        const big = us.find(u => unitPoints(u) > c.unit_limit && !(u.is_hero && (u.faction || pl.faction) === 'Behemats Söhne'));
        if (big) fail(400, `${big.name} kostet mehr als ${c.unit_limit} Punkte.`);
      }
    }
    stmts.push(env.DB.prepare('UPDATE players SET roster_locked=1 WHERE id=?').bind(pid));
  } else if (lockNow === 0 && locked) {
    stmts.push(env.DB.prepare('UPDATE players SET roster_locked=0 WHERE id=?').bind(pid));
  }

  // Verlauf: Beträge kommen immer vom Server, damit jede Änderung an Währung und Vorräten nachvollziehbar ist
  const amounts = [];
  if (setVault != null) amounts.push(`${p.currency.short} auf ${vaultAfter} gesetzt`);
  else if (dVault) amounts.push(`${p.currency.short} ${signed(dVault)}`);
  if (dStock.gold) amounts.push(`Gold ${signed(dStock.gold)}`);
  if (dStock.food) amounts.push(`Nahrung ${signed(dStock.food)}`);
  const who = isAdmin && (!ctx.player || ctx.player.id !== pid) ? `Master für ${pl.display_name}` : pl.display_name;
  const note = str(body.log, 400);
  if (note || amounts.length || auto.length) {
    const head = note || (auto.length ? `ändert das Roster (${auto.slice(0, 6).join(', ')})` : 'ändert die Vorräte');
    stmts.push(logStmt(env, c.id, c.current_round, pid, 'roster', `${who}: ${head}${amounts.length ? ` [${amounts.join(' · ')}]` : ''}`));
  }
  if (!stmts.length) return { ok: true, created, vault: pl.vault, vault_total: pl.vault_total };
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
  return { ok: true, created, vault: vaultAfter, vault_total: (setTotal != null ? setTotal : pl.vault_total) + dTotal };
}

// ---------- Router ----------
export async function handle(context) {
  const { request: req, env } = context;
  if (!env.DB) return json({ error: 'D1-Datenbank ist nicht verbunden (Binding „DB“ fehlt).' }, 500);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = req.method;
  try {
    if (method !== 'GET' && method !== 'POST') fail(405, 'Methode nicht erlaubt');
    let body = {};
    if (method === 'POST') {
      // Nur Anfragen von der eigenen Seite (Schutz vor fremden Webseiten, die im Hintergrund Anfragen schicken)
      const origin = req.headers.get('origin');
      let foreign = req.headers.get('sec-fetch-site') === 'cross-site';
      if (origin && origin !== 'null') { try { foreign = foreign || new URL(origin).host !== url.host; } catch { foreign = true; } }
      if (foreign) fail(403, 'Anfrage von fremder Seite abgelehnt.');
      if (!/^application\/json/i.test(req.headers.get('content-type') || '')) fail(415, 'Bitte JSON senden.');
      const raw = await req.text();
      if (raw.length > MAX_BODY) fail(413, 'Anfrage zu groß.');
      try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'Ungültige Anfrage.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Ungültige Anfrage.');
    }
    await ensureSchema(env);
    await maybeCleanup(env);
    const ip = clientIp(req);

    // --- Status & Setup ---
    if (path === 'status' && method === 'GET') {
      const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
      const s = await loadSession(env, req);
      let me = null;
      if (s) {
        const admin = s.admin_id ? await env.DB.prepare('SELECT id, name FROM admins WHERE id=?').bind(s.admin_id).first() : null;
        const player = s.player_id ? await env.DB.prepare('SELECT p.id, p.display_name AS name, p.campaign_id, c.name AS campaign_name, c.pack FROM players p JOIN campaigns c ON c.id=p.campaign_id WHERE p.id=?').bind(s.player_id).first() : null;
        if (admin || player) me = { admin, player };
      }
      const policy = (await getSetting(env, 'create_policy', 'all')) === 'master' ? 'master' : 'all';
      return json({ setup_needed: a.n === 0, me, create_policy: policy, can_create: policy === 'all' || !!(me && me.admin) });
    }
    if (path === 'setup' && method === 'POST') {
      const name = str(body.name, 40), pw = String(body.password || '');
      if (!name || pw.length < 8 || pw.length > 200) fail(400, 'Name und ein Passwort mit mindestens 8 Zeichen angeben.');
      const salt = rid(16), id = rid();
      // Nur anlegen, wenn es wirklich noch keinen Master gibt (in einem Schritt, damit zwei gleichzeitige Aufrufe nicht beide gewinnen)
      const ins = await env.DB.prepare('INSERT INTO admins (id, name, pw_hash, salt) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM admins)').bind(id, name, await hashSecret(pw, salt), salt).run();
      if (!ins.meta || !ins.meta.changes) fail(403, 'Es gibt bereits einen Master-Login.');
      const token = await upsertSession(env, req, { admin_id: id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, req) });
    }
    if (path === 'admin/login' && method === 'POST') {
      const name = str(body.name, 40);
      const kIp = 'admin-ip:' + ip, kName = 'admin:' + name.toLowerCase();
      await assertNotBlocked(env, kIp); await assertNotBlocked(env, kName);
      const a = await env.DB.prepare('SELECT * FROM admins WHERE name=?').bind(name).first();
      const pw = String(body.password || '').slice(0, 200);
      // Auch bei unbekanntem Namen rechnen, damit die Antwortzeit nichts verrät
      const hash = await hashSecret(pw, a ? a.salt : '00000000000000000000000000000000');
      if (!a || !safeEq(hash, a.pw_hash)) {
        const b = await strike(env, kIp, 5, 900, 300);
        await strike(env, kName, 25, 900, 900, 3600);
        fail(401, 'Name oder Passwort falsch.' + (b ? ` Weitere Versuche sind für ${waitText(b)} gesperrt.` : ''));
      }
      await clearStrikes(env, kIp);
      const token = await upsertSession(env, req, { admin_id: a.id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, req) });
    }
    if (path === 'logout' && method === 'POST') {
      const s = await loadSession(env, req);
      if (s) {
        if (body.which === 'player' && s.admin_id) await env.DB.prepare('UPDATE sessions SET player_id=NULL WHERE token=?').bind(s.token).run();
        else if (body.which === 'admin' && s.player_id) await env.DB.prepare('UPDATE sessions SET admin_id=NULL WHERE token=?').bind(s.token).run();
        else await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(s.token).run();
      }
      return json({ ok: true });
    }

    // --- Kampagne starten (je nach Einstellung jeder oder nur der Master) ---
    if (path === 'campaigns' && method === 'POST') {
      const s = await loadSession(env, req);
      const isAdmin = !!(s && s.admin_id && await env.DB.prepare('SELECT 1 FROM admins WHERE id=?').bind(s.admin_id).first());
      if (!isAdmin) {
        if ((await getSetting(env, 'create_policy', 'all')) === 'master') fail(403, 'Neue Kampagnen kann hier nur der Master anlegen.');
        await assertNotBlocked(env, 'create:' + ip);
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first();
        if (n.n >= 500) fail(429, 'Es gibt zu viele Kampagnen. Der Master muss erst alte löschen.');
        await strike(env, 'create:' + ip, 6, 3600, 3600, 3600);
      }
      return json(await createCampaign(env, body));
    }

    // --- Lobby mit den Spieler-Plätzen ---
    let mm = path.match(/^lobby\/([A-Za-z0-9]{4,12})(?:\/(claim|login))?$/);
    if (mm) {
      await assertNotBlocked(env, 'lobby:' + ip);
      const c = await env.DB.prepare('SELECT * FROM campaigns WHERE invite_code=?').bind(mm[1].toUpperCase()).first();
      if (!c) {
        await strike(env, 'lobby:' + ip, 30, 600, 600, 3600); // Codes lassen sich nicht in Ruhe durchprobieren
        fail(404, 'Unbekannter Kampagnen-Code.');
      }
      if (!mm[2] && method === 'GET') {
        const ps = (await env.DB.prepare('SELECT id, slot, display_name, faction, roster_locked FROM players WHERE campaign_id=?').bind(c.id).all()).results;
        const s = await loadSession(env, req);
        return json({
          campaign: { name: c.name, pack: c.pack, phase: c.phase, slots: c.slots, points_limit: c.points_limit, invite_code: c.invite_code, current_round: c.current_round },
          slots: Array.from({ length: c.slots }, (_, i) => { const p = ps.find(x => x.slot === i + 1); return p ? { slot: i + 1, taken: true, name: p.display_name, faction: p.faction, ready: !!p.roster_locked, mine: !!(s && s.player_id === p.id) } : { slot: i + 1, taken: false }; }),
        });
      }
      if (mm[2] === 'claim' && method === 'POST') {
        if (c.phase === 'finished') fail(400, 'Diese Kampagne ist bereits beendet.');
        const slot = clampInt(body.slot, 1, c.slots, 0);
        const name = str(body.name, 30), pin = String(body.pin || '');
        if (!slot) fail(400, 'Ungültiger Platz');
        if (!name) fail(400, 'Bitte einen Namen eingeben.');
        if (!/^\d{4,8}$/.test(pin)) fail(400, 'Die PIN muss aus 4 bis 8 Ziffern bestehen.');
        await assertNotBlocked(env, 'claim:' + ip);
        const ex = await env.DB.prepare('SELECT 1 FROM players WHERE campaign_id=? AND slot=?').bind(c.id, slot).first();
        if (ex) fail(409, 'Dieser Platz ist schon vergeben.');
        const dupe = await env.DB.prepare('SELECT 1 FROM players WHERE campaign_id=? AND lower(display_name)=lower(?)').bind(c.id, name).first();
        if (dupe) fail(409, 'Dieser Name ist in der Kampagne schon vergeben.');
        await strike(env, 'claim:' + ip, 20, 3600, 3600, 3600);
        const id = rid(), salt = rid(16);
        const p = packOf(c.pack);
        const data = { ...(p.id === 'bw' ? { unlocked: [...p.startUnlocked] } : {}), food: c.points_limit, food_total: c.points_limit, gold: 0, gold_total: 0 };
        let loc = null;
        if (p.id === 'rc' && c.phase !== 'lobby') loc = p.starts[(slot - 1) % p.starts.length];
        const faction = str(body.faction, 60) || null;
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO players (id, campaign_id, slot, display_name, pin_hash, salt, faction, data, location_key, moved_round) VALUES (?,?,?,?,?,?,?,?,?,?)')
              .bind(id, c.id, slot, name, await hashSecret(pin, salt), salt, faction, JSON.stringify(data), loc, 0),
            logStmt(env, c.id, c.current_round, id, 'join', `${name} tritt der Kampagne bei${faction ? ' (' + faction + ')' : ''}.`),
            bump(env, c.id),
          ]);
        } catch (e) {
          if (/UNIQUE/i.test(String(e && e.message))) fail(409, 'Dieser Platz ist schon vergeben.');
          throw e;
        }
        const token = await upsertSession(env, req, { player_id: id });
        return json({ ok: true, player_id: id }, 200, { 'set-cookie': sessionCookie(token, req) });
      }
      if (mm[2] === 'login' && method === 'POST') {
        const slot = clampInt(body.slot, 1, c.slots, 0);
        const kIp = 'login-ip:' + ip;
        await assertNotBlocked(env, kIp);
        const p = await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? AND slot=?').bind(c.id, slot).first();
        const kPin = p ? 'pin:' + p.id : null;
        if (kPin) await assertNotBlocked(env, kPin);
        const pin = String(body.pin || '').slice(0, 20);
        if (!p || !safeEq(await hashSecret(pin, p.salt), p.pin_hash)) {
          // Sperre pro Platz (egal von welchem Gerät) und pro IP – eine 4-stellige PIN lässt sich so nicht durchprobieren
          const b = kPin ? await strike(env, kPin, 5, 900, 300) : 0;
          await strike(env, kIp, 20, 900, 900, 3600);
          fail(401, 'PIN falsch.' + (b ? ` Dieser Platz ist jetzt für ${waitText(b)} gesperrt (der Master kann die PIN zurücksetzen).` : ''));
        }
        await clearStrikes(env, kPin);
        const token = await upsertSession(env, req, { player_id: p.id });
        return json({ ok: true, player_id: p.id }, 200, { 'set-cookie': sessionCookie(token, req) });
      }
      fail(404, 'Unbekannter Endpunkt');
    }

    // --- Master-Bereich ---
    if (path === 'admin/campaigns' && method === 'GET') {
      const ctx = await ctxFor(env, req, url, false);
      if (!ctx.admin) fail(403, 'Nur für den Master.');
      const cs = (await env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all()).results;
      const ps = (await env.DB.prepare('SELECT id, campaign_id, slot, display_name, faction, roster_locked, wins, draws, losses, vault, vault_total FROM players ORDER BY slot').all()).results;
      const policy = (await getSetting(env, 'create_policy', 'all')) === 'master' ? 'master' : 'all';
      return json({ create_policy: policy, campaigns: cs.map(c => ({ ...c, options: campaignOptions(c), players: ps.filter(p => p.campaign_id === c.id) })) });
    }
    if (path === 'admin/settings' && method === 'POST') {
      const ctx = await ctxFor(env, req, url, false);
      if (!ctx.admin) fail(403, 'Nur für den Master.');
      if ('create_policy' in body) await setSetting(env, 'create_policy', body.create_policy === 'master' ? 'master' : 'all');
      return json({ ok: true });
    }
    mm = path.match(/^admin\/campaign\/([a-f0-9]{32})$/);
    if (mm && method === 'POST') {
      const ctx = await ctxFor(env, req, url, false);
      if (!ctx.admin) fail(403, 'Nur für den Master.');
      const c = await getCampaign(env, mm[1]);
      const a = body.action;
      const pl = body.player_id ? await env.DB.prepare('SELECT * FROM players WHERE id=? AND campaign_id=?').bind(str(body.player_id, 40), c.id).first() : null;
      if (a === 'kick') {
        if (!pl) fail(404, 'Spieler nicht gefunden');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM roster_units WHERE player_id=?').bind(pl.id),
          env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(pl.id),
          env.DB.prepare('UPDATE locations SET owner_player_id=NULL WHERE owner_player_id=?').bind(pl.id),
          env.DB.prepare("UPDATE matches SET status='done', result=COALESCE(result,'void'), done_a=1, done_b=1 WHERE campaign_id=? AND status!='done' AND (player_a=? OR player_b=?)").bind(c.id, pl.id, pl.id),
          env.DB.prepare('DELETE FROM players WHERE id=?').bind(pl.id),
          env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind('pin:' + pl.id),
          logStmt(env, c.id, c.current_round, null, 'kick', `Der Master hat ${pl.display_name} aus der Kampagne entfernt.`),
          bump(env, c.id),
        ]);
        await maybeResolve(env, c.id); await maybeNextRound(env, c.id);
      } else if (a === 'reset_pin') {
        if (!pl) fail(404, 'Spieler nicht gefunden');
        const pin = String(body.pin || '');
        if (!/^\d{4,8}$/.test(pin)) fail(400, 'PIN: 4–8 Ziffern');
        const salt = rid(16);
        await env.DB.batch([env.DB.prepare('UPDATE players SET pin_hash=?, salt=? WHERE id=?').bind(await hashSecret(pin, salt), salt, pl.id),
          env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(pl.id),
          env.DB.prepare('DELETE FROM rate_limits WHERE key=?').bind('pin:' + pl.id)]);
      } else if (a === 'delete') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM roster_units WHERE campaign_id=?').bind(c.id),
          env.DB.prepare('DELETE FROM matches WHERE campaign_id=?').bind(c.id),
          env.DB.prepare('DELETE FROM locations WHERE campaign_id=?').bind(c.id),
          env.DB.prepare('DELETE FROM events WHERE campaign_id=?').bind(c.id),
          env.DB.prepare('DELETE FROM sessions WHERE player_id IN (SELECT id FROM players WHERE campaign_id=?)').bind(c.id),
          env.DB.prepare('DELETE FROM players WHERE campaign_id=?').bind(c.id),
          env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(c.id),
        ]);
      } else if (a === 'force_resolve') {
        // Eine hängengebliebene Aufdeckung (z. B. nach einem Verbindungsabbruch) lässt sich so neu anstoßen
        if (c.phase === 'resolving') { await env.DB.prepare("UPDATE campaigns SET phase='move' WHERE id=? AND phase='resolving'").bind(c.id).run(); c.phase = 'move'; }
        if (c.phase !== 'move') fail(400, 'Es läuft gerade keine Zugphase.');
        await resolveMoves(env, c, 'vom Master erzwungen');
      } else if (a === 'force_next') {
        if (c.phase !== 'battle') fail(400, 'Es läuft gerade keine Schlachtphase.');
        await env.DB.prepare("UPDATE matches SET done_a=1, done_b=1, status='done', result=COALESCE(result,'void') WHERE campaign_id=? AND round=?").bind(c.id, c.current_round).run();
        await maybeNextRound(env, c.id, true);
      } else if (a === 'settings') {
        const opts = campaignOptions(c);
        if ('guest_final' in body) opts.guest_final = !!body.guest_final;
        await env.DB.batch([
          env.DB.prepare('UPDATE campaigns SET name=?, points_limit=?, unit_limit=?, allow_unique=?, options=? WHERE id=?').bind(str(body.name, 60) || c.name, clampInt(body.points_limit, 300, 5000, c.points_limit), clampInt(body.unit_limit, 0, 5000, c.unit_limit), ('allow_unique' in body ? body.allow_unique : c.allow_unique) ? 1 : 0, JSON.stringify(opts), c.id),
          bump(env, c.id)]);
      } else if (a === 'unlock_roster') {
        if (!pl) fail(404, 'Spieler nicht gefunden');
        await env.DB.batch([env.DB.prepare('UPDATE players SET roster_locked=0 WHERE id=?').bind(pl.id), bump(env, c.id)]);
      } else if (a === 'start') {
        await startCampaign(env, c, 'Master');
      } else fail(400, 'Unbekannte Aktion');
      return json({ ok: true });
    }

    // --- Spieler-/Kampagnen-Endpunkte ---
    if (path === 'state' && method === 'GET') {
      const ctx = await ctxFor(env, req, url);
      return json(await stateFor(env, ctx, url.searchParams.get('v')));
    }
    if (path === 'start' && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      await startCampaign(env, ctx.campaign, ctx.player ? ctx.player.display_name : 'Master');
      return json({ ok: true });
    }
    if (path === 'move' && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      if (!ctx.player) fail(403, 'Nur Spieler können ziehen.');
      const c = ctx.campaign;
      if (c.phase !== 'move') fail(400, 'Gerade ist keine Zugphase.');
      const pl = ctx.player;
      const allowed = allowedTargets(c.pack, { location_key: pl.location_key, vault_total: pl.vault_total, data: parse(pl.data) });
      const target = str(body.target, 10);
      if (!allowed.includes(target)) fail(400, 'Dieses Feld kannst du gerade nicht betreten.');
      const first = !(pl.moved_round === c.current_round && pl.pending_move);
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET pending_move=?, moved_round=? WHERE id=?').bind(target, c.current_round, pl.id),
        ...(first ? [logStmt(env, c.id, c.current_round, pl.id, 'moved', `${pl.display_name} hat einen Zug gewählt (geheim).`)] : []),
        bump(env, c.id),
      ]);
      await maybeResolve(env, c.id);
      return json({ ok: true });
    }
    if (path === 'roster' && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      return json(await rosterOps(env, ctx, body));
    }
    mm = path.match(/^match\/([a-f0-9]{32})$/);
    if (mm && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      const c = ctx.campaign;
      const m = await env.DB.prepare('SELECT * FROM matches WHERE id=? AND campaign_id=?').bind(mm[1], c.id).first();
      if (!m) fail(404, 'Spiel nicht gefunden');
      const me = ctx.player ? ctx.player.id : null;
      const isPart = !!me && (me === m.player_a || me === m.player_b);
      if (!isPart && !ctx.admin) fail(403, 'Nur Beteiligte oder der Master.');
      const actor = ctx.player && isPart ? ctx.player.display_name : 'Master';
      if (m.result === 'void') fail(400, 'Dieses Spiel wurde annulliert.');
      if (body.op === 'setup') {
        if (m.status === 'done') fail(400, 'Das Ergebnis steht schon fest – die Aufstellung lässt sich nicht mehr ändern.');
        const pa = await env.DB.prepare('SELECT data FROM players WHERE id=?').bind(m.player_a).first();
        const pb = m.player_b ? await env.DB.prepare('SELECT data FROM players WHERE id=?').bind(m.player_b).first() : null;
        let bp = m.battleplan;
        if (body.battleplan) {
          bp = str(body.battleplan, 80);
          if (!battleplanChoices(c.pack, m, pa ? parse(pa.data) : {}, pb ? parse(pb.data) : null, campaignOptions(c)).includes(bp)) fail(400, `„${bp}“ kann in dieser Begegnung nicht gespielt werden.`);
        }
        const ids = new Set((await env.DB.prepare('SELECT id FROM roster_units WHERE campaign_id=? AND player_id IN (?,?)').bind(c.id, m.player_a, m.player_b || '').all()).results.map(r => r.id));
        const rep = mergeReport(parse(m.report), body.report, ids);
        const js = JSON.stringify(rep);
        if (js.length > MAX_STATE) fail(413, 'Spielbericht zu groß.');
        const note = str(body.log, 300);
        await env.DB.batch([
          env.DB.prepare("UPDATE matches SET battleplan=?, report=? WHERE id=? AND status<>'done'").bind(bp, js, m.id),
          ...(note ? [logStmt(env, c.id, m.round, me, 'match', `${actor}: ${note}`)] : []),
          bump(env, c.id)]);
      } else if (body.op === 'result') {
        if (m.status === 'done' && !ctx.admin) {
          // Vertipper lassen sich korrigieren, solange noch niemand mit dem Aftermath begonnen hat
          const untouched = m.aftermath_a === '{}' && m.aftermath_b === '{}' && !m.done_a && !m.done_b;
          if (!untouched || m.round !== c.current_round) fail(400, 'Der Aftermath hat schon begonnen – jetzt kann nur noch der Master das Ergebnis korrigieren.');
        }
        await applyResult(env, c, m, body, actor);
      } else if (body.op === 'aftermath') {
        if (m.status !== 'done') fail(400, 'Erst das Ergebnis eintragen.');
        const side = body.side === 'b' ? 'b' : 'a';
        const owner = side === 'a' ? m.player_a : m.player_b;
        if (!owner) fail(400, 'Der Gastspieler hat keinen Aftermath.');
        if (!ctx.admin && owner !== me) fail(403, 'Das ist nicht dein Aftermath.');
        const col = side === 'a' ? 'aftermath_a' : 'aftermath_b';
        const doneCol = side === 'a' ? 'done_a' : 'done_b';
        const wasDone = !!m[doneCol];
        const js = JSON.stringify(body.state && typeof body.state === 'object' ? body.state : {});
        if (js.length > MAX_STATE) fail(413, 'Aftermath-Stand zu groß.');
        const done = wasDone || !!body.done; // einmal abgeschlossen bleibt abgeschlossen
        await env.DB.batch([
          env.DB.prepare(`UPDATE matches SET ${col}=?, ${doneCol}=? WHERE id=?`).bind(js, done ? 1 : 0, m.id),
          ...(done && !wasDone ? [logStmt(env, c.id, m.round, owner, 'aftermath', `${actor} hat den Aftermath abgeschlossen.`)] : []),
          bump(env, c.id)]);
        if (done && !wasDone) await maybeNextRound(env, c.id);
      } else fail(400, 'Unbekannte Aktion');
      return json({ ok: true });
    }
    if (path === 'dice' && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      const who = ctx.player ? ctx.player.display_name : 'Master';
      const txt = str(body.text, 300);
      if (txt) await env.DB.batch([logStmt(env, ctx.cid, ctx.campaign.current_round, ctx.player ? ctx.player.id : null, 'dice', `🎲 ${who}: ${txt}`), bump(env, ctx.cid)]);
      return json({ ok: true });
    }
    fail(404, 'Unbekannter Endpunkt');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    const msg = String(e && e.message);
    // Nur Hinweise auf eine fehlende Datenbank-Einrichtung nach außen geben, sonst keine internen Details
    return json({ error: /no such (table|column)/i.test(msg) ? 'Die Datenbank ist noch nicht vollständig eingerichtet (siehe README).' : 'Serverfehler – bitte noch einmal versuchen.' }, 500);
  }
}

async function startCampaign(env, c, who) {
  if (c.phase !== 'lobby') fail(400, 'Die Kampagne läuft bereits.');
  const p = packOf(c.pack);
  const ps = (await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all()).results;
  if (ps.length < 2) fail(400, 'Es braucht mindestens 2 Spieler.');
  const notReady = ps.filter(x => !x.roster_locked).map(x => x.display_name);
  if (notReady.length) fail(400, 'Noch nicht fertig mit dem Roster: ' + notReady.join(', '));
  // Atomar starten: zwei gleichzeitige Klicks starten die Kampagne nur einmal
  const upd = await env.DB.prepare("UPDATE campaigns SET phase='move', current_round=1 WHERE id=? AND phase='lobby'").bind(c.id).run();
  if (!upd.meta || !upd.meta.changes) fail(400, 'Die Kampagne läuft bereits.');
  const stmts = [];
  for (const pl of ps) {
    const loc = p.id === 'rc' ? p.starts[(pl.slot - 1) % p.starts.length] : null;
    stmts.push(env.DB.prepare('UPDATE players SET location_key=?, prev_location_key=?, pending_move=NULL WHERE id=?').bind(loc, loc, pl.id));
  }
  stmts.push(logStmt(env, c.id, 1, null, 'round', `${who} hat die Kampagne gestartet. Runde 1 – wählt geheim euer erstes Ziel!`));
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
}
