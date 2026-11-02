// Spiele: Liste, Spielvorbereitung (Schlachtplan, Feld/Reserve), Ergebnis.
import { h, toast, badge, select, field, diceInput, confirmBox, rollDie } from './ui.js';
import { S, me, pack, playerById, unitsOf, unitPoints, generalOf, colorOf, locName, api, loadState, logDice, sideOf } from './store.js';
import { RC, BW, rollOnRange } from './rules.js';
import { RANKS } from './packs.js';
import { matchList } from './campaign.js';

export function renderMatches() {
  const st = S();
  const rounds = [...new Set(st.matches.map(m => m.round))].sort((a, b) => b - a);
  if (!rounds.length) return h('div.card', h('h2', '⚔ Spiele'), h('p.muted', 'Noch keine Begegnungen. Sie entstehen automatisch, sobald alle gezogen haben.'));
  return h('div.stack', h('h2', '⚔ Spiele'), rounds.map(r => h('div.card', h('h3', 'Runde ' + r), matchList(st.matches.filter(m => m.round === r)))));
}

const nameA = m => playerById(m.player_a)?.name || '?';
const nameB = m => m.player_b ? (playerById(m.player_b)?.name || '?') : (m.guest_name || 'Gastspieler');

function bwCommonPlans(m) {
  const p = pack();
  const ua = new Set((playerById(m.player_a)?.data.unlocked) || p.startUnlocked);
  const ub = m.player_b ? new Set((playerById(m.player_b)?.data.unlocked) || p.startUnlocked) : ua;
  return p.nodes.filter(n => ua.has(n.key) && ub.has(n.key)).map(n => n.name);
}

