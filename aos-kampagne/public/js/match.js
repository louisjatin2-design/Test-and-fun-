// Spiele: Liste, Spielvorbereitung (Schlachtplan, Feld/Reserve), Ergebnis.
import { h, toast, badge, select, field, diceInput, confirmBox } from './ui.js';
import { S, me, pack, playerById, unitsOf, generalOf, colorOf, locName, api, loadState, sideOf, unitStatus, plays, livePoints, fullModels, aliveModels, armyPoints, JOBS } from './store.js';
import { RC, BW, rollOnRange } from './rules.js';
import { RANKS, battleplanChoices, isFinal } from './packs.js';
import { matchList } from './campaign.js';
import { ruleLink } from './rulebook.js';

export function renderMatches() {
  const st = S();
  const rounds = [...new Set(st.matches.map(m => m.round))].sort((a, b) => b - a);
  if (!rounds.length) return h('div.card', h('h2', '⚔ Spiele'), h('p.muted', 'Noch keine Begegnungen. Sie entstehen automatisch, sobald alle gezogen haben.'));
  return h('div.stack', h('h2', '⚔ Spiele'), rounds.map(r => h('div.card', h('h3', 'Runde ' + r), matchList(st.matches.filter(m => m.round === r)))));
}

const nameA = m => playerById(m.player_a)?.name || '(entfernt)';
const nameB = m => m.player_b ? (playerById(m.player_b)?.name || '(entfernt)') : (m.guest_name || 'Gastspieler');
const redraw = () => window.__redraw && window.__redraw();
const correcting = new Set(); // Spiele, deren Ergebnis gerade korrigiert wird

// Schlachtpläne, die in dieser Begegnung erlaubt sind (dieselbe Regel prüft auch der Server)
function choicesFor(m) {
  const a = playerById(m.player_a), b = m.player_b ? playerById(m.player_b) : null;
  return battleplanChoices(S().campaign.pack, m, a ? a.data : {}, b ? b.data : null, S().campaign.options);
}

