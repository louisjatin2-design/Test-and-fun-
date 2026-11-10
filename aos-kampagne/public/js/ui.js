// Kleine UI-Bibliothek ohne Build-Schritt. Text wird immer als textContent gesetzt (kein XSS).

export function h(tag, attrs, ...children) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs == null) attrs = null;
  else if (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'onClick' && typeof v === 'function' && (el.tagName === 'BUTTON')) el.addEventListener('click', guarded(el, v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
// Solange die Aktion eines Buttons noch läuft (z. B. Speichern), wird ein zweiter Klick ignoriert.
// Das verhindert doppelte Gutschriften durch Doppeltippen auf dem Handy.
function guarded(el, fn) {
  return e => {
    if (el.dataset.busy) { e.preventDefault(); return; }
    let r;
    try { r = fn(e); } catch (err) { console.error(err); return; }
    if (r && typeof r.then === 'function') {
      el.dataset.busy = '1'; el.classList.add('busy');
      const done = () => { delete el.dataset.busy; el.classList.remove('busy'); };
      r.then(done, err => { done(); if (!(err && err.status)) console.error(err); });
    }
  };
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const possessive = n => /[sßxz]$/i.test(n) ? n + '’' : n + 's';
export const frag = (...c) => { const f = document.createDocumentFragment(); append(f, c); return f; };

// **fett** in Regeltexten -> <strong>
export function rich(text) {
  const out = [];
  String(text).split(/(\*\*[^*]+\*\*)/).forEach(part => {
    if (part.startsWith('**') && part.endsWith('**')) out.push(h('strong', part.slice(2, -2)));
    else if (part) out.push(part);
  });
  return out;
}

export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div.toast.' + kind, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

let modalStack = [];
export function modal(title, content, { wide = false, onClose } = {}) {
  const close = () => { wrap.remove(); modalStack = modalStack.filter(m => m !== wrap); onClose && onClose(); document.dispatchEvent(new Event('modalclosed')); };
  const wrap = h('div.modal-wrap', { onClick: e => { if (e.target === wrap) close(); } },
    h('div.modal' + (wide ? '.wide' : ''),
      h('div.modal-head', h('h3', title), h('button.icon-btn', { onClick: close, 'aria-label': 'Schließen' }, '✕')),
      h('div.modal-body', content)));
  document.body.appendChild(wrap);
  modalStack.push(wrap);
  const f = wrap.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
  if (f) setTimeout(() => f.focus(), 30);
  return { close, el: wrap };
}
export const modalOpen = () => modalStack.length > 0;

export function confirmBox(text, okLabel = 'Ja') {
  return new Promise(res => {
    let done = false;
    const m = modal('Bitte bestätigen', h('div',
      h('p', text),
      h('div.row.end',
        h('button.btn.ghost', { onClick: () => { done = true; m.close(); res(false); } }, 'Abbrechen'),
        h('button.btn', { onClick: () => { done = true; m.close(); res(true); } }, okLabel))), { onClose: () => { if (!done) res(false); } });
  });
}

// Würfel (kryptografisch zufällig)
export function rollDie(sides) { return 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % sides); }
export function rollExpr(expr) {
  // "D3", "2D6", "D6", "D3+3", "10D6"
  const m = String(expr).toUpperCase().replace('W', 'D').match(/^(\d*)D(\d+)([+-]\d+)?$/);
  if (!m) return { total: Number(expr) || 0, dice: [] };
  const n = Number(m[1] || 1), s = Number(m[2]), mod = Number(m[3] || 0);
  const dice = Array.from({ length: n }, () => rollDie(s));
  return { total: dice.reduce((a, b) => a + b, 0) + mod, dice };
}
export function exprRange(expr) {
  const m = String(expr).toUpperCase().replace('W', 'D').match(/^(\d*)D(\d+)([+-]\d+)?$/);
  if (!m) return [0, 999];
  const n = Number(m[1] || 1), s = Number(m[2]), mod = Number(m[3] || 0);
  return [n + mod, n * s + mod];
}
export const dieLabel = e => String(e).toUpperCase().replace(/D/g, 'W');

// Würfel-Widget: App würfelt ODER eigenes Ergebnis eintragen.
// onValue(value, viaApp, dice) wird aufgerufen, sobald ein Wert feststeht.
// Ein Wurf zählt: Sobald ein Wert feststeht, ist der Würfel-Knopf gesperrt (kein stilles Neuwürfeln).
// Ein von Hand eingetragenes Ergebnis lässt sich korrigieren (Tippfehler), solange nicht „locked“ gesetzt ist.
export function diceInput(expr, onValue, { label, value, disabled, locked } = {}) {
  const [lo, hi] = exprRange(expr);
  const has = value != null;
  const out = h('span.dice-val' + (has ? '.rolled' : ''), has ? String(value) : '–');
  const input = h('input.dice-in', { type: 'number', min: lo, max: hi, placeholder: 'echt', value: value ?? '', disabled: disabled || (has && locked), 'aria-label': 'Echtes Würfelergebnis eintragen' });
  let busy = false;
  const set = (v, viaApp, dice) => {
    if (busy) return;
    out.textContent = String(v); out.classList.add('rolled'); input.value = v; btn.disabled = true;
    const r = onValue && onValue(v, viaApp, dice);
    if (r && typeof r.then === 'function') { busy = true; r.then(() => { busy = false; }, () => { busy = false; }); }
  };
  const btn = h('button.btn.small.dice-btn', { type: 'button', disabled: disabled || has, title: has ? 'Schon gewürfelt' : 'Die App würfelt', onClick: () => { if (btn.disabled) return; const r = rollExpr(expr); set(r.total, true, r.dice); } }, '🎲 ' + dieLabel(expr));
  input.addEventListener('change', () => {
    if (input.value === '') return;
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < lo || v > hi) { toast(`Bitte eine ganze Zahl von ${lo} bis ${hi} eingeben.`, 'error'); input.value = out.classList.contains('rolled') ? out.textContent : ''; return; }
    set(v, false, null);
  });
  return h('span.dice', label ? h('span.dice-label', label) : null, btn, h('span.dice-or', 'oder'), input, h('span.dice-eq', '='), out);
}

export function select(options, value, onChange, attrs = {}) {
  const s = h('select', attrs, options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function field(label, control, hint) {
  return h('label.field', h('span.field-label', label), control, hint ? h('span.hint', hint) : null);
}

export function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Kopiert!', 'ok'), () => toast(text));
  else toast(text);
}

export function badge(text, kind = '') { return h('span.badge' + (kind ? '.' + kind : ''), text); }
export function fmtDate(s) { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
