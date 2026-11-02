// Aftermath-Assistent (Ravaged Coast & Blighted Wilds)
import { h, toast, modal, confirmBox, select, field, badge, diceInput, rollExpr, rollDie, rich } from './ui.js';
import { S, me, pack, playerById, unitsOf, unitPoints, generalOf, colorOf, api, loadState, rosterOps, logDice, allianceOf, unitStatus, unitJob, JOBS, livePoints, perModel, fullModels, aliveModels, plays } from './store.js';
import { RANKS, foodFactor } from './packs.js';
import { RC, BW, pathsFor, pathById, scarLevelFor, scarTable, rollOnRange, SCAR_LEVELS, forgeApply, weaponText } from './rules.js';
import { pickUnit, editUnit } from './roster.js';
import { resultText } from './match.js';

let ctx = null; // { m, side, pid, state }

export function renderAftermath(idWithQuery) {
  const [id, q] = String(idWithQuery || '').split('?');
  const st = S(), mine = me();
  const m = st.matches.find(x => x.id === id);
  if (!m) return h('p.muted', 'Spiel nicht gefunden.');
  let side = mine ? (m.player_a === mine.id ? 'a' : m.player_b === mine.id ? 'b' : null) : null;
  const qs = new URLSearchParams(q || location.hash.split('?')[1] || '');
  if (st.me.admin && qs.get('side')) side = qs.get('side');
  if (!side) return h('div.card', h('p', 'Das ist nicht dein Spiel.'));
  if (m.status !== 'done') return h('div.card', h('p', 'Erst das Ergebnis eintragen.'), h('a.btn', { href: '#/c/spiel/' + m.id }, 'Zum Spiel'));
  const pid = side === 'a' ? m.player_a : m.player_b;
  const saved = side === 'a' ? m.aftermath_a : m.aftermath_b;
  const done = side === 'a' ? m.done_a : m.done_b;
  const state = JSON.parse(JSON.stringify(saved && saved.step ? saved : { step: 1, s1: {}, s2: {}, s3: { used: {} }, s4: {} }));
  state.s3 = state.s3 || { used: {} }; state.s3.used = state.s3.used || {};
  ctx = { m, side, pid, state, done };
  const p = pack();
  const steps = p.id === 'bw'
    ? [['Ruhmespunkte', bwStep1], ['Ruhm & Ränge', bwStep2], ['Roster verwalten', bwStep3], ['Wunden & Verluste', step4], ['Versorgung', step5]]
    : [['Splitter gewinnen', rcStep1], ['Roster verwalten', step2], ['Splitter ausgeben', rcStep3], ['Wunden & Verluste', step4], ['Versorgung', step5]];
  const LAST = steps.length;
  const cur = Math.min(Math.max(1, state.step || 1), LAST);
  const stepper = h('ol.stepper', steps.map(([t], i) => h('li' + (i + 1 === cur ? '.active' : i + 1 < cur ? '.done' : ''), { onClick: () => goStep(i + 1) }, h('span', i + 1), t)));
  const pl = playerById(pid);
  const body = done ? h('div.card', h('p', badge('Aftermath abgeschlossen', 'ok')), h('p.muted', 'Änderungen am Roster gehen weiterhin über „Armee → Bearbeiten“.')) : steps[cur - 1][1]();
  return h('div.stack', { 'data-keep': '1' },
    h('a.back', { href: '#/c/spiel/' + m.id }, '← Zum Spiel'),
    h('div.card.aft-head',
      h('h2', '🔥 Aftermath'),
      h('p', h('span.dot', { style: { background: colorOf(pid) } }), h('strong', pl.name), ` · ${resultText(m)} · ${m.battleplan || ''}`),
      h('p.vault-line', `${p.currency.icon} Im Vorrat: `, h('strong', pl.vault + ' ' + p.currency.short), ` · insgesamt gesammelt: ${pl.vault_total}`,
        ` · 🍖 Nahrung: `, h('strong', String(pl.data.food ?? S().campaign.points_limit)), p.id === 'rc' ? [` · 🪙 Gold: `, h('strong', String(pl.data.gold || 0))] : null)),
    done ? null : stepper,
    body,
    done ? null : h('div.row.between',
      cur > 1 ? h('button.btn.ghost', { onClick: () => goStep(cur - 1) }, '← Zurück') : h('span'),
      cur < LAST ? h('button.btn', { onClick: () => goStep(cur + 1) }, 'Weiter →')
        : h('button.btn.good.big', { onClick: finish }, '✓ Aftermath abschließen')));
}

async function saveState(done = false) {
  await api('match/' + ctx.m.id, { op: 'aftermath', side: ctx.side, state: ctx.state, done });
  await loadState(true);
}
async function goStep(n) { ctx.state.step = n; await saveState(); redraw(); }
const redraw = () => window.__redraw && window.__redraw();
async function finish() {
  const s4 = ctx.state.s4 || {}, s5 = ctx.state.s5 || {};
  if (!s4.wounds_applied && !(await confirmBox('Die Kampfwunden wurden noch nicht angewendet. Trotzdem abschließen?', 'Abschließen'))) return;
  if (!s5.fed && !(await confirmBox('Die Versorgung (Nahrung) wurde noch nicht abgerechnet. Trotzdem abschließen?', 'Abschließen'))) return;
  await saveState(true); toast('Aftermath abgeschlossen!', 'ok'); location.hash = '#/c/lage';
}
const myUnits = () => unitsOf(ctx.pid);
const rep = () => ctx.m.report || { units: {} };
const repU = id => {
  const r = (rep().units || {})[id] || {};
  const u = S().units.find(x => x.id === id);
  return { ...r, status: u ? unitStatus(ctx.m, u) : (r.status || 'field') };
};
// Gestorbene Modelle dieser Schlacht (vor dem Dauerhaft-Wurf)
const casualties = u => { const r = repU(u.id); if (!plays(r.status) && r.status !== 'field') return 0; if (r.untimely) return 0; return r.destroyed ? (r.alive_at_battle ?? aliveModels(u)) : (r.lost || 0); };
const won = () => ctx.m.result && ctx.m.result.startsWith(ctx.side);
const lost = () => ctx.m.result && ctx.m.result !== 'draw' && ctx.m.result !== 'void' && !ctx.m.result.startsWith(ctx.side);
const isMajor = () => ctx.m.result === 'a' || ctx.m.result === 'b';
const pl = () => playerById(ctx.pid);
const cur = () => pack().currency.short;
async function ops(list, log) { await rosterOps(list, log, ctx.pid); }
const doneBox = text => h('div.done-box', '✓ ', text);

// ===================== Ravaged Coast =====================
function rcStep1() {
  const s = ctx.state.s1;
  const tokens = myUnits().filter(u => repU(u.id).token).length;
  const renown = Number(rep()['renown_' + ctx.side] || 0);
  const parts = s.parts || {};
  const base = won() ? 3 : parts.base;
  const needShores = ctx.m.table_key === 'shores';
  const total = (base || 0) + (needShores ? (parts.shores || 0) : 0) + tokens + Math.floor(renown / 5);
  const ready = base != null && (!needShores || parts.shores != null);
  const set = (k, v) => { s.parts = { ...parts, [k]: v }; saveState().then(redraw); };
  return h('div.card',
    h('h3', '1. Emberstone-Splitter gewinnen'),
    h('table.table',
      h('tbody',
        h('tr', h('td', won() ? 'Sieg' : lost() ? 'Niederlage' : 'Unentschieden'), h('td', won() ? h('strong', '3') : s.applied ? String(base) :
          h('div', diceInput('D3', v => set('base', v), { value: parts.base }),
            !won() && !lost() && parts.base != null && !parts.rerolled ? h('button.btn.tiny.ghost', { onClick: () => { const r = rollDie(3); logDice(`Splitter (Unentschieden) neu gewürfelt: ${r}`); s.parts = { ...parts, base: r, rerolled: true }; saveState().then(redraw); } }, '↻ einmal wiederholen') : null))),
        needShores ? h('tr', h('td', 'Hateful-Shores-Schlachtplan'), h('td', s.applied ? String(parts.shores) : diceInput('D3', v => set('shores', v), { value: parts.shores }))) : null,
        h('tr', h('td', `Emberstone-Marken am Schlachtende (${tokens})`), h('td', '+' + tokens)),
        renown ? h('tr', h('td', `Ruhmpunkte aus Fähigkeiten (${renown} ÷ 5)`), h('td', '+' + Math.floor(renown / 5))) : null,
        h('tr.total', h('td', 'Gesamt'), h('td', h('strong', ready ? total : '…'))))),
    s.applied ? doneBox(`${s.total} Splitter gutgeschrieben.`) :
      h('button.btn', { disabled: !ready, onClick: async () => {
        await ops([{ op: 'player', fields: { vault_delta: total, vault_total_delta: total } }], `erhält ${total} Emberstone-Splitter (Aftermath Runde ${ctx.m.round}).`);
        s.applied = true; s.total = total; await saveState(); redraw();
      } }, `${total} Splitter gutschreiben`));
}

