// Durchlauf Blighted Wilds mit 3 Spielern (Duell + Gastspiel), Belohnungen, Ruhm, Master-Ansicht.
const F = require('./hilfen.cjs');
const { launch, newUser, shot, goto, api, toasts, errors } = F;
const assert = require('node:assert/strict');
const rollOpen = async (P) => { for (let i = 0; i < 40; i++) { const b = P.locator('main button.dice-btn:not([disabled])'); if (!(await b.count())) break; await b.first().click(); await F.W(P, 650); } };
const step = (P, n) => P.locator('ol.stepper li').nth(n - 1).click().then(() => F.W(P, 700));
(async () => {
  const browser = await launch();
  const A = await newUser(browser, 'A'), B = await newUser(browser, 'B'), C = await newUser(browser, 'C', { viewport: { width: 390, height: 800 } }), M = await newUser(browser, 'M');
  await F.masterLogin(M);
  const code = await F.createCampaign(M, 'bw', 'Thyria-Test', 3); // der Master unterliegt nicht der Begrenzung pro Stunde
  await F.claim(A, code, 1, 'Anna', '1234', 'Sturmgeschmiedete Ewige');
  await F.claim(B, code, 2, 'Ben', '4321', 'Skaven');
  await F.claim(C, code, 3, 'Cleo', '5555', 'Skaven');
  await F.addUnit(A, 'Fürst Celestant'); await F.addUnit(A, 'Bezwinger'); await F.addUnit(A, 'Annihilatoren');
  await F.setPath(A, 'Fürst Celestant', 'druid'); await F.lockRoster(A);
  await F.addUnit(B, 'Klauenfürst'); await F.addUnit(B, 'Clanratten'); await F.setPath(B, 'Klauenfürst', 'sacrifice'); await F.lockRoster(B);
  await F.addUnit(C, 'Grauer Prophet'); await F.addUnit(C, 'Clanratten'); await F.setPath(C, 'Grauer Prophet', 'sorcerer'); await F.lockRoster(C);
  await goto(A, '#/c/lage'); await F.W(A, 600);
  await A.getByRole('button', { name: '▶ Kampagne starten' }).click(); await F.W(A, 900);
  await shot(A, 'b01-karte');
  await F.moveTo(A, "Thyria's Bounty"); await F.moveTo(B, "Thyria's Bounty"); await F.moveTo(C, 'Forest Fortress');
  let st = (await api(A, 'state')).body;
  console.log('Spiele:', st.matches.map(m => [m.kind, m.battleplan]));
  const duel = st.matches.find(m => m.kind === 'pvp'), guest = st.matches.find(m => m.kind === 'guest');
  assert.equal(duel.battleplan, "Thyria's Bounty"); assert.equal(guest.battleplan, 'Forest Fortress');
  // Master-Ansicht in der Schlachtphase (früher Absturz bei Gastspielen)
  await goto(M, '#/master'); await M.reload(); await F.W(M, 900);
  await M.locator('.camp-card').filter({ hasText: 'Thyria-Test' }).getByRole('button', { name: 'Öffnen' }).first().click(); await F.W(M, 900);
  await shot(M, 'b02-master-lage');
  assert.ok((await F.text(M, 'main')).includes('Alle Begegnungen dieser Runde'));
  // Duell: Seite a gewinnt groß; Annas Bezwinger reinigen 1 Gelände
  const nm = id => st.players.find(p => p.id === id).name;
  const winner = nm(duel.player_a), loser = nm(duel.player_b);
  const PW = winner === 'Anna' ? A : B, PL = winner === 'Anna' ? B : A;
  await goto(A, '#/c/spiel/' + duel.id); await F.W(A, 700);
  await shot(A, 'b03-spiel');
  await A.locator('.result-opts label').filter({ hasText: 'Großer Sieg ' + winner }).locator('input').check();
  const card = A.locator('.card').filter({ hasText: 'Ergebnis eintragen' });
  await card.locator('tr').filter({ hasText: 'Bezwinger' }).locator('input[type=number]').nth(1).fill('1');
  await card.locator('tr').filter({ hasText: 'Bezwinger' }).locator('input[type=number]').nth(1).dispatchEvent('change');
  await card.locator('tr').filter({ hasText: 'Annihilatoren' }).locator('input[type=checkbox]').nth(1).check(); // verseucht
  await A.getByRole('button', { name: 'Ergebnis speichern' }).click(); await F.W(A, 1200);
  st = (await api(A, 'state')).body;
  console.log('unlocked:', st.players.map(p => [p.name, p.data.unlocked.join(',')]));
  // Verlierer zuerst im Aftermath: muss auf die Wahl des Siegers warten
  await goto(PL, '#/c/aftermath/' + duel.id); await F.W(PL, 800);
  console.log(loser, 'S1 (vor der Wahl des Siegers):\n' + await F.text(PL, 'main .card:not(.aft-head)'));
  assert.equal(await PL.getByRole('button', { name: /Diese (nehmen|erhalten)/ }).count(), 0);
  // Sieger nimmt die Fähigkeit
  await goto(PW, '#/c/aftermath/' + duel.id); await F.W(PW, 800);
  await PW.locator('.action').filter({ hasText: 'Fähigkeit: Sanitised' }).getByRole('button', { name: 'Diese nehmen' }).click(); await F.W(PW, 900);
  await PW.getByRole('button', { name: /GP gutschreiben/ }).click(); await F.W(PW, 900);
  st = (await api(A, 'state')).body;
  const w = st.players.find(p => p.name === winner);
  console.log(winner, 'GP', w.vault, 'next_ability:', w.data.next_ability);
  assert.ok(/Sanitised/.test(w.data.next_ability), 'frisch gewählte Belohnung bleibt nach der GP-Gutschrift erhalten');
  assert.equal(w.vault, 60 + 30 + 10);
  // Verlierer bekommt jetzt die Sonstige Belohnung
  await PL.locator('#refresh-hint').waitFor({ timeout: 8000 }); // der 5-Sekunden-Abgleich meldet den neuen Stand
  await PL.locator('#refresh-hint').click(); await F.W(PL, 800);
  await shot(PL, 'b04-verlierer-belohnung');
  assert.equal(await PL.locator('.action').filter({ hasText: 'Fähigkeit: Sanitised' }).getByRole('button').count(), 0);
  await PL.locator('.action').filter({ hasText: 'Sonstige Belohnung' }).getByRole('button', { name: 'Diese erhalten' }).click(); await F.W(PL, 900);
  await PL.getByRole('button', { name: 'Zauber/Gebet aufnehmen' }).click(); await F.W(PL, 400);
  await PL.locator('.modal input').first().fill('Healing Spiral (7)');
  await PL.locator('.modal').getByRole('button', { name: 'Hinzufügen' }).click(); await F.W(PL, 900);
  await PL.getByRole('button', { name: /GP gutschreiben/ }).click(); await F.W(PL, 900);
  // beide: Ruhm, Wunden, Versorgung
  for (const [P, name] of [[PW, winner], [PL, loser]]) {
    await step(P, 2);
    await P.getByRole('button', { name: '🎲 Alle W3 würfeln' }).click(); await F.W(P, 900);
    const fav = P.locator('label.field').filter({ hasText: 'Favoured Warriors (+W6)' });
    await fav.locator('select').selectOption({ index: 1 }); await F.W(P, 500);
    await fav.locator('button.dice-btn').click(); await F.W(P, 700);
    await P.getByRole('button', { name: 'Ruhm verteilen' }).click(); await F.W(P, 1000);
    if (name === 'Anna') { await shot(P, 'b05-ruhm'); console.log('Anna S2:\n' + await F.text(P, 'main .card:not(.aft-head)')); }
    await step(P, 4);
    for (let i = 0; i < 5; i++) { const b = P.getByRole('button', { name: /^🎲 \d+×W6$/ }); if (!(await b.count())) break; await b.first().click(); await F.W(P, 800); }
    await rollOpen(P);
    await P.getByRole('button', { name: 'Kampfwunden anwenden' }).click(); await F.W(P, 1000);
    await step(P, 5);
    await P.getByRole('button', { name: 'Versorgung abrechnen' }).click(); await F.W(P, 900);
    await P.getByRole('button', { name: '✓ Aftermath abschließen' }).click(); await F.W(P, 1500);
    console.log(name, 'fertig →', P.url().split('#')[1], await toasts(P));
  }
  st = (await api(A, 'state')).body;
  console.log(st.units.filter(u => ['Anna', 'Ben'].includes(nm(u.player_id))).map(u => [u.name, 'Ruhm ' + u.renown, 'Rang ' + u.rank, 'w' + u.battle_wounds].join(' | ')).join('\n'));
  const bez = st.units.find(u => u.name === 'Bezwinger');
  assert.ok(bez.renown >= 3, 'W3 + 2 für Purify');
  assert.equal(st.units.find(u => u.name === 'Annihilatoren').battle_wounds, 1, 'verseucht: 1 Kampfwunde');
  assert.equal(st.campaign.phase, 'battle', 'Cleos Gastspiel ist noch offen');
  // Gastspiel (Handy): Gastpunkte eintragen, Ergebnis, kurzer Aftermath
  await goto(C, '#/c/spiel/' + guest.id); await F.W(C, 700);
  const gp = C.locator('label.field').filter({ hasText: 'Punkte der Gastarmee' }).locator('input');
  await gp.fill('1100'); await gp.dispatchEvent('change'); await F.W(C, 900);
  await shot(C, 'b06-gastspiel-mobil');
  console.log('Gast-Übersicht:', (await F.text(C, '.card')).match(/Armeepunkte:[^\n]*/)[0]);
  await C.locator('.result-opts label').filter({ hasText: 'Unentschieden' }).locator('input').check();
  await C.getByRole('button', { name: 'Ergebnis speichern' }).click(); await F.W(C, 1200);
  await goto(C, '#/c/aftermath/' + guest.id); await F.W(C, 800);
  console.log('Cleo S1:\n' + await F.text(C, 'main .card:not(.aft-head)'));
  await C.getByRole('button', { name: /GP gutschreiben/ }).click(); await F.W(C, 900);
  await step(C, 5);
  await C.getByRole('button', { name: '✓ Aftermath abschließen' }).click(); await F.W(C, 600);
  for (let i = 0; i < 4; i++) { const b = C.locator('.modal').getByRole('button', { name: 'Abschließen' }); if (!(await b.count())) break; console.log('Rückfrage:', (await F.text(C, '.modal p')).slice(0, 80)); await b.click(); await F.W(C, 700); }
  await F.W(C, 900);
  st = (await api(A, 'state')).body;
  console.log('Kampagne:', st.campaign.phase, st.campaign.current_round, '| Cleo GP', st.players.find(p => p.name === 'Cleo').vault);
  assert.equal(st.campaign.phase, 'move'); assert.equal(st.campaign.current_round, 2);
  assert.equal(st.players.find(p => p.name === 'Cleo').vault, 110 + 15, 'Gastarmee 1100 Punkte → Spalte 1000–1250');
  await goto(A, '#/c/karte'); await F.W(A, 700); await shot(A, 'b07-karte-r2');
  await browser.close();
  console.log('ERRORS', errors);
  if (errors.length) process.exit(2);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
