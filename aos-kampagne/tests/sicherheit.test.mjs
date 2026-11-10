// Sicherheit: Wer darf was? Lässt sich etwas erraten, fälschen oder von außen auslösen?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, Client, master, startedCampaign, moveAll, ORIGIN, HERO, TROOP } from './helpers.mjs';

test('Master-Login lässt sich nur einmal anlegen und braucht ein ordentliches Passwort', async () => {
  const env = makeEnv();
  const a = new Client(env);
  assert.equal((await a.post('setup', { name: 'M', password: 'kurz' })).status, 400);
  assert.equal((await a.get('status')).body.setup_needed, true);
  assert.equal((await a.post('setup', { name: 'M', password: 'lang-genug-1' })).status, 200);
  const b = new Client(env, '10.0.0.2');
  const again = await b.post('setup', { name: 'Böse', password: 'lang-genug-2' });
  assert.equal(again.status, 403);
  assert.equal((await b.get('admin/campaigns')).status, 401);
  assert.equal((await a.get('admin/campaigns')).status, 200);
});

test('zwei gleichzeitige Ersteinrichtungen: nur eine gewinnt', async () => {
  const env = makeEnv();
  const rs = await Promise.all([new Client(env, '1.1.1.1').post('setup', { name: 'A', password: 'passwort-eins' }), new Client(env, '2.2.2.2').post('setup', { name: 'B', password: 'passwort-zwei' })]);
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 403]);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 1);
});

test('ohne Anmeldung gibt es keinen Kampagnenstand', async () => {
  const env = makeEnv();
  const { camp } = await startedCampaign(env);
  const fremd = new Client(env, '10.5.5.5');
  assert.equal((await fremd.get('state')).status, 401);
  assert.equal((await fremd.get('state?cid=' + camp.id)).status, 401);
  assert.equal((await fremd.post('roster', { ops: [] })).status, 401);
  // Ein erfundenes Sitzungs-Cookie hilft nicht
  fremd.cookie = 'sess=' + 'a'.repeat(64);
  assert.equal((await fremd.get('state?cid=' + camp.id)).status, 401);
});

test('Spieler einer Kampagne kommen nicht an eine andere Kampagne', async () => {
  const env = makeEnv();
  const one = await startedCampaign(env);
  const two = await startedCampaign(env);
  const spy = one.players[0];
  const r = await spy.get('state?cid=' + two.camp.id);
  assert.equal(r.status, 403);
  // … und können dort nichts ändern
  const st2 = await two.players[0].state();
  const victim = st2.units.find(u => u.player_id === two.players[0].id);
  const w = await spy.post('roster?cid=' + two.camp.id, { ops: [{ op: 'remove', id: victim.id }] });
  assert.equal(w.status, 403);
  assert.ok((await two.players[0].state()).units.some(u => u.id === victim.id));
});

test('Spieler können nur ihr eigenes Roster ändern', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  const st = await a.state();
  const bUnit = st.units.find(u => u.player_id === b.id);
  // fremde Spieler-ID angeben
  assert.equal((await a.post('roster', { player_id: b.id, ops: [{ op: 'remove', id: bUnit.id }] })).status, 403);
  // fremde Einheit im eigenen Namen ändern/entfernen: wird ignoriert
  await a.ok('roster', { ops: [{ op: 'update', id: bUnit.id, fields: { battle_wounds: 17, name: 'gehackt' } }, { op: 'remove', id: bUnit.id }] });
  const after = (await b.state()).units.find(u => u.id === bUnit.id);
  assert.equal(after.name, bUnit.name);
  assert.equal(after.battle_wounds, 0);
  // fremde Währung
  assert.equal((await a.post('roster', { player_id: b.id, ops: [{ op: 'player', fields: { vault_delta: -1 } }] })).status, 403);
});

test('der geheime Zug bleibt geheim, bis alle gezogen haben', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  await a.ok('move', { target: 'o2' });
  const seenByB = await b.state();
  const aInB = seenByB.players.find(p => p.id === a.id);
  assert.equal(aInB.pending_move, null);
  assert.equal(aInB.moved, true);
  assert.equal(aInB.location_key, 'o1', 'die Position ändert sich erst beim Aufdecken');
  assert.ok(!JSON.stringify(seenByB.events).includes('Aschental'));
  assert.equal((await a.state()).players.find(p => p.id === a.id).pending_move, 'o2');
  // unerlaubtes Feld
  assert.equal((await b.post('move', { target: 'c1' })).status, 400);
  assert.equal((await b.post('move', { target: 'g1' })).status, 400, 'Gnaw\'s Edge ist noch gesperrt');
});