function rcStep3() {
  const s = ctx.state.s3, used = s.used, p = pl(), us = myUnits();
  const card = (key, title, cost, desc, action) => h('div.action' + (used[key] ? '.used' : ''),
    h('div.action-head', h('strong', title), h('span.cost', cost)),
    h('p.small', desc),
    used[key] ? doneBox(used[key]) : h('button.btn.small', { onClick: action }, 'Ausführen'));
  const markUsed = async (key, text) => { used[key] = text; await saveState(); redraw(); };
  const forgedThis = s.forged || [];
  const weapons = us.filter(u => u.data.weapon && !forgedThis.includes(u.id));
  return h('div.stack',
    h('div.card', h('h3', '3. Splitter ausgeben'), h('p', `Im Vorrat: `, h('strong', p.vault + ' Splitter'), '. Jede Aktion höchstens einmal pro Aftermath. Übrige Splitter bleiben im Vorrat.')),
    h('div.action-grid',
      card('path', 'Fortschritt auf einem Pfad', '1 / 2 / 4 / 6', 'Pfad betreten (Aspiring) oder den nächsten Rang erreichen: Elite 2, Mighty 4, Legendary 6.', () => pathAction(markUsed)),
      card('enh', 'Verbesserung', '3', 'Heldeneigenschaft oder Artefakt (universal oder aus deinem Battletome) für eine Einheit ohne Verbesserung dieser Art.', () => enhancementAction(RC.enhancementCost, markUsed)),
      card('spell', 'Zauber oder Gebet', '2', 'Ins Arcane Tome aufnehmen (max. 6 – sonst einen anderen entfernen).', () => tomeAction(RC.spellCost, markUsed)),
      card('recruit', 'Krieger rekrutieren', '2–15', 'Neue Einheit (Mindestgröße) oder eine Einheit verstärken – Kosten nach Punktwert.', () => recruitAction(markUsed)),
      card('terrain', 'Fraktionsgelände', '3', 'Einen Außenposten an der Ravaged Coast errichten.', async () => {
        const nm = h('input', { placeholder: 'Name des Fraktionsgeländes' });
        const mm = modal('Fraktionsgelände', h('div', field('Name', nm), h('button.btn', { onClick: async () => {
          if (!nm.value) return;
          await ops([{ op: 'player', fields: { vault_delta: -RC.terrainCost, data: { terrain: nm.value } } }], `errichtet ${nm.value} (−3 Splitter).`);
          mm.close(); markUsed('terrain', nm.value);
        } }, 'Kaufen (3)')));
      }),
      card('weapon', 'Emberstone-Waffe schmieden', '2 (+1 je Zusatzwurf)', 'Instabile Waffe für einen Helden ohne Artefakt – zählt als Artefakt.', () => forgeAction(markUsed)),
      card('ror', 'Regiment of Renown anheuern', '2', 'Einen der vier Ravaged-Coast-Spezialisten (je nach Großer Allianz).', () => rorAction(markUsed))),
    h('div.card',
      h('h3', 'Instabile Emberstone-Waffen'),
      weapons.length ? h('div', h('p.small', 'Für jede Waffe, die nicht in diesem Aftermath geschmiedet wurde: W6 – bei 1 zerbricht sie und der Held erleidet 1 Kampfwunde.'),
        weapons.map(u => (s.unstable || {})[u.id] ? h('p', `${u.name}: `, (s.unstable[u.id] === 1 ? '💥 zerbrochen (1 Kampfwunde)' : `hält (${s.unstable[u.id]})`))
          : h('p', h('strong', u.name + ': '), diceInput('D6', async v => {
            s.unstable = { ...(s.unstable || {}), [u.id]: v };
            if (v === 1) await ops([{ op: 'update', id: u.id, fields: { battle_wounds: u.battle_wounds + 1 }, data: { weapon: null } }], `${u.name}: Emberstone-Waffe zerbricht (1 Kampfwunde).`);
            await saveState(); redraw();
          }))))
        : h('p.muted.small', 'Keine bestehenden Emberstone-Waffen.')));
}

function pathAction(markUsed) {
  const p = pack(), us = myUnits().filter(u => !(u.data.keywords || '').includes('Einzigartig') && u.rank < 4);
  const uSel = select(us.map(u => [u.id, `${u.name} (${RANKS[u.rank]}${u.path ? ', ' + (pathById(u.path)?.de || u.path) : ''})`]), us[0]?.id);
  const box = h('div');
  const draw = () => {
    const u = us.find(x => x.id === uSel.value); if (!u) return;
    const next = u.rank + 1, cost = RC.pathCost[next];
    const pathSel = u.path ? null : select(pathsFor(p.id, u).map(x => [x.id, `${x.de}${x.req ? ' (nur ' + x.req + ')' : ''}`]), '');
    let pickedAbility = null;
    const abBox = h('div');
    const drawAb = () => {
      const pth = pathById(u.path || pathSel.value);
      if (!pth) { abBox.replaceChildren(h('p.small', 'Eigener Pfad: Fähigkeit eintragen.'), (() => { const i = h('input', { placeholder: 'Fähigkeit' }); i.addEventListener('input', () => { pickedAbility = i.value; }); return i; })()); return; }
      abBox.replaceChildren(h('p.small', `Fähigkeit für ${RANKS[next]} wählen:`), h('div.choice-row', pth.ranks[next - 1].map(o => h('label.choice', h('input', { type: 'radio', name: 'pa', onChange: () => { pickedAbility = o.name; } }), h('div', h('strong', o.name), h('div.tiny.muted', o.when), h('div.small', o.fx))))));
    };
    if (pathSel) pathSel.addEventListener('change', drawAb);
    box.replaceChildren(
      h('p', u.path ? `Nächster Rang: ${RANKS[next]} – kostet ${cost} Splitter.` : `Pfad betreten (Aspiring) – kostet ${cost} Splitter.`),
      pathSel ? field('Pfad', pathSel) : null, abBox,
      h('button.btn', { onClick: async () => {
        if (!pickedAbility) return toast('Bitte eine Fähigkeit wählen.', 'error');
        const pathId = u.path || pathSel.value;
        const abilities = [...(u.data.abilities || [])]; abilities[next - 1] = pickedAbility;
        await ops([{ op: 'player', fields: { vault_delta: -cost } }, { op: 'update', id: u.id, fields: { rank: next, path: pathId }, data: { abilities } }],
          `${u.name} erreicht ${RANKS[next]} (${pathById(pathId)?.de || pathId}: ${pickedAbility}) für ${cost} Splitter.`);
        mm.close(); markUsed('path', `${u.name} → ${RANKS[next]}`);
      } }, `Kaufen (${cost})`));
    drawAb();
  };
  uSel.addEventListener('change', draw);
  const mm = modal('Fortschritt auf einem Pfad', h('div', field('Einheit', uSel), box), { wide: true });
  draw();
}

function enhancementAction(cost, markUsed, free) {
  const p = pack(), us = myUnits().filter(u => !(u.data.keywords || '').includes('Einzigartig'));
  const ench = p.id === 'bw' ? BW.enhancements : RC.enhancements;
  const uSel = select(us.map(u => [u.id, u.name + (u.is_hero ? ' ★' : '')]), us.find(u => u.is_hero)?.id);
  const type = select([['trait', 'Heldeneigenschaft'], ['artefact', 'Artefakt der Macht']], 'trait');
  const nm = h('input', { list: 'enhdl', placeholder: 'Name' });
  const dl = h('datalist', { id: 'enhdl' });
  const info = h('p.small.muted');
  const drawDl = () => dl.replaceChildren(...(type.value === 'trait' ? ench.traits : ench.artefacts).map(x => h('option', { value: x[0] })));
  type.addEventListener('change', drawDl); drawDl();
  nm.addEventListener('input', () => { const f = [...ench.traits, ...ench.artefacts].find(x => x[0] === nm.value); info.textContent = f ? f[1] : ''; });
  const mm = modal('Verbesserung', h('div', field('Einheit', uSel), field('Art', type), field('Verbesserung', h('div', nm, dl), 'Universal (Vorschläge) oder aus deinem Battletome'), info,
    h('button.btn', { onClick: async () => {
      const u = us.find(x => x.id === uSel.value);
      if (!nm.value) return toast('Bitte einen Namen eingeben.', 'error');
      if (u.data[type.value] || (type.value === 'artefact' && u.data.weapon)) return toast(`${u.name} hat schon eine Verbesserung dieser Art.`, 'error');
      const all = myUnits().flatMap(x => [x.data.trait, x.data.artefact]);
      if (all.includes(nm.value)) return toast('Diese Verbesserung ist schon im Roster.', 'error');
      const list = [{ op: 'update', id: u.id, data: { [type.value]: nm.value } }];
      if (cost) list.unshift({ op: 'player', fields: { vault_delta: -cost } });
      await ops(list, `${u.name} erhält ${nm.value}${cost ? ` (−${cost} ${cur()})` : ' (Belohnung)'}.`);
      mm.close(); markUsed && markUsed('enh', `${u.name}: ${nm.value}`);
    } }, cost ? `Kaufen (${cost})` : 'Vergeben')));
}

function tomeAction(cost, markUsed) {
  const p = pack(), d = pl().data, tome = d.tome || [];
  const ench = p.id === 'bw' ? BW.enhancements : RC.enhancements;
  const nm = h('input', { list: 'tdl', placeholder: 'Name' });
  const dl = h('datalist', { id: 'tdl' }, [...ench.spells, ...ench.prayers].map(x => h('option', { value: x[0] })));
  const kind = select(['Zauber', 'Gebet', ...(p.id === 'bw' ? ['Beschwörung'] : [])], 'Zauber');
  const full = p.id === 'bw' ? null : tome.length >= 6;
  const rem = select([['', '– nichts entfernen –'], ...tome.map((t, i) => [i, t.name])], '');
  const mm = modal('Zauber oder Gebet', h('div', field('Name', h('div', nm, dl)), field('Art', kind),
    full || tome.length >= 6 ? field('Tome voll – entfernen:', rem) : null,
    h('button.btn', { onClick: async () => {
      if (!nm.value) return;
      let t = [...tome];
      if (rem.value !== '') t = t.filter((_, i) => i !== Number(rem.value));
      const normal = t.filter(x => x.kind !== 'Beschwörung').length, summ = t.filter(x => x.kind === 'Beschwörung').length;
      if (p.id === 'rc' && t.length >= 6) return toast('Das Arcane Tome ist voll – erst einen Eintrag entfernen.', 'error');
      if (p.id === 'bw' && ((kind.value === 'Beschwörung' && summ >= 3) || (kind.value !== 'Beschwörung' && normal >= 6))) return toast('Diese Plätze im Arcane Tome sind voll – erst einen Eintrag entfernen.', 'error');
      t.push({ name: nm.value, kind: kind.value });
      await ops([...(cost ? [{ op: 'player', fields: { vault_delta: -cost } }] : []), { op: 'player', fields: { data: { tome: t } } }], `nimmt ${nm.value} ins Arcane Tome auf${cost ? ` (−${cost} ${cur()})` : ''}.`);
      mm.close(); markUsed && markUsed('spell', nm.value);
    } }, cost ? `Kaufen (${cost})` : 'Hinzufügen')));
}

