// Kompletter Durchlauf Ravaged Coast mit dem neuen Code (frische Kampagne).
const F = require('./hilfen.cjs');
const { launch, newUser, shot, goto, api, toasts, errors } = F;
const assert = require('node:assert/strict');
const next = async P => { await P.getByRole('button', { name: 'Weiter →' }).click(); await F.W(P, 700); };
const rollOpen = async (P) => { // alle offenen Würfel-Knöpfe drücken
  for (let i = 0; i < 40; i++) {
    const b = P.locator('main button.dice-btn:not([disabled])');
    if (!(await b.count())) break;
    await b.first().click(); await F.W(P, 650);
  }
};
const step = (P, n) => P.locator('ol.stepper li').nth(n - 1).click().then(() => F.W(P, 700));
(async () => {
  const browser = await launch();
  const A = await newUser(browser, 'A'), B = await newUser(browser, 'B', { viewport: { width: 390, height: 800 } });
  for (const P of [A, B]) P.on('console', m => { if (/Content Security|Refused/i.test(m.text())) errors.push('CSP: ' + m.text()); });
  const M = await newUser(browser, 'M');
  await F.masterLogin(M);
  const code = await F.createCampaign(M, 'rc', 'Neuer Feldzug', 2); // der Master unterliegt nicht der Begrenzung pro Stunde
  await F.claim(A, code, 1, 'Anna', '1234', 'Sturmgeschmiedete Ewige');
  await F.claim(B, code, 2, 'Ben', '4321', 'Skaven');
  await F.addUnit(A, 'Fürst Celestant'); await F.addUnit(A, 'Bezwinger'); await F.addUnit(A, 'Annihilatoren'); await F.addUnit(A, 'Aetherschwingen');
  console.log('A Probleme ohne Pfad:', await F.problems(A));
  await F.setPath(A, 'Fürst Celestant', 'brawler');
  // Start-Regel: in Ravaged Coast keine Verbesserungen beim Start
  await A.locator('.unit.general').getByRole('button', { name: 'Bearbeiten' }).click(); await F.W(A, 300);
  await A.locator('.modal input[placeholder^="Name (Battlepack"]').first().fill('Spiteful Spark');
  await A.locator('.modal').getByRole('button', { name: 'Speichern' }).click(); await F.W(A, 700);
  const probs = await F.problems(A);
  console.log('A Probleme mit Start-Verbesserung:', probs);
  assert.ok(probs.some(x => /ohne Verbesserungen/.test(x)));
  assert.ok(await A.getByRole('button', { name: '✓ Roster abschließen' }).isDisabled());
  await A.locator('.unit.general').getByRole('button', { name: 'Bearbeiten' }).click(); await F.W(A, 300);
  await A.locator('.modal input[placeholder^="Name (Battlepack"]').first().fill('');
  await A.locator('.modal').getByRole('button', { name: 'Speichern' }).click(); await F.W(A, 700);
  assert.deepEqual(await F.problems(A), []);
  await F.lockRoster(A);
  await F.addUnit(B, 'Klauenfürst'); await F.addUnit(B, 'Clanratten'); await F.addUnit(B, 'Rattenogors');
  await F.setPath(B, 'Klauenfürst', 'ruler'); await F.lockRoster(B);
  await goto(A, '#/c/lage'); await F.W(A, 600);
  await A.getByRole('button', { name: '▶ Kampagne starten' }).click(); await F.W(A, 900);
  // ---------- Runde 1 ----------
  await F.moveTo(A, 'Rauchschlot-Klamm'); await F.moveTo(B, 'Rauchschlot-Klamm');
  let st = (await api(A, 'state')).body;
  let m = st.matches[0];
  assert.equal(st.campaign.phase, 'battle'); assert.equal(m.table_key, 'outskirts');
  await goto(A, '#/c/spiel/' + m.id); await F.W(A, 700);
  await goto(B, '#/c/spiel/' + m.id); await F.W(B, 700);
  // Schlachtplan-Auswahl ist auf die Tabelle beschränkt
  const opts = await A.locator('.card', { hasText: 'Schlachtplan' }).first().locator('select').first().locator('option').allTextContents();
  console.log('Schlachtplan-Optionen:', opts);
  assert.ok(!opts.includes("Raid on Hel's Claw") && opts.includes('Light the Fires') && opts.length === 7);
  await A.locator('.dice').filter({ hasText: 'Würfeln:' }).getByRole('button').click(); await F.W(A, 900);
  assert.ok(await A.locator('.dice').filter({ hasText: 'Würfeln:' }).getByRole('button').isDisabled(), 'Schlachtplan-Wurf ist danach gesperrt');
  await A.locator('.dice').filter({ hasText: 'Twist-Tabelle:' }).getByRole('button').click(); await F.W(A, 900);
  await shot(A, 'r01-spiel');
  // Ben stellt (mit veraltetem Stand auf seinem Gerät) eine Einheit in Reserve; Anna parallel eine eigene
  await B.locator('ul.field-units li').filter({ hasText: 'Rattenogors' }).locator('select').selectOption('reserve'); await F.W(B, 800);
  await A.locator('ul.field-units li').filter({ hasText: 'Aetherschwingen' }).locator('select').selectOption('reserve'); await F.W(A, 800);
  st = (await api(A, 'state')).body; m = st.matches[0];
  const idOf = name => st.units.find(u => u.name === name).id;
  assert.equal(m.report.units[idOf('Rattenogors')].status, 'reserve');
  assert.equal(m.report.units[idOf('Aetherschwingen')].status, 'reserve');
  console.log('Schlachtplan', m.battleplan, '| Twist', m.report.twist, m.report.twist_roll);
  // Ergebnis: zuerst falsch (Ben), dann korrigieren (Anna)
  const card = () => A.locator('.card').filter({ hasText: /Ergebnis (eintragen|korrigieren)/ });
  const row = name => card().locator('tr').filter({ hasText: name });
  await A.locator('.result-opts label').filter({ hasText: 'Großer Sieg Ben' }).locator('input').check();
  await row('Bezwinger').locator('input[type=number]').fill('2'); await row('Bezwinger').locator('input[type=number]').dispatchEvent('change');
  await row('Annihilatoren').locator('input[type=checkbox]').nth(1).check(); // Emberstone-Marke
  await row('Clanratten').locator('input[type=number]').fill('8'); await row('Clanratten').locator('input[type=number]').dispatchEvent('change');
  await row('Klauenfürst').locator('input[type=checkbox]').nth(0).check(); // vernichtet
  await row('Rattenogors').locator('input[type=checkbox]').nth(2).check(); // nie eingesetzt (Reserve)
  await A.getByRole('button', { name: 'Ergebnis speichern' }).click(); await F.W(A, 1200);
  st = (await api(A, 'state')).body;
  console.log('nach falschem Ergebnis:', st.players.map(p => [p.name, p.wins, p.losses, p.location_key]));
  await shot(A, 'r02-ergebnis');
  await A.getByRole('button', { name: '✎ Ergebnis korrigieren' }).click(); await F.W(A, 500);
  await A.locator('.result-opts label').filter({ hasText: 'Großer Sieg Anna' }).locator('input').check();
  await card().locator('label.field').filter({ hasText: 'Siegpunkte Anna' }).locator('input').fill('8');
  await card().locator('label.field').filter({ hasText: 'Siegpunkte Ben' }).locator('input').fill('3');
  await A.getByRole('button', { name: 'Korrektur speichern' }).click(); await F.W(A, 1200);
  st = (await api(A, 'state')).body; m = st.matches[0];
  console.log('nach Korrektur:', st.players.map(p => [p.name, p.wins, p.losses, p.location_key, JSON.stringify(p.data.won_tables)]));
  assert.deepEqual(st.players.map(p => [p.wins, p.losses]), [[1, 0], [0, 1]]);
  const sideA = m.player_a === st.players[0].id ? 'a' : 'b'; // Anna
  const afterA = () => st.matches[0]['aftermath_' + sideA];
  assert.equal(m.report.army_pts_a + m.report.army_pts_b, 750);
  console.log('Bericht:', JSON.stringify({ a: m.report.army_pts_a, b: m.report.army_pts_b, ka: m.report.killed_pts_a, kb: m.report.killed_pts_b }));
  // ---------- Aftermath Anna ----------
  await goto(A, '#/c/aftermath/' + m.id); await F.W(A, 800);
  console.log('A S1:\n' + await F.text(A, 'main .card:not(.aft-head)'));
  await A.getByRole('button', { name: /Splitter gutschreiben/ }).dblclick(); await F.W(A, 1200); // Doppelklick darf nicht doppelt buchen
  st = (await api(A, 'state')).body;
  assert.equal(st.players[0].vault, 4, 'Sieg 3 + 1 Marke, trotz Doppelklick nur einmal');
  await next(A); await next(A);
  // Schmiede: bezahlen, Fenster schließen, weitermachen
  await A.locator('.action').filter({ hasText: 'Emberstone-Waffe schmieden' }).getByRole('button', { name: 'Ausführen' }).click(); await F.W(A, 400);
  await A.locator('.modal').getByRole('button', { name: /Schmieden \(2 Splitter/ }).click(); await F.W(A, 1200);
  await shot(A, 'r03-schmiede');
  await A.locator('.modal .icon-btn').click(); await F.W(A, 600);
  st = (await api(A, 'state')).body;
  assert.equal(st.players[0].vault, 2);
  console.log('Schmiede gemerkt:', JSON.stringify(afterA().s3.forge).slice(0, 160));
  await A.locator('.action').filter({ hasText: 'Schmiede läuft' }).getByRole('button', { name: 'Ausführen' }).click(); await F.W(A, 400);
  await A.locator('.modal').getByRole('button', { name: 'Waffe übergeben' }).click(); await F.W(A, 1200);
  st = (await api(A, 'state')).body;
  assert.equal(st.players[0].vault, 2, 'kein zweites Mal bezahlt');
  assert.ok(st.units.find(u => u.name === 'Fürst Celestant').data.weapon);
  // Pfad für die Bezwinger (1 Splitter)
  await A.locator('.action').filter({ hasText: 'Fortschritt auf einem Pfad' }).getByRole('button', { name: 'Ausführen' }).click(); await F.W(A, 300);
  let modal = A.locator('.modal').last();
  await modal.locator('select').first().selectOption({ label: 'Bezwinger (—)' }); await F.W(A, 200);
  await modal.locator('select').nth(1).selectOption('bulwark'); await F.W(A, 200);
  await modal.locator('input[type=radio]').first().check();
  await modal.getByRole('button', { name: /Kaufen/ }).click(); await F.W(A, 900);
  await shot(A, 'r04-s3');
  await next(A);
  // Schritt 4
  await A.getByRole('button', { name: /^🎲 \d+×W6$/ }).first().click(); await F.W(A, 800);
  assert.equal(await A.getByRole('button', { name: /^🎲 \d+×W6$/ }).count(), 0, 'kein Neuwürfeln der Verluste');
  await rollOpen(A);
  await A.getByRole('button', { name: 'Kampfwunden anwenden' }).click(); await F.W(A, 1000);
  await shot(A, 'r05-s4');
  console.log('A S4:\n' + await F.text(A, 'main .card:not(.aft-head)'));
  await next(A);
  await A.getByRole('button', { name: /Gold gutschreiben/ }).click(); await F.W(A, 900);
  await A.getByRole('button', { name: 'Versorgung abrechnen' }).click(); await F.W(A, 900);
  await A.getByRole('button', { name: '✓ Aftermath abschließen' }).click(); await F.W(A, 1500);
  console.log('A fertig:', A.url(), await toasts(A));
  // ---------- Aftermath Ben (Handy) ----------
  await goto(B, '#/c/aftermath/' + m.id); await F.W(B, 800);
  await rollOpen(B);
  await B.getByRole('button', { name: /Splitter gutschreiben/ }).click(); await F.W(B, 900);
  await step(B, 4);
  console.log('B S4 vorher:\n' + await F.text(B, 'main .card:not(.aft-head)'));
  for (let i = 0; i < 5; i++) { const b = B.getByRole('button', { name: /^🎲 \d+×W6$/ }); if (!(await b.count())) break; await b.first().click(); await F.W(B, 800); }
  await rollOpen(B);
  await B.getByRole('button', { name: 'Kampfwunden anwenden' }).click(); await F.W(B, 1000);
  await shot(B, 'r06-B-s4');
  await step(B, 5);
  await B.getByRole('button', { name: /Gold gutschreiben/ }).click(); await F.W(B, 900);
  await B.getByRole('button', { name: 'Versorgung abrechnen' }).click(); await F.W(B, 900);
  await B.getByRole('button', { name: '✓ Aftermath abschließen' }).click(); await F.W(B, 1500);
  st = (await api(A, 'state')).body;
  console.log('Kampagne:', st.campaign.phase, st.campaign.current_round);
  console.log(st.units.map(u => [u.name, 'w' + u.battle_wounds, 'lost=' + (u.data.lost || 0), u.rank, u.path || ''].join(' | ')).join('\n'));
  console.log(st.players.map(p => [p.name, p.vault, p.vault_total, p.data.food, p.data.gold].join(' ')).join(' ; '));
  assert.equal(st.campaign.phase, 'move'); assert.equal(st.campaign.current_round, 2);
  const ratten = st.units.find(u => u.name === 'Rattenogors');
  assert.equal(ratten.battle_wounds, 0, 'nie eingesetzte Reserve: keine Kampfwunden');
  console.log('Verlauf:\n' + st.events.slice(0, 26).map(e => '  ' + e.text).join('\n'));
  console.log(JSON.stringify({ code }));
  await browser.close();
  console.log('ERRORS', errors);
  if (errors.length) process.exit(2);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