test('PIN lässt sich nicht durchprobieren: nach 5 Fehlversuchen ist der Platz gesperrt', async () => {
  const env = makeEnv();
  const m = await master(env);
  const { camp, players: [a] } = await startedCampaign(env);
  const thief = new Client(env, '66.6.6.6');
  let last;
  for (let i = 0; i < 5; i++) last = await thief.post(`lobby/${camp.invite_code}/login`, { slot: 1, pin: '000' + i });
  assert.equal(last.status, 401);
  assert.match(last.body.error, /gesperrt/);
  // Jetzt hilft auch die richtige PIN nicht – egal von welcher IP
  const other = new Client(env, '77.7.7.7');
  assert.equal((await other.post(`lobby/${camp.invite_code}/login`, { slot: 1, pin: a.pin })).status, 429);
  // Die bestehende Sitzung des echten Spielers funktioniert weiter
  assert.equal((await a.get('state')).status, 200);
  // Der Master setzt die PIN zurück → Sperre weg, alte Sitzungen ungültig
  await m.ok('admin/campaign/' + camp.id, { action: 'reset_pin', player_id: a.id, pin: '424242' });
  assert.equal((await a.get('state')).status, 401);
  assert.equal((await other.post(`lobby/${camp.invite_code}/login`, { slot: 1, pin: '424242' })).status, 200);
});

test('richtige PIN setzt den Fehlversuch-Zähler zurück', async () => {
  const env = makeEnv();
  const { camp, players: [a] } = await startedCampaign(env);
  const c = new Client(env, '10.3.3.3');
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) assert.equal((await c.post(`lobby/${camp.invite_code}/login`, { slot: 1, pin: '9999' })).status, 401);
    assert.equal((await c.post(`lobby/${camp.invite_code}/login`, { slot: 1, pin: a.pin })).status, 200);
  }
});

test('Master-Passwort lässt sich nicht durchprobieren', async () => {
  const env = makeEnv();
  await master(env);
  const thief = new Client(env, '66.6.6.6');
  for (let i = 0; i < 5; i++) assert.equal((await thief.post('admin/login', { name: 'Master', password: 'falsch' + i })).status, 401);
  assert.equal((await thief.post('admin/login', { name: 'Master', password: 'sehr-geheim-1' })).status, 429);
  // Von einem anderen Gerät kommt der echte Master weiter hinein
  assert.equal((await new Client(env, '10.1.1.1').post('admin/login', { name: 'Master', password: 'sehr-geheim-1' })).status, 200);
});

test('Kampagnen-Codes lassen sich nicht in Ruhe erraten', async () => {
  const env = makeEnv();
  const c = new Client(env, '66.6.6.6');
  let status;
  for (let i = 0; i < 31; i++) status = (await c.get('lobby/ZZZZ' + String(i).padStart(2, '0'))).status;
  assert.equal(status, 429);
});

