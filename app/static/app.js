/**
 * Listenbuilder mit Regel-Inspektor — PLAN.md §6.
 *
 * Zwei Entwurfsentscheidungen bestimmen den Aufbau:
 *
 * 1. **Der Reducer läuft auf dem Server** (§6.5). Der Client schickt Aktionen
 *    an /api/lists/validate/incremental und bekommt neuen Zustand plus
 *    Validierung zurück. Builder und Generator können die Liste damit gar
 *    nicht unterschiedlich interpretieren.
 * 2. **Karten werden pro Fraktion einmal geladen** (§6.4). Jeder Klick auf
 *    eine Einheit ist danach ein lokaler Lookup — kein Netzwerkzugriff im
 *    Pfad zwischen Klick und sichtbarem Regeltext.
 */

const STORAGE_KEY = "warhammer-meta:list";

const state = {
  meta: null,
  cards: new Map(),      // datasheet_id -> Kartendokument
  enhancements: new Map(),  // Detachment-Regeln, einmal je Fraktion geladen
  stratagems: new Map(),
  stratagemsByDetachment: {},
  list: null,            // BuilderList
  validation: null,
  history: [],           // Zustände für Undo
  future: [],            // Zustände für Redo
  inspected: null,       // datasheet_id im Panel
  pinned: false,
  queue: Promise.resolve(),
  dataVersion: 0,        // Regelstand, auf dem die geladenen Karten beruhen
};

/** Wird nach der Backend-Definition gesetzt (siehe unten). */
let backend;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------- Eingabegerät
// Zwei Fragen, die das Verhalten ändern, und beide sind zur Laufzeit
// veränderlich: Ein iPad bekommt eine Tastatur mit Trackpad angesteckt, ein
// Fenster wird schmaler gezogen. Sie werden deshalb bei jedem Zugriff neu
// beantwortet, nicht einmal beim Start.

/** Gibt es einen Zeiger, der über etwas schweben kann, ohne zu klicken? */
const canHover = () =>
  window.matchMedia?.("(hover: hover)").matches ?? true;

/**
 * Liegt der Inspektor als Sheet über der Liste, statt eine eigene Spalte zu
 * sein? Die Antwort steht im Stylesheet — dort entscheidet die Breite. Hier
 * wird sie nur abgelesen, damit Breakpoint und Verhalten nicht mit der Zeit
 * auseinanderlaufen.
 */
const sheetMode = () =>
  getComputedStyle($("inspector")).position === "fixed";

// ------------------------------------------------------------------ Backend
// Zwei Betriebsarten hinter einer Schnittstelle:
//
//   Server   — FastAPI beantwortet alles, der Reducer läuft dort (§6.5).
//   Offline  — eine einzelne HTML-Datei mit eingebetteten Daten, die auf
//              einem Telefon ohne Python und ohne Netz läuft. Reducer und
//              Validator kommen aus rules.js; der Parity-Test hält beide
//              Engines deckungsgleich.
//
// Der Rest der Datei kennt nur `backend` und weiß nicht, welche gerade läuft.

/**
 * Die eingebetteten Daten der Offline-Datei, oder `null` im Serverbetrieb.
 *
 * **Warum aus einem `<script type="application/json">` und nicht aus einer
 * Zuweisung.** Früher schrieb der Build `window.WH_OFFLINE = { … }` in
 * dasselbe `<script>`, in dem auch rules.js und app.js stehen. Bei allen
 * Fraktionen sind das rund 13 MB Objektliteral, und ein Objektliteral muss
 * der JavaScript-Parser vollständig durchlaufen, bevor auch nur die erste
 * Zeile Code läuft. Scheitert er daran — auf iPhone und iPad ist der
 * Arbeitsspeicher je Seite knapp —, dann fällt das *ganze* Script aus:
 * Reducer, Validator und Oberfläche gleich mit. Sichtbar war davon nichts
 * als eine Fraktionsauswahl, die leer blieb.
 *
 * In einem eigenen `<script type="application/json">` ist die Datenmenge
 * für den JavaScript-Parser unsichtbar; `JSON.parse` liest sie danach in
 * einem Rutsch und ist dabei deutlich sparsamer. Und geht es doch schief,
 * ist es ein Fehler *in* `init()` — der Startbildschirm zeigt ihn an,
 * statt dass die Seite tot dasteht.
 */
function offlineData() {
  const tag = document.getElementById("wh-data");
  if (tag) return JSON.parse(tag.textContent);
  // Rückfall für ältere Offline-Dateien, die noch eine Zuweisung enthalten.
  return window.WH_OFFLINE ?? null;
}

function serverBackend() {
  return {
    offline: false,
    meta: () => api("/api/meta"),
    factions: () => api("/api/factions"),
    detachments: (id) => api(`/api/factions/${encodeURIComponent(id)}/detachments`),
    factionData: (id) => api(`/api/factions/${encodeURIComponent(id)}/cards`),
    validate: (list) => api("/api/lists/validate", {
      method: "POST", body: JSON.stringify({ list }),
    }),
    applyPatch: (list, patch) => api("/api/lists/validate/incremental", {
      method: "POST", body: JSON.stringify({ list, patch }),
    }),
    unitContext: (id) => api(`/api/datasheets/${encodeURIComponent(id)}/context`),
    canGenerate: true,
    generate: (list, mode) => api("/api/lists/generate", {
      method: "POST", body: JSON.stringify({ list, mode }),
    }),
    subscribe(onChange) {
      if (typeof EventSource === "undefined") return;
      const source = new EventSource("/api/events");
      source.addEventListener("hello", (event) => {
        state.dataVersion = JSON.parse(event.data).data_version;
      });
      source.addEventListener("ruleset-changed", (event) => {
        const info = JSON.parse(event.data);
        if (info.data_version !== state.dataVersion) onChange(info);
      });
      // Kein eigener Reconnect nötig: EventSource versucht es von selbst
      // wieder. Ein Fehler heißt hier "Server weg", nicht "kaputt".
      source.onerror = () => {};
    },
  };
}

