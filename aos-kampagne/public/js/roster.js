// Armee / Path-to-Glory-Roster
import { h, toast, modal, confirmBox, select, field, badge, rich, possessive } from './ui.js';
import { S, me, pack, playerById, unitsOf, unitPoints, unitModels, rosterPoints, generalOf, colorOf, rosterOps, store, allianceOf, factionNames } from './store.js';
import { RANKS, RANK_DE } from './packs.js';
import { PATHS, pathById, pathsFor, RC, BW, weaponText, scarLevelFor } from './rules.js';

export const canEditRoster = pid => { const st = S(); return !!st.me.admin || st.me.player_id === pid; };
const isAdmin = () => !!S().me.admin;
const locked = pid => { const p = playerById(pid); return p && p.roster_locked; };
const strictOk = pid => !locked(pid) || isAdmin();

export function rosterProblems(pid) {
  const st = S(), c = st.campaign, p = pack();
  const us = unitsOf(pid), pl = playerById(pid);
  const out = [];
  const gens = us.filter(u => u.is_general);
  if (!gens.length) out.push('Es gibt noch keinen General.');
  if (gens.length > 1) out.push('Es darf nur einen General geben.');
  const g = gens[0];
  if (g && !g.is_hero) out.push('Der General muss ein Held sein.');
  if (g && !g.path) out.push('Der General braucht einen Pfad (Rang Aspiring).');
  const pts = rosterPoints(pid);
  if (!pl.roster_locked && pts > c.points_limit) out.push(`Zu viele Punkte: ${pts} / ${c.points_limit}.`);
  if (!pl.roster_locked && c.unit_limit) us.forEach(u => {
    if (unitPoints(u) > c.unit_limit && !(u.is_hero && (u.faction || pl.faction) === 'Behemats Söhne')) out.push(`${u.name} kostet mehr als ${c.unit_limit} Punkte.`);
  });
  const leaders = us.filter(u => u.is_hero && !u.auxiliary && !u.regiment_of);
  if (leaders.length > 5) out.push(`Höchstens 5 Regimenter (aktuell ${leaders.length}).`);
  leaders.forEach(l => {
    const n = us.filter(u => u.regiment_of === l.id).length;
    const max = l.is_general ? 4 : 3;
    if (n > max) out.push(`Regiment von ${l.name}: höchstens ${max} Einheiten (aktuell ${n}).`);
  });
  us.filter(u => !u.is_hero && !u.regiment_of && !u.auxiliary).forEach(u => out.push(`${u.name} gehört zu keinem Regiment – Regiment wählen oder als Hilfseinheit markieren.`));
  if (!c.allow_unique) us.filter(u => (u.data.keywords || '').includes('Einzigartig')).forEach(u => out.push(`${u.name} ist einzigartig – in dieser Kampagne nicht erlaubt.`));
  if (us.filter(u => u.data.ror).length > 1) out.push('Höchstens ein Regiment of Renown.');
  if (p.id === 'bw' && (pl.data.tome || []).filter(t => t.kind !== 'Beschwörung').length > 6) out.push('Arcane Tome: höchstens 6 Zauber/Gebete.');
  if (p.id === 'rc' && (pl.data.tome || []).length > 6) out.push('Arcane Tome: höchstens 6 Einträge.');
  return out;
}

export function regimentLabel(u, us) {
  if (u.is_general) return 'General';
  if (u.auxiliary) return 'Hilfseinheit';
  if (u.is_hero && !u.regiment_of) return 'Regimentsführer';
  const l = us.find(x => x.id === u.regiment_of);
  return l ? 'Regiment: ' + l.name : 'ohne Regiment';
}