function recruitAction(markUsed) {
  const isBw = pack().id === 'bw';
  const costOf = (pts) => isBw ? pts : RC.recruitCost(pts);
  const choose = modal('Krieger rekrutieren', h('div.stack',
    h('button.btn', { onClick: () => { choose.close(); pickUnit({ faction: pl().faction, title: 'Neue Einheit', costFn: u => costOf(u.points), onPick: async (u) => {
      const cost = costOf(u.points);
      if (pl().vault < cost) return toast(`Nicht genug ${cur()} (${cost} nötig).`, 'error');
      const leaders = myUnits().filter(x => x.is_hero && !x.regiment_of && !x.auxiliary);
      const asLeader = u.hero && leaders.length < 5;
      await ops([{ op: 'player', fields: { vault_delta: -cost } }, { op: 'add', unit: { catalog_name: u.name, name: u.name, faction: u.faction, points: u.points, models: u.models, is_hero: u.hero ? 1 : 0, auxiliary: asLeader ? 0 : 1, data: { keywords: u.info || '', legends: !!u.legends, reinforce: !!u.reinforce, notes_src: u.notes || '' } } }],
        `rekrutiert ${u.name} (${u.points} Pkt) für ${cost} ${cur()}.`);
      markUsed(isBw ? 'expand' : 'recruit', `${u.name} rekrutiert`);
      toast(asLeader ? `${u.name} führt ein neues Regiment.` : `${u.name} ist Hilfseinheit – über „Armee“ einem Regiment zuordnen.`, 'ok');
    } }); } }, 'Neue Einheit (Mindestgröße)'),
    h('button.btn.ghost', { onClick: () => {
      choose.close();
      const cand = myUnits().filter(u => !u.reinforced && (u.models > 1) && u.data.reinforce !== false);
      if (!cand.length) return toast('Keine Einheit kann verstärkt werden.', 'error');
      const sel = select(cand.map(u => [u.id, `${u.name} (${u.points} Pkt → Kosten ${costOf(u.points)})`]), cand[0].id);
      const mm = modal('Einheit verstärken', h('div', field('Einheit', sel), h('button.btn', { onClick: async () => {
        const u = cand.find(x => x.id === sel.value); const cost = costOf(u.points);
        await ops([{ op: 'player', fields: { vault_delta: -cost } }, { op: 'update', id: u.id, fields: { reinforced: 1 } }], `verstärkt ${u.name} für ${cost} ${cur()}.`);
        mm.close(); markUsed(isBw ? 'expand' : 'recruit', `${u.name} verstärkt`);
      } }, 'Verstärken')));
    } }, 'Bestehende Einheit verstärken')));
}

function forgeAction(markUsed) {
  const heroes = myUnits().filter(u => u.is_hero && !u.data.artefact && !u.data.weapon && !(u.data.keywords || '').includes('Einzigartig'));
  if (!heroes.length) return toast('Kein Held ohne Artefakt verfügbar.', 'error');
  if (pl().vault < RC.weaponCost) return toast('Nicht genug Splitter (2 nötig).', 'error');
  const hasRor = myUnits().some(u => u.data.ror);
  const hSel = select(heroes.map(u => [u.id, u.name]), heroes[0].id);
  const type = select([['melee', 'Nahkampfwaffe'], ['ranged', 'Fernkampfwaffe']], 'melee');
  const name = h('input', { placeholder: 'Name der Waffe (optional)' });
  let weapon = null, rolls = [], extraPaid = 0, rerollUsed = false;
  const out = h('div.forge');
  const draw = () => {
    out.replaceChildren(
      weapon ? h('p.weapon', '🔥 ', weaponText(weapon)) : null,
      rolls.length ? h('ol.small', rolls.map(r => h('li', `Wurf ${r.c1}/${r.c2}: ${r.text}`))) : null);
  };
  const doRoll = () => { const c1 = rollDie(6), c2 = rollDie(6); const r = forgeApply(weapon, c1, c2); weapon = r.weapon; rolls.push({ c1, c2, text: r.text }); logDice(`Schmiedewurf ${c1}/${c2}: ${r.text}`); draw(); };
  const start = h('button.btn', { onClick: async () => {
    weapon = JSON.parse(JSON.stringify(RC.forge.base[type.value]));
    await ops([{ op: 'player', fields: { vault_delta: -RC.weaponCost } }], 'zahlt 2 Splitter für eine Emberstone-Waffe.');
    doRoll(); doRoll();
    start.remove(); type.disabled = true; hSel.disabled = true; controls.style.display = '';
  } }, 'Schmieden (2 Splitter, 2 Schmiedewürfe)');
  const extra = h('input', { type: 'number', min: 0, value: 0, style: { width: '5em' } });
  const controls = h('div.row.wrap', { style: { display: 'none' } },
    h('span', 'Zusätzliche Würfe (je 1 Splitter, vorher festlegen):'), extra,
    h('button.btn.small', { onClick: async () => {
      const n = Number(extra.value) || 0; if (n < 1) return;
      if (pl().vault < n) return toast('Nicht genug Splitter.', 'error');
      await ops([{ op: 'player', fields: { vault_delta: -n } }], `zahlt ${n} Splitter für zusätzliche Schmiedewürfe.`);
      for (let i = 0; i < n; i++) doRoll(); extraPaid += n; extra.value = 0;
    } }, 'Würfeln'),
    hasRor ? h('button.btn.small.ghost', { onClick: () => {
      if (rerollUsed || !rolls.length) return;
      // Letzten Wurf rückgängig machen: Waffe aus allen Würfen außer dem letzten neu aufbauen
      const keep = rolls.slice(0, -1); let w = JSON.parse(JSON.stringify(RC.forge.base[type.value]));
      keep.forEach(r => { w = forgeApply(w, r.c1, r.c2).weapon; });
      weapon = w; rolls = keep; rerollUsed = true; doRoll();
    } }, '↻ Letzten Wurf wiederholen (Regiment of Renown)') : null,
    h('button.btn.good', { onClick: async () => {
      const u = heroes.find(x => x.id === hSel.value);
      weapon.name = name.value || (weapon.type === 'ranged' ? 'Emberstone-Fernkampfwaffe' : 'Emberstone-Nahkampfwaffe');
      await ops([{ op: 'update', id: u.id, data: { weapon } }], `${u.name} erhält ${weapon.name}: ${weaponText(weapon)}.`);
      ctx.state.s3.forged = [...(ctx.state.s3.forged || []), u.id];
      mm.close(); markUsed('weapon', `${weapon.name} für ${u.name}`);
    } }, 'Waffe übergeben'));
  const mm = modal('Die Emberstone-Schmiede', h('div.stack', field('Held', hSel), field('Waffentyp', type), field('Name', name), start, controls, out,
    h('details', h('summary', 'Schmiede-Tabelle'), h('p.small', 'Erster W6 = Spalte, zweiter W6 = Zeile. Maximal 30" Reichweite, 2+ Treffen/Verwunden, Durchschlag 4, Schaden W3+4 – Überschreitungen zählen als Fehlschlag. Treffen/Verwunden nie schlechter als 6+.'))), { wide: true });
}

function rorAction(markUsed) {
  const al = allianceOf(pl().faction);
  const options = RC.regimentsOfRenown.filter(r => !al || r.alliance === al);
  if (myUnits().some(u => u.data.ror)) return toast('Du hast schon ein Regiment of Renown.', 'error');
  const sel = select(options.map(r => [r.name, `${r.name} (${r.alliance})`]), options[0]?.name);
  const info = h('p.small');
  const show = () => { info.textContent = (options.find(r => r.name === sel.value) || {}).fx || ''; };
  sel.addEventListener('change', show); show();
  const mm = modal('Regiment of Renown anheuern', h('div', field('Regiment', sel), info,
    h('button.btn', { onClick: async () => {
      await ops([{ op: 'player', fields: { vault_delta: -RC.rorCost } }, { op: 'add', unit: { name: sel.value, is_hero: 1, points: 0, models: 1, auxiliary: 0, data: { ror: true, notes: (options.find(r => r.name === sel.value) || {}).fx } } }],
        `heuert ${sel.value} an (−2 Splitter).`);
      mm.close(); markUsed('ror', sel.value);
    } }, 'Anheuern (2)')));
}

// ===================== Roster verwalten (RC) =====================
function step2() {
  const s = ctx.state.s2; s.log = s.log || [];
  const note = async text => { s.log.push(text); await saveState(); redraw(); };
  return h('div.stack',
    h('div.card', h('h3', '2. Roster verwalten'), h('p', 'Optional – mach, was du brauchst, und klicke dann auf „Weiter“.'),
      s.log.length ? h('ul.small', s.log.map(x => h('li', '✓ ' + x))) : null),
    h('div.action-grid', commonManageActions(note, false)));
}

