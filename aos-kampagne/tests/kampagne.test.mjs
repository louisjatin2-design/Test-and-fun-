// Kampagnenablauf: Runden, Begegnungen, Ergebnisse, Fortschritt und Finale nach den Battlepack-Regeln.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, Client, master, startedCampaign, moveAll, finishAftermaths } from './helpers.mjs';
import { makeD1 } from './d1.mjs';
import { handle } from '../src/server.js';
import { SCHEMA } from '../src/schema.js';
import { render } from '../tools/build_schema.mjs';
import { encounterTable, battleplanChoices, isFinal, allowedTargets, discoverRoutes, PACKS } from '../public/js/packs.js';
import { livePoints, aliveModels, unitStatus, battleSnapshot, campaignProgress } from '../public/js/core.js';

const me = (st, c) => st.players.find(p => p.id === c.id);
const sideOf = (m, c) => (m.player_a === c.id ? 'a' : 'b');
const winFor = (m, c) => sideOf(m, c);

// Spielt eine Runde: alle ziehen, Ergebnis je Spiel über pick(match), alle Aftermaths abschließen.
async function playRound(players, targets, pick) {
  const ms = await moveAll(players, targets);
  for (const m of ms) {
    const actor = players.find(p => p.id === m.player_a);
    const r = pick(m);
    await actor.ok('match/' + m.id, { op: 'result', ...r });
    await finishAftermaths(players, m);
  }
  return ms;
}

test('eine komplette Runde: ziehen, Begegnung, Ergebnis, Rückzug, Aftermath, nächste Runde', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  let st = await a.state();
  assert.equal(st.campaign.phase, 'move');
  assert.equal(st.campaign.current_round, 1);
  assert.deepEqual(st.players.map(p => p.location_key), ['o1', 'o4']);
  await a.ok('move', { target: 'o3' });
  assert.equal((await a.state()).campaign.phase, 'move', 'erst wenn alle gezogen haben, wird aufgedeckt');
  await a.ok('move', { target: 'o2' }); // umentscheiden ist bis zum Aufdecken erlaubt
  await a.ok('move', { target: 'o3' });
  await b.ok('move', { target: 'o3' });
  st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.equal(st.matches.length, 1);
  const m = st.matches[0];
  assert.equal(m.kind, 'pvp'); assert.equal(m.table_key, 'outskirts'); assert.equal(m.location_a, 'o3');
  assert.equal((await a.post('move', { target: 'o2' })).status, 400, 'in der Schlachtphase wird nicht gezogen');
  // Aufstellung: jeder stellt eigene Einheiten in Reserve, ohne den anderen zu überschreiben
  const ua = st.units.find(u => u.player_id === a.id && !u.is_hero), ub = st.units.find(u => u.player_id === b.id && !u.is_hero);
  await a.ok('match/' + m.id, { op: 'setup', report: { units: { [ua.id]: { status: 'reserve' } } } });
  await b.ok('match/' + m.id, { op: 'setup', report: { units: { [ub.id]: { status: 'reserve' } } }, battleplan: 'Light the Fires' });
  st = await a.state();
  assert.equal(st.matches[0].report.units[ua.id].status, 'reserve');
  assert.equal(st.matches[0].report.units[ub.id].status, 'reserve');
  // Ergebnis: Sieger = wer auch immer Seite „a“ ist
  const winner = [a, b].find(p => p.id === m.player_a), loser = [a, b].find(p => p.id !== m.player_a);
  await winner.ok('match/' + m.id, { op: 'result', result: 'a', vp_a: 9, vp_b: 4, report: { units: { [st.units.find(u => u.player_id === loser.id && !u.is_hero).id]: { destroyed: true } } } });
  st = await a.state();
  assert.equal(me(st, winner).wins, 1); assert.equal(me(st, loser).losses, 1);
  assert.equal(me(st, winner).location_key, 'o3');
  assert.equal(me(st, loser).location_key, loser === a ? 'o1' : 'o4', 'der Verlierer zieht sich auf sein vorheriges Feld zurück');
  assert.equal(st.locations.find(l => l.key === 'o3').owner_player_id, winner.id);
  assert.deepEqual(me(st, winner).data.won_tables, ['outskirts']);
  const rep = st.matches[0].report;
  assert.equal(rep.snapshot, true);
  assert.ok(rep.army_pts_a > 0 && rep.army_pts_b > 0);
  assert.ok(rep['killed_pts_' + sideOf(m, loser)] > 0, 'vernichtete Einheit zählt als Beute für den Gegner');
  // Aftermath: erst wenn beide fertig sind, geht es weiter
  await winner.ok('match/' + m.id, { op: 'aftermath', side: sideOf(m, winner), state: { step: 3 }, done: true });
  assert.equal((await a.state()).campaign.phase, 'battle');
  await loser.ok('match/' + m.id, { op: 'aftermath', side: sideOf(m, loser), state: {}, done: true });
  st = await a.state();
  assert.equal(st.campaign.phase, 'move'); assert.equal(st.campaign.current_round, 2);
  // ein abgeschlossener Aftermath bleibt abgeschlossen und schaltet nicht noch einmal weiter
  await loser.ok('match/' + m.id, { op: 'aftermath', side: sideOf(m, loser), state: {}, done: false });
  await loser.ok('match/' + m.id, { op: 'aftermath', side: sideOf(m, loser), state: {}, done: true });
  st = await a.state();
  assert.equal(st.campaign.current_round, 2);
  assert.equal(st.matches[0].done_a && st.matches[0].done_b, 1);
});