export function renderMatch(id) {
  const st = S(), p = pack(), c = st.campaign;
  const m = st.matches.find(x => x.id === id);
  if (!m) return h('p.muted', 'Spiel nicht gefunden.');
  const mine = me();
  const mySide = mine ? sideOf(m, mine.id) : null;
  const canEdit = !!mySide || !!st.me.admin;
  const done = m.status === 'done';
  const voided = m.result === 'void';
  const editable = canEdit && !done;
  const rep = JSON.parse(JSON.stringify(m.report || {}));
  rep.units = rep.units || {};
  // Es wird immer nur die Änderung geschickt – so überschreiben sich zwei Geräte nicht gegenseitig.
  const save = async (patch = {}, { battleplan, log } = {}) => {
    await api('match/' + m.id, { op: 'setup', report: patch, battleplan, log });
    await loadState(true);
  };
  const pA = playerById(m.player_a), pB = m.player_b ? playerById(m.player_b) : null;
  const ga = generalOf(m.player_a), gb = m.player_b ? generalOf(m.player_b) : null;
  const rankA = ga ? ga.rank : 0, rankB = gb ? gb.rank : 0;
  const picker = !m.player_b ? nameA(m) : rankA < rankB ? nameA(m) : rankB < rankA ? nameB(m) : null;
  const pickerText = picker ? `${picker} (niedrigster General-Rang)` : 'Beide Generäle haben denselben Rang – würfelt, wer gewinnt';
  const choices = choicesFor(m);
  const bpName = m.battleplan;
  const final = isFinal(c.pack, m, bpName || (choices.length === 1 ? choices[0] : null), c.options);

  // ----- Kopf
  const head = h('div.card.match-head',
    h('div.versus',
      h('div.side', h('span.dot.big', { style: { background: colorOf(m.player_a) } }), h('strong', nameA(m)), h('div.muted.small', `${pA?.faction || ''} · General: ${ga ? ga.name + ' (' + RANKS[ga.rank] + ')' : '–'}`)),
      h('div.vs', 'VS'),
      h('div.side', m.player_b ? h('span.dot.big', { style: { background: colorOf(m.player_b) } }) : h('span.dot.big'), h('strong', nameB(m)),
        h('div.muted.small', m.player_b ? `${pB?.faction || ''} · General: ${gb ? gb.name + ' (' + RANKS[gb.rank] + ')' : '–'}` : 'außenstehende Person'))),
    h('p.center.muted', `Runde ${m.round} · ${m.kind === 'pvp' ? 'Begegnung auf ' + locName(m.location_a) : m.kind === 'pair' ? `Paarung: ${locName(m.location_a)} / ${locName(m.location_b)}` : 'Gastspiel auf ' + locName(m.location_a)}`),
    final && !voided ? h('p.center', badge('🏆 Finale – ein großer Sieg gewinnt die Kampagne!', 'gold')) : null,
    done ? h('p.center', badge(resultText(m), voided ? 'warn' : 'ok')) : null);
  if (voided) return h('div.stack', h('a.back', { href: '#/c/spiele' }, '← Alle Spiele'), head, h('div.card', h('p.muted', 'Dieses Spiel wurde vom Master annulliert und zählt nicht.')));

  // ----- Schlachtplan
  const bpBox = h('div.card');
  const add = (...xs) => bpBox.append(...xs.flat(Infinity).filter(x => x != null && x !== false));
  const pickPlan = async v => { if (!v) return; await save({}, { battleplan: v, log: `wählt den Schlachtplan ${v}.` }); redraw(); };
  if (p.id === 'rc') {
    const t = RC.tables[m.table_key] || RC.tables.outskirts;
    const rows = h('table.table.small', h('tbody', t.rows.map(r => h('tr' + (r[1] === bpName ? '.me' : ''), h('td', Array.isArray(r[0]) ? `${r[0][0]}–${r[0][1]}` : r[0]), h('td', r[1])))));
    const zoneA = st.locations.find(l => l.key === m.location_a)?.zone, zoneB = st.locations.find(l => l.key === m.location_b)?.zone;
    const nearFinal = m.table_key !== 'claw' && (zoneA === 'claw' || zoneB === 'claw');
    // Seitenwahl & Underdog-Gleichstand: wer in der Kampagne weniger Splitter gesammelt hat
    const ta = pA ? pA.vault_total : 0, tb = pB ? pB.vault_total : null;
    const fewer = tb == null ? null : ta < tb ? nameA(m) : tb < ta ? nameB(m) : null;
    add(h('div.row.between', h('h3', 'Schlachtplan'), ruleLink('schlacht', 'Vor der Schlacht')),
      h('p', `Tabelle: `, h('strong', t.name), m.table_key === 'claw' ? ' · das Finale steht fest.' : ` · Es würfelt: ${pickerText}. Ihr dürft euch auch auf einen Plan dieser Tabelle einigen.`),
      nearFinal ? h('p.small.muted', "Hel's Claw wird erst gespielt, wenn beide Spieler dort stehen (beide brauchen einen Sieg mit einem Hateful-Shores-Schlachtplan). Bis dahin gilt die Hateful-Shores-Tabelle.") : null,
      rows,
      editable && m.table_key !== 'claw' ? h('div.row.wrap',
        diceInput('D6', async (v, viaApp) => {
          const r = rollOnRange(t.rows, v);
          await save({ bp_roll: v }, { battleplan: r[1], log: `würfelt den Schlachtplan (${t.name}): ${v} → ${r[1]}${viaApp ? ' (App-Würfel)' : ' (eingetragen)'}` });
          redraw();
        }, { label: 'Würfeln:', value: bpName && rep.bp_roll ? rep.bp_roll : null, locked: true }),
        h('span.muted', 'oder einigen:'),
        select([['', '– wählen –'], ...choices], bpName || '', pickPlan)) : null,
      bpName ? h('div.bp', h('strong', bpName), h('p', RC.battleplans[bpName] || '')) : h('p.muted', 'Noch kein Schlachtplan festgelegt.'),
      tb != null ? h('p.small', h('b', 'Seitenwahl: '), fewer ? `${fewer} hat bisher weniger Splitter gesammelt und verteilt die Gebiete bzw. Rollen.` : 'Gleich viele Splitter gesammelt – würfelt, wer die Gebiete bzw. Rollen verteilt.') : null,
      h('h4', 'Twist'),
      rep.twist ? h('p', h('strong', rep.twist)) : rep.twist_roll === 1 ? h('p', 'Kein Twist in dieser Schlacht.') : h('p.muted', 'Noch nicht ausgewürfelt.'),
      rep.twist && RC.twists[rep.twist] ? h('table.table.small', h('tbody', RC.twists[rep.twist].map(r => h('tr', h('td', r[0]), h('td', r[1]))))) : null,
      editable ? diceInput('D6', async (v, viaApp) => {
        const r = rollOnRange(RC.twistTable, v);
        if (v === 6) toast(picker ? `6: ${picker} wählt die Twist-Tabelle.` : '6: Gleicher General-Rang – noch einmal würfeln.', 'info');
        await save({ twist_roll: v, twist: v === 1 || v === 6 ? null : r[1] }, { log: `würfelt auf der Twist-Tabelle: ${v} → ${r[1]}${viaApp ? ' (App-Würfel)' : ' (eingetragen)'}` }); redraw();
      }, { label: 'Twist-Tabelle:', value: rep.twist_roll && !(rep.twist_roll === 6 && !picker && !rep.twist) ? rep.twist_roll : null, locked: true }) : null,
      editable && rep.twist_roll === 6 && picker ? select([['', '– Twist-Tabelle wählen –'], ...Object.keys(RC.twists)], rep.twist || '', async v => { await save({ twist: v || null }, { log: v ? `wählt die Twist-Tabelle ${v}.` : null }); redraw(); }) : null,
      h('p.tiny.muted', 'Underdog = wer weniger Siegpunkte hat. Bei Gleichstand: Wer als Zweiter dran war und jetzt zuerst ziehen will, macht den Gegner zum Underdog' + (tb != null ? (fewer ? ` – sonst ${fewer} (weniger Splitter gesammelt).` : ' – sonst gibt es keinen Underdog: würfelt, wer auf der Twist-Tabelle würfeln darf.') : '.')),
      h('details.helpbox', h('summary', 'Checkliste vor der Schlacht'), h('ol.small',
        h('li', 'Schlachtfeld aufbauen (mind. 8 Geländestücke), Ziele laut Schlachtplan.'),
        h('li', `Emberstone-Cluster: ${m.table_key === 'shores' ? 'W6' : 'W3+1'} Stück, abwechselnd aufstellen – es beginnt der Spieler mit dem niedrigsten General-Rang.`),
        h('li', 'Gebiete verteilen (siehe Seitenwahl), dann aufstellen.'),
        h('li', 'Ungleiche Armeen? Die Übermacht stellt Einheiten in Reserve (siehe Feld-Übersicht).'),
        h('li', 'Twist-Tabelle auswürfeln. In jeder Schlachtrunde würfelt der Underdog auf dieser Tabelle.'))));
  } else {
    const info = BW.battleplans[bpName];
    add(h('div.row.between', h('h3', 'Schlachtplan'), ruleLink('schlacht', 'Vor der Schlacht')),
      h('p', `Es wählt: ${pickerText} – aus den Schlachtplänen, die ihr beide freigeschaltet habt.`),
      !m.player_b && !(c.options && c.options.guest_final) ? h('p.small.muted', 'Gegen einen Gastspieler steht das Finale nicht zur Wahl.') : null,
      editable ? (choices.length ? select([['', '– Schlachtplan wählen –'], ...choices], bpName || '', pickPlan) : h('p.problems', 'Ihr habt keinen gemeinsamen Schlachtplan freigeschaltet.')) : null,
      bpName ? h('div.bp', h('strong', bpName), info ? h('div', h('p', info.win),
        h('p.small', h('b', 'Fähigkeits-Belohnung: '), info.ability[0], ' – ', info.ability[1]),
        h('p.small', h('b', 'Sonstige Belohnung: '), info.misc)) : null) : h('p.muted', 'Noch kein Schlachtplan festgelegt.'),
      // Belohnungen aus der letzten Schlacht, die in dieser Schlacht gelten
      [pA, pB].filter(x => x && x.data.next_ability).map(x => h('p.small', badge('Belohnung', 'gold'), ' ', h('b', x.name + ': '), x.data.next_ability)),
      h('details.helpbox', h('summary', 'Checkliste vor der Schlacht'), h('ol.small',
        h('li', 'Schlachtfeld aufbauen (mind. 8 Geländestücke), Ziele laut Schlachtplan, Gebiete bestimmen.'),
        h('li', 'Verseuchung: Abwechselnd (niedrigster General-Rang zuerst) je ein Gelände außerhalb des eigenen Gebiets verseuchen; danach jedes übrige Gelände auf 4+. Fraktionsgelände und Landmarks bleiben sauber.'),
        h('li', 'Ruhende Einheit: Jeder darf 1 Einheit ruhen lassen (Auftrag „😴 Erholen“).'),
        h('li', 'Ungleiche Armeen? Die Übermacht stellt Einheiten in Reserve (siehe Feld-Übersicht).'),
        h('li', 'In jedem Zug: „Blighted Waters“ nicht vergessen. Am Zugende: „Purify the Land“.'))));
  }
  add(h('p.tiny', h('a', { href: p.wahapedia + '#Battleplans', target: '_blank', rel: 'noopener noreferrer' }, 'Vollständige Schlachtplan-Karten auf Wahapedia ↗')));

  // ----- Feld-Übersicht
  const sides = [['a', m.player_a], ['b', m.player_b]];
  const sum = (pid, st2) => unitsOf(pid).filter(u => unitStatus(m, u, rep) === st2).reduce((a, u) => a + livePoints(u), 0);
  const away = pid => unitsOf(pid).filter(u => !plays(unitStatus(m, u, rep))).reduce((a, u) => a + livePoints(u), 0);
  const pa = armyPoints(m, 'a', rep), pb = armyPoints(m, 'b', rep);
  const thr = p.id === 'bw' ? 100 : 200;
  const diff = Math.abs(pa - pb);
  const guestUnknown = !m.player_b && !rep.guest_points;
  const overSide = !guestUnknown && diff >= thr ? (pa > pb ? 'a' : 'b') : null;
  const surplus = overSide ? diff - thr : 0;
  const overPid = overSide === 'a' ? m.player_a : overSide === 'b' ? m.player_b : null;
  const reserveOk = !overPid || sum(overPid, 'reserve') >= surplus;
  const fieldCols = sides.map(([side, pid]) => {
    if (!pid) {
      const gp = h('input', { type: 'number', min: 0, value: rep.guest_points || '', placeholder: 'z. B. 1000', disabled: !editable });
      gp.addEventListener('change', async () => { await save({ guest_points: Number(gp.value) || 0 }); redraw(); });
      return h('div.field-col', h('h4', nameB(m)), field('Punkte der Gastarmee', gp, 'Für die Übermacht und ' + (p.id === 'bw' ? 'deine Ruhmespunkte.' : 'dein Gold.')));
    }
    const us = unitsOf(pid);
    return h('div.field-col',
      h('h4', h('span.dot', { style: { background: colorOf(pid) } }), playerById(pid)?.name),
      h('div.pts-row', badge(`Feld ${sum(pid, 'field')}`, 'ok'), badge(`Reserve ${sum(pid, 'reserve')}`), done ? null : badge(`Aufträge/abwesend ${away(pid)}`), badge(`Armee ${armyPoints(m, side, rep)}`, 'gold')),
      h('ul.field-units', us.map(u => {
        const cur = unitStatus(m, u, rep);
        if (done && cur === 'absent') return null; // erst nach der Schlacht dazugekommen
        const opts = [['field', 'Feld'], ['reserve', 'Reserve']];
        const models = fullModels(u) > 1 ? ` · ${aliveModels(u)}/${fullModels(u)} Mod.` : '';
        const lockBadge = cur === 'out' ? badge('keine Modelle mehr', 'warn') : JOBS[cur] ? badge(`${JOBS[cur].icon} ${JOBS[cur].label} – gesperrt`, 'warn') : null;
        return h('li', h('span', u.is_general ? '👑 ' : u.is_hero ? '★ ' : '', u.name, h('span.muted.small', ` ${livePoints(u)}${models}`), u.data.hungry ? ' 🍖' : ''),
          lockBadge || (editable ? select(opts, cur, async v => { await save({ units: { [u.id]: { status: v } } }); redraw(); }) : badge((opts.find(o => o[0] === cur) || opts[0])[1])));
      })));
  });
  const fieldBox = h('div.card',
    h('h3', 'Feld-Übersicht'),
    h('p', `Armeepunkte: ${nameA(m)} ${pa} · ${nameB(m)} ${guestUnknown ? '?' : pb}. `,
      guestUnknown ? 'Trage die Punkte der Gastarmee ein, damit die App die Übermacht berechnen kann.'
        : overSide ? h('span', h('strong', `${overSide === 'a' ? nameA(m) : nameB(m)} hat eine Übermacht`), ` (Differenz ${diff} − ${thr} = `, h('strong', surplus + ' Punkte'), ' müssen als „Stalled Reinforcements“ in Reserve). ', done || !overPid ? null : reserveOk ? badge('erfüllt', 'ok') : badge('noch zu wenig in Reserve', 'warn'))
          : `Keine Übermacht (Schwelle ${thr} Punkte).`),
    h('div.field-grid', fieldCols),
    h('p.tiny.muted', 'Einheiten mit Auftrag (Erholen, Schürfen, Nahrung sammeln) sind in dieser Schlacht gesperrt und zählen nicht zu den Armeepunkten. Armeepunkte zählen nur lebende Modelle. 🍖 = hungert.',
      p.id === 'bw' ? ' Reserve kommt ab Schlachtrunde 2 auf 4+ (−1 für Helden/verstärkte Einheiten, −1 für Monster).' : ' Reserve kommt in deiner Bewegungsphase auf 4+.'));

  // ----- Ergebnis
  let resultBox;
  const untouched = !Object.keys(m.aftermath_a || {}).length && !Object.keys(m.aftermath_b || {}).length && !m.done_a && !m.done_b;
  const canCorrect = done && (st.me.admin || (mySide && untouched && m.round === c.current_round));
  if (done && !correcting.has(m.id)) {
    resultBox = h('div.card',
      h('h3', 'Ergebnis'), h('p.big', resultText(m)), m.vp_a != null && m.vp_b != null ? h('p', `Siegpunkte: ${m.vp_a} : ${m.vp_b}`) : null,
      h('div.row.wrap',
        ...['a', 'b'].filter(sd => sd === 'a' || m.player_b).map(sd => {
          const isDone = sd === 'a' ? m.done_a : m.done_b;
          const pidS = sd === 'a' ? m.player_a : m.player_b;
          const allowed = (st.me.admin || mySide === sd) && playerById(pidS);
          return h('div.aft-chip', h('span.dot', { style: { background: colorOf(pidS) } }), (playerById(pidS)?.name || '(entfernt)') + ': ', isDone ? badge('Aftermath erledigt', 'ok') : badge('Aftermath offen'),
            allowed ? h('a.btn.small', { href: `#/c/aftermath/${m.id}${st.me.admin && mySide !== sd ? '?side=' + sd : ''}` }, isDone ? 'ansehen' : 'Aftermath starten →') : null);
        })),
      canCorrect ? h('p', h('button.btn.small.ghost', { onClick: () => { correcting.add(m.id); redraw(); } }, '✎ Ergebnis korrigieren'),
        h('span.tiny.muted', st.me.admin && !untouched ? ' Achtung: Bereits verbuchte Aftermath-Belohnungen ändern sich dadurch nicht – bei Bedarf Vorräte von Hand anpassen (Armee → Master-Werkzeuge).' : ' Vertippt? Solange noch niemand mit dem Aftermath begonnen hat, lässt sich das Ergebnis ändern.')) : null);
  } else if (canEdit && (!done || canCorrect)) resultBox = resultForm(m, rep, nameA(m), nameB(m), done);
  else resultBox = h('div.card', h('p.muted', 'Das Ergebnis tragen die Beteiligten ein.'));
  return h('div.stack', h('a.back', { href: '#/c/spiele' }, '← Alle Spiele'), head, bpBox, fieldBox, resultBox);
}

