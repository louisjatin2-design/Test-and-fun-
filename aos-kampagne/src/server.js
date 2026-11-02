// Schnittstelle (Cloudflare Pages Functions) für den AoS Kampagnen-Manager.
// Der Browser spricht nie direkt mit der Datenbank: jede Anfrage läuft hier durch,
// prüft die Sitzung und liefert nur Daten der eigenen Kampagne.
import { PACKS, packOf, allowedTargets, discoverRoutes } from '../public/js/packs.js';

const SESSION_DAYS = 60;
const PBKDF2_ITER = 10000;

// ---------- Hilfsfunktionen ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map(b => abc[b % abc.length]).join('');
};
const parse = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);

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

async function loadSession(env, req) {
  const token = getCookie(req, 'sess');
  if (!token) return null;
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
const logStmt = (env, cid, round, pid, kind, text) =>
  env.DB.prepare('INSERT INTO events (campaign_id, round, player_id, kind, text) VALUES (?,?,?,?,?)').bind(cid, round, pid, kind, str(text, 600));

async function getCampaign(env, cid) {
  const c = await env.DB.prepare('SELECT * FROM campaigns WHERE id=?').bind(cid).first();
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
  const stmts = [env.DB.prepare('INSERT INTO campaigns (id, pack, name, invite_code, points_limit, unit_limit, slots, allow_unique) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, pack, name, invite, clampInt(body.points_limit, 300, 5000, 1000), clampInt(body.unit_limit, 0, 5000, pack === 'rc' ? 350 : 0),
      clampInt(body.slots, 2, 4, 4), body.allow_unique ? 1 : 0)];
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
    campaign: { id: c.id, pack: c.pack, name: c.name, invite_code: c.invite_code, points_limit: c.points_limit, unit_limit: c.unit_limit, slots: c.slots, allow_unique: !!c.allow_unique, current_round: c.current_round, phase: c.phase, winner_player_id: c.winner_player_id },
    players: players.results.map(p => ({
      id: p.id, slot: p.slot, name: p.display_name, faction: p.faction, location_key: p.location_key, prev_location_key: p.prev_location_key,
      moved: p.moved_round === c.current_round && !!p.pending_move,
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

async function resolveMoves(env, c, by) {
  const p = packOf(c.pack);
  const players = (await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all()).results;
  const units = (await env.DB.prepare('SELECT player_id, is_general, rank FROM roster_units WHERE campaign_id=?').bind(c.id).all()).results;
  const nodeByKey = Object.fromEntries(p.nodes.map(n => [n.key, n]));
  const stmts = [];
  // Neue Positionen festlegen
  const pos = {};
  for (const pl of players) {
    const target = (pl.moved_round === c.current_round && pl.pending_move) ? pl.pending_move : pl.location_key;
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
  for (const [k, list] of Object.entries(groups)) {
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

  const zoneIdx = z => p.zoneOrder.indexOf(z);
  for (const m of matches) {
    let table = null, bp = null;
    if (p.id === 'rc') {
      const za = m.la ? nodeByKey[m.la].zone : 'outskirts';
      const zb = m.lb ? nodeByKey[m.lb].zone : za;
      table = zoneIdx(za) <= zoneIdx(zb) ? za : zb;
      if (table === 'claw') bp = "Raid on Hel's Claw";
    } else {
      table = 'bw';
      const ua = new Set(parse(m.a.data).unlocked || p.startUnlocked);
      const ub = m.b ? new Set(parse(m.b.data).unlocked || p.startUnlocked) : ua;
      const common = p.nodes.filter(n => ua.has(n.key) && ub.has(n.key)).map(n => n.key);
      let pick = null;
      if (m.kind === 'pvp' || m.kind === 'guest') pick = m.la;
      else {
        const ra = generalRank(units, m.a.id), rb = generalRank(units, m.b.id);
        const lowFirst = ra <= rb ? [m.la, m.lb] : [m.lb, m.la];
        pick = lowFirst.find(k => k && common.includes(k)) || common[0];
      }
      bp = pick ? nodeByKey[pick].name : null;
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
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET current_round=current_round+1, phase='move' WHERE id=?").bind(cid),
    env.DB.prepare('UPDATE players SET pending_move=NULL WHERE campaign_id=?').bind(cid),
    logStmt(env, cid, c.current_round + 1, null, 'round', `Runde ${c.current_round + 1} beginnt – alle wählen geheim ihr nächstes Ziel.`),
    bump(env, cid),
  ]);
}

// Ergebnis eintragen: Bilanz, Gebiete, Routen, Kampagnensieg
async function applyResult(env, c, m, body, actorName) {
  const p = packOf(c.pack);
  const result = ['a', 'b', 'draw', 'a_minor', 'b_minor'].includes(body.result) ? body.result : fail(400, 'Ungültiges Ergebnis');
  const winSide = result.startsWith('a') ? 'a' : result.startsWith('b') ? 'b' : null;
  const major = result === 'a' || result === 'b';
  const pa = await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(m.player_a).first();
  const pb = m.player_b ? await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(m.player_b).first() : null;
  const bp = str(body.battleplan, 80) || m.battleplan;
  const bpNode = p.nodes.find(n => n.name === bp);
  const report = { ...parse(m.report), ...(body.report || {}) };
  const stmts = [];
  stmts.push(env.DB.prepare("UPDATE matches SET status='done', result=?, vp_a=?, vp_b=?, battleplan=?, report=?, finished_at=datetime('now') WHERE id=?")
    .bind(result, body.vp_a ?? null, body.vp_b ?? null, bp, JSON.stringify(report), m.id));

  const sides = [['a', pa, m.location_a], ['b', pb, m.location_b]];
  for (const [side, pl, loc] of sides) {
    if (!pl) continue;
    const won = winSide === side, lost = winSide && winSide !== side;
    const d = parse(pl.data);
    d.fought = [...new Set([...(d.fought || []), bp])];
    if (won) d.won_bps = [...new Set([...(d.won_bps || []), bp])];
    if (won && m.table_key && p.id === 'rc') d.won_tables = [...new Set([...(d.won_tables || []), m.table_key])];
    if (p.id === 'bw' && bpNode) {
      const wonKeys = (d.won_bps || []).map(n => (p.nodes.find(x => x.name === n) || {}).key).filter(Boolean);
      d.unlocked = discoverRoutes('bw', d.unlocked, bpNode.key, won, wonKeys);
    }
    let newLoc = pl.location_key;
    if (lost && m.kind === 'pvp' && pl.prev_location_key && pl.prev_location_key !== pl.location_key) newLoc = pl.prev_location_key;
    stmts.push(env.DB.prepare('UPDATE players SET wins=wins+?, losses=losses+?, draws=draws+?, data=?, location_key=? WHERE id=?')
      .bind(won ? 1 : 0, lost ? 1 : 0, winSide ? 0 : 1, JSON.stringify(d), newLoc, pl.id));
    if (won && loc) stmts.push(env.DB.prepare('UPDATE locations SET owner_player_id=? WHERE campaign_id=? AND key=?').bind(pl.id, c.id, loc));
  }
  const nameOf = s => s === 'a' ? pa.display_name : (pb ? pb.display_name : (m.guest_name || 'Gastspieler'));
  const resTxt = winSide ? `${nameOf(winSide)} gewinnt (${major ? 'großer' : 'kleiner'} Sieg)` : 'Unentschieden';
  stmts.push(logStmt(env, c.id, m.round, null, 'result', `Ergebnis „${bp || 'Schlacht'}“: ${nameOf('a')} vs. ${nameOf('b')} – ${resTxt}${body.vp_a != null ? ` (${body.vp_a}:${body.vp_b} SP)` : ''}. Eingetragen von ${actorName}.`));
  // Kampagnensieg
  if (major && winSide && bp === p.finalBattleplan) {
    const w = winSide === 'a' ? pa : pb;
    if (w) {
      const wd = parse(w.data); wd.trophy = true;
      stmts.push(env.DB.prepare('UPDATE players SET data=? WHERE id=?').bind(JSON.stringify({ ...wd, ...{ trophy: true } }), w.id));
      stmts.push(env.DB.prepare("UPDATE campaigns SET phase='finished', winner_player_id=? WHERE id=?").bind(w.id, c.id));
      stmts.push(logStmt(env, c.id, m.round, w.id, 'victory', `🏆 ${w.display_name} gewinnt die Kampagne mit einem großen Sieg in „${bp}“!`));
    }
  }
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
}

// ---------- Roster-Operationen ----------
const UNIT_FIELDS = ['name', 'points', 'models', 'reinforced', 'is_hero', 'is_general', 'regiment_of', 'auxiliary', 'path', 'rank', 'renown', 'battle_wounds', 'drained', 'sort', 'catalog_name', 'faction'];
function cleanUnitFields(f) {
  const o = {};
  for (const k of UNIT_FIELDS) if (k in f) {
    if (['name', 'path', 'regiment_of', 'catalog_name', 'faction'].includes(k)) o[k] = f[k] == null || f[k] === '' ? null : str(f[k], 120);
    else o[k] = clampInt(f[k], -1000, 100000, 0);
  }
  if ('name' in o && !o.name) o.name = 'Einheit';
  return o;
}

async function rosterOps(env, ctx, body) {
  const c = ctx.campaign;
  let pid = ctx.player ? ctx.player.id : null;
  if (ctx.admin && body.player_id) pid = body.player_id;
  if (!pid) fail(403, 'Kein Spieler');
  const pl = await env.DB.prepare('SELECT * FROM players WHERE id=? AND campaign_id=?').bind(pid, c.id).first();
  if (!pl) fail(404, 'Spieler nicht gefunden');
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 60) : [];
  const stmts = [];
  let vault = pl.vault, vaultTotal = pl.vault_total;
  const created = [];
  for (const op of ops) {
    if (op.op === 'add') {
      const u = cleanUnitFields(op.unit || {});
      const id = op.unit && op.unit.tmp_id ? null : null;
      const nid = rid();
      created.push({ tmp: op.unit && op.unit.tmp_id, id: nid });
      stmts.push(env.DB.prepare(`INSERT INTO roster_units (id, player_id, campaign_id, catalog_name, name, faction, points, models, reinforced, is_hero, is_general, regiment_of, auxiliary, path, rank, renown, battle_wounds, drained, data, sort)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nid, pid, c.id, u.catalog_name ?? null, u.name || 'Einheit', u.faction ?? null, u.points || 0, u.models || 1,
        u.reinforced || 0, u.is_hero || 0, u.is_general || 0, u.regiment_of ?? null, u.auxiliary || 0, u.path ?? null, u.rank || 0, u.renown || 0, u.battle_wounds || 0, u.drained || 0,
        JSON.stringify((op.unit && op.unit.data) || {}), u.sort || Date.now() % 1e9));
    } else if (op.op === 'update') {
      const f = cleanUnitFields(op.fields || {});
      const keys = Object.keys(f);
      if (keys.length) stmts.push(env.DB.prepare(`UPDATE roster_units SET ${keys.map(k => k + '=?').join(', ')} WHERE id=? AND player_id=?`).bind(...keys.map(k => f[k]), str(op.id, 40), pid));
      if (op.data) stmts.push(env.DB.prepare('UPDATE roster_units SET data=? WHERE id=? AND player_id=?').bind(JSON.stringify(op.data), str(op.id, 40), pid));
    } else if (op.op === 'remove') {
      stmts.push(env.DB.prepare('DELETE FROM roster_units WHERE id=? AND player_id=?').bind(str(op.id, 40), pid));
      stmts.push(env.DB.prepare('UPDATE roster_units SET regiment_of=NULL, auxiliary=1 WHERE regiment_of=? AND player_id=?').bind(str(op.id, 40), pid));
    } else if (op.op === 'player') {
      const f = op.fields || {};
      if ('vault_delta' in f) vault += clampInt(f.vault_delta, -100000, 100000, 0);
      if ('vault_total_delta' in f) vaultTotal += clampInt(f.vault_total_delta, -100000, 100000, 0);
      if ('vault' in f && ctx.admin) vault = clampInt(f.vault, 0, 100000, vault);
      if ('vault_total' in f && ctx.admin) vaultTotal = clampInt(f.vault_total, 0, 100000, vaultTotal);
      if ('faction' in f && (!pl.roster_locked || ctx.admin)) stmts.push(env.DB.prepare('UPDATE players SET faction=? WHERE id=?').bind(str(f.faction, 60), pid));
      if ('roster_locked' in f) {
        if (!f.roster_locked && pl.roster_locked && !ctx.admin) fail(403, 'Nur der Master kann ein abgeschlossenes Roster wieder öffnen');
        stmts.push(env.DB.prepare('UPDATE players SET roster_locked=? WHERE id=?').bind(f.roster_locked ? 1 : 0, pid));
      }
      if (f.data && typeof f.data === 'object') {
        const merged = { ...parse(pl.data), ...f.data };
        pl.data = JSON.stringify(merged);
        stmts.push(env.DB.prepare('UPDATE players SET data=? WHERE id=?').bind(pl.data, pid));
      }
    }
  }
  if (vault < 0) fail(400, `Nicht genug ${packOf(c.pack).currency.name} (es fehlen ${-vault}).`);
  stmts.push(env.DB.prepare('UPDATE players SET vault=?, vault_total=? WHERE id=?').bind(vault, vaultTotal, pid));
  if (body.log) stmts.push(logStmt(env, c.id, c.current_round, pid, 'roster', `${pl.display_name}: ${body.log}`));
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
  return { ok: true, created, vault, vault_total: vaultTotal };
}

// ---------- Router ----------
export async function handle(context) {
  const { request: req, env } = context;
  if (!env.DB) return json({ error: 'D1-Datenbank ist nicht verbunden (Binding „DB“ fehlt).' }, 500);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = req.method;
  let body = {};
  if (method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  try {
    // --- Status & Setup ---
    if (path === 'status' && method === 'GET') {
      const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
      const s = await loadSession(env, req);
      let me = null;
      if (s) {
        const admin = s.admin_id ? await env.DB.prepare('SELECT id, name FROM admins WHERE id=?').bind(s.admin_id).first() : null;
        const player = s.player_id ? await env.DB.prepare('SELECT p.id, p.display_name AS name, p.campaign_id, c.name AS campaign_name, c.pack FROM players p JOIN campaigns c ON c.id=p.campaign_id WHERE p.id=?').bind(s.player_id).first() : null;
        me = { admin, player };
      }
      return json({ setup_needed: a.n === 0, me });
    }
    if (path === 'setup' && method === 'POST') {
      const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
      if (a.n > 0) fail(403, 'Es gibt bereits einen Master-Login.');
      const name = str(body.name, 40), pw = String(body.password || '');
      if (!name || pw.length < 6) fail(400, 'Name und ein Passwort mit mindestens 6 Zeichen angeben.');
      const salt = rid(16), id = rid();
      await env.DB.prepare('INSERT INTO admins (id, name, pw_hash, salt) VALUES (?,?,?,?)').bind(id, name, await hashSecret(pw, salt), salt).run();
      const token = await upsertSession(env, req, { admin_id: id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, req) });
    }
    if (path === 'admin/login' && method === 'POST') {
      const a = await env.DB.prepare('SELECT * FROM admins WHERE name=?').bind(str(body.name, 40)).first();
      if (!a || !safeEq(await hashSecret(String(body.password || ''), a.salt), a.pw_hash)) fail(401, 'Name oder Passwort falsch.');
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

    // --- Kampagne starten (jeder darf) ---
    if (path === 'campaigns' && method === 'POST') {
      return json(await createCampaign(env, body));
    }

    // --- Lobby mit den Spieler-Plätzen ---
    let mm = path.match(/^lobby\/([A-Za-z0-9]{4,12})(?:\/(claim|login))?$/);
    if (mm) {
      const c = await env.DB.prepare('SELECT * FROM campaigns WHERE invite_code=?').bind(mm[1].toUpperCase()).first();
      if (!c) fail(404, 'Unbekannter Kampagnen-Code.');
      if (!mm[2] && method === 'GET') {
        const ps = (await env.DB.prepare('SELECT id, slot, display_name, faction, roster_locked FROM players WHERE campaign_id=?').bind(c.id).all()).results;
        const s = await loadSession(env, req);
        return json({
          campaign: { id: c.id, name: c.name, pack: c.pack, phase: c.phase, slots: c.slots, points_limit: c.points_limit, invite_code: c.invite_code, current_round: c.current_round },
          slots: Array.from({ length: c.slots }, (_, i) => { const p = ps.find(x => x.slot === i + 1); return p ? { slot: i + 1, taken: true, name: p.display_name, faction: p.faction, ready: !!p.roster_locked, mine: !!(s && s.player_id === p.id) } : { slot: i + 1, taken: false }; }),
        });
      }
      if (mm[2] === 'claim' && method === 'POST') {
        const slot = clampInt(body.slot, 1, c.slots, 0);
        const name = str(body.name, 30), pin = String(body.pin || '');
        if (!slot) fail(400, 'Ungültiger Platz');
        if (!name) fail(400, 'Bitte einen Namen eingeben.');
        if (!/^\d{4,8}$/.test(pin)) fail(400, 'Die PIN muss aus 4 bis 8 Ziffern bestehen.');
        const ex = await env.DB.prepare('SELECT 1 FROM players WHERE campaign_id=? AND slot=?').bind(c.id, slot).first();
        if (ex) fail(409, 'Dieser Platz ist schon vergeben.');
        const dupe = await env.DB.prepare('SELECT 1 FROM players WHERE campaign_id=? AND lower(display_name)=lower(?)').bind(c.id, name).first();
        if (dupe) fail(409, 'Dieser Name ist in der Kampagne schon vergeben.');
        const id = rid(), salt = rid(16);
        const p = packOf(c.pack);
        const data = p.id === 'bw' ? { unlocked: [...p.startUnlocked] } : {};
        let loc = null;
        if (p.id === 'rc' && c.phase !== 'lobby') loc = p.starts[(slot - 1) % p.starts.length];
        await env.DB.batch([
          env.DB.prepare('INSERT INTO players (id, campaign_id, slot, display_name, pin_hash, salt, faction, data, location_key, moved_round) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .bind(id, c.id, slot, name, await hashSecret(pin, salt), salt, str(body.faction, 60) || null, JSON.stringify(data), loc, 0),
          logStmt(env, c.id, c.current_round, id, 'join', `${name} tritt der Kampagne bei${body.faction ? ' (' + str(body.faction, 60) + ')' : ''}.`),
          bump(env, c.id),
        ]);
        const token = await upsertSession(env, req, { player_id: id });
        return json({ ok: true, player_id: id }, 200, { 'set-cookie': sessionCookie(token, req) });
      }
      if (mm[2] === 'login' && method === 'POST') {
        const slot = clampInt(body.slot, 1, c.slots, 0);
        const p = await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? AND slot=?').bind(c.id, slot).first();
        if (!p || !safeEq(await hashSecret(String(body.pin || ''), p.salt), p.pin_hash)) fail(401, 'PIN falsch.');
        const token = await upsertSession(env, req, { player_id: p.id });
        return json({ ok: true, player_id: p.id }, 200, { 'set-cookie': sessionCookie(token, req) });
      }
    }

    // --- Master-Bereich ---
    if (path === 'admin/campaigns' && method === 'GET') {
      const ctx = await ctxFor(env, req, url, false);
      if (!ctx.admin) fail(403, 'Nur für den Master.');
      const cs = (await env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all()).results;
      const ps = (await env.DB.prepare('SELECT id, campaign_id, slot, display_name, faction, roster_locked, wins, draws, losses, vault, vault_total FROM players ORDER BY slot').all()).results;
      return json({ campaigns: cs.map(c => ({ ...c, players: ps.filter(p => p.campaign_id === c.id) })) });
    }
    mm = path.match(/^admin\/campaign\/([a-f0-9]{32})$/);
    if (mm && method === 'POST') {
      const ctx = await ctxFor(env, req, url, false);
      if (!ctx.admin) fail(403, 'Nur für den Master.');
      const c = await getCampaign(env, mm[1]);
      const a = body.action;
      const pl = body.player_id ? await env.DB.prepare('SELECT * FROM players WHERE id=? AND campaign_id=?').bind(body.player_id, c.id).first() : null;
      if (a === 'kick') {
        if (!pl) fail(404, 'Spieler nicht gefunden');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM roster_units WHERE player_id=?').bind(pl.id),
          env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(pl.id),
          env.DB.prepare('UPDATE locations SET owner_player_id=NULL WHERE owner_player_id=?').bind(pl.id),
          env.DB.prepare("UPDATE matches SET status='done', result=COALESCE(result,'void'), done_a=1, done_b=1 WHERE campaign_id=? AND status!='done' AND (player_a=? OR player_b=?)").bind(c.id, pl.id, pl.id),
          env.DB.prepare('DELETE FROM players WHERE id=?').bind(pl.id),
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
          env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(pl.id)]);
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
        if (c.phase !== 'move') fail(400, 'Es läuft gerade keine Zugphase.');
        await resolveMoves(env, c, 'vom Master erzwungen');
      } else if (a === 'force_next') {
        await env.DB.prepare("UPDATE matches SET done_a=1, done_b=1, status=CASE WHEN status='done' THEN status ELSE 'done' END, result=COALESCE(result,'void') WHERE campaign_id=? AND round=?").bind(c.id, c.current_round).run();
        await maybeNextRound(env, c.id, true);
      } else if (a === 'settings') {
        await env.DB.batch([
          env.DB.prepare('UPDATE campaigns SET name=?, points_limit=?, unit_limit=?, allow_unique=? WHERE id=?').bind(str(body.name, 60) || c.name, clampInt(body.points_limit, 300, 5000, c.points_limit), clampInt(body.unit_limit, 0, 5000, c.unit_limit), body.allow_unique ? 1 : 0, c.id),
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
      if (!ctx.player && !ctx.admin) fail(403, 'Kein Zugriff');
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
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET pending_move=?, moved_round=? WHERE id=?').bind(target, c.current_round, pl.id),
        logStmt(env, c.id, c.current_round, pl.id, 'moved', `${pl.display_name} hat einen Zug gewählt (geheim).`),
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
      const isPart = me && (me === m.player_a || me === m.player_b);
      if (!isPart && !ctx.admin) fail(403, 'Nur Beteiligte oder der Master.');
      const actor = ctx.player && isPart ? ctx.player.display_name : (ctx.admin ? 'Master' : '?');
      if (body.op === 'setup') {
        const rep = { ...parse(m.report), ...(body.report || {}) };
        await env.DB.batch([
          env.DB.prepare('UPDATE matches SET battleplan=?, report=? WHERE id=?').bind(str(body.battleplan, 80) || m.battleplan, JSON.stringify(rep), m.id),
          ...(body.log ? [logStmt(env, c.id, m.round, me, 'match', `${actor}: ${body.log}`)] : []),
          bump(env, c.id)]);
      } else if (body.op === 'result') {
        if (m.status === 'done' && !ctx.admin) fail(400, 'Ergebnis ist schon eingetragen (nur der Master kann korrigieren).');
        await applyResult(env, c, m, body, actor);
      } else if (body.op === 'aftermath') {
        const side = body.side === 'b' ? 'b' : 'a';
        const owner = side === 'a' ? m.player_a : m.player_b;
        if (!ctx.admin && owner !== me) fail(403, 'Das ist nicht dein Aftermath.');
        const col = side === 'a' ? 'aftermath_a' : 'aftermath_b';
        const done = side === 'a' ? 'done_a' : 'done_b';
        await env.DB.batch([
          env.DB.prepare(`UPDATE matches SET ${col}=?, ${done}=? WHERE id=?`).bind(JSON.stringify(body.state || {}), body.done ? 1 : 0, m.id),
          ...(body.done ? [logStmt(env, c.id, m.round, owner, 'aftermath', `${actor} hat den Aftermath abgeschlossen.`)] : []),
          bump(env, c.id)]);
        if (body.done) await maybeNextRound(env, c.id);
      } else fail(400, 'Unbekannte Aktion');
      return json({ ok: true });
    }
    if (path === 'dice' && method === 'POST') {
      const ctx = await ctxFor(env, req, url);
      const who = ctx.player ? ctx.player.display_name : 'Master';
      await env.DB.batch([logStmt(env, ctx.cid, ctx.campaign.current_round, ctx.player ? ctx.player.id : null, 'dice', `🎲 ${who}: ${str(body.text, 300)}`), bump(env, ctx.cid)]);
      return json({ ok: true });
    }
    fail(404, 'Unbekannter Endpunkt');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Serverfehler: ' + (e && e.message) }, 500);
  }
}

async function startCampaign(env, c, who) {
  if (c.phase !== 'lobby') fail(400, 'Die Kampagne läuft bereits.');
  const p = packOf(c.pack);
  const ps = (await env.DB.prepare('SELECT * FROM players WHERE campaign_id=? ORDER BY slot').bind(c.id).all()).results;
  if (ps.length < 2) fail(400, 'Es braucht mindestens 2 Spieler.');
  const notReady = ps.filter(x => !x.roster_locked).map(x => x.display_name);
  if (notReady.length) fail(400, 'Noch nicht fertig mit dem Roster: ' + notReady.join(', '));
  const stmts = [];
  for (const pl of ps) {
    const loc = p.id === 'rc' ? p.starts[(pl.slot - 1) % p.starts.length] : null;
    stmts.push(env.DB.prepare('UPDATE players SET location_key=?, prev_location_key=?, pending_move=NULL WHERE id=?').bind(loc, loc, pl.id));
  }
  stmts.push(env.DB.prepare("UPDATE campaigns SET phase='move', current_round=1 WHERE id=?").bind(c.id));
  stmts.push(logStmt(env, c.id, 1, null, 'round', `${who} hat die Kampagne gestartet. Runde 1 – wählt geheim euer erstes Ziel!`));
  stmts.push(bump(env, c.id));
  await env.DB.batch(stmts);
}