export function renderRoster(pidArg) {
  const st = S(), c = st.campaign, p = pack();
  const mine = me();
  const pid = pidArg || (mine ? mine.id : (st.players[0] && st.players[0].id));
  if (!pid) return h('p.muted', 'Noch keine Spieler.');
  const pl = playerById(pid);
  const us = unitsOf(pid);
  const edit = canEditRoster(pid);
  const pts = rosterPoints(pid);
  const probs = rosterProblems(pid);
  const chooser = h('div.chips', st.players.map(x => h('a.chip' + (x.id === pid ? '.active' : ''), { href: '#/c/armee/' + x.id }, h('span.dot', { style: { background: colorOf(x.id) } }), x.name)));
  const leaders = us.filter(u => u.is_hero && !u.auxiliary && !u.regiment_of).sort((a, b) => b.is_general - a.is_general);
  const groups = leaders.map(l => ({ title: l.is_general ? 'Regiment des Generals' : 'Regiment von ' + l.name, units: [l, ...us.filter(u => u.regiment_of === l.id)] }));
  const aux = us.filter(u => u.auxiliary);
  const loose = us.filter(u => !u.auxiliary && u.regiment_of && !us.some(x => x.id === u.regiment_of) || (!u.is_hero && !u.regiment_of && !u.auxiliary));
  if (aux.length) groups.push({ title: 'Hilfseinheiten (Auxiliary)', units: aux });
  if (loose.length) groups.push({ title: '⚠ Ohne Regiment', units: loose });

  const head = h('div.card.roster-head',
    h('div.row.between.wrap',
      h('div', h('h2', h('span.dot.big', { style: { background: colorOf(pid) } }), `${possessive(pl.name)} Armee`),
        h('div.muted', `${pl.faction || 'Fraktion offen'}${allianceOf(pl.faction) ? ' · ' + allianceOf(pl.faction) : ''}`)),
      h('div.stats',
        h('div.stat', h('b', pts), h('span', pl.roster_locked ? 'Punkte' : `/ ${c.points_limit} Punkte`)),
        h('div.stat', h('b', us.length), h('span', 'Einheiten')),
        h('div.stat', h('b', pl.vault), h('span', p.currency.short + ' im Vorrat')),
        h('div.stat', h('b', pl.vault_total), h('span', p.currency.short + ' gesamt')))),
    !pl.roster_locked ? h('div.progress', h('div.bar' + (pts > c.points_limit ? '.over' : ''), { style: { width: Math.min(100, pts / c.points_limit * 100) + '%' } })) : null,
    probs.length ? h('ul.problems', probs.map(x => h('li', '⚠ ' + x))) : (us.length ? h('p.ok-line', '✓ Roster entspricht den Aufstellungsregeln.') : null),
    edit ? h('div.row.wrap',
      strictOk(pid) ? h('button.btn', { onClick: () => pickUnit({ faction: pl.faction, onPick: (u, opts) => addUnit(pid, u, opts) }) }, '+ Einheit hinzufügen') : null,
      !pl.roster_locked && !strictOk(pid) ? null : null,
      !pl.roster_locked ? h('button.btn.ghost', { onClick: () => factionModal(pid) }, 'Fraktion ändern') : null,
      !pl.roster_locked ? h('button.btn.good', { disabled: probs.length > 0, onClick: async () => {
        if (!(await confirmBox('Roster abschließen? Danach wächst deine Armee nur noch über den Aftermath.', 'Abschließen'))) return;
        const ops = [{ op: 'player', fields: { roster_locked: 1 } }];
        const g = generalOf(pid);
        if (g && p.id === 'bw' && g.renown < 5) ops.push({ op: 'update', id: g.id, fields: { renown: 5, rank: Math.max(1, g.rank) } });
        if (g && g.rank < 1) ops.push({ op: 'update', id: g.id, fields: { rank: 1 } });
        await rosterOps(ops, `hat das Roster abgeschlossen (${pts} Punkte).`, pid); toast('Roster abgeschlossen!', 'ok'); window.__redraw();
      } }, '✓ Roster abschließen') : null) : null,
    !pl.roster_locked && edit ? h('details.helpbox', h('summary', 'Wie baue ich mein Roster?'),
      h('ol',
        h('li', 'Füge zuerst deinen ', h('strong', 'General'), ' hinzu (ein Held, Einzelmodell) und markiere ihn als General.'),
        h('li', 'Gib ihm einen ', h('strong', 'Pfad'), ' und wähle die Aspiring-Fähigkeit.'),
        h('li', 'Füge bis zu 4 Nicht-Helden zu seinem Regiment hinzu.'),
        h('li', 'Weitere Helden führen eigene Regimenter (bis zu 3 Einheiten), max. 5 Regimenter.'),
        h('li', 'Alles andere wird Hilfseinheit (Auxiliary).'),
        h('li', p.id === 'bw' ? 'Wähle 1 Heldeneigenschaft, 1 Artefakt und dein Arcane Tome.' : 'Trage deine Start-Zauber/-Gebete ins Arcane Tome ein. Verbesserungen gibt es erst über Splitter.'))) : null);

  const body = groups.length ? groups.map(g => h('div.regiment', h('h3.reg-title', g.title), h('div.unit-grid', g.units.map(u => unitCard(u, us, edit)))))
    : h('div.card.empty', h('p', 'Noch keine Einheiten.'), edit ? h('p.muted', 'Tippe auf „+ Einheit hinzufügen“.') : null);
  return h('div.stack', chooser, head, body, extrasCard(pid, edit));
}