function commonManageActions(note, bw) {
  const us = myUnits();
  return [
    h('div.action', h('div.action-head', h('strong', 'Held befördern')), h('p.small', 'Ein Held, der Hilfseinheit ist oder im Regiment eines anderen Helden steht, führt künftig ein eigenes Regiment.' + (bw ? ' Max. 5 Regimenter.' : '')),
      h('button.btn.small', { onClick: () => {
        const c = us.filter(u => u.is_hero && !u.is_general && (u.auxiliary || u.regiment_of));
        if (!c.length) return toast('Kein passender Held.', 'error');
        const sel = select(c.map(u => [u.id, u.name]), c[0].id);
        const mm = modal('Held befördern', h('div', field('Held', sel), h('button.btn', { onClick: async () => {
          const u = c.find(x => x.id === sel.value);
          await ops([{ op: 'update', id: u.id, fields: { auxiliary: 0, regiment_of: null } }], `befördert ${u.name} zum Regimentsführer.`);
          mm.close(); note(`${u.name} befördert`);
        } }, 'Befördern')));
      } }, 'Ausführen')),
    h('div.action', h('div.action-head', h('strong', 'Einheiten entlassen')), h('p.small', bw ? 'Rückerstattung: halber Punktwert in GP. Verbesserungen gehen verloren.' : 'Rückerstattung: bis 200 Pkt 1, bis 300: 2, bis 400: 3, bis 500: 4, darüber 5 Splitter.'),
      h('button.btn.small', { onClick: () => {
        const c = us.filter(u => !u.is_general);
        if (!c.length) return toast('Keine Einheit zum Entlassen.', 'error');
        const refund = u => bw ? Math.floor(unitPoints(u) / 2) : RC.retireRefund(unitPoints(u));
        const sel = select(c.map(u => [u.id, `${u.name} (${unitPoints(u)} Pkt → +${refund(u)} ${cur()})`]), c[0].id);
        const mm = modal('Einheit entlassen', h('div', field('Einheit', sel), h('button.btn.danger', { onClick: async () => {
          const u = c.find(x => x.id === sel.value);
          await ops([{ op: 'remove', id: u.id }, { op: 'player', fields: { vault_delta: refund(u) } }], `entlässt ${u.name} (+${refund(u)} ${cur()}).`);
          mm.close(); note(`${u.name} entlassen`);
        } }, 'Entlassen')));
      } }, 'Ausführen')),
    h('div.action', h('div.action-head', h('strong', 'Verbesserungen verwalten')), h('p.small', 'Artefakte zwischen Helden übertragen oder Verbesserungen entfernen – über „Bearbeiten“ an der Einheit.'),
      h('a.btn.small.ghost', { href: '#/c/armee' }, 'Zur Armee')),
    h('div.action', h('div.action-head', h('strong', 'General wechseln')), h('p.small', 'Der alte General erleidet W3 Kampfwunden und behält seine Verbesserungen.'),
      h('button.btn.small', { onClick: () => {
        const c = us.filter(u => u.is_hero && !u.is_general && u.models <= 1);
        const g = us.find(u => u.is_general);
        if (!c.length || !g) return toast('Kein anderer Held verfügbar.', 'error');
        const sel = select(c.map(u => [u.id, u.name]), c[0].id);
        let w = null;
        const mm = modal('General wechseln', h('div', field('Neuer General', sel), h('p', `${g.name} erleidet: `, diceInput('D3', v => { w = v; })),
          h('button.btn', { onClick: async () => {
            if (w == null) return toast('Bitte W3 würfeln.', 'error');
            const u = c.find(x => x.id === sel.value);
            await ops([{ op: 'update', id: g.id, fields: { is_general: 0, battle_wounds: g.battle_wounds + w } }, { op: 'update', id: u.id, fields: { is_general: 1, auxiliary: 0, regiment_of: null } }],
              `${u.name} wird neuer General; ${g.name} erleidet ${w} Kampfwunden.`);
            mm.close(); note(`${u.name} ist neuer General`);
          } }, 'Wechseln')));
      } }, 'Ausführen')),
    h('div.action', h('div.action-head', h('strong', 'Pfad wechseln')), h('p.small', 'Rang sinkt um 1' + (bw ? ', Ruhm fällt auf das Minimum des neuen Rangs' : '') + '; Fähigkeiten des neuen Pfads neu wählen.'),
      h('button.btn.small', { onClick: () => {
        const c = us.filter(u => u.path && u.rank > 0);
        if (!c.length) return toast('Keine Einheit auf einem Pfad.', 'error');
        const sel = select(c.map(u => [u.id, `${u.name} (${pathById(u.path)?.de || u.path}, ${RANKS[u.rank]})`]), c[0].id);
        const pSel = h('select');
        const fill = () => { const u = c.find(x => x.id === sel.value); pSel.replaceChildren(...pathsFor(pack().id, u).filter(x => x.id !== u.path).map(x => h('option', { value: x.id }, x.de))); };
        sel.addEventListener('change', fill); fill();
        const mm = modal('Pfad wechseln', h('div', field('Einheit', sel), field('Neuer Pfad', pSel), h('button.btn', { onClick: async () => {
          const u = c.find(x => x.id === sel.value); const nr = u.rank - 1;
          const fields = { path: nr > 0 ? pSel.value : null, rank: nr };
          if (bw) fields.renown = BW.rankMin[nr];
          await ops([{ op: 'update', id: u.id, fields, data: { abilities: [] } }], `${u.name} wechselt auf ${pathById(pSel.value)?.de} (Rang ${RANKS[nr]}).`);
          mm.close(); await note(`${u.name}: neuer Pfad`);
          if (nr > 0) { const fresh = myUnits().find(x => x.id === u.id); if (fresh) editUnit(fresh); toast('Jetzt die Fähigkeiten für jeden Rang wählen.', 'info'); }
        } }, 'Wechseln')));
      } }, 'Ausführen')),
  ];
}

// ===================== Blighted Wilds =====================
function oppPoints() {
  const m = ctx.m, r = rep();
  const other = ctx.side === 'a' ? m.player_b : m.player_a;
  if (!other) return Number(r.guest_points) || 0;
  return unitsOf(other).filter(u => unitStatus(m, u) !== 'rest').reduce((a, u) => a + unitPoints(u), 0);
}

function bwStep1() {
  const s = ctx.state.s1;
  const opp = oppPoints(), b = BW.bracket(opp), t = BW.gpTable;
  const g = generalOf(ctx.pid);
  const gAlive = g && !repU(g.id).destroyed;
  const res = ctx.m.result;
  const major = won() && isMajor(), minor = won() && !isMajor();
  const total = t.fought[b] + (major ? t.major[b] : 0) + (minor ? t.minor[b] : 0) + (gAlive ? t.generalAlive[b] : 0);
  const bp = BW.battleplans[ctx.m.battleplan];
  const rewardsOn = bp && (isMajor() || (ctx.m.battleplan === 'A Dense and Choking Maze' && res !== 'draw'));
  const rewardBox = rewardsOn ? h('div.card',
    h('h3', 'Belohnung: ' + ctx.m.battleplan),
    h('p', won() ? 'Du hast gewonnen: wähle Fähigkeits- ODER Sonstige Belohnung. Dein Gegner erhält die andere.' : 'Dein Gegner hat gewonnen und wählt zuerst – du erhältst die Belohnung, die er nicht nimmt.'),
    ctx.m.battleplan === 'A Dense and Choking Maze' && !isMajor() ? h('p.small.muted', 'Kleiner Sieg hier: Der Sieger würfelt – bei 5–6 darf stattdessen der Gegner wählen.') : null,
    h('div.grid2',
      h('div.action' + (s.reward === 'ability' ? '.used' : ''), h('strong', 'Fähigkeit: ' + bp.ability[0]), h('p.small', bp.ability[1] + ' (nur in deiner nächsten Schlacht)'),
        s.reward ? (s.reward === 'ability' ? doneBox('gewählt') : null) : h('button.btn.small', { onClick: async () => {
          await ops([{ op: 'player', fields: { data: { next_ability: `${bp.ability[0]}: ${bp.ability[1]}` } } }], `erhält die Belohnung „${bp.ability[0]}“ für die nächste Schlacht.`);
          s.reward = 'ability'; await saveState(); redraw();
        } }, 'Diese nehmen')),
      h('div.action' + (s.reward === 'misc' ? '.used' : ''), h('strong', 'Sonstige Belohnung'), h('p.small', bp.misc),
        s.reward ? (s.reward === 'misc' ? doneBox('gewählt') : null) : h('button.btn.small', { onClick: async () => { s.reward = 'misc'; await saveState(); redraw(); } }, 'Diese nehmen'))),
    s.reward === 'misc' ? miscRewardActions(ctx.m.battleplan) : null) : null;
  return h('div.stack', h('div.card',
    h('h3', '1. Ruhmespunkte (Glory Points)'),
    h('p', `Armee des Gegners: ${opp} Punkte → Spalte „${t.brackets[b]}“.`),
    h('table.table', h('tbody',
      h('tr', h('td', 'Schlacht geschlagen'), h('td', '+' + t.fought[b])),
      h('tr', h('td', 'Großer Sieg'), h('td', major ? '+' + t.major[b] : '–')),
      h('tr', h('td', 'Kleiner Sieg'), h('td', minor ? '+' + t.minor[b] : '–')),
      h('tr', h('td', 'Dein General wurde nicht erschlagen'), h('td', gAlive ? '+' + t.generalAlive[b] : '–')),
      h('tr.total', h('td', 'Gesamt'), h('td', h('strong', total + ' GP'))))),
    s.applied ? doneBox(`${s.total} GP gutgeschrieben.`) : h('button.btn', { onClick: async () => {
      await ops([{ op: 'player', fields: { vault_delta: total, vault_total_delta: total, data: { next_ability: null } } }], `erhält ${total} Ruhmespunkte (Aftermath Runde ${ctx.m.round}).`);
      s.applied = true; s.total = total; await saveState(); redraw();
    } }, `${total} GP gutschreiben`)), rewardBox);
}

