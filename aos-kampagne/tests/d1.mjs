// Nachbildung der Cloudflare-D1-Schnittstelle auf einer SQLite-Datenbank im Arbeitsspeicher (node:sqlite).
// Verhält sich wie D1, wo es für die App zählt: prepare/bind/first/all/run, batch als Transaktion,
// meta.changes – und wirft wie D1 einen Fehler, wenn ein Wert „undefined“ gebunden wird.
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) {
    args.forEach((a, i) => { if (a === undefined) throw new Error(`D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined' (Parameter ${i + 1} in: ${this.sql.slice(0, 80)})`); });
    return new Stmt(this.db, this.sql, args.map(a => (typeof a === 'boolean' ? (a ? 1 : 0) : a)));
  }
  _prep() { return this.db.raw.prepare(this.sql); }
  _reads() { return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql); }
  _exec() {
    const st = this._prep();
    if (this._reads()) { const results = st.all(...this.args); return { results, success: true, meta: { changes: this.db.changesCount() } }; }
    const r = st.run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first() { const r = this._exec().results[0]; return r === undefined ? null : { ...r }; }
  async all() { const r = this._exec(); return { ...r, results: r.results.map(x => ({ ...x })) }; }
  async run() { return this._exec(); }
}

export function makeD1() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    raw,
    prepare: sql => new Stmt(db, sql),
    changesCount: () => Number(raw.prepare('SELECT changes() AS c').get().c),
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = stmts.map(s => s._exec()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return { prepare: sql => db.prepare(sql), batch: s => db.batch(s), raw };
}
