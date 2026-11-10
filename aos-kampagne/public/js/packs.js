// Battlepack-Definitionen: Karte, Währung, Freischaltregeln.
// Wird vom Browser UND von den Pages Functions importiert (eine Quelle).

export const RANKS = ['—', 'Aspiring', 'Elite', 'Mighty', 'Legendary'];
export const RANK_DE = ['Kein Rang', 'Aufstrebend (Aspiring)', 'Elite', 'Mächtig (Mighty)', 'Legendär (Legendary)'];

const RC_NODES = [
  // Scorched Outskirts / Adamantine Chain
  { key: 'o1', name: 'Schmiedepass', zone: 'outskirts', x: 95, y: 95, food: 25 },
  { key: 'o2', name: 'Aschental', zone: 'outskirts', x: 255, y: 70, food: 30 },
  { key: 'o3', name: 'Rauchschlot-Klamm', zone: 'outskirts', x: 190, y: 220, food: 20 },
  { key: 'o4', name: 'Glutfeld', zone: 'outskirts', x: 75, y: 345, food: 35 },
  { key: 'o5', name: 'Basaltwacht', zone: 'outskirts', x: 300, y: 320, food: 25 },
  { key: 'o6', name: 'Schlackenhang', zone: 'outskirts', x: 185, y: 460, food: 20 },
  { key: 'o7', name: 'Verbrannte Senke', zone: 'outskirts', x: 85, y: 575, food: 30 },
  { key: 'o8', name: 'Eisenkamm-Feste', zone: 'outskirts', x: 315, y: 560, food: 25 },
  // Gnaw's Edge
  { key: 'g1', name: 'Wutzorn-Hügel', zone: 'gnaw', x: 455, y: 150, food: 20 },
  { key: 'g2', name: 'Castbridge', zone: 'gnaw', x: 470, y: 330, food: 25 },
  { key: 'g3', name: 'Burningbridge', zone: 'gnaw', x: 460, y: 505, food: 25 },
  { key: 'g4', name: 'Rand des Gnaw', zone: 'gnaw', x: 590, y: 240, food: 15 },
  // Hateful Shores
  { key: 'h1', name: 'Brazenskull', zone: 'shores', x: 705, y: 125, food: 30 },
  { key: 'h2', name: 'Meereshöhle', zone: 'shores', x: 720, y: 320, food: 45 },
  { key: 'h3', name: 'Bröckelküste', zone: 'shores', x: 680, y: 505, food: 40 },
  { key: 'h4', name: 'Giftstrand', zone: 'shores', x: 830, y: 450, food: 35 },
  // Hel's Claw
  { key: 'c1', name: "Hel's Claw", zone: 'claw', x: 905, y: 255, food: 10 },
];
const RC_LINKS = [
  ['o1', 'o2'], ['o1', 'o3'], ['o2', 'o3'], ['o2', 'g1'], ['o3', 'o4'], ['o3', 'o5'], ['o4', 'o5'], ['o4', 'o6'],
  ['o5', 'g2'], ['o5', 'o6'], ['o6', 'o7'], ['o6', 'o8'], ['o7', 'o8'], ['o8', 'g3'], ['g1', 'g2'], ['g2', 'g3'],
  ['g1', 'g4'], ['g2', 'g4'], ['g4', 'h1'], ['g4', 'h2'], ['g2', 'h2'], ['g3', 'h3'], ['h1', 'h2'], ['h2', 'h3'],
  ['h3', 'h4'], ['h2', 'h4'], ['h1', 'c1'], ['h4', 'c1'],
].map(([a, b]) => ({ from: a, to: b, type: 'road', both: true }));