function miscRewardActions(bp) {
  const s = ctx.state.s1;
  const doneMisc = text => { s.misc_done = text; saveState().then(redraw); };
  if (s.misc_done) return doneBox(s.misc_done);
  const btn = (label, fn) => h('button.btn.small', { onClick: fn }, label);
  const items = [];
  if (/Verbesserung/.test(BW.battleplans[bp].misc)) items.push(btn('Verbesserung vergeben', () => enhancementAction(0, () => doneMisc('Verbesserung vergeben'))));
  if (/Zauber/.test(BW.battleplans[bp].misc)) items.push(btn('Zauber/Gebet aufnehmen', () => tomeAction(0, () => doneMisc('Zauber/Gebet aufgenommen'))));
  if (bp === 'Precarious Crossing') items.push(h('span', diceInput('10D6', async v => { await ops([{ op: 'player', fields: { vault_delta: v, vault_total_delta: v } }], `erhält ${v} GP (Precarious Crossing).`); doneMisc(`${v} GP erhalten`); })));
  if (bp === 'Nexuses of Contamination') items.push(btn('W3+3 Kampfwunden heilen', () => healAmountModal('D3+3', 'Nexuses of Contamination', doneMisc)));
  if (bp === 'Vital Alignment') items.push(btn('Narbe entfernen', () => removeScarModal(doneMisc)));
  if (bp === 'Cursed Kernel') items.push(btn('Zweite Favoured Warriors im nächsten Schritt', () => { ctx.state.s2.extraFavoured = true; doneMisc('Zweite Favoured Warriors freigeschaltet'); }));
  if (bp === 'Creeping Rootstalks') items.push(btn('Als erledigt markieren', () => doneMisc('Eigenart/Upgrade notiert (Armee-Details)')));
  return h('div.row.wrap', items);
}

function healAmountModal(expr, why, done) {
  const us = myUnits().filter(u => u.battle_wounds > 0);
  if (!us.length) { toast('Keine Einheit hat Kampfwunden.', 'info'); return done('Keine Wunden zu heilen'); }
  const sel = select(us.map(u => [u.id, `${u.name} (${u.battle_wounds})`]), us[0].id);
  let v = null;
  const mm = modal('Kampfwunden heilen', h('div', field('Einheit', sel), diceInput(expr, x => { v = x; }), h('button.btn', { onClick: async () => {
    if (v == null) return toast('Bitte würfeln.', 'error');
    const u = us.find(x => x.id === sel.value);
    await ops([{ op: 'update', id: u.id, fields: { battle_wounds: Math.max(0, u.battle_wounds - v) } }], `${u.name} heilt ${v} Kampfwunden (${why}).`);
    mm.close(); done(`${u.name} heilt ${v}`);
  } }, 'Heilen')));
}
function removeScarModal(done) {
  const us = myUnits().filter(u => Object.values(u.data.scars || {}).some(Boolean));
  if (!us.length) { toast('Keine Einheit hat Narben.', 'info'); return done('Keine Narbe zu entfernen'); }
  const opts = us.flatMap(u => Object.entries(u.data.scars || {}).filter(([, v]) => v).map(([k, v]) => [u.id + '|' + k, `${u.name}: ${v}`]));
  const sel = select(opts, opts[0][0]);
  const mm = modal('Narbe entfernen', h('div', field('Narbe', sel), h('button.btn', { onClick: async () => {
    const [uid, k] = sel.value.split('|'); const u = us.find(x => x.id === uid);
    const scars = { ...u.data.scars }; delete scars[k];
    await ops([{ op: 'update', id: u.id, data: { scars } }], `${u.name}: Narbe entfernt.`);
    mm.close(); done(`Narbe bei ${u.name} entfernt`);
  } }, 'Entfernen')));
}

function bwStep2() {
  const s = ctx.state.s2;
  s.gain = s.gain || {};
  const us = myUnits().filter(u => repU(u.id).status !== 'rest');
  const g = generalOf(ctx.pid);
  const rows = us.map(u => {
    const r = repU(u.id);
    const base = r.destroyed ? 1 : s.gain[u.id];
    const purify = (r.purify || 0) * 2;
    return h('tr', h('td', u.is_general ? '👑 ' : '', u.name, h('div.tiny.muted', `Ruhm ${u.renown} · ${RANKS[u.rank]}`)),
      h('td', r.destroyed ? '1 (vernichtet)' : s.applied ? String(base) : diceInput('D3', v => { s.gain[u.id] = v; saveState(); }, { value: s.gain[u.id] })),
      h('td', purify ? '+' + purify : '–'));
  });
  const favOpts = us.filter(u => !u.is_general).map(u => [u.id, u.name]);
  const favSel = select([['', '– wählen –'], ...favOpts], s.fav || '', v => { s.fav = v; saveState(); });
  const fav2Sel = s.extraFavoured ? select([['', '– wählen –'], ...favOpts], s.fav2 || '', v => { s.fav2 = v; saveState(); }) : null;
  const rollAll = h('button.btn.small.ghost', { onClick: async () => { us.forEach(u => { if (!repU(u.id).destroyed && s.gain[u.id] == null) s.gain[u.id] = rollDie(3); }); await logDice('Ruhm: W3 für alle überlebenden Einheiten gewürfelt.'); await saveState(); redraw(); } }, '🎲 Alle W3 würfeln');
  const apply = async () => {
    if (us.some(u => !repU(u.id).destroyed && s.gain[u.id] == null)) return toast('Bitte erst für alle Einheiten würfeln.', 'error');
    if (s.fav && s.favRoll == null) return toast('Bitte für die Favoured Warriors würfeln.', 'error');
    const list = [], ups = [];
    for (const u of us) {
      const r = repU(u.id);
      let add = (r.destroyed ? 1 : s.gain[u.id]) + (r.purify || 0) * 2;
      if (s.fav === u.id) add += s.favRoll || 0;
      if (s.fav2 === u.id) add += s.fav2Roll || 0;
      const nr = u.renown + add, newRank = Math.max(u.rank, BW.rankFor(nr));
      list.push({ op: 'update', id: u.id, fields: { renown: nr, rank: newRank } });
      if (newRank > u.rank) ups.push(`${u.name} → ${RANKS[newRank]}`);
    }
    await ops(list, `Ruhm verteilt${ups.length ? '; Rangaufstieg: ' + ups.join(', ') : ''}.`);
    s.applied = true; s.ups = ups; await saveState(); redraw();
  };
  const needPick = myUnits().filter(u => u.rank > 0 && (!u.path || (u.data.abilities || []).filter(Boolean).length < u.rank));
  return h('div.card',
    h('h3', '2. Ruhm (Renown)'),
    h('p.small', 'Jede beteiligte Einheit: +W3 (vernichtet: +1). Purify the Land: +2 je Erfolg. Favoured Warriors (nicht der General): +W6. Ränge: 5 Aspiring · 15 Elite · 30 Mighty · 45 Legendary.'),
    s.applied ? null : rollAll,
    h('table.table', h('thead', h('tr', h('th', 'Einheit'), h('th', 'Ruhm'), h('th', 'Purify'))), h('tbody', rows)),
    h('div.grid2',
      field('Favoured Warriors (+W6)', h('div', favSel, s.applied ? null : diceInput('D6', v => { s.favRoll = v; saveState(); }, { value: s.favRoll }))),
      fav2Sel ? field('Zweite Favoured Warriors (Cursed Kernel)', h('div', fav2Sel, s.applied ? null : diceInput('D6', v => { s.fav2Roll = v; saveState(); }, { value: s.fav2Roll }))) : h('div')),
    s.applied ? doneBox('Ruhm verteilt.' + (s.ups && s.ups.length ? ' Aufstiege: ' + s.ups.join(', ') : '')) : h('button.btn', { onClick: apply }, 'Ruhm verteilen'),
    needPick.length ? h('div.card.highlight', h('strong', 'Pfad/Fähigkeiten wählen: '), needPick.map(u => h('button.btn.small', { onClick: () => editUnit(u) }, u.name))) : null);
}

