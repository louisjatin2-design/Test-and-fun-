// Kampagnen-Hülle: Kopfzeile, Tabs, Lage, Rangliste, Verlauf.
import { h, badge, toast, fmtDate, confirmBox } from './ui.js';
import { S, me, pack, playerById, unitsOf, rosterPoints, generalOf, locName, currentMatches, myMatch, sideOf, opponentName, colorOf, api, loadState, store, nextJobRound, unitJob, JOBS, livePoints } from './store.js';
import { jobSelect } from './roster.js';
import { foodFactor } from './packs.js';
import { RANKS } from './packs.js';
import { renderMap } from './map.js';
import { renderRoster, rosterProblems } from './roster.js';
import { renderMatches, renderMatch } from './match.js';
import { renderAftermath } from './aftermath.js';
import { renderRulebook } from './rulebook.js';

const TABS = [['lage', '🏰', 'Lage'], ['karte', '🗺', 'Karte'], ['armee', '🛡', 'Armee'], ['spiele', '⚔', 'Spiele'], ['rangliste', '🏆', 'Rangliste'], ['verlauf', '📜', 'Verlauf'], ['regeln', '📖', 'Regeln']];

export function renderCampaign(tab, rest, nav) {
  const st = S(), c = st.campaign, p = pack(), mine = me();
  const head = h('header.topbar.camp',
    h('a.brand', { href: '#/' }, h('span.brand-icon', '⚔')),
    h('div.camp-title',
      h('div.camp-name', c.name),
      h('div.camp-sub', `${p.name} · ${c.current_round ? 'Runde ' + c.current_round + ' · ' : ''}${nav.phaseLabel(c.phase)}`)),
    h('div.topbar-right',
      mine ? h('span.vault', { title: p.currency.name }, `${p.currency.icon} ${mine.vault} ${p.currency.short}`) : null,
      mine ? h('span.vault.food', { title: 'Nahrung' }, `🍖 ${mine.data.food ?? S().campaign.points_limit}`) : null,
      mine && p.id === 'rc' ? h('span.vault.gold', { title: 'Gold' }, `🪙 ${mine.data.gold || 0}`) : null,
      st.me.admin && store.adminCid ? h('a.btn.small', { href: '#/master', onClick: () => { store.adminCid = null; } }, '👑') : null,
      mine ? h('button.btn.ghost.small', { onClick: nav.logout, title: 'Abmelden' }, '⎋') : null));
  const tabs = h('nav.tabs', TABS.map(([id, icon, label]) => h('a.tab' + (id === tab || (tab === 'spiel' && id === 'spiele') || (tab === 'aftermath' && id === 'spiele') ? '.active' : ''), { href: '#/c/' + id }, h('span.tab-icon', icon), h('span.tab-label', label))));
  let body;
  switch (tab) {
    case 'karte': body = renderMap(); break;
    case 'armee': body = renderRoster(rest[0]); break;
    case 'spiele': body = renderMatches(); break;
    case 'spiel': body = renderMatch(rest[0]); break;
    case 'aftermath': body = renderAftermath(rest[0]); break;
    case 'rangliste': body = renderRanking(); break;
    case 'verlauf': body = renderLog(); break;
    case 'regeln': body = renderRulebook(c.pack, false); break;
    default: body = renderLage(nav);
  }
  return h('div.camp-shell', head, tabs, h('main.page', body));
}

