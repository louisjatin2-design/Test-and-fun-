/**
 * Treibt die Browser-Engine für den Parity-Test.
 *
 * Liest {ruleset, cards, enhancements, list, patch} von stdin, wendet die
 * Aktionen an, validiert und gibt {list, validation} auf stdout aus — genau
 * das, was `/api/lists/validate/incremental` serverseitig liefert.
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
