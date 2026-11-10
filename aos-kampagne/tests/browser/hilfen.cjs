// Hilfen für die Browser-Durchläufe (Playwright). Nicht Teil von „npm test“ – siehe README, Abschnitt „Tests“.
// Start:  npx wrangler dev   (im Hauptordner)   und dann   node aos-kampagne/tests/browser/ravaged_coast.cjs
// Die Skripte legen bei Bedarf den Master „Master“ mit dem Passwort unten an – nur gegen eine lokale Testdatenbank laufen lassen!
const MASTER_PW = process.env.MASTER_PW || 'nur-lokal-zum-testen';
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const fs = require('node:fs');
const SHOTS = __dirname + '/bilder';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
async function launch() { return chromium.launch(); }
async function newUser(browser, label, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) errors.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  page.label = label;
  return page;
}
async function shot(page, name) { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }
async function goto(page, hash) { await page.goto(BASE + '/' + hash); await page.waitForTimeout(250); }
async function api(page, path, body) {
  return page.evaluate(async ([path, body]) => {
    const r = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, [path, body]);
}
const toasts = page => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));


const W = (p, ms = 350) => p.waitForTimeout(ms);
async function masterLogin(M) {
  await goto(M, '#/');
  const st = await api(M, 'status');
  if (st.body.setup_needed) {
    await goto(M, '#/setup');
    const ins = M.locator('main input');
    await ins.nth(0).fill('Master'); await ins.nth(1).fill(MASTER_PW); await ins.nth(2).fill(MASTER_PW);
    await M.getByRole('button', { name: 'Anlegen' }).click();
  } else if (!st.body.me || !st.body.me.admin) {
    await goto(M, '#/master');
    const ins = M.locator('main input');
    await ins.nth(0).fill('Master'); await ins.nth(1).fill(MASTER_PW);
    await M.getByRole('button', { name: 'Anmelden' }).click();
  }
  await W(M, 600);
}
async function createCampaign(P, pack, name, slots) {
  await goto(P, '#/');
  await P.locator(`.pack-card[data-pack="${pack}"]`).click();
  await P.locator('.create input').first().fill(name);
  await P.locator('.create select').first().selectOption(String(slots));
  await P.getByRole('button', { name: 'Kampagne erstellen' }).click();
  await P.waitForURL(/#\/k\//, { timeout: 5000 });
  await W(P);
  return P.url().split('#/k/')[1];
}
async function claim(P, code, slot, name, pin, faction) {
  await goto(P, '#/k/' + code);
  await W(P, 500);
  const s = P.locator('.slot.free').filter({ has: P.locator('.slot-num', { hasText: new RegExp('^' + slot + '$') }) });
  await s.locator('input').nth(0).fill(name);
  await s.locator('input').nth(1).fill(pin);
  await s.locator('select').selectOption(faction);
  await s.getByRole('button', { name: 'Platz einnehmen' }).click();
  await P.waitForURL(/#\/c\/armee/, { timeout: 5000 });
  await W(P, 500);
}
async function addUnit(P, search, opts = {}) {
  await P.getByRole('button', { name: '+ Einheit hinzufügen' }).click();
  await W(P, 200);
  await P.locator('.picker input[type=search]').fill(search);
  await W(P, 200);
  const item = P.locator('.cat-item').filter({ hasText: search }).first();
  if (opts.reinforced) await item.locator('input[type=checkbox]').check();
  await item.getByRole('button', { name: 'Wählen' }).click();
  await W(P, 600);
}
async function setPath(P, unitName, pathId) {
  const card = P.locator('.unit').filter({ hasText: unitName }).first();
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await W(P, 250);
  const modal = P.locator('.modal').last();
  await modal.locator('select').filter({ has: P.locator(`option[value="${pathId}"]`) }).first().selectOption(pathId);
  await W(P, 150);
  await modal.locator('.abil-edit input[type=radio]').first().check();
  await modal.getByRole('button', { name: 'Speichern' }).click();
  await W(P, 600);
}
async function lockRoster(P) {
  await P.getByRole('button', { name: '✓ Roster abschließen' }).click();
  await W(P, 200);
  await P.locator('.modal').getByRole('button', { name: 'Abschließen' }).click();
  await W(P, 700);
}
async function moveTo(P, nodeName) {
  await goto(P, '#/c/karte');
  await W(P, 500);
  const g = P.locator('svg.map g.node.allowed').filter({ hasText: nodeName }).first();
  await g.click();
  await W(P, 250);
  await P.locator('.modal').getByRole('button', { name: 'Ziehen' }).click();
  await W(P, 700);
}
const problems = P => P.evaluate(() => [...document.querySelectorAll('ul.problems li')].map(x => x.textContent));
const text = (P, sel) => P.evaluate(s => [...document.querySelectorAll(s)].map(x => x.innerText).join('\n'), sel);
async function login(P, code, slot, pin) {
  await goto(P, '#/k/' + code);
  await W(P, 500);
  const s = P.locator('.slot.taken').filter({ has: P.locator('.slot-num', { hasText: new RegExp('^' + slot + '$') }) });
  await s.locator('input').fill(pin);
  await s.getByRole('button', { name: 'Anmelden' }).click();
  await P.waitForURL(/#\/c\/lage/, { timeout: 5000 });
  await W(P, 500);
}

module.exports = { launch, newUser, shot, goto, api, toasts, errors, BASE, SHOTS, W, masterLogin, createCampaign, claim, addUnit, setPath, lockRoster, moveTo, login, problems, text };