function unitCard(u, us, edit) {
  const p = pack();
  const path = u.path ? pathById(u.path) : null;
  const abil = (u.data.abilities || []).filter(Boolean);
  const lvl = scarLevelFor(u.battle_wounds);
  const scars = u.data.scars || {};
  return h('div.unit' + (u.is_general ? '.general' : '') + (u.is_hero ? '.hero' : ''),
    h('div.unit-top',
      h('div', h('div.unit-name', u.is_general ? '👑 ' : u.is_hero ? '★ ' : '', u.name),
        h('div.unit-sub', `${unitPoints(u)} Pkt · ${unitModels(u)} Modell${unitModels(u) > 1 ? 'e' : ''}${u.reinforced ? ' · verstärkt' : ''} · ${regimentLabel(u, us)}`)),
      edit ? h('button.btn.tiny.ghost', { onClick: () => editUnit(u) }, 'Bearbeiten') : null),
    h('div.badges',
      u.rank ? badge(RANKS[u.rank], 'rank r' + u.rank) : null,
      path ? badge(path.de) : u.path ? badge(u.path) : null,
      p.id === 'bw' ? badge(`Ruhm ${u.renown}`) : null,
      u.data.ror ? badge('Regiment of Renown', 'gold') : null,
      u.drained ? badge('erschöpft', 'warn') : null,
      u.data.legends ? badge('Legende') : null),
    abil.length ? h('ul.abil', abil.map((a, i) => a ? h('li', h('b', RANKS[i + 1] + ': '), a) : null)) : null,
    (u.data.trait || u.data.artefact || u.data.weapon || u.data.concoction) ? h('ul.enh',
      u.data.trait ? h('li', '✦ Heldeneigenschaft: ', u.data.trait) : null,
      u.data.artefact ? h('li', '✧ Artefakt: ', u.data.artefact) : null,
      u.data.weapon ? h('li', '🔥 Emberstone-Waffe: ', weaponText(u.data.weapon)) : null,
      u.data.concoction ? h('li', '⚗ Trank: ', u.data.concoction, u.data.concoction_bought ? ' ★ (gekauft)' : '') : null) : null,
    h('div.wounds', { title: 'Kampfwunden' },
      h('div.wbar', Array.from({ length: 18 }, (_, i) => h('span' + (i < u.battle_wounds ? '.on' : '') + (i === 4 || i === 8 || i === 12 ? '.mark' : '')))),
      h('span.small', `${u.battle_wounds} Kampfwunde${u.battle_wounds === 1 ? '' : 'n'}${lvl ? '' : ''}`)),
    (scars.serious || scars.severe || scars.critical) ? h('ul.scars',
      scars.serious ? h('li', '🩸 Ernst: ', scars.serious) : null,
      scars.severe ? h('li', '🩸 Schwer: ', scars.severe) : null,
      scars.critical ? h('li', '🩸 Kritisch: ', scars.critical) : null) : null,
    u.data.notes ? h('p.notes', u.data.notes) : null);
}

