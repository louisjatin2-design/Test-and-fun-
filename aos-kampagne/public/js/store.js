// Zentrale Daten: API-Aufrufe, Kampagnenstand, Einheitenkatalog, abgeleitete Werte.
import { toast } from './ui.js';
import { packOf } from './packs.js';

export const store = { status: null, state: null, catalog: null, adminCid: null, listeners: new Set() };

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
export const unitPoints = u => (u.points || 0) * (u.reinforced ? 2 : 1);
export const unitModels = u => (u.models || 1) * (u.reinforced ? 2 : 1);
export const rosterPoints = pid => unitsOf(pid).reduce((a, u) => a + unitPoints(u), 0);
export const generalOf = pid => unitsOf(pid).find(u => u.is_general);
export const locByKey = key => S().locations.find(l => l.key === key);
export const locName = key => key ? (locByKey(key) || { name: key }).name : 'Lager';
export const currentMatches = () => S().matches.filter(m => m.round === S().campaign.current_round);
export function myMatch() {
  const id = S().me.player_id;
  return currentMatches().find(m => m.player_a === id || m.player_b === id);
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