test('gleichzeitige Züge erzeugen genau eine Begegnung, gleichzeitige Aftermaths genau einen Rundenwechsel', async () => {
  for (let i = 0; i < 5; i++) {
    const env = makeEnv();
    const { players } = await startedCampaign(env, { n: 4 });
    await Promise.all(players.map((p, k) => p.post('move', { target: ['o3', 'o3', 'o6', 'o6'][k] })));
    let st = await players[0].state();
    assert.equal(st.campaign.phase, 'battle');
    assert.equal(st.matches.length, 2, 'keine doppelten Spiele');
    for (const m of st.matches) await players.find(p => p.id === m.player_a).ok('match/' + m.id, { op: 'result', result: 'draw', battleplan: 'Light the Fires' });
    const calls = [];
    for (const m of st.matches) for (const p of players) if (p.id === m.player_a || p.id === m.player_b) calls.push(p.post('match/' + m.id, { op: 'aftermath', side: sideOf(m, p), state: {}, done: true }));
    await Promise.all(calls);
    st = await players[0].state();
    assert.equal(st.campaign.current_round, 2, 'die Runde springt nicht doppelt weiter');
    assert.equal(st.campaign.phase, 'move');
  }
});

test('Paarung: gleiches Feld = Duell, Alleinstehende werden gepaart, bei ungerader Zahl kommt ein Gastspieler', async () => {
  const env = makeEnv();
  const { players } = await startedCampaign(env, { n: 3 });
  const ms = await moveAll(players, ['o3', 'o3', 'o8']);
  assert.deepEqual(ms.map(m => m.kind).sort(), ['guest', 'pvp']);
  const guest = ms.find(m => m.kind === 'guest');
  assert.equal(guest.player_b, null); assert.equal(guest.player_a, players[2].id);
  // Gastspiel: nur ein Aftermath nötig
  await players[2].ok('match/' + guest.id, { op: 'result', result: 'b', battleplan: 'Rift in the Peaks', report: { guest_points: 900, guest_killed_points: 200 } });
  let st = await players[0].state();
  assert.equal(me(st, players[2]).losses, 1);
  assert.equal(st.matches.find(m => m.id === guest.id).report.guest_points, 900);
  assert.equal((await players[2].post('match/' + guest.id, { op: 'aftermath', side: 'b', state: {}, done: true })).status, 400);

  const env2 = makeEnv();
  const four = await startedCampaign(env2, { n: 4 });
  const ms2 = await moveAll(four.players, ['o1', 'o4', 'o7', 'o8']); // jeder bleibt allein
  assert.deepEqual(ms2.map(m => m.kind), ['pair', 'pair']);
});