export function renderMatch(id) {
  const st = S(), p = pack(), c = st.campaign;
  const m = st.matches.find(x => x.id === id);
  if (!m) return h('p.muted', 'Spiel nicht gefunden.');
  const mine = me();
  const mySide = mine ? sideOf(m, mine.id) : null;
  const canEdit = !!mySide || !!st.me.admin;
  const rep = JSON.parse(JSON.stringify(m.report || {}));
  rep.units = rep.units || {};
  const save = async (extra = {}, log) => {
    await api('match/' + m.id, { op: 'setup', report: rep, battleplan: extra.battleplan, log });
    await loadState(true);
  };
  const ga = generalOf(m.player_a), gb = m.player_b ? generalOf(m.player_b) : null;
  const rankA = ga ? ga.rank : 0, rankB = gb ? gb.rank : 0;
  const picker = !m.player_b ? nameA(m) : rankA < rankB ? nameA(m) : rankB < rankA ? nameB(m) : null;
  const pickerText = picker ? `${picker} (niedrigster General-Rang)` : 'Beide Generäle haben denselben Rang – würfelt, wer gewinnt';

  // ----- Kopf
  const head = h('div.card.match-head',
    h('div.versus',
      h('div.side', h('span.dot.big', { style: { background: colorOf(m.player_a) } }), h('strong', nameA(m)), h('div.muted.small', `${playerById(m.player_a)?.faction || ''} · General: ${ga ? ga.name + ' (' + RANKS[ga.rank] + ')' : '–'}`)),
      h('div.vs', 'VS'),
      h('div.side', m.player_b ? h('span.dot.big', { style: { background: colorOf(m.player_b) } }) : h('span.dot.big'), h('strong', nameB(m)),
        h('div.muted.small', m.player_b ? `${playerById(m.player_b)?.faction || ''} · General: ${gb ? gb.name + ' (' + RANKS[gb.rank] + ')' : '–'}` : 'außenstehende Person'))),
    h('p.center.muted', `Runde ${m.round} · ${m.kind === 'pvp' ? 'Begegnung auf ' + locName(m.location_a) : m.kind === 'pair' ? `Paarung: ${locName(m.location_a)} / ${locName(m.location_b)}` : 'Gastspiel auf ' + locName(m.location_a)}`),
    m.status === 'done' ? h('p.center', badge(resultText(m), 'ok')) : null);

  // ----- Schlachtplan
  const bpBox = h('div.card');
  const bpName = m.battleplan;
  if (p.id === 'rc') {
    const t = RC.tables[m.table_key || 'outskirts'];
    const rows = h('table.table.small', h('tbody', t.rows.map(r => h('tr' + (r[1] === bpName ? '.me' : ''), h('td', Array.isArray(r[0]) ? `${r[0][0]}–${r[0][1]}` : r[0]), h('td', r[1])))));
    bpBox.append(h('h3', 'Schlachtplan'),
      h('p', `Tabelle: `, h('strong', t.name), ` · Es würfelt: ${pickerText}.`),
      rows,
      canEdit && m.status !== 'done' && m.table_key !== 'claw' ? h('div.row.wrap',
        diceInput('D6', async (v, viaApp) => {
          const r = rollOnRange(t.rows, v);
          rep.bp_roll = v;
          await save({ battleplan: r[1] }, `würfelt den Schlachtplan (${t.name}): ${v} → ${r[1]}${viaApp ? ' (App-Würfel)' : ''}`);
          window.__redraw();
        }, { label: 'Würfeln:' }),
        h('span.muted', 'oder wählen:'),
        select([['', '–'], ...Object.values(RC.tables).flatMap(x => x.rows.map(r => r[1]))], bpName || '', async v => { await save({ battleplan: v }, `wählt den Schlachtplan ${v}.`); window.__redraw(); })) : null,
      bpName ? h('div.bp', h('strong', bpName), h('p', RC.battleplans[bpName] || '')) : h('p.muted', 'Noch kein Schlachtplan gewählt.'),
      h('h4', 'Twist'),
      rep.twist ? h('p', h('strong', rep.twist)) : h('p.muted', 'Noch nicht ausgewürfelt.'),
      rep.twist && RC.twists[rep.twist] ? h('table.table.small', h('tbody', RC.twists[rep.twist].map(r => h('tr', h('td', r[0]), h('td', r[1]))))) : null,
      canEdit && m.status !== 'done' ? diceInput('D6', async v => {
        const r = rollOnRange(RC.twistTable, v);
        rep.twist = v === 6 ? null : r[1];
        if (v === 6) toast('6: Der Spieler mit dem niedrigsten General-Rang wählt die Twist-Tabelle.', 'info');
        await save({}, `würfelt auf der Twist-Tabelle: ${v} → ${r[1]}`); window.__redraw();
      }, { label: 'Twist-Tabelle:' }) : null,
      canEdit && m.status !== 'done' ? select([['', '– Twist-Tabelle wählen –'], ...Object.keys(RC.twists)], rep.twist || '', async v => { rep.twist = v || null; await save({}, v ? `wählt die Twist-Tabelle ${v}.` : null); window.__redraw(); }) : null,
      h('p.tiny.muted', 'Underdog = wer weniger Siegpunkte hat; bei Gleichstand: wer als Zweiter dran war und jetzt zuerst ziehen will, macht den Gegner zum Underdog – sonst wer weniger Splitter gesammelt hat.'));
  } else {
    const common = bwCommonPlans(m);
    const info = BW.battleplans[bpName];
    bpBox.append(h('h3', 'Schlachtplan'),
      h('p', `Es wählt: ${pickerText} – aus den Schlachtplänen, die ihr beide freigeschaltet habt.`),
      canEdit && m.status !== 'done' ? select(common, bpName || common[0], async v => { await save({ battleplan: v }, `wählt den Schlachtplan ${v}.`); window.__redraw(); }) : null,
      bpName ? h('div.bp', h('strong', bpName), info ? h('div', h('p', info.win),
        h('p.small', h('b', 'Fähigkeits-Belohnung: '), info.ability[0], ' – ', info.ability[1]),
        h('p.small', h('b', 'Sonstige Belohnung: '), info.misc)) : null) : null);
  }
  bpBox.append(h('p.tiny', h('a', { href: p.wahapedia, target: '_blank', rel: 'noopener' }, 'Vollständige Schlachtplan-Karten auf Wahapedia ↗')));

  // ----- Feld-Übersicht
  const sides = [['a', m.player_a], ['b', m.player_b]];
  const sum = (pid, st2) => unitsOf(pid).filter(u => (rep.units[u.id]?.status || 'field') === st2).reduce((a, u) => a + unitPoints(u), 0);
  const armyPts = side => {
    const pid = side === 'a' ? m.player_a : m.player_b;
    if (!pid) return Number(rep.guest_points) || 0;
    return unitsOf(pid).filter(u => (rep.units[u.id]?.status || 'field') !== 'rest').reduce((a, u) => a + unitPoints(u), 0);
  };
  const pa = armyPts('a'), pb = armyPts('b');
  const thr = p.id === 'bw' ? 100 : 200;
  const diff = Math.abs(pa - pb);
  const overSide = diff >= thr ? (pa > pb ? 'a' : 'b') : null;
  const surplus = overSide ? diff - thr : 0;
  const overPid = overSide === 'a' ? m.player_a : overSide === 'b' ? m.player_b : null;
  const reserveOk = !overPid || sum(overPid, 'reserve') >= surplus;
  const fieldCols = sides.map(([side, pid]) => {
    if (!pid) {
      const gp = h('input', { type: 'number', value: rep.guest_points || '', placeholder: 'z. B. 1000', disabled: !canEdit || m.status === 'done' });
      gp.addEventListener('change', async () => { rep.guest_points = Number(gp.value) || 0; await save({}, null); window.__redraw(); });
      return h('div.field-col', h('h4', nameB(m)), field('Punkte der Gastarmee', gp, 'Für Übermacht und ' + (p.id === 'bw' ? 'Ruhmespunkte.' : 'Splitter-Info.')));
    }
    const editable = canEdit && m.status !== 'done' && (st.me.admin || mine && mine.id === pid || true);
    const us = unitsOf(pid);
    return h('div.field-col',
      h('h4', h('span.dot', { style: { background: colorOf(pid) } }), playerById(pid)?.name),
      h('div.pts-row', badge(`Feld ${sum(pid, 'field')}`, 'ok'), badge(`Reserve ${sum(pid, 'reserve')}`), p.id === 'bw' ? badge(`Ruhend ${sum(pid, 'rest')}`) : null, badge(`Armee ${armyPts(side)}`, 'gold')),
      h('ul.field-units', us.map(u => {
        const cur = rep.units[u.id]?.status || 'field';
        const opts = [['field', 'Feld'], ['reserve', 'Reserve'], ...(p.id === 'bw' ? [['rest', 'Ruhend']] : [])];
        return h('li', h('span', u.is_general ? '👑 ' : u.is_hero ? '★ ' : '', u.name, h('span.muted.small', ` ${unitPoints(u)}`)),
          editable ? select(opts, cur, async v => {
            if (v === 'rest' && us.some(x => x.id !== u.id && rep.units[x.id]?.status === 'rest')) return toast('Nur 1 Einheit darf ruhen.', 'error');
            rep.units[u.id] = { ...(rep.units[u.id] || {}), status: v }; await save(); window.__redraw();
          }) : badge(opts.find(o => o[0] === cur)[1]));
      })));
  });
  const fieldBox = h('div.card',
    h('h3', 'Feld-Übersicht'),
    h('p', `Armeepunkte: ${nameA(m)} ${pa} · ${nameB(m)} ${pb}. `,
      overSide ? h('span', h('strong', `${overSide === 'a' ? nameA(m) : nameB(m)} hat eine Übermacht`), ` (Differenz ${diff} − ${thr} = `, h('strong', surplus + ' Punkte'), ' müssen als „Stalled Reinforcements“ in Reserve). ', reserveOk ? badge('erfüllt', 'ok') : badge('noch zu wenig in Reserve', 'warn'))
        : `Keine Übermacht (Schwelle ${thr} Punkte).`),
    h('div.field-grid', fieldCols),
    p.id === 'bw' ? h('p.tiny.muted', 'Ruhende Einheiten spielen nicht mit, zählen nicht zu den Armeepunkten und heilen im Aftermath W6 Kampfwunden.') : null);

  // ----- Ergebnis
  let resultBox;
  if (m.status === 'done') {
    const my = mySide;
    resultBox = h('div.card',
      h('h3', 'Ergebnis'), h('p.big', resultText(m)), m.vp_a != null ? h('p', `Siegpunkte: ${m.vp_a} : ${m.vp_b}`) : null,
      h('div.row.wrap',
        ...['a', 'b'].filter(sd => sd === 'a' || m.player_b).map(sd => {
          const done = sd === 'a' ? m.done_a : m.done_b;
          const pidS = sd === 'a' ? m.player_a : m.player_b;
          const allowed = st.me.admin || my === sd;
          return h('div.aft-chip', h('span.dot', { style: { background: colorOf(pidS) } }), playerById(pidS)?.name + ': ', done ? badge('Aftermath erledigt', 'ok') : badge('Aftermath offen'),
            allowed ? h('a.btn.small', { href: `#/c/aftermath/${m.id}${st.me.admin && my !== sd ? '?side=' + sd : ''}` }, done ? 'ansehen' : 'Aftermath starten →') : null);
        })));
  } else if (canEdit) resultBox = resultForm(m, rep, nameA(m), nameB(m));
  else resultBox = h('div.card', h('p.muted', 'Das Ergebnis tragen die Beteiligten ein.'));
  return h('div.stack', h('a.back', { href: '#/c/spiele' }, '← Alle Spiele'), head, bpBox, fieldBox, resultBox);
}

