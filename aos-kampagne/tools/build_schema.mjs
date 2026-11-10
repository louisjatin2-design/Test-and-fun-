// Erzeugt src/schema.js aus sql/001_schema.sql:  node tools/build_schema.mjs
// (--check prüft nur, ob beide Dateien zusammenpassen – wird von den Tests benutzt)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function statements(sql) {
  return sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
}
export function render(sql) {
  const st = statements(sql);
  const tables = st.map(s => (s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1]).filter(Boolean);
  return '// Automatisch aus sql/001_schema.sql erzeugt (node tools/build_schema.mjs) – nicht von Hand ändern.\n'
    + '// Fehlende Tabellen werden beim ersten Aufruf angelegt.\n'
    + 'export const TABLES = ' + JSON.stringify(tables) + ';\n'
    + 'export const SCHEMA = [\n' + st.map(s => ' ' + JSON.stringify(s)).join(',\n') + '\n];\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = render(readFileSync(root + 'sql/001_schema.sql', 'utf8'));
  if (process.argv.includes('--check')) {
    if (readFileSync(root + 'src/schema.js', 'utf8') !== out) { console.error('src/schema.js ist veraltet – node tools/build_schema.mjs ausführen.'); process.exit(1); }
    console.log('src/schema.js ist aktuell.');
  } else { writeFileSync(root + 'src/schema.js', out); console.log('src/schema.js geschrieben.'); }
}