function renderLage(nav) {
  const st = S(), c = st.campaign, p = pack(), mine = me();
  const cards = [];
  if (st.me.admin && !mine) cards.push(h('div.card.info', h('strong', '👑 Master-Ansicht'), ' – du siehst diese Kampagne als Master. Spielerdaten änderst du im Master-Bereich oder über „Armee“.'));
  if (c.phase === 'finished') {
    const w = playerById(c.winner_player_id);
    cards.push(h('div.card.victory', h('div.trophy', '🏆'), h('h2', w ? `${w.name} hat die Kampagne gewonnen!` : 'Die Kampagne ist beendet.'),
      h('p', c.pack === 'bw' ? 'Die Quelle der Verderbnis ist vernichtet. Thyria atmet auf – vorerst.' : "Der Emberstone-Hort von Hel's Claw ist gesichert.")));
  }
  if (c.phase === 'lobby') {
    const all = st.players;
    const ready = all.filter(x => x.roster_locked).length;
    cards.push(h('div.card.highlight',
      h('h2', 'Aufstellung'),
      h('p', 'Baut jetzt eure Path-to-Glory-Roster. Wenn alle ihr Roster abgeschlossen haben, kann jeder die Kampagne starten.'),
      mine ? (mine.roster_locked
        ? h('p', badge('Dein Roster ist abgeschlossen', 'ok'))
        : h('div', h('p', `Dein Roster: ${rosterPoints(mine.id)} / ${c.points_limit} Punkte · ${rosterProblems(mine.id).length ? '⚠ noch nicht vollständig' : '✓ bereit'}`),
          h('a.btn', { href: '#/c/armee' }, 'Roster bearbeiten →'))) : null,
      h('ul.ready-list', all.map(x => h('li', h('span.dot', { style: { background: colorOf(x.id) } }), `${x.name} (${x.faction || '?'}) `, x.roster_locked ? badge('bereit', 'ok') : badge('baut…')))),
      h('p.muted.small', `${ready} von ${all.length} bereit · Plätze: ${all.length}/${c.slots}. Einladungslink: ${location.origin}/#/k/${c.invite_code}`),
      h('button.btn.big', { disabled: ready < 2 || ready < all.length, onClick: async () => {
        if (all.length < c.slots && !(await confirmBox(`Erst ${all.length} von ${c.slots} Plätzen belegt. Trotzdem starten?`, 'Starten'))) return;
        await api('start', {}); toast('Die Kampagne beginnt!', 'ok'); await loadState(true); nav.go('#/c/karte');
      } }, '▶ Kampagne starten')));
  }
  if (c.phase === 'move') {
    const moved = st.players.filter(x => x.moved).length;
    cards.push(h('div.card.highlight',
      h('h2', `Runde ${c.current_round}: Wählt euer Ziel`),
      h('p', 'Jeder wählt geheim ein Feld auf der Karte. Sobald alle gezogen haben, deckt die App die Züge auf und erzeugt die Begegnungen.'),
      mine ? (mine.pending_move
        ? h('p', badge('Zug gewählt: ' + locName(mine.pending_move), 'ok'), ' – du kannst ihn bis zum Aufdecken noch ändern.')
        : h('a.btn.big', { href: '#/c/karte' }, 'Zur Karte – Ziel wählen →')) : null,
      h('ul.ready-list', st.players.map(x => h('li', h('span.dot', { style: { background: colorOf(x.id) } }), x.name + ' ', x.moved ? badge('hat gezogen', 'ok') : badge('überlegt…')))),
      h('p.muted.small', `${moved} von ${st.players.length} haben gezogen.`)));
  }
  if (c.phase === 'battle') {
    const m = myMatch();
    if (m) {
      const side = sideOf(m, mine.id);
      const done = side === 'a' ? m.done_a : m.done_b;
      cards.push(h('div.card.highlight',
        h('h2', `Deine Begegnung in Runde ${c.current_round}`),
        h('p.big', `Gegen ${opponentName(m, side)} · ${m.battleplan || 'Schlachtplan noch offen'}`),
        h('p.muted', m.kind === 'pvp' ? `Ihr trefft auf ${locName(m.location_a)} aufeinander.` : m.kind === 'pair' ? 'Ihr standet beide allein und werdet gegeneinander gepaart.' : 'Du stehst allein – du spielst gegen einen Gastspieler (eine außenstehende Person).'),
        m.status !== 'done' ? h('a.btn.big', { href: '#/c/spiel/' + m.id }, 'Zum Spiel: Aufstellung & Ergebnis →')
          : done ? h('p', badge('Aftermath erledigt', 'ok'), ' – warte auf die anderen.')
            : h('a.btn.big', { href: '#/c/aftermath/' + m.id }, 'Aftermath starten →')));
    }
    cards.push(h('div.card', h('h3', 'Alle Begegnungen dieser Runde'), matchList(currentMatches())));
  }
  if (mine && c.phase !== 'finished') {
    const nr = nextJobRound(mine.id);
    const us = unitsOf(mine.id);
    if (nr != null && us.length) {
      const factor = foodFactor(c.pack, mine.pending_move || mine.location_key);
      const need = us.reduce((a, u) => a + Math.round(livePoints(u) * (100 - factor) / 100), 0);
      cards.push(h('div.card',
        h('h3', `Aufträge für Runde ${nr}`),
        h('p.small', 'Zu Beginn des Zuges kannst du Einheiten losschicken. Alles außer „Kämpfen“ verpasst die Schlacht dieser Runde: 😴 Erholen (max. 1, heilt W6 Kampfwunden, dauerhaft tote Modelle gegen Bezahlung zurückholen) · ⛏ Schürfen (' + (c.pack === 'rc' ? 'W3 Splitter' : 'W6×10 GP') + ') · 🌾 Nahrung sammeln (Punktwert × W6 × 20 %, bei 1 eine Kampfwunde).'),
        h('ul.job-list', us.map(u => h('li', h('span', u.is_general ? '👑 ' : '', u.name, h('span.muted.small', ` ${livePoints(u)} Pkt`), u.data.hungry ? ' 🍖' : ''), jobSelect(u)))),
        h('p.muted.small', `🍖 Vorrat ${mine.data.food ?? S().campaign.points_limit} · voraussichtlicher Bedarf nach dieser Runde ca. ${need} (Feld deckt ${factor} %).`)));
    }
  }
  cards.push(h('div.card', h('h3', 'Stand'), rankingTable(true)));
  return h('div.stack', cards);
}

