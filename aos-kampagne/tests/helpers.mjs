// Hilfen für die Tests: ruft die Schnittstelle direkt auf (ohne Netzwerk) und merkt sich das Sitzungs-Cookie.
import { handle } from '../src/server.js';
import { makeD1 } from './d1.mjs';

export const ORIGIN = 'https://kampagne.test';
export function makeEnv() { return { DB: makeD1() }; }

export class Client {
  constructor(env, ip = '10.0.0.1') { this.env = env; this.cookie = null; this.ip = ip; this.cid = null; }
  async call(method, path, body, extra = {}) {
    const headers = { 'cf-connecting-ip': this.ip, ...(extra.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let url = ORIGIN + '/api/' + path;
    if (this.cid && !path.startsWith('admin') && !path.startsWith('lobby')) url += (path.includes('?') ? '&' : '?') + 'cid=' + this.cid;
    const init = { method, headers };
    if (method === 'POST') {
      if (!('content-type' in headers)) headers['content-type'] = 'application/json';
      if (!('origin' in headers)) headers.origin = ORIGIN;
      init.body = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    }
    const res = await handle({ request: new Request(url, init), env: this.env });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* leer */ }
    return { status: res.status, body: data, headers: res.headers };
  }
  get(path) { return this.call('GET', path); }
  post(path, body, extra) { return this.call('POST', path, body, extra); }
  async ok(path, body) { const r = await this.post(path, body); if (r.status !== 200) throw new Error(`${path} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; }
  async state() { const r = await this.get('state'); if (r.status !== 200) throw new Error(`state → ${r.status} ${JSON.stringify(r.body)}`); return r.body; }
}

export async function master(env) {
  const m = new Client(env, '10.9.9.9');
  await m.ok('setup', { name: 'Master', password: 'sehr-geheim-1' });
  return m;
}

const HERO = (name, pts = 100) => ({ catalog_name: name, name, points: pts, models: 1, is_hero: 1, is_general: 1, rank: 1, path: 'brawler', data: { keywords: 'Held', abilities: ['Dependable Assault'] } });
const TROOP = (name, pts = 100, models = 5) => ({ catalog_name: name, name, points: pts, models, is_hero: 0, auxiliary: 1, data: { keywords: 'Infanterie', reinforce: true } });

// Legt eine Kampagne mit n Spielern an, baut kleine Roster, schließt sie ab und startet.
export async function startedCampaign(env, { pack = 'rc', n = 2, start = true, options = {} } = {}) {
  const creator = new Client(env, '10.0.1.1');
  const camp = await creator.ok('campaigns', { pack, name: 'Test', slots: Math.max(2, n), ...options });
  const players = [];
  for (let i = 0; i < n; i++) {
    const c = new Client(env, '10.0.2.' + (i + 1));
    const r = await c.ok(`lobby/${camp.invite_code}/claim`, { slot: i + 1, name: 'Spieler' + (i + 1), pin: '1' + String(i).padStart(3, '0') + '7', faction: 'Skaven' });
    c.id = r.player_id; c.name = 'Spieler' + (i + 1); c.pin = '1' + String(i).padStart(3, '0') + '7'; c.slot = i + 1;
    await c.ok('roster', { ops: [{ op: 'add', unit: HERO('Held ' + (i + 1)) }, { op: 'add', unit: TROOP('Trupp ' + (i + 1), 150, 10) }, { op: 'add', unit: TROOP('Garde ' + (i + 1), 120, 3) }], log: 'baut das Roster' });
    await c.ok('roster', { ops: [{ op: 'player', fields: { roster_locked: 1 } }], log: 'schließt ab' });
    players.push(c);
  }
  if (start) await players[0].ok('start', {});
  return { camp, players, creator };
}

// Alle ziehen auf dasselbe (erlaubte) Feld bzw. die angegebenen Felder; liefert die Spiele der Runde.
export async function moveAll(players, targets) {
  for (let i = 0; i < players.length; i++) await players[i].ok('move', { target: targets[i] });
  const st = await players[0].state();
  return st.matches.filter(m => m.round === st.campaign.current_round);
}

export async function finishAftermaths(players, match) {
  for (const p of players) {
    const side = match.player_a === p.id ? 'a' : match.player_b === p.id ? 'b' : null;
    if (side) await p.ok('match/' + match.id, { op: 'aftermath', side, state: { step: 5 }, done: true });
  }
}
export { HERO, TROOP };
