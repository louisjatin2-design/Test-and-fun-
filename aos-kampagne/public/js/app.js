// Einstieg, Router, Startseite, Lobby und Master-Bereich.
import { h, toast, modal, confirmBox, copyText, select, field, badge, fmtDate, modalOpen } from './ui.js';
import { store, api, loadStatus, loadState, loadCatalog, factionNames } from './store.js';
import { PACKS, packOf } from './packs.js';
import { renderCampaign } from './campaign.js';
import { renderRulebook } from './rulebook.js';

const app = () => document.getElementById('app');
let poll = null;

function setView(...nodes) { const a = app(); a.replaceChildren(...nodes); window.scrollTo(0, 0); }
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function topbar(extra) {
  return h('header.topbar',
    h('a.brand', { href: '#/' }, h('span.brand-icon', '⚔'), h('span', 'Kampagnen-Manager')),
    h('div.topbar-right', extra || null,
      h('a.btn.ghost.small', { href: '#/regeln' }, '📖 Regeln')));
}

async function route() {
  clearInterval(poll); poll = null;
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('?')[0].split('/');
  try {
    await loadStatus();
    if (parts[0] === 'setup') return renderSetup();
    if (parts[0] === 'master') return renderMaster();
    if (parts[0] === 'k' && parts[1]) return renderLobby(parts[1].toUpperCase());
    if (parts[0] === 'regeln') { await loadCatalog(); return setView(topbar(), h('main.page', renderRulebook(parts[1] || 'rc', true))); }
    if (parts[0] === 'c') return renderCampaignRoute(parts.slice(1));
    return renderHome();
  } catch (e) {
    setView(topbar(), h('main.page', h('div.card.error', h('h2', 'Etwas ist schiefgelaufen'), h('p', e.message),
      h('p.muted', 'Ist die D1-Datenbank verbunden und das Schema eingespielt? Siehe README.'))));
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

// ---------- Startseite ----------
function packCard(p, selected, onPick) {
  return h('button.pack-card' + (selected ? '.selected' : ''), { type: 'button', onClick: () => onPick(p.id), 'data-pack': p.id },
    h('div.pack-art.' + p.id),
    h('div.pack-text', h('h3', p.name), h('div.muted.small', p.subtitle), h('p', p.blurb)));
}

function createCampaignForm(onCreated) {
  let chosen = 'rc';
  const name = h('input', { placeholder: 'z. B. Herbstfeldzug 2026', maxlength: 60 });
  const pts = h('input', { type: 'number', value: 1000, min: 300, max: 5000, step: 50 });
  const slots = select([[4, '4 Spieler'], [3, '3 Spieler'], [2, '2 Spieler']], 4);
  const uniq = h('input', { type: 'checkbox' });
  const cards = h('div.pack-grid');
  const draw = () => cards.replaceChildren(...Object.values(PACKS).map(p => packCard(p, p.id === chosen, id => { chosen = id; draw(); })));
  draw();
  const btn = h('button.btn.big', { onClick: async () => {
    btn.disabled = true;
    try {
      const r = await api('campaigns', { pack: chosen, name: name.value, points_limit: Number(pts.value), slots: Number(slots.value), allow_unique: uniq.checked });
      onCreated(r);
    } finally { btn.disabled = false; }
  } }, 'Kampagne erstellen');
  return h('div.create',
    h('h3', 'Welche Kampagne wollt ihr spielen?'), cards,
    h('div.grid2', field('Name der Kampagne', name), field('Startpunkte', pts, 'Empfohlen: 1000')),
    h('div.grid2', field('Spieler', slots), h('label.check', uniq, ' Einzigartige Helden erlauben (nicht empfohlen)')),
    btn);
}

function renderHome() {
  const st = store.status;
  store.adminCid = null;
  const code = h('input.code-in', { placeholder: 'CODE', maxlength: 8, autocapitalize: 'characters' });
  const join = () => { const c = code.value.trim().toUpperCase(); if (c.length >= 4) go('#/k/' + c); else toast('Bitte den Kampagnen-Code eingeben.', 'error'); };
  code.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  const mine = st.me && st.me.player;
  setView(topbar(st.me && st.me.admin ? h('a.btn.small', { href: '#/master' }, '👑 Master') : null),
    h('main.page',
      h('section.hero-sec',
        h('h1', 'Path to Glory'),
        h('p.lead', 'Euer Game Master für Age-of-Sigmar-Kampagnen: Karte, geheime Züge, automatische Begegnungen, Armeelisten mit Punkten, Aftermath-Assistent und Regelwerk zum Nachschlagen.')),
      st.setup_needed ? h('div.card.highlight',
        h('h2', '👑 Ersteinrichtung'),
        h('p', 'Es gibt noch keinen Master-Login. Lege ihn jetzt an – der Master sieht alle Kampagnen und kann Spieler entfernen.'),
        h('a.btn', { href: '#/setup' }, 'Master-Login anlegen')) : null,
      mine ? h('div.card.highlight',
        h('h2', 'Willkommen zurück, ' + mine.name),
        h('p', `Kampagne „${mine.campaign_name}“ (${packOf(mine.pack).name})`),
        h('a.btn.big', { href: '#/c' }, 'Weiter zur Kampagne →')) : null,
      h('div.grid2',
        h('div.card',
          h('h2', 'Kampagne beitreten'),
          h('p.muted', 'Gib den Code ein, den du bekommen hast – oder öffne direkt den Einladungslink.'),
          h('div.row', code, h('button.btn', { onClick: join }, 'Beitreten'))),
        h('div.card',
          h('h2', 'Master'),
          h('p.muted', 'Alle Kampagnen verwalten, Spieler entfernen, PINs zurücksetzen, Runden weiterschalten.'),
          h('a.btn.ghost', { href: '#/master' }, st.me && st.me.admin ? 'Zum Master-Bereich' : 'Master-Login'))),
      h('div.card',
        h('h2', 'Neue Kampagne starten'),
        h('p.muted', 'Wähle das Battlepack. Danach bekommst du einen Link mit den Spieler-Plätzen, den du an deine Mitspieler schickst.'),
        createCampaignForm(r => { toast('Kampagne angelegt!', 'ok'); go('#/k/' + r.invite_code); }))));
}

// ---------- Ersteinrichtung ----------
function renderSetup() {
  if (!store.status.setup_needed) return go('#/master');
  const name = h('input', { placeholder: 'Master', maxlength: 40 });
  const pw = h('input', { type: 'password', placeholder: 'mind. 6 Zeichen' });
  const pw2 = h('input', { type: 'password' });
  setView(topbar(), h('main.page.narrow', h('div.card',
    h('h2', '👑 Master-Login anlegen'),
    h('p.muted', 'Dieser Zugang wird nur einmal angelegt. Merke dir Name und Passwort gut.'),
    field('Name', name), field('Passwort', pw), field('Passwort wiederholen', pw2),
    h('button.btn.big', { onClick: async () => {
      if (pw.value !== pw2.value) return toast('Die Passwörter stimmen nicht überein.', 'error');
      await api('setup', { name: name.value, password: pw.value });
      toast('Master-Login angelegt.', 'ok'); go('#/master');
    } }, 'Anlegen'))));
}

// ---------- Master ----------
async function renderMaster() {
  const st = store.status;
  if (!st.me || !st.me.admin) {
    const name = h('input', { maxlength: 40 });
    const pw = h('input', { type: 'password' });
    const login = async () => { await api('admin/login', { name: name.value, password: pw.value }); toast('Angemeldet.', 'ok'); route(); };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    return setView(topbar(), h('main.page.narrow', h('div.card',
      h('h2', '👑 Master-Login'),
      st.setup_needed ? h('p', h('a', { href: '#/setup' }, 'Noch kein Master angelegt – jetzt anlegen.')) : null,
      field('Name', name), field('Passwort', pw),
      h('button.btn.big', { onClick: login }, 'Anmelden'))));
  }
  const data = await api('admin/campaigns');
  const act = async (cid, action, extra = {}, msg) => { await api('admin/campaign/' + cid, { action, ...extra }); if (msg) toast(msg, 'ok'); renderMaster(); };
  const list = data.campaigns.map(c => {
    const p = packOf(c.pack);
    const link = location.origin + '/#/k/' + c.invite_code;
    return h('div.card.camp-card',
      h('div.row.between',
        h('div', h('h3', c.name), h('div.muted.small', `${p.name} · Code ${c.invite_code} · ${phaseLabel(c.phase)}${c.current_round ? ' · Runde ' + c.current_round : ''} · ${c.points_limit} Punkte`)),
        h('div.row.wrap',
          h('button.btn.small', { onClick: () => { store.adminCid = c.id; go('#/c/lage'); } }, 'Öffnen'),
          h('button.btn.small.ghost', { onClick: () => copyText(link) }, 'Link kopieren'))),
      h('table.table',
        h('thead', h('tr', h('th', 'Platz'), h('th', 'Spieler'), h('th', 'Fraktion'), h('th', 'Bilanz'), h('th', p.currency.short), h('th', ''))),
        h('tbody', c.players.length ? c.players.map(pl => h('tr',
          h('td', pl.slot), h('td', pl.display_name, pl.roster_locked ? ' ✓' : ''), h('td', pl.faction || '–'),
          h('td', `${pl.wins}/${pl.draws}/${pl.losses}`), h('td', `${pl.vault} (${pl.vault_total})`),
          h('td.row.end.wrap',
            pl.roster_locked && c.phase === 'lobby' ? h('button.btn.tiny.ghost', { onClick: () => act(c.id, 'unlock_roster', { player_id: pl.id }, 'Roster wieder offen') }, 'Roster öffnen') : null,
            h('button.btn.tiny.ghost', { onClick: () => {
              const pin = h('input', { inputmode: 'numeric', maxlength: 8, placeholder: '4–8 Ziffern' });
              const m = modal('PIN zurücksetzen: ' + pl.display_name, h('div', field('Neue PIN', pin),
                h('button.btn', { onClick: async () => { await act(c.id, 'reset_pin', { player_id: pl.id, pin: pin.value }, 'PIN geändert'); m.close(); } }, 'Speichern')));
            } }, 'PIN'),
            h('button.btn.tiny.danger', { onClick: async () => { if (await confirmBox(`${pl.display_name} wirklich aus der Kampagne werfen? Roster und Platz werden gelöscht.`, 'Rauswerfen')) act(c.id, 'kick', { player_id: pl.id }, 'Spieler entfernt'); } }, 'Rauswerfen')))) :
          h('tr', h('td', { colspan: 6 }, h('span.muted', 'Noch niemand beigetreten.'))))),
      h('div.row.wrap',
        c.phase === 'lobby' ? h('button.btn.small', { onClick: () => act(c.id, 'start', {}, 'Kampagne gestartet') }, '▶ Kampagne starten') : null,
        c.phase === 'move' ? h('button.btn.small', { onClick: () => act(c.id, 'force_resolve', {}, 'Züge aufgedeckt') }, 'Züge jetzt aufdecken') : null,
        c.phase === 'battle' ? h('button.btn.small', { onClick: async () => { if (await confirmBox('Offene Spiele/Aftermaths dieser Runde als erledigt markieren und nächste Runde starten?')) act(c.id, 'force_next', {}, 'Nächste Runde'); } }, 'Nächste Runde erzwingen') : null,
        h('button.btn.small.ghost', { onClick: () => settingsModal(c, act) }, 'Einstellungen'),
        h('button.btn.small.danger', { onClick: async () => { if (await confirmBox(`Kampagne „${c.name}“ endgültig löschen?`, 'Löschen')) act(c.id, 'delete', {}, 'Gelöscht'); } }, 'Löschen')));
  });
  setView(topbar(h('button.btn.ghost.small', { onClick: async () => { await api('logout', { which: 'admin' }); store.adminCid = null; go('#/'); } }, 'Abmelden')),
    h('main.page',
      h('h1', '👑 Master-Bereich'),
      h('p.muted', `Angemeldet als ${st.me.admin.name}. Hier siehst du alle Kampagnen.`),
      h('div.card', h('details', h('summary', h('strong', '+ Neue Kampagne anlegen')),
        createCampaignForm(r => { toast('Kampagne angelegt – Link: ' + location.origin + '/#/k/' + r.invite_code, 'ok'); renderMaster(); }))),
      list.length ? list : h('p.muted', 'Noch keine Kampagnen.')));
}
function settingsModal(c, act) {
  const name = h('input', { value: c.name });
  const pts = h('input', { type: 'number', value: c.points_limit });
  const ul = h('input', { type: 'number', value: c.unit_limit });
  const uq = h('input', { type: 'checkbox', checked: !!c.allow_unique });
  const m = modal('Einstellungen', h('div', field('Name', name), field('Startpunkte', pts), field('Max. Punkte pro Einheit beim Start (0 = egal)', ul),
    h('label.check', uq, ' Einzigartige Einheiten erlaubt'),
    h('button.btn', { onClick: async () => { await act(c.id, 'settings', { name: name.value, points_limit: pts.value, unit_limit: ul.value, allow_unique: uq.checked }, 'Gespeichert'); m.close(); } }, 'Speichern')));
}
export const phaseLabel = ph => ({ lobby: 'Aufstellung', move: 'Zugphase', battle: 'Schlachten & Aftermath', finished: 'Beendet' }[ph] || ph);

// ---------- Lobby mit den Plätzen ----------
async function renderLobby(codeStr) {
  const [lobby] = await Promise.all([api('lobby/' + codeStr), loadCatalog()]);
  const c = lobby.campaign, p = packOf(c.pack);
  const link = location.origin + '/#/k/' + c.invite_code;
  const slots = lobby.slots.map(s => {
    if (s.taken) {
      const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'PIN' });
      const login = async () => { await api('lobby/' + c.invite_code + '/login', { slot: s.slot, pin: pin.value }); store.adminCid = null; toast('Angemeldet.', 'ok'); go('#/c/lage'); };
      pin.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
      return h('div.slot.taken',
        h('div.slot-num', s.slot),
        h('h3', s.name), h('div.muted', s.faction || 'Fraktion noch offen'),
        s.ready ? badge('Roster fertig', 'ok') : badge('baut Roster…'),
        s.mine ? h('a.btn', { href: '#/c/lage' }, 'Weiter →') : h('div.row', pin, h('button.btn', { onClick: login }, 'Anmelden')));
    }
    const name = h('input', { placeholder: 'Dein Name', maxlength: 30 });
    const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: '4–8 Ziffern' });
    const fac = select([['', '– Fraktion wählen –'], ...factionNames()], '');
    return h('div.slot.free',
      h('div.slot-num', s.slot),
      h('h3', 'Freier Platz'),
      field('Name', name), field('PIN (zum Wiederanmelden)', pin), field('Fraktion', fac),
      h('button.btn', { onClick: async () => {
        if (!fac.value) return toast('Bitte eine Fraktion wählen.', 'error');
        await api('lobby/' + c.invite_code + '/claim', { slot: s.slot, name: name.value, pin: pin.value, faction: fac.value });
        store.adminCid = null; toast('Willkommen in der Kampagne!', 'ok'); go('#/c/armee');
      } }, 'Platz einnehmen'));
  });
  setView(topbar(), h('main.page',
    h('div.lobby-head',
      h('div.pack-art.small.' + c.pack),
      h('div', h('h1', c.name), h('div.muted', `${p.name} · ${c.points_limit} Punkte · ${phaseLabel(c.phase)}`))),
    h('div.card.share',
      h('div', h('strong', 'Einladungslink: '), h('code', link)),
      h('div.row', h('button.btn.small', { onClick: () => copyText(link) }, 'Link kopieren'), h('span.muted.small', 'Code: ' + c.invite_code))),
    h('div.slots', slots),
    h('p.muted.small', 'Jeder nimmt einen Platz und wählt eine PIN. Mit derselben PIN kannst du dich später auf jedem Gerät wieder anmelden.')));
}