function bwStep3() {
  const s = ctx.state.s3, used = s.used, p = pl();
  const note = async text => { s.log = [...(s.log || []), text]; await saveState(); redraw(); };
  const markUsed = async (key, text) => { used[key] = text; await saveState(); redraw(); };
  const ingr = { ...(p.data.ingredients || {}) };
  const addIngr = async (name, cost, how) => {
    const next = { ...(pl().data.ingredients || {}) };
    if (name) next[name] = (next[name] || 0) + 1;
    await ops([{ op: 'player', fields: { vault_delta: -cost, data: { ingredients: next } } }], name ? `findet ${name} (${how}, −${cost} GP).` : `findet nichts (${how}, −${cost} GP).`);
    redraw();
  };
  const forage = async (table) => {
    const cost = table === 'basic' ? 5 : 10;
    if (pl().vault < cost) return toast('Nicht genug GP.', 'error');
    const roll = rollDie(6);
    logDice(`Zutatensuche (${table === 'basic' ? 'Einfach' : 'Exotisch'}): ${roll}`);
    const row = BW.ingredients[table].find(r => r[0] === roll);
    const res = row[1];
    if (res && !res.startsWith('pick')) return addIngr(res, cost, `Wurf ${roll}`);
    if (res === null) return addIngr(null, cost, `Wurf ${roll}`);
    const pool = res === 'pick-basic' ? BW.ingredients.basic : res === 'pick-any' ? [...BW.ingredients.basic, ...BW.ingredients.exotic] : BW.ingredients.basic;
    const names = pool.map(r => r[1]).filter(x => x && !x.startsWith('pick'));
    const sel = select(names, names[0]);
    const mm = modal(`Wurf ${roll}: Zutat wählen`, h('div', field('Zutat', sel),
      res === 'pick-or-exotic' ? h('button.btn.ghost', { onClick: async () => {
        mm.close(); const r2 = rollDie(6); logDice(`Exotische Zutat (gratis): ${r2}`);
        const row2 = BW.ingredients.exotic.find(r => r[0] === r2)[1];
        if (row2 && !row2.startsWith('pick')) return addIngr(row2, cost, `Wurf ${roll} → exotisch ${r2}`);
        const pool2 = row2 === 'pick-basic' ? BW.ingredients.basic : [...BW.ingredients.basic, ...BW.ingredients.exotic];
        const n2 = pool2.map(r => r[1]).filter(x => x && !x.startsWith('pick'));
        const s2 = select(n2, n2[0]);
        const m2 = modal(`Exotisch ${r2}: Zutat wählen`, h('div', field('Zutat', s2), h('button.btn', { onClick: async () => { m2.close(); await addIngr(s2.value, cost, `Wahl`); } }, 'Nehmen')));
      } }, 'Stattdessen auf „Exotisch“ würfeln (gratis)') : null,
      h('button.btn', { onClick: async () => { mm.close(); await addIngr(sel.value, cost, `Wurf ${roll}, gewählt`); } }, 'Nehmen')));
  };
  const heroes = myUnits().filter(u => u.is_hero && !(u.data.keywords || '').includes('Einzigartig'));
  const mix = () => {
    const can = BW.concoctions.filter(c => Object.entries(c.recipe).every(([k, n]) => (ingr[k] || 0) >= n));
    if (!can.length) return toast('Für kein Rezept genug Zutaten.', 'error');
    const cSel = select(can.map(c => c.name), can[0].name);
    const hSel = select(heroes.map(u => [u.id, u.name + (u.data.concoction ? ` (hat: ${u.data.concoction})` : '')]), heroes[0]?.id);
    const mm = modal('Trank mischen', h('div', field('Trank', cSel), field('Held', hSel), h('button.btn', { onClick: async () => {
      const c = BW.concoctions.find(x => x.name === cSel.value), u = heroes.find(x => x.id === hSel.value);
      const next = { ...ingr }; Object.entries(c.recipe).forEach(([k, n]) => { next[k] -= n; });
      await ops([{ op: 'player', fields: { data: { ingredients: next } } }, { op: 'update', id: u.id, data: { concoction: c.name, concoction_bought: false } }], `mischt ${c.name} für ${u.name}.`);
      mm.close(); note(`${c.name} gemischt`);
    } }, 'Mischen')));
  };
  const buy = () => {
    const cSel = select(BW.concoctions.map(c => c.name), BW.concoctions[0].name);
    const hSel = select(heroes.map(u => [u.id, u.name]), heroes[0]?.id);
    const mm = modal('Trank kaufen (30 GP)', h('div', field('Trank', cSel), field('Held', hSel), h('p.small.muted', 'Gekaufte Tränke lösen beim Einsatz einen Wurf auf der Nebenwirkungs-Tabelle aus.'), h('button.btn', { onClick: async () => {
      const u = heroes.find(x => x.id === hSel.value);
      await ops([{ op: 'player', fields: { vault_delta: -30 } }, { op: 'update', id: u.id, data: { concoction: cSel.value, concoction_bought: true } }], `kauft ${cSel.value} für ${u.name} (−30 GP).`);
      mm.close(); note(`${cSel.value} gekauft`);
    } }, 'Kaufen (30)')));
  };
  const landmark = () => {
    if (pl().data.landmark) return toast('Du hast schon eine Landmark of Ghyran.', 'error');
    const size = select(BW.landmarkSizes.map(x => [x[0], `${x[0]} (${x[1]} DP, ${x[2]} Pkt)`]), BW.landmarkSizes[0][0]);
    const nm = h('input', { placeholder: 'Name der Landmark' });
    const mm = modal('Landmark of Ghyran', h('div', field('Größe', size), field('Name', nm), h('p.small.muted', 'Die Details (Form, Kurator, Upgrades) baust du nach den Regeln im Buch/Wahapedia und trägst sie in den Armee-Details ein.'),
      h('button.btn', { onClick: async () => {
        const sz = BW.landmarkSizes.find(x => x[0] === size.value);
        await ops([{ op: 'player', fields: { vault_delta: -sz[2], data: { landmark: `${nm.value || 'Landmark'} (${sz[0]}, ${sz[1]} DP, ${sz[2]} Pkt)` } } }], `errichtet die Landmark of Ghyran „${nm.value || 'Landmark'}“ (−${sz[2]} GP).`);
        mm.close(); markUsed('landmark', nm.value || sz[0]);
      } }, 'Kaufen')));
  };
  return h('div.stack',
    h('div.card', h('h3', '3. Roster verwalten'), h('p', 'Im Vorrat: ', h('strong', p.vault + ' GP'), '. Neue Einheit oder Verstärkung kostet GP in Höhe des Punktwerts – nur eines von beiden pro Aftermath.'),
      (s.log || []).length ? h('ul.small', s.log.map(x => h('li', '✓ ' + x))) : null),
    h('div.action-grid',
      h('div.action' + (used.expand ? '.used' : ''), h('div.action-head', h('strong', 'Armee ausbauen'), h('span.cost', '= Punktwert')), h('p.small', '1 neue Einheit (Mindestgröße) ODER 1 Einheit verstärken. Neue Helden führen ein eigenes Regiment (max. 5), sonst Hilfseinheit.'),
        used.expand ? doneBox(used.expand) : h('button.btn.small', { onClick: () => recruitAction(markUsed) }, 'Ausführen')),
      h('div.action' + (used.landmark ? '.used' : ''), h('div.action-head', h('strong', 'Landmark of Ghyran'), h('span.cost', '20 / 70 / 120')), h('p.small', 'Einmalig, wenn du noch keine hast.'),
        used.landmark ? doneBox(used.landmark) : h('button.btn.small', { onClick: landmark }, 'Ausführen')),
      ...commonManageActions(note, true)),
    h('div.card',
      h('h3', '⚗ Zutaten & Tränke (optional)'),
      h('p.small', 'Zutaten sammeln: Einfach 5 GP, Exotisch 10 GP pro Wurf. Tränke mischen (Rezept) oder für 30 GP kaufen. Max. 1 Trank pro Held.'),
      h('p', Object.entries(ingr).filter(([, n]) => n > 0).map(([k, n]) => badge(`${n}× ${k}`)).concat(Object.values(ingr).some(n => n > 0) ? [] : [h('span.muted', 'Keine Zutaten.')])),
      h('div.row.wrap',
        h('button.btn.small', { onClick: () => forage('basic') }, '🎲 Einfache Zutat suchen (5)'),
        h('button.btn.small', { onClick: () => forage('exotic') }, '🎲 Exotische Zutat suchen (10)'),
        h('button.btn.small.ghost', { onClick: mix, disabled: !heroes.length }, 'Trank mischen'),
        h('button.btn.small.ghost', { onClick: buy, disabled: !heroes.length }, 'Trank kaufen (30)')),
      h('details', h('summary', 'Rezepte'), h('ul.small', BW.concoctions.map(c => h('li', h('strong', c.name), ': ', Object.entries(c.recipe).map(([k, n]) => `${n}× ${k}`).join(', '), ' – ', c.fx))))));
}