export function resultText(m) {
  const map = { a: `Großer Sieg: ${nameA(m)}`, a_minor: `Kleiner Sieg: ${nameA(m)}`, b: `Großer Sieg: ${nameB(m)}`, b_minor: `Kleiner Sieg: ${nameB(m)}`, draw: 'Unentschieden', void: 'Annulliert' };
  return map[m.result] || 'offen';
}

function resultForm(m, rep, na, nb, isCorrection) {
  const p = pack();
  let result = isCorrection ? m.result : null;
  const opts = [['a', `Großer Sieg ${na}`], ...(p.id === 'bw' ? [['a_minor', `Kleiner Sieg ${na}`]] : []), ['draw', 'Unentschieden'], ...(p.id === 'bw' ? [['b_minor', `Kleiner Sieg ${nb}`]] : []), ['b', `Großer Sieg ${nb}`]];
  const radios = h('div.result-opts', opts.map(([v, l]) => h('label.choice', h('input', { type: 'radio', name: 'res', checked: result === v, onChange: () => { result = v; } }), l)));
  const vpa = h('input', { type: 'number', min: 0, placeholder: na, value: isCorrection && m.vp_a != null ? m.vp_a : '' });
  const vpb = h('input', { type: 'number', min: 0, placeholder: nb, value: isCorrection && m.vp_b != null ? m.vp_b : '' });
  const work = {}; // Eingaben je Einheit
  const unitRows = [m.player_a, m.player_b].filter(Boolean).map(pid => h('div.field-col',
    h('h4', h('span.dot', { style: { background: colorOf(pid) } }), playerById(pid)?.name),
    h('div.scroll-x', h('table.table.small',
      h('thead', h('tr', h('th', 'Einheit'), h('th', 'vernichtet'), h('th', 'Modelle verloren'), p.id === 'rc' ? h('th', 'Emberstone-Marke') : h('th', 'in 3" verseucht'), p.id === 'bw' ? h('th', 'Purify ✓') : null, h('th', 'nie eingesetzt'))),
      h('tbody', unitsOf(pid).filter(u => plays(unitStatus(m, u, rep))).map(u => {
        const prev = rep.units[u.id] || {};
        const r = work[u.id] = { destroyed: !!prev.destroyed, lost: prev.lost || 0, token: !!prev.token, contaminated: !!prev.contaminated, purify: prev.purify || 0, untimely: !!prev.untimely };
        const cb = key => h('input', { type: 'checkbox', checked: !!r[key], 'aria-label': key, onChange: e => { r[key] = e.target.checked; } });
        const num = h('input.tiny-in', { type: 'number', min: 0, max: 9, value: r.purify, onChange: e => { r.purify = Math.min(9, Math.max(0, Number(e.target.value) || 0)); } });
        const alive = isCorrection && prev.alive_at_battle != null ? prev.alive_at_battle : aliveModels(u);
        const lost = alive > 1 ? h('input.tiny-in', { type: 'number', min: 0, max: alive, value: r.lost, title: `von ${alive}`, onChange: e => { r.lost = Math.min(alive, Math.max(0, Number(e.target.value) || 0)); e.target.value = r.lost; } }) : '–';
        return h('tr', h('td', u.name, alive > 1 ? h('span.tiny.muted', ` (${alive})`) : null), h('td', cb('destroyed')), h('td', lost), h('td', p.id === 'rc' ? cb('token') : cb('contaminated')),
          p.id === 'bw' ? h('td', num) : null, h('td', prev.status === 'reserve' ? cb('untimely') : '–'));
      }))))));
  const guestKills = !m.player_b ? h('input', { type: 'number', min: 0, value: rep.guest_killed_points || 0 }) : null;
  const renownA = h('input', { type: 'number', min: 0, value: rep.renown_a || 0 });
  const renownB = h('input', { type: 'number', min: 0, value: rep.renown_b || 0 });
  const submit = async () => {
    if (!result) return toast('Bitte das Ergebnis wählen.', 'error');
    if (!m.battleplan) return toast('Bitte zuerst oben den Schlachtplan festlegen.', 'error');
    const a = vpa.value === '' ? null : Number(vpa.value), b = vpb.value === '' ? null : Number(vpb.value);
    const byVp = a == null || b == null ? null : a > b ? 'a' : b > a ? 'b' : 'draw';
    if (byVp && byVp !== result.slice(0, byVp.length) && !(byVp === 'draw' && result.endsWith('_minor'))
      && !(await confirmBox('Die Siegpunkte passen nicht zum gewählten Ergebnis. Manche Schlachtpläne entscheiden anders – trotzdem so speichern?', 'Speichern'))) return;
    const patch = { units: work };
    if (p.id === 'rc') { patch.renown_a = Number(renownA.value) || 0; patch.renown_b = Number(renownB.value) || 0; }
    if (guestKills) patch.guest_killed_points = Number(guestKills.value) || 0;
    // Wer mitgekämpft hat und wie viele Punkte gefallen sind, hält der Server beim Speichern fest.
    await api('match/' + m.id, { op: 'result', result, vp_a: a, vp_b: b, report: patch, battleplan: m.battleplan });
    correcting.delete(m.id);
    toast(isCorrection ? 'Ergebnis korrigiert.' : 'Ergebnis gespeichert – jetzt den Aftermath machen!', 'ok');
    await loadState(true); redraw();
  };
  return h('div.card', { 'data-keep': '1' },
    h('h3', isCorrection ? 'Ergebnis korrigieren' : 'Ergebnis eintragen'),
    radios,
    h('div.grid2', field(`Siegpunkte ${na}`, vpa), field(`Siegpunkte ${nb}`, vpb)),
    h('p.small.muted', p.id === 'bw' ? 'Mehr Siegpunkte = großer Sieg. Bei Punktgleichstand gewinnt, wer mehr Gelände gereinigt hat, einen kleinen Sieg – sonst Unentschieden. Manche Schlachtpläne haben eigene Siegbedingungen (siehe oben).' : 'Mehr Siegpunkte = großer Sieg, Gleichstand = Unentschieden. Manche Schlachtpläne haben eigene Siegbedingungen (siehe oben). Rückzug: Der Gegner erhält einen großen Sieg.'),
    h('h4', 'Was ist passiert?'),
    h('div.field-grid', unitRows),
    h('p.tiny.muted', '„vernichtet“ = die Einheit wurde in der Schlacht ausgelöscht. „Modelle verloren“ = gefallene Modelle einer überlebenden Einheit. „nie eingesetzt“ = Reserve, die bis zum Schluss nicht aufs Feld kam (keine Kampfwunden). Die getöteten Modellpunkte bringen dem Gegner Nahrung (Hausregel).'),
    guestKills ? field('Punkte der getöteten Gast-Modelle (für deine Nahrung)', guestKills) : null,
    p.id === 'rc' ? h('div.grid2', field(`Ruhmpunkte aus Fähigkeiten (${na})`, renownA, '5 = 1 Splitter'), m.player_b ? field(`Ruhmpunkte aus Fähigkeiten (${nb})`, renownB) : h('div')) : null,
    h('div.row.wrap', h('button.btn.big', { onClick: submit }, isCorrection ? 'Korrektur speichern' : 'Ergebnis speichern'),
      isCorrection ? h('button.btn.ghost', { onClick: () => { correcting.delete(m.id); redraw(); } }, 'Abbrechen') : null));
}
