// Zentrale Daten: API-Aufrufe, Kampagnenstand, Einheitenkatalog, abgeleitete Werte.
import { toast } from './ui.js';
import { packOf } from './packs.js';
import * as core from './core.js';

// Der Master öffnet Kampagnen über ihre ID; sie wird für diesen Tab gemerkt, damit ein Neuladen nicht hinauswirft.
const remembered = () => { try { return sessionStorage.getItem('adminCid') || null; } catch { return null; } };
export const store = { status: null, state: null, catalog: null, adminCid: remembered(), listeners: new Set() };
export function setAdminCid(cid) {
  store.adminCid = cid || null;
  try { if (cid) sessionStorage.setItem('adminCid', cid); else sessionStorage.removeItem('adminCid'); } catch { /* egal */ }
}

export async function api(path, body, { quiet } = {}) {
  const cid = store.adminCid && !path.startsWith('admin') && !path.startsWith('lobby') ? (path.includes('?') ? '&' : '?') + 'cid=' + store.adminCid : '';
  const res = await fetch('/api/' + path + cid, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) {
    const msg = data.error || `Fehler ${res.status}`;
    if (!quiet) toast(msg, 'error');
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return data;
}

export async function loadStatus() { store.status = await api('status'); return store.status; }

export async function loadState(force) {
  const v = !force && store.state ? '?v=' + store.state.version : '';
  const s = await api('state' + v, null, { quiet: true });
  if (s.unchanged) return false;
  store.state = s;
  store.listeners.forEach(fn => fn());
  return true;
}

export async function loadCatalog() {
  if (store.catalog) return store.catalog;
  const res = await fetch('/data/units.json');
  const d = await res.json();
  const factions = {};
  for (const u of d.units) { (factions[u.faction] = factions[u.faction] || { name: u.faction, alliance: u.alliance, units: [] }).units.push(u); }
  for (const u of d.units) if (factions[u.faction] && u.alliance && !['Legenden', 'White dwarf'].includes(u.alliance)) factions[u.faction].alliance = u.alliance;
  store.catalog = { ...d, factions };
  return store.catalog;
}
export function factionNames() { return store.catalog ? Object.keys(store.catalog.factions).sort((a, b) => a.localeCompare(b, 'de')) : []; }
export function allianceOf(faction) { return store.catalog && store.catalog.factions[faction] ? store.catalog.factions[faction].alliance : null; }

// ---------- abgeleitete Werte ----------
export const S = () => store.state;
export const pack = () => packOf(S().campaign.pack);
export const me = () => S() && S().players.find(p => p.id === S().me.player_id);
export const playerById = id => S().players.find(p => p.id === id);
export const unitsOf = pid => S().units.filter(u => u.player_id === pid);
export const { unitPoints, fullModels, aliveModels, perModel, livePoints, unitJob, unitStatus, plays, isUnique } = core;
export const unitModels = core.fullModels;
// Armeepunkte einer Seite in einem Spiel (nach dem Ergebnis: der dabei festgehaltene Stand)
export const armyPoints = (m, side, rep) => core.armyPoints(m, side, S().units, rep);
export const rosterPoints = pid => unitsOf(pid).reduce((a, u) => a + unitPoints(u), 0);
export const generalOf = pid => unitsOf(pid).find(u => u.is_general);
export const locByKey = key => S().locations.find(l => l.key === key);
export const locName = key => key ? (locByKey(key) || { name: key }).name : 'Lager';
export const currentMatches = () => S().matches.filter(m => m.round === S().campaign.current_round);
export function myMatch() {
  const id = S().me.player_id;
  if (!id) return null; // Master-Ansicht: kein eigenes Spiel
  return currentMatches().find(m => m.player_a === id || m.player_b === id) || null;
}
export const sideOf = (m, pid) => m.player_a === pid ? 'a' : m.player_b === pid ? 'b' : null;
export const opponentName = (m, side) => side === 'a' ? (m.player_b ? playerById(m.player_b)?.name : m.guest_name || 'Gastspieler') : playerById(m.player_a)?.name;
export const PLAYER_COLORS = ['#e2683c', '#3c9be2', '#7ad151', '#c86de0'];
export const colorOf = pid => { const p = playerById(pid); return p ? PLAYER_COLORS[(p.slot - 1) % 4] : '#888'; };

export async function rosterOps(ops, log, playerId) {
  const r = await api('roster', { ops, log, player_id: playerId });
  await loadState(true);
  return r;
}
export async function logDice(text) { try { await api('dice', { text }); } catch { /* egal */ } }

// ---------- Aufträge & Versorgung (Hausregeln) ----------
export const JOBS = {
  fight: { label: 'Kämpfen', icon: '⚔' },
  rest: { label: 'Erholen', icon: '😴' },
  mine: { label: 'Schürfen', icon: '⛏' },
  forage: { label: 'Nahrung sammeln', icon: '🌾' },
};
// Für welche Runde gilt ein jetzt gesetzter Auftrag?
export function nextJobRound(pid) {
  const st = S(), c = st.campaign;
  if (c.phase === 'finished') return null;
  if (c.phase === 'lobby') return 1;
  if (c.phase === 'move') return c.current_round;
  const m = currentMatches().find(x => x.player_a === pid || x.player_b === pid);
  return m && m.status !== 'done' ? c.current_round : c.current_round + 1;
}
export async function setJob(u, type) {
  const round = nextJobRound(u.player_id);
  if (round == null) return;
  if (type === 'rest' && unitsOf(u.player_id).some(x => x.id !== u.id && unitJob(x, round) === 'rest')) {
    toast('Nur 1 Einheit darf sich pro Schlacht erholen.', 'error'); return false;
  }
  const d = { rest_round: null, job: type && type !== 'fight' ? { round, type } : null };
  await rosterOps([{ op: 'update', id: u.id, data: d }], type && type !== 'fight'
    ? `${u.name}: Auftrag „${JOBS[type].label}“ für Runde ${round} (verpasst die Schlacht).`
    : `${u.name} kämpft in Runde ${round} wieder mit.`, u.player_id);
  return true;
}
// Rückwärtskompatibel
export const nextRestRound = nextJobRound;
export const setResting = (u, on) => setJob(u, on ? 'rest' : 'fight');