function offlineBackend(data) {
  const contexts = new Map();

  const contextFor = (factionId) => {
    if (!contexts.has(factionId)) {
      contexts.set(factionId, WHRules.buildContext({
        cards: data.cards[factionId] ?? [],
        enhancements: data.enhancements[factionId] ?? {},
        ruleset: data.ruleset,
      }));
    }
    return contexts.get(factionId);
  };

  const check = (list) => {
    const normalised = WHRules.normaliseList(list, data.meta.ruleset_version);
    return WHRules.validate(normalised, contextFor(normalised.faction_id));
  };

  return {
    offline: true,
    meta: async () => data.meta,
    factions: async () => data.factions,
    detachments: async (id) => data.detachments[id] ?? [],
    factionData: async (id) => ({
      faction_id: id,
      cards: data.cards[id] ?? [],
      enhancements: data.enhancements[id] ?? {},
      stratagems: data.stratagems[id] ?? {},
      stratagems_by_detachment: data.stratagems_by_detachment[id] ?? {},
    }),
    validate: async (list) => check(list),
    applyPatch: async (list, patch) => {
      const start = WHRules.normaliseList(list, data.meta.ruleset_version);
      const next = WHRules.applyAll(start, patch);
      return { list: next, validation: check(next) };
    },
    // Die regelbasierte Synergie (§4.1) ist vorgerechnet und liegt als
    // Daten in der Datei — sie hängt nur an den Regeln, nicht am Server.
    unitContext: async (id) => {
      const faction = state.list.faction_id;
      const treffer = (data.synergies?.[faction] ?? {})[id] ?? [];
      const counts = {};
      for (const eintrag of treffer) {
        counts[eintrag.kind] = (counts[eintrag.kind] ?? 0) + 1;
      }
      return {
        datasheet_id: id,
        rules_based: {
          available: treffer.length > 0,
          synergies: treffer,
          counts,
          ...(data.synergy_meta ?? {}),
        },
        empirical: { available: false, reason: data.meta.context_reason },
      };
    },
    // Der Generator läuft hier genauso wie Reducer und Validator: als
    // Zwilling in rules.js. Die Doppelung ist tragbar, weil
    // tests/test_parity.py beide Seiten dieselben Listen bauen lässt und
    // Eintrag für Eintrag vergleicht — und weil die Stellschrauben aus
    // generator.as_dict() kommen, also weiterhin nur einmal existieren.
    canGenerate: true,
    generate: async (list, mode) => WHRules.generate(
      list, contextFor(list.faction_id), data.generator, mode === "fill"),
    // Ohne Server gibt es keinen neuen Regelstand zu melden. Eine neue
    // Offline-Datei ist ein neuer Download, kein Live-Update.
    subscribe() {},
  };
}