test('Ergebnis korrigieren: nichts wird doppelt gezählt, der Rückzug dreht sich mit um', async () => {
  const env = makeEnv();
  const m0 = await master(env);
  const { camp, players: [a, b] } = await startedCampaign(env);
  const [m] = await moveAll([a, b], ['o3', 'o3']);
  const pa = [a, b].find(p => p.id === m.player_a), pb = [a, b].find(p => p.id === m.player_b);
  const home = p => (p === a ? 'o1' : 'o4');
  await pa.ok('match/' + m.id, { op: 'result', result: 'a', battleplan: 'Light the Fires' });
  // Vertippt! Solange kein Aftermath begonnen hat, darf ein Beteiligter korrigieren
  await pb.ok('match/' + m.id, { op: 'result', result: 'b', battleplan: 'Light the Fires' });
  let st = await a.state();
  assert.deepEqual([me(st, pa).wins, me(st, pa).losses, me(st, pb).wins, me(st, pb).losses], [0, 1, 1, 0]);
  assert.equal(me(st, pa).location_key, home(pa)); assert.equal(me(st, pb).location_key, 'o3');
  assert.equal(me(st, pa).data.won_tables.length, 0); assert.deepEqual(me(st, pb).data.won_tables, ['outskirts']);
  assert.equal(st.locations.find(l => l.key === 'o3').owner_player_id, pb.id);
  assert.ok(st.events.some(e => /Ergebnis korrigiert/.test(e.text)));
  // Sobald ein Aftermath läuft, nur noch der Master
  await pb.ok('match/' + m.id, { op: 'aftermath', side: 'b', state: { step: 2 }, done: false });
  assert.equal((await pa.post('match/' + m.id, { op: 'result', result: 'a', battleplan: 'Light the Fires' })).status, 400);
  m0.cid = camp.id;
  await m0.ok('match/' + m.id, { op: 'result', result: 'draw', battleplan: 'Light the Fires' });
  st = await a.state();
  assert.deepEqual([me(st, pa).wins, me(st, pa).draws, me(st, pa).losses, me(st, pb).wins, me(st, pb).draws], [0, 1, 0, 0, 1]);
  assert.equal(me(st, pa).location_key, 'o3'); assert.equal(me(st, pb).location_key, 'o3');
  assert.equal(st.locations.find(l => l.key === 'o3').owner_player_id, null);
});

test('Ravaged Coast: Zonen schalten nach den Battlepack-Regeln frei', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  // Runde 1: Unentschieden in den Outskirts → noch kein Zugang zu Gnaw's Edge
  let ms = await playRound([a, b], ['o2', 'o3'], () => ({ result: 'draw', battleplan: 'Light the Fires' }));
  assert.equal(ms[0].kind, 'pair');
  let st = await a.state();
  assert.ok(!allowedTargets('rc', me(st, a)).includes('g1'));
  // 20 Splitter insgesamt → Gnaw's Edge offen (nur für a)
  await a.ok('roster', { ops: [{ op: 'player', fields: { vault_delta: 20, vault_total_delta: 20 } }], log: 'sammelt Splitter' });
  st = await a.state();
  assert.ok(allowedTargets('rc', me(st, a)).includes('g1'));
  assert.ok(!allowedTargets('rc', { ...me(st, b), location_key: 'o5' }).includes('g2'), 'b hat keine 20 Splitter');
  // Runde 2: a nach Gnaw's Edge, b bleibt in den Outskirts
  await b.ok('move', { target: 'o5' }); await a.ok('move', { target: 'g1' });
  st = await a.state();
  let m = st.matches.find(x => x.round === 2);
  // offizielle Regel: Es reicht, wenn EINER der beiden Gnaw's Edge freigeschaltet hat
  assert.equal(m.kind, 'pair'); assert.equal(m.table_key, 'gnaw');
  assert.deepEqual(battleplanChoices('rc', m), ['Twisted by Rage', 'Storm the Land Bridge']);
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, a), battleplan: 'Twisted by Rage' });
  await finishAftermaths([a, b], m);
  st = await a.state();
  assert.deepEqual(me(st, a).data.won_tables, ['gnaw']);
  assert.ok(allowedTargets('rc', me(st, a)).includes('g4'));
  assert.ok(allowedTargets('rc', { ...me(st, a), location_key: 'g4' }).includes('h1'), 'Sieg mit Gnaw\'s-Edge-Plan öffnet die Hateful Shores');
  assert.ok(!allowedTargets('rc', { ...me(st, a), location_key: 'h1' }).includes('c1'), 'Hel\'s Claw bleibt zu');
  // Runde 3: a zieht an den Rand des Gnaw (noch Gnaw's Edge)
  await playRound([a, b], ['g4', 'o5'], () => ({ result: 'draw', battleplan: 'Storm the Land Bridge' }));
  // Runde 4: a in die Hateful Shores → Tabelle Hateful Shores; b gewinnt dort, ohne selbst dort zu stehen
  await a.ok('move', { target: 'h1' }); await b.ok('move', { target: 'o5' });
  st = await a.state(); m = st.matches.find(x => x.round === 4);
  assert.equal(m.table_key, 'shores');
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, b), battleplan: 'Assault on the Sea Cave' });
  await finishAftermaths([a, b], m);
  st = await a.state();
  assert.deepEqual(me(st, b).data.won_tables, ['shores']);
  // Runde 5: a hat in den Shores noch nicht gewonnen → Hel's Claw gesperrt; diesmal gewinnt a
  assert.equal((await a.post('move', { target: 'c1' })).status, 400);
  await a.ok('move', { target: 'h1' }); await b.ok('move', { target: 'o5' });
  st = await a.state(); m = st.matches.find(x => x.round === 5);
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, a), battleplan: 'Along the Crumbling Coast' });
  await finishAftermaths([a, b], m);
  // Runde 6: a geht allein nach Hel's Claw → kein Finale, weil b nicht dort steht
  await a.ok('move', { target: 'c1' }); await b.ok('move', { target: 'o5' });
  st = await a.state(); m = st.matches.find(x => x.round === 6);
  assert.equal(m.table_key, 'shores', 'Finale nur, wenn beide Spieler in Hel\'s Claw stehen');
  assert.equal((await a.post('match/' + m.id, { op: 'result', result: winFor(m, a), battleplan: "Raid on Hel's Claw" })).status, 400);
  await a.ok('match/' + m.id, { op: 'result', result: 'draw', battleplan: 'Beneath the Shadow of Brazenskull' });
  st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.deepEqual([me(st, a).wins, me(st, a).draws, me(st, a).losses], [2, 3, 1]);
});