// ===================== Wunden & Narben (beide) =====================
function step4() {
  const p = pack(), s = ctx.state.s4;
  s.w = s.w || {}; s.tok = s.tok || {}; s.smoul = s.smoul || {}; s.rest = s.rest || {}; s.perm = s.perm || {}; s.permDice = s.permDice || {};
  const us = myUnits();
  const fallen = us.filter(u => casualties(u) > 0);
  const destroyed = us.filter(u => repU(u.id).destroyed && !repU(u.id).untimely);
  const tokenUnits = p.id === 'rc' ? us.filter(u => repU(u.id).token) : [];
  const contaminated = p.id === 'bw' ? us.filter(u => repU(u.id).contaminated) : [];
  const resting = us.filter(u => repU(u.id).status === 'rest');
  const smoulder = p.id === 'rc' ? us.filter(u => /Smouldering/.test((u.data.scars || {}).serious || '')) : [];
  const save = () => saveState();
  const sections = [];
  if (resting.length) sections.push(h('div', h('h4', 'Ruhende Einheiten heilen W6'), resting.map(u => h('p', h('strong', u.name + ': '), s.wounds_applied ? `−${s.rest[u.id]}` : diceInput('D6', v => { s.rest[u.id] = v; save(); }, { value: s.rest[u.id] })))));
  sections.push(h('div', h('h4', 'Gestorbene Modelle: je W6 – bei 1 dauerhaft tot'),
    h('p.tiny.muted', 'Bei 2+ kehrt das Modell zurück. Dauerhaft tote Modelle holt nur „Erholen“ zurück (Hausregel).'),
    fallen.length ? fallen.map(u => {
      const n = casualties(u);
      if (s.wounds_applied) return h('p', h('strong', u.name + ': '), `${n} gestorben → ${s.perm[u.id] || 0} dauerhaft tot`);
      const manual = h('input.tiny-in', { type: 'number', min: 0, max: n, placeholder: 'Einsen', value: s.perm[u.id] ?? '' });
      manual.addEventListener('change', () => { s.perm[u.id] = Math.min(n, Math.max(0, Number(manual.value) || 0)); s.permDice[u.id] = null; save().then(redraw); });
      return h('p', h('strong', u.name + ': '), `${n} Modell${n > 1 ? 'e' : ''} gestorben `,
        h('button.btn.small.dice-btn', { onClick: async () => {
          const dice = Array.from({ length: n }, () => rollDie(6));
          s.permDice[u.id] = dice; s.perm[u.id] = dice.filter(d => d === 1).length;
          logDice(`${u.name}: ${n}×W6 für gestorbene Modelle → ${dice.join(', ')} (${s.perm[u.id]} dauerhaft tot)`);
          await save(); redraw();
        } }, `🎲 ${n}×W6`), h('span.dice-or', ' oder Anzahl Einsen: '), manual,
        s.perm[u.id] != null ? h('strong', ` → ${s.perm[u.id]} dauerhaft tot${s.permDice[u.id] ? ' (' + s.permDice[u.id].join(', ') + ')' : ''}`) : null);
    }) : h('p.muted.small', 'Keine Verluste.')));
  sections.push(h('div', h('h4', 'Vernichtete Einheiten: je W3'), destroyed.length ? destroyed.map(u => h('p', h('strong', u.name + ': '), s.wounds_applied ? `+${s.w[u.id]}` : diceInput('D3', v => { s.w[u.id] = v; save(); }, { value: s.w[u.id] }))) : h('p.muted.small', 'Keine.')));
  if (p.id === 'rc') sections.push(h('div', h('h4', 'Emberstone-Marke am Ende: W6, bei 1–4 eine Kampfwunde'), tokenUnits.length ? tokenUnits.map(u => h('p', h('strong', u.name + ': '), s.wounds_applied ? (s.tok[u.id] <= 4 ? '+1' : 'verschont') : diceInput('D6', v => { s.tok[u.id] = v; save(); }, { value: s.tok[u.id] }))) : h('p.muted.small', 'Keine.')));
  if (p.id === 'bw') sections.push(h('div', h('h4', 'In 3" eines verseuchten Geländes: +1'), contaminated.length ? h('p', contaminated.map(u => u.name).join(', ')) : h('p.muted.small', 'Keine.')));
  if (smoulder.length) sections.push(h('div', h('h4', 'Smouldering Scars: W6, bei 5+ W3 Kampfwunden'), smoulder.map(u => h('p', h('strong', u.name + ': '), s.wounds_applied ? (s.smoul[u.id] ? `+${s.smoul[u.id]}` : '–') : diceInput('D6', async v => { if (v >= 5) { const r = rollDie(3); s.smoul[u.id] = r; toast(`${u.name}: ${r} Kampfwunden`, 'info'); logDice(`${u.name} (Smouldering Scars): ${v} → ${r} Kampfwunden`); } else s.smoul[u.id] = 0; save(); })))));

  const apply = async () => {
    if (destroyed.some(u => s.w[u.id] == null) || tokenUnits.some(u => s.tok[u.id] == null) || resting.some(u => s.rest[u.id] == null) || fallen.some(u => s.perm[u.id] == null)) return toast('Bitte zuerst alle Würfe machen.', 'error');
    const list = [];
    const before = {};
    for (const u of us) {
      let w = u.battle_wounds;
      before[u.id] = w;
      if (s.rest[u.id] != null) w = Math.max(0, w - s.rest[u.id]);
      if (s.w[u.id] != null) w += s.w[u.id];
      if (s.tok[u.id] != null && s.tok[u.id] <= 4) w += 1;
      if (repU(u.id).contaminated && p.id === 'bw') w += 1;
      if (s.smoul[u.id]) w += s.smoul[u.id];
      const op = { op: 'update', id: u.id, fields: { battle_wounds: w, drained: 0 } };
      if (s.perm[u.id]) op.data = { lost: Math.min(fullModels(u), (u.data.lost || 0) + s.perm[u.id]) };
      list.push(op);
    }
    const permTxt = fallen.filter(u => s.perm[u.id]).map(u => `${u.name} −${s.perm[u.id]}`).join(', ');
    await ops(list, 'Kampfwunden bestimmt.' + (permTxt ? ' Dauerhaft tote Modelle: ' + permTxt + '.' : ''));
    s.wounds_applied = true; s.before = before; await saveState(); redraw();
  };

  // Narben
  const scarRows = s.wounds_applied ? us.map(u => {
    const lvl = scarLevelFor(u.battle_wounds);
    if (!lvl) return null;
    if (lvl === 'dead') return h('div.scar-row.dead', h('strong', u.name), ' hat 18+ Kampfwunden und erliegt seinen Verletzungen. ',
      h('button.btn.small.danger', { onClick: () => succumb(u) }, 'Vom Roster streichen'));
    if ((u.data.scars || {})[lvl]) return null;
    const label = SCAR_LEVELS.find(x => x[0] === lvl)[1];
    return h('div.scar-row', h('strong', u.name), ` erreicht ${u.battle_wounds} Kampfwunden – ${label}: `,
      diceInput('D6', async v => {
        const row = rollOnRange(scarTable(p.id)[lvl], v);
        const text = `${row[1]} – ${row[2]}`;
        await ops([{ op: 'update', id: u.id, data: { scars: { ...(u.data.scars || {}), [lvl]: text } } }], `${u.name} erhält eine Narbe (${label}): ${row[1]}.`);
        redraw();
      }));
  }).filter(Boolean) : [];

  // Heilungsrituale
  s.rituals = s.rituals || [];
  const heroes = us.filter(u => u.is_hero);
  const ritualBox = s.wounds_applied ? h('div',
    h('h4', `Heilungsrituale (${s.rituals.length}/2)`),
    s.rituals.map(r => h('p.small', '✓ ' + r)),
    s.rituals.length < 2 && heroes.length ? (() => {
      const hs = select(heroes.filter(x => !s.rituals.some(r => r.startsWith(x.name + ':'))).map(u => [u.id, u.name]));
      return h('div.row.wrap', hs, diceInput('D6', async v => {
        const hero = heroes.find(x => x.id === hs.value);
        if (v === 1) {
          await ops([{ op: 'update', id: hero.id, fields: { drained: 1 } }], `${hero.name}: Heilungsritual misslingt – erschöpft bis Ende der nächsten Schlacht.`);
          s.rituals.push(`${hero.name}: 1 – misslungen, erschöpft`); await saveState(); redraw(); return;
        }
        const wounded = myUnits().filter(x => x.battle_wounds > 0);
        if (!wounded.length) { s.rituals.push(`${hero.name}: ${v} – niemand verwundet`); await saveState(); redraw(); return; }
        const t = select(wounded.map(x => [x.id, `${x.name} (${x.battle_wounds})`]), wounded[0].id);
        const mm = modal(`${hero.name} heilt ${v} Kampfwunden`, h('div', field('Einheit', t), h('button.btn', { onClick: async () => {
          const u = wounded.find(x => x.id === t.value);
          await ops([{ op: 'update', id: u.id, fields: { battle_wounds: Math.max(0, u.battle_wounds - v) } }], `${hero.name} heilt ${Math.min(v, u.battle_wounds)} Kampfwunden bei ${u.name}.`);
          s.rituals.push(`${hero.name}: ${v} – ${u.name} geheilt`); await saveState(); mm.close(); redraw();
        } }, 'Heilen')));
      }, { label: 'würfelt' }));
    })() : null,
    h('p.tiny.muted', p.id === 'bw' ? 'Erschöpft: kein „Purify the Land“, kein Ziel von „Boon of Vitality“.' : 'Erschöpft: −1 auf Zauber-, Gebets- und Trefferwürfe.')) : null;

  return h('div.card',
    h('h3', '4. Kampfwunden, Verluste & Narben'),
    sections,
    s.wounds_applied ? doneBox('Kampfwunden angewendet. Erschöpfung aus der letzten Schlacht ist aufgehoben.') : h('button.btn', { onClick: apply }, 'Kampfwunden anwenden'),
    s.wounds_applied ? h('h4', 'Narben') : null,
    s.wounds_applied ? (scarRows.length ? scarRows : h('p.muted.small', 'Keine neuen Narben.')) : null,
    ritualBox);
}

