// Kampagnenkarte als SVG. Ravaged Coast: Zonen + Straßen. Blighted Wilds: Schlachtplan-Netz mit Routen.
import { h, toast, confirmBox, badge } from './ui.js';
import { S, me, pack, playerById, colorOf, locName, api, loadState } from './store.js';
import { allowedTargets, zoneAccess } from './packs.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  kids.flat().forEach(k => k != null && el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
  return el;
}

export function renderMap() {
  const st = S(), c = st.campaign, p = pack(), mine = me();
  const canMove = mine && c.phase === 'move';
  const allowed = new Set(mine ? allowedTargets(p.id, mine) : []);
  const access = mine ? zoneAccess(p, mine) : {};
  const unlocked = new Set(mine && p.id === 'bw' ? (mine.data.unlocked || p.startUnlocked) : []);
  const svg = s('svg', { viewBox: '0 0 1000 660', class: 'map map-' + p.id, role: 'img', 'aria-label': 'Kampagnenkarte' });
  const defs = s('defs',
    s('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#c9b48a' })),
    s('marker', { id: 'arrR', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#d0453f' })),
    s('filter', { id: 'glow' }, s('feGaussianBlur', { stdDeviation: 4, result: 'b' }), s('feMerge', {}, s('feMergeNode', { in: 'b' }), s('feMergeNode', { in: 'SourceGraphic' }))),
    s('radialGradient', { id: 'lava' }, s('stop', { offset: '0%', 'stop-color': '#ff9d3c', 'stop-opacity': '.55' }), s('stop', { offset: '100%', 'stop-color': '#ff9d3c', 'stop-opacity': '0' })));
  svg.appendChild(defs);

  // Hintergrund
  if (p.id === 'rc') {
    svg.appendChild(s('rect', { x: 0, y: 0, width: 1000, height: 660, fill: '#1d1410' }));
    const zones = [
      ['outskirts', 'M0,0 H385 C360,140 400,260 370,360 C350,470 400,560 380,660 H0 Z'],
      ['gnaw', 'M385,0 H640 C610,120 650,250 620,360 C600,470 640,560 620,660 H380 C400,560 350,470 370,360 C400,260 360,140 385,0 Z'],
      ['shores', 'M640,0 H860 C820,90 880,170 850,260 C820,360 900,430 880,560 C870,610 880,640 870,660 H620 C640,560 600,470 620,360 C650,250 610,120 640,0 Z'],
    ];
    zones.forEach(([z, d]) => svg.appendChild(s('path', { d, fill: p.zones[z].color, opacity: access[z] === false ? .28 : .55 })));
    svg.appendChild(s('path', { d: 'M860,0 H1000 V660 H870 C880,640 870,610 880,560 C900,430 820,360 850,260 C880,170 820,90 860,0 Z', fill: '#0f2a36' }));
    svg.appendChild(s('ellipse', { cx: 905, cy: 255, rx: 70, ry: 55, fill: p.zones.claw.color, opacity: access.claw === false ? .35 : .75 }));
    svg.appendChild(s('circle', { cx: 500, cy: 300, r: 220, fill: 'url(#lava)' }));
    [['Scorched Outskirts', 30, 640], ["Gnaw's Edge", 420, 640], ['Hateful Shores', 660, 640], ["Hel's Claw", 860, 340]].forEach(([t, x, y]) => svg.appendChild(s('text', { x, y, class: 'zone-label' }, t)));
  } else {
    svg.appendChild(s('rect', { x: 0, y: 0, width: 1000, height: 660, fill: '#0f1a12' }));
    for (let i = 0; i < 40; i++) {
      const x = (i * 137) % 1000, y = (i * 263) % 660;
      svg.appendChild(s('circle', { cx: x, cy: y, r: 30 + (i % 5) * 12, fill: '#1d3a22', opacity: .45 }));
    }
    svg.appendChild(s('text', { x: 20, y: 640, class: 'zone-label' }, 'Thyria – der verseuchte Dschungel'));
  }
  // Verbindungen
  const node = k => p.nodes.find(n => n.key === k);
  for (const l of p.links) {
    const a = node(l.from), b = node(l.to);
    if (p.id === 'bw') {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const ox = dx / len * 34, oy = dy / len * 34;
      const twoWay = p.links.some(x => x.from === l.to && x.to === l.from);
      const shift = twoWay ? 7 : 0;
      const nx = -dy / len * shift, ny = dx / len * shift;
      const ex = b.x - ox + nx, ey = b.y - oy + ny;
      svg.appendChild(s('line', { x1: a.x + ox + nx, y1: a.y + oy + ny, x2: ex - dx / len * 8, y2: ey - dy / len * 8, class: 'route ' + l.type }));
      // Pfeilspitze von Hand (robuster als SVG-Marker)
      const ux = dx / len, uy = dy / len, px = -uy, py = ux;
      const pts = [[ex, ey], [ex - ux * 14 + px * 7, ey - uy * 14 + py * 7], [ex - ux * 14 - px * 7, ey - uy * 14 - py * 7]].map(q => q.join(',')).join(' ');
      svg.appendChild(s('polygon', { points: pts, class: 'arrow ' + l.type }));
    } else {
      svg.appendChild(s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'road' }));
    }
  }
  // Felder
  const players = st.players;
  for (const n of p.nodes) {
    const loc = st.locations.find(l => l.key === n.key) || {};
    const owner = loc.owner_player_id ? playerById(loc.owner_player_id) : null;
    const isAllowed = canMove && allowed.has(n.key);
    const locked = mine && (p.id === 'bw' ? !unlocked.has(n.key) : access[n.zone] === false);
    const g = s('g', { class: 'node' + (isAllowed ? ' allowed' : '') + (locked ? ' locked' : '') + (mine && mine.pending_move === n.key ? ' chosen' : ''), transform: `translate(${n.x},${n.y})`, tabindex: isAllowed ? 0 : null });
    if (isAllowed) g.appendChild(s('circle', { r: 31, class: 'halo', filter: 'url(#glow)' }));
    g.appendChild(s('circle', { r: 22, class: 'node-c', fill: owner ? colorOf(owner.id) : (p.id === 'bw' ? '#2e4a30' : '#3a2a20') }));
    if (p.id === 'bw') g.appendChild(s('text', { y: 6, class: 'node-icon' }, n.key === 'bp' ? '☠' : locked ? '🔒' : '✦'));
    else g.appendChild(s('text', { y: 6, class: 'node-icon' }, n.zone === 'claw' ? '☠' : locked ? '🔒' : '◆'));
    const label = n.name;
    g.appendChild(s('text', { y: 40, class: 'node-label' }, label));
    // Spieler-Marker
    const here = players.filter(x => x.location_key === n.key);
    here.forEach((x, i) => {
      const ang = (-90 + i * 70) * Math.PI / 180;
      const tx = Math.cos(ang) * 26, ty = Math.sin(ang) * 26 - 4;
      g.appendChild(s('g', { class: 'token', transform: `translate(${tx},${ty})` },
        s('circle', { r: 11, fill: colorOf(x.id), stroke: '#fff', 'stroke-width': 2 }),
        s('text', { y: 4, class: 'token-t' }, x.name.slice(0, 1).toUpperCase())));
    });
    if (mine && mine.pending_move === n.key) g.appendChild(s('circle', { r: 28, class: 'chosen-ring' }));
    g.appendChild(s('title', {}, `${n.name}${owner ? ' – gehalten von ' + owner.name : ''}${here.length ? ' – hier: ' + here.map(x => x.name).join(', ') : ''}`));
    if (isAllowed) {
      const pick = async () => {
        if (!(await confirmBox(`Geheim nach „${n.name}“ ziehen?`, 'Ziehen'))) return;
        await api('move', { target: n.key });
        toast('Zug gespeichert – geheim, bis alle gezogen haben.', 'ok');
        await loadState(true); window.__redraw && window.__redraw();
      };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    }
    svg.appendChild(g);
  }

  // Legende & Hinweise
  const info = [];
  if (canMove) info.push(h('div.card.highlight', h('strong', 'Du bist am Zug: '),
    mine.pending_move ? `Gewählt: ${locName(mine.pending_move)} (änderbar bis zum Aufdecken).` : 'Tippe auf ein leuchtendes Feld, um geheim dorthin zu ziehen.',
    p.id === 'bw' ? ' In Blighted Wilds kannst du jeden Schlachtplan wählen, den du freigeschaltet hast.' : ' Du kannst auf ein Nachbarfeld ziehen oder stehen bleiben.'));
  if (p.id === 'rc') info.push(h('div.card', h('h3', 'Zonen'), h('ul.legend', p.zoneOrder.map(z => h('li',
    h('span.swatch', { style: { background: p.zones[z].color } }), h('strong', p.zones[z].name), ' – ', p.zones[z].need,
    mine ? (access[z] ? badge('frei', 'ok') : badge('gesperrt')) : null))),
    mine ? h('p.muted.small', `Du hast insgesamt ${mine.vault_total} Splitter gesammelt.`) : null));
  else info.push(h('div.card', h('h3', 'Routen'), h('ul.legend',
    h('li', h('span.line.path'), h('strong', 'Thyrian Path'), ' – wird entdeckt, sobald du mit dem Schlachtplan gekämpft hast.'),
    h('li', h('span.line.trail'), h('strong', 'Concealed Trail'), ' – wird entdeckt, sobald du mit dem Schlachtplan gewonnen hast.'),
    h('li', '🔒 = für dich noch nicht entdeckt · ☠ = Finale')),
    mine ? h('p.muted.small', 'Für dich freigeschaltet: ' + p.nodes.filter(n => unlocked.has(n.key)).map(n => n.name).join(', ')) : null));
  info.push(h('div.card', h('h3', 'Positionen'), h('ul.legend', players.map(x => h('li', h('span.dot', { style: { background: colorOf(x.id) } }), h('strong', x.name), ' – ', locName(x.location_key), c.phase === 'move' ? (x.moved ? ' ✓' : ' …') : '')))));
  return h('div.stack', h('h2', '🗺 ' + (p.id === 'bw' ? 'Die Routen durch Thyria' : 'Die Ravaged Coast')), h('div.map-wrap', svg), info);
}
