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
};

const $ = (id) => document.getElementById(id);

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
    const result = await api("/api/lists/validate/incremental", {
      method: "POST",
      body: JSON.stringify({ list: state.list, patch: actions }),
    });
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
  state.validation = await api("/api/lists/validate", {
    method: "POST",
    body: JSON.stringify({ list: state.list }),
  });
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
  const data = await api(`/api/factions/${encodeURIComponent(factionId)}/cards`);
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

async function init() {
  state.meta = await api("/api/meta");

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
    return;
  }

  const limits = $("points-limit");
  for (const limit of state.meta.points_limits) {
    limits.append(new Option(`${limit} Pkt.`, limit));
  }

  const factions = await api("/api/factions");
  for (const faction of factions) {
    $("faction").append(new Option(faction.name, faction.id));
  }

  const saved = restore();
  state.list = saved ?? {
    faction_id: "", detachment_id: "",
    points_limit: state.meta.points_limits.at(-1) ?? 2000,
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

  await revalidate();
  wireEvents();
  render();
}

async function loadDetachments(factionId) {
  const select = $("detachment");
  select.innerHTML = '<option value="">– wählen –</option>';
  if (!factionId) return;
  const detachments = await api(
    `/api/factions/${encodeURIComponent(factionId)}/detachments`);
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

  $("insp-close").addEventListener("click", closeInspector);
  $("insp-pin").addEventListener("click", () => {
    state.pinned = !state.pinned;
    $("insp-pin").setAttribute("aria-pressed", String(state.pinned));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("inspector").hidden) closeInspector();
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key === "z") { event.preventDefault(); undo(); }
    if (ctrl && (event.key === "y" || (event.key === "z" && event.shiftKey))) {
      event.preventDefault(); redo();
    }
  });
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
  $("undo").disabled = !state.history.length;
  $("redo").disabled = !state.future.length;
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
      row.addEventListener("mouseenter", () =>
        renderBudget((state.validation?.points_used ?? 0) + cheapestCost(item)));
      row.addEventListener("mouseleave", () => renderBudget());

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
  if (entryUid) $("insp-close").focus();
}

function closeInspector() {
  if (state.pinned) return;
  $("inspector").hidden = true;
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
    '<p class="note" id="insp-meta">wird geladen …</p>', "sec meta");
}

async function loadContext(datasheetId) {
  try {
    const context = await api(
      `/api/datasheets/${encodeURIComponent(datasheetId)}/context`);
    const target = $("insp-meta");
    if (!target || state.inspected !== datasheetId) return;
    target.textContent = context.available
      ? JSON.stringify(context)
      : `Noch keine Daten — ${context.reason}`;
  } catch {
    /* Das Panel wartet nie auf diesen Abschnitt (§6.4). */
  }
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

function exportList() {
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
  const text = lines.join("\n");
  navigator.clipboard?.writeText(text).catch(() => {});
  alert(`${text}\n\n(in die Zwischenablage kopiert)`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML =
    `<pre style="padding:20px;color:#e0555a">Start fehlgeschlagen:\n${error.message}</pre>`;
});