export function matchList(ms) {
  if (!ms.length) return h('p.muted', 'Keine Spiele.');
  return h('div.match-list', ms.map(m => {
    const a = playerById(m.player_a), b = m.player_b ? playerById(m.player_b) : null;
    const res = m.result === 'a' || m.result === 'a_minor' ? (a && a.name) : m.result === 'b' || m.result === 'b_minor' ? (b ? b.name : m.guest_name) : m.result === 'draw' ? 'Unentschieden' : null;
    return h('a.match-row', { href: '#/c/spiel/' + m.id },
      h('span.dot', { style: { background: a ? colorOf(a.id) : '#777' } }), h('strong', a ? a.name : '?'), ' vs ',
      b ? h('span.dot', { style: { background: colorOf(b.id) } }) : null, h('strong', b ? b.name : (m.guest_name || 'Gastspieler')),
      h('span.muted', ' · ' + (m.battleplan || 'Schlachtplan offen')),
      h('span.grow'),
      m.status === 'done' ? badge(res ? (res === 'Unentschieden' ? res : 'Sieg: ' + res) : 'erledigt', 'ok') : badge('offen'),
      m.status === 'done' ? badge(`Aftermath ${(m.done_a ? 1 : 0) + (m.player_b && m.done_b ? 1 : 0)}/${m.player_b ? 2 : 1}`) : null);
  }));
}

function rankingTable(compact) {
  const st = S(), p = pack();
  const owned = pid => st.locations.filter(l => l.owner_player_id === pid).length;
  const rows = [...st.players].sort((x, y) => (y.data.trophy ? 1 : 0) - (x.data.trophy ? 1 : 0) || y.wins - x.wins || y.draws - x.draws || y.vault_total - x.vault_total);
  return h('table.table.rank',
    h('thead', h('tr', h('th', '#'), h('th', 'Spieler'), compact ? null : h('th', 'Fraktion'), h('th', 'S/U/N'), h('th', p.currency.short + ' ges.'), compact ? null : h('th', 'Felder'), compact ? null : h('th', 'Punkte'), compact ? null : h('th', 'General'), h('th', 'Position'))),
    h('tbody', rows.map((x, i) => {
      const g = generalOf(x.id);
      return h('tr' + (x.id === st.me.player_id ? '.me' : ''),
        h('td', x.data.trophy ? '🏆' : i + 1),
        h('td', h('span.dot', { style: { background: colorOf(x.id) } }), x.name),
        compact ? null : h('td', x.faction || '–'),
        h('td', `${x.wins}/${x.draws}/${x.losses}`),
        h('td', x.vault_total),
        compact ? null : h('td', owned(x.id)),
        compact ? null : h('td', rosterPoints(x.id)),
        compact ? null : h('td', g ? `${g.name} (${RANKS[g.rank] || '—'})` : '–'),
        h('td', locName(x.location_key)));
    })));
}

function renderRanking() {
  const st = S();
  const done = st.matches.filter(m => m.status === 'done' && m.result !== 'void');
  return h('div.stack',
    h('div.card', h('h2', '🏆 Rangliste'), rankingTable(false),
      h('p.muted.small', 'Sortiert nach Trophäe, Siegen, Unentschieden und insgesamt gesammelter Währung. Die Kampagne gewinnt, wer das Finale mit einem großen Sieg beendet.')),
    h('div.card', h('h3', 'Alle Spiele'), matchList(done.concat(st.matches.filter(m => m.status !== 'done')))));
}

function renderLog() {
  const ev = S().events;
  const byRound = {};
  ev.forEach(e => (byRound[e.round ?? 0] = byRound[e.round ?? 0] || []).push(e));
  const icons = { move: '👣', moved: '🤫', match: '⚔', result: '🏁', roster: '🛡', aftermath: '✅', round: '🔔', dice: '🎲', join: '👋', kick: '🚪', victory: '🏆', campaign: '📜' };
  return h('div.stack', h('h2', '📜 Spielverlauf'),
    Object.keys(byRound).sort((a, b) => b - a).map(r => h('div.card',
      h('h3', Number(r) ? 'Runde ' + r : 'Vorbereitung'),
      h('ul.log', byRound[r].map(e => h('li', h('span.log-icon', icons[e.kind] || '•'), h('span.log-text', e.text.replace(/^🎲\s*/, '')), h('span.log-time', fmtDate(e.created_at))))))));
}