const BW_NODES = [
  { key: 'tb', name: "Thyria's Bounty", zone: 'bw', x: 330, y: 70, food: 40 },
  { key: 'ff', name: 'Forest Fortress', zone: 'bw', x: 670, y: 70, food: 30 },
  { key: 'dm', name: 'A Dense and Choking Maze', zone: 'bw', x: 165, y: 180, food: 20 },
  { key: 'ck', name: 'Cursed Kernel', zone: 'bw', x: 500, y: 180, food: 15 },
  { key: 'ew', name: 'Escort to the Wellspring Grove', zone: 'bw', x: 835, y: 180, food: 35 },
  { key: 'nc', name: 'Nexuses of Contamination', zone: 'bw', x: 240, y: 295, food: 10 },
  { key: 'pc', name: 'Precarious Crossing', zone: 'bw', x: 760, y: 295, food: 25 },
  { key: 'ef', name: 'Emergency Foraging', zone: 'bw', x: 215, y: 405, food: 40 },
  { key: 'cs', name: 'The Call of Sacrifice', zone: 'bw', x: 785, y: 405, food: 20 },
  { key: 'va', name: 'Vital Alignment', zone: 'bw', x: 225, y: 515, food: 30 },
  { key: 'cr', name: 'Creeping Rootstalks', zone: 'bw', x: 775, y: 515, food: 35 },
  { key: 'bp', name: 'Be It Purity or Putrescence', zone: 'bw', x: 500, y: 600, food: 10 },
];
// type: 'path' = Thyrian Path (nach Kampf entdeckt), 'trail' = Concealed Trail (nach Sieg entdeckt)
const BW_LINKS = [
  ['tb', 'dm', 'path'], ['tb', 'ck', 'path'], ['ff', 'ck', 'path'], ['ff', 'ew', 'path'],
  ['dm', 'nc', 'path'], ['ck', 'nc', 'trail'], ['ck', 'pc', 'trail'], ['ew', 'pc', 'path'],
  ['nc', 'pc', 'path'], ['pc', 'nc', 'path'], ['nc', 'ef', 'path'], ['nc', 'cs', 'path'],
  ['pc', 'ef', 'path'], ['pc', 'cs', 'path'], ['ef', 'cs', 'path'], ['cs', 'ef', 'path'],
  ['ef', 'va', 'path'], ['cs', 'cr', 'path'], ['va', 'cr', 'path'], ['cr', 'va', 'path'],
  ['va', 'bp', 'trail'], ['cr', 'bp', 'trail'],
].map(([a, b, t]) => ({ from: a, to: b, type: t, both: false }));

export const PACKS = {
  rc: {
    id: 'rc',
    name: 'Ravaged Coast',
    subtitle: 'Path to Glory · Aqshy, Reich des Feuers',
    blurb: 'Skaven-Horden brechen aus dem Gnaw hervor, überall liegt Emberstone frei. Sammelt Splitter, schmiedet instabile Waffen und kämpft euch bis nach Hel\'s Claw vor.',
    currency: { name: 'Emberstone-Splitter', short: 'Splitter', icon: '◆' },
    zones: {
      outskirts: { name: 'Scorched Outskirts', color: '#7a3b1d', need: 'Immer zugänglich' },
      gnaw: { name: "Gnaw's Edge", color: '#5b6b1f', need: 'Ab 20 gesammelten Splittern (gesamt)' },
      shores: { name: 'Hateful Shores', color: '#1f5a6b', need: "Nach einem Sieg mit einem Gnaw's-Edge-Schlachtplan" },
      claw: { name: "Hel's Claw", color: '#8a1414', need: 'Nach einem Sieg mit einem Hateful-Shores-Schlachtplan' },
    },
    zoneOrder: ['outskirts', 'gnaw', 'shores', 'claw'],
    nodes: RC_NODES,
    links: RC_LINKS,
    starts: ['o1', 'o4', 'o7', 'o8'],
    movement: 'adjacent',
    finalBattleplan: "Raid on Hel's Claw",
    // Schlachtplan-Tabellen je Zone: [Würfelergebnis oder Bereich, Schlachtplan]
    tables: {
      outskirts: { name: 'Scorched Outskirts', die: 'W6', rows: [[1, 'Rift in the Peaks'], [2, 'Rise Through the Ashes'], [3, 'Standing on Skulls'], [4, 'Ransack the Encampment'], [5, 'Blood in the Valleys'], [6, 'Light the Fires']] },
      gnaw: { name: "Gnaw's Edge", die: 'W6', rows: [[[1, 3], 'Twisted by Rage'], [[4, 6], 'Storm the Land Bridge']] },
      shores: { name: 'Hateful Shores', die: 'W6', rows: [[[1, 2], 'Beneath the Shadow of Brazenskull'], [[3, 4], 'Assault on the Sea Cave'], [[5, 6], 'Along the Crumbling Coast']] },
      claw: { name: "Hel's Claw", die: '—', rows: [[[1, 6], "Raid on Hel's Claw"]] },
    },
    wahapedia: 'https://wahapedia.ru/aos4/the-rules/ravaged-coast/',
  },
  bw: {
    id: 'bw',
    name: 'Blighted Wilds',
    subtitle: 'Path to Glory · Thyria, Reich des Lebens',
    blurb: 'Verderbnis vergiftet Wasser und Erde in Thyria. Entdeckt Routen durch den Dschungel, reinigt verseuchtes Gelände, braut Tränke und vernichtet die Quelle der Fäulnis.',
    currency: { name: 'Ruhmespunkte', short: 'GP', icon: '✦' },
    zones: { bw: { name: 'Thyrischer Dschungel', color: '#2f5d2a', need: 'Route entdeckt' } },
    zoneOrder: ['bw'],
    nodes: BW_NODES,
    links: BW_LINKS,
    starts: [],
    startUnlocked: ['tb', 'ff'],
    movement: 'unlocked',
    finalBattleplan: 'Be It Purity or Putrescence',
    wahapedia: 'https://wahapedia.ru/aos4/the-rules/blighted-wilds/',
  },
};