test('Ravaged Coast: großer Sieg im Finale gewinnt die Kampagne – ein Unentschieden nicht', async () => {
  const env = makeEnv();
  const m0 = await master(env);
  const { camp, players: [a, b] } = await startedCampaign(env);
  // Beide direkt nach Hel's Claw stellen und freischalten (Abkürzung über die Datenbank)
  for (const p of [a, b]) env.DB.raw.prepare("UPDATE players SET location_key='h1', vault_total=30, data=json_set(data,'$.won_tables',json('[\"gnaw\",\"shores\"]')) WHERE id=?").run(p.id);
  let [m] = await moveAll([a, b], ['c1', 'c1']);
  assert.equal(m.kind, 'pvp'); assert.equal(m.table_key, 'claw'); assert.equal(m.battleplan, "Raid on Hel's Claw");
  await a.ok('match/' + m.id, { op: 'result', result: 'draw' });
  let st = await a.state();
  assert.equal(st.campaign.phase, 'battle'); assert.equal(st.campaign.winner_player_id, null);
  // Korrektur durch einen Beteiligten: doch ein großer Sieg
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, b) });
  st = await a.state();
  assert.equal(st.campaign.phase, 'finished'); assert.equal(st.campaign.winner_player_id, b.id);
  assert.equal(me(st, b).data.trophy, true); assert.equal(me(st, a).data.trophy, undefined);
  assert.ok(st.events.some(e => /gewinnt die Kampagne/.test(e.text)));
  // Master nimmt den Sieg nach einem Irrtum zurück
  m0.cid = camp.id;
  await m0.ok('match/' + m.id, { op: 'result', result: 'draw' });
  st = await a.state();
  assert.equal(st.campaign.phase, 'battle'); assert.equal(st.campaign.winner_player_id, null);
  assert.equal(me(st, b).data.trophy, undefined);
  // In eine beendete Kampagne kann niemand mehr einsteigen
  await m0.ok('match/' + m.id, { op: 'result', result: winFor(m, a) });
  assert.equal((await new Client(env, '10.7.7.7').post(`lobby/${camp.invite_code}/claim`, { slot: 3, name: 'Spät', pin: '1234' })).status, 400);
});

