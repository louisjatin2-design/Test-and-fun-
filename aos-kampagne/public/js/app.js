// Einstieg, Router, Startseite, Lobby und Master-Bereich.
import { h, toast, modal, confirmBox, copyText, select, field, badge, fmtDate, modalOpen } from './ui.js';
import { store, api, loadStatus, loadState, loadCatalog, factionNames, setAdminCid } from './store.js';
import { PACKS, packOf } from './packs.js';
import { renderCampaign } from './campaign.js';
import { renderRulebook } from './rulebook.js';

const app = () => document.getElementById('app');
let poll = null;

function setView(...nodes) { const a = app(); a.replaceChildren(...nodes); window.scrollTo(0, 0); }
function setViewKeep(...nodes) { app().replaceChildren(...nodes); }
export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function topbar(extra) {
  return h('header.topbar',
    h('a.brand', { href: '#/' }, h('span.brand-icon', '⚔'), h('span', 'Kampagnen-Manager')),
    h('div.topbar-right', extra || null,
      h('a.btn.ghost.small', { href: '#/regeln' }, '📖 Regeln')));
}

async function route() {
  clearInterval(poll); poll = null; currentDraw = null;
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('?')[0].split('/');
  try {
    await loadStatus();
    if (parts[0] === 'setup') return renderSetup();
    if (parts[0] === 'master') return renderMaster();
    if (parts[0] === 'k' && parts[1]) return renderLobby(parts[1].toUpperCase());
    if (parts[0] === 'regeln') return setView(topbar(), h('main.page', renderRulebook(parts[1] === 'bw' ? 'bw' : 'rc', true, parts[2])));
    if (parts[0] === 'c') return renderCampaignRoute(parts.slice(1));
    return renderHome();
  } catch (e) {
    if (e && e.status === 401 && parts[0] === 'c') { setAdminCid(null); return go('#/'); }
    setView(topbar(), h('main.page', h('div.card.error', h('h2', 'Etwas ist schiefgelaufen'), h('p', e.message),
      e && e.status === 429 ? null : h('p.muted', 'Bitte Verbindung prüfen und neu laden. Bleibt der Fehler: Ist die D1-Datenbank verbunden? Siehe README.'),
      h('button.btn', { onClick: () => location.reload() }, 'Neu laden'))));
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
  const guestFinal = h('input', { type: 'checkbox' });
  const cards = h('div.pack-grid');
  const draw = () => cards.replaceChildren(...Object.values(PACKS).map(p => packCard(p, p.id === chosen, id => { chosen = id; draw(); })));
  draw();
  const btn = h('button.btn.big', { onClick: async () => {
    btn.disabled = true;
    try {
      const r = await api('campaigns', { pack: chosen, name: name.value, points_limit: Number(pts.value), slots: Number(slots.value), allow_unique: uniq.checked, guest_final: guestFinal.checked });
      onCreated(r);
    } finally { btn.disabled = false; }
  } }, 'Kampagne erstellen');
  return h('div.create',
    h('h3', 'Welche Kampagne wollt ihr spielen?'), cards,
    h('div.grid2', field('Name der Kampagne', name), field('Startpunkte', pts, 'Empfohlen: 1000')),
    h('div.grid2', field('Spieler', slots), h('div',
      h('label.check', uniq, ' Einzigartige Helden erlauben (nicht empfohlen)'),
      h('label.check', guestFinal, ' Finale auch gegen einen Gastspieler möglich'))),
    h('p.muted.small', 'Nach den Battlepack-Regeln wird das Finale zwischen zwei Kampagnenspielern ausgetragen. Der Master kann beides später ändern.'),
    btn);
}

function renderHome() {
  const st = store.status;
  setAdminCid(null);
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
      st.can_create === false ? h('div.card',
        h('h2', 'Neue Kampagne starten'),
        h('p.muted', 'Neue Kampagnen legt hier der Master an. Melde dich als Master an oder bitte ihn um einen Einladungslink.')) :
      h('div.card',
        h('h2', 'Neue Kampagne starten'),
        h('p.muted', 'Wähle das Battlepack. Danach bekommst du einen Link mit den Spieler-Plätzen, den du an deine Mitspieler schickst.'),
        createCampaignForm(r => { toast('Kampagne angelegt!', 'ok'); go('#/k/' + r.invite_code); }))));
}