// ---------- Kampagnen-Ansicht ----------
async function renderCampaignRoute(parts) {
  const st = store.status;
  if (!st.me || (!st.me.player && !st.me.admin)) return go('#/');
  if (st.me.player && !store.adminCid) store.adminCid = null;
  if (!st.me.player && !store.adminCid) return go('#/master');
  await loadCatalog();
  await loadState(true);
  const draw = () => {
    const tab = parts[0] || 'lage';
    setView(renderCampaign(tab, parts.slice(1), { go, phaseLabel, logout: async () => { await api('logout', { which: 'player' }); go('#/'); } }));
  };
  draw();
  let pending = false;
  const tryRedraw = () => {
    const active = document.activeElement;
    const typing = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    if (modalOpen() || typing || document.querySelector('[data-keep]')) { pending = true; showRefreshHint(); return; }
    pending = false; const y = window.scrollY; draw(); window.scrollTo(0, y);
  };
  store.listeners.clear();
  store.listeners.add(() => {});
  poll = setInterval(async () => {
    if (document.hidden) return;
    try { if (await loadState()) tryRedraw(); } catch { /* offline */ }
  }, 5000);
  document.addEventListener('modalclosed', () => { if (pending) tryRedraw(); });
  window.__redraw = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };
}
function showRefreshHint() {
  if (document.getElementById('refresh-hint')) return;
  document.body.appendChild(h('button.refresh-hint', { id: 'refresh-hint', onClick: e => { e.target.remove(); window.__redraw && window.__redraw(); } }, '↻ Neuer Stand – aktualisieren'));
}