test('Finale gegen einen Gastspieler zählt nur, wenn die Kampagne es erlaubt', async () => {
  for (const guestFinal of [false, true]) {
    const env = makeEnv();
    const m0 = await master(env);
    const { camp, players } = await startedCampaign(env, { n: 3 });
    if (guestFinal) await m0.ok('admin/campaign/' + camp.id, { action: 'settings', guest_final: true });
    const [a, b, c] = players;
    env.DB.raw.prepare("UPDATE players SET location_key='h1', vault_total=30, data=json_set(data,'$.won_tables',json('[\"gnaw\",\"shores\"]')) WHERE id=?").run(c.id);
    const ms = await moveAll(players, ['o3', 'o3', 'c1']);
    const g = ms.find(m => m.kind === 'guest');
    assert.equal(g.table_key, guestFinal ? 'claw' : 'shores');
    const r = await c.post('match/' + g.id, { op: 'result', result: 'a', battleplan: "Raid on Hel's Claw" });
    assert.equal(r.status, guestFinal ? 200 : 400);
    assert.equal((await a.state()).campaign.phase, guestFinal ? 'finished' : 'battle');
  }
});

test('Blighted Wilds: Routen werden durch Kämpfen und Siegen entdeckt', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env, { pack: 'bw' });
  let st = await a.state();
  assert.deepEqual(me(st, a).data.unlocked, ['tb', 'ff']);
  assert.equal(me(st, a).location_key, null);
  assert.equal((await a.post('move', { target: 'ck' })).status, 400, 'Cursed Kernel ist noch nicht entdeckt');
  // Runde 1: beide wählen Thyria's Bounty; a gewinnt (kleiner Sieg)
  let [m] = await moveAll([a, b], ['tb', 'tb']);
  assert.equal(m.kind, 'pvp'); assert.equal(m.battleplan, "Thyria's Bounty");
  assert.equal((await a.post('match/' + m.id, { op: 'setup', battleplan: 'Cursed Kernel' })).status, 400, 'nur Pläne, die beide freigeschaltet haben');
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, a) + '_minor' });
  await finishAftermaths([a, b], m);
  st = await a.state();
  // Thyrian Paths von Thyria's Bounty: Dense Maze + Cursed Kernel – für beide (gekämpft)
  for (const p of [a, b]) assert.deepEqual([...me(st, p).data.unlocked].sort(), ['ck', 'dm', 'ff', 'tb']);
  // Runde 2: Cursed Kernel; die Concealed Trails entdeckt nur der Sieger
  [m] = await moveAll([a, b], ['ck', 'ck']);
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, b) });
  await finishAftermaths([a, b], m);
  st = await a.state();
  assert.ok(me(st, b).data.unlocked.includes('nc') && me(st, b).data.unlocked.includes('pc'));
  assert.ok(!me(st, a).data.unlocked.includes('nc') && !me(st, a).data.unlocked.includes('pc'));
  // Runde 3: getrennte Felder → Paarung; Vorschlag ist ein Plan, den beide haben
  [m] = await moveAll([a, b], ['dm', 'nc']);
  assert.equal(m.kind, 'pair');
  assert.equal(m.battleplan, 'A Dense and Choking Maze');
  assert.ok(!battleplanChoices('bw', m, me(st, a).data, me(st, b).data).includes('Nexuses of Contamination'));
  assert.equal((await b.post('match/' + m.id, { op: 'result', result: 'a', battleplan: 'Nexuses of Contamination' })).status, 400);
  await a.ok('match/' + m.id, { op: 'result', result: 'draw' });
  st = await a.state();
  assert.ok(me(st, a).data.unlocked.includes('nc'), 'Thyrian Path vom Dense Maze führt zu den Nexuses – auch ohne Sieg');
});