// ---------- Ersteinrichtung ----------
function renderSetup() {
  if (!store.status.setup_needed) return go('#/master');
  const name = h('input', { placeholder: 'Master', maxlength: 40 });
  const pw = h('input', { type: 'password', placeholder: 'mind. 8 Zeichen', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  setView(topbar(), h('main.page.narrow', h('div.card',
    h('h2', '👑 Master-Login anlegen'),
    h('p.muted', 'Dieser Zugang wird nur einmal angelegt. Merke dir Name und Passwort gut – der Master verwaltet alle Kampagnen. Wähle ein Passwort, das du sonst nirgends benutzt.'),
    field('Name', name), field('Passwort', pw), field('Passwort wiederholen', pw2),
    h('button.btn.big', { onClick: async () => {
      if (pw.value !== pw2.value) return toast('Die Passwörter stimmen nicht überein.', 'error');
      if (pw.value.length < 8) return toast('Das Passwort braucht mindestens 8 Zeichen.', 'error');
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
          h('button.btn.small', { onClick: () => { setAdminCid(c.id); go('#/c/lage'); } }, 'Öffnen'),
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
        c.phase === 'move' || c.phase === 'resolving' ? h('button.btn.small', { onClick: async () => { if (await confirmBox('Züge jetzt aufdecken? Wer noch nicht gezogen hat, bleibt auf seinem Feld stehen.', 'Aufdecken')) act(c.id, 'force_resolve', {}, 'Züge aufgedeckt'); } }, 'Züge jetzt aufdecken') : null,
        c.phase === 'battle' ? h('button.btn.small', { onClick: async () => { if (await confirmBox('Offene Spiele/Aftermaths dieser Runde als erledigt markieren und nächste Runde starten?')) act(c.id, 'force_next', {}, 'Nächste Runde'); } }, 'Nächste Runde erzwingen') : null,
        h('button.btn.small.ghost', { onClick: () => settingsModal(c, act) }, 'Einstellungen'),
        h('button.btn.small.danger', { onClick: async () => { if (await confirmBox(`Kampagne „${c.name}“ endgültig löschen?`, 'Löschen')) act(c.id, 'delete', {}, 'Gelöscht'); } }, 'Löschen')));
  });
  const policy = h('input', { type: 'checkbox', checked: data.create_policy === 'master' });
  policy.addEventListener('change', async () => { await api('admin/settings', { create_policy: policy.checked ? 'master' : 'all' }); toast(policy.checked ? 'Nur der Master legt jetzt Kampagnen an.' : 'Jeder Besucher kann wieder Kampagnen anlegen.', 'ok'); });
  setView(topbar(h('button.btn.ghost.small', { onClick: async () => { await api('logout', { which: 'admin' }); setAdminCid(null); go('#/'); } }, 'Abmelden')),
    h('main.page',
      h('h1', '👑 Master-Bereich'),
      h('p.muted', `Angemeldet als ${st.me.admin.name}. Hier siehst du alle Kampagnen.`),
      h('div.card', h('h3', '🔒 Sicherheit'),
        h('label.check', policy, ' Nur der Master darf neue Kampagnen anlegen'),
        h('p.muted.small', 'Ausgeschaltet kann jeder Besucher der Seite eine Kampagne starten (begrenzt auf wenige pro Stunde). Eingeschaltet ist die Seite für Fremde nutzlos: Beitreten geht nur mit Einladungslink.')),
      h('div.card', h('details', h('summary', h('strong', '+ Neue Kampagne anlegen')),
        createCampaignForm(r => { toast('Kampagne angelegt – Link: ' + location.origin + '/#/k/' + r.invite_code, 'ok'); renderMaster(); }))),
      list.length ? list : h('p.muted', 'Noch keine Kampagnen.')));
}
function settingsModal(c, act) {
  const name = h('input', { value: c.name });
  const pts = h('input', { type: 'number', value: c.points_limit });
  const ul = h('input', { type: 'number', value: c.unit_limit });
  const uq = h('input', { type: 'checkbox', checked: !!c.allow_unique });
  const gf = h('input', { type: 'checkbox', checked: !!(c.options && c.options.guest_final) });
  const m = modal('Einstellungen', h('div', field('Name', name), field('Startpunkte', pts), field('Max. Punkte pro Einheit beim Start (0 = egal)', ul),
    h('label.check', uq, ' Einzigartige Einheiten erlaubt'),
    h('label.check', gf, ' Finale auch gegen einen Gastspieler möglich'),
    h('p.muted.small', 'Ohne Haken gilt die Battlepack-Regel: Das Finale wird zwischen zwei Kampagnenspielern ausgetragen, die es beide freigeschaltet haben.'),
    h('button.btn', { onClick: async () => { await act(c.id, 'settings', { name: name.value, points_limit: pts.value, unit_limit: ul.value, allow_unique: uq.checked, guest_final: gf.checked }, 'Gespeichert'); m.close(); } }, 'Speichern')));
}
export const phaseLabel = ph => ({ lobby: 'Aufstellung', move: 'Zugphase', resolving: 'Züge werden aufgedeckt…', battle: 'Schlachten & Aftermath', finished: 'Beendet' }[ph] || ph);

// ---------- Lobby mit den Plätzen ----------
async function renderLobby(codeStr) {
  const [lobby] = await Promise.all([api('lobby/' + codeStr), loadCatalog()]);
  const c = lobby.campaign, p = packOf(c.pack);
  const link = location.origin + '/#/k/' + c.invite_code;
  const slots = lobby.slots.map(s => {
    if (s.taken) {
      const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'PIN' });
      const login = async () => { await api('lobby/' + c.invite_code + '/login', { slot: s.slot, pin: pin.value }); setAdminCid(null); toast('Angemeldet.', 'ok'); go('#/c/lage'); };
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
        setAdminCid(null); toast('Willkommen in der Kampagne!', 'ok'); go('#/c/armee');
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
    h('p.muted.small', 'Jeder nimmt einen Platz und wählt eine PIN. Mit derselben PIN kannst du dich später auf jedem Gerät wieder anmelden. Nach 5 falschen PINs ist ein Platz vorübergehend gesperrt – der Master kann die PIN zurücksetzen.')));
}

// ---------- Kampagnen-Ansicht ----------
let pendingRedraw = false, currentDraw = null;
function tryRedraw() {
  if (!currentDraw) return;
  const active = document.activeElement;
  const typing = active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
  if (modalOpen() || typing || document.querySelector('[data-keep]')) { pendingRedraw = true; showRefreshHint(); return; }
  pendingRedraw = false; hideRefreshHint(); const y = window.scrollY; currentDraw(); window.scrollTo(0, y);
}
document.addEventListener('modalclosed', () => { if (pendingRedraw) tryRedraw(); });

async function renderCampaignRoute(parts) {
  const st = store.status;
  if (!st.me || (!st.me.player && !st.me.admin)) return go('#/');
  if (!st.me.admin && store.adminCid) setAdminCid(null);
  if (!st.me.player && !store.adminCid) return go('#/master');
  await loadCatalog();
  try { await loadState(true); } catch (e) {
    // Die gemerkte Kampagne gibt es nicht mehr (gelöscht) oder der Zugriff fehlt
    if (store.adminCid && (e.status === 404 || e.status === 403)) { setAdminCid(null); return go(st.me.player ? '#/c/lage' : '#/master'); }
    throw e;
  }
  const leave = async () => { await api('logout', { which: 'player' }); setAdminCid(null); go('#/'); };
  const draw = () => {
    const tab = parts[0] || 'lage';
    setViewKeep(renderCampaign(tab, parts.slice(1), { go, phaseLabel, logout: leave }));
  };
  currentDraw = draw; pendingRedraw = false; hideRefreshHint();
  draw(); window.scrollTo(0, 0);
  store.listeners.clear();
  poll = setInterval(async () => {
    if (document.hidden) return;
    try { if (await loadState()) tryRedraw(); } catch (e) {
      // Abgemeldet oder aus der Kampagne entfernt: zurück zur Startseite statt einer eingefrorenen Ansicht
      if (e && (e.status === 401 || e.status === 403)) { clearInterval(poll); poll = null; toast('Du bist nicht mehr angemeldet.', 'error'); setAdminCid(null); go('#/'); }
    }
  }, 5000);
  window.__redraw = () => { hideRefreshHint(); pendingRedraw = false; const y = window.scrollY; draw(); window.scrollTo(0, y); };
}
function hideRefreshHint() { const el = document.getElementById('refresh-hint'); if (el) el.remove(); }
function showRefreshHint() {
  if (document.getElementById('refresh-hint')) return;
  document.body.appendChild(h('button.refresh-hint', { id: 'refresh-hint', onClick: e => { e.target.remove(); window.__redraw && window.__redraw(); } }, '↻ Neuer Stand – aktualisieren'));
}