// ---------------------------------------------------------------- Netzwerk

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status}: ${detail}`);
  }
  return response.json();
}

/** Aktionen serialisieren — sonst überholen sich schnelle Klicks gegenseitig. */
function dispatch(...actions) {
  state.queue = state.queue.then(async () => {
    const before = state.list;
    const result = await backend.applyPatch(state.list, actions);
    state.history.push(before);
    state.future = [];
    state.list = result.list;
    state.validation = result.validation;
    persist();
    render();
  }).catch((error) => {
    console.error(error);
    alert(`Aktion fehlgeschlagen — ${error.message}`);
  });
  return state.queue;
}

async function revalidate() {
  state.validation = await backend.validate(state.list);
}

// -------------------------------------------------------------- Persistenz

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.list));
  } catch (error) {
    console.warn("Autosave nicht möglich:", error);
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- Kartendaten

async function loadFactionCards(factionId) {
  state.cards.clear();
  state.enhancements.clear();
  state.stratagems.clear();
  state.stratagemsByDetachment = {};
  if (!factionId) return;

  // Ein Request bringt Karten und Detachment-Regeln. Letztere liegen daneben
  // statt in jeder Karte — sonst vervielfacht sich derselbe Text pro
  // Datasheet (bei Space Marines: 43 MB statt gut 2).
  const data = await backend.factionData(factionId);
  for (const card of data.cards) state.cards.set(card.id, card);
  for (const [id, enhancement] of Object.entries(data.enhancements ?? {})) {
    state.enhancements.set(id, enhancement);
  }
  for (const [id, stratagem] of Object.entries(data.stratagems ?? {})) {
    state.stratagems.set(id, stratagem);
  }
  state.stratagemsByDetachment = data.stratagems_by_detachment ?? {};
}

/** Enhancements, die dieses Datasheet tragen darf. */
function enhancementsFor(item) {
  return (item.enhancement_ids ?? [])
    .map((id) => state.enhancements.get(id))
    .filter(Boolean);
}

/** Stratagems der Detachments, zu denen dieses Datasheet gehört. */
function stratagemsFor(item) {
  const ids = (item.detachment_ids ?? [])
    .flatMap((detachmentId) => state.stratagemsByDetachment[detachmentId] ?? []);
  return [...new Set(ids)].map((id) => state.stratagems.get(id)).filter(Boolean);
}

const card = (id) => state.cards.get(id);

function cheapestCost(entryCard) {
  if (!entryCard?.points?.length) return 0;
  return Math.min(...entryCard.points.map((p) => p.cost).filter((c) => c > 0));
}

// ------------------------------------------------------------------- Start

/** Startbildschirm weg — ab hier ist die Oberfläche bedienbar. */
function bootDone() {
  $("boot")?.remove();
}

/**
 * Startbildschirm stehen lassen und erklären, woran es lag.
 *
 * Die Oberfläche dahinter bleibt bewusst unberührt: Ein halb aufgebauter
 * Builder, in dem die Fraktionsliste leer ist, sieht aus wie ein bedienbares
 * Programm und ist keines. Das war genau der Fehler auf dem iPad.
 */
function bootFailed(error) {
  console.error(error);
  const box = $("boot");
  if (!box) {
    alert(`Start fehlgeschlagen — ${error.message}`);
    return;
  }
  box.classList.add("boot-visible", "boot-error");
  $("boot-title").textContent = "Start fehlgeschlagen";
  $("boot-text").textContent = String(error && error.message ? error.message : error);
  // Nicht über `backend`: Scheitert schon das Einlesen der Daten, ist es noch
  // gar nicht gesetzt — und dann stünde ausgerechnet in der Offline-Datei die
  // Frage, ob der Server noch läuft. Das Datenelement selbst ist das
  // verlässlichere Merkmal.
  $("boot-hint").textContent = document.getElementById("wh-data") || window.WH_OFFLINE
    ? "Die Datei ist vermutlich unvollständig oder für dieses Gerät zu groß. "
      + "Neu bauen — am besten mit --faction und nur den Fraktionen, die du spielst."
    : "Läuft der Server noch? Die Seite braucht ihn für Regeln und Validierung.";
}

async function init() {
  const offline = offlineData();
  backend = offline ? offlineBackend(offline) : serverBackend();
  state.meta = await backend.meta();

  const badge = $("mode-badge");
  badge.textContent = state.meta.rules_text_mode === "full"
    ? "Regeltexte: Volltext"
    : "Regeltexte: abgeleitet";
  badge.classList.toggle("full", state.meta.rules_text_mode === "full");

  $("attribution").innerHTML =
    `<a href="${state.meta.attribution.url}" target="_blank" rel="noopener">` +
    `${escapeHtml(state.meta.attribution.text)}</a> · ` +
    `${escapeHtml(state.meta.attribution.notice)} · ` +
    `Regelstand ${escapeHtml(state.meta.last_update || "unbekannt")}`;

  if (!state.meta.has_data) {
    $("empty-state").classList.add("show");
    bootDone();
    return;
  }

  // Ohne Server kein Generator — der Knopf verschwindet, statt tot
  // dazustehen. Die Offline-Datei sagt im Übrigen selbst, was sie ist.
  if (!backend.canGenerate) $("generate").hidden = true;

  const limits = $("points-limit");
  for (const limit of state.meta.points_limits) {
    limits.append(new Option(`${limit} Pkt.`, limit));
  }

  const factions = await backend.factions();
  for (const faction of factions) {
    $("faction").append(new Option(faction.name, faction.id));
  }

  const limitList = state.meta.points_limits ?? [];
  const saved = restore();
  state.list = saved ?? {
    faction_id: "", detachment_id: "",
    // Kein `.at(-1)`: Das gibt es erst ab iOS 15.4, und die Offline-Datei
    // soll auch auf einem älteren iPad starten, das nur noch daliegt.
    points_limit: limitList[limitList.length - 1] ?? 2000,
    ruleset_version: state.meta.ruleset_version,
    mfm_version: "", name: "Neue Liste", entries: [],
  };

  $("faction").value = state.list.faction_id;
  $("points-limit").value = state.list.points_limit;
  $("list-name").value = state.list.name;

  if (state.list.faction_id) {
    await loadFactionCards(state.list.faction_id);
    await loadDetachments(state.list.faction_id);
    $("detachment").value = state.list.detachment_id;
  }

  state.dataVersion = state.meta.data_version ?? 0;

  await revalidate();
  wireEvents();
  connectLiveUpdates();
  render();
  bootDone();
}

async function loadDetachments(factionId) {
  const select = $("detachment");
  select.innerHTML = '<option value="">– wählen –</option>';
  if (!factionId) return;
  const detachments = await backend.detachments(factionId);
  for (const detachment of detachments) {
    select.append(new Option(detachment.name, detachment.id));
  }
}

// ------------------------------------------------------------------ Events

function wireEvents() {
  $("faction").addEventListener("change", async (event) => {
    const factionId = event.target.value;
    await loadFactionCards(factionId);
    await loadDetachments(factionId);
    closeInspector();
    await dispatch({ type: "SET_FACTION", faction_id: factionId });
  });

  $("detachment").addEventListener("change", (event) =>
    dispatch({ type: "SET_DETACHMENT", detachment_id: event.target.value }));

  $("points-limit").addEventListener("change", (event) =>
    dispatch({ type: "SET_POINTS_LIMIT", points_limit: Number(event.target.value) }));

  $("list-name").addEventListener("change", (event) =>
    dispatch({ type: "RENAME", name: event.target.value }));

  $("search").addEventListener("input", renderCatalog);
  $("sort").addEventListener("change", renderCatalog);

  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("export").addEventListener("click", exportList);

  $("update-apply").addEventListener("click", applyUpdate);
  $("update-dismiss").addEventListener("click", () => {
    // Nur wegklicken; beim nächsten Regelstand meldet sich der Server wieder.
    $("update-banner").hidden = true;
    state.dataVersion = Number($("update-banner").dataset.version || 0);
  });

  $("insp-close").addEventListener("click", closeInspector);
  $("insp-pin").addEventListener("click", () => {
    state.pinned = !state.pinned;
    $("insp-pin").setAttribute("aria-pressed", String(state.pinned));
  });
  $("sheet-backdrop").addEventListener("click", closeInspector);

  // Reiter — nur auf dem Telefon sichtbar, siehe styles.css.
  $("tab-catalog").addEventListener("click", () => selectTab("catalog"));
  $("tab-army").addEventListener("click", () => selectTab("army"));

  wireExport();
  wireGenerator();

  // Vom Hoch- ins Querformat gedreht kann aus dem Sheet eine Spalte werden
  // (und umgekehrt). Dann muss die Abdeckung mitziehen, sonst bleibt ein
  // grauer Schleier über einer Ansicht, die gar kein Sheet mehr ist.
  window.addEventListener("resize", syncBackdrop);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("inspector").hidden) closeInspector();
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key === "z") { event.preventDefault(); undo(); }
    if (ctrl && (event.key === "y" || (event.key === "z" && event.shiftKey))) {
      event.preventDefault(); redo();
    }
  });
}

/** Telefonansicht: Katalog und Liste teilen sich die Fläche nicht, sie lösen
 *  sich ab. Auf breiteren Geräten stehen beide nebeneinander und die Klassen
 *  bleiben ohne Wirkung. */
function selectTab(which) {
  const main = document.querySelector("main");
  main.classList.toggle("show-catalog", which === "catalog");
  main.classList.toggle("show-army", which === "army");
  $("tab-catalog").setAttribute("aria-selected", String(which === "catalog"));
  $("tab-army").setAttribute("aria-selected", String(which === "army"));
}

function syncBackdrop() {
  const open = !$("inspector").hidden;
  $("sheet-backdrop").hidden = !(open && sheetMode());
}

async function undo() {
  if (!state.history.length) return;
  state.future.push(state.list);
  state.list = state.history.pop();
  await revalidate();
  persist();
  render();
}

async function redo() {
  if (!state.future.length) return;
  state.history.push(state.list);
  state.list = state.future.pop();
  await revalidate();
  persist();
  render();
}

// ------------------------------------------------------------------ Render

function render() {
  renderCatalog();
  renderArmy();
  renderBudget();
  renderFindings();
  renderTabs();
  $("undo").disabled = !state.history.length;
  $("redo").disabled = !state.future.length;
}

/**
 * Zähler am Reiter "Liste".
 *
 * Auf dem Telefon ist die Liste beim Hinzufügen gar nicht zu sehen — der
 * Katalog füllt den Bildschirm. Ohne Rückmeldung tippt man ins Leere und
 * weiß nicht, ob die Einheit angekommen ist. Der Zähler schließt diese
 * Lücke, und ein Regelbruch färbt ihn rot: Sonst bliebe auf dem Telefon
 * unbemerkt, dass die Liste illegal geworden ist, weil die Meldungen im
 * anderen Reiter stehen.
 */
function renderTabs() {
  const badge = $("tab-count");
  badge.textContent = String(state.list.entries.length);
  badge.classList.toggle("bad", Boolean(state.validation?.errors));
}

function renderBudget(preview = null) {
  const used = state.validation?.points_used ?? 0;
  const limit = state.list.points_limit || 1;
  const shown = preview ?? used;
  const box = $("budget");
  box.classList.toggle("over", shown > limit);
  $("budget-fill").style.width = `${Math.min(100, (shown / limit) * 100)}%`;
  $("budget-text").innerHTML = preview === null
    ? `${used} / ${limit} · ${limit - used} frei`
    : `${used} / ${limit} · <span class="preview">danach ${preview}</span>`;
}

function renderCatalog() {
  const container = $("catalog-list");
  container.innerHTML = "";

  if (!state.list.faction_id) {
    container.innerHTML = '<p class="empty-note">Erst eine Fraktion wählen.</p>';
    return;
  }

  const term = $("search").value.trim().toLowerCase();
  let cards = [...state.cards.values()];
  if (term) cards = cards.filter((c) => c.name.toLowerCase().includes(term));

  const sort = $("sort").value;
  const groups = new Map();
  for (const item of cards) {
    const key = sort === "role" ? (item.role || "Other") : "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [role, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    items.sort((a, b) => sort === "points"
      ? cheapestCost(a) - cheapestCost(b) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));

    const group = document.createElement("div");
    group.className = "cat-group";
    if (role) group.innerHTML = `<h3>${escapeHtml(role)}</h3>`;

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "cat-item" + (state.inspected === item.id ? " selected" : "");
      row.tabIndex = 0;
      row.innerHTML =
        `<span class="nm">${escapeHtml(item.name)}</span>` +
        `<span class="pts">${cheapestCost(item) || "–"}</span>` +
        `<button class="add" title="Zur Liste hinzufügen">+</button>`;

      // Klick auf die Zeile öffnet die Regeln, das Plus fügt hinzu.
      row.addEventListener("click", (event) => {
        if (event.target.closest(".add")) {
          event.stopPropagation();
          addUnit(item);
        } else {
          openInspector(item.id);
        }
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter") openInspector(item.id);
        if (event.key === "+") addUnit(item);
      });
      // Punktevorschau beim Überfahren. Am Touchscreen gibt es kein
      // Überfahren: Dort schickt der Browser beim Antippen ein einmaliges
      // `mouseenter` hinterher und nie das passende `mouseleave` — die
      // Vorschau bliebe stehen und die Budgetleiste zeigte dauerhaft eine
      // Zahl an, die niemand ausgelöst hat.
      row.addEventListener("mouseenter", () => {
        if (!canHover()) return;
        renderBudget((state.validation?.points_used ?? 0) + cheapestCost(item));
      });
      row.addEventListener("mouseleave", () => {
        if (!canHover()) return;
        renderBudget();
      });

      group.append(row);
    }
    container.append(group);
  }

  if (!cards.length) {
    container.innerHTML = '<p class="empty-note">Keine Einheit gefunden.</p>';
  }
}

function addUnit(item) {
  const smallest = item.points?.length
    ? item.points.reduce((a, b) => (a.models <= b.models ? a : b))
    : null;
  return dispatch({
    type: "ADD_UNIT",
    datasheet_id: item.id,
    model_count: smallest?.models ?? 1,
  });
}

function renderArmy() {
  const container = $("army-list");
  container.innerHTML = "";

  const badge = $("legal-badge");
  if (!state.list.entries.length) {
    badge.textContent = "";
    badge.className = "badge";
    container.innerHTML =
      '<p class="empty-note">Noch leer. Einheiten links über <strong>+</strong> ' +
      "hinzufügen; ein Klick auf den Namen zeigt die Regeln.</p>";
    return;
  }

  const legal = state.validation?.legal;
  badge.textContent = legal ? "legal" : `${state.validation?.errors ?? 0} Regelbruch`;
  badge.className = `badge ${legal ? "ok" : "bad"}`;

  const errorUids = new Set(
    (state.validation?.findings ?? [])
      .filter((f) => f.severity === "error" && f.uid)
      .map((f) => f.uid));

  // Angeschlossene Leader und eingestiegene Einheiten direkt unter ihrem Ziel.
  const children = new Map();
  for (const entry of state.list.entries) {
    const parent = entry.attached_to_uid || entry.transported_in_uid;
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entry);
  }

  const emit = (entry, depth) => {
    container.append(renderEntry(entry, errorUids.has(entry.uid), depth));
    for (const child of children.get(entry.uid) ?? []) emit(child, depth + 1);
  };

  for (const entry of state.list.entries) {
    if (!entry.attached_to_uid && !entry.transported_in_uid) emit(entry, 0);
  }
}

function renderEntry(entry, hasError, depth) {
  const entryCard = card(entry.datasheet_id);
  const points = state.validation?.per_entry_points?.[entry.uid] ?? 0;

  const node = document.createElement("div");
  node.className = "entry"
    + (entry.attached_to_uid ? " attached" : "")
    + (entry.transported_in_uid ? " embarked" : "")
    + (hasError ? " invalid" : "");

  const main = document.createElement("div");
  main.className = "entry-main";
  main.innerHTML =
    `<span class="nm">${escapeHtml(entryCard?.name ?? entry.datasheet_id)}</span>` +
    (entry.is_warlord ? '<span class="warlord" title="Warlord">★</span>' : "") +
    `<span class="pts">${points}</span>`;
  main.addEventListener("click", () => openInspector(entry.datasheet_id, entry.uid));
  node.append(main);

  node.append(renderEntryOptions(entry, entryCard));
  return node;
}

function renderEntryOptions(entry, entryCard) {
  const box = document.createElement("div");
  box.className = "entry-opts";
  if (!entryCard) return box;

  // Truppgröße
  if (entryCard.points?.length > 1) {
    const select = document.createElement("select");
    select.title = "Truppgröße";
    for (const option of entryCard.points) {
      const label = `${option.description} · ${option.cost} Pkt.`;
      const opt = new Option(label, option.models);
      opt.selected = option.models === entry.model_count;
      select.append(opt);
    }
    select.addEventListener("change", (event) => dispatch({
      type: "SET_MODEL_COUNT", uid: entry.uid,
      model_count: Number(event.target.value),
    }));
    box.append(select);
  }

  // Leader-Anschluss: nur Ziele, die Datasheets_leader hergibt (§6.1).
  const canLead = new Set((entryCard.can_lead ?? []).map((t) => t.id));
  const targets = state.list.entries.filter((other) =>
    other.uid !== entry.uid && canLead.has(other.datasheet_id));
  if (targets.length) {
    const select = document.createElement("select");
    select.title = "Anschließen an";
    select.append(new Option("– nicht angeschlossen –", ""));
    for (const target of targets) {
      const opt = new Option(`→ ${card(target.datasheet_id)?.name}`, target.uid);
      opt.selected = entry.attached_to_uid === target.uid;
      select.append(opt);
    }
    select.addEventListener("change", (event) => dispatch(event.target.value
      ? { type: "ATTACH_LEADER", uid: entry.uid, target_uid: event.target.value }
      : { type: "DETACH_LEADER", uid: entry.uid }));
    box.append(select);
  }

  // Transport: nur Einheiten mit erkannter Kapazität.
  const transports = state.list.entries.filter((other) =>
    other.uid !== entry.uid && (card(other.datasheet_id)?.transport_capacity ?? 0) > 0);
  if (transports.length && (entryCard.transport_capacity ?? 0) === 0) {
    const select = document.createElement("select");
    select.title = "Einsteigen in";
    select.append(new Option("– kein Transport –", ""));
    for (const transport of transports) {
      const transportCard = card(transport.datasheet_id);
      const opt = new Option(
        `⇥ ${transportCard.name} (${transportCard.transport_capacity})`, transport.uid);
      opt.selected = entry.transported_in_uid === transport.uid;
      select.append(opt);
    }
    select.addEventListener("change", (event) => dispatch(event.target.value
      ? { type: "EMBARK", uid: entry.uid, transport_uid: event.target.value }
      : { type: "DISEMBARK", uid: entry.uid }));
    box.append(select);
  }

  // Enhancements: gefiltert auf Detachment und zulässigen Träger.
  const eligible = enhancementsFor(entryCard).filter((enhancement) =>
    !state.list.detachment_id
    || enhancement.detachment_id === state.list.detachment_id);
  if (eligible.length && entryCard.is_character && !entryCard.is_epic_hero) {
    const select = document.createElement("select");
    select.title = "Enhancement";
    select.append(new Option("– kein Enhancement –", ""));
    for (const enhancement of eligible) {
      const opt = new Option(
        `${enhancement.name} (+${enhancement.cost})`, enhancement.id);
      opt.selected = entry.enhancement_id === enhancement.id;
      select.append(opt);
    }
    select.addEventListener("change", (event) => dispatch({
      type: "SET_ENHANCEMENT", uid: entry.uid,
      enhancement_id: event.target.value,
    }));
    box.append(select);
  }

  if (entryCard.is_character && !entry.is_warlord) {
    const button = document.createElement("button");
    button.textContent = "Warlord";
    button.addEventListener("click", () =>
      dispatch({ type: "SET_WARLORD", uid: entry.uid }));
    box.append(button);
  }

  const remove = document.createElement("button");
  remove.textContent = "Entfernen";
  remove.addEventListener("click", () =>
    dispatch({ type: "REMOVE_UNIT", uid: entry.uid }));
  box.append(remove);

  return box;
}

function renderFindings() {
  const container = $("findings");
  container.innerHTML = "";
  for (const finding of state.validation?.findings ?? []) {
    const row = document.createElement("div");
    row.className = `finding ${finding.severity}`;
    row.innerHTML =
      '<span class="dot"></span>' +
      `<span class="msg"><strong>${escapeHtml(finding.title)}</strong> — ` +
      `${escapeHtml(finding.message)}</span>` +
      `<span class="basis ${finding.basis}" title="${escapeHtml(finding.note)}">` +
      `${finding.basis === "DATA" ? "belegt" : "Annahme"}</span>`;
    container.append(row);
  }
}

// --------------------------------------------------------------- Inspektor
// PLAN.md §6.2 — zwölf Abschnitte in fester Reihenfolge.

function openInspector(datasheetId, entryUid = null) {
  const item = card(datasheetId);
  if (!item) return;

  state.inspected = datasheetId;
  $("inspector").hidden = false;
  document.querySelector("main").classList.add("with-inspector");
  syncBackdrop();

  $("insp-name").textContent = item.name;
  const cost = cheapestCost(item);
  $("insp-sub").textContent =
    [item.role || "Other", cost ? `ab ${cost} Pkt.` : null]
      .filter(Boolean).join(" · ");

  const body = $("insp-body");
  body.innerHTML = "";
  body.scrollTop = 0;

  const derived = item.rules_text_mode === "derived";

  body.append(...[
    sectionKeywords(item),
    sectionProfiles(item),
    sectionWeapons(item, derived),
    sectionAbilities(item, derived),
    sectionDamaged(item, derived),
    sectionAttachment(item),
    sectionTransport(item, derived),
    sectionEnhancements(item, derived),
    sectionStratagems(item, derived),
    sectionComposition(item, derived),
    sectionMeta(item),
  ].filter(Boolean));

  $("insp-foot").innerHTML = footer(item);
  renderCatalog();

  loadContext(datasheetId);
  // Als Sheet ist das Panel ein eigener Kontext: Der Fokus gehört hinein,
  // sonst tippt die Tastatur weiter in die verdeckte Liste.
  if (entryUid || sheetMode()) $("insp-close").focus();
}

function closeInspector() {
  // Angeheftet bleibt angeheftet — außer das Panel liegt als Sheet über der
  // Liste. Dann verdeckt es sie, und "lässt sich nicht schließen" hieße
  // "die Liste ist bis zum Neuladen weg".
  if (state.pinned && !sheetMode()) return;
  $("inspector").hidden = true;
  $("sheet-backdrop").hidden = true;
  document.querySelector("main").classList.remove("with-inspector");
  state.inspected = null;
  renderCatalog();
}

function section(title, inner, className = "sec") {
  const node = document.createElement("div");
  node.className = className;
  node.innerHTML = `<h3>${escapeHtml(title)}</h3>${inner}`;
  return node;
}

function sectionKeywords(item) {
  const faction = new Set(item.faction_keywords ?? []);
  const chips = (item.keywords ?? []).map((keyword) =>
    `<span class="chip ${faction.has(keyword) ? "faction" : ""}">` +
    `${escapeHtml(keyword)}</span>`).join("");
  return section("Keywords", `<div class="chips">${chips || "–"}</div>`);
}

function sectionProfiles(item) {
  if (!item.profiles?.length) return null;
  const rows = item.profiles.map((profile) => {
    const invulnerable = profile.inv_sv && profile.inv_sv !== "-"
      ? `${profile.inv_sv}+` : "–";
    return "<tr>" +
      `<td class="nm">${escapeHtml(profile.name)}</td>` +
      [profile.M, profile.T, profile.Sv, invulnerable,
       profile.W, profile.Ld, profile.OC]
        .map((value) => `<td>${escapeHtml(value || "–")}</td>`).join("") +
      "</tr>";
  }).join("");
  return section("Profil", `<div class="table-wrap"><table class="stats">
    <tr><th class="nm">Modell</th><th>M</th><th>T</th><th>SV</th>
        <th>INV</th><th>W</th><th>LD</th><th>OC</th></tr>${rows}
    </table></div>`);
}

function sectionWeapons(item, derived) {
  const blocks = [];
  for (const [key, label] of [["ranged", "Fernkampf"], ["melee", "Nahkampf"]]) {
    const weapons = item.weapons?.[key] ?? [];
    if (!weapons.length) continue;
    const rows = weapons.map((weapon) => {
      const keywords = (weapon.keywords ?? []).length
        ? `<div class="chips">${weapon.keywords.map((k) =>
            `<span class="chip tag">${escapeHtml(k)}</span>`).join("")}</div>`
        : "";
      return "<tr>" +
        `<td class="nm">${escapeHtml(weapon.name)}${keywords}</td>` +
        [weapon.range, weapon.A, weapon.BS_WS, weapon.S, weapon.AP, weapon.D]
          .map((value) => `<td>${escapeHtml(value || "–")}</td>`).join("") +
        "</tr>";
    }).join("");
    blocks.push(`<div class="table-wrap"><table class="stats">
      <tr><th class="nm">${label}</th><th>RW</th><th>A</th>
          <th>${key === "melee" ? "WS" : "BS"}</th><th>S</th><th>AP</th><th>D</th></tr>
      ${rows}</table></div>`);
  }
  if (!blocks.length) return null;
  const hint = derived
    ? '<p class="derived-hint">Waffenregeln als Keywords; Fließtext nur auf ' +
      "Wahapedia (abgeleiteter Modus).</p>" : "";
  return section("Waffen", blocks.join("") + hint);
}

function sectionAbilities(item, derived) {
  if (!item.abilities?.length) return null;
  const parts = item.abilities.map((ability) => {
    const tags = (ability.tags ?? []).map((tag) =>
      `<span class="chip tag">${escapeHtml(tag)}</span>`).join("");
    let body;
    if (ability.description) {
      body = `<div class="body">${ability.description}</div>`;
    } else if (tags) {
      body = `<div class="chips">${tags}</div>`;
    } else {
      body = '<div class="derived-hint">Volltext nur auf Wahapedia.</div>';
    }
    return `<div class="ability">
      <div class="kind">${escapeHtml(ability.type || "")}</div>
      <div class="nm">${escapeHtml(ability.name || "")}</div>
      ${body}${ability.description && tags ? `<div class="chips">${tags}</div>` : ""}
    </div>`;
  }).join("");
  return section("Fähigkeiten", parts);
}

function sectionDamaged(item) {
  if (!item.damaged) return null;
  const body = item.damaged.description
    || '<span class="derived-hint">Nur auf Wahapedia.</span>';
  return section(`Beschädigt (${escapeHtml(item.damaged.threshold || "")})`,
    `<div class="ability"><div class="body">${body}</div></div>`);
}

function sectionAttachment(item) {
  const inList = new Set(state.list.entries.map((e) => e.datasheet_id));
  const rows = (targets, label) => {
    if (!targets?.length) return "";
    const links = targets.map((target) =>
      `<div class="link-row">
         <button data-open="${escapeHtml(target.id)}">${escapeHtml(target.name)}</button>
         ${inList.has(target.id) ? '<span class="in-list">in der Liste</span>' : ""}
       </div>`).join("");
    return `<p class="muted" style="margin:6px 0 2px">${label}</p>${links}`;
  };

  const content = rows(item.can_lead, "Kann sich anschließen an:")
    + rows(item.led_by, "Kann geführt werden von:");
  if (!content) return null;

  const node = section("Anschluss", content);
  for (const button of node.querySelectorAll("[data-open]")) {
    button.addEventListener("click", () => openInspector(button.dataset.open));
  }
  return node;
}

function sectionTransport(item) {
  if (!item.transport) return null;
  const text = item.transport.text
    || `Kapazität: ${item.transport.capacity} Modelle (abgeleiteter Modus).`;
  return section("Transport", `<div class="ability"><div class="body">${text}</div></div>`);
}

function sectionEnhancements(item, derived) {
  const list = enhancementsFor(item);
  if (!list.length) return null;
  const active = state.list.detachment_id;
  const shown = active
    ? list.filter((enhancement) => enhancement.detachment_id === active)
    : list;
  if (!shown.length) {
    return section("Enhancements",
      '<p class="empty-note">Keine im gewählten Detachment.</p>');
  }
  const parts = shown.map((enhancement) => `
    <div class="ability">
      <div class="nm">${escapeHtml(enhancement.name)}
        <span class="muted">+${enhancement.cost} Pkt.</span></div>
      <div class="kind">${escapeHtml(enhancement.detachment || "")}</div>
      ${enhancement.description
        ? `<div class="body">${enhancement.description}</div>`
        : '<div class="derived-hint">Volltext nur auf Wahapedia.</div>'}
    </div>`).join("");
  const note = active ? "" :
    '<p class="empty-note">Kein Detachment gewählt — alle Varianten sichtbar.</p>';
  return section("Enhancements", note + parts);
}

function sectionStratagems(item) {
  const list = stratagemsFor(item);
  if (!list.length) return null;
  const active = state.list.detachment_id;
  const shown = active
    ? list.filter((strat) => strat.detachment_id === active) : list;
  if (!shown.length) {
    return section("Stratagems",
      '<p class="empty-note">Keine im gewählten Detachment.</p>');
  }
  const parts = shown.map((strat) => `
    <div class="strat">
      <div class="hd">
        <span class="cp">${escapeHtml(strat.cp_cost || "?")} CP</span>
        <strong>${escapeHtml(strat.name)}</strong>
      </div>
      <div class="when">${escapeHtml(
        [strat.turn, strat.phase, strat.type].filter(Boolean).join(" · "))}</div>
      ${strat.description
        ? `<div class="body">${strat.description}</div>`
        : '<div class="derived-hint">Volltext nur auf Wahapedia.</div>'}
    </div>`).join("");
  return section(`Stratagems (${shown.length})`, parts);
}

function sectionComposition(item) {
  const composition = item.composition ?? [];
  const options = item.options ?? [];
  if (!composition.length && !options.length) return null;
  const parts = [
    ...composition.map((line) => `<div class="body">${line}</div>`),
    ...options.map((option) => `
      <div class="ability">
        <div class="kind">${escapeHtml(option.button || "Option")}</div>
        <div class="body">${option.description
          || '<span class="derived-hint">Nur auf Wahapedia.</span>'}</div>
      </div>`),
  ].join("");
  return section("Truppstärke & Optionen", parts);
}

/**
 * Abschnitt 11 — bewusst unten und optisch abgesetzt.
 * Regeln sind Fakten, Statistik ist Meinung mit Fehlerbalken (PLAN.md §6.2).
 */
function sectionMeta() {
  return section("Meta & Synergie",
    '<div id="insp-meta"><p class="note">wird geladen …</p></div>', "sec meta");
}

/**
 * Abschnitt 11 — die beiden Signalfamilien aus §4 getrennt.
 *
 * Die regelbasierte Hälfte (§4.1) steht in den Regeldaten und ist da; die
 * empirische (§4.2) braucht Turnierlisten und fehlt. Sie zusammenzurühren
 * wäre bequemer und genau der Fehler, vor dem der Plan warnt: Danach lässt
 * sich nicht mehr sagen, *warum* etwas empfohlen wurde.
 */
async function loadContext(datasheetId) {
  try {
    const context = await backend.unitContext(datasheetId);
    const target = $("insp-meta");
    if (!target || state.inspected !== datasheetId) return;

    target.innerHTML = "";
    target.append(renderSynergies(context.rules_based ?? {}));

    const empirisch = context.empirical ?? {};
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = empirisch.available
      ? JSON.stringify(empirisch)
      : `Meta-Zahlen: noch keine Daten — ${empirisch.reason ?? ""}`;
    target.append(note);
  } catch {
    /* Das Panel wartet nie auf diesen Abschnitt (§6.4). */
  }
}

function renderSynergies(daten) {
  const box = document.createElement("div");
  const synergien = daten.synergies ?? [];
  if (!synergien.length) {
    box.innerHTML = '<p class="empty-note">Keine regelbasierte Synergie gefunden.</p>';
    return box;
  }

  // Partner, die schon in der Liste stehen, zuerst — das ist die Auskunft,
  // die beim Bauen tatsächlich weiterhilft.
  const inList = new Set(state.list.entries.map((entry) => entry.datasheet_id));
  const gruppen = new Map();
  for (const eintrag of synergien) {
    if (!gruppen.has(eintrag.title)) gruppen.set(eintrag.title, []);
    gruppen.get(eintrag.title).push(eintrag);
  }

  for (const [titel, eintraege] of gruppen) {
    eintraege.sort((a, b) =>
      Number(inList.has(b.partner_id)) - Number(inList.has(a.partner_id)));

    const kopf = document.createElement("p");
    kopf.className = "muted";
    kopf.style.margin = "8px 0 2px";
    const gesamt = daten.counts?.[eintraege[0].kind] ?? eintraege.length;
    kopf.innerHTML =
      `${escapeHtml(titel)} ` +
      `<span class="basis ${eintraege[0].basis}" title="${escapeHtml(eintraege[0].note)}">` +
      `${eintraege[0].basis === "DATA" ? "belegt" : "abgeleitet"}</span>` +
      (gesamt > eintraege.length
        ? ` <span class="muted">(${eintraege.length} von ${gesamt})</span>` : "");
    box.append(kopf);

    for (const eintrag of eintraege) {
      const row = document.createElement("div");
      row.className = "link-row";
      row.innerHTML =
        `<button data-open="${escapeHtml(eintrag.partner_id)}">` +
        `${escapeHtml(eintrag.partner_name)}</button>` +
        (inList.has(eintrag.partner_id)
          ? '<span class="in-list">in der Liste</span>' : "");
      const why = document.createElement("div");
      why.className = "syn-why";
      why.textContent = eintrag.explanation;
      const wrap = document.createElement("div");
      wrap.append(row, why);
      box.append(wrap);
    }
  }

  for (const button of box.querySelectorAll("[data-open]")) {
    button.addEventListener("click", () => openInspector(button.dataset.open));
  }
  return box;
}

function footer(item) {
  const source = item.source;
  const parts = [];
  if (source) {
    parts.push(escapeHtml([source.name, source.version].filter(Boolean).join(" · ")));
    if (source.errata_date) parts.push(`Errata ${escapeHtml(source.errata_date)}`);
  }
  if (item.link) {
    parts.push(`<a href="${escapeHtml(item.link)}" target="_blank" ` +
      'rel="noopener">auf Wahapedia öffnen ↗</a>');
  }
  return parts.join(" · ") || "Quelle unbekannt";
}

// ------------------------------------------------------------------ Export
//
// Der Export lief früher über `alert()` und schrieb still in die
// Zwischenablage. Beides trägt auf dem Telefon nicht:
//
// * `navigator.clipboard` gibt es nur im *secure context*. Wer die App im
//   WLAN über `http://192.168.…` aufruft — der dokumentierte Weg aufs iPad —
//   hat die API schlicht nicht. Der alte Code fing das mit `?.` ab und
//   behauptete anschließend trotzdem, es sei kopiert worden.
// * Aus einem `alert()` lässt sich nichts markieren. Ohne Zwischenablage
//   war die Liste damit nicht aus der App herauszubekommen.
//
// Der Dialog zeigt den Text deshalb in einem Feld, aus dem man ihn zur Not
// von Hand kopiert, bietet `navigator.share` an, wo es das gibt — und sagt,
// was tatsächlich passiert ist.