test('Blighted Wilds: das Finale braucht beide Spieler und einen großen Sieg', async () => {
  const env = makeEnv();
  const { camp, players: [a, b] } = await startedCampaign(env, { pack: 'bw' });
  // Vorgeschichte: ein Sieg mit „Vital Alignment“ legt den Concealed Trail zum Finale frei.
  // (Der Server berechnet die Routen aus dem Spielverlauf – also tragen wir echte Spiele ein.)
  const won = (id, p) => {
    env.DB.raw.prepare("INSERT INTO matches (id, campaign_id, round, kind, player_a, guest_name, table_key, battleplan, status, result, done_a, done_b, finished_at) VALUES (?,?,0,'guest',?,'Gast','bw','Vital Alignment','done','a',1,1,'2026-01-01')").run(id, camp.id, p.id);
    env.DB.raw.prepare("UPDATE players SET data=json_set(data,'$.unlocked',json('[\"tb\",\"ff\",\"cr\",\"bp\"]')) WHERE id=?").run(p.id);
  };
  won('1'.repeat(32), a);
  // nur a hat das Finale freigeschaltet → es steht nicht zur Wahl
  let [m] = await moveAll([a, b], ['bp', 'tb']);
  assert.equal(m.kind, 'pair');
  assert.equal(m.battleplan, "Thyria's Bounty");
  assert.equal((await a.post('match/' + m.id, { op: 'result', result: winFor(m, a), battleplan: 'Be It Purity or Putrescence' })).status, 400);
  await a.ok('match/' + m.id, { op: 'result', result: 'draw' });
  await finishAftermaths([a, b], m);
  let st = await a.state();
  assert.ok(me(st, a).data.unlocked.includes('bp'), 'der Fortschritt aus der Vorgeschichte bleibt erhalten');
  assert.ok(!me(st, b).data.unlocked.includes('bp'));
  won('2'.repeat(32), b);
  [m] = await moveAll([a, b], ['bp', 'bp']);
  assert.equal(m.battleplan, 'Be It Purity or Putrescence');
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, a) + '_minor' });
  assert.equal((await a.state()).campaign.phase, 'battle', 'ein kleiner Sieg beendet die Kampagne nicht');
  await a.ok('match/' + m.id, { op: 'result', result: winFor(m, a) });
  st = await a.state();
  assert.equal(st.campaign.phase, 'finished'); assert.equal(st.campaign.winner_player_id, a.id);
});

test('Master: Züge erzwingen, Runde weiterschalten, Spieler entfernen hält die Kampagne am Laufen', async () => {
  const env = makeEnv();
  const m0 = await master(env);
  const { camp, players: [a, b, c] } = await startedCampaign(env, { n: 3 });
  await a.ok('move', { target: 'o3' });
  await m0.ok('admin/campaign/' + camp.id, { action: 'force_resolve' });
  let st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.equal(me(st, b).location_key, 'o4', 'wer nicht gezogen hat, bleibt stehen');
  assert.equal((await m0.post('admin/campaign/' + camp.id, { action: 'force_resolve' })).status, 400);
  await m0.ok('admin/campaign/' + camp.id, { action: 'force_next' });
  st = await a.state();
  assert.equal(st.campaign.current_round, 2); assert.equal(st.campaign.phase, 'move');
  assert.ok(st.matches.every(m => m.result === 'void'));
  assert.deepEqual([me(st, a).wins, me(st, a).draws, me(st, a).losses], [0, 0, 0], 'annullierte Spiele zählen nicht');
  // a und b haben gezogen, c fehlt und wird entfernt → es wird automatisch aufgedeckt
  await a.ok('move', { target: 'o3' }); await b.ok('move', { target: 'o3' });
  await m0.ok('admin/campaign/' + camp.id, { action: 'kick', player_id: c.id });
  st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.equal(st.matches.filter(m => m.round === 2).length, 1);
  // hängengebliebene Aufdeckung lässt sich neu anstoßen
  env.DB.raw.prepare("UPDATE campaigns SET phase='resolving' WHERE id=?").run(camp.id);
  env.DB.raw.prepare('DELETE FROM matches WHERE campaign_id=? AND round=2').run(camp.id);
  await m0.ok('admin/campaign/' + camp.id, { action: 'force_resolve' });
  st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.equal(st.matches.filter(m => m.round === 2).length, 1);
});

test('Kampagne startet nur mit mindestens zwei fertigen Rostern – und nur einmal', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env, { start: false });
  env.DB.raw.prepare('UPDATE players SET roster_locked=0 WHERE id=?').run(b.id);
  assert.match((await a.post('start', {})).body.error, /Noch nicht fertig/);
  env.DB.raw.prepare('UPDATE players SET roster_locked=1 WHERE id=?').run(b.id);
  const rs = await Promise.all([a.post('start', {}), b.post('start', {})]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 400]);
  const st = await a.state();
  assert.equal(st.campaign.current_round, 1);
  assert.equal(st.events.filter(e => /hat die Kampagne gestartet/.test(e.text)).length, 1);
});