test('Anfragen von fremden Webseiten werden abgelehnt', async () => {
  const env = makeEnv();
  const { players: [a] } = await startedCampaign(env);
  const evil = await a.post('roster', { ops: [{ op: 'player', fields: { vault_delta: 5 } }] }, { headers: { origin: 'https://boese.example' } });
  assert.equal(evil.status, 403);
  const form = await a.post('roster', 'ops=1', { headers: { 'content-type': 'text/plain' } });
  assert.equal(form.status, 415);
  const cross = await a.post('roster', { ops: [] }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.equal((await a.state()).players.find(p => p.id === a.id).vault, 0);
});

test('zu große oder kaputte Anfragen werden abgewiesen', async () => {
  const env = makeEnv();
  const { players: [a] } = await startedCampaign(env);
  assert.equal((await a.post('dice', { text: 'x'.repeat(250000) })).status, 413);
  assert.equal((await a.post('dice', '{kaputt')).status, 400);
  assert.equal((await a.post('dice', '[1,2]')).status, 400);
  assert.equal((await a.call('DELETE', 'state')).status, 405);
});

test('Spieler können ihren Fortschritt nicht selbst setzen', async () => {
  const env = makeEnv();
  const { players: [a] } = await startedCampaign(env);
  await a.ok('roster', { ops: [{ op: 'player', fields: { data: { won_tables: ['gnaw', 'shores'], unlocked: ['bp'], trophy: true, food: 999999, gold: 5000, tome: [{ name: 'Feuerball', kind: 'Zauber' }] } } }] });
  const me = (await a.state()).players.find(p => p.id === a.id);
  assert.equal(me.data.won_tables, undefined);
  assert.equal(me.data.unlocked, undefined);
  assert.equal(me.data.trophy, undefined);
  assert.equal(me.data.food, 1000);
  assert.equal(me.data.gold, 0);
  assert.deepEqual(me.data.tome, [{ name: 'Feuerball', kind: 'Zauber' }]);
  // „insgesamt gesammelt“ (schaltet Gnaw's Edge frei) kann nicht ohne echten Zugewinn steigen
  await a.ok('roster', { ops: [{ op: 'player', fields: { vault_total_delta: 500 } }] });
  await a.ok('roster', { ops: [{ op: 'player', fields: { vault_delta: 3, vault_total_delta: 500 } }] });
  const me2 = (await a.state()).players.find(p => p.id === a.id);
  assert.equal(me2.vault, 3);
  assert.equal(me2.vault_total, 3);
  // absolute Werte sind dem Master vorbehalten
  await a.ok('roster', { ops: [{ op: 'player', fields: { vault: 999, vault_total: 999, data_set: { gold: 999 } } }] });
  const me3 = (await a.state()).players.find(p => p.id === a.id);
  assert.equal(me3.vault, 3);
  assert.equal(me3.data.gold, 0);
});

test('Währung kann nicht ins Minus gehen; jede Änderung steht mit dem echten Betrag im Verlauf', async () => {
  const env = makeEnv();
  const { players: [a] } = await startedCampaign(env);
  const r = await a.post('roster', { ops: [{ op: 'player', fields: { vault_delta: -1 } }] });
  assert.equal(r.status, 400);
  // ohne Kommentar und mit irreführendem Kommentar
  await a.ok('roster', { ops: [{ op: 'player', fields: { vault_delta: 7, vault_total_delta: 7 } }] });
  await a.ok('roster', { ops: [{ op: 'player', fields: { data_delta: { gold: 40 } } }], log: 'bearbeitet nur den Namen' });
  const ev = (await a.state()).events.map(e => e.text);
  assert.ok(ev.some(t => /Splitter \+7/.test(t)), ev.slice(0, 3).join(' | '));
  assert.ok(ev.some(t => /bearbeitet nur den Namen.*Gold \+40/.test(t)));
  const neg = await a.post('roster', { ops: [{ op: 'player', fields: { data_delta: { gold: -41 } } }] });
  assert.equal(neg.status, 400);
});

test('nach dem Abschluss sind Punkte und Modellzahl fest; unsinnige Werte werden begrenzt', async () => {
  const env = makeEnv();
  const { players: [a] } = await startedCampaign(env);
  const u = (await a.state()).units.find(x => x.player_id === a.id && !x.is_hero);
  await a.ok('roster', { ops: [{ op: 'update', id: u.id, fields: { points: 1, models: 99, battle_wounds: -50, rank: 12, is_hero: 1 }, data: { lost: -3, hack: { x: 1 }, notes: 'ok' } }] });
  const after = (await a.state()).units.find(x => x.id === u.id);
  assert.equal(after.points, u.points);
  assert.equal(after.models, u.models);
  assert.equal(after.is_hero, 0);
  assert.equal(after.battle_wounds, 0);
  assert.equal(after.rank, 4);
  assert.equal(after.data.lost, 0);
  assert.equal(after.data.hack, undefined);
  assert.equal(after.data.notes, 'ok');
  // ein abgeschlossenes Roster kann nur der Master wieder öffnen
  assert.equal((await a.post('roster', { ops: [{ op: 'player', fields: { roster_locked: 0 } }] })).status, 403);
});

test('Roster abschließen prüft auch der Server (Punkte, General)', async () => {
  const env = makeEnv();
  const creator = new Client(env);
  const camp = await creator.ok('campaigns', { pack: 'rc', slots: 2, points_limit: 1000 });
  const a = new Client(env, '10.0.2.1');
  await a.ok(`lobby/${camp.invite_code}/claim`, { slot: 1, name: 'A', pin: '1234', faction: 'Skaven' });
  await a.ok('roster', { ops: [{ op: 'add', unit: TROOP('Nur Trupp', 200, 10) }] });
  assert.match((await a.post('roster', { ops: [{ op: 'player', fields: { roster_locked: 1 } }] })).body.error, /General/);
  await a.ok('roster', { ops: [{ op: 'add', unit: HERO('Held', 300) }, { op: 'add', unit: { ...TROOP('Riesig', 400, 10), reinforced: 1 } }] });
  const over = await a.post('roster', { ops: [{ op: 'player', fields: { roster_locked: 1 } }] });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /Zu viele Punkte|mehr als 350/);
  // zwei Generäle gibt es nie
  await a.ok('roster', { ops: [{ op: 'add', unit: HERO('Zweiter Held', 100) }] });
  const gens = (await a.state()).units.filter(u => u.is_general);
  assert.equal(gens.length, 1);
  assert.equal(gens[0].name, 'Zweiter Held');
});