function wireExport() {
  const dialog = $("export-dialog");

  $("export-copy").addEventListener("click", async () => {
    const area = $("export-text");
    const status = $("export-status");
    area.focus();
    area.setSelectionRange(0, area.value.length);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(area.value);
        status.textContent = "In die Zwischenablage kopiert.";
        return;
      }
    } catch {
      /* Weiter mit execCommand — manche Browser verweigern erst beim Aufruf. */
    }

    const copied = document.execCommand?.("copy") ?? false;
    status.textContent = copied
      ? "In die Zwischenablage kopiert."
      : "Ohne HTTPS gibt der Browser die Zwischenablage nicht frei — "
        + "der Text ist markiert und lässt sich von Hand kopieren.";
  });

  $("export-share").addEventListener("click", async () => {
    try {
      await navigator.share({
        title: state.list.name,
        text: $("export-text").value,
      });
    } catch {
      /* Abbrechen im Teilen-Menü ist kein Fehler. */
    }
  });

  // Ein Tipp neben den Dialog schließt ihn — auf dem Telefon der erwartete
  // Weg zurück, weil der Dialog fast den ganzen Bildschirm einnimmt.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function exportList() {
  const text = exportText();
  const dialog = $("export-dialog");

  // `<dialog>` fehlt nur noch in sehr alten Browsern; dort bleibt der alte Weg.
  if (typeof dialog?.showModal !== "function") {
    navigator.clipboard?.writeText(text).catch(() => {});
    alert(text);
    return;
  }

  $("export-text").value = text;
  $("export-status").textContent = "";
  $("export-share").hidden = typeof navigator.share !== "function";
  dialog.showModal();
}