test('Spielbericht: Stand beim Ergebnis wird festgehalten und ändert sich später nicht mehr', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  let st = await a.state();
  const troop = st.units.find(u => u.player_id === a.id && u.name.startsWith('Trupp')); // 150 Pkt, 10 Modelle
  const garde = st.units.find(u => u.player_id === a.id && u.name.startsWith('Garde'));
  // Auftrag: die Garde sammelt Nahrung und fehlt in der Schlacht
  await a.ok('roster', { ops: [{ op: 'update', id: garde.id, data: { job: { round: 1, type: 'forage' } } }] });
  const [m] = await moveAll([a, b], ['o3', 'o3']);
  const s = sideOf(m, a);
  await a.ok('match/' + m.id, { op: 'result', result: 'draw', battleplan: 'Light the Fires', report: { units: { [troop.id]: { lost: 4 }, [garde.id]: { destroyed: true } } } });
  st = await a.state();
  const rep = st.matches[0].report;
  assert.equal(rep['army_pts_' + s], 250, 'Held 100 + Trupp 150; die Garde ist auf Auftrag');
  assert.equal(rep['killed_pts_' + s], 60, '4 von 10 Modellen à 15 Punkte');
  assert.equal(rep.units[troop.id].alive_at_battle, 10);
  assert.equal(rep.units[garde.id], undefined, 'wer nicht mitkämpft, kann nicht fallen');
  // Später: dauerhafte Verluste und eine neu rekrutierte Einheit ändern den festgehaltenen Stand nicht
  await a.ok('roster', { ops: [{ op: 'update', id: troop.id, data: { lost: 3 } }, { op: 'add', unit: { name: 'Neue', points: 200, models: 5 } }] });
  st = await a.state();
  const m2 = st.matches[0];
  const neu = st.units.find(u => u.name === 'Neue');
  assert.equal(unitStatus(m2, neu), 'absent');
  assert.equal(unitStatus(m2, st.units.find(u => u.id === troop.id)), 'field');
  assert.equal(unitStatus(m2, st.units.find(u => u.id === garde.id)), 'forage');
  assert.equal(m2.report['army_pts_' + s], 250);
});

// ---------- Regel-Bausteine ----------
test('Schlachtplan-Tabelle je Begegnung (Ravaged Coast)', () => {
  assert.equal(encounterTable('pvp', 'outskirts', 'outskirts'), 'outskirts');
  assert.equal(encounterTable('pair', 'outskirts', 'gnaw'), 'gnaw');
  assert.equal(encounterTable('pair', 'shores', 'outskirts'), 'shores');
  assert.equal(encounterTable('pair', 'claw', 'outskirts'), 'shores', 'Hel\'s Claw braucht beide');
  assert.equal(encounterTable('pvp', 'claw', 'claw'), 'claw');
  assert.equal(encounterTable('guest', 'gnaw'), 'gnaw');
  assert.equal(encounterTable('guest', 'claw'), 'shores');
  assert.equal(encounterTable('guest', 'claw', null, true), 'claw');
  assert.equal(isFinal('rc', { table_key: 'outskirts', player_b: 'x' }, "Raid on Hel's Claw"), false);
  assert.equal(isFinal('rc', { table_key: 'claw', player_b: 'x' }, "Raid on Hel's Claw"), true);
  assert.equal(isFinal('rc', { table_key: 'claw', player_b: null }, "Raid on Hel's Claw"), false);
  assert.equal(isFinal('bw', { player_b: null }, 'Be It Purity or Putrescence', { guest_final: true }), true);
});

test('das Routennetz von Blighted Wilds entspricht der Battlepack-Karte', () => {
  const links = PACKS.bw.links.map(l => `${l.from}>${l.to}:${l.type}`).sort();
  assert.deepEqual(links, ['ck>nc:trail', 'ck>pc:trail', 'cr>bp:trail', 'cr>va:path', 'cs>cr:path', 'cs>ef:path', 'dm>nc:path', 'ef>cs:path', 'ef>va:path', 'ew>pc:path',
    'ff>ck:path', 'ff>ew:path', 'nc>cs:path', 'nc>ef:path', 'nc>pc:path', 'pc>cs:path', 'pc>ef:path', 'pc>nc:path', 'tb>ck:path', 'tb>dm:path', 'va>bp:trail', 'va>cr:path'].sort());
  // Das Finale ist nur über Concealed Trails erreichbar: ohne Sieg in Vital Alignment/Creeping Rootstalks bleibt es zu
  let un = ['tb', 'ff'];
  for (const k of ['tb', 'ff', 'dm', 'ck', 'ew', 'nc', 'pc', 'ef', 'cs', 'va', 'cr']) un = discoverRoutes('bw', un, k, false, []);
  assert.ok(!un.includes('bp'));
  assert.ok(!un.includes('nc') || un.includes('dm'));
  assert.ok(discoverRoutes('bw', un, 'va', true, []).includes('bp'));
});