async function addUnit(pid, cat, opts = {}) {
  const pl = playerById(pid), us = unitsOf(pid);
  const hasGeneral = us.some(u => u.is_general);
  const gen = generalOf(pid);
  const unit = {
    catalog_name: cat.name, name: cat.name, faction: cat.faction, points: cat.points, models: cat.models,
    reinforced: opts.reinforced ? 1 : 0, is_hero: cat.hero ? 1 : 0,
    is_general: cat.hero && !hasGeneral && cat.models === 1 ? 1 : 0,
    regiment_of: !cat.hero && gen ? gen.id : null,
    auxiliary: 0, rank: 0,
    data: { keywords: cat.info || '', legends: !!cat.legends, reinforce: !!cat.reinforce, notes_src: cat.notes || '' },
  };
  if (!cat.hero && gen && us.filter(u => u.regiment_of === gen.id).length >= 4) {
    const other = us.find(u => u.is_hero && !u.is_general && !u.regiment_of && !u.auxiliary && us.filter(x => x.regiment_of === u.id).length < 3);
    unit.regiment_of = other ? other.id : null; unit.auxiliary = other ? 0 : 1;
  }
  if (!cat.hero && !gen) unit.auxiliary = 1;
  if (unit.is_general) { unit.rank = 1; if (pack().id === 'bw') unit.renown = 5; }
  if (opts.extra) Object.assign(unit, opts.extra);
  await rosterOps([{ op: 'add', unit }], opts.log || `fügt ${cat.name} hinzu (${unitPoints(unit)} Pkt).`, pid);
  toast(`${cat.name} hinzugefügt.`, 'ok');
  if (window.__redraw) window.__redraw();
}

function factionModal(pid) {
  const pl = playerById(pid);
  const s = select(factionNames(), pl.faction);
  const m = modal('Fraktion ändern', h('div', field('Fraktion', s), h('button.btn', { onClick: async () => { await rosterOps([{ op: 'player', fields: { faction: s.value } }], `wechselt die Fraktion zu ${s.value}.`, pid); m.close(); window.__redraw(); } }, 'Speichern')));
}

// ---------- Katalog-Auswahl ----------
export function pickUnit({ faction, onPick, title = 'Einheit hinzufügen', costFn, heroOnly }) {
  const cat = store.catalog;
  const alliance = allianceOf(faction);
  let q = '', kind = heroOnly ? 'hero' : 'all', allies = false, legends = false;
  const list = h('div.cat-list');
  const search = h('input', { placeholder: 'Suchen… (z. B. „Liberators“)', type: 'search' });
  const draw = () => {
    const pool = cat.units.filter(u => (u.faction === faction || (allies && cat.factions[u.faction] && cat.factions[u.faction].alliance === alliance && u.faction !== faction))
      && (kind === 'all' || (kind === 'hero') === u.hero) && (legends || !u.legends) && (!q || u.name.toLowerCase().includes(q)));
    pool.sort((a, b) => (b.faction === faction) - (a.faction === faction) || b.hero - a.hero || a.name.localeCompare(b.name, 'de'));
    list.replaceChildren(...(pool.length ? pool.slice(0, 200).map(u => {
      const rf = h('input', { type: 'checkbox', disabled: !u.reinforce });
      const cost = costFn ? costFn(u, false) : null;
      return h('div.cat-item',
        h('div.cat-main',
          h('div', h('strong', u.hero ? '★ ' : '', u.name), u.legends ? badge('Legende') : null, u.faction !== faction ? badge(u.faction) : null),
          h('div.muted.small', `${u.points} Pkt · ${u.models} Modell${u.models > 1 ? 'e' : ''}${u.info ? ' · ' + u.info : ''}`),
          u.notes ? h('div.muted.tiny', u.notes) : null),
        h('div.cat-act',
          u.reinforce ? h('label.check.small', rf, ' verstärkt') : null,
          cost != null ? h('span.cost', `${cost} ${pack().currency.short}`) : null,
          h('button.btn.small', { onClick: () => { m.close(); onPick(u, { reinforced: rf.checked }); } }, 'Wählen')));
    }) : [h('p.muted', 'Nichts gefunden.')]));
  };
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  const filters = h('div.row.wrap',
    heroOnly ? null : select([['all', 'Alle'], ['hero', 'Nur Helden'], ['unit', 'Nur Einheiten']], kind, v => { kind = v; draw(); }),
    h('label.check', h('input', { type: 'checkbox', onChange: e => { allies = e.target.checked; draw(); } }), ` Verbündete (${alliance || 'Allianz'})`),
    h('label.check', h('input', { type: 'checkbox', onChange: e => { legends = e.target.checked; draw(); } }), ' Legenden zeigen'));
  const custom = h('details', h('summary', 'Eigene Einheit / Landmark / Regiment of Ghyran eintragen'), customUnitForm(faction, (u, o) => { m.close(); onPick(u, o); }, costFn));
  const m = modal(title, h('div.picker', search, filters, list, custom), { wide: true });
  draw();
}