function exportText() {
  const lines = [
    state.list.name,
    `${state.validation?.points_used ?? 0}/${state.list.points_limit} Punkte`,
    "",
  ];
  for (const entry of state.list.entries) {
    const entryCard = card(entry.datasheet_id);
    const points = state.validation?.per_entry_points?.[entry.uid] ?? 0;
    const extras = [];
    if (entry.is_warlord) extras.push("Warlord");
    if (entry.enhancement_id) {
      const enhancement = state.enhancements.get(entry.enhancement_id);
      if (enhancement) extras.push(enhancement.name);
    }
    if (entry.attached_to_uid) {
      const target = state.list.entries.find((e) => e.uid === entry.attached_to_uid);
      extras.push(`an ${card(target?.datasheet_id)?.name}`);
    }
    if (entry.transported_in_uid) {
      const transport = state.list.entries
        .find((e) => e.uid === entry.transported_in_uid);
      extras.push(`in ${card(transport?.datasheet_id)?.name}`);
    }
    lines.push(`${entry.model_count}x ${entryCard?.name ?? entry.datasheet_id}` +
      ` (${points})${extras.length ? ` [${extras.join(", ")}]` : ""}`);
  }
  return lines.join("\n");
}

// --------------------------------------------------------------- Vorschlag
// PLAN.md §5.3 und §6.1: Der Generator schlägt vor, der Nutzer entscheidet.
// Der Vorschlag kommt als Patch — dieselben Aktionen, die auch jeder Klick
// im Builder erzeugt. Daraus folgt zweierlei ohne weiteres Zutun: Der Diff
// ist anzeigbar, bevor irgendetwas passiert, und "Übernehmen" landet als
// *ein* Schritt in der Historie, ist also mit Strg+Z zurückzunehmen.