test('Finale lässt sich nicht erfinden: Schlachtplan muss zur Begegnung passen', async () => {
  const env = makeEnv();
  const { players: [a, b] } = await startedCampaign(env);
  const [m] = await moveAll([a, b], ['o3', 'o3']);
  const fake = await a.post('match/' + m.id, { op: 'result', result: 'a', battleplan: "Raid on Hel's Claw" });
  assert.equal(fake.status, 400);
  assert.equal((await a.post('match/' + m.id, { op: 'setup', battleplan: "Raid on Hel's Claw" })).status, 400);
  assert.equal((await a.post('match/' + m.id, { op: 'setup', battleplan: 'Twisted by Rage' })).status, 400, 'Gnaw\'s-Edge-Plan auf der Outskirts-Tabelle');
  assert.equal((await a.post('match/' + m.id, { op: 'result', result: 'a' })).status, 400, 'ohne Schlachtplan kein Ergebnis');
  assert.equal((await a.post('match/' + m.id, { op: 'result', result: 'a_minor', battleplan: 'Light the Fires' })).status, 400, 'keine kleinen Siege in Ravaged Coast');
  const st = await a.state();
  assert.equal(st.campaign.phase, 'battle');
  assert.equal(st.campaign.winner_player_id, null);
});

test('nur Beteiligte (oder der Master) tragen Ergebnis und Aftermath ein', async () => {
  const env = makeEnv();
  const m0 = await master(env);
  const { camp, players } = await startedCampaign(env, { n: 4 });
  const ms = await moveAll(players, ['o3', 'o3', 'o6', 'o6']);
  assert.equal(ms.length, 2);
  const m = ms[0];
  const outsider = players.find(p => p.id !== m.player_a && p.id !== m.player_b);
  assert.equal((await outsider.post('match/' + m.id, { op: 'result', result: 'a', battleplan: 'Light the Fires' })).status, 403);
  const pa = players.find(p => p.id === m.player_a), pb = players.find(p => p.id === m.player_b);
  await pa.ok('match/' + m.id, { op: 'result', result: 'a', battleplan: 'Light the Fires' });
  // fremdes Aftermath abschließen geht nicht
  assert.equal((await pa.post('match/' + m.id, { op: 'aftermath', side: 'b', state: {}, done: true })).status, 403);
  assert.equal((await pb.post('match/' + m.id, { op: 'aftermath', side: 'b', state: { step: 2 }, done: false })).status, 200);
  // nach dem Ergebnis lässt sich der Spielbericht nicht mehr nachträglich schönen
  assert.equal((await pa.post('match/' + m.id, { op: 'setup', report: { units: {} } })).status, 400);
  // der Master darf
  m0.cid = camp.id;
  assert.equal((await m0.post('match/' + m.id, { op: 'aftermath', side: 'a', state: {}, done: true })).status, 200);
});

test('wer aus der Kampagne geworfen wird, ist sofort draußen', async () => {
  const env = makeEnv();
  const m = await master(env);
  const { camp, players: [a, b, c] } = await startedCampaign(env, { n: 3 });
  await m.ok('admin/campaign/' + camp.id, { action: 'kick', player_id: c.id });
  assert.equal((await c.get('state')).status, 401);
  const st = await a.state();
  assert.equal(st.players.length, 2);
  assert.ok(!st.units.some(u => u.player_id === c.id));
  // Master-Aktionen sind für Spieler tabu
  assert.equal((await a.post('admin/campaign/' + camp.id, { action: 'kick', player_id: b.id })).status, 403);
  assert.equal((await a.post('admin/settings', { create_policy: 'master' })).status, 403);
});

test('Kampagnen anlegen: begrenzt pro IP, auf Wunsch nur für den Master', async () => {
  const env = makeEnv();
  const m = await master(env);
  const c = new Client(env, '55.5.5.5');
  let last;
  for (let i = 0; i < 7; i++) last = await c.post('campaigns', { pack: 'bw' });
  assert.equal(last.status, 429);
  await m.ok('admin/settings', { create_policy: 'master' });
  const other = new Client(env, '44.4.4.4');
  assert.equal((await other.post('campaigns', { pack: 'rc' })).status, 403);
  assert.equal((await other.get('status')).body.can_create, false);
  assert.equal((await m.post('campaigns', { pack: 'rc' })).status, 200);
});

test('Antworten verraten keine geheimen Daten und tragen Schutz-Header', async () => {
  const env = makeEnv();
  const { camp, players: [a] } = await startedCampaign(env);
  const r = await a.get('state');
  const txt = JSON.stringify(r.body);
  assert.ok(!/"(pin_hash|salt|pw_hash|token)"\s*:/.test(txt));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const lobby = await new Client(env, '10.8.8.8').get('lobby/' + camp.invite_code);
  assert.ok(!JSON.stringify(lobby.body).includes(camp.id), 'die interne Kampagnen-ID bleibt intern');
  // Das Cookie ist für Skripte unsichtbar und wird nur über HTTPS geschickt
  const c = new Client(env, '10.8.8.9');
  const res = await c.call('POST', `lobby/${camp.invite_code}/login`, { slot: 1, pin: a.pin });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/);
  assert.equal(new URL(ORIGIN).protocol, 'https:');
});
