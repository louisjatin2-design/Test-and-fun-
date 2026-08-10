/**
 * Treibt die Browser-Engine für den Parity-Test.
 *
 * Zwei Betriebsarten, je nach Eingabe auf stdin:
 *
 *   {ruleset, cards, enhancements, list, patch}
 *       wendet die Aktionen an und validiert — also das, was
 *       `/api/lists/validate/incremental` serverseitig liefert.
 *
 *   {ruleset, cards, enhancements, list, generate: {config, keep_existing}}
 *       lässt den Browser-Generator eine Liste bauen — das Gegenstück zu
 *       `/api/lists/generate`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// rules.js ist bewusst kein ES-Modul (siehe Kopfkommentar dort), also wird
// es hier so ausgewertet, wie es auch der Browser täte.
const source = readFileSync(join(here, "..", "app", "static", "rules.js"), "utf8");
new Function(source).call(globalThis);

const input = JSON.parse(readFileSync(0, "utf8"));
const R = globalThis.WHRules;

const ctx = R.buildContext({
  cards: input.cards,
  enhancements: input.enhancements,
  ruleset: input.ruleset,
});

if (input.generate) {
  const ergebnis = R.generate(
    input.list, ctx, input.generate.config, input.generate.keep_existing);
  process.stdout.write(JSON.stringify(ergebnis));
} else {
  let state = R.normaliseList(input.list, input.ruleset.ruleset_version);
  let error = null;
  try {
    state = R.applyAll(state, input.patch ?? []);
  } catch (exc) {
    error = String(exc.message ?? exc);
  }

  process.stdout.write(JSON.stringify(
    error ? { error } : { list: state, validation: R.validate(state, ctx) },
  ));
}