/** Der zuletzt erzeugte, noch nicht übernommene Vorschlag. */
let pendingProposal = null;

function wireGenerator() {
  const dialog = $("gen-dialog");

  $("generate").addEventListener("click", () => {
    pendingProposal = null;
    $("gen-result").hidden = true;
    $("gen-apply").disabled = true;
    $("gen-points").textContent = "";
    $("gen-status").textContent = state.list.faction_id
      ? ""
      : "Erst eine Fraktion wählen — ohne sie gibt es nichts vorzuschlagen.";
    dialog.showModal();
  });

  $("gen-run").addEventListener("click", runGenerator);
  $("gen-apply").addEventListener("click", async () => {
    if (!pendingProposal?.patch?.length) return;
    dialog.close();
    await dispatch(...pendingProposal.patch);
    pendingProposal = null;
    // Auf dem Telefon liegt die Liste im anderen Reiter. Wer gerade 25
    // Einheiten übernommen hat, will sie sehen und nicht den Katalog.
    selectTab("army");
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function runGenerator() {
  const mode = document.querySelector('input[name="gen-mode"]:checked').value;
  const run = $("gen-run");
  run.disabled = true;
  $("gen-status").textContent = "Wird gerechnet …";

  try {
    const result = await backend.generate(state.list, mode);
    pendingProposal = result;
    renderProposal(result);
  } catch (error) {
    console.error(error);
    $("gen-status").textContent = `Vorschlag fehlgeschlagen — ${error.message}`;
    $("gen-result").hidden = true;
    $("gen-apply").disabled = true;
  } finally {
    run.disabled = false;
  }
}

function renderProposal(result) {
  // Nur Entfernungen zählen, die *bestehende* Einträge treffen. Die lokale
  // Suche tauscht ihre eigenen Griffe wieder aus (Entfernen + Hinzufügen);
  // die als „ersetzt" zu melden, wäre bei leerer Startliste schlicht falsch.
  const bestehende = new Set(state.list.entries.map((entry) => entry.uid));
  const removed = result.patch.filter(
    (action) => action.type === "REMOVE_UNIT" && bestehende.has(action.uid)).length;

  $("gen-status").textContent =
    `${result.list.entries.length} Einheiten im Vorschlag` +
    (removed ? ` · ${removed} bestehende werden ersetzt` : "") + ".";

  // Abdeckung: das, was der Generator maximiert hat.
  const coverage = $("gen-coverage");
  coverage.innerHTML = "";
  const titel = Object.fromEntries(
    (result.role_specs ?? []).map((spec) => [spec.key, spec.title]));
  for (const [key, value] of Object.entries(result.coverage ?? {})) {
    const row = document.createElement("div");
    row.className = "cov-row" + (value < 0.85 ? " thin" : "");
    row.innerHTML =
      `<span class="lbl">${escapeHtml(titel[key] ?? key)}</span>` +
      `<span class="bar"><span style="width:${Math.round(value * 100)}%"></span></span>` +
      `<span class="val">${Math.round(value * 100)} %</span>`;
    coverage.append(row);
  }

  // Der Diff, Zeile für Zeile mit Begründung (§5.5).
  const diff = $("gen-diff");
  diff.innerHTML = "";
  if (removed) {
    const row = document.createElement("div");
    row.className = "gen-line remove";
    row.innerHTML = `<span class="sign">−</span><span class="why">` +
      `${removed} bestehende ${removed === 1 ? "Einheit wird" : "Einheiten werden"} ` +
      "entfernt und neu aufgebaut.</span>";
    diff.append(row);
  }
  for (const pick of result.picks ?? []) {
    const row = document.createElement("div");
    row.className = "gen-line";
    row.innerHTML =
      '<span class="sign">+</span>' +
      `<span class="nm">${pick.model_count}× ${escapeHtml(pick.name)}</span>` +
      `<span class="why">${escapeHtml(pick.reason)}</span>` +
      `<span class="pts">${pick.cost ? `${pick.cost}` : "–"}</span>`;
    diff.append(row);
  }

  $("gen-gaps").textContent = (result.gaps ?? []).length
    ? `Bleibt offen: ${result.gaps.join(" · ")}`
    : "";

  // Was der Vorschlag *nicht* weiß, steht dabei — sonst ist er eine
  // Blackbox, der niemand trauen sollte (§5.5).
  $("gen-evidence").textContent = result.missing_evidence?.meta ?? "";

  const validation = result.validation ?? {};
  $("gen-points").textContent =
    `${validation.points_used} / ${validation.points_limit} Punkte · ` +
    (validation.legal ? "legal" : `${validation.errors} Regelbruch`);
  $("gen-result").hidden = false;
  $("gen-apply").disabled = !result.patch?.length;
}

// ------------------------------------------------------------ Live-Updates
// Der Server meldet einen neuen Regelstand über Server-Sent Events. Die
// Liste wird dabei *nicht* angefasst: Sie gehört dem Nutzer. Es werden nur
// die Karten neu geladen und neu validiert — Punkte ändern sich mit jedem
// MFM-Stand, eine Liste kann durch ein Update illegal werden.

function connectLiveUpdates() {
  backend.subscribe(showUpdateBanner);
}

function showUpdateBanner(info) {
  const banner = $("update-banner");
  const stand = info.last_update || "unbekannt";
  $("update-text").textContent =
    `Neuer Regelstand verfügbar (${stand}). Übernehmen lädt die Regeln neu ` +
    "und prüft deine Liste erneut — die Liste selbst bleibt erhalten.";
  banner.hidden = false;
  banner.dataset.version = info.data_version;
}

async function applyUpdate() {
  const banner = $("update-banner");
  banner.classList.add("busy");
  $("update-text").textContent = "Regeln werden neu geladen …";
  try {
    state.meta = await backend.meta();
    state.dataVersion = state.meta.data_version;
    if (state.list.faction_id) {
      await loadFactionCards(state.list.faction_id);
      await loadDetachments(state.list.faction_id);
      $("detachment").value = state.list.detachment_id;
    }
    await revalidate();
    render();
    banner.hidden = true;
  } catch (error) {
    $("update-text").textContent = `Aktualisieren fehlgeschlagen: ${error.message}`;
  } finally {
    banner.classList.remove("busy");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init().catch(bootFailed);