function customUnitForm(faction, onPick, costFn) {
  const name = h('input', { placeholder: 'Name' });
  const pts = h('input', { type: 'number', value: 100, min: 0 });
  const models = h('input', { type: 'number', value: 1, min: 1 });
  const hero = h('input', { type: 'checkbox' });
  return h('div.stack.small-gap',
    h('div.grid3', field('Name', name), field('Punkte', pts), field('Modelle', models)),
    h('label.check', hero, ' Held'),
    h('button.btn.small', { onClick: () => {
      if (!name.value.trim()) return toast('Bitte einen Namen angeben.', 'error');
      onPick({ name: name.value.trim(), faction, points: Number(pts.value) || 0, models: Number(models.value) || 1, hero: hero.checked, reinforce: false, info: '' }, {});
    } }, 'Hinzufügen'));
}

// ---------- Einheit bearbeiten ----------
export function editUnit(u) {
  const p = pack(), pid = u.player_id, us = unitsOf(pid), strict = strictOk(pid);
  const d = JSON.parse(JSON.stringify(u.data || {}));
  const name = h('input', { value: u.name, maxlength: 80 });
  const isGen = h('input', { type: 'checkbox', checked: !!u.is_general, disabled: !u.is_hero || !strict });
  const reinf = h('input', { type: 'checkbox', checked: !!u.reinforced, disabled: !strict || (!d.reinforce && !isAdmin()) });
  const leaders = us.filter(x => x.is_hero && x.id !== u.id && !x.regiment_of && !x.auxiliary);
  const regOpts = [...(u.is_hero ? [['__lead', 'Führt ein eigenes Regiment']] : []), ...leaders.map(l => [l.id, 'Im Regiment von ' + l.name]), ['__aux', 'Hilfseinheit (Auxiliary)']];
  const regVal = u.auxiliary ? '__aux' : u.regiment_of || (u.is_hero ? '__lead' : '__aux');
  const reg = select(regOpts, regVal);
  const pts = h('input', { type: 'number', value: u.points, disabled: !isAdmin() && locked(pid) });
  const models = h('input', { type: 'number', value: u.models, disabled: !isAdmin() && locked(pid) });
  const wounds = h('input', { type: 'number', value: u.battle_wounds, min: 0, max: 30, disabled: !strict });
  const renown = h('input', { type: 'number', value: u.renown, min: 0, disabled: !strict });
  const rank = select(RANK_DE.map((r, i) => [i, r]), u.rank, null, { disabled: !strict });
  const pathOpts = [['', '– kein Pfad –'], ...pathsFor(p.id, u).map(x => [x.id, `${x.de} (${x.name})${x.req ? ' – nur ' + x.req : ''}`]), ['__custom', 'Eigener Pfad (Battletome)…']];
  const curPath = u.path ? (pathById(u.path) ? pathById(u.path).id : '__custom') : '';
  const pathSel = select(pathOpts, curPath, null, { disabled: !strict && !!u.path });
  const customPath = h('input', { value: curPath === '__custom' ? u.path : '', placeholder: 'Name des Pfads' });
  const abilBox = h('div.abil-edit');
  const drawAbil = () => {
    const pth = pathById(pathSel.value);
    const r = Number(rank.value);
    customPath.style.display = pathSel.value === '__custom' ? '' : 'none';
    abilBox.replaceChildren(...[1, 2, 3, 4].filter(i => i <= r).map(i => {
      const cur = (d.abilities || [])[i - 1] || '';
      if (pth) {
        const opts = pth.ranks[i - 1];
        return field(RANKS[i], h('div.choice-row', opts.map(o => h('label.choice' + (cur === o.name ? '.on' : ''),
          h('input', { type: 'radio', name: 'ab' + i, checked: cur === o.name, onChange: () => { d.abilities = d.abilities || []; d.abilities[i - 1] = o.name; drawAbil(); } }),
          h('div', h('strong', o.name), h('div.tiny.muted', o.when), h('div.small', o.fx))))));
      }
      const inp = h('input', { value: cur, placeholder: 'Fähigkeit' });
      inp.addEventListener('change', () => { d.abilities = d.abilities || []; d.abilities[i - 1] = inp.value; });
      return field(RANKS[i], inp);
    }));
  };
  pathSel.addEventListener('change', () => { d.abilities = []; drawAbil(); });
  rank.addEventListener('change', drawAbil);
  drawAbil();
  const ench = p.id === 'bw' ? BW.enhancements : RC.enhancements;
  const listOrFree = (vals, cur, ph) => {
    const inp = h('input', { value: cur || '', placeholder: ph, list: 'dl' + Math.random().toString(36).slice(2) });
    const dl = h('datalist', { id: inp.getAttribute('list') }, vals.map(v => h('option', { value: v[0] })));
    return [inp, dl];
  };
  const [trait, dlT] = listOrFree(ench.traits, d.trait, 'Name (Battlepack oder Battletome)');
  const [art, dlA] = listOrFree(ench.artefacts, d.artefact, 'Name (Battlepack oder Battletome)');
  const conc = p.id === 'bw' ? select([['', '–'], ...BW.concoctions.map(x => x.name)], d.concoction || '') : null;
  const scarS = h('input', { value: (d.scars || {}).serious || '' });
  const scarV = h('input', { value: (d.scars || {}).severe || '' });
  const scarC = h('input', { value: (d.scars || {}).critical || '' });
  const drained = h('input', { type: 'checkbox', checked: !!u.drained });
  const notes = h('textarea', { rows: 2 }, d.notes || '');

  const save = async () => {
    const fields = { name: name.value, is_general: isGen.checked ? 1 : 0, reinforced: reinf.checked ? 1 : 0, drained: drained.checked ? 1 : 0 };
    if (strict) { fields.battle_wounds = Number(wounds.value) || 0; fields.rank = Number(rank.value); fields.renown = Number(renown.value) || 0; }
    if (!locked(pid) || isAdmin()) { fields.points = Number(pts.value) || 0; fields.models = Number(models.value) || 1; }
    const rv = reg.value;
    fields.auxiliary = rv === '__aux' ? 1 : 0;
    fields.regiment_of = rv === '__aux' || rv === '__lead' ? null : rv;
    if (pathSel.value === '__custom') fields.path = customPath.value || null;
    else fields.path = pathSel.value || null;
    if (fields.is_general) { fields.auxiliary = 0; fields.regiment_of = null; }
    d.trait = trait.value || undefined; d.artefact = art.value || undefined;
    if (conc) d.concoction = conc.value || undefined;
    d.scars = { serious: scarS.value || undefined, severe: scarV.value || undefined, critical: scarC.value || undefined };
    d.notes = notes.value || undefined;
    const ops = [{ op: 'update', id: u.id, fields, data: d }];
    if (fields.is_general && !u.is_general) us.filter(x => x.is_general && x.id !== u.id).forEach(x => ops.push({ op: 'update', id: x.id, fields: { is_general: 0 } }));
    await rosterOps(ops, `bearbeitet ${fields.name}.`, pid);
    m.close(); toast('Gespeichert.', 'ok'); window.__redraw();
  };
  const del = async () => {
    if (!(await confirmBox(`${u.name} wirklich entfernen?` + (locked(pid) ? ' (Für Entlassen mit Rückerstattung bitte den Aftermath nutzen.)' : ''), 'Entfernen'))) return;
    await rosterOps([{ op: 'remove', id: u.id }], `entfernt ${u.name}.`, pid); m.close(); window.__redraw();
  };
  const m = modal(u.name, h('div.stack',
    h('div.grid2', field('Name', name), field('Zugehörigkeit', reg)),
    h('div.grid3', field('Punkte (Basis)', pts), field('Modelle (Basis)', models), h('div', h('label.check', reinf, ' Verstärkt (×2)'), u.is_hero ? h('label.check', isGen, ' General') : null)),
    d.notes_src ? h('p.tiny.muted', 'Profil-Hinweis: ' + d.notes_src) : null,
    h('h4', 'Pfad & Rang'),
    h('div.grid3', field('Pfad', h('div', pathSel, customPath)), field('Rang', rank), p.id === 'bw' ? field('Ruhm (Renown)', renown, '5 / 15 / 30 / 45') : h('div')),
    abilBox,
    h('h4', 'Verbesserungen'),
    u.is_hero ? h('div.grid2', field('Heldeneigenschaft', h('div', trait, dlT)), field('Artefakt der Macht', h('div', art, dlA))) : h('p.muted.small', 'Verbesserungen sind meist nur für Helden.'),
    conc ? field('Ghyranite-Trank', conc) : null,
    h('h4', 'Kampfwunden & Narben'),
    h('div.grid2', field('Kampfwunden', wounds, '5 ernst · 9 schwer · 13 kritisch · 18 tot'), h('label.check', drained, ' Erschöpft (Heilungsritual misslungen)')),
    h('div.grid3', field('Ernste Narbe', scarS), field('Schwere Narbe', scarV), field('Kritische Narbe', scarC)),
    field('Notizen', notes),
    h('div.row.between', strictOk(pid) || isAdmin() ? h('button.btn.danger.ghost', { onClick: del }, 'Entfernen') : h('span'), h('button.btn', { onClick: save }, 'Speichern'))), { wide: true });
}