// ===================== Versorgung (Hausregeln, beide) =====================
function step5() {
  const p = pack(), s = ctx.state.s5 = ctx.state.s5 || {}, m = ctx.m;
  s.jobs = s.jobs || {}; s.feed = s.feed || {};
  const me_ = pl(), us = myUnits();
  const save = () => saveState();
  const jobUnits = us.filter(u => unitJob(u, m.round) !== 'fight');
  const payName = p.id === 'rc' ? 'Gold' : 'GP';
  const jobRows = jobUnits.map(u => {
    const job = unitJob(u, m.round), J = JOBS[job];
    const done = s.jobs[u.id];
    const head = h('strong', `${J.icon} ${u.name} – ${J.label}: `);
    if (done) return h('p', head, done);
    if (job === 'mine') {
      const expr = p.id === 'rc' ? 'D3' : 'D6';
      return h('p', head, diceInput(expr, async v => {
        const gain = p.id === 'rc' ? v : v * 10;
        await ops([{ op: 'player', fields: { vault_delta: gain, vault_total_delta: gain } }], `${u.name} schürft ${gain} ${p.currency.short}.`);
        s.jobs[u.id] = `+${gain} ${p.currency.short}`; await save(); redraw();
      }), p.id === 'bw' ? h('span.tiny.muted', ' × 10 GP') : null);
    }
    if (job === 'forage') {
      return h('p', head, diceInput('D6', async v => {
        const gain = Math.round(livePoints(u) * v * 0.2);
        const list = [{ op: 'player', fields: { data_delta: { food: gain, food_total: gain } } }];
        if (v === 1) list.push({ op: 'update', id: u.id, fields: { battle_wounds: u.battle_wounds + 1 } });
        await ops(list, `${u.name} sammelt ${gain} Nahrung${v === 1 ? ' – Unfall: 1 Kampfwunde' : ''}.`);
        s.jobs[u.id] = `+${gain} Nahrung${v === 1 ? ' (Unfall: 1 Kampfwunde)' : ''}`; await save(); redraw();
      }), h('span.tiny.muted', ` × ${livePoints(u)} Pkt × 20 %`));
    }
    // Erholen: dauerhaft tote Modelle zurückholen
    const lostN = u.data.lost || 0;
    if (!lostN) return h('p', head, 'keine dauerhaft toten Modelle – heilt W6 Kampfwunden (Schritt 4). ', h('button.btn.tiny.ghost', { onClick: async () => { s.jobs[u.id] = 'nichts zurückzuholen'; await save(); redraw(); } }, 'OK'));
    const pm = perModel(u);
    const n = h('input.tiny-in', { type: 'number', min: 0, max: lostN, value: lostN });
    const costTxt = h('span.cost', `${lostN * pm} ${payName}`);
    n.addEventListener('input', () => { costTxt.textContent = `${(Number(n.value) || 0) * pm} ${payName}`; });
    return h('div.scar-row', head, `${lostN} Modell${lostN > 1 ? 'e' : ''} dauerhaft tot · ${pm} Pkt pro Modell. Zurückholen: `, n, ' Kosten: ', costTxt, ' ',
      h('button.btn.small', { onClick: async () => {
        const k = Math.min(lostN, Math.max(0, Number(n.value) || 0));
        if (!k) { s.jobs[u.id] = 'keine Modelle zurückgeholt'; await save(); return redraw(); }
        const cost = k * pm;
        const pay = p.id === 'rc' ? { op: 'player', fields: { data_delta: { gold: -cost } } } : { op: 'player', fields: { vault_delta: -cost } };
        const dice = Array.from({ length: k }, () => rollDie(6));
        const back = dice.filter(d => d > 1).length;
        try {
          await ops([pay, { op: 'update', id: u.id, data: { lost: lostN - back } }], `${u.name}: ${k} Modelle für ${cost} ${payName} – Würfe ${dice.join(', ')} → ${back} kehren zurück.`);
        } catch { return; }
        s.jobs[u.id] = `${k} bezahlt (${cost} ${payName}), Würfe ${dice.join(', ')} → ${back} zurück`; await save(); redraw();
      } }, 'Bezahlen & würfeln'));
  });

  // Gold (nur Ravaged Coast) nach der GP-Tabelle
  let goldBox = null;
  if (p.id === 'rc') {
    const opp = oppPoints(), b = BW.bracket(opp), t = BW.gpTable;
    const g = generalOf(ctx.pid);
    const gAlive = g && !repU(g.id).destroyed;
    const major = won() && isMajor(), minor = won() && !isMajor();
    const gold = t.fought[b] + (major ? t.major[b] : 0) + (minor ? t.minor[b] : 0) + (gAlive ? t.generalAlive[b] : 0);
    goldBox = h('div', h('h4', '🪙 Gold'),
      h('p.small', `Wie Ruhmespunkte: geschlagen ${t.fought[b]}${major ? ' + großer Sieg ' + t.major[b] : ''}${minor ? ' + kleiner Sieg ' + t.minor[b] : ''}${gAlive ? ' + General lebt ' + t.generalAlive[b] : ''} (Gegner ${opp} Pkt).`),
      s.gold ? doneBox(`${s.gold} Gold erhalten.`) : h('button.btn.small', { onClick: async () => {
        await ops([{ op: 'player', fields: { data_delta: { gold: gold, gold_total: gold } } }], `erhält ${gold} Gold.`);
        s.gold = gold; await save(); redraw();
      } }, `${gold} Gold gutschreiben`));
  }

  // Nahrung
  const other = ctx.side === 'a' ? m.player_b : m.player_a;
  const killed = other ? Number((m.report || {})['killed_pts_' + (ctx.side === 'a' ? 'b' : 'a')] || 0) : Number((m.report || {}).guest_killed_points || 0);
  const factor = foodFactor(p.id, me_.location_key);
  const costOf = u => Math.round(livePoints(u) * (100 - factor) / 100);
  us.forEach(u => { if (s.feed[u.id] == null) s.feed[u.id] = true; });
  const stock = me_.data.food ?? S().campaign.points_limit;
  const income = s.loot ? 0 : killed;
  const need = us.filter(u => s.feed[u.id]).reduce((x, u) => x + costOf(u), 0);
  const avail = stock + income;
  const short = need > avail;
  const feedRows = us.filter(u => livePoints(u) > 0).map(u => h('label.check.feed-row',
    h('input', { type: 'checkbox', checked: !!s.feed[u.id], disabled: !!s.fed, onChange: e => { s.feed[u.id] = e.target.checked; save().then(redraw); } }),
    ` ${u.name} – ${costOf(u)} Nahrung`, u.data.hungry ? badge('hungert schon – ohne Futter verlässt sie die Armee!', 'warn') : null));
  const feedBox = h('div',
    h('h4', '🍖 Nahrung'),
    h('table.table.small', h('tbody',
      h('tr', h('td', 'Vorrat'), h('td', String(stock))),
      h('tr', h('td', 'Beute: Punkte getöteter feindlicher Modelle'), h('td', s.loot ? `+${s.loot} (gutgeschrieben)` : '+' + killed)),
      h('tr', h('td', `Feld „${me_.location_key ? (S().locations.find(l => l.key === me_.location_key) || {}).name : 'Lager'}“ deckt`), h('td', factor + ' %')),
      h('tr.total', h('td', 'Bedarf der gefütterten Einheiten'), h('td', h('strong', String(need)))))),
    s.fed ? doneBox(s.fed) : h('div',
      h('p.small', 'Jede Einheit braucht pro Runde so viel Nahrung, wie ihre lebenden Modelle Punkte kosten (abzüglich des Feld-Anteils). Wer nicht gefüttert wird, hungert; hungert sie zwei Runden hintereinander, verlässt sie die Armee.'),
      feedRows,
      short ? h('p.problems', `⚠ Es fehlen ${need - avail} Nahrung – nimm Einheiten aus der Fütterung.`) : null,
      h('button.btn', { disabled: short, onClick: async () => {
        const list = [{ op: 'player', fields: { data_delta: { food: income - need, food_total: income } } }];
        const gone = [], hungry = [];
        for (const u of us) {
          if (livePoints(u) <= 0) continue;
          if (s.feed[u.id]) { if (u.data.hungry) list.push({ op: 'update', id: u.id, data: { hungry: false } }); continue; }
          if (u.data.hungry) { list.push({ op: 'remove', id: u.id }); gone.push(u.name); }
          else { list.push({ op: 'update', id: u.id, data: { hungry: true } }); hungry.push(u.name); }
        }
        const txt = `Versorgung: +${income} Beute, −${need} Verbrauch.` + (hungry.length ? ' Hungern: ' + hungry.join(', ') + '.' : '') + (gone.length ? ' Verlassen die Armee: ' + gone.join(', ') + '.' : '');
        await ops(list, txt);
        s.loot = income; s.fed = txt; await save(); redraw();
      } }, 'Versorgung abrechnen')));

  return h('div.card',
    h('h3', '5. Versorgung & Aufträge'),
    h('h4', 'Aufträge dieser Runde'),
    jobRows.length ? jobRows : h('p.muted.small', 'Keine Einheit hatte einen Auftrag. Aufträge vergibst du zu Beginn jeder Runde unter „Lage“ oder „Armee“.'),
    goldBox, feedBox);
}

async function succumb(u) {
  if (!(await confirmBox(`${u.name} vom Roster streichen? Verbesserungen gehen verloren.`, 'Streichen'))) return;
  const list = [{ op: 'remove', id: u.id }];
  if (u.is_general) {
    const heroes = myUnits().filter(x => x.is_hero && x.id !== u.id);
    if (!heroes.length) { await ops(list, `${u.name} erliegt seinen Wunden. Ohne Helden endet die Geschichte dieser Armee.`); toast('Kein Held mehr – deine Armee löst sich auf. Du kannst mit einer neuen Armee weitermachen.', 'error'); return redraw(); }
    await ops(list, `${u.name} erliegt seinen Wunden.`);
    const sel = select(heroes.map(x => [x.id, x.name]), heroes[0].id);
    const mm = modal('Neuer General', h('div', h('p', 'Dein General ist gefallen. Wähle einen neuen.'), field('Held', sel), h('button.btn', { onClick: async () => {
      const x = heroes.find(y => y.id === sel.value);
      const fields = { is_general: 1, auxiliary: 0, regiment_of: null };
      if (!x.path) { fields.rank = 1; if (pack().id === 'bw' && !x.renown) fields.renown = 5; }
      await ops([{ op: 'update', id: x.id, fields }], `${x.name} wird neuer General.`);
      mm.close(); if (!x.path) { const fresh = myUnits().find(y => y.id === x.id); toast('Wähle jetzt kostenlos einen Pfad (Aspiring).', 'info'); if (fresh) editUnit(fresh); } else redraw();
    } }, 'Bestätigen')));
    return;
  }
  await ops(list, `${u.name} erliegt seinen Wunden und wird vom Roster gestrichen.`);
  redraw();
}