export function resultText(m) {
  const map = { a: `Großer Sieg: ${nameA(m)}`, a_minor: `Kleiner Sieg: ${nameA(m)}`, b: `Großer Sieg: ${nameB(m)}`, b_minor: `Kleiner Sieg: ${nameB(m)}`, draw: 'Unentschieden', void: 'Annulliert' };
  return map[m.result] || 'offen';
}

function resultForm(m, rep, na, nb) {
  const p = pack();
  let result = null;
  const opts = [['a', `Großer Sieg ${na}`], ...(p.id === 'bw' ? [['a_minor', `Kleiner Sieg ${na}`]] : []), ['draw', 'Unentschieden'], ...(p.id === 'bw' ? [['b_minor', `Kleiner Sieg ${nb}`]] : []), ['b', `Großer Sieg ${nb}`]];
  const radios = h('div.result-opts', opts.map(([v, l]) => h('label.choice', h('input', { type: 'radio', name: 'res', onChange: () => { result = v; } }), l)));
  const vpa = h('input', { type: 'number', min: 0, placeholder: na });
  const vpb = h('input', { type: 'number', min: 0, placeholder: nb });
  const unitRows = [m.player_a, m.player_b].filter(Boolean).map(pid => h('div.field-col',
    h('h4', h('span.dot', { style: { background: colorOf(pid) } }), playerById(pid)?.name),
    h('table.table.small',
      h('thead', h('tr', h('th', 'Einheit'), h('th', 'vernichtet'), p.id === 'rc' ? h('th', 'Emberstone-Marke') : h('th', 'in 3" verseucht'), p.id === 'bw' ? h('th', 'Purify ✓') : h('th', 'nie eingesetzt'))),
      h('tbody', unitsOf(pid).filter(u => (rep.units[u.id]?.status || 'field') !== 'rest').map(u => {
        const r = rep.units[u.id] = rep.units[u.id] || { status: 'field' };
        const cb = (key) => h('input', { type: 'checkbox', checked: !!r[key], onChange: e => { r[key] = e.target.checked; } });
        const num = h('input.tiny-in', { type: 'number', min: 0, max: 9, value: r.purify || 0, onChange: e => { r.purify = Number(e.target.value) || 0; } });
        return h('tr', h('td', u.name), h('td', cb('destroyed')), h('td', p.id === 'rc' ? cb('token') : cb('contaminated')),
          h('td', p.id === 'bw' ? num : (r.status === 'reserve' ? cb('untimely') : '–')));
      })))));
  const renownA = h('input', { type: 'number', min: 0, value: rep.renown_a || 0 });
  const renownB = h('input', { type: 'number', min: 0, value: rep.renown_b || 0 });
  const btn = h('button.btn.big', { onClick: async () => {
    if (!result) return toast('Bitte das Ergebnis wählen.', 'error');
    if (!m.battleplan && !(await confirmBox('Es ist noch kein Schlachtplan eingetragen. Trotzdem speichern?', 'Speichern'))) return;
    if (p.id === 'rc') { rep.renown_a = Number(renownA.value) || 0; rep.renown_b = Number(renownB.value) || 0; }
    btn.disabled = true;
    try {
      await api('match/' + m.id, { op: 'result', result, vp_a: vpa.value === '' ? null : Number(vpa.value), vp_b: vpb.value === '' ? null : Number(vpb.value), report: rep, battleplan: m.battleplan });
      toast('Ergebnis gespeichert – jetzt den Aftermath machen!', 'ok');
      await loadState(true); window.__redraw();
    } finally { btn.disabled = false; }
  } }, 'Ergebnis speichern');
  return h('div.card', { 'data-keep': '1' },
    h('h3', 'Ergebnis eintragen'),
    radios,
    h('div.grid2', field(`Siegpunkte ${na}`, vpa), field(`Siegpunkte ${nb}`, vpb)),
    h('p.small.muted', p.id === 'bw' ? 'Bei Punktgleichstand gewinnt, wer mehr Gelände gereinigt hat, einen kleinen Sieg.' : 'Mehr Siegpunkte = großer Sieg, Gleichstand = Unentschieden (sofern der Schlachtplan nichts anderes sagt).'),
    h('h4', 'Was ist passiert?'),
    h('div.field-grid', unitRows),
    p.id === 'rc' ? h('div.grid2', field(`Ruhmpunkte aus Fähigkeiten (${na})`, renownA, '5 = 1 Splitter'), m.player_b ? field(`Ruhmpunkte aus Fähigkeiten (${nb})`, renownB) : h('div')) : null,
    btn);
}