// ---------- Armee-Extras ----------
function extrasCard(pid, edit) {
  const p = pack(), pl = playerById(pid), d = pl.data || {};
  const tome = d.tome || [];
  const set = async (patch, log) => { await rosterOps([{ op: 'player', fields: { data: patch } }], log, pid); window.__redraw(); };
  const addTome = () => {
    const ench = p.id === 'bw' ? BW.enhancements : RC.enhancements;
    const nm = h('input', { placeholder: 'Name des Zaubers/Gebets', list: 'tomedl' });
    const dl = h('datalist', { id: 'tomedl' }, [...ench.spells, ...ench.prayers].map(x => h('option', { value: x[0] })));
    const kind = select(['Zauber', 'Gebet', ...(p.id === 'bw' ? ['Beschwörung'] : [])], 'Zauber');
    const m = modal('Arcane Tome', h('div', field('Name', h('div', nm, dl)), field('Art', kind),
      h('button.btn', { onClick: async () => { if (!nm.value) return; await set({ tome: [...tome, { name: nm.value, kind: kind.value }] }, `nimmt ${nm.value} ins Arcane Tome auf.`); m.close(); } }, 'Hinzufügen')));
  };
  const txt = (key, label, ph) => {
    const inp = h('input', { value: d[key] || '', placeholder: ph, disabled: !edit });
    inp.addEventListener('change', () => set({ [key]: inp.value }, `${label}: ${inp.value || '–'}`));
    return field(label, inp);
  };
  const ingr = d.ingredients || {};
  return h('div.card',
    h('h3', 'Armee-Details'),
    h('div.grid2', txt('formation', 'Kampfformation', 'optional'), txt('terrain', 'Fraktionsgelände', p.id === 'rc' ? 'erst über Splitter' : 'optional')),
    p.id === 'bw' ? h('div.grid2', txt('landmark', 'Landmark of Ghyran', 'Name, Größe, DP'), txt('regiment_ghyran', 'Regiment of Ghyran', 'Name, Größe, DP')) : null,
    h('h4', `Arcane Tome (${tome.length}${p.id === 'bw' ? ' · max. 6 + 3 Beschwörungen' : ' / 6'})`),
    tome.length ? h('ul.tome', tome.map((t, i) => h('li', badge(t.kind), ' ', t.name, edit ? h('button.btn.tiny.ghost', { onClick: () => set({ tome: tome.filter((_, j) => j !== i) }, `entfernt ${t.name} aus dem Arcane Tome.`) }, '✕') : null))) : h('p.muted.small', 'Noch leer.'),
    edit ? h('button.btn.small.ghost', { onClick: addTome }, '+ Zauber/Gebet') : null,
    p.id === 'bw' ? h('div',
      h('h4', 'Zutaten (Ghyranite Concoctions)'),
      Object.keys(ingr).filter(k => ingr[k] > 0).length ? h('ul.tome', Object.entries(ingr).filter(([, n]) => n > 0).map(([k, n]) => h('li', `${n}× ${k}`))) : h('p.muted.small', 'Keine Zutaten.'),
      d.next_ability ? h('p', badge('Belohnung für die nächste Schlacht', 'gold'), ' ', d.next_ability) : null) : null,
    d.trophy ? h('p.trophy-line', '🏆 Kampagnen-Trophäe') : null);
}
