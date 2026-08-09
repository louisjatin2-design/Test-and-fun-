/**
 * Reducer und Validator für den Browser — die Zwillinge von
 * `app/rules/builderlist.py` und `app/rules/validator.py`.
 *
 * **Warum es das doppelt gibt.** PLAN.md §6.5 lässt den Reducer bewusst auf
 * dem Server laufen, damit Builder und Generator die Liste nicht
 * unterschiedlich auslegen können. In der Offline-Datei (`build_offline.py`)
 * gibt es keinen Server: Sie soll auf einem Telefon ohne Python und ohne
 * Netz laufen. Ohne Engine im Browser gäbe es dort gar keine Validierung —
 * und ein Builder ohne Regelprüfung ist der Punkt, an dem das Projekt anfing.
 *
 * Die Doppelung ist damit nicht wegzudiskutieren, aber überprüfbar zu
 * machen: `tests/test_parity.py` treibt dieselben zufälligen Aktionsfolgen
 * durch beide Implementierungen und vergleicht Punkte, Befunde und
 * Meldungstexte Zeichen für Zeichen. Weicht eine ab, schlägt der Test fehl.
 *
 * Die Regelkonstanten stehen **nicht** hier: Sie kommen aus `ruleset`, das
 * der Build aus `app/rules/ruleset.py` erzeugt. Zahlen wie "höchstens 3
 * gleiche Datasheets" existieren also weiterhin nur an einer Stelle.
 *
 * Bewusst kein ES-Modul: Die Offline-Datei fügt diese Datei und `app.js` in
 * ein einziges <script> zusammen. Ein globales Namensobjekt ist dafür
 * robuster als Import-Zeilen, die ein Build wieder herausschneiden müsste.
 */
