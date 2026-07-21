/* Pathfinder 1e rules engine — pure functions over PFDATA + character objects. */
'use strict';

const PF = (() => {

  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_NAMES = {
    str: 'Strength', dex: 'Dexterity', con: 'Constitution',
    int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
  };

  // Casting ability + spell list type for every casting class
  const CASTERS = {
    'Wizard':      { ability: 'int', kind: 'prepared',  list: 'Wizard' },
    'Sorcerer':    { ability: 'cha', kind: 'spontaneous', list: 'Sorcerer' },
    'Cleric':      { ability: 'wis', kind: 'prepared',  list: 'Cleric' },
    'Druid':       { ability: 'wis', kind: 'prepared',  list: 'Druid' },
    'Bard':        { ability: 'cha', kind: 'spontaneous', list: 'Bard' },
    'Paladin':     { ability: 'cha', kind: 'prepared',  list: 'Paladin' },
    'Ranger':      { ability: 'wis', kind: 'prepared',  list: 'Ranger' },
    'Alchemist':   { ability: 'int', kind: 'prepared',  list: 'Alchemist' },
    'Inquisitor':  { ability: 'wis', kind: 'spontaneous', list: 'Inquisitor' },
    'Oracle':      { ability: 'cha', kind: 'spontaneous', list: 'Cleric' },
    'Summoner':    { ability: 'cha', kind: 'spontaneous', list: 'Summoner' },
    'Witch':       { ability: 'int', kind: 'prepared',  list: 'Witch' },
    'Magus':       { ability: 'int', kind: 'prepared',  list: 'Magus' },
    'Arcanist':    { ability: 'int', kind: 'prepared',  list: 'Wizard' },
    'Bloodrager':  { ability: 'cha', kind: 'spontaneous', list: 'Bloodrager' },
    'Hunter':      { ability: 'wis', kind: 'spontaneous', list: 'Druid' },
    'Investigator':{ ability: 'int', kind: 'prepared',  list: 'Alchemist' },
    'Shaman':      { ability: 'wis', kind: 'prepared',  list: 'Shaman' },
    'Skald':       { ability: 'cha', kind: 'spontaneous', list: 'Bard' },
    'Warpriest':   { ability: 'wis', kind: 'prepared',  list: 'Cleric' },
    'Ninja':       { ability: 'cha', kind: 'spontaneous', list: 'Ninja' },
    'Adept':       { ability: 'wis', kind: 'prepared',  list: 'Adept' },
  };

  const SIZE_MOD = { Fine: 8, Diminutive: 4, Tiny: 2, Small: 1, Medium: 0, Large: -1, Huge: -2, Gargantuan: -4, Colossal: -8 };
  const SIZE_SPECIAL = { Fine: -8, Diminutive: -4, Tiny: -2, Small: -1, Medium: 0, Large: 1, Huge: 2, Gargantuan: 4, Colossal: 8 };

  // Carrying capacity (light/medium/heavy max) for Str 0-29; x4 per +10 above 29
  const LIGHT_LOAD = [0, 3, 6, 10, 13, 16, 20, 23, 26, 30, 33, 38, 43, 50, 58, 66, 76, 86, 100, 116, 133, 153, 173, 200, 233, 266, 306, 346, 400, 466];
  const MEDIUM_LOAD = [0, 6, 13, 20, 26, 33, 40, 46, 53, 60, 66, 76, 86, 100, 116, 133, 153, 173, 200, 233, 266, 306, 346, 400, 466, 533, 613, 693, 800, 933];
  const HEAVY_LOAD = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 115, 130, 150, 175, 200, 230, 260, 300, 350, 400, 460, 520, 600, 700, 800, 920, 1040, 1200, 1400];

  const POINT_BUY_COST = { 7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17 };

  // Cumulative XP thresholds to *reach* each character level, per the three
  // Core Rulebook advancement tracks. Index 0 = level 1 = 0 XP; index 19 = level 20.
  const XP_TRACKS = {
    slow:   [0, 3000, 7500, 14000, 23000, 35000, 53000, 77000, 115000, 160000,
             235000, 330000, 475000, 665000, 955000, 1350000, 1900000, 2700000, 3850000, 5350000],
    medium: [0, 2000, 5000, 9000, 15000, 23000, 35000, 51000, 75000, 105000,
             155000, 220000, 315000, 445000, 635000, 890000, 1300000, 1800000, 2550000, 3600000],
    fast:   [0, 1300, 3300, 6000, 10000, 15000, 23000, 34000, 50000, 71000,
             105000, 145000, 210000, 295000, 425000, 600000, 850000, 1200000, 1700000, 2400000],
  };
  const XP_MAX_LEVEL = 20;

  // ---------- lookups ----------
  const byName = (arr, name) => arr.find(x => x.name === name);
  const getClass = n => byName(PFDATA.classes, n);
  const getClassAbility = n => byName(PFDATA.classAbilities || [], n);
  const getMythicPath = n => byName(PFDATA.mythicPaths || [], n);
  const getMythicAbility = n => byName(PFDATA.mythicAbilities || [], n);
  // the mythic version of a base spell (matched on the base spell name)
  const getMythicSpell = base => (PFDATA.mythicSpells || []).find(s => s.base.toLowerCase() === String(base || '').toLowerCase());
  const getRace = n => byName(PFDATA.races, n);
  const getFeat = n => byName(PFDATA.feats, n);
  const getSpell = n => byName(PFDATA.spells, n);
  const getWeapon = n => byName(PFDATA.weapons, n);
  const getArmor = n => byName(PFDATA.armors, n);
  const getItem = n => byName(PFDATA.items, n);

  const mod = score => Math.floor((score - 10) / 2);

  // ---------- character template ----------
  function newCharacter(name) {
    return {
      id: 'pc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'New Character',
      player: '', alignment: 'N', deity: '', homeland: '', gender: '', age: '',
      height: '', weight: '', hair: '', eyes: '', xp: 0, xpTrack: 'medium',
      abilityMethod: 'pointbuy', pointBuyBudget: 20,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      abilityMisc: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      levelIncreases: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      race: '', flexChoice: 'str', altTraits: [],
      levels: [],            // [{cls, archetypes:[], hp, fcb}]
      favoredClass: '',
      skills: {},            // name -> ranks
      skillMisc: {},         // name -> misc bonus
      classSkillExtra: [],   // skills marked as class skills (traits, homebrew)
      feats: [],             // [{name, note}]
      traits: [],            // [names]
      classAbilities: [],    // [{name, cls}] chosen rage powers / bloodlines / hexes / etc.
      languages: '',
      spells: [],            // [{name, cls, lvl, prepared}]
      gear: [],              // [{name, kind, qty, equipped, cost, weight, note}]
      companions: [],        // see newCompanion()
      money: { pp: 0, gp: 150, sp: 0, cp: 0 },
      combat: { naturalArmor: 0, deflection: 0, dodge: 0, miscAC: 0, miscArmor: 0, miscInit: 0,
                miscFort: 0, miscRef: 0, miscWill: 0, miscAttack: 0, miscDamage: 0,
                miscCMB: 0, miscCMD: 0, hpMisc: 0, speedMisc: 0,
                carryStrBonus: 0, carryMult: 1, srNotes: '', resistNotes: '' },
      play: { hpDamage: 0, hpTemp: 0, nonlethal: 0, slotsUsed: {}, spellsCast: {}, buffs: [], counters: [], rolls: [] },
      mythic: { tier: 0, path: '', abilities: [] },   // mythic tier 0 = non-mythic
      skillMiscAll: 0,
      hpMode: 'avg',         // 'avg' | 'roll' | 'max'
      notes: '', backstory: '',
      created: Date.now(), updated: Date.now(),
    };
  }

  // ---------- abilities ----------
  function racialMods(c) {
    const out = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    const r = getRace(c.race);
    if (!r) return out;
    for (const k of ABILITIES) out[k] += (r.mods && r.mods[k]) || 0;
    if (r.flex && c.flexChoice) out[c.flexChoice] += r.flex;
    return out;
  }

  function abilityScore(c, ab) {
    return (c.abilities[ab] || 10) + racialMods(c)[ab] +
      (c.levelIncreases[ab] || 0) + (c.abilityMisc[ab] || 0);
  }
  const abilityMod = (c, ab) => mod(abilityScore(c, ab));

  function pointBuyCost(c) {
    let total = 0;
    for (const ab of ABILITIES) {
      const v = c.abilities[ab];
      total += POINT_BUY_COST[v] !== undefined ? POINT_BUY_COST[v] : (v > 18 ? 17 + (v - 18) * 4 : -4);
    }
    return total;
  }

  // ---------- experience ----------
  function xpTable(track) { return XP_TRACKS[track] || XP_TRACKS.medium; }

  // cumulative XP required to *reach* a character level (1-20) on a track
  function xpForLevel(level, track) {
    const t = xpTable(track);
    const lv = Math.max(1, Math.min(XP_MAX_LEVEL, Math.floor(Number(level) || 1)));
    return t[lv - 1];
  }

  // highest level whose threshold the given XP total has reached (1-20)
  function levelForXp(xp, track) {
    const t = xpTable(track);
    const x = Math.max(0, num(xp));
    let lvl = 1;
    for (let i = 1; i < t.length; i++) { if (x >= t[i]) lvl = i + 1; else break; }
    return lvl;
  }

  // progress toward the next character level for a character sheet.
  //   current       — XP total (clamped >= 0)
  //   level         — current build level (c.levels.length, min 1)
  //   nextThreshold — XP needed for level+1 (null at level 20)
  //   toNext        — XP still needed to reach level+1
  //   pctToNext     — 0-100 progress across the current level's XP band
  //   canLevel      — XP already meets/exceeds the next level's threshold
  //   xpLevel       — level implied by the XP total (for consistency checks)
  function xpProgress(c) {
    const track = (c && c.xpTrack) || 'medium';
    const xp = Math.max(0, num(c && c.xp));
    const level = Math.max(1, (c && c.levels ? c.levels.length : 0) || 1);
    const xpLevel = levelForXp(xp, track);
    if (level >= XP_MAX_LEVEL) {
      return { track, current: xp, level: XP_MAX_LEVEL, prevThreshold: xpForLevel(XP_MAX_LEVEL, track),
        nextThreshold: null, toNext: 0, pctToNext: 100, canLevel: false, xpLevel };
    }
    const prevThreshold = xpForLevel(level, track);
    const nextThreshold = xpForLevel(level + 1, track);
    const span = nextThreshold - prevThreshold;
    const into = xp - prevThreshold;
    const pctToNext = span > 0 ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 0;
    return { track, current: xp, level, prevThreshold, nextThreshold,
      toNext: Math.max(0, nextThreshold - xp), pctToNext, canLevel: xp >= nextThreshold, xpLevel };
  }

  // ---------- classes / levels ----------
  function classLevels(c) {
    const m = new Map();
    for (const l of c.levels) m.set(l.cls, (m.get(l.cls) || 0) + 1);
    return m;
  }

  function progRow(clsName, lvl) {
    const cls = getClass(clsName);
    if (!cls || !cls.prog) return null;
    return cls.prog.find(p => p.level === lvl) || null;
  }

  function babValue(babStr) {
    const m = /^\+?(-?\d+)/.exec(babStr || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  // ---------- class features & archetypes ----------
  const getArchetype = (name, clsName) => (PFDATA.archetypes || []).find(a =>
    a.name.toLowerCase() === String(name || '').trim().toLowerCase() &&
    (!clsName || a.class.toLowerCase() === clsName.toLowerCase()));

  const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
    fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };

  // Normalize a feature name so the class "Special" column and an archetype's
  // "replaces X" clause can be matched: lowercase, drop parentheticals, bonus
  // numbers, ordinals and filler words.
  function normFeat(s) {
    return stripTags(s).toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\bsee text\b/g, ' ')
      .replace(/[+-]?\d+(?:st|nd|rd|th)?/g, ' ')
      .replace(/\b(the|a|an|her|his|their|its|class|feature|features|ability|abilities|gained|at|level|levels)\b/g, ' ')
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  const featMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

  function levelFromText(txt) {
    let m = /\bat\s+(\d+)(?:st|nd|rd|th)?\s+level/i.exec(txt);
    if (m) return parseInt(m[1], 10);
    m = /\bat\s+([a-z]+)\s+level/i.exec(txt);
    if (m && ORDINALS[m[1].toLowerCase()]) return ORDINALS[m[1].toLowerCase()];
    return 1;
  }
  const featTargets = clause => clause.split(/,| and /i).map(normFeat).filter(Boolean);

  // Parse "replaces X"/"in place of X" clauses from plain text → {replaces, complex}.
  // Only a SINGLE clause is trusted (the standard "This … replaces X." pattern);
  // multiple clauses or an implausibly broad one (aggregate oaths/hexes, etc.)
  // mark the block "complex" so callers leave the base list intact. Shared by
  // archetypes and alternate racial traits.
  function replaceClauses(text) {
    const matches = text.match(/\b(?:replaces?|in place of)\s+[^.]+/gi) || [];
    let replaces = [], complex = false;
    if (matches.length === 1) replaces = featTargets(matches[0].replace(/^.*?(?:replaces?|in place of)\s+/i, ''));
    else if (matches.length > 1) complex = true;
    if (replaces.length > 4) { replaces = []; complex = true; }
    return { replaces, complex };
  }

  // Parse an archetype's HTML into its features and which base features each one
  // replaces or alters. Memoized on the archetype object.
  function parseArchetype(arch) {
    if (!arch || !arch.html) return { features: [] };
    if (arch.__feat) return arch.__feat;
    const features = [];
    const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi;
    let m;
    while ((m = re.exec(arch.html))) {
      const name = stripTags(m[1]);
      if (!name) continue;
      const descHtml = m[2];
      const text = stripTags(descHtml);
      // replaces: shared single-clause logic (see replaceClauses); alters is
      // archetype-specific and can also flag the block complex.
      const { replaces, complex: repComplex } = replaceClauses(text);
      const altMatches = text.match(/\b(?:alters?|modif(?:y|ies))\s+[^.]+/gi) || [];
      let alters = [], complex = repComplex;
      if (altMatches.length === 1) alters = featTargets(altMatches[0].replace(/^.*?(?:alters?|modif(?:y|ies))\s+/i, ''));
      else if (altMatches.length > 1) complex = true;
      // skip advisory "The following rage powers complement…" sections — these
      // list complementary options, they don't grant or change a feature.
      if (!replaces.length && !alters.length && !complex && /^the following\b/i.test(text)) continue;
      features.push({ name, level: levelFromText(text), replaces, alters, complex, html: '<h3>' + m[1] + '</h3>' + descHtml });
    }
    arch.__feat = { features };
    return arch.__feat;
  }

  function uniqArchetypeNames(c, clsName) {
    const set = new Set();
    for (const l of c.levels) if (l.cls === clsName && Array.isArray(l.archetypes)) {
      l.archetypes.forEach(a => { if (a) set.add(a); });
    }
    return [...set];
  }

  // Per-class merged feature list (base "Special" column with archetype
  // replacements/alterations applied), grouped by feature name. Returns
  // [{clsName, lvl, features:[{name, source, levels:[], html, alteredBy:[]}], unmatchedArch:[]}].
  function classFeatures(c) {
    const out = [];
    for (const [clsName, lvl] of classLevels(c)) {
      const cls = getClass(clsName);
      const base = [];
      if (cls && cls.prog) {
        for (const row of cls.prog) {
          if (row.level > lvl) break;
          if (!row.special) continue;
          for (const raw of row.special.split(',')) {
            const nm = raw.trim();
            if (nm) base.push({ name: nm, level: row.level, norm: normFeat(nm), source: 'class', replaced: false, alteredBy: [] });
          }
        }
      }
      const added = [], unmatchedArch = [];
      for (const an of uniqArchetypeNames(c, clsName)) {
        const arch = getArchetype(an, clsName) || getArchetype(an);
        if (!arch) { unmatchedArch.push(an); continue; }
        for (const f of parseArchetype(arch).features) {
          for (const tgt of f.replaces) for (const b of base) if (!b.replaced && featMatch(b.norm, tgt)) b.replaced = true;
          for (const tgt of f.alters) for (const b of base) if (featMatch(b.norm, tgt) && !b.alteredBy.includes(arch.name)) b.alteredBy.push(arch.name);
          if (f.level <= lvl) added.push({ name: f.name, level: f.level, source: arch.name, html: f.html, alteredBy: [], complex: !!f.complex });
        }
      }
      // group by source + name, collecting the levels each is gained at
      const grouped = new Map();
      for (const f of base.filter(b => !b.replaced).concat(added)) {
        const key = f.source + '|' + f.name.toLowerCase();
        let g = grouped.get(key);
        if (!g) { g = { name: f.name, source: f.source, levels: [], html: f.html || null, alteredBy: [], complex: false }; grouped.set(key, g); }
        g.levels.push(f.level);
        if (f.complex) g.complex = true;
        for (const ab of (f.alteredBy || [])) if (!g.alteredBy.includes(ab)) g.alteredBy.push(ab);
      }
      const features = [...grouped.values()]
        .sort((a, b) => Math.min(...a.levels) - Math.min(...b.levels) || (a.source === 'class' ? -1 : 1));
      out.push({ clsName, lvl, features, unmatchedArch });
    }
    return out;
  }

  // Pull the specific "<hN>Feature</hN> + description" block out of a class or
  // archetype's HTML, for per-feature hover popovers. Heading level varies
  // (classes use <h4> for features, archetypes <h3>), so match any level and
  // capture until the next heading of equal-or-higher rank. Returns null if not
  // found. Matching is specificity-ordered so "Rage power" picks "Rage Powers"
  // (heading contains target) over "Rage" (target contains heading).
  function extractFeatureBlock(html, featureName) {
    if (!html) return null;
    const target = normFeat(featureName);
    if (!target) return null;
    const heads = [];
    const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = re.exec(html))) heads.push({ level: +m[1], text: normFeat(m[2]), start: m.index });
    let idx = heads.findIndex(h => h.text === target);
    if (idx < 0) idx = heads.findIndex(h => h.text && h.text.includes(target));
    if (idx < 0) idx = heads.findIndex(h => h.text && target.includes(h.text));
    if (idx < 0) return null;
    const lvl = heads[idx].level;
    let end = html.length;
    for (let j = idx + 1; j < heads.length; j++) if (heads[j].level <= lvl) { end = heads[j].start; break; }
    return html.slice(heads[idx].start, end);
  }
  function classFeatureHTML(clsName, featureName) {
    const cls = getClass(clsName);
    return cls ? extractFeatureBlock(cls.html, featureName) : null;
  }
  function archetypeFeatureHTML(archName, featureName, clsName) {
    const arch = getArchetype(archName, clsName) || getArchetype(archName);
    if (!arch) return null;
    const t = normFeat(featureName);
    const feats = parseArchetype(arch).features;
    const f = feats.find(x => normFeat(x.name) === t) || feats.find(x => featMatch(normFeat(x.name), t));
    return f ? f.html : null;
  }

  // Limited-use resources worth a Play-tab tracker: the character's chosen class
  // abilities and class features whose text reads as a daily/rounds/pool resource
  // (Rage rounds, Bardic Performance, Ki pool, Channel Energy, Lay on Hands…).
  const LIMITED_RE = /per day|\/day|\bpool\b|\bki\b/i;
  const RES_SKIP = /^(orisons?|cantrips?|knacks?)$/;  // at-will 0-level spells, not limited
  function limitedResources(c) {
    const out = [], seen = new Set();
    const add = raw => {
      // collapse tiered names ("Smite evil 1/day" / "2/day") to one base resource
      const name = raw.replace(/\s*\d+\s*\/\s*(?:day|rage|rounds?|rd)\b.*$/i, '').trim() || raw;
      const k = name.toLowerCase();
      if (name && !RES_SKIP.test(normFeat(name)) && !seen.has(k)) { seen.add(k); out.push({ name }); }
    };
    // scan only the lead text of each entry — aggregate blocks (e.g. "Rage
    // Powers") embed long sub-lists whose "per day" phrases aren't the feature's
    // own resource.
    const lead = html => stripTags(html).slice(0, 360);
    for (const a of (c.classAbilities || [])) {
      const ab = getClassAbility(a.name);
      if (ab && ab.html && LIMITED_RE.test(lead(ab.html))) add(a.name);
    }
    for (const grp of classFeatures(c)) {
      for (const f of grp.features) {
        const html = f.source === 'class' ? classFeatureHTML(grp.clsName, f.name) : archetypeFeatureHTML(f.source, f.name);
        if (html && LIMITED_RE.test(lead(html))) add(f.name);
      }
    }
    return out;
  }

  // ---------- alternate racial traits ----------
  // Parallel to archetypes: an alternate racial trait replaces one or more of a
  // race's standard traits (declared in its HTML, "This racial trait replaces X").
  const getRacialTrait = (name, raceName) => (PFDATA.racialTraits || []).find(a =>
    a.name.toLowerCase() === String(name || '').trim().toLowerCase() &&
    (!raceName || a.race.toLowerCase() === raceName.toLowerCase()));

  function parseAltTrait(rt) {
    if (!rt || !rt.html) return { replaces: [], complex: false };
    if (rt.__rep) return rt.__rep;
    rt.__rep = replaceClauses(stripTags(rt.html));
    return rt.__rep;
  }

  // Merged racial traits: standard traits with the ones replaced by the
  // character's chosen alternates flagged, plus the alternates themselves.
  // Returns { race, standard:[{name, body, replaced}], alternates:[{name, complex}], unmatched:[] }.
  function racialTraits(c) {
    const race = getRace(c.race);
    if (!race) return null;
    const standard = (race.traits || []).map(t => ({ name: t.name, body: t.body, norm: normFeat(t.name), replaced: false }));
    const alternates = [], unmatched = [];
    for (const an of (c.altTraits || [])) {
      const rt = getRacialTrait(an, race.name) || getRacialTrait(an);
      if (!rt) { unmatched.push(an); continue; }
      const { replaces, complex } = parseAltTrait(rt);
      for (const tgt of replaces) for (const s of standard) if (!s.replaced && featMatch(s.norm, tgt)) s.replaced = true;
      alternates.push({ name: rt.name, complex });
    }
    return { race: race.name, standard, alternates, unmatched };
  }

  function totals(c) {
    let bab = 0, fort = 0, ref = 0, will = 0;
    for (const [cls, lvl] of classLevels(c)) {
      const row = progRow(cls, lvl);
      if (row) {
        bab += babValue(row.bab);
        fort += row.fort || 0;
        ref += row.ref || 0;
        will += row.will || 0;
      }
    }
    return { bab, fort, ref, will, level: c.levels.length };
  }

  function iterAttacks(bab) {
    const out = [];
    for (let b = bab; out.length === 0 || b > 0; b -= 5) { out.push(b); if (out.length >= 4) break; }
    return out;
  }

  // ---------- HP ----------
  function hitDie(clsName) {
    const cls = getClass(clsName);
    const m = /d(\d+)/.exec((cls && cls.hd) || 'd8');
    return m ? parseInt(m[1], 10) : 8;
  }

  function hpBreakdown(c) {
    const conM = abilityMod(c, 'con');
    let total = 0, detail = [];
    c.levels.forEach((l, i) => {
      const die = hitDie(l.cls);
      let roll;
      if (i === 0) roll = die;
      else if (c.hpMode === 'max') roll = die;
      else if (c.hpMode === 'roll') roll = l.hp || Math.floor(die / 2) + 1;
      else roll = Math.floor(die / 2) + 1;
      const fcb = l.fcb === 'hp' ? 1 : 0;
      total += roll + conM + fcb;
      detail.push({ level: i + 1, cls: l.cls, die, roll, con: conM, fcb });
    });
    total += c.combat.hpMisc || 0;
    if (hasFeat(c, 'Toughness')) total += Math.max(3, c.levels.length);
    return { total: Math.max(total, c.levels.length ? 1 : 0), detail, conM };
  }

  function hasFeat(c, name) {
    return c.feats.some(f => (f.name || f) === name);
  }

  // Feat allowance: base (one at 1st + every odd level) + class "Bonus feat"
  // features + a racial bonus feat (human). Single source of truth for the
  // Feats tab's counter and the generator's budget.
  function featAllowance(c) {
    const base = Math.max(0, Math.ceil(c.levels.length / 2));
    let classBonus = 0;
    for (const grp of classFeatures(c)) {
      for (const f of grp.features) if (/^bonus feat/i.test(f.name)) classBonus += f.levels.length;
    }
    const race = getRace(c.race);
    const racial = race && (race.traits || []).some(t => /bonus feat/i.test(t.name)) ? 1 : 0;
    return { base, classBonus, racial, total: base + classBonus + racial };
  }

  // ---------- skills ----------
  function classSkillSet(c) {
    const set = new Set();
    for (const [clsName] of classLevels(c)) {
      const cls = getClass(clsName);
      if (cls) for (const s of cls.classSkills) set.add(normalizeSkill(s));
    }
    return set;
  }

  function normalizeSkill(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function skillPointsBudget(c) {
    const intM = abilityMod(c, 'int');
    let total = 0;
    // +1 rank/level from "Skilled" (human etc.) — but not if an alternate racial
    // trait replaced it, so check the merged trait list rather than the raw race
    const rt = racialTraits(c);
    const human = !!(rt && rt.standard.some(t => !t.replaced && /Skilled/i.test(t.name) && /skill rank/i.test(t.body)));
    c.levels.forEach(l => {
      const cls = getClass(l.cls);
      const base = (cls && cls.ranks) || 2;
      total += Math.max(1, base + intM);
      if (l.fcb === 'skill') total += 1;
      if (human) total += 1;
    });
    return total;
  }

  function skillPointsSpent(c) {
    return Object.values(c.skills).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
  }

  // ---------- magic (enhanced) weapons & armor ----------
  // gear items may carry: enh (enhancement bonus 0-10), mw (masterwork flag),
  // special (free-text abilities), dmgBonus (extra damage dice e.g. "1d6 fire")
  function magicWeapon(g) {
    const enh = Math.max(0, Math.min(10, parseInt(g.enh, 10) || 0));
    const mw = enh > 0 || !!g.mw;
    return { enh, mw, atk: enh > 0 ? enh : (mw ? 1 : 0), dmg: enh,
             special: (g.special || '').trim(), dmgBonus: (g.dmgBonus || '').trim() };
  }
  function magicArmor(g) {
    const enh = Math.max(0, Math.min(10, parseInt(g.enh, 10) || 0));
    return { enh, mw: enh > 0 || !!g.mw, special: (g.special || '').trim() };
  }
  // shared so the sheet and Play tab always agree on Dex- vs Str-based attacks
  function isRangedWeapon(w) {
    if (!w) return false;
    if (w.prof === 'Firearm') return true;
    return /Ranged|Thrown|Ammunition/i.test((w.group || '') + (w.range || '')) && w.range && w.range !== '—';
  }

  // Weapon Finesse covers light weapons, unarmed strikes, and a few named
  // weapons (rapier, whip, elven curve blade)
  function isFinesseWeapon(w) {
    if (!w) return false;
    if (/light melee|unarmed/i.test(w.group || '')) return true;
    return /^(rapier|whip)\b/i.test(w.name || '') || /curve blade/i.test(w.name || '');
  }
  // ability behind a melee weapon's to-hit: Dex when the character has Weapon
  // Finesse, the weapon allows it, and Dex is the better modifier (damage stays Str)
  function meleeAttackAbility(c, w) {
    return (isFinesseWeapon(w) && hasFeat(c, 'Weapon Finesse') &&
            abilityMod(c, 'dex') > abilityMod(c, 'str')) ? 'dex' : 'str';
  }
  // dedicated thrown weapons (and slings) sit in the Ranged group but still add
  // Str to damage; blowguns and firearms don't
  const isThrownWeapon = w => !!w &&
    /\b(javelin|dart|chakram|shuriken|sling|bolas|net|throwing)\b/i.test(w.name || '') &&
    !/blowgun|gun\b|firearm/i.test((w.name || '') + ' ' + (w.group || ''));

  const isTwoHandedWeapon = w => !!w && /two-handed/i.test(w.group || '');

  // Str-to-damage multiplier: an explicit per-gear override (g.strMult: '1',
  // '1.5', '0.5', '0') wins; otherwise two-handed melee weapons get the ×1.5.
  // Per the rules the multiplier only applies to a Str BONUS — a penalty is
  // added in full (except ×0 = "no Str at all", an explicit user choice).
  function strDamageMult(w, g) {
    const o = parseFloat(g && g.strMult);
    if (!isNaN(o) && o >= 0) return o;
    return isTwoHandedWeapon(w) ? 1.5 : 1;
  }
  function strDamageBonus(strM, mult) {
    if (mult === 0) return 0;
    return strM >= 0 ? Math.floor(strM * mult) : strM;
  }

  // ammunition deals no damage of its own (it modifies a launcher) and is named like ammo —
  // so it shouldn't appear as an attack line; it's tracked as a quantity instead
  function isAmmo(w) {
    if (!w) return false;
    const noDmg = !w.dmgM || /^\s*(—|-|see text)?\s*$/i.test(w.dmgM);
    return noDmg && /\b(arrows?|bolts?|bullets?|pellets?|cartridges?|quarrels?|darts?|sling\s*stones?|shuriken)\b/i.test(w.name || '');
  }
  const gearIsAmmo = g => g.kind === 'weapon' && isAmmo(getWeapon(g.name));

  // "+1 Flaming Longsword" for display
  function gearDisplayName(g) {
    const enh = parseInt(g.enh, 10) || 0;
    const prefix = enh > 0 ? '+' + enh + ' ' : (g.mw ? 'MW ' : '');
    const spec = (g.special || '').trim();
    const specPart = spec ? spec + ' ' : '';
    return prefix + specPart + g.name;
  }

  // Shared weapon attack line — the Play tab, sheet view and PDF all render
  // from this so their to-hit/damage math can't drift. `c` is usually an
  // effective() character (buffed for Play, features-only for sheet/PDF).
  // -> { name, ranged, mods:[per-iterative to-hit], dice:'1d8+3'|null (rollable),
  //      dmgText:'1d8 +3 + 1d6 fire', crit, dtype, mw }
  function weaponAttack(c, g) {
    const w = getWeapon(g.name);
    const mw = magicWeapon(g);
    const race = getRace(c.race);
    const sizeM = SIZE_MOD[(race && race.size) || 'Medium'] || 0;
    const ranged = isRangedWeapon(w);
    const abM = ranged ? abilityMod(c, 'dex') : abilityMod(c, meleeAttackAbility(c, w));
    const perAttack = abM + sizeM + mw.atk + (c.combat.miscAttack || 0);
    const mods = iterAttacks(totals(c).bab).map(b => b + perAttack);
    const strDmg = ranged && !isThrownWeapon(w) ? 0
      : strDamageBonus(abilityMod(c, 'str'), strDamageMult(w, g));
    const dmgMod = strDmg + mw.dmg + (c.combat.miscDamage || 0);
    const dm = w && /\d*d\d+/.exec(w.dmgM || '');
    const dice = dm ? dm[0] + (dmgMod ? (dmgMod > 0 ? '+' : '') + dmgMod : '') : null;
    const dmgText = (w ? w.dmgM : '—') + (dmgMod ? ' ' + (dmgMod > 0 ? '+' + dmgMod : dmgMod) : '') +
      (mw.dmgBonus ? ' + ' + mw.dmgBonus : '');
    return { name: gearDisplayName(g), ranged, mods, dice, dmgText,
             crit: (w && w.crit) || '', dtype: (w && w.dtype) || '', mw };
  }

  function armorCheckPenalty(c) {
    let acp = 0;
    for (const g of c.gear) {
      if (!g.equipped) continue;
      const a = getArmor(g.name);
      if (a && a.acp) {
        const m = /(\d+)/.exec(a.acp);
        if (m) {
          let pen = parseInt(m[1], 10);
          if (pen > 0 && magicArmor(g).mw) pen -= 1;  // masterwork/enhanced reduces ACP by 1
          acp -= pen;
        }
      }
    }
    return acp;
  }

  function isClassSkill(c, skillName, ignoreOverrides) {
    if (!ignoreOverrides && (c.classSkillExtra || []).includes(skillName)) return true;
    const cs = classSkillSet(c);
    if (cs.has(skillName)) return true;
    const base = skillName.split(' (')[0];
    for (const e of cs) {
      if (e === base) return true;                                  // "Craft" covers "Craft (alchemy)"
      if (e.split(' (')[0] === base && /\(all\b/i.test(e)) return true; // "Knowledge (all skills)"
    }
    return false;
  }

  function skillBonus(c, skillName, ability) {
    const ranks = parseInt(c.skills[skillName], 10) || 0;
    const ab = ability || skillAbility(skillName);
    let total = ranks + abilityMod(c, ab) + (parseInt(c.skillMisc[skillName], 10) || 0) + (c.skillMiscAll || 0);
    if (isClassSkill(c, skillName) && ranks > 0) total += 3;
    const sk = PFDATA.skills.find(s => skillName.startsWith(s.name));
    if (sk && sk.acp) total += armorCheckPenalty(c);
    return total;
  }

  function skillAbility(skillName) {
    const sk = PFDATA.skills.find(s => skillName.startsWith(s.name));
    return (sk && sk.ability) || 'int';
  }

  // ---------- AC / combat ----------
  // returns [{ a: armor data, g: gear instance }] for equipped armor/shields
  function equippedArmor(c) {
    return c.gear.filter(g => g.equipped)
      .map(g => ({ a: getArmor(g.name), g }))
      .filter(x => x.a);
  }

  function num(v) { const m = /(-?\d+)/.exec(String(v || '')); return m ? parseInt(m[1], 10) : 0; }

  function acBreakdown(c) {
    const race = getRace(c.race);
    const size = (race && race.size) || 'Medium';
    const sizeMod = SIZE_MOD[size] || 0;
    let armor = (c.combat.miscArmor || 0), shield = 0, maxDex = Infinity;
    for (const { a, g } of equippedArmor(c)) {
      const bonus = num(a.bonus) + magicArmor(g).enh;
      if (/shield/i.test(a.group) || /shield|buckler/i.test(a.name)) shield += bonus;
      else armor += bonus;
      if (a.maxDex && /\d/.test(a.maxDex)) maxDex = Math.min(maxDex, num(a.maxDex));
    }
    const dex = Math.min(abilityMod(c, 'dex'), maxDex);
    const cb = c.combat;
    const total = 10 + armor + shield + dex + sizeMod + (cb.naturalArmor || 0) + (cb.deflection || 0) + (cb.dodge || 0) + (cb.miscAC || 0);
    const touch = 10 + dex + sizeMod + (cb.deflection || 0) + (cb.dodge || 0) + (cb.miscAC || 0);
    const flat = total - dex - (cb.dodge || 0) + Math.min(dex, 0);
    return { total, touch, flat, armor, shield, dex, sizeMod, maxDex };
  }

  function saves(c) {
    const t = totals(c);
    const cb = c.combat;
    return {
      fort: t.fort + abilityMod(c, 'con') + (cb.miscFort || 0),
      ref: t.ref + abilityMod(c, 'dex') + (cb.miscRef || 0),
      will: t.will + abilityMod(c, 'wis') + (cb.miscWill || 0),
      base: t,
    };
  }

  function combatManeuvers(c) {
    const t = totals(c);
    const race = getRace(c.race);
    const size = (race && race.size) || 'Medium';
    const sp = SIZE_SPECIAL[size] || 0;
    const cb = c.combat;
    const cmb = t.bab + abilityMod(c, 'str') + sp + (cb.miscCMB || 0);
    // deflection and dodge bonuses to AC also apply to CMD (armor/shield/natural don't)
    const cmd = 10 + t.bab + abilityMod(c, 'str') + abilityMod(c, 'dex') + sp +
      (cb.deflection || 0) + (cb.dodge || 0) + (cb.miscCMD || 0);
    return { cmb, cmd };
  }

  // armor/encumbrance-reduced speed for any base: drop a third, round up to 5
  // (matches the book table: 20→15, 30→20, 40→30, 50→35, 60→40)
  const reducedSpeed = b => Math.ceil((b * 2 / 3) / 5) * 5;

  // speed with the "why": { base, slowed, misc, total, steady, reasons: ['armor'|'load'] }
  // so the UI can explain a reduced value instead of looking broken
  function speedBreakdown(c) {
    const race = getRace(c.race);
    const base = (race && race.speed) || 30;
    let slowed = base;
    const reasons = [];
    // e.g. dwarves: "Slow and Steady" — speed is never modified by armor or encumbrance
    const steady = !!(race && (race.traits || []).some(t => /never modified by armor or encumbrance/i.test(t.body)));
    if (!steady) {
      for (const { a } of equippedArmor(c)) {
        if (/medium|heavy/i.test(a.group)) {
          slowed = base === 30 ? num(a.spd30) || 20 : (base === 20 ? num(a.spd20) || 15 : reducedSpeed(base));
          if (slowed < base) reasons.push('armor');
          break;
        }
      }
      // a medium/heavy load slows you like medium armor; armor and encumbrance
      // penalties don't stack — the worse one applies
      if (gearWeight(c) > carryCapacity(c).light) {
        const lv = reducedSpeed(base);
        if (lv < base && lv <= slowed) reasons.push('load');
        slowed = Math.min(slowed, lv);
      }
    }
    const misc = c.combat.speedMisc || 0;
    return { base, slowed, misc, steady, reasons, total: slowed + misc };
  }
  const speed = c => speedBreakdown(c).total;

  // ---------- carrying ----------
  // carryStrBonus: effective Str increase for carrying (masterwork backpack +1, muleback cords +8…)
  // carryMult: flat multiplier on every load limit (Ant Haul ×3, heavy horse, etc.)
  function carryCapacity(c) {
    let str = abilityScore(c, 'str') + (c.combat.carryStrBonus || 0);
    let mult = 1;
    while (str > 29) { str -= 10; mult *= 4; }
    str = Math.max(str, 0);
    const m = mult * (c.combat.carryMult || 1);
    return {
      light: (LIGHT_LOAD[str] || 0) * m,
      medium: (MEDIUM_LOAD[str] || 0) * m,
      heavy: (HEAVY_LOAD[str] || 0) * m,
    };
  }

  function gearWeight(c) {
    let w = 0;
    for (const g of c.gear) {
      if (g.stored) continue;   // owned but not carried (camp, mount, wagon)
      let item = parseFloat(g.weight);
      if (isNaN(item)) {
        const src = getWeapon(g.name) || getArmor(g.name) || getItem(g.name);
        item = src ? parseFloat(String(src.weight).replace(/[^\d.]/g, '')) || 0 : 0;
      }
      w += item * (g.qty || 1);
    }
    return Math.round(w * 10) / 10;
  }

  // ---------- spells ----------
  function casterInfo(clsName) {
    if (CASTERS[clsName]) return CASTERS[clsName];
    // data-driven casters (Occult Adventures classes etc. carry a casting block)
    const cls = getClass(clsName);
    if (cls && cls.casting && cls.casting.ability) {
      return {
        ability: cls.casting.ability,
        kind: cls.casting.type === 'prepared' ? 'prepared' : 'spontaneous',
        list: clsName,
      };
    }
    return null;
  }

  // Is this spell actually on the given class's spell list? Used to flag spells
  // the user deliberately added from another class's list. Unknown spells
  // (homebrew / not in data) are treated as on-list to avoid false flags.
  function spellOnClassList(spellName, clsName) {
    const sp = getSpell(spellName);
    if (!sp || !sp.levels) return true;
    const info = casterInfo(clsName);
    const listKey = info ? info.list : clsName;
    return sp.levels[listKey] != null || sp.levels[clsName] != null;
  }

  function bonusSlots(abilityModValue, spellLevel) {
    if (spellLevel < 1 || abilityModValue < spellLevel) return 0;
    return Math.floor((abilityModValue - spellLevel) / 4) + 1;
  }

  // Specialist school + opposition schools, read from the character's chosen
  // class abilities ("Illusion School", "Necromancy Opposition School").
  // "Arcane School" (universalist) grants no bonus slot.
  function specialistInfo(c, clsName) {
    let school = null; const opposition = [];
    for (const a of (c.classAbilities || [])) {
      if (a.cls !== clsName) continue;
      let m = /^(.+?) Opposition School$/i.exec(a.name);
      if (m) { opposition.push(m[1].trim()); continue; }
      m = /^(.+?) School$/i.exec(a.name);
      if (m && !/^arcane$/i.test(m[1].trim())) school = m[1].trim();
    }
    return (school || opposition.length) ? { school, opposition } : null;
  }

  // lowercase school word of a spell ("illusion"), or null if unknown
  function spellSchoolOf(spellName) {
    const sp = getSpell(spellName);
    const m = sp && sp.school ? /^([a-z]+)/i.exec(String(sp.school)) : null;
    return m ? m[1].toLowerCase() : null;
  }

  function spellSlots(c, clsName) {
    const lvl = classLevels(c).get(clsName);
    const info = casterInfo(clsName);
    if (!lvl || !info) return null;
    const row = progRow(clsName, lvl);
    if (!row || !row.spd) return null;
    const abM = abilityMod(c, info.ability);
    const spec = specialistInfo(c, clsName);
    const out = [];
    for (let s = 0; s <= 9; s++) {
      const base = row.spd[s];
      if (base === undefined) continue;
      if (base === null) { out.push({ lvl: s, base: null, bonus: 0, school: 0, total: null }); continue; }
      const b = s >= 1 ? bonusSlots(abM, s) : 0;
      const sch = (spec && spec.school && s >= 1) ? 1 : 0;   // specialist school slot
      out.push({ lvl: s, base, bonus: b, school: sch, total: base + b + sch });
    }
    return out;
  }

  // Per-level prepared-slot accounting for prepared casters: opposition-school
  // spells cost TWO slots, and the specialist school slot must hold a spell of
  // that school. Returns {lvl: {cost, cap, school, schoolPrepared, over, schoolShort}}.
  function preparedSummary(c, clsName) {
    const info = casterInfo(clsName);
    if (!info || info.kind !== 'prepared') return null;
    const slots = spellSlots(c, clsName);
    if (!slots) return null;
    const spec = specialistInfo(c, clsName);
    const out = {};
    for (const s of slots) {
      if (s.lvl < 1 || s.total == null) continue;
      out[s.lvl] = { cost: 0, cap: s.total, school: s.school || 0, schoolPrepared: 0 };
    }
    for (const sp of (c.spells || [])) {
      if (sp.cls !== clsName) continue;
      const n = parseInt(sp.prepared, 10) || 0;
      if (!n) continue;
      const row = out[sp.lvl];
      if (!row) continue;
      const school = spellSchoolOf(sp.name);
      const isOpp = !!(spec && school && spec.opposition.some(o => o.toLowerCase() === school));
      row.cost += n * (isOpp ? 2 : 1);
      if (spec && spec.school && school === spec.school.toLowerCase()) row.schoolPrepared += n;
    }
    for (const row of Object.values(out)) {
      row.over = row.cost > row.cap;
      // using the school slot's capacity without a school spell to sit in it
      row.schoolShort = row.school > 0 && row.cost > row.cap - row.school && row.schoolPrepared < 1;
    }
    return out;
  }

  function spellsKnownRow(c, clsName) {
    const cls = getClass(clsName);
    const lvl = classLevels(c).get(clsName);
    if (!cls || !cls.spellsKnown || !lvl) return null;
    return cls.spellsKnown[lvl] || null;
  }

  // +1 per Spell Focus / Greater Spell Focus whose note names the spell's school
  function spellFocusBonus(c, school) {
    if (!school) return 0;
    let b = 0;
    for (const f of (c.feats || [])) {
      if (!/^(greater )?spell focus$/i.test(String(f.name).trim())) continue;
      if (String(f.note || '').toLowerCase().includes(school)) b++;
    }
    return b;
  }

  function spellDC(c, clsName, spellLevel, spellName) {
    const info = casterInfo(clsName);
    if (!info) return null;
    const focus = spellName ? spellFocusBonus(c, spellSchoolOf(spellName)) : 0;
    return 10 + spellLevel + abilityMod(c, info.ability) + focus;
  }

  // ---------- companions ----------
  const COMPANION_TYPES = ['animal companion', 'mount', 'familiar', 'eidolon', 'cohort', 'follower', 'other'];

  function newCompanion(type) {
    return {
      id: 'cmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type: type || 'animal companion',
      name: '', species: '', form: 'Quadruped',
      effOverride: null, hpOverride: null, leadMod: 0,
      abilityOverride: {}, miscNatArmor: 0, evolutions: [],
      attacks: '', tricks: '', gear: '', notes: '', linkedId: '',
    };
  }

  const intIn = s => { const m = /([+-]?\d+)/.exec(String(s == null ? '' : s)); return m ? parseInt(m[1], 10) : 0; };

  function companionAutoLevel(c, comp) {
    const cl = classLevels(c);
    const g = n => cl.get(n) || 0;
    switch (comp.type) {
      case 'eidolon': return g('Summoner');
      case 'familiar':
        return g('Wizard') + g('Sorcerer') + g('Witch') + g('Magus') + g('Arcanist') +
               g('Bloodrager') + g('Shaman') + g('Adept');
      case 'animal companion':
      case 'mount':
        return g('Druid') + g('Hunter') + Math.max(0, g('Ranger') - 3) + g('Paladin') + g('Cavalier') + g('Samurai');
      default: return c.levels.length;
    }
  }

  function companionEffLevel(c, comp) {
    const o = parseInt(comp.effOverride, 10);
    const lvl = (comp.effOverride != null && comp.effOverride !== '' && !isNaN(o)) ? o : companionAutoLevel(c, comp);
    return Math.max(1, Math.min(20, lvl || 1));
  }

  function progRowByLevel(rows, lvl) {
    if (!rows) return null;
    return rows.find(r => intIn(r['Class Level']) === lvl) || null;
  }

  function getCompSpecies(name) {
    return ((PFDATA.companions || {}).species || []).find(s => s.name === name) || null;
  }
  function getFamiliarSpecies(name) {
    return ((PFDATA.companions || {}).familiarSpecies || []).find(s => s.name === name) || null;
  }

  // ---------- eidolon evolutions ----------
  const getEvolution = n => (PFDATA.evolutions || []).find(e =>
    e.name.toLowerCase() === String(n || '').toLowerCase());

  // Natural-attack evolutions the app can add to the eidolon's attack line.
  // [Medium, Large, Huge damage dice, number of attacks per rank, secondary?]
  const EVO_ATTACKS = {
    'bite':        ['1d6', '1d8', '2d6', 1, false],
    'claws':       ['1d4', '1d6', '1d8', 2, false],
    'gore':        ['1d6', '1d8', '2d6', 1, false],
    'slam':        ['1d8', '2d6', '2d8', 1, false],
    'sting':       ['1d4', '1d6', '1d8', 1, false],
    'tail slap':   ['1d6', '1d8', '2d6', 1, true],
    'tentacle':    ['1d4', '1d6', '1d8', 1, true],
    'pincers':     ['1d6', '1d8', '2d6', 2, true],
    'wing buffet': ['1d4', '1d6', '1d8', 2, true],
    'rake':        ['1d4', '1d6', '1d8', 2, false],
  };

  // Evolution points available (from the progression table) vs. spent.
  function evolutionPool(c, comp) {
    const lvl = companionEffLevel(c, comp);
    const row = progRowByLevel((PFDATA.companions || {}).eidolonProg, lvl);
    const max = row ? intIn(row['Evolution Pool']) : 0;
    let spent = 0;
    for (const ev of (comp.evolutions || [])) {
      const e = getEvolution(ev.name);
      if (e) spent += e.cost * Math.max(1, ev.ranks || 1);
    }
    return { max, spent, remaining: max - spent, over: spent > max };
  }

  // Base-form free evolutions (limbs, bite…) count toward prerequisites even
  // though they cost no points — parsed from the form's "Free Evolutions" line.
  function freeEvolutionBases(comp) {
    const form = ((PFDATA.companions || {}).eidolonForms || []).find(f => f.name === comp.form);
    const m = form && /Free Evolutions\s+([^.]+)\./.exec(form.text || '');
    if (!m) return new Set();
    return new Set(m[1].split(/,| or /i).map(s => s.trim().toLowerCase().split(' (')[0]).filter(Boolean));
  }

  // Unmet requirements for taking an evolution: minimum summoner level (the
  // eidolon's effective level), base-form restriction, prerequisite evolutions.
  function evolutionPrereqs(c, comp, evo) {
    const reasons = [];
    if (!evo) return { ok: true, reasons };
    const lvl = companionEffLevel(c, comp);
    if (evo.minLevel && lvl < evo.minLevel) reasons.push('summoner level ' + evo.minLevel + '+');
    if (evo.forms && evo.forms.length && comp.form && !evo.forms.includes(comp.form)) {
      reasons.push(evo.forms.join(' or ') + ' form only');
    }
    const haveBases = freeEvolutionBases(comp);
    for (const x of (comp.evolutions || [])) haveBases.add(String(x.name).toLowerCase().split(' (')[0]);
    for (const need of (evo.prereqEvos || [])) {
      const base = String(need).split(' (')[0];
      if (!haveBases.has(base)) reasons.push('needs the ' + need + ' evolution');
    }
    return { ok: reasons.length === 0, reasons };
  }

  // Aggregate the mechanically-applied effects of an eidolon's chosen
  // evolutions. Only the cleanly quantifiable ones fold into the stat block;
  // everything else is surfaced as a note (with its rules text still available
  // in the picker / hover popover). -> { abil{}, natArmor, size|null, attacks:[{key,ranks}], notes:[] }
  function eidolonEvolutionEffects(comp) {
    const eff = { abil: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, natArmor: 0, size: null, attacks: [], notes: [] };
    for (const ev of (comp.evolutions || [])) {
      const e = getEvolution(ev.name);
      if (!e) continue;
      const ranks = Math.max(1, ev.ranks || 1);
      const key = e.name.toLowerCase();
      if (key === 'ability increase') {
        const ab = String(ev.choice || '').toLowerCase().slice(0, 3);
        if (ABILITIES.includes(ab)) eff.abil[ab] += 2 * ranks;
        else eff.notes.push('Ability Increase — choose an ability');
      } else if (key === 'improved natural armor') {
        eff.natArmor += 2 * ranks;
      } else if (key === 'large') {
        eff.size = ranks >= 2 ? 'Huge' : 'Large';
        eff.abil.str += 8 * ranks; eff.abil.con += 4 * ranks; eff.abil.dex -= 2 * ranks;
        eff.natArmor += 2 * ranks;
      } else if (EVO_ATTACKS[key]) {
        eff.attacks.push({ key, ranks });
      } else {
        eff.notes.push(e.name + (ev.choice ? ' (' + ev.choice + ')' : '') + (ranks > 1 ? ' ×' + ranks : ''));
      }
    }
    return eff;
  }

  function applyOverrides(abil, comp) {
    const out = Object.assign({}, abil);
    for (const k of ABILITIES) {
      const v = parseInt((comp.abilityOverride || {})[k], 10);
      if (!isNaN(v)) out[k] = v;
    }
    // fold in active-buff ability changes here so AC/saves/attacks all reflect them
    const bt = compBuffTotals(comp);
    for (const k of ABILITIES) out[k] += bt[k] || 0;
    return out;
  }

  // -> { lvl, hd, hdDie, bab, saves {fort,ref,will}, abilities {}, size, speed, natArmor, ac,
  //      attacks, hp, skills, feats, special, extras {} , warnings [] }
  // wrapper: ability buffs are folded in via applyOverrides (inside _base, so AC/saves/attacks
  // already reflect them); here we add the flat (non-ability) buff bonuses on top.
  function companionDerived(c, comp) {
    const out = _companionDerivedBase(c, comp);
    if (out && out.abilities) {
      const bt = compBuffTotals(comp);
      out.ac = (out.ac || 0) + bt.ac;
      if (out.saves) {
        out.saves.fort += bt.fort; out.saves.ref += bt.ref; out.saves.will += bt.will;
      }
      out.buffAtk = bt.attack;   // consumed by companionAttacks
      out.buffDmg = bt.damage;
      out.buffInit = bt.init;
    }
    return out;
  }

  function _companionDerivedBase(c, comp) {
    const D = PFDATA.companions || {};
    const out = { lvl: companionEffLevel(c, comp), warnings: [], extras: {} };

    if (comp.type === 'animal companion' || comp.type === 'mount') {
      const sp = getCompSpecies(comp.species);
      const row = progRowByLevel(D.acProg, out.lvl);
      if (!row) { out.warnings.push('no progression row'); return out; }
      let abil = { str: 10, dex: 10, con: 10, int: 2, wis: 10, cha: 6 };
      let size = 'Medium', speed = '30 ft.', natBase = 0, attacks = '', sq = '', sa = '';
      if (sp && sp.base) {
        if (sp.base.abilities && sp.base.abilities.kind === 'scores') abil = Object.assign({}, sp.base.abilities.vals);
        size = sp.base.size || size; speed = sp.base.speed || speed;
        natBase = intIn(sp.base.ac); attacks = sp.base.attack; sq = sp.base.sq; sa = sp.base.sa;
        for (const adv of (sp.adv || [])) {
          if (out.lvl >= (adv.level || 99)) {
            if (adv.abilities && adv.abilities.kind === 'deltas') {
              for (const [k, v] of Object.entries(adv.abilities.vals)) abil[k] = (abil[k] || 10) + v;
            } else if (adv.abilities && adv.abilities.kind === 'scores') {
              Object.assign(abil, adv.abilities.vals);
            }
            size = adv.size || size; speed = adv.speed || speed;
            if (adv.ac) natBase = intIn(adv.ac);
            attacks = adv.attack || attacks;
            sq = adv.sq || sq; sa = adv.sa || sa;
            if (adv.bonusFeat) out.extras['Bonus feat'] = adv.bonusFeat;
          }
        }
      } else if (comp.species) {
        out.warnings.push('unknown species "' + comp.species + '"');
      }
      const sd = intIn(row['Str/Dex Bonus']);
      abil.str += sd; abil.dex += sd;
      abil = applyOverrides(abil, comp);
      const hd = intIn(row['HD']);
      const natArmor = natBase + intIn(row['Natural Armor Bonus']) + (comp.miscNatArmor || 0);
      out.hd = hd; out.hdDie = 8;
      out.bab = intIn(row['BAB']);
      out.abilities = abil;
      out.saves = {
        fort: intIn(row['Fort']) + mod(abil.con),
        ref: intIn(row['Ref']) + mod(abil.dex),
        will: intIn(row['Will']) + mod(abil.wis),
      };
      out.size = size; out.speed = speed; out.natArmor = natArmor;
      out.ac = 10 + natArmor + mod(abil.dex) + (SIZE_MOD[size] || 0);
      out.attacks = attacks;
      out.hp = comp.hpOverride || (Math.floor(hd * 4.5) + mod(abil.con) * hd);
      out.skills = row['Skills']; out.feats = row['Feats'];
      out.special = [row['Special'], sq, sa].filter(Boolean).join(' • ');
      out.extras['Bonus tricks'] = row['Bonus Tricks'];
      return out;
    }

    if (comp.type === 'eidolon') {
      const row = progRowByLevel(D.eidolonProg, out.lvl);
      const form = (D.eidolonForms || []).find(f => f.name === comp.form) || null;
      if (!row) { out.warnings.push('no progression row'); return out; }
      let abil = { str: 14, dex: 14, con: 13, int: 7, wis: 10, cha: 11 };
      let size = 'Medium', speed = '', natBase = 2, attacks = '', goodSaves = ['fort', 'ref'], free = '';
      if (form) {
        const t = form.text;
        const ab = /Ability Scores\s+([^;]+);?/.exec(t);
        if (ab) {
          const parsed = {};
          for (const m of t.matchAll(/(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/g)) parsed[m[1].toLowerCase()] = parseInt(m[2], 10);
          if (Object.keys(parsed).length === 6) abil = parsed;
        }
        const sz = /Size\s+(\w+)/.exec(t); if (sz) size = sz[1];
        const spd = /Speed\s+([^;]+);/.exec(t); if (spd) speed = spd[1].trim();
        const acm = /AC\s+\+(\d+) natural/.exec(t); if (acm) natBase = parseInt(acm[1], 10);
        const atk = /Attack\s+([^;]+);/.exec(t); if (atk) attacks = atk[1].trim();
        const fe = /Free Evolutions\s+([^.]+)\./.exec(t); if (fe) free = fe[1].trim();
        goodSaves = [];
        for (const m of t.matchAll(/(Fort|Ref|Will)\s*\(good\)/gi)) goodSaves.push(m[1].toLowerCase());
        if (!goodSaves.length) goodSaves = ['fort', 'ref'];
      }
      const sd = intIn(row['Str/Dex Bonus']);
      abil.str += sd; abil.dex += sd;
      // chosen evolutions: ability boosts, size increase, natural armor, attacks
      const evo = eidolonEvolutionEffects(comp);
      for (const k of ABILITIES) abil[k] += evo.abil[k] || 0;
      if (evo.size) size = evo.size;
      abil = applyOverrides(abil, comp);
      const hd = intIn(row['HD']);
      const good = intIn(row['Good Saves']), bad = intIn(row['Bad Save']);
      const sv = {};
      for (const s of ['fort', 'ref', 'will']) {
        const base = goodSaves.includes(s) ? good : bad;
        sv[s] = base + mod(s === 'fort' ? abil.con : s === 'ref' ? abil.dex : abil.wis);
      }
      // append evolution natural attacks, scaled to the eidolon's (possibly enlarged) size,
      // skipping any the base form already grants
      const szIdx = /Huge|Gargantuan|Colossal/.test(size) ? 2 : /Large/.test(size) ? 1 : 0;
      for (const a of evo.attacks) {
        const spec = EVO_ATTACKS[a.key];
        if (new RegExp('\\b' + a.key + '\\b', 'i').test(attacks)) continue;
        const n = spec[3] * a.ranks;
        attacks += (attacks ? ', ' : '') + (n > 1 ? n + ' ' : '') + a.key + ' (' + spec[szIdx] + ')';
      }
      out.hd = hd; out.hdDie = 10;
      out.bab = intIn(row['BAB']);
      out.abilities = abil;
      out.saves = sv;
      out.size = size; out.speed = speed || '20 ft.';
      out.natArmor = natBase + evo.natArmor + (comp.miscNatArmor || 0);
      // table 'Armor Bonus' is the eidolon's inherent (scaling) armor; evolution
      // natural armor from Improved Natural Armor / Large adds on top
      out.ac = 10 + intIn(row['Armor Bonus']) + evo.natArmor + mod(abil.dex) + (SIZE_MOD[size] || 0) + (comp.miscNatArmor || 0);
      out.attacks = attacks;
      out.hp = comp.hpOverride || (Math.floor(hd * 5.5) + mod(abil.con) * hd);
      out.skills = row['Skills']; out.feats = row['Feats'];
      out.special = [row['Special'], evo.notes.join(', ')].filter(Boolean).join(' • ');
      const pool = evolutionPool(c, comp);
      out.extras['Evolution pool'] = pool.spent + ' / ' + pool.max + (pool.over ? ' (over budget!)' : '');
      out.extras['Max attacks'] = row['Max. Attacks'];
      if (free) out.extras['Free evolutions'] = free;
      return out;
    }

    if (comp.type === 'familiar') {
      const sp = getFamiliarSpecies(comp.species);
      const rows = D.familiarProg || [];
      let row = null;
      for (const r of rows) { if (intIn(r['Master Class Level']) <= out.lvl) row = r; }
      const specials = [];
      for (const r of rows) {
        if (intIn(r['Master Class Level']) <= out.lvl && r['Special'] && /\w/.test(r['Special'])) specials.push(r['Special']);
      }
      const masterHp = hpBreakdown(c).total;
      const masterT = totals(c);
      let abil = { str: 3, dex: 15, con: 8, int: 6, wis: 12, cha: 7 };
      let size = 'Tiny', speed = '', attacks = '', natSpecies = 0, sq = '';
      if (sp) {
        abil = Object.assign({}, sp.abilities);
        for (const k of ABILITIES) if (abil[k] == null) abil[k] = 10;
        size = sp.size || 'Tiny'; speed = sp.speed || ''; attacks = sp.melee || '';
        const nm = /\+(\d+)\s*natural/.exec(sp.ac || ''); if (nm) natSpecies = parseInt(nm[1], 10);
        sq = [sp.senses, sp.sq].filter(Boolean).join('; ');
      } else if (comp.species) {
        out.warnings.push('unknown species "' + comp.species + '"');
      }
      if (row) abil.int = intIn(row['Int']) || abil.int;
      abil = applyOverrides(abil, comp);
      const natAdj = row ? intIn(row['Natural Armor Adj.']) : 0;
      out.hd = c.levels.length; out.hdDie = null;
      out.bab = masterT.bab;
      out.abilities = abil;
      out.saves = {
        fort: masterT.fort + mod(abil.con),
        ref: masterT.ref + mod(abil.dex),
        will: masterT.will + mod(abil.wis),
      };
      out.size = size; out.speed = speed;
      out.natArmor = natSpecies + natAdj + (comp.miscNatArmor || 0);
      out.ac = 10 + out.natArmor + mod(abil.dex) + (SIZE_MOD[size] || 0);
      out.attacks = attacks;
      out.hp = comp.hpOverride || Math.max(1, Math.floor(masterHp / 2));
      out.special = specials.join(', ');
      const ben = (D.familiarBenefits || []).find(b => comp.species && b.name.toLowerCase().includes(comp.species.toLowerCase().split(',')[0]));
      if (ben) out.extras['Master benefit'] = ben.benefit;
      if (sp) { out.extras['Skills'] = sp.skills; out.extras['SQ'] = sq; }
      return out;
    }

    if (comp.type === 'cohort' || comp.type === 'follower') {
      const score = c.levels.length + abilityMod(c, 'cha') + (parseInt(comp.leadMod, 10) || 0);
      const rows = D.leadership || [];
      let row = null;
      for (const r of rows) { if (intIn(r['Leadership Score']) <= score) row = r; }
      out.extras['Leadership score'] = score;
      if (row) {
        const cohortLvl = intIn(row['Cohort Level']);
        out.extras['Max cohort level'] = Math.min(cohortLvl, Math.max(0, c.levels.length - 2)) || '—';
        const fl = [];
        for (const l of ['1st', '2nd', '3rd', '4th', '5th', '6th']) {
          const v = row['Number of Followers by Level ' + l];
          if (v && /\d/.test(v)) fl.push(v + '× lvl ' + l);
        }
        out.extras['Followers'] = fl.join(', ') || 'none';
      }
      if (!hasFeat(c, 'Leadership')) out.warnings.push('Leadership feat not taken');
      return out;
    }

    return out; // 'other': free-form
  }

  // ---------- play mode: conditions, buffs, effective stats ----------
  const CONDITIONS = [
    { name: 'Shaken', changes: [['attack', -2], ['saves', -2], ['skills', -2]], note: 'Also −2 on ability checks.' },
    { name: 'Frightened', changes: [['attack', -2], ['saves', -2], ['skills', -2]], note: 'As shaken; must flee the source if able.' },
    { name: 'Panicked', changes: [['saves', -2], ['skills', -2]], note: 'Drops held items, flees; cowers if cornered.' },
    { name: 'Sickened', changes: [['attack', -2], ['damage', -2], ['saves', -2], ['skills', -2]], note: 'Also −2 on ability checks.' },
    { name: 'Nauseated', changes: [], note: 'Only a single move action per turn; no attacks or casting.' },
    { name: 'Fatigued', changes: [['str', -2], ['dex', -2]], note: 'Cannot run or charge.' },
    { name: 'Exhausted', changes: [['str', -6], ['dex', -6]], note: 'Half speed; cannot run or charge.' },
    { name: 'Entangled', changes: [['attack', -2], ['dex', -4]], note: 'Half speed; cannot run or charge; concentration DC 15 + spell level.' },
    { name: 'Grappled', changes: [['dex', -4], ['attack', -2]], note: '−2 on all checks except to grapple or escape; no AoOs.' },
    { name: 'Prone', changes: [['attack', -4]], note: 'Melee only; +4 AC vs ranged, −4 AC vs melee.' },
    { name: 'Blinded', changes: [['acMisc', -2]], note: 'Loses Dex to AC; half speed; −4 Str/Dex-based skills; foes have total concealment.' },
    { name: 'Dazzled', changes: [['attack', -1]], note: '−1 on sight-based Perception.' },
    { name: 'Deafened', changes: [['init', -4]], note: '20% failure on verbal spells; auto-fail hearing Perception.' },
    { name: 'Stunned', changes: [['acMisc', -2]], note: 'Loses Dex to AC; drops held items; no actions.' },
    { name: 'Cowering', changes: [['acMisc', -2]], note: 'Loses Dex to AC; no actions.' },
    { name: 'Staggered', changes: [], note: 'Only a single move or standard action each round.' },
  ].map(cnd => ({
    name: cnd.name, source: 'Condition', condition: true, note: cnd.note,
    changes: cnd.changes.map(([t, v]) => ({ target: t, type: 'untyped', value: v })),
    html: '<p>' + cnd.note + '</p>',
  }));

  function newPlayState() {
    return { hpDamage: 0, hpTemp: 0, nonlethal: 0, slotsUsed: {}, spellsCast: {}, buffs: [], counters: [], rolls: [], customRolls: [],
             abilityDamage: {}, negLevels: 0 };
  }

  // true when the character carries live play-state penalties (ability damage /
  // negative levels) that effective() must fold in alongside buffs
  function hasPlayPenalties(c) {
    const p = c.play || {};
    if (p.negLevels > 0) return true;
    const ad = p.abilityDamage || {};
    return ABILITIES.some(ab => (ad[ab] || 0) !== 0);
  }

  // ---------- spell -> buff effect parsing ----------
  function stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, ' ')
      // dashes must survive as '-' — "&ndash;1 penalty" would otherwise lose its
      // sign and parse as a +1 bonus (Power Attack, Deadly Aim…)
      .replace(/&(?:ndash|mdash|minus);|&#8211;|&#8212;|&#8722;/gi, '-')
      .replace(/[–—−]/g, '-')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  const SPELL_BONUS_TYPES = 'enhancement|morale|luck|competence|sacred|profane|insight|resistance|deflection|dodge|alchemical|circumstance|size|racial|trait|natural armor|armor|shield';

  // Matches any single named skill (Perception, Use Magic Device, …). A bonus
  // "on <Skill Name> checks" targets that one skill, which the engine models via
  // per-skill skillMisc — it must NOT fold into the all-skills skillMiscAll the
  // 'skills' target maps to. Built lazily so PFDATA.skills is loaded first.
  let _namedSkillRe;
  function namedSkillRe() {
    if (_namedSkillRe) return _namedSkillRe;
    const names = (PFDATA.skills || []).map(s => s.name)
      .sort((a, b) => b.length - a.length)                 // longest first: match "Sleight of Hand" before "Hand"
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    _namedSkillRe = names.length ? new RegExp('\\b(?:' + names.join('|') + ')\\b', 'i') : /$^/;
    return _namedSkillRe;
  }

  function phraseToTargets(phrase, type) {
    const p = ' ' + phrase.toLowerCase() + ' ';
    const out = new Set();
    if (/\bstrength\b/.test(p)) out.add('str');
    if (/\bdexterity\b/.test(p)) out.add('dex');
    if (/\bconstitution\b/.test(p)) out.add('con');
    if (/\bintelligence\b/.test(p)) out.add('int');
    if (/\bwisdom\b/.test(p)) out.add('wis');
    if (/\bcharisma\b/.test(p)) out.add('cha');
    if (/attack roll|\battacks?\b/.test(p)) out.add('attack');
    if (/damage roll|weapon damage|\bdamage\b/.test(p)) out.add('damage');
    if (/initiative/.test(p)) out.add('init');
    if (/\bspeed\b/.test(p)) out.add('speed');
    // Only a genuine all-skills bonus maps to 'skills'. A named-skill bonus
    // ("+1 on Use Magic Device checks") or class-skill wording ("… is always a
    // class skill") must not inflate every skill via skillMiscAll.
    if (/skill check|\bskills?\b/.test(p) && !/\bclass skill\b/.test(p) && !namedSkillRe().test(p)) out.add('skills');
    if (/combat maneuver defense|\bcmd\b/.test(p)) out.add('cmd');
    else if (/combat maneuver|\bcmb\b/.test(p)) out.add('cmb');
    const fort = /fortitude/.test(p), ref = /reflex/.test(p), will = /\bwill\b/.test(p);
    if (fort) out.add('fort');
    if (ref) out.add('ref');
    if (will) out.add('will');
    if (!fort && !ref && !will && /saving throw|\bsaves?\b/.test(p)) out.add('saves');
    if (/natural armor/.test(p) || type === 'natural armor') out.add('natural');
    else if (/armor class|\bac\b/.test(p) || /\barmor\b/.test(p) || /\bshield\b/.test(p)) {
      if (type === 'deflection') out.add('deflection');
      else if (type === 'dodge') out.add('dodge');
      else if (type === 'armor' || type === 'shield') out.add('armor');
      else out.add('acMisc');
    }
    return [...out];
  }

  // scan rules text for "+N [type] bonus/penalty to/on <stat>" patterns.
  // opts.permanent skips obviously-conditional bonuses (while raging, X/day, vs…)
  // so always-on application of traits/abilities doesn't grab situational ones.
  const COND_RE = /\b(?:while|when(?:ever)?|during|against|versus|vs\.?|once per|per day|\/day|rounds? per|number of rounds|on a charge|to resist|made to|as a swift|as an immediate|in place of|selected|chosen|of your choice|choose to|may take|must succeed|that (?:skill|weapon))\b/i;
  function parseChanges(html, opts) {
    const text = stripTags(html || '');
    if (!text) return [];
    const permanent = opts && opts.permanent;
    const re = new RegExp('([+\\-–]\\s?\\d+)\\s+(?:(' + SPELL_BONUS_TYPES + ')\\s+)?(bonus|penalty)\\s+(?:to|on)\\s+([^.;]+)', 'gi');
    const seen = new Set();
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      if (permanent) {
        const ctx = text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 20);
        if (COND_RE.test(ctx)) continue;
      }
      let val = parseInt(m[1].replace('–', '-').replace(/\s/g, ''), 10);
      if (isNaN(val)) continue;
      if (/penalty/i.test(m[3]) && val > 0) val = -val;
      const type = m[2] ? m[2].toLowerCase() : 'untyped';
      const phrase = m[4].split(/\b(?:against|while|until|equal|made to|to resist|for the|in addition|and takes?|and a |and suffers?|but|penalty|if you|rather than)\b/i)[0];
      const stackType = /^(natural armor|armor|shield)$/.test(type) ? (type === 'natural armor' ? 'enhancement' : 'untyped') : type;
      for (const tgt of phraseToTargets(phrase, type)) {
        const key = tgt + ':' + val;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ target: tgt, type: stackType, value: val });
      }
      if (out.length >= 12) break;
    }
    return out;
  }
  function parseSpellChanges(spell) {
    return parseChanges(spell.html || (spell.desc ? '<p>' + spell.desc + '</p>' : ''));
  }

  // permanent stat changes parsed from a content entry's text, cached on it.
  // Source text varies by type: spells/traits/abilities use `html`; feats put the
  // mechanical text in `benefit` (then `body`/`desc`).
  function entryChanges(entry) {
    if (!entry) return [];
    if (entry.__chg) return entry.__chg;
    const src = entry.html || entry.benefit || entry.body || (entry.desc ? '<p>' + entry.desc + '</p>' : '');
    // Skip aggregate/reference entries — e.g. Signature Skill inlines every skill's
    // unlock text (~23k chars), so its scattered "+N bonus" phrases are NOT flat
    // bonuses the feat grants. Implausibly long text, or too many parsed changes
    // for a single entry, ⇒ don't auto-apply (a real feat/trait grants 1–2).
    let changes = stripTags(src).length > 2000 ? [] : parseChanges(src, { permanent: true });
    if (changes.length > 3) changes = [];
    entry.__chg = changes;
    return entry.__chg;
  }
  // always-on bonuses from chosen traits, alternate racial traits, class
  // abilities (rage powers, etc.) and feats → [{target, type, value, source}].
  // The conditional/choice skip in parseChanges keeps situational (while raging)
  // and choice-specific (Weapon Focus → selected weapon) bonuses out.
  function featureChanges(c) {
    const out = [];
    const collect = (entry, src) => { for (const ch of entryChanges(entry)) out.push({ target: ch.target, type: ch.type, value: ch.value, source: src }); };
    for (const tn of (c.traits || [])) collect((PFDATA.traits || []).find(x => x.name === tn), tn);
    for (const an of (c.altTraits || [])) collect(getRacialTrait(an), an);
    for (const a of (c.classAbilities || [])) collect(getClassAbility(a.name), a.name);
    for (const f of (c.feats || [])) collect(getFeat(f.name || f), f.name || f);
    for (const an of ((c.mythic && c.mythic.abilities) || [])) collect(getMythicAbility(an), an);
    // formula-based mythic feature: Amazing Initiative grants +tier to initiative at 2nd tier+
    const tier = (c.mythic && c.mythic.tier) || 0;
    if (tier >= 2) out.push({ target: 'init', type: 'insight', value: tier, source: 'Amazing Initiative' });
    return out;
  }

  // ---------- mythic ----------
  const MYTHIC_PATHS = ['Archmage', 'Champion', 'Guardian', 'Hierophant', 'Marshal', 'Trickster'];
  const isMythic = c => !!(c.mythic && c.mythic.tier > 0);
  // surge die scales with tier; mythic power uses/day = 3 + 2×tier
  const mythicSurgeDie = t => t >= 10 ? '1d12' : t >= 7 ? '1d10' : t >= 4 ? '1d8' : t >= 1 ? '1d6' : '';
  const mythicPowerUses = t => t >= 1 ? 3 + 2 * t : 0;
  // well-known universal mythic features by the tier they're gained
  const MYTHIC_UNIVERSAL = [
    [1, 'Hard to Kill'], [1, 'Mythic Power'], [2, 'Amazing Initiative'], [3, 'Recuperation'],
    [5, 'Force of Will'], [8, 'Mythic Saving Throws'], [10, 'Immortal'],
  ];
  function mythicUniversalFeatures(tier) {
    return MYTHIC_UNIVERSAL.filter(([t]) => t <= tier).map(([t, n]) => ({ tier: t, name: n }));
  }

  function spellToBuff(spell) {
    const changes = parseSpellChanges(spell);
    const txt = stripTags(spell.html || spell.desc || '');
    return {
      name: spell.name, source: spell.source, school: spell.school, levels: spell.levels,
      levelText: spell.levelText, changes, note: '', fromSpell: true,
      scales: changes.length > 0 && /(per|every)\b[^.]{0,22}\blevels?\b/i.test(txt),
      html: spell.html || (spell.desc ? '<p>' + spell.desc + '</p>' : ''),
    };
  }

  // full buff library: curated effects (precise) merged with every spell (auto-parsed)
  let _buffLib = null;
  // drop lazily-built indexes over PFDATA so entries added/removed at runtime
  // (homebrew) show up without a reload; called by Custom.add/remove
  function invalidateCaches() {
    _buffLib = null;
    _featIndex = null;
    _abilIndex = null;
  }
  function buffLibrary() {
    if (_buffLib) return _buffLib;
    const spellByName = new Map((PFDATA.spells || []).map(s => [s.name.toLowerCase(), s]));
    const map = new Map();
    for (const b of (PFDATA.buffs || [])) {
      const entry = Object.assign({ curated: true }, b);
      const s = spellByName.get(b.name.toLowerCase());  // enrich with spell metadata for filtering
      if (s) { entry.levels = s.levels; entry.levelText = s.levelText; entry.school = entry.school || s.school; entry.html = entry.html || s.html; }
      map.set(b.name.toLowerCase(), entry);
    }
    for (const s of (PFDATA.spells || [])) {
      const k = s.name.toLowerCase();
      if (!map.has(k)) map.set(k, spellToBuff(s));
    }
    _buffLib = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    return _buffLib;
  }

  // typed-bonus stacking: same-type bonuses don't stack (take best), penalties take worst;
  // dodge, untyped, circumstance and racial always stack
  const STACKING = new Set(['untyped', 'dodge', 'circumstance', 'racial']);

  function stackTotal(list) {
    const pos = {}, neg = {};
    let sum = 0;
    for (const { type, value } of list) {
      const v = +value || 0;
      const t = type || 'untyped';
      if (STACKING.has(t)) sum += v;
      else if (v >= 0) pos[t] = Math.max(pos[t] || 0, v);
      else neg[t] = Math.min(neg[t] || 0, v);
    }
    for (const v of Object.values(pos)) sum += v;
    for (const v of Object.values(neg)) sum += v;
    return sum;
  }

  // a clone of the character with permanent feature bonuses (traits, abilities…)
  // and, unless opts.buffs === false, active buffs/conditions folded in.
  // Permanent features apply everywhere (sheet base); buffs are Play-tab only.
  function effective(c, opts) {
    const includeBuffs = !opts || opts.buffs !== false;
    const feats = featureChanges(c);
    const active = includeBuffs ? ((c.play || {}).buffs || []).filter(b => b.active) : [];
    const playPen = includeBuffs && hasPlayPenalties(c);
    if (!feats.length && !active.length && !playPen) return c;
    const e = JSON.parse(JSON.stringify(c));
    e.__buffed = active.length > 0 || playPen;
    const buckets = {};
    for (const ch of feats) (buckets[ch.target] = buckets[ch.target] || []).push(ch);
    for (const b of active) {
      for (const ch of b.changes || []) {
        (buckets[ch.target] = buckets[ch.target] || []).push(ch);
      }
    }
    const t = k => buckets[k] ? stackTotal(buckets[k]) : 0;
    for (const ab of ABILITIES) e.abilityMisc[ab] = (e.abilityMisc[ab] || 0) + t(ab);
    const cb = e.combat;
    cb.miscArmor = (cb.miscArmor || 0) + t('armor');
    cb.naturalArmor = (cb.naturalArmor || 0) + t('natural');
    cb.deflection = (cb.deflection || 0) + t('deflection');
    cb.dodge = (cb.dodge || 0) + t('dodge');
    cb.miscAC = (cb.miscAC || 0) + t('acMisc');
    cb.miscAttack = (cb.miscAttack || 0) + t('attack');
    cb.miscDamage = (cb.miscDamage || 0) + t('damage');
    const saves = t('saves');
    cb.miscFort = (cb.miscFort || 0) + t('fort') + saves;
    cb.miscRef = (cb.miscRef || 0) + t('ref') + saves;
    cb.miscWill = (cb.miscWill || 0) + t('will') + saves;
    cb.miscInit = (cb.miscInit || 0) + t('init');
    cb.speedMisc = (cb.speedMisc || 0) + t('speed');
    cb.miscCMB = (cb.miscCMB || 0) + t('cmb');
    cb.miscCMD = (cb.miscCMD || 0) + t('cmd');
    cb.carryStrBonus = (cb.carryStrBonus || 0) + t('carryStr');
    // carry multiplier doesn't add — take the best multiplier among active effects
    if (buckets['carryMult']) cb.carryMult = Math.max(cb.carryMult || 1, ...buckets['carryMult'].map(ch => ch.value || 1));
    e.skillMiscAll = (e.skillMiscAll || 0) + t('skills');
    // live play-state penalties (Play tab only, like buffs):
    // ability damage/drain — lower the score directly; the ability modifier
    // then drops 1 per 2 points, and Con damage feeds max HP via hpBreakdown
    if (playPen) {
      const p = c.play || {};
      const ad = p.abilityDamage || {};
      for (const ab of ABILITIES) if (ad[ab]) e.abilityMisc[ab] -= ad[ab];
      // each negative level: −1 attacks, saves, skill & ability checks, −5 HP
      const nl = p.negLevels || 0;
      if (nl > 0) {
        cb.miscAttack -= nl;
        cb.miscFort -= nl; cb.miscRef -= nl; cb.miscWill -= nl;
        e.skillMiscAll -= nl;
        cb.hpMisc = (cb.hpMisc || 0) - 5 * nl;
        cb.miscCMB = (cb.miscCMB || 0) - nl;
      }
    }
    return e;
  }

  function currentHP(c) {
    const max = hpBreakdown(c).total;
    const p = c.play || {};
    return { max, current: max - (p.hpDamage || 0), temp: p.hpTemp || 0, nonlethal: p.nonlethal || 0 };
  }

  function rollDice(expr) {
    // 'NdM+K' -> { total, rolls, mod }
    const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s/g, ''));
    if (!m) return null;
    const n = parseInt(m[1] || '1', 10), die = parseInt(m[2], 10), mod = parseInt(m[3] || '0', 10);
    const rolls = [];
    for (let i = 0; i < Math.min(n, 50); i++) rolls.push(1 + Math.floor(Math.random() * die));
    return { total: rolls.reduce((a, b) => a + b, 0) + mod, rolls, mod };
  }

  // ---------- companion play helpers ----------
  function newCompanionPlay() {
    return { hpDamage: 0, atkMisc: 0, acMisc: 0, saveMisc: 0, dmgMisc: 0, note: '', customAttacks: [], buffs: [] };
  }

  // stacked totals of a companion's own active buffs/conditions (same model as the character's)
  function compBuffTotals(comp) {
    const totals = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
                     attack: 0, damage: 0, fort: 0, ref: 0, will: 0, ac: 0, init: 0 };
    const active = ((comp.play || {}).buffs || []).filter(b => b.active);
    if (!active.length) return totals;
    const buckets = {};
    for (const b of active) for (const ch of (b.changes || [])) (buckets[ch.target] = buckets[ch.target] || []).push(ch);
    const t = k => buckets[k] ? stackTotal(buckets[k]) : 0;
    for (const ab of ABILITIES) totals[ab] = t(ab);
    totals.attack = t('attack'); totals.damage = t('damage'); totals.init = t('init');
    const saves = t('saves');
    totals.fort = t('fort') + saves; totals.ref = t('ref') + saves; totals.will = t('will') + saves;
    totals.ac = t('armor') + t('natural') + t('deflection') + t('dodge') + t('acMisc');
    return totals;
  }

  // parse "bite (1d6 plus trip), 2 claws (1d4)" or "bite +4 (1d3-4)" into rollable attacks
  function companionAttacks(c, comp, d) {
    if (!d || !d.abilities) return [];
    const out = [];
    const sizeM = SIZE_MOD[d.size] || 0;
    const strM = mod(d.abilities.str || 10);
    const dexM = mod(d.abilities.dex || 10);
    const finesse = comp.type === 'familiar' && dexM > strM;
    const buffAtk = d.buffAtk || 0, buffDmg = d.buffDmg || 0;   // flat buff bonuses (Bless, Magic Fang…)
    const baseAtk = (d.bab || 0) + (finesse ? dexM : strM) + sizeM + ((comp.play || {}).atkMisc || 0) + buffAtk;
    const src = d.attacks || '';
    for (let part of src.split(/[,;]/)) {
      part = part.trim();
      if (!part) continue;
      const m = /^(\d+)?\s*([A-Za-z' ]+?)\s*(?:[+-]\d+\s*)?\(([^)]*)\)/.exec(part);
      if (!m) continue;
      const count = parseInt(m[1] || '1', 10);
      const label = m[2].trim();
      const inParens = m[3];
      const dm = /(\d*d\d+)\s*([+-]\s*\d+)?/.exec(inParens);
      if (!dm) continue;
      const dice = dm[1];
      // explicit damage modifier in the stat block (familiars) wins; otherwise add Str
      const dmgMod = (dm[2] != null ? parseInt(dm[2].replace(/\s/g, ''), 10) : strM) + ((comp.play || {}).dmgMisc || 0) + buffDmg;
      const note = inParens.replace(/(\d*d\d+)\s*([+-]\s*\d+)?/, '').replace(/^\s*(plus|and)?\s*/, '').trim();
      for (let i = 0; i < Math.min(count, 4); i++) {
        out.push({
          label: count > 1 ? `${label} ${i + 1}` : label,
          atk: baseAtk,
          dice: dice + (dmgMod ? (dmgMod > 0 ? '+' : '') + dmgMod : ''),
          note,
        });
      }
    }
    const atkMiscPlay = (comp.play || {}).atkMisc || 0;
    const dmgMiscPlay = (comp.play || {}).dmgMisc || 0;
    (comp.play || {}).customAttacks?.forEach((ca, idx) => {
      // legacy fixed-value attacks: {label, atk, dice}
      if (ca.atkAbility === undefined && ca.atk !== undefined) {
        out.push({ label: ca.label, atk: (ca.atk || 0) + atkMiscPlay + buffAtk, dice: ca.dice || '',
                   bonusDice: ca.bonusDice || '', note: 'custom', customIdx: idx });
        return;
      }
      // dynamic attacks: recompute from the companion's live stats + play adjustments
      const count = Math.max(1, Math.min(8, parseInt(ca.count, 10) || 1));
      const abMod = (ca.atkAbility && ca.atkAbility !== 'none') ? mod(d.abilities[ca.atkAbility] || 10) : 0;
      const secondary = ca.type === 'secondary' ? -5 : 0;   // secondary natural attacks take −5 to hit
      const atk = (d.bab || 0) + abMod + sizeM + atkMiscPlay + (parseInt(ca.atkBonus, 10) || 0) + buffAtk + secondary;
      let dmgFlat = (parseInt(ca.dmgBonus, 10) || 0) + dmgMiscPlay + buffDmg;
      const mult = parseFloat(ca.dmgMult);
      if (mult) dmgFlat += Math.floor(strM * mult);
      const diceStr = (ca.dice || '') + (dmgFlat ? (dmgFlat > 0 ? '+' : '') + dmgFlat : '');
      for (let i = 0; i < count; i++) {
        out.push({ label: count > 1 ? `${ca.label} ${i + 1}` : ca.label, atk,
                   dice: diceStr, bonusDice: ca.bonusDice || '', note: 'custom', customIdx: idx });
      }
    });
    return out;
  }

  // ---------- feat prerequisites ----------
  const AB_FULL = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
  let _featIndex = null;
  function featIndex() {
    if (!_featIndex) {
      _featIndex = new Map();
      for (const f of PFDATA.feats) _featIndex.set(f.name.toLowerCase(), f);
    }
    return _featIndex;
  }
  let _abilIndex = null;
  function classAbilityIndex() {
    if (!_abilIndex) {
      _abilIndex = new Map();
      for (const a of (PFDATA.classAbilities || [])) _abilIndex.set(a.name.toLowerCase(), a);
    }
    return _abilIndex;
  }

  function casterLevelOf(c) {
    // approximate best caster level across classes (full/6-level: class level; 4-level: level-3)
    let best = 0;
    for (const [cls, lvl] of classLevels(c)) {
      const info = casterInfo(cls);
      if (!info) continue;
      const k = getClass(cls);
      const low = k && k.casting && k.casting.progression === 'low';
      const fourLevel = low || ['Paladin', 'Ranger'].includes(cls);
      best = Math.max(best, fourLevel ? Math.max(0, lvl - 3) : lvl);
    }
    return best;
  }

  function maxSpellLevel(c) {
    let best = 0;
    for (const [cls] of classLevels(c)) {
      const slots = spellSlots(c, cls);
      if (!slots) continue;
      for (const s of slots) if (s.total != null && s.total > 0) best = Math.max(best, s.lvl);
    }
    return best;
  }

  // parse one prerequisite clause -> {text, check(c) -> true|false|null}  (null = can't verify)
  // allowAbilities: also recognise a clause naming another class ability the
  // character must already possess (rage-power / talent / wild-talent chains).
  function parseClause(text, allowAbilities) {
    const t = text.trim().replace(/\.$/, '');
    if (!t) return null;
    const lower = t.toLowerCase();
    let m;
    // "Str 13" / "Dexterity 15"
    m = /^(str|dex|con|int|wis|cha)\w*\s+(\d+)\+?$/i.exec(t);
    if (m) {
      const ab = m[1].toLowerCase().slice(0, 3), v = parseInt(m[2], 10);
      return { text: t, check: c => abilityScore(c, AB_FULL[ab]) >= v };
    }
    // "base attack bonus +6"
    m = /^base attack bonus \+?(\d+)$/i.exec(t);
    if (m) { const v = parseInt(m[1], 10); return { text: t, check: c => totals(c).bab >= v }; }
    // "character level 7th"
    m = /^character level (\d+)/i.exec(t);
    if (m) { const v = parseInt(m[1], 10); return { text: t, check: c => c.levels.length >= v }; }
    // "caster level 5th"
    m = /^caster level (\d+)/i.exec(t);
    if (m) { const v = parseInt(m[1], 10); return { text: t, check: c => casterLevelOf(c) >= v }; }
    // "ability to cast 2nd-level spells"
    m = /^ability to cast (\d+)\w*-level spells/i.exec(t);
    if (m) { const v = parseInt(m[1], 10); return { text: t, check: c => maxSpellLevel(c) >= v }; }
    // "<Class> level 5th" (also "fighter level 8th", "Rogue (Unchained) level 10th")
    m = /^([A-Za-z ()]+?) level (\d+)/i.exec(t);
    if (m) {
      const clsName = m[1].trim(), v = parseInt(m[2], 10);
      const cls = PFDATA.classes.find(x => x.name.toLowerCase() === clsName.toLowerCase());
      if (cls) return { text: t, check: c => (classLevels(c).get(cls.name) || 0) >= v };
    }
    // "Acrobatics 5 ranks" / "Knowledge (arcana) 6 ranks"
    m = /^(.+?)\s+(\d+)\s+ranks?$/i.exec(t);
    if (m) {
      const skill = m[1].trim(), v = parseInt(m[2], 10);
      return { text: t, check: c => {
        for (const [name, r] of Object.entries(c.skills)) {
          if (name.toLowerCase() === skill.toLowerCase() && (parseInt(r, 10) || 0) >= v) return true;
        }
        return false;
      } };
    }
    // race requirement
    if (PFDATA.races.some(r => r.name.toLowerCase() === lower)) {
      return { text: t, check: c => (c.race || '').toLowerCase() === lower, kind: 'race' };
    }
    // another feat (exact name, or with parenthetical stripped)
    const fi = featIndex();
    const base = lower.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (fi.has(lower) || fi.has(base)) {
      const target = fi.has(lower) ? lower : base;
      return { text: t, kind: 'feat', featName: fi.get(target).name,
               check: c => c.feats.some(f => {
                 const fn = (f.name || f).toLowerCase();
                 return fn === lower || fn === target || fn.replace(/\s*\([^)]*\)\s*$/, '') === target;
               }) };
    }
    // another class ability the character must already have (talent/power chains)
    if (allowAbilities) {
      const ai = classAbilityIndex();
      // prereq prose says "greater X" but entries are named "X, Greater" — try that
      // reorder too, accepting only an exact hit against a real ability name.
      const reord = base.replace(/^(greater|improved|lesser|master)\s+(.+)$/, '$2, $1');
      const target = ai.has(lower) ? lower : ai.has(base) ? base : ai.has(reord) ? reord : null;
      if (target) {
        return { text: t, kind: 'classAbility', abilityName: ai.get(target).name,
                 check: c => (c.classAbilities || []).some(a => {
                   const an = (a.name || '').toLowerCase();
                   return an === lower || an === base || an === target ||
                          an.replace(/\s*\([^)]*\)\s*$/, '') === base;
                 }) };
      }
    }
    // unverifiable (class features, proficiencies, deity, mythic tiers…)
    return { text: t, check: () => null };
  }

  function featPrereqs(feat) {
    if (!feat) return [];   // callers may pass a missing/unselected entry
    if (feat.__pre !== undefined) return feat.__pre;
    const raw = (feat.prereq || '').trim();
    if (!raw) { feat.__pre = []; return feat.__pre; }
    // Class-ability entries carry a `classes` array; their prereqs may name other
    // class abilities. Feats have no `classes` field, so their parsing is unchanged.
    const allowAbilities = Array.isArray(feat.classes);
    const clauses = [];
    for (const part of raw.split(/[;,]/)) {
      if (!part.trim()) continue;
      // handle "X or Y" alternatives within a clause
      const alts = part.split(/\bor\b/i).map(s => parseClause(s, allowAbilities)).filter(Boolean);
      if (!alts.length) continue;
      if (alts.length === 1) clauses.push(alts[0]);
      else clauses.push({
        text: part.trim().replace(/\.$/, ''),
        kind: alts.find(a => a.kind === 'feat') ? 'feat' : undefined,
        featName: (alts.find(a => a.featName) || {}).featName,
        check: c => {
          let sawNull = false;
          for (const a of alts) {
            const r = a.check(c);
            if (r === true) return true;
            if (r === null) sawNull = true;
          }
          return sawNull ? null : false;
        },
      });
    }
    feat.__pre = clauses;
    return clauses;
  }

  // -> { status: 'met'|'unmet'|'unknown', clauses: [{text, status}] }
  function checkFeatPrereqs(c, feat) {
    const clauses = featPrereqs(feat);
    if (!clauses.length) return { status: 'met', clauses: [] };
    let unmet = false, unknown = false;
    const out = [];
    for (const cl of clauses) {
      let r = null;
      try { r = cl.check(c); } catch (e) { r = null; }
      const status = r === true ? 'met' : r === false ? 'unmet' : 'unknown';
      if (status === 'unmet') unmet = true;
      if (status === 'unknown') unknown = true;
      out.push({ text: cl.text, status });
    }
    return { status: unmet ? 'unmet' : (unknown ? 'unknown' : 'met'), clauses: out };
  }

  function featParents(feat) {
    // names of prerequisite feats (for tree grouping)
    return featPrereqs(feat).filter(cl => cl.kind === 'feat' && cl.featName).map(cl => cl.featName);
  }

  // ---------- money ----------
  function totalGold(c) {
    const m = c.money;
    return (m.pp || 0) * 10 + (m.gp || 0) + (m.sp || 0) / 10 + (m.cp || 0) / 100;
  }

  return {
    ABILITIES, ABILITY_NAMES, CASTERS, POINT_BUY_COST, SIZE_MOD, XP_TRACKS, XP_MAX_LEVEL,
    mod, newCharacter, racialMods, abilityScore, abilityMod, pointBuyCost,
    xpForLevel, levelForXp, xpProgress,
    classLevels, progRow, babValue, totals, iterAttacks, hitDie, hpBreakdown, hasFeat, featAllowance,
    classFeatures, parseArchetype, getArchetype, classFeatureHTML, archetypeFeatureHTML,
    racialTraits, getRacialTrait, limitedResources,
    MYTHIC_PATHS, getMythicPath, getMythicAbility, getMythicSpell, isMythic, mythicSurgeDie, mythicPowerUses, mythicUniversalFeatures,
    classSkillSet, isClassSkill, skillPointsBudget, skillPointsSpent, skillBonus, skillAbility,
    armorCheckPenalty, acBreakdown, saves, combatManeuvers, speed, speedBreakdown,
    magicWeapon, magicArmor, gearDisplayName, isRangedWeapon, isAmmo, gearIsAmmo,
    isFinesseWeapon, meleeAttackAbility, isThrownWeapon, isTwoHandedWeapon, strDamageMult, weaponAttack,
    carryCapacity, gearWeight, casterInfo, spellOnClassList, bonusSlots, spellSlots, spellsKnownRow, spellDC,
    specialistInfo, spellSchoolOf, preparedSummary, spellFocusBonus,
    totalGold, num,
    getClass, getClassAbility, getRace, getFeat, getSpell, getWeapon, getArmor, getItem,
    COMPANION_TYPES, newCompanion, companionAutoLevel, companionEffLevel, companionDerived,
    getCompSpecies, getFamiliarSpecies,
    getEvolution, evolutionPool, evolutionPrereqs, eidolonEvolutionEffects,
    CONDITIONS, newPlayState, hasPlayPenalties, stackTotal, effective, currentHP, rollDice,
    buffLibrary, invalidateCaches, spellToBuff, parseSpellChanges, parseChanges, featureChanges,
    featPrereqs, checkFeatPrereqs, featParents, casterLevelOf, maxSpellLevel,
    newCompanionPlay, companionAttacks,
  };
})();
