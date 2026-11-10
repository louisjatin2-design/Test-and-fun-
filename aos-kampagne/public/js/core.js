// Reine Rechenlogik ohne Browser-Zugriffe. Wird vom Browser UND vom Server genutzt,
// damit beide dieselben Zahlen berechnen (Armeepunkte, Verluste, Kampagnen-Fortschritt).
import { packOf, discoverRoutes, isFinal } from './packs.js';

// ---------- Einheiten ----------
export const unitPoints = u => (u.points || 0) * (u.reinforced ? 2 : 1);
export const fullModels = u => (u.models || 1) * (u.reinforced ? 2 : 1);
export const aliveModels = u => Math.max(0, fullModels(u) - ((u.data && u.data.lost) || 0));
export const perModel = u => Math.round((u.points || 0) / (u.models || 1));
// Punktwert der noch lebenden Modelle (Armeepunkte in der Schlacht, Nahrungsbedarf)
export const livePoints = u => {
  const alive = aliveModels(u), full = fullModels(u);
  if (alive <= 0) return 0;
  return full > 1 ? Math.round(unitPoints(u) * alive / full) : unitPoints(u);
};
export const isUnique = u => /einzigartig/i.test((u.data && u.data.keywords) || '');

// ---------- Aufträge (Hausregel) ----------
export const JOB_TYPES = ['fight', 'rest', 'mine', 'forage'];
export function unitJob(u, round) {
  const d = u.data || {};
  if (d.job && d.job.round === round && JOB_TYPES.includes(d.job.type)) return d.job.type;
  if (d.rest_round === round) return 'rest';
  return 'fight';
}
export const plays = st => st === 'field' || st === 'reserve';

// Status einer Einheit in einem Spiel: field | reserve | rest | mine | forage | out | absent
// Sobald das Ergebnis eingetragen ist, gilt der dabei festgehaltene Stand (report.units[id].played),
// damit spätere Roster-Änderungen (neue Einheiten, dauerhafte Verluste) das Spiel nicht nachträglich verändern.
export function unitStatus(m, u, rep) {
  const report = rep || m.report || {};
  const r = (report.units || {})[u.id];
  const job = unitJob(u, m.round);
  if (m.status === 'done' && report.snapshot) {
    if (r && r.played) return r.status === 'reserve' ? 'reserve' : 'field';
    return job !== 'fight' ? job : 'absent';
  }
  if (job !== 'fight') return job;
  if (aliveModels(u) <= 0) return 'out';
  return r && r.status === 'reserve' ? 'reserve' : 'field';
}

// Hält beim Eintragen des Ergebnisses fest, wer mitgekämpft hat und was gefallen ist.
// unitsBySide: { a: [...], b: [...] } – jeweils die Roster-Einheiten (data bereits als Objekt).
export function battleSnapshot(m, report, unitsBySide) {
  const rep = report || {};
  const old = rep.units || {};
  const units = {};
  const live = { ...m, status: 'open' };
  for (const side of ['a', 'b']) {
    const us = unitsBySide[side];
    if (!us) continue;
    let army = 0, killed = 0;
    for (const u of us) {
      if (!plays(unitStatus(live, u, rep))) continue;
      const prev = old[u.id] || {};
      const alive = aliveModels(u);
      const r = {
        status: prev.status === 'reserve' ? 'reserve' : 'field',
        played: true,
        alive_at_battle: alive,
        destroyed: !!prev.destroyed,
        lost: Math.min(alive, Math.max(0, Math.floor(Number(prev.lost) || 0))),
        token: !!prev.token,
        contaminated: !!prev.contaminated,
        purify: Math.min(9, Math.max(0, Math.floor(Number(prev.purify) || 0))),
        untimely: prev.status === 'reserve' && !!prev.untimely,
      };
      // „Untimely Arrival“: nie eingesetzte Reserve hat nicht gekämpft – keine Verluste, keine Beute für den Gegner
      if (r.untimely) r.lost = 0;
      const dead = r.untimely ? 0 : r.destroyed ? alive : r.lost;
      const each = fullModels(u) > 1 ? Math.round(unitPoints(u) / fullModels(u)) : unitPoints(u);
      army += livePoints(u);
      killed += dead * each;
      units[u.id] = r;
    }
    rep['army_pts_' + side] = army;
    rep['killed_pts_' + side] = killed;
  }
  rep.units = units;
  rep.snapshot = true;
  return rep;
}

// Armeepunkte einer Seite in einem Spiel (Gast: eingetragene Punkte)
export function armyPoints(m, side, units, rep) {
  const report = rep || m.report || {};
  const pid = side === 'a' ? m.player_a : m.player_b;
  if (!pid) return Math.max(0, Number(report.guest_points) || 0);
  if (m.status === 'done' && report.snapshot && report['army_pts_' + side] != null) return report['army_pts_' + side];
  return units.filter(u => u.player_id === pid && plays(unitStatus(m, u, report))).reduce((a, u) => a + livePoints(u), 0);
}

// ---------- Kampagnen-Fortschritt aus dem Spielverlauf ----------
// Berechnet Bilanz, gespielte/gewonnene Schlachtpläne, freigeschaltete Zonen/Routen, Feldbesitz
// und den Kampagnensieger komplett neu aus allen abgeschlossenen Spielen. Dadurch lässt sich ein
// falsch eingetragenes Ergebnis korrigieren, ohne dass etwas doppelt gezählt wird.
export function campaignProgress(packId, playerIds, matches, options) {
  const p = packOf(packId);
  const stats = {};
  for (const id of playerIds) {
    stats[id] = { wins: 0, draws: 0, losses: 0, fought: [], won_bps: [], won_tables: [], unlocked: p.id === 'bw' ? [...p.startUnlocked] : null, trophy: false };
  }
  const owners = {};
  let winner = null;
  const add = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
  const done = matches.filter(m => m.status === 'done' && ['a', 'b', 'draw', 'a_minor', 'b_minor'].includes(m.result))
    .sort((x, y) => (x.round - y.round) || String(x.finished_at || '').localeCompare(String(y.finished_at || '')) || String(x.id).localeCompare(String(y.id)));
  for (const m of done) {
    const winSide = m.result.startsWith('a') ? 'a' : m.result.startsWith('b') ? 'b' : null;
    const major = m.result === 'a' || m.result === 'b';
    const bp = m.battleplan || null;
    const node = bp ? p.nodes.find(n => n.name === bp) : null;
    for (const [side, pid, loc] of [['a', m.player_a, m.location_a], ['b', m.player_b, m.location_b]]) {
      const s = pid && stats[pid];
      if (!s) continue;
      const won = winSide === side;
      if (won) s.wins++; else if (winSide) s.losses++; else s.draws++;
      add(s.fought, bp);
      if (won) add(s.won_bps, bp);
      if (won && p.id === 'rc') add(s.won_tables, m.table_key);
      if (p.id === 'bw' && node) {
        const wonKeys = s.won_bps.map(n => (p.nodes.find(x => x.name === n) || {}).key).filter(Boolean);
        s.unlocked = discoverRoutes('bw', s.unlocked, node.key, won, wonKeys);
      }
      if (won && loc) owners[loc] = pid;
    }
    if (!winner && major && winSide && isFinal(packId, m, bp, options)) {
      const w = winSide === 'a' ? m.player_a : m.player_b;
      if (w && stats[w]) { winner = w; stats[w].trophy = true; }
    }
  }
  return { stats, owners, winner };
}
