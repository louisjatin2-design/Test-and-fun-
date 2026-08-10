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

  // ==================================================== Rollenprofil (§5.2)
  // Zwilling von `app/rules/roleprofile.py`. Die Zielprofile und der
  // Referenzangriff stehen nicht hier, sondern kommen über `cfg` aus
  // `roleprofile.as_dict()` — die Rechnung gibt es zweimal, die Zahlen
  // einmal.

  const DICE = /^(\d*)d(\d+)$/i;
  const ANTI = /anti-([a-z ]+?)\s*(\d)\+/g;
  const SUSTAINED = /sustained hits\s*(\d+)/;

  function expectedDice(expression) {
    if (typeof expression === "number") return expression;
    const text = String(expression ?? "").trim().toLowerCase().replace(/\s+/g, "");
    if (!text || text === "-" || text === "n/a") return 0;

    let total = 0;
    let sign = 1;
    for (const part of text.split(/([+-])/)) {
      if (part === "+") { sign = 1; continue; }
      if (part === "-") { sign = -1; continue; }
      if (!part) continue;
      const match = DICE.exec(part);
      if (match) {
        const count = Number(match[1] || 1);
        total += sign * count * (Number(match[2]) + 1) / 2;
      } else if (/^\d+$/.test(part)) {
        total += sign * Number(part);
      } else {
        return 0;
      }
    }
    return Math.max(0, total);
  }

  /** Die 1 misslingt immer, die 6 gelingt immer — daher die Deckelung. */
  function rollChance(needed) {
    return Math.min(5 / 6, Math.max(0, (7 - needed) / 6));
  }

  function hitChance(skill) {
    const text = String(skill ?? "").trim().replace(/\+$/, "");
    if (!text || text === "-" || text.toLowerCase() === "n/a") return 1;
    return /^\d+$/.test(text) ? rollChance(Number(text)) : 0;
  }

  function woundChance(strength, toughness) {
    if (strength <= 0 || toughness <= 0) return 0;
    let needed;
    if (strength >= 2 * toughness) needed = 2;
    else if (strength > toughness) needed = 3;
    else if (strength === toughness) needed = 4;
    else if (2 * strength <= toughness) needed = 6;
    else needed = 5;
    return rollChance(needed);
  }

  function saveFailChance(save, invulnerable, armourPenetration) {
    const modified = save - armourPenetration;
    const best = invulnerable ? Math.min(modified, invulnerable) : modified;
    return 1 - rollChance(best);
  }

  function weaponRules(weapon) {
    const text = [
      String(weapon.description ?? ""),
      (weapon.keywords ?? []).join(" "),
    ].join(" ").toLowerCase();

    const sustained = SUSTAINED.exec(text);
    const anti = [];
    ANTI.lastIndex = 0;
    let hit;
    while ((hit = ANTI.exec(text)) !== null) anti.push([hit[1].trim(), Number(hit[2])]);

    return {
      torrent: text.includes("torrent"),
      twinLinked: text.includes("twin-linked"),
      sustained: sustained ? Number(sustained[1]) : 0,
      lethal: text.includes("lethal hits"),
      devastating: text.includes("devastating wounds"),
      blast: text.includes("blast"),
      anti,
    };
  }

  function armourPenetration(value) {
    const digits = String(value ?? "").replace(/[^0-9]/g, "");
    return digits ? -Number(digits) : 0;
  }

  function weaponDamage(weapon, target) {
    let attacks = expectedDice(weapon.A);
    const strength = expectedDice(weapon.S);
    const damage = expectedDice(weapon.D);
    if (attacks <= 0 || strength <= 0 || damage <= 0) return 0;

    const rules = weaponRules(weapon);
    if (rules.blast) attacks += Math.floor(target.models / 5);

    const pHit = rules.torrent ? 1 : hitChance(weapon.BS_WS);
    const hits = attacks * pHit + attacks * (1 / 6) * rules.sustained;
    const critHits = rules.torrent ? 0 : attacks * (1 / 6);

    let pWound = woundChance(strength, target.toughness);
    if (rules.twinLinked) pWound = pWound + (1 - pWound) * pWound;

    let critWoundChance = 1 / 6;
    for (const [keyword, needed] of rules.anti) {
      const passt = target.keywords.some(
        (k) => keyword.startsWith(k) || k.startsWith(keyword));
      if (passt) {
        pWound = Math.max(pWound, rollChance(needed));
        critWoundChance = Math.max(critWoundChance, rollChance(needed));
      }
    }

    const wounds = rules.lethal
      ? critHits + (hits - critHits) * pWound
      : hits * pWound;

    const pFail = saveFailChance(
      target.save, target.invulnerable, armourPenetration(weapon.AP));

    let durch;
    if (rules.devastating) {
      const mortal = wounds * critWoundChance;
      durch = mortal + (wounds - mortal) * pFail;
    } else {
      durch = wounds * pFail;
    }
    return durch * Math.min(damage, target.wounds);
  }

  function toInt(value, fallback) {
    const digits = String(value ?? "").replace(/[^0-9]/g, "");
    return digits ? Number(digits) : fallback;
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  const EMPTY_VECTOR = {
    anti_tank: 0, anti_elite: 0, anti_horde: 0, durability: 0, control: 0, reach: 0,
  };

  function addVectors(a, b) {
    return {
      anti_tank: a.anti_tank + b.anti_tank,
      anti_elite: a.anti_elite + b.anti_elite,
      anti_horde: a.anti_horde + b.anti_horde,
      durability: a.durability + b.durability,
      control: a.control + b.control,
      reach: Math.max(a.reach, b.reach),
    };
  }

  function subVectors(total, part) {
    return {
      anti_tank: Math.max(0, total.anti_tank - part.anti_tank),
      anti_elite: Math.max(0, total.anti_elite - part.anti_elite),
      anti_horde: Math.max(0, total.anti_horde - part.anti_horde),
      durability: Math.max(0, total.durability - part.durability),
      control: Math.max(0, total.control - part.control),
      reach: total.reach,
    };
  }

  function unitVector(card, modelCount, roles) {
    const weapons = card.weapons || {};
    const ranged = weapons.ranged || [];
    const melee = weapons.melee || [];
    const models = Math.max(1, Number(modelCount) || 1);

    const values = {};
    for (const key of roles.coverage_keys) values[key] = 0;
    for (const [key, target] of Object.entries(roles.targets)) {
      const proModell = mean(ranged.map((w) => weaponDamage(w, target)))
        + mean(melee.map((w) => weaponDamage(w, target)));
      values[key] = proModell * models;
    }

    const profile = (card.profiles || [{}])[0] || {};
    const toughness = toInt(profile.T, 4);
    const save = toInt(profile.Sv, 7);
    const invulnerable = toInt(profile.inv_sv, 0) || null;
    const wounds = toInt(profile.W, 1);

    const durchlass = woundChance(roles.reference_attack.strength, toughness)
      * saveFailChance(save, invulnerable, roles.reference_attack.armour_penetration);

    return {
      anti_tank: values.anti_tank || 0,
      anti_elite: values.anti_elite || 0,
      anti_horde: values.anti_horde || 0,
      durability: durchlass > 0 ? (models * wounds) / durchlass : 0,
      control: models * toInt(profile.OC, 0),
      reach: ranged.reduce((max, w) => Math.max(max, toInt(w.range, 0)), 0),
    };
  }

  // ====================================================== Generator (§5)
  // Zwilling von `app/rules/generator.py`. Damit beide Seiten dieselbe
  // Liste liefern, muss auch die *Reihenfolge* gleich sein: Kandidaten
  // werden nach (datasheet_id, model_count) sortiert, Enhancements nach
  // (Kosten absteigend, id). Ohne das entscheidet bei gleichem Grenznutzen
  // die Aufzählungsreihenfolge — und die ist hier eine andere als in der
  // Datenbank.

  /** Wie Pythons statistics.median: bei gerader Anzahl das Mittel der Mitte. */
  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function loadCandidates(ctx, factionId, cfg) {
    const candidates = [];
    for (const card of ctx.cards.values()) {
      if (card.faction_id !== factionId) continue;
      for (const option of card.points || []) {
        const cost = Number(option.cost) || 0;
        if (cost <= 0) continue;
        const modelCount = Number(option.models) || 1;
        candidates.push({
          datasheet_id: card.id,
          name: card.name,
          role: card.role || "Other",
          model_count: modelCount,
          cost,
          vector: unitVector(card, modelCount, cfg.roles),
        });
      }
    }
    candidates.sort((a, b) => (a.datasheet_id < b.datasheet_id ? -1
      : a.datasheet_id > b.datasheet_id ? 1
        : a.model_count - b.model_count));
    return candidates;
  }

  function coverageTargets(candidates, pointsLimit, cfg) {
    const targets = {};
    for (const key of cfg.roles.coverage_keys) {
      const mittel = median(candidates.map((c) => c.vector[key] / c.cost));
      targets[key] = Math.max(1e-6, mittel * pointsLimit * cfg.shares[key]);
    }
    return targets;
  }

  function vectorOf(state, byKey) {
    let total = EMPTY_VECTOR;
    for (const entry of state.entries) {
      const candidate = byKey.get(`${entry.datasheet_id} ${entry.model_count}`);
      if (candidate) total = addVectors(total, candidate.vector);
    }
    return total;
  }

  function coverageOf(vector, targets, cfg) {
    const out = {};
    for (const key of cfg.roles.coverage_keys) {
      out[key] = Math.min(1, vector[key] / targets[key]);
    }
    return out;
  }

  function scoreOf(vector, pointsUsed, pointsLimit, targets, cfg) {
    let total = 0;
    for (const key of cfg.roles.coverage_keys) {
      const anteil = vector[key] / targets[key];
      total += cfg.weights[key]
        * (Math.min(1, anteil) + cfg.overshoot_credit * Math.max(0, anteil - 1));
    }
    const budget = pointsLimit ? Math.min(1, pointsUsed / pointsLimit) : 0;
    return total + cfg.spend_weight * budget;
  }

  function hasLeader(state, uid) {
    return state.entries.some((entry) => entry.attached_to_uid === uid);
  }

  function leaderBonus(candidate, state, ctx, cfg) {
    for (const entry of state.entries) {
      if (entry.attached_to_uid) continue;
      if (ctx.leaderPairs.has(`${candidate.datasheet_id} ${entry.datasheet_id}`)
          && !hasLeader(state, entry.uid)) {
        return cfg.leader_bonus;
      }
      if (ctx.leaderPairs.has(`${entry.datasheet_id} ${candidate.datasheet_id}`)) {
        return cfg.leader_bonus;
      }
    }
    return 0;
  }

  function pinUid(action, before, after) {
    const bekannt = new Set(before.entries.map((e) => e.uid));
    const neu = after.entries.find((e) => !bekannt.has(e.uid));
    if (neu) action.uid = neu.uid;
  }

  function biggestGain(before, after) {
    let key = null;
    let best = 0;
    for (const name of Object.keys(after)) {
      const zuwachs = after[name] - (before[name] ?? 0);
      if (zuwachs > best) { best = zuwachs; key = name; }
    }
    return best > 0.001 ? key : null;
  }

  function percent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function reasonFor(candidate, luecke, before, after, cfg) {
    if (!luecke) {
      return `Füllt ${candidate.cost} Punkte, ohne eine Rolle zu verschlechtern.`;
    }
    const titel = (cfg.roles.specs[luecke] || {}).title || luecke;
    return `Schließt die größte Lücke: ${titel} `
      + `${percent(before[luecke] ?? 0)} → ${percent(after[luecke])}.`;
  }

  function fill(ctx, state, candidates, byKey, targets, patch, picks, reserve, cfg) {
    const limit = state.points_limit;
    const leaderIds = new Set(
      [...ctx.leaderPairs].map((pair) => pair.split(" ")[0]));

    for (;;) {
      const aktuell = validate(state, ctx);
      const frei = limit - reserve - aktuell.points_used;
      if (frei <= 0) return state;

      const vector = vectorOf(state, byKey);
      const basis = scoreOf(vector, aktuell.points_used, limit, targets, cfg);
      const vorher = coverageOf(vector, targets, cfg);

      const bereits = new Map();
      let charaktere = 0;
      for (const entry of state.entries) {
        bereits.set(entry.datasheet_id, (bereits.get(entry.datasheet_id) || 0) + 1);
        const karte = ctx.cards.get(entry.datasheet_id);
        if (karte && karte.is_character) charaktere += 1;
      }
      const charakterPlatz = Math.max(
        1, Math.trunc(cfg.max_character_share * state.entries.length));

      const rangliste = [];
      for (const candidate of candidates) {
        if (candidate.cost > frei) continue;
        const karte = ctx.cards.get(candidate.datasheet_id);
        if (karte && karte.is_character && charaktere >= charakterPlatz) continue;

        const neu = scoreOf(addVectors(vector, candidate.vector),
          aktuell.points_used + candidate.cost, limit, targets, cfg);
        let gewinn = neu - basis;
        const bonus = leaderBonus(candidate, state, ctx, cfg);
        gewinn += bonus;
        if (!bonus && karte && karte.is_character
            && leaderIds.has(candidate.datasheet_id)) {
          gewinn -= cfg.lone_character_penalty * gewinn;
        }
        gewinn -= cfg.duplicate_penalty * gewinn
          * (bereits.get(candidate.datasheet_id) || 0);
        if (gewinn <= 0) continue;
        rangliste.push([gewinn / candidate.cost, candidate]);
      }

      if (!rangliste.length) return state;
      rangliste.sort((a, b) => b[0] - a[0]);

      let genommen = false;
      for (const [, candidate] of rangliste.slice(0, cfg.validate_top_k)) {
        const action = {
          type: "ADD_UNIT",
          datasheet_id: candidate.datasheet_id,
          model_count: candidate.model_count,
        };
        const versuch = applyAll(state, [action]);
        if (!validate(versuch, ctx).legal) continue;
        pinUid(action, state, versuch);

        const nachher = coverageOf(addVectors(vector, candidate.vector), targets, cfg);
        const luecke = biggestGain(vorher, nachher);
        picks.push({
          datasheet_id: candidate.datasheet_id,
          name: candidate.name,
          cost: candidate.cost,
          model_count: candidate.model_count,
          reason: reasonFor(candidate, luecke, vorher, nachher, cfg),
          closes: luecke,
          coverage_before: luecke ? (vorher[luecke] ?? 0) : 0,
          coverage_after: luecke ? nachher[luecke] : 0,
        });
        patch.push(action);
        state = versuch;
        genommen = true;
        break;
      }
      if (!genommen) return state;
    }
  }

  function attachLeaders(ctx, state, patch, picks) {
    for (const entry of [...state.entries]) {
      const karte = ctx.cards.get(entry.datasheet_id);
      if (!karte || !karte.is_character || entry.attached_to_uid) continue;
      for (const ziel of state.entries) {
        if (ziel.uid === entry.uid || ziel.attached_to_uid) continue;
        if (hasLeader(state, ziel.uid)) continue;
        if (!ctx.leaderPairs.has(`${entry.datasheet_id} ${ziel.datasheet_id}`)) continue;
        const action = {
          type: "ATTACH_LEADER", uid: entry.uid, target_uid: ziel.uid,
        };
        const versuch = applyAll(state, [action]);
        if (!validate(versuch, ctx).legal) continue;
        patch.push(action);
        picks.push({
          datasheet_id: entry.datasheet_id, name: karte.name, cost: 0,
          model_count: entry.model_count,
          reason: `Schließt sich ${ctx.name(ziel.datasheet_id)} an — `
            + "Datasheets_leader gibt das Paar her.",
          closes: "anschluss", coverage_before: 0, coverage_after: 0,
        });
        state = versuch;
        break;
      }
    }
    return state;
  }

  function setWarlord(ctx, state, patch, picks) {
    if (state.entries.some((entry) => entry.is_warlord)) return state;
    const charaktere = state.entries.filter((entry) => {
      const karte = ctx.cards.get(entry.datasheet_id);
      return karte && karte.is_character;
    });
    if (!charaktere.length) return state;

    let gewaehlt = charaktere[0];
    for (const entry of charaktere) {
      if (ctx.costFor(entry) > ctx.costFor(gewaehlt)) gewaehlt = entry;
    }
    const action = { type: "SET_WARLORD", uid: gewaehlt.uid };
    const versuch = applyAll(state, [action]);
    if (!validate(versuch, ctx).legal) return state;
    patch.push(action);
    picks.push({
      datasheet_id: gewaehlt.datasheet_id, name: ctx.name(gewaehlt.datasheet_id),
      cost: 0, model_count: gewaehlt.model_count,
      reason: "Warlord — jede Armee braucht einen; gewählt ist der teuerste Charakter.",
      closes: "warlord", coverage_before: 0, coverage_after: 0,
    });
    return versuch;
  }

  function addEnhancements(ctx, state, patch, picks) {
    if (!state.detachment_id) return state;
    for (const entry of [...state.entries]) {
      const belegt = state.entries.filter((e) => e.enhancement_id).length;
      if (belegt >= ctx.ruleset.max_enhancements) break;
      const karte = ctx.cards.get(entry.datasheet_id);
      if (!karte || !karte.is_character || karte.is_epic_hero) continue;
      if (entry.enhancement_id) continue;

      const erlaubt = [...(ctx.allowedEnhancements.get(entry.datasheet_id) || [])].sort();
      const moeglich = erlaubt
        .map((id) => ctx.enhancements.get(id))
        .filter((enh) => enh && enh.detachment_id === state.detachment_id)
        .sort((a, b) => (b.cost - a.cost) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (const enh of moeglich) {
        const action = {
          type: "SET_ENHANCEMENT", uid: entry.uid, enhancement_id: enh.id,
        };
        const versuch = applyAll(state, [action]);
        if (!validate(versuch, ctx).legal) continue;
        patch.push(action);
        picks.push({
          datasheet_id: entry.datasheet_id, name: karte.name, cost: enh.cost,
          model_count: entry.model_count,
          reason: `Enhancement ${enh.name} (${enh.cost} Pkt.) — `
            + "legal an diesem Charakter in diesem Detachment.",
          closes: "enhancement", coverage_before: 0, coverage_after: 0,
        });
        state = versuch;
        break;
      }
    }
    return state;
  }

  function localSearch(ctx, state, candidates, byKey, targets, patch, picks, cfg) {
    for (let runde = 0; runde < cfg.local_search_rounds; runde += 1) {
      const aktuell = validate(state, ctx);
      const vector = vectorOf(state, byKey);
      const basis = scoreOf(vector, aktuell.points_used, state.points_limit, targets, cfg);
      let verbessert = false;

      const nachKosten = [...state.entries].sort(
        (a, b) => ctx.costFor(a) - ctx.costFor(b));

      for (const entry of nachKosten) {
        if (entry.attached_to_uid || entry.transported_in_uid) continue;
        if (state.entries.some((e) => e.attached_to_uid === entry.uid
          || e.transported_in_uid === entry.uid)) continue;

        const raus = byKey.get(`${entry.datasheet_id} ${entry.model_count}`);
        if (!raus) continue;
        const ohne = applyAll(state, [{ type: "REMOVE_UNIT", uid: entry.uid }]);
        const frei = state.points_limit - (aktuell.points_used - raus.cost);
        const rest = subVectors(vector, raus.vector);

        for (const candidate of candidates) {
          if (candidate.cost > frei) continue;
          if (candidate.datasheet_id === entry.datasheet_id) continue;
          const neu = scoreOf(addVectors(rest, candidate.vector),
            aktuell.points_used - raus.cost + candidate.cost,
            state.points_limit, targets, cfg);
          if (neu <= basis + 1e-6) continue;
          const action = {
            type: "ADD_UNIT",
            datasheet_id: candidate.datasheet_id,
            model_count: candidate.model_count,
          };
          const versuch = applyAll(ohne, [action]);
          if (!validate(versuch, ctx).legal) continue;
          pinUid(action, ohne, versuch);
          patch.push({ type: "REMOVE_UNIT", uid: entry.uid }, action);
          picks.push({
            datasheet_id: candidate.datasheet_id, name: candidate.name,
            cost: candidate.cost, model_count: candidate.model_count,
            reason: `Tausch für ${ctx.name(entry.datasheet_id)}: bessere `
              + "Rollenabdeckung im selben Budget.",
            closes: "tausch", coverage_before: 0, coverage_after: 0,
          });
          state = versuch;
          verbessert = true;
          break;
        }
        if (verbessert) break;
      }
      if (!verbessert) break;
    }
    return state;
  }

  function gapsOf(coverage, ergebnis, state, cfg) {
    const luecken = Object.entries(coverage)
      .sort((a, b) => a[1] - b[1])
      .filter(([, wert]) => wert < 0.85)
      .map(([key, wert]) =>
        `${(cfg.roles.specs[key] || {}).title || key}: ${percent(wert)} der Zielabdeckung`);
    const frei = state.points_limit - ergebnis.points_used;
    if (frei > 0) luecken.push(`${frei} Punkte nicht ausgegeben.`);
    return luecken;
  }

  /**
   * Listenvorschlag — der Zwilling von `generator.generate`.
   *
   * `cfg` kommt aus `generator.as_dict()`; `keepExisting` unterscheidet
   * Assistent (§5.3 v1) von Vollautomatik (v2).
   */
  function generate(list, ctx, cfg, keepExisting = true) {
    let state = normaliseList(list, ctx.ruleset.ruleset_version);

    const vorbereitung = keepExisting ? []
      : state.entries.map((entry) => ({ type: "REMOVE_UNIT", uid: entry.uid }));
    if (!keepExisting) state = { ...state, entries: [] };

    const leer = {
      list: state,
      validation: validate(state, ctx),
      patch: vorbereitung,
      picks: [],
      coverage: {},
      targets: {},
      missing_evidence: {
        meta: (cfg.specs.no_meta_prior || {}).note || "",
        roles: cfg.roles.missing_roles,
        weapon_rules_ignored: cfg.roles.ignored_weapon_rules,
      },
      role_specs: Object.entries(cfg.roles.specs).map(([key, spec]) => ({
        key, title: spec.title, basis: spec.basis, note: spec.note,
      })),
    };

    if (!state.faction_id) {
      return { ...leer, gaps: ["Ohne Fraktion gibt es nichts vorzuschlagen."] };
    }

    const candidates = loadCandidates(ctx, state.faction_id, cfg);
    if (!candidates.length) {
      return { ...leer,
        gaps: [`Keine Einheiten mit Punktekosten für ${state.faction_id}.`] };
    }

    const byKey = new Map(
      candidates.map((c) => [`${c.datasheet_id} ${c.model_count}`, c]));
    const targets = coverageTargets(candidates, state.points_limit, cfg);

    const patch = [...vorbereitung];
    const picks = [];

    const reserve = state.detachment_id
      && [...ctx.enhancements.values()].some(
        (enh) => enh.detachment_id === state.detachment_id)
      ? cfg.enhancement_reserve : 0;

    state = fill(ctx, state, candidates, byKey, targets, patch, picks, reserve, cfg);
    state = attachLeaders(ctx, state, patch, picks);
    state = setWarlord(ctx, state, patch, picks);
    state = addEnhancements(ctx, state, patch, picks);
    state = fill(ctx, state, candidates, byKey, targets, patch, picks, 0, cfg);
    state = localSearch(ctx, state, candidates, byKey, targets, patch, picks, cfg);

    const ergebnis = validate(state, ctx);
    const coverage = coverageOf(vectorOf(state, byKey), targets, cfg);

    return {
      ...leer,
      list: state,
      validation: ergebnis,
      patch,
      picks,
      coverage,
      targets,
      gaps: gapsOf(coverage, ergebnis, state, cfg),
    };
  }

  global.WHRules = {
    ActionError, normaliseList, apply, applyAll, buildContext, validate,
    unitVector, weaponDamage, expectedDice, hitChance, woundChance,
    saveFailChance, weaponRules, generate,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