export function packOf(id) { return PACKS[id] || PACKS.rc; }

// Anteil (%) des Nahrungsbedarfs, den ein Feld passiv deckt. Lager (noch kein Feld) = 25 %.
export const CAMP_FOOD = 25;
export function foodFactor(packId, key) {
  const n = key ? packOf(packId).nodes.find(x => x.key === key) : null;
  return n && n.food != null ? n.food : CAMP_FOOD;
}

// Welche Felder darf ein Spieler betreten? player: {location_key, shards_total, data:{won:[], unlocked:[]}}
export function allowedTargets(pack, player) {
  const p = packOf(pack);
  const d = player.data || {};
  const here = player.location_key || null;
  if (p.movement === 'unlocked') {
    const unlocked = new Set(d.unlocked && d.unlocked.length ? d.unlocked : p.startUnlocked);
    return p.nodes.filter(n => unlocked.has(n.key)).map(n => n.key);
  }
  // Ravaged Coast: Nachbarfelder + aktuelles Feld, Zonen nach Freischaltung
  const ok = zoneAccess(p, player);
  const res = new Set();
  if (!here) p.starts.forEach(k => res.add(k));
  else {
    res.add(here);
    for (const l of p.links) {
      if (l.from === here) res.add(l.to);
      if (l.to === here) res.add(l.from);
    }
  }
  return [...res].filter(k => ok[p.nodes.find(n => n.key === k).zone]);
}

export function zoneAccess(p, player) {
  const d = player.data || {};
  const won = new Set(d.won_tables || []);
  return {
    outskirts: true,
    gnaw: (player.vault_total || 0) >= 20,
    shores: won.has('gnaw'),
    claw: won.has('shores'),
    bw: true,
  };
}

// Blighted Wilds: nach einer Schlacht neue Routen entdecken
export function discoverRoutes(packId, unlocked, bpKey, wonIt, wonSet) {
  const p = packOf(packId);
  const set = new Set(unlocked && unlocked.length ? unlocked : p.startUnlocked);
  const wins = new Set(wonSet || []);
  if (wonIt) wins.add(bpKey);
  for (const l of p.links) {
    if (l.from !== bpKey) continue;
    if (l.type === 'path') set.add(l.to);
    if (l.type === 'trail' && wins.has(bpKey)) set.add(l.to);
  }
  return [...set];
}

// ---------- Begegnungen & Schlachtpläne (Server und Browser nutzen dieselben Regeln) ----------

// Ravaged Coast: Welche Schlachtplan-Tabelle gilt für eine Begegnung?
// Offizielle Regel: Gnaw's Edge bzw. Hateful Shores, sobald MINDESTENS EIN Spieler sie freigeschaltet hat;
// Hel's Claw nur, wenn BEIDE Spieler dort stehen (also beide in den Hateful Shores gewonnen haben).
// kind: 'pvp' | 'pair' | 'guest'; zoneB ist bei Gastspielen egal.
export function encounterTable(kind, zoneA, zoneB, guestFinal) {
  const order = PACKS.rc.zoneOrder;
  const a = order.includes(zoneA) ? zoneA : 'outskirts';
  if (kind === 'guest') return a === 'claw' && !guestFinal ? 'shores' : a;
  const b = order.includes(zoneB) ? zoneB : a;
  if (a === 'claw' && b === 'claw') return 'claw';
  const hi = order.indexOf(a) >= order.indexOf(b) ? a : b;
  return hi === 'claw' ? 'shores' : hi;
}

// Welche Schlachtpläne dürfen in diesem Spiel gespielt werden?
// match: { kind, table_key, player_b }, dataA/dataB: Spielerdaten (unlocked), options: Kampagnen-Optionen
export function battleplanChoices(packId, match, dataA, dataB, options) {
  const p = packOf(packId);
  const guestFinal = !!(options && options.guest_final);
  if (p.id === 'rc') {
    const t = p.tables[match.table_key] || p.tables.outskirts;
    return t.rows.map(r => r[1]);
  }
  const un = d => new Set(d && d.unlocked && d.unlocked.length ? d.unlocked : p.startUnlocked);
  const ua = un(dataA);
  const ub = match.player_b ? un(dataB) : ua;
  return p.nodes.filter(n => ua.has(n.key) && ub.has(n.key))
    .filter(n => match.player_b || guestFinal || n.name !== p.finalBattleplan)
    .map(n => n.name);
}

// Zählt dieses Spiel als Kampagnen-Finale?
export function isFinal(packId, match, battleplan, options) {
  const p = packOf(packId);
  if (battleplan !== p.finalBattleplan) return false;
  if (!match.player_b && !(options && options.guest_final)) return false;
  return p.id === 'rc' ? match.table_key === 'claw' : true;
}
