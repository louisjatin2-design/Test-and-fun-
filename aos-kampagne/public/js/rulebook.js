// Regelwerk zum Nachschlagen: Kapitel, Pfade, Tabellen – durchsuchbar, mit Links zu den Originaltexten.
import { h, rich, badge, modal } from './ui.js';
import { PACKS, packOf, RANKS } from './packs.js';
import { PATHS, RC, BW, rulebook, wahaLink, battleplanLink, pathLink } from './rules.js';
import { store } from './store.js';

const ext = (href, label) => h('a.ext', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
const sourceLink = (p, ch) => (ch.url ? ext(ch.url, 'Grundregeln auf Wahapedia ↗') : ch.ref ? ext(wahaLink(p.id, ch.ref), 'Originaltext auf Wahapedia ↗') : null);

// Kleiner „Regeln dazu“-Knopf: öffnet das passende Kapitel in einem Fenster, ohne die aktuelle Seite zu verlassen
// (z. B. mitten im Aftermath).
export function ruleLink(chapterId, label = 'Regeln') {
  return h('button.btn.tiny.ghost.rule-link', { type: 'button', title: 'Regeln nachlesen', onClick: () => showRule(chapterId) }, '📖 ' + label);
}
export function showRule(chapterId, packId) {
  const pid = packId || (store.state ? store.state.campaign.pack : 'rc');
  const p = packOf(pid);
  const ch = rulebook(p.id).find(c => c.id === chapterId);
  if (!ch) return;
  const inCampaign = !!store.state && location.hash.startsWith('#/c');
  const mm = modal('📖 ' + ch.title, h('div.rule-modal',
    ch.body.map(t => h('p', rich(t))),
    h('p.small', sourceLink(p, ch), sourceLink(p, ch) ? ' · ' : null, h('a', { href: (inCampaign ? '#/c/regeln/' : '#/regeln/' + p.id + '/') + ch.id, onClick: () => mm.close() }, 'Im Regelwerk öffnen'))), { wide: true });
}

export function renderRulebook(packId, standalone, focusId) {
  const p = packOf(packId);
  const chapters = rulebook(p.id);
  const search = h('input.search', { type: 'search', placeholder: 'Regeln durchsuchen… (z. B. „Narbe“, „Elite“, „Reserve“, „Ward“)', 'aria-label': 'Regeln durchsuchen' });
  const content = h('div.rules-content');
  const toc = h('nav.rules-toc');
  const count = h('p.muted.small.search-count');
  let filterWho = 'all';

  const pathBlock = () => {
    const list = PATHS.filter(x => p.id === 'bw' || x.src === 'rc').filter(x => filterWho === 'all' || (filterWho === 'hero' ? x.who !== 'nonhero' : x.who !== 'hero'));
    return h('div.paths',
      h('div.row.wrap', ['all', 'hero', 'nonhero'].map(w => h('button.btn.tiny' + (filterWho === w ? '' : '.ghost'), { onClick: () => { filterWho = w; draw(); } }, { all: 'Alle', hero: 'Helden', nonhero: 'Nicht-Helden' }[w]))),
      list.map(x => h('details.path-card', { 'data-search': (x.name + ' ' + x.de + ' ' + x.req + ' ' + x.ranks.flat().map(a => a.name + ' ' + a.when + ' ' + a.fx).join(' ')).toLowerCase() },
        h('summary', h('strong', x.de), ' ', h('span.muted', x.name), ' ', badge(x.who === 'hero' ? 'Helden' : x.who === 'nonhero' ? 'Nicht-Helden' : 'alle'), x.req ? badge(x.req) : null, x.src === 'bw' ? badge('Blighted Wilds', 'ok') : null),
        x.ranks.map((pair, i) => h('div.rank-block', h('h5', RANKS[i + 1] + (p.id === 'bw' ? ` (ab ${BW.rankMin[i + 1]} Ruhm)` : ` (${RC.pathCost[i + 1]} Splitter)`)),
          h('div.choice-row', pair.map(a => h('div.choice.static', h('strong', a.name), h('div.tiny.muted', a.when), h('div.small', a.fx)))))),
        h('p.tiny', ext(pathLink(x), 'Originaltext auf Wahapedia ↗')))));
  };

  // kleine Tabellen-Helfer
  const tr = cells => h('tr', cells.map(c => h('td', c)));
  const tbl = rows => h('div.scroll-x', h('table.table.small', h('tbody', rows.map(tr))));
  const named = rows => tbl(rows.map(r => [h('strong', r[0]), r[1]]));

  const tables = () => {
    const sc = p.id === 'bw' ? BW.scars : RC.scars;
    const ench = p.id === 'bw' ? BW.enhancements : RC.enhancements;
    const scarTitles = { serious: 'Ernst (5–8 Wunden)', severe: 'Schwer (9–12)', critical: 'Kritisch (13–17)' };
    const blocks = [];
    if (p.id === 'rc') {
      const planTables = Object.values(RC.tables).map(t => {
        const rows = t.rows.map(r => [Array.isArray(r[0]) ? r[0].join('–') : String(r[0]), h('strong', r[1]), h('span', RC.battleplans[r[1]] || '', ' ', ext(battleplanLink('rc', r[1]), 'Karte ↗'))]);
        return h('div', h('h5', t.name), tbl(rows));
      });
      blocks.push(['Schlachtplan-Tabellen', h('div', planTables)]);
    } else {
      const plans = Object.entries(BW.battleplans).map(([n, b]) => h('div.bp', h('strong', n), ' ', ext(battleplanLink('bw', n), 'Karte ↗'), h('p.small', b.win),
        h('p.small', h('b', 'Fähigkeits-Belohnung: '), b.ability[0] + ' – ' + b.ability[1]), h('p.small', h('b', 'Sonstige Belohnung: '), b.misc)));
      blocks.push(['Schlachtpläne & Belohnungen', h('div', h('p.small.muted', 'Belohnungen gibt es nach einem großen Sieg: Der Sieger wählt eine der beiden, der Gegner erhält die andere.'), plans)]);
    }
    const scarBlocks = ['serious', 'severe', 'critical'].map(k => h('div', h('h5', scarTitles[k]), tbl(sc[k].map(r => [r[0], h('strong', r[1]), r[2]]))));
    blocks.push(['Narben-Tabellen', h('div', scarBlocks)]);
    blocks.push(['Universelle Heldeneigenschaften', named(ench.traits)]);
    blocks.push(['Universelle Artefakte', named(ench.artefacts)]);
    blocks.push(['Zauberlehre', h('div', h('p.tiny.muted', 'In Klammern: Zauberwert (2W6 müssen ihn erreichen).'), named(ench.spells))]);
    blocks.push(['Gebetslehre', h('div', h('p.tiny.muted', 'In Klammern: Gebetswert (angesammelte Ritualpunkte); höhere Ergebnisse haben oft eine stärkere Wirkung.'), named(ench.prayers))]);
    if (p.id === 'rc') {
      const twists = Object.entries(RC.twists).map(([n, rows]) => h('div', h('h5', n), tbl(rows)));
      blocks.push(['Twist-Tabellen', h('div', tbl(RC.twistTable.map(r => [String(r[0]), r[1]])), twists)]);
      const cellText = cell => cell.map(e => e === 'fail' ? 'Fehlschlag' : e === 'rngatk' ? 'Fern +3" / Nah +1 Atk'
        : e.startsWith('ab:') ? e.slice(3) : e.replace('hit', 'Tr ').replace('wnd', 'Vw ').replace('rnd', 'DS ').replace('dmg', 'Sch ').replace('atk', 'Atk ')).join(', ');
      const head = h('thead', h('tr', h('th', '2. \\ 1.'), [1, 2, 3, 4, 5, 6].map(i => h('th', String(i)))));
      const body = h('tbody', RC.forge.table.map((row, r) => h('tr', h('th', String(r + 1)), row.map(cell => h('td', cellText(cell))))));
      blocks.push(['Emberstone-Schmiede', h('div',
        h('p.small', 'Startprofil: Fernkampf 15" · Atk W3+1 · 4+ · 3+ · DS 1 · Sch W3 – Nahkampf: Atk W6+1 · 4+ · 3+ · DS 1 · Sch W3. Zwei Schmiedewürfe (1. W6 = Spalte, 2. W6 = Zeile), danach je 1 Splitter weitere Würfe (Anzahl vorher festlegen). „Tr +1“ verbessert z. B. 4+ auf 3+. Höchstwerte: 30", 2+/2+, DS 4, Sch W3+4 – darüber zählt der Wurf als Fehlschlag.'),
        h('div.scroll-x', h('table.table.small.forge-t', head, body)))]);
      blocks.push(['Ravaged Coast Regiments of Renown', h('ul', RC.regimentsOfRenown.map(r => h('li', h('strong', r.name), ` (${r.alliance}): ${r.fx}`)))]);
    } else {
      const gpRows = [['Schlacht geschlagen', 'fought'], ['Großer Sieg', 'major'], ['Kleiner Sieg', 'minor'], ['General nicht erschlagen', 'generalAlive']]
        .map(([l, k]) => h('tr', h('td', l), BW.gpTable[k].map(v => h('td', String(v)))));
      blocks.push(['Ruhmespunkte-Tabelle', h('div.scroll-x', h('table.table.small', h('thead', h('tr', h('th', 'Armee des Gegners'), BW.gpTable.brackets.map(b => h('th', b)))), h('tbody', gpRows)))]);
      const recipes = tbl(BW.concoctions.map(c => [h('strong', c.name), Object.entries(c.recipe).map(([k, n]) => `${n}× ${k}`).join(', '), c.fx]));
      blocks.push(['Zutaten & Tränke', h('div',
        h('p.small', 'Einfache Zutaten (5 GP/Wurf): 1 nichts · 2 Ironthorn Stamen · 3 Leaping Moss · 4 Bloodweed Nectar · 5 Jaderoot Thistle · 6 beliebige einfache Zutat oder gratis exotisch würfeln.'),
        h('p.small', 'Exotische Zutaten (10 GP/Wurf): 1 beliebige einfache · 2 Fresh Aetherblossom · 3 Whisperwood Bark · 4 Magevine Root · 5 Aqua Ghyranis · 6 beliebige Zutat.'),
        recipes,
        h('p.small', 'Jeder Trank wird einmal pro Schlacht eingesetzt und ist danach verbraucht. Kaufen statt mischen: 30 GP. Beim Einsatz eines gekauften Tranks auf der Nebenwirkungs-Tabelle würfeln:'),
        h('ul.small', BW.sideEffects.map(r => h('li', `${r[0]}: ${r[1]}`))),
        h('p.tiny', ext(wahaLink('bw', 'Ghyranite-Concoctions'), 'Originaltext auf Wahapedia ↗')))]);
      blocks.push(['Landmark & Regiment of Ghyran', h('div',
        h('p.small', 'Landmark of Ghyran (eigenes Fraktionsgelände per Destiny Points): ' + BW.landmarkSizes.map(x => `${x[0]} ${x[1]} DP = ${x[2]} Pkt`).join(' · ') + '.'),
        h('p.small', 'Regiment of Ghyran (eigenes Regiment of Renown, 2–4 Einheiten): ' + BW.regimentSizes.map(x => `${x[0]} ${x[1]} DP = ${x[2]} Pkt`).join(' · ') + '.'),
        h('p.small.muted', 'Die einzelnen Bausteine (Form, Kurator, Archetyp, Reittiere, Eigenarten) stehen im Battlepack. In der App trägst du sie als eigene Einheit bzw. in den Armee-Details ein.'),
        h('p.tiny', ext(wahaLink('bw', 'Landmark-of-Ghyran'), 'Landmark of Ghyran ↗'), ' · ', ext(wahaLink('bw', 'Regiment-of-Ghyran'), 'Regiment of Ghyran ↗')))]);
    }
    return h('div', blocks.map(([t, b]) => h('details.table-card', { 'data-search': t.toLowerCase() + ' ' + b.textContent.toLowerCase() }, h('summary', h('strong', t)), b)));
  };

  const jump = id => { const el = document.getElementById('r-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const secs = chapters.map(ch => {
      const src = sourceLink(p, ch);
      const body = h('div', ch.body.map(t => h('p', rich(t))), ch.paths ? pathBlock() : null, src ? h('p.tiny.src', src) : null);
      return h('section.rule-sec', { id: 'r-' + ch.id }, h('h2', ch.title), body);
    });
    secs.push(h('section.rule-sec', { id: 'r-tabellen' }, h('h2', 'Tabellen & Listen'), tables()));
    content.replaceChildren(...secs);
    toc.replaceChildren(...chapters.map(ch => h('a', { href: '#', onClick: e => { e.preventDefault(); jump(ch.id); } }, ch.title)),
      h('a', { href: '#', onClick: e => { e.preventDefault(); jump('tabellen'); } }, 'Tabellen & Listen'));
    count.textContent = '';
    if (q) {
      let hits = 0;
      content.querySelectorAll('.rule-sec').forEach(sec => {
        const parts = sec.querySelectorAll(':scope > div > p, details');
        let any = false;
        parts.forEach(el => {
          if (el.classList.contains('src')) { el.style.display = 'none'; return; }
          const txt = (el.getAttribute('data-search') || el.textContent).toLowerCase();
          const hit = txt.includes(q);
          if (el.tagName === 'DETAILS') { el.open = hit; el.style.display = hit ? '' : 'none'; } else el.style.display = hit ? '' : 'none';
          if (hit) hits++;
          any = any || hit;
        });
        sec.style.display = any ? '' : 'none';
      });
      count.textContent = hits ? `${hits} Treffer für „${search.value.trim()}“` : `Nichts gefunden für „${search.value.trim()}“. Tipp: englische Fähigkeitsnamen oder ein kürzeres Wort probieren.`;
    }
  };
  search.addEventListener('input', draw);
  draw();
  if (focusId) setTimeout(() => jump(focusId), 60);
  const other = p.id === 'rc' ? PACKS.bw : PACKS.rc;
  return h('div.rules',
    h('div.rules-head',
      h('h1', '📖 Regeln: ' + p.name),
      standalone ? h('div.row', Object.values(PACKS).map(x => h('a.btn.small' + (x.id === p.id ? '' : '.ghost'), { href: '#/regeln/' + x.id }, x.name))) : null,
      h('p.muted.small', 'Kurzfassungen in eigenen Worten, mit dem Battlepack abgeglichen. Den vollständigen Wortlaut findest du hinter den „Originaltext“-Links: ',
        ext(p.wahapedia, p.name + ' auf Wahapedia ↗'), standalone ? null : [' · ', h('a', { href: '#/regeln/' + other.id }, 'Regeln zu ' + other.name)],
        '. Fraktionsregeln stehen in euren Battletomes.'),
      search, count),
    h('div.rules-layout', toc, content));
}