(function (global) {
  "use strict";

  const ACTIONS = new Set([
    "SET_FACTION", "SET_DETACHMENT", "SET_POINTS_LIMIT", "RENAME",
    "ADD_UNIT", "REMOVE_UNIT", "SET_MODEL_COUNT", "ATTACH_LEADER",
    "DETACH_LEADER", "SET_ENHANCEMENT", "CLEAR_ENHANCEMENT", "EMBARK",
    "DISEMBARK", "SET_WARLORD",
  ]);

  class ActionError extends Error {}

  function newUid() {
    return Math.random().toString(16).slice(2, 14).padStart(12, "0");
  }

  function normaliseEntry(raw) {
    return {
      uid: String(raw.uid || newUid()),
      datasheet_id: String(raw.datasheet_id ?? ""),
      model_count: Number(raw.model_count ?? 1) || 1,
      wargear: [...(raw.wargear ?? [])],
      enhancement_id: raw.enhancement_id || null,
      attached_to_uid: raw.attached_to_uid || null,
      transported_in_uid: raw.transported_in_uid || null,
      is_warlord: Boolean(raw.is_warlord),
    };
  }

  function normaliseList(raw, rulesetVersion) {
    return {
      faction_id: String(raw.faction_id ?? ""),
      detachment_id: String(raw.detachment_id ?? ""),
      points_limit: Number(raw.points_limit ?? 2000) || 2000,
      ruleset_version: String(raw.ruleset_version || rulesetVersion || ""),
      mfm_version: String(raw.mfm_version ?? ""),
      name: String(raw.name || "Neue Liste"),
      entries: (raw.entries ?? []).map(normaliseEntry),
    };
  }

  function findEntry(state, uid) {
    const entry = state.entries.find((e) => e.uid === uid);
    if (!entry) throw new ActionError(`Unbekannte Einheit: ${uid}`);
    return entry;
  }

  const withEntries = (state, entries) => ({ ...state, entries });

  function mapEntry(state, uid, fn) {
    findEntry(state, uid);
    return withEntries(state, state.entries.map((e) => (e.uid === uid ? fn(e) : e)));
  }

  // -------------------------------------------------------------- Reducer

  const HANDLERS = {
    SET_FACTION(state, action) {
      const factionId = String(action.faction_id ?? "");
      if (factionId === state.faction_id) return state;
      // Fraktionswechsel leert die Liste — alles andere hinterlässt
      // Einheiten, die nicht in die Armee gehören.
      return { ...state, faction_id: factionId, detachment_id: "", entries: [] };
    },

    SET_DETACHMENT(state, action) {
      const detachmentId = String(action.detachment_id ?? "");
      if (detachmentId === state.detachment_id) return state;
      // Enhancements gehören zum Detachment; beim Wechsel fallen sie weg,
      // damit die Liste nicht still illegal wird.
      return {
        ...state,
        detachment_id: detachmentId,
        entries: state.entries.map((e) => ({ ...e, enhancement_id: null })),
      };
    },

    SET_POINTS_LIMIT(state, action) {
      return { ...state, points_limit: Number(action.points_limit ?? 0) || 0 };
    },

    RENAME(state, action) {
      return { ...state, name: String(action.name || "Neue Liste") };
    },

    ADD_UNIT(state, action) {
      const datasheetId = String(action.datasheet_id ?? "");
      if (!datasheetId) throw new ActionError("ADD_UNIT ohne datasheet_id");
      return withEntries(state, [...state.entries, normaliseEntry({
        uid: action.uid || newUid(),
        datasheet_id: datasheetId,
        model_count: action.model_count ?? 1,
      })]);
    },

    REMOVE_UNIT(state, action) {
      const uid = String(action.uid ?? "");
      findEntry(state, uid);
      const remaining = [];
      for (let entry of state.entries) {
        if (entry.uid === uid) continue;
        // Verweise auflösen, sonst bleiben verwaiste Anschlüsse zurück.
        if (entry.attached_to_uid === uid) {
          entry = { ...entry, attached_to_uid: null };
        }
        if (entry.transported_in_uid === uid) {
          entry = { ...entry, transported_in_uid: null };
        }
        remaining.push(entry);
      }
      return withEntries(state, remaining);
    },

    SET_MODEL_COUNT(state, action) {
      const raw = action.model_count;
      // Kein `|| 1`: Das würde eine explizite 0 stillschweigend in 1 drehen,
      // statt sie als Fehler sichtbar zu machen.
      const count = raw === undefined || raw === null ? 1 : Number(raw);
      if (!(count >= 1)) {
        throw new ActionError("model_count muss mindestens 1 sein");
      }
      return mapEntry(state, String(action.uid ?? ""),
        (e) => ({ ...e, model_count: count }));
    },

    ATTACH_LEADER(state, action) {
      const uid = String(action.uid ?? "");
      const targetUid = String(action.target_uid ?? "");
      findEntry(state, uid);
      findEntry(state, targetUid);
      if (uid === targetUid) {
        throw new ActionError(
          "Eine Einheit kann sich nicht an sich selbst anschließen");
      }
      return mapEntry(state, uid, (e) => ({ ...e, attached_to_uid: targetUid }));
    },

    DETACH_LEADER(state, action) {
      return mapEntry(state, String(action.uid ?? ""),
        (e) => ({ ...e, attached_to_uid: null }));
    },

    SET_ENHANCEMENT(state, action) {
      const enhancementId = String(action.enhancement_id ?? "") || null;
      return mapEntry(state, String(action.uid ?? ""),
        (e) => ({ ...e, enhancement_id: enhancementId }));
    },

    CLEAR_ENHANCEMENT(state, action) {
      return mapEntry(state, String(action.uid ?? ""),
        (e) => ({ ...e, enhancement_id: null }));
    },

    EMBARK(state, action) {
      const uid = String(action.uid ?? "");
      const transportUid = String(action.transport_uid ?? "");
      findEntry(state, uid);
      findEntry(state, transportUid);
      if (uid === transportUid) {
        throw new ActionError("Eine Einheit kann nicht in sich selbst einsteigen");
      }
      return mapEntry(state, uid,
        (e) => ({ ...e, transported_in_uid: transportUid }));
    },

    DISEMBARK(state, action) {
      return mapEntry(state, String(action.uid ?? ""),
        (e) => ({ ...e, transported_in_uid: null }));
    },

    SET_WARLORD(state, action) {
      const uid = String(action.uid ?? "");
      findEntry(state, uid);
      return withEntries(state,
        state.entries.map((e) => ({ ...e, is_warlord: e.uid === uid })));
    },
  };

  function apply(state, action) {
    if (!ACTIONS.has(action && action.type)) {
      throw new ActionError(
        `Unbekannte Aktion: ${JSON.stringify(action && action.type)}`);
    }
    return HANDLERS[action.type](state, action);
  }

  const applyAll = (state, actions) => actions.reduce(apply, state);

  // ------------------------------------------------------------ Validator

  /**
   * Baut den Regelkontext aus den Offline-Daten.
   *
   * Leader-Paare stehen nicht separat: `card.can_lead` ist bereits die Menge
   * der zulässigen Ziele je Leader, aus `Datasheets_leader.csv` abgeleitet.
   */
  function buildContext({ cards, enhancements, ruleset }) {
    const byId = new Map();
    const leaderPairs = new Set();
    const allowed = new Map();

    for (const card of cards) {
      byId.set(card.id, card);
      for (const target of card.can_lead ?? []) {
        leaderPairs.add(`${card.id} ${target.id}`);
      }
      allowed.set(card.id, new Set(card.enhancement_ids ?? []));
    }

    return {
      cards: byId,
      leaderPairs,
      allowedEnhancements: allowed,
      enhancements: enhancements instanceof Map
        ? enhancements
        : new Map(Object.entries(enhancements ?? {})),
      ruleset,
      name(id) {
        const card = byId.get(id);
        return card ? card.name : id;
      },
      maxCopies(role) {
        return ruleset.battleline_roles.includes(role)
          ? ruleset.max_same_datasheet_battleline
          : ruleset.max_same_datasheet;
      },
      costFor(entry) {
        const card = byId.get(entry.datasheet_id);
        const options = (card && card.points) || [];
        if (!options.length) return 0;
        const exact = options.find((o) => o.models === entry.model_count);
        if (exact) return exact.cost;
        const below = options.filter((o) => o.models <= entry.model_count);
        if (!below.length) return options[0].cost;
        return below.reduce((a, b) => (a.models >= b.models ? a : b)).cost;
      },
    };
  }

  function finding(ctx, severity, rule, message, uid) {
    const spec = ctx.ruleset.specs[rule] || {};
    return {
      severity, rule,
      title: spec.title || rule,
      basis: spec.basis || "ASSUMPTION",
      note: spec.note || "",
      message,
      uid: uid === undefined ? null : uid,
    };
  }

  function counter(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }

  function validate(state, ctx) {
    const findings = [];
    const perEntry = {};
    let used = 0;

    for (const entry of state.entries) {
      let cost = ctx.costFor(entry);
      // Enhancements kosten extra und zählen aufs Limit.
      if (entry.enhancement_id && ctx.enhancements.has(entry.enhancement_id)) {
        cost += ctx.enhancements.get(entry.enhancement_id).cost || 0;
      }
      perEntry[entry.uid] = cost;
      used += cost;
    }

    checkPoints(state, ctx, findings, used);
    checkFaction(state, ctx, findings);
    checkRuleOfThree(state, ctx, findings);
    checkEpicHeroes(state, ctx, findings);
    checkEnhancements(state, ctx, findings);
    checkLeaders(state, ctx, findings);
    checkTransports(state, ctx, findings);
    checkWarlord(state, ctx, findings);
    checkUnknownPoints(state, ctx, findings, perEntry);

    const errors = findings.filter((f) => f.severity === "error").length;
    return {
      legal: errors === 0,
      points_used: used,
      points_limit: state.points_limit,
      points_free: state.points_limit - used,
      per_entry_points: perEntry,
      findings,
      errors,
      warnings: findings.length - errors,
    };
  }

  function checkPoints(state, ctx, findings, used) {
    if (used > state.points_limit) {
      findings.push(finding(ctx, "error", "points_limit",
        `${used - state.points_limit} Punkte über dem Limit ` +
        `(${used} von ${state.points_limit}).`));
    }
  }

  function checkFaction(state, ctx, findings) {
    if (!state.faction_id) return;
    for (const entry of state.entries) {
      const card = ctx.cards.get(entry.datasheet_id);
      if (!card) {
        findings.push(finding(ctx, "error", "faction_match",
          `Unbekanntes Datasheet: ${entry.datasheet_id}`, entry.uid));
      } else if (card.faction_id !== state.faction_id) {
        findings.push(finding(ctx, "error", "faction_match",
          `${card.name} gehört zu ${card.faction_id}, ` +
          `die Armee zu ${state.faction_id}.`, entry.uid));
      }
    }
  }

  function checkRuleOfThree(state, ctx, findings) {
    for (const [id, count] of counter(state.entries.map((e) => e.datasheet_id))) {
      const card = ctx.cards.get(id);
      if (!card) continue;
      const allowed = ctx.maxCopies(card.role);
      if (count > allowed) {
        findings.push(finding(ctx, "error", "rule_of_three",
          `${card.name}: ${count} Exemplare, erlaubt sind ${allowed} ` +
          `(Rolle: ${card.role || "Other"}).`));
      }
    }
  }

  function checkEpicHeroes(state, ctx, findings) {
    const heroes = state.entries
      .filter((e) => {
        const card = ctx.cards.get(e.datasheet_id);
        return card && card.is_epic_hero;
      })
      .map((e) => e.datasheet_id);
    for (const [id, count] of counter(heroes)) {
      if (count > 1) {
        findings.push(finding(ctx, "error", "epic_hero_unique",
          `${ctx.name(id)} ist ein Epic Hero und darf nur einmal vorkommen ` +
          `(${count} enthalten).`));
      }
    }
  }

  function checkEnhancements(state, ctx, findings) {
    const bearers = state.entries.filter((e) => e.enhancement_id);
    const max = ctx.ruleset.max_enhancements;

    if (bearers.length > max) {
      findings.push(finding(ctx, "error", "enhancement_count",
        `${bearers.length} Enhancements vergeben, erlaubt sind ${max}.`));
    }

    for (const [id, count] of counter(bearers.map((e) => e.enhancement_id))) {
      if (count > 1) {
        const enhancement = ctx.enhancements.get(id);
        const name = enhancement ? enhancement.name : id;
        findings.push(finding(ctx, "error", "enhancement_count",
          `Enhancement '${name}' ist ${count}-mal vergeben, ` +
          "erlaubt ist einmal."));
      }
    }

    for (const entry of bearers) {
      const enhancement = ctx.enhancements.get(entry.enhancement_id);
      const card = ctx.cards.get(entry.datasheet_id);
      if (!enhancement) {
        findings.push(finding(ctx, "error", "enhancement_allowed",
          `Unbekanntes Enhancement: ${entry.enhancement_id}`, entry.uid));
        continue;
      }
      if (!card) continue;

      const allowed = ctx.allowedEnhancements.get(entry.datasheet_id);
      if (!card.is_character || card.is_epic_hero) {
        findings.push(finding(ctx, "error", "enhancement_bearer",
          `${card.name} kann '${enhancement.name}' nicht tragen — ` +
          "Enhancements gehen nur an Charaktere ohne Epic Hero.", entry.uid));
      } else if (!allowed || !allowed.has(entry.enhancement_id)) {
        findings.push(finding(ctx, "error", "enhancement_allowed",
          `${card.name} steht nicht auf der Liste zulässiger Träger ` +
          `für '${enhancement.name}'.`, entry.uid));
      }

      if (state.detachment_id
        && enhancement.detachment_id !== state.detachment_id) {
        findings.push(finding(ctx, "error", "enhancement_detachment",
          `'${enhancement.name}' gehört zum Detachment ` +
          `'${enhancement.detachment}', gewählt ist ein anderes.`, entry.uid));
      }
    }
  }

  function checkLeaders(state, ctx, findings) {
    const byTarget = new Map();

    for (const entry of state.entries) {
      if (!entry.attached_to_uid) continue;
      const target = state.entries.find((e) => e.uid === entry.attached_to_uid);
      if (!target) {
        findings.push(finding(ctx, "error", "leader_attach",
          "Anschluss verweist auf eine Einheit, die nicht in der Liste steht.",
          entry.uid));
        continue;
      }
      if (!byTarget.has(target.uid)) byTarget.set(target.uid, []);
      byTarget.get(target.uid).push(entry);

      if (!ctx.leaderPairs.has(`${entry.datasheet_id} ${target.datasheet_id}`)) {
        findings.push(finding(ctx, "error", "leader_attach",
          `${ctx.name(entry.datasheet_id)} kann sich nicht an ` +
          `${ctx.name(target.datasheet_id)} anschließen.`, entry.uid));
      }
    }

    for (const [targetUid, leaders] of byTarget) {
      if (leaders.length > ctx.ruleset.max_leaders_per_unit) {
        const names = leaders.map((l) => ctx.name(l.datasheet_id)).join(", ");
        findings.push(finding(ctx, "warning", "one_leader_per_unit",
          `${leaders.length} Leader an derselben Einheit (${names}). ` +
          "Einzelne Datasheets erlauben das ausdrücklich — bitte am " +
          "Datasheet prüfen.", targetUid));
      }
    }
  }

  function checkTransports(state, ctx, findings) {
    const load = new Map();
    for (const entry of state.entries) {
      if (!entry.transported_in_uid) continue;
      const transport = state.entries.find(
        (e) => e.uid === entry.transported_in_uid);
      if (!transport) {
        findings.push(finding(ctx, "error", "transport_capacity",
          "Einheit sitzt in einem Transport, der nicht in der Liste steht.",
          entry.uid));
        continue;
      }
      // Ein angeschlossener Leader fährt mit der Einheit mit.
      load.set(transport.uid, (load.get(transport.uid) || 0) + entry.model_count);
    }

    for (const [transportUid, inside] of load) {
      const transport = state.entries.find((e) => e.uid === transportUid);
      const card = ctx.cards.get(transport.datasheet_id);
      const capacity = card ? card.transport_capacity : 0;
      if (capacity === 0) {
        findings.push(finding(ctx, "error", "transport_capacity",
          `${ctx.name(transport.datasheet_id)} hat keine erkennbare ` +
          "Transportkapazität.", transportUid));
      } else if (inside > capacity) {
        findings.push(finding(ctx, "error", "transport_capacity",
          `${ctx.name(transport.datasheet_id)}: ${inside} Modelle an Bord, ` +
          `Kapazität ${capacity}.`, transportUid));
      }
    }
  }

  function checkWarlord(state, ctx, findings) {
    if (!state.entries.length) return;
    const warlords = state.entries.filter((e) => e.is_warlord);
    if (!warlords.length) {
      findings.push(finding(ctx, "warning", "warlord", "Kein Warlord benannt."));
    } else if (warlords.length > 1) {
      findings.push(finding(ctx, "error", "warlord",
        `${warlords.length} Warlords benannt, erlaubt ist einer.`));
    } else {
      const card = ctx.cards.get(warlords[0].datasheet_id);
      if (card && !card.is_character) {
        findings.push(finding(ctx, "error", "warlord",
          `${card.name} ist kein Charakter und kann nicht Warlord sein.`,
          warlords[0].uid));
      }
    }
  }

  function checkUnknownPoints(state, ctx, findings, perEntry) {
    for (const entry of state.entries) {
      if ((perEntry[entry.uid] || 0) === 0 && ctx.cards.has(entry.datasheet_id)) {
        findings.push(finding(ctx, "warning", "points_limit",
          `Für ${ctx.name(entry.datasheet_id)} liefert der Export keine ` +
          "Punktkosten — die Summe ist zu niedrig.", entry.uid));
      }
    }
  }

  global.WHRules = {
    ActionError, normaliseList, apply, applyAll, buildContext, validate,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