test('Punkte lebender Modelle und Fortschritts-Berechnung', () => {
  const u = { points: 150, models: 10, reinforced: 0, data: { lost: 4 } };
  assert.equal(aliveModels(u), 6); assert.equal(livePoints(u), 90);
  assert.equal(livePoints({ points: 150, models: 10, reinforced: 1, data: {} }), 300);
  assert.equal(livePoints({ points: 120, models: 1, data: { lost: 1 } }), 0, 'ein dauerhaft toter Held kostet nichts mehr');
  const ms = [
    { id: '1', round: 1, status: 'done', result: 'a', battleplan: "Thyria's Bounty", player_a: 'x', player_b: 'y', location_a: 'tb', location_b: 'tb' },
    { id: '2', round: 2, status: 'done', result: 'void', battleplan: 'Cursed Kernel', player_a: 'x', player_b: 'y' },
    { id: '3', round: 3, status: 'open', result: null, battleplan: 'Cursed Kernel', player_a: 'x', player_b: 'y' },
    { id: '4', round: 2, status: 'done', result: 'b_minor', battleplan: 'Cursed Kernel', player_a: 'x', player_b: null, location_a: 'ck' },
  ];
  const pr = campaignProgress('bw', ['x', 'y'], ms);
  assert.deepEqual([pr.stats.x.wins, pr.stats.x.losses, pr.stats.y.wins, pr.stats.y.losses], [1, 1, 0, 1]);
  assert.deepEqual(pr.stats.x.unlocked.slice().sort(), ['ck', 'dm', 'ff', 'tb']);
  assert.equal(pr.owners.tb, 'x'); assert.equal(pr.winner, null);
  const snap = battleSnapshot({ round: 1, status: 'open', player_a: 'x', player_b: null }, { units: { u1: { status: 'reserve', untimely: true, destroyed: true } } },
    { a: [{ id: 'u1', points: 100, models: 5, data: {} }, { id: 'u2', points: 80, models: 1, data: { lost: 1 } }], b: null });
  assert.equal(snap.killed_pts_a, 0, 'nie eingesetzte Reserve bringt dem Gegner keine Beute');
  assert.equal(snap.army_pts_a, 100);
  assert.equal(snap.units.u2, undefined);
});

// ---------- Datenbank ----------
test('src/schema.js passt zu sql/001_schema.sql', () => {
  const sql = readFileSync(new URL('../sql/001_schema.sql', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../src/schema.js', import.meta.url), 'utf8'), render(sql));
});

test('eine bestehende Datenbank vom alten Stand wird beim ersten Aufruf ergänzt, ohne Daten zu verlieren', async () => {
  const DB = makeD1();
  // Alter Stand: ohne rate_limits/settings und ohne campaigns.options
  for (const q of SCHEMA) {
    if (/rate_limits|settings|idx_sessions_player/.test(q)) continue;
    DB.raw.exec(q.replace(",\n  options TEXT NOT NULL DEFAULT '{}'", ''));
  }
  DB.raw.prepare("INSERT INTO campaigns (id, pack, name, invite_code) VALUES (?, 'rc', 'Alt', 'ALTALT')").run('a'.repeat(32));
  assert.throws(() => DB.raw.prepare('SELECT options FROM campaigns').all());
  const env = { DB };
  const res = await handle({ request: new Request('https://kampagne.test/api/lobby/ALTALT'), env });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).campaign.name, 'Alt');
  assert.equal(DB.raw.prepare('SELECT options FROM campaigns').get().options, '{}');
  assert.ok(DB.raw.prepare("SELECT name FROM sqlite_master WHERE name='rate_limits'").get());
  assert.ok(DB.raw.prepare("SELECT name FROM sqlite_master WHERE name='settings'").get());
  // Die Handanleitung (sql/002) läuft auf einer frisch ergänzten Datenbank ohne Schaden durch – bis auf die bekannte Meldung
  const manual = readFileSync(new URL('../sql/002_sicherheit.sql', import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  for (const q of manual) { try { DB.raw.exec(q); } catch (e) { assert.match(e.message, /duplicate column/); } }
});
