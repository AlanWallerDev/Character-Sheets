/* ============================================================================
 * js/generator.js — Random Character Generator (slot-machine reels)
 * ----------------------------------------------------------------------------
 * Phase 1: Level / Race / Class / Alignment / 6 Ability reels -> legal
 * single-class character -> Save to Vault. Weights come from PFGENDATA
 * (data/bundles.js); legality and character math come from the engine (PF).
 * A chaos<->synergy slider scales how strongly earlier picks bias later reels.
 * Later phases: archetypes, skill themes, feat/spell bundles, gear, multiclass.
 *
 * Contract with app.js: PFGEN.renderView(container, { onSave, onCancel }).
 * The view manages its own DOM during spins (no app re-renders mid-animation);
 * it only calls the api hooks, which save/navigate.
 * ============================================================================ */
(function () {
  'use strict';
  const G = () => window.PFGENDATA || {};
  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const AB_LABEL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  const ALIGNS = [
    { code: 'LG', label: 'Lawful Good' },   { code: 'NG', label: 'Neutral Good' }, { code: 'CG', label: 'Chaotic Good' },
    { code: 'LN', label: 'Lawful Neutral' },{ code: 'N',  label: 'Neutral' },      { code: 'CN', label: 'Chaotic Neutral' },
    { code: 'LE', label: 'Lawful Evil' },   { code: 'NE', label: 'Neutral Evil' }, { code: 'CE', label: 'Chaotic Evil' },
  ];

  // ---------- seedable RNG (Mulberry32) — lets a build be reproduced later ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedPick(rng, items) {   // items: [{value, label, weight}]
    let total = 0;
    for (const it of items) total += Math.max(0, it.weight || 0);
    if (total <= 0) return items[Math.floor(rng() * items.length)];
    let roll = rng() * total;
    for (const it of items) {
      roll -= Math.max(0, it.weight || 0);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  // ---------- wheel candidate builders (each sees the picks so far) ----------
  function levelCandidates() {
    const curve = G().levelCurve || [];
    return Array.from({ length: 20 }, (_, i) => ({
      value: i + 1, label: 'Level ' + (i + 1), weight: curve[i] || 1,
    }));
  }

  function raceCandidates() {
    const rar = G().raceRarity || { bucketWeight: {}, override: {} };
    return (PFDATA.races || []).map(r => {
      const bucket = (r.subtype || '').toLowerCase();
      let w = rar.bucketWeight[bucket];
      if (w === undefined) w = rar.bucketWeight[''] || 1;
      w *= (rar.override || {})[r.name] || 1;
      return { value: r.name, label: r.name, weight: w };
    }).filter(c => c.weight > 0);
  }

  function classCandidates(picks) {
    const profiles = G().classProfiles || {};
    const race = (PFDATA.races || []).find(r => r.name === picks.race);
    const flavor = ((G().raceClassFlavor || {})[picks.race]) || {};
    const out = [];
    for (const [name, prof] of Object.entries(profiles)) {
      if (!prof.roll) continue;
      if (!PFDATA.classes.some(k => k.name === name)) continue;
      let w = 1;
      // generic synergy: race boosts/dents the class's key ability
      const key = (prof.keys || [])[0];
      const mod = race && race.mods ? (race.mods[key] || 0) : 0;
      if (mod > 0) w *= 1.6;
      else if (mod < 0) w *= 0.6;
      if (race && race.flex) w *= 1.15;      // flexible races fit anything
      w *= flavor[name] || 1;                // iconic pairings
      out.push({ value: name, label: name, weight: w });
    }
    return out;
  }

  // Class alignment restrictions (free text in class data) -> the legal set.
  function legalAlignments(clsName) {
    const k = (PFDATA.classes || []).find(x => x.name === clsName);
    const t = ((k && k.alignment) || '').toLowerCase();
    let ok = ALIGNS.map(a => a.code);
    if (/lawful good\b/.test(t) && !/any/.test(t)) ok = ['LG'];            // Paladin
    else if (/any nonlawful/.test(t)) ok = ok.filter(c => c[0] !== 'L');   // Barbarian…
    else if (/any lawful/.test(t)) ok = ok.filter(c => c[0] === 'L');      // Monk…
    else if (/any neutral/.test(t)) ok = ok.filter(c => c.includes('N'));  // Druid…
    return ok;                              // "within one step of deity" etc. -> all 9
  }

  function alignmentCandidates(picks) {
    let ok = legalAlignments(picks.cls);
    if (picks.cls2) {                             // multiclass: legal for BOTH
      const ok2 = legalAlignments(picks.cls2);
      ok = ok.filter(a => ok2.includes(a));
    }
    return ALIGNS.filter(a => ok.includes(a.code)).map(a => ({
      value: a.code, label: a.label,
      weight: a.code.endsWith('E') ? 0.35 : 1,   // evil PCs are rare, not impossible
    }));
  }

  // Occasional multiclass (PFGENDATA.multiclass): the second class must share
  // at least one legal alignment with the first (Monk + Barbarian is
  // impossible) and is weighted toward classes riding the same ability scores.
  function class2Candidates(picks) {
    const profiles = G().classProfiles || {};
    const p1 = profiles[picks.cls] || {};
    const a1 = legalAlignments(picks.cls);
    const out = [];
    for (const [name, prof] of Object.entries(profiles)) {
      if (!prof.roll || name === picks.cls) continue;
      if (!PFDATA.classes.some(k => k.name === name)) continue;
      if (!legalAlignments(name).some(a => a1.includes(a))) continue;
      let w = 1;
      if ((prof.keys || []).some(k => (p1.keys || []).includes(k))) w *= 1.7;
      if (prof.role === p1.role) w *= 1.3;
      out.push({ value: name, label: name, weight: w });
    }
    return out;
  }

  // Ability reels: 7-19, a bell curve whose CENTER slides with the synergy
  // strength s (0..1). Each class gets the same fixed surplus budget (+10
  // points over the 10.5 dump baseline) SPLIT across its key abilities, so
  // MAD classes (Paladin: str/cha/con) spread the budget wide and flat while
  // SAD ones (Wizard: int/dex) stack it tall — expected stat TOTALS stay equal
  // for every class (~73.8 at s=1) regardless of key count. At s=0 all six
  // roll the same neutral bell around 12 (pure chaos).
  const KEY_SHARES = { 1: [1], 2: [.6, .4], 3: [.45, .33, .22], 4: [.38, .28, .2, .14] };
  const KEY_SURPLUS = 10;
  function abilityCandidates(ab, clsName, s) {
    const prof = (G().classProfiles || {})[clsName] || {};
    const keys = prof.keys || [];
    const shares = KEY_SHARES[keys.length] || KEY_SHARES[2];
    const ki = keys.indexOf(ab);
    const target = ki >= 0 ? 10.5 + KEY_SURPLUS * shares[ki] : 10.5;
    const center = 12 + (target - 12) * (s === undefined ? 0.7 : s);
    const out = [];
    for (let v = 7; v <= 19; v++) {
      const d = v - center;
      out.push({ value: v, label: String(v), weight: Math.exp(-(d * d) / (2 * 2.8 * 2.8)) });
    }
    return out;
  }

  // Skill-focus themes: every theme is always available; ones that fit the
  // class's role get weighted up with the synergy slider.
  function skillThemeCandidates(picks, s) {
    const prof = (G().classProfiles || {})[picks.cls] || {};
    const str = s === undefined ? 0.7 : s;
    return (G().skillThemes || []).map(t => ({
      value: t.id, label: t.label,
      weight: (t.fitRoles || []).includes(prof.role) ? 1 + 2 * str : 1,
    }));
  }

  // Spend the engine's exact budget (PF.skillPointsBudget) down the theme's
  // priority list — class skills first (the +3 makes them the better buy),
  // capped at level ranks each — then spill into common class skills.
  const SPILL_SKILLS = ['Perception', 'Stealth', 'Acrobatics', 'Diplomacy', 'Sense Motive',
    'Survival', 'Intimidate', 'Climb', 'Swim', 'Bluff', 'Ride', 'Heal', 'Spellcraft',
    'Use Magic Device', 'Disable Device', 'Escape Artist', 'Sleight of Hand',
    'Handle Animal', 'Knowledge (local)', 'Appraise', 'Linguistics', 'Fly', 'Disguise'];
  // Only races that actually HAVE a fly speed spend ranks on Fly — the tengu
  // playtest sheet burned 5 ranks it could never use
  const FLY_RACES = new Set(['Strix', 'Gathlain', 'Wyvaran', 'Syrinx']);
  function distributeSkills(c, themeId) {
    const theme = (G().skillThemes || []).find(t => t.id === themeId);
    if (!theme) return;
    let budget = PF.skillPointsBudget(c);
    const cap = c.levels.length;
    const seen = new Set(), themeOrder = [], spillOrder = [];
    const noFly = !FLY_RACES.has(c.race);
    const push = (arr, n) => { if (noFly && n === 'Fly') return; if (!seen.has(n)) { seen.add(n); arr.push(n); } };
    for (const n of theme.skills) if (PF.isClassSkill(c, n)) push(themeOrder, n);
    for (const n of theme.skills) push(themeOrder, n);
    for (const n of SPILL_SKILLS) if (PF.isClassSkill(c, n)) push(spillOrder, n);
    for (const n of SPILL_SKILLS) push(spillOrder, n);
    c.skills = {};
    // phase A — round-robin the theme's skills (priority order, class skills
    // first) so even a lean budget covers the whole package instead of the
    // first skill swallowing every point; earlier skills get the remainders
    while (budget > 0) {
      let placed = false;
      for (const n of themeOrder) {
        if (budget <= 0) break;
        const r = c.skills[n] || 0;
        if (r < cap) { c.skills[n] = r + 1; budget--; placed = true; }
      }
      if (!placed) break;                      // whole theme is at max ranks
    }
    // phase B — max-fill common class skills with whatever's left
    for (const n of spillOrder) {
      if (budget <= 0) break;
      const put = Math.min(cap, budget);
      c.skills[n] = put; budget -= put;
    }
  }

  // ---------- feat bundles ----------
  // Same allowance the Feats tab shows — both call PF.featAllowance so the
  // generator can't hand out more feats than the tab accepts.
  function featAllowance(c) {
    return PF.featAllowance(c).total;
  }

  function bundleEligible(b, picks) {
    const prof = (G().classProfiles || {})[picks.cls] || {};
    if ((b.minLevel || 1) > picks.level) return false;
    if (b.requiresCasting && !PF.casterInfo(picks.cls)) return false;
    if (!b.classes && !b.roles) return true;              // ungated (generalist)
    return (b.classes || []).includes(picks.cls) || (b.roles || []).includes(prof.role);
  }

  function featBundleCandidates(picks, s) {
    const str = s === undefined ? 0.7 : s;
    const c = baseCharacter(picks);                       // for final ability mods
    const out = [];
    for (const b of (G().featBundles || [])) {
      if (!bundleEligible(b, picks)) continue;
      let w = b.id === 'generalist' ? 0.6 : 1;            // themed bundles preferred
      if ((b.classes || []).includes(picks.cls)) w *= 1.6;
      for (const [ab, fv] of Object.entries(b.favors || {}))
        w *= Math.pow(1.15, str * fv * PF.abilityMod(c, ab));
      out.push({ value: b.id, label: b.label, weight: w });
    }
    return out;
  }

  // Walk a bundle's ordered chain, taking each feat whose prerequisites the
  // engine confirms (or can't verify — curated chains treat 'unknown' as met;
  // e.g. "Weapon Focus with chosen weapon" isn't machine-checkable). The
  // character is extended as we go so later links see earlier ones.
  function walkChain(c, bundle, slots) {
    let taken = 0;
    for (const name of bundle.feats) {
      if (taken >= slots) break;
      const feat = PF.getFeat(name);
      if (!feat || c.feats.some(f => f.name === name)) continue;
      if (PF.checkFeatPrereqs(c, feat).status === 'unmet') continue;
      c.feats.push({ name, note: bundle.label });
      taken++;
    }
    return taken;
  }

  function applyFeats(c, picks) {
    const all = G().featBundles || [];
    const byId = id => all.find(b => b.id === id);
    let slots = featAllowance(c);
    for (const id of [picks.featBundle, picks.featBundle2, 'generalist']) {
      if (slots <= 0) break;
      const b = id && byId(id);
      if (b) slots -= walkChain(c, b, slots);
    }
  }

  // ---------- spells ----------
  // Themes live under the profile's list hint (Sorcerer -> Wizard themes);
  // actual spell LEVELS come from the engine list (PF.casterInfo(cls).list) —
  // see the pipeline contract in data/bundles.js. Occult casters (Psychic…)
  // have no authored themes yet and fall through to pure back-fill.
  function spellPathCandidates(picks) {
    if (!PF.casterInfo(picks.cls)) return [];
    const prof = (G().classProfiles || {})[picks.cls] || {};
    const themes = (G().spellThemes || {})[prof.list] || [];
    return themes.map(t => ({ value: t.id, label: t.label, weight: 1 }));
  }

  function assignSpells(c, picks) {
    assignSpellsFor(c, picks.cls, picks.spellTheme);
    if (picks.cls2) assignSpellsFor(c, picks.cls2, null);  // secondary: back-fill only
  }

  function assignSpellsFor(c, cls, themeId) {
    const info = PF.casterInfo(cls);
    if (!info) return;
    const slots = PF.spellSlots(c, cls);
    if (!slots) return;                       // no casting yet at this level
    const known = PF.spellsKnownRow(c, cls);  // per-level max for spontaneous; null = prepared
    const prof = (G().classProfiles || {})[cls] || {};
    const themes = (G().spellThemes || {})[prof.list] || [];
    const theme = themes.find(t => t.id === themeId);
    // bucket the theme's flat list by each spell's ACTUAL level on this class's list
    const byLvl = {};
    for (const name of (theme ? theme.spells : [])) {
      const sp = PF.getSpell(name);
      const l = sp && sp.levels ? sp.levels[info.list] : null;
      if (l == null) continue;                // off-list name: skip per contract
      (byLvl[l] = byLvl[l] || []).push(name);
    }
    const backfillAt = l => PFDATA.spells
      .filter(s => s.levels && s.levels[info.list] === l).map(s => s.name);
    // levels come from the slot table; summoner-style casters know cantrips
    // without a slot row, so add level 0 when the known table says so
    const levels = slots.slice();
    if (known && known[0] != null && !levels.some(s => s.lvl === 0))
      levels.unshift({ lvl: 0, total: null });
    for (const s of levels) {
      const knownMax = known ? known[s.lvl] : null;
      const castable = (s.total != null && s.total > 0) || (knownMax != null && knownMax > 0);
      if (!castable) continue;
      // spontaneous: exactly the known count (the tab flags overshoot);
      // prepared: slots plus a little variety to prepare from
      const target = knownMax != null ? knownMax : (s.total || 0) + (s.lvl === 0 ? 2 : 1);
      const chosen = [];
      for (const n of (byLvl[s.lvl] || [])) { if (chosen.length >= target) break; if (!chosen.includes(n)) chosen.push(n); }
      for (const n of backfillAt(s.lvl))    { if (chosen.length >= target) break; if (!chosen.includes(n)) chosen.push(n); }
      // prepared casters: spread the day's slots across the picks (first gets remainder)
      let prepLeft = info.kind === 'prepared' && s.total ? s.total : 0;
      chosen.forEach((n, i) => {
        const per = prepLeft > 0 ? Math.ceil(prepLeft / (chosen.length - i)) : 0;
        c.spells.push({ name: n, cls, lvl: s.lvl, prepared: per || '' });
        prepLeft -= per;
      });
    }
  }

  // ---------- choice-driven class features ----------
  // Classes like Sorcerer and Ranger have features that ARE choices (bloodline,
  // favored enemy). The reels never rolled them, so generated sheets shipped
  // with empty classAbilities — playtest finding. Picks are deterministic per
  // seed (own RNG stream; reel determinism is untouched).
  const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment',
    'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
  const FE_TYPES = ['undead', 'humans', 'animals', 'magical beasts', 'giants',
    'aberrations', 'evil outsiders', 'dragons'];
  const TERRAINS = ['urban', 'forest', 'underground', 'mountain', 'swamp', 'plains'];
  // preferred sorcerer bloodlines per dominant spell school (filtered to data)
  const BLOODLINE_BY_SCHOOL = {
    necromancy: ['Undead Bloodline', 'Accursed Bloodline'],
    evocation: ['Elemental Bloodline', 'Stormborn Bloodline', 'Draconic Bloodline'],
    enchantment: ['Fey Bloodline', 'Serpentine Bloodline'],
    illusion: ['Fey Bloodline', 'Shadow Bloodline'],
    conjuration: ['Elemental Bloodline', 'Infernal Bloodline'],
    abjuration: ['Celestial Bloodline', 'Arcane Bloodline'],
    transmutation: ['Draconic Bloodline', 'Arcane Bloodline'],
    divination: ['Arcane Bloodline', 'Destined Bloodline'],
  };
  const STYLE_BY_KIT = {
    bow: 'Archery', crossbow: 'Crossbow', twoWeapon: 'Two-Weapon Combat',
    finesse: 'Two-Weapon Combat', 'sword-board': 'Weapon and Shield',
    twoHanded: 'Two-Handed Weapon', reach: 'Two-Handed Weapon', oneHand: 'Weapon and Shield',
  };

  const abilityExists = name => (PFDATA.classAbilities || []).some(a => a.name === name);
  const abilitiesMatching = (re, cls) => (PFDATA.classAbilities || [])
    .filter(a => re.test(a.name) && (!cls || (a.classes || []).includes(cls))).map(a => a.name);

  // dominant school of the rolled spell theme (falls back to the class's list)
  function themeDominantSchool(cls, themeId) {
    const prof = (G().classProfiles || {})[cls] || {};
    const theme = ((G().spellThemes || {})[prof.list] || []).find(t => t.id === themeId);
    const counts = {};
    for (const name of (theme ? theme.spells : [])) {
      const s = PF.spellSchoolOf(name);
      if (s) counts[s] = (counts[s] || 0) + 1;
    }
    let best = null;
    for (const [s, n] of Object.entries(counts)) if (!best || n > counts[best]) best = s;
    return best;                                   // lowercase or null
  }

  function assignClassChoices(c, picks, rng) {
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const add = (name, cls) => {
      if (!c.classAbilities.some(a => a.name === name && a.cls === cls))
        c.classAbilities.push({ name, cls });
    };
    for (const [cls, lvl] of PF.classLevels(c)) {
      const themeId = cls === picks.cls ? picks.spellTheme : null;
      const dom = themeDominantSchool(cls, themeId);
      if (cls === 'Wizard') {
        // specialist school = the theme's dominant school; opposition = the two
        // schools the theme casts LEAST (never the chosen school). The school
        // slot then flows into PF.spellSlots before spells are assigned.
        const school = dom ? dom.charAt(0).toUpperCase() + dom.slice(1) : pick(SCHOOLS);
        if (!abilityExists(school + ' School')) continue;      // data missing: stay universalist
        add(school + ' School', cls);
        const theme = ((G().spellThemes || {})[(G().classProfiles || {})[cls].list] || [])
          .find(t => t.id === themeId);
        const counts = {};
        for (const n of (theme ? theme.spells : [])) {
          const s = PF.spellSchoolOf(n);
          if (s) counts[s] = (counts[s] || 0) + 1;
        }
        const opps = SCHOOLS.filter(s => s !== school)
          .sort((a, b) => (counts[a.toLowerCase()] || 0) - (counts[b.toLowerCase()] || 0))
          .slice(0, 2);
        for (const o of opps) add(o + ' Opposition School', cls);
      } else if (cls === 'Sorcerer') {
        const prefs = (dom && BLOODLINE_BY_SCHOOL[dom] || []).filter(abilityExists);
        const all = abilitiesMatching(/ Bloodline$/, 'Sorcerer');
        if (prefs.length || all.length) add(prefs.length ? prefs[0] : pick(all), cls);
      } else if (cls === 'Bloodrager') {
        const all = abilitiesMatching(/ Bloodrager Bloodline$/, 'Bloodrager');
        if (all.length) add(pick(all), cls);
      } else if (cls === 'Cleric') {
        const al = c.alignment || 'N';
        const banned = new Set();
        if (al.includes('G')) banned.add('Evil Domain');
        if (al.includes('E')) banned.add('Good Domain');
        if (al[0] === 'L') banned.add('Chaos Domain');
        if (al[0] === 'C') banned.add('Law Domain');
        const domains = abilitiesMatching(/ Domain$/, 'Cleric').filter(d => !banned.has(d));
        for (let i = 0; i < 2 && domains.length; i++) {
          const d = pick(domains);
          add(d, cls); domains.splice(domains.indexOf(d), 1);
        }
      } else if (cls === 'Oracle') {
        const mys = abilitiesMatching(/ Mystery$/, 'Oracle');
        const cur = abilitiesMatching(/ Curse$/, 'Oracle');
        if (mys.length) add(pick(mys), cls);
        if (cur.length) add(pick(cur), cls);
      } else if (cls === 'Witch') {
        const pat = abilitiesMatching(/ Patron$/, 'Witch').filter(n => n !== "Witch's Patron");
        if (pat.length) add(pick(pat), cls);
      } else if (cls === 'Inquisitor') {
        const inq = abilitiesMatching(/ Inquisition$/, 'Inquisitor');
        if (inq.length) add(pick(inq), cls);
      } else if (cls === 'Shaman') {
        const sp = abilitiesMatching(/ Spirit$/, 'Shaman');
        if (sp.length) add(pick(sp), cls);
      } else if (cls === 'Ranger') {
        // choices aren't enumerated in data — synthesize readable entries
        const types = FE_TYPES.slice();
        const feCount = 1 + Math.floor(lvl / 5);
        for (let i = 0; i < feCount && types.length; i++) {
          const t = pick(types); types.splice(types.indexOf(t), 1);
          const bonus = i === 0 && lvl >= 5 ? 4 : 2;
          add(`Favored Enemy (${t} +${bonus})`, cls);
        }
        if (lvl >= 2) {
          const bundle = (G().featBundles || []).find(b => b.id === picks.featBundle);
          const kit = (bundle && bundle.weapon) || ((G().classProfiles || {})[cls] || {}).weapon;
          add(`Ranger Combat Style (${STYLE_BY_KIT[kit] || 'Archery'})`, cls);
        }
        if (lvl >= 3) add(`Favored Terrain (${pick(TERRAINS)})`, cls);
        if (lvl >= 4) add(`Hunter's Bond (companions)`, cls);
      }
    }
  }

  // Spell Focus-style feats carry a school choice the bundles never recorded —
  // append the character's dominant school to the note (playtest finding)
  function fixFocusNotes(c, picks) {
    const focusRe = /^(greater )?spell focus$/i;
    const needsFix = (c.feats || []).filter(f =>
      focusRe.test(String(f.name).trim()) &&
      !SCHOOLS.some(s => String(f.note || '').toLowerCase().includes(s.toLowerCase())));
    if (!needsFix.length) return;
    // a specialist's focus follows their school; otherwise the theme's dominant
    // school; otherwise whatever the sheet actually casts most
    let best = null;
    const spec = PF.specialistInfo(c, picks.cls);
    if (spec && spec.school) best = spec.school.toLowerCase();
    if (!best) best = themeDominantSchool(picks.cls, picks.spellTheme);
    if (!best) {
      const counts = {};
      for (const sp of (c.spells || [])) {
        const s = PF.spellSchoolOf(sp.name);
        if (s) counts[s] = (counts[s] || 0) + (sp.lvl >= 1 ? 2 : 1);
      }
      for (const [s, n] of Object.entries(counts)) if (!best || n > counts[best]) best = s;
    }
    if (!best) return;
    const school = best.charAt(0).toUpperCase() + best.slice(1);
    for (const f of needsFix) f.note = f.note ? f.note + ' — ' + school : school;
  }

  // After spells land, make a specialist's prep sheet legal: opposition-school
  // spells cost two slots, and the bonus school slot must hold a school spell.
  function reconcilePrepared(c) {
    for (const [cls] of PF.classLevels(c)) {
      const sum = PF.preparedSummary && PF.preparedSummary(c, cls);
      if (!sum) continue;
      const spec = PF.specialistInfo(c, cls);
      for (const lvlStr of Object.keys(sum)) {
        const lvl = +lvlStr, cap = sum[lvlStr].cap;
        const mine = () => c.spells.filter(s => s.cls === cls && s.lvl === lvl);
        const prep = s => parseInt(s.prepared, 10) || 0;
        const isOpp = s => !!(spec && spec.opposition.some(o => o.toLowerCase() === PF.spellSchoolOf(s.name)));
        const isSchool = s => !!(spec && spec.school && PF.spellSchoolOf(s.name) === spec.school.toLowerCase());
        const cost = () => mine().reduce((a, s) => a + prep(s) * (isOpp(s) ? 2 : 1), 0);
        // 1) over cap: peel preps, opposition (2-for-1) first, school spells last
        const peelOrder = [...mine().filter(isOpp), ...mine().filter(s => !isOpp(s) && !isSchool(s)), ...mine().filter(isSchool)];
        for (const s of peelOrder) while (cost() > cap && prep(s) > 0) s.prepared = prep(s) - 1;
        // 2) school slot in use but empty: shift one prep onto a school spell
        if (spec && spec.school && sum[lvlStr].school) {
          const schoolPrepped = () => mine().filter(isSchool).reduce((a, s) => a + prep(s), 0);
          if (cost() > cap - 1 && schoolPrepped() < 1) {
            let target = mine().find(isSchool);
            if (!target) {                     // pull one in from the class list
              const info = PF.casterInfo(cls);
              const cand = (PFDATA.spells || []).find(sp => sp.levels && sp.levels[info.list] === lvl &&
                PF.spellSchoolOf(sp.name) === spec.school.toLowerCase() &&
                !c.spells.some(m => m.cls === cls && m.name === sp.name));
              if (cand) { target = { name: cand.name, cls, lvl, prepared: 0 }; c.spells.push(target); }
            }
            const donor = mine().filter(s => !isSchool(s) && prep(s) > 0).sort((a, b) => prep(b) - prep(a))[0];
            if (target && donor) { donor.prepared = prep(donor) - 1; target.prepared = prep(target) + 1; }
            else if (donor) donor.prepared = prep(donor) - 1;   // no school spell exists: don't use the slot
          }
        }
      }
    }
  }

  // ---------- gear ----------
  const COIN_GP = { pp: 10, gp: 1, sp: 0.1, cp: 0.01 };
  function costGp(str) {
    const m = /([\d,]+(?:\.\d+)?)\s*(pp|gp|sp|cp)/i.exec(str || '');
    return m ? parseFloat(m[1].replace(/,/g, '')) * COIN_GP[m[2].toLowerCase()] : 0;
  }

  function applyGear(c, picks) {
    const prof = (G().classProfiles || {})[picks.cls] || {};
    const bundle = (G().featBundles || []).find(b => b.id === picks.featBundle);
    const kit = (G().gearKits || {})[(bundle && bundle.weapon) || prof.weapon || 'none']
             || (G().gearKits || {}).none || { weapons: [], misc: [] };
    let gold = (G().wealthByLevel || [])[picks.level - 1] || 150;
    const add = (entry, kind, equipped) => {          // mirrors the Gear tab's addGear
      const dup = c.gear.find(g => g.name === entry.name && g.kind === kind);
      if (dup) { dup.qty += 1; gold -= costGp(entry.cost); return; }
      c.gear.push({ name: entry.name, kind, qty: 1, equipped: !!equipped,
        weight: parseFloat(String(entry.weight || '').replace(/[^\d.]/g, '')) || 0,
        cost: entry.cost || '', note: '' });
      gold -= costGp(entry.cost);
    };
    // buy in phases so a level-1 budget covers the essentials: one primary
    // weapon, then armor, THEN backup weapons/shields — buying the whole
    // weapon list up front left L1 fighters in 145gp of two-handers and no
    // armor, while armor-first left L1 clerics weaponless (Chainmail = 150gp)
    let primaryBought = false;
    const backups = [];
    for (const name of kit.weapons) {
      const a = PF.getArmor(name);                   // shields wait for phase 3
      if (a) { backups.push(name); continue; }
      const w = PF.getWeapon(name);
      if (!w) continue;
      if (!primaryBought && costGp(w.cost) <= gold) { add(w, 'weapon', true); primaryBought = true; }
      else backups.push(name);
    }
    for (const name of (G().gearKits.armorByTier || {})[prof.defense] || []) {
      const a = PF.getArmor(name);
      if (a && costGp(a.cost) <= gold) { add(a, 'armor', true); break; }
    }
    for (const name of backups) {
      const a = PF.getArmor(name);                   // shields equip + grant AC
      if (a) { if (costGp(a.cost) <= gold) add(a, 'armor', true); continue; }
      const w = PF.getWeapon(name);
      if (w && costGp(w.cost) <= gold) add(w, 'weapon', false);
    }
    for (const name of kit.misc) {
      const it = PF.getItem(name) || PF.getWeapon(name);
      if (it && costGp(it.cost) <= gold) add(it, it.dmgS !== undefined ? 'weapon' : 'item');
    }
    // bank the rest (magic-item shopping is a later phase)
    c.money = { pp: 0, gp: Math.max(0, Math.floor(gold)), sp: 0, cp: 0 };
  }

  // ---------- build a real character object from the picks ----------
  // baseCharacter = identity/levels/abilities only (used for weighting later
  // reels); buildCharacter layers skills + feats on top. Both are pure.
  function baseCharacter(picks) {
    const c = PF.newCharacter(picks.race + ' ' + picks.cls + (picks.cls2 ? '/' + picks.cls2 : ''));
    const prof = (G().classProfiles || {})[picks.cls] || {};
    const race = (PFDATA.races || []).find(r => r.name === picks.race);
    const key = (prof.keys || ['str'])[0];
    c.race = picks.race;
    if (race && race.flex) c.flexChoice = key;
    c.alignment = picks.alignment || legalAlignments(picks.cls)[0] || 'N';
    if (picks.abilities) {
      c.abilityMethod = 'manual';           // rolled 7-19 isn't a point-buy spread
      for (const ab of ABILITIES) c.abilities[ab] = picks.abilities[ab] || 10;
    }
    c.levelIncreases[key] = Math.floor(picks.level / 4);  // L4/8/12/16/20 -> key ability
    c.favoredClass = picks.cls;
    c.hpMode = 'avg';
    // multiclass split: secondary gets 1..half the levels, primary the rest;
    // FCB (+1 hp) only on favored-class (primary) levels per RAW
    const lv2 = picks.cls2 ? Math.min(Math.max(1, picks.levels2 || 1), picks.level - 1) : 0;
    c.levels = [
      ...Array.from({ length: picks.level - lv2 }, () => ({ cls: picks.cls, archetypes: [], hp: null, fcb: 'hp' })),
      ...Array.from({ length: lv2 }, () => ({ cls: picks.cls2, archetypes: [], hp: null, fcb: '' })),
    ];
    return c;
  }

  function buildCharacter(picks) {
    const c = baseCharacter(picks);
    // separate RNG stream for build-time choices: reels stay seed+locks
    // deterministic, and so do these picks
    const crng = mulberry32(((picks.seed >>> 0) ^ 0x9E3779B9) >>> 0);
    if (picks.skillTheme) distributeSkills(c, picks.skillTheme);  // needs levels + abilities set
    if (picks.featBundle) applyFeats(c, picks);
    assignClassChoices(c, picks, crng);       // BEFORE spells: the wizard school slot feeds spellSlots
    assignSpells(c, picks);                   // no-op for non-casters; themeless casters back-fill
    reconcilePrepared(c);                     // opposition ×2 cost / school-slot legality
    fixFocusNotes(c, picks);                  // record the school choice on Spell Focus-style feats
    applyGear(c, picks);
    c.xp = PF.xpForLevel(c.levels.length, c.xpTrack || 'medium');   // track minimum for this level
    c.notes = 'Rolled by the Random Character Generator (seed ' + picks.seed + ').';
    return c;
  }

  // ---------- reel UI ----------
  const ITEM_H = 34;          // px per reel row
  const VISIBLE = 3;          // rows in the window (result lands center row)

  function injectCss() {
    if (document.getElementById('pfgen-css')) return;
    const st = document.createElement('style');
    st.id = 'pfgen-css';
    st.textContent = `
      .gen-reels{display:flex;gap:14px;flex-wrap:wrap;margin:14px 0}
      .gen-reel{min-width:170px;flex:1}
      .gen-reel-sm{min-width:86px;flex:0 1 96px}
      .gen-reel-label{font-size:.85em;color:var(--muted,#999);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
      .gen-reel-window{height:${ITEM_H * VISIBLE}px;overflow:hidden;border:1px solid var(--border,#444);border-radius:8px;position:relative;background:rgba(0,0,0,.25)}
      .gen-reel-window::before,.gen-reel-window::after{content:'';position:absolute;left:0;right:0;height:${ITEM_H}px;pointer-events:none;z-index:1}
      .gen-reel-window::before{top:0;background:linear-gradient(rgba(0,0,0,.55),transparent)}
      .gen-reel-window::after{bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.55))}
      .gen-reel-strip{will-change:transform}
      .gen-reel-strip div{height:${ITEM_H}px;line-height:${ITEM_H}px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
      .gen-reel.done .gen-reel-window{border-color:var(--accent,#c9a227)}
      .gen-reel.done .gen-reel-strip div.win{color:var(--accent,#c9a227);font-weight:bold}
      .gen-reel.done .gen-reel-strip div:not(.win){opacity:.45}
      .gen-reel.done{cursor:pointer}
      .gen-reel.locked .gen-reel-window{border-color:#7ec4e8;box-shadow:0 0 6px rgba(126,196,232,.35)}
      .gen-reel.locked .gen-reel-label::after{content:' 🔒'}
      .gen-slider{display:flex;align-items:center;gap:8px;font-size:.9em;color:var(--muted,#999)}
      .gen-slider input[type=range]{-webkit-appearance:none;appearance:none;width:140px;height:6px;border-radius:3px;
        background:rgba(255,255,255,.15);outline:none;cursor:pointer}
      .gen-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;
        border-radius:50%;background:#f4df9a;border:2px solid #1a1410;box-shadow:0 0 3px rgba(0,0,0,.6)}
      .gen-slider input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
        background:#f4df9a;border:2px solid #1a1410;box-shadow:0 0 3px rgba(0,0,0,.6)}
    `;
    document.head.appendChild(st);
  }

  // Fill a reel strip with filler rows, the chosen label, then MORE fillers
  // below it, and animate so the chosen row stops on the center line — the
  // trailing rows keep the reel looking like it stopped mid-list rather than
  // running out of options. Calls done() after landing.
  function spinReel(reelEl, candidates, chosen, rng, done, opts) {
    const dur = (opts && opts.duration) || 1.25;
    const strip = reelEl.querySelector('.gen-reel-strip');
    // fillers never repeat the winner (a duplicate right next to the landing
    // row gives the game away) and avoid back-to-back duplicates of each other
    const pool = candidates.filter(x => x.value !== chosen.value);
    let prev = null;
    const filler = () => {
      if (!pool.length) return '·';                // single-option reel
      let pick, guard = 0;
      do { pick = pool[Math.floor(rng() * pool.length)].label; }
      while (pick === prev && pool.length > 1 && ++guard < 8);
      prev = pick;
      return pick;
    };
    const rows = [];
    const pre = Math.min(22, Math.max(12, candidates.length));
    for (let i = 0; i < pre; i++) rows.push(filler());
    rows.push(chosen.label);                       // lands on center row
    prev = chosen.label;                           // trailing rows differ from it too
    for (let i = 0; i < 4; i++) rows.push(filler()); // visible "almosts" below
    strip.innerHTML = rows.map((r, i) =>
      `<div${i === pre ? ' class="win"' : ''}>${r}</div>`).join('');
    const target = (pre - 1) * ITEM_H;             // chosen row -> middle row
    // prefers-reduced-motion: land instantly (a short tick keeps the reel
    // sequencing readable without any animation)
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(-' + target + 'px)';
      reelEl.classList.add('done');
      setTimeout(done, 60);
      return;
    }
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    reelEl.classList.remove('done');
    // force reflow so the transition below actually animates
    void strip.offsetHeight;
    strip.style.transition = 'transform ' + dur + 's cubic-bezier(.15,.85,.25,1)';
    strip.style.transform = 'translateY(-' + target + 'px)';
    let fired = false;
    const finish = () => {
      if (fired) return; fired = true;
      // snap to the final position — guarantees the winner is centered even
      // if the transition never ran (throttled tab, reduced-motion browsers)
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(-' + target + 'px)';
      reelEl.classList.add('done');
      done();
    };
    strip.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, dur * 1000 + 300);          // safety net
  }

  // Land a reel on a fixed result instantly (no spin) — used when the user
  // pins a value (e.g. picks the level) instead of rolling it.
  function landReel(reelEl, label) {
    const strip = reelEl.querySelector('.gen-reel-strip');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    strip.innerHTML = `<div></div><div class="win">${label}</div><div></div>`;
    reelEl.classList.add('done');
  }

  // ---------- the view ----------
  function renderView(main, api) {
    injectCss();
    const reelHTML = (id, label, small) => `
      <div class="gen-reel${small ? ' gen-reel-sm' : ''}" data-reel="${id}">
        <div class="gen-reel-label">${label}</div>
        <div class="gen-reel-window"><div class="gen-reel-strip"><div></div><div style="color:var(--muted,#888)">—</div><div></div></div></div>
      </div>`;
    main.innerHTML = `<h2>🎲 Random Character</h2>
      <div class="panel">
        <p class="small muted">Spin the reels — each result weights the next
        (your race nudges your class, your class shapes your ability scores).
        Everything rolled is rules-legal. After a spin, click a reel to
        🔒 lock it — Spin Again re-rolls only the unlocked reels.</p>
        <div class="gen-reels">
          ${reelHTML('level', 'Level')}${reelHTML('race', 'Race')}${reelHTML('class', 'Class')}${reelHTML('class2', '2nd Class')}${reelHTML('alignment', 'Alignment')}
        </div>
        <div class="gen-reels">
          ${ABILITIES.map(ab => reelHTML(ab, AB_LABEL[ab], true)).join('')}
        </div>
        <div class="gen-reels">
          ${reelHTML('skilltheme', 'Skill Focus')}${reelHTML('featbundle', 'Feat Path')}${reelHTML('spelltheme', 'Spell Path')}
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <button class="primary" id="gen-spin">🎰 Spin</button>
          <button id="gen-save" style="display:none">💾 Save to Vault</button>
          <button id="gen-cancel">← Back</button>
          <label class="gen-slider">Level
            <select id="gen-level" title="Roll the level on the reel, or pin it">
              <option value="roll">🎲 Roll</option>
              ${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
            </select>
          </label>
          <label class="gen-slider">Seed
            <input id="gen-seed" placeholder="random" style="width:130px"
              title="Enter a seed to reproduce a spin (same seed + same locks = same character)">
          </label>
          <span class="gen-slider">🎲 Chaos
            <input type="range" id="gen-syn" min="0" max="100" value="70" title="How strongly your class steers your ability scores">
          ⚙ Synergy</span>
          <span class="small muted" id="gen-status"></span>
        </div>
        <div id="gen-result" style="margin-top:12px"></div>
      </div>`;

    const reel = name => main.querySelector(`[data-reel="${name}"]`);
    const status = main.querySelector('#gen-status');
    const saveBtn = main.querySelector('#gen-save');
    const spinBtn = main.querySelector('#gen-spin');
    let picks = null;
    let spinning = false;
    const locks = {};                        // reelId -> pinned value, kept across spins

    // click a landed reel to lock/unlock it for the next spin
    const lockableValue = id => {
      if (!picks) return undefined;
      if (id === 'level') return picks.level;
      if (id === 'race') return picks.race;
      if (id === 'class') return picks.cls;
      if (id === 'alignment') return picks.alignment;
      if (id === 'skilltheme') return picks.skillTheme;
      if (id === 'featbundle') return picks.featBundle;
      if (id === 'spelltheme') return picks.spellTheme;
      if (ABILITIES.includes(id)) return (picks.abilities || {})[id];
      return undefined;                      // class2 is derived, not lockable
    };
    main.querySelectorAll('.gen-reel').forEach(el => el.addEventListener('click', () => {
      if (spinning || !el.classList.contains('done')) return;
      const id = el.dataset.reel;
      if (locks[id] !== undefined) { delete locks[id]; el.classList.remove('locked'); return; }
      const val = lockableValue(id);
      if (val === undefined || val === null) return;
      locks[id] = val; el.classList.add('locked');
    }));

    // paint the slider's filled portion so its edge sits exactly at the THUMB
    // CENTER: the thumb travels [thumb/2 .. width-thumb/2], not the full track,
    // so a plain value% gradient drifts away from the circle mid-range. Pinning
    // the boundary to the thumb's real position keeps bar and circle glued; at
    // the extremes the opaque circle hides the residual sliver on its far side.
    const synEl = main.querySelector('#gen-syn');
    const THUMB = 18;                                   // 14px + 2px border each side
    const paintSlider = () => {
      const w = synEl.clientWidth || 140;
      const px = THUMB / 2 + (synEl.value / 100) * (w - THUMB);
      synEl.style.background =
        `linear-gradient(90deg, var(--accent,#c9a227) ${px}px, rgba(255,255,255,.15) ${px}px)`;
    };
    synEl.addEventListener('input', paintSlider);
    paintSlider();

    function finishSpin() {
      status.textContent = '';
      spinBtn.disabled = false;
      spinBtn.textContent = '🎰 Spin Again';
      saveBtn.style.display = '';
      // once a result exists, saving is the payoff action — promote it
      saveBtn.classList.add('primary');
      spinBtn.classList.remove('primary');
      const c = buildCharacter(picks);           // preview copy for final math
      const finals = ABILITIES.map(ab =>
        `${AB_LABEL[ab]} <b>${PF.abilityScore(c, ab)}</b>`).join(' · ');
      const alignLabel = (ALIGNS.find(a => a.code === picks.alignment) || {}).label || picks.alignment;
      const theme = ((G().skillThemes || []).find(t => t.id === picks.skillTheme) || {});
      const topSkills = Object.entries(c.skills)
        .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, r]) => `${n} ${r}`).join(', ');
      const incr = Math.floor(picks.level / 4);
      const featList = c.feats.map(f => f.name).join(', ');
      const bundle = ((G().featBundles || []).find(b => b.id === picks.featBundle) || {});
      const prof = (G().classProfiles || {})[picks.cls] || {};
      const spTheme = (((G().spellThemes || {})[prof.list] || []).find(t => t.id === picks.spellTheme) || {});
      const spellLine = c.spells.length
        ? `<br><span class="small">✨ ${spTheme.label || 'Class list'} — ${c.spells.length} spells (L0–${Math.max(...c.spells.map(s => s.lvl))})</span>` : '';
      const gearNames = c.gear.map(g => g.name + (g.qty > 1 ? ' ×' + g.qty : '')).join(', ');
      const clsLine = picks.cls2
        ? `${picks.cls} ${picks.level - picks.levels2} / ${picks.cls2} ${picks.levels2}`
        : picks.cls;
      main.querySelector('#gen-result').innerHTML =
        `<b>${picks.race} ${clsLine}</b>, level ${picks.level} — ${alignLabel}<br>
         <span class="small">${finals}</span>
         <span class="small muted">(incl. racial mods${incr ? ' & +' + incr + ' level increases' : ''} — seed ${picks.seed})</span><br>
         <span class="small">🎯 ${theme.label || ''}${topSkills ? ' — ' + topSkills + '…' : ''}</span><br>
         <span class="small">⚔ ${bundle.label || ''} (${c.feats.length} feats)${featList ? ' — ' + featList : ''}</span>${spellLine}<br>
         <span class="small">🎒 ${gearNames || 'no gear'} — ${c.money.gp} gp banked</span>`;
    }

    // park a reel on a muted informational label (no gold win styling)
    const idleReel = (id, label) => {
      const el = reel(id);
      el.classList.remove('done');
      const strip = el.querySelector('.gen-reel-strip');
      strip.style.transition = 'none'; strip.style.transform = 'translateY(0)';
      strip.innerHTML = `<div></div><div style="color:var(--muted,#888)">${label}</div><div></div>`;
    };

    function spin() {
      const syn = parseInt(main.querySelector('#gen-syn').value, 10) / 100;
      const seedRaw = main.querySelector('#gen-seed').value.trim();
      const seed = seedRaw !== '' && !isNaN(parseInt(seedRaw, 10))
        ? (parseInt(seedRaw, 10) >>> 0)
        : (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
      const rng = mulberry32(seed);
      picks = { seed };
      spinning = true;
      spinBtn.disabled = true;
      spinBtn.classList.add('primary');
      saveBtn.classList.remove('primary');
      saveBtn.style.display = 'none';
      main.querySelector('#gen-result').innerHTML = '';

      // one reel step: honor a lock while its value is still legal, else spin.
      // Locked steps consume no rng, so the same seed + same locks reproduce.
      const runStep = (id, label, cands, set, dur, then) => {
        if (locks[id] !== undefined) {
          const hit = cands.find(x => x.value === locks[id]);
          if (hit) { set(hit.value); landReel(reel(id), hit.label); then(); return; }
          delete locks[id]; reel(id).classList.remove('locked');  // now illegal — re-roll
        }
        status.textContent = 'Rolling ' + label + '…';
        const chosen = weightedPick(rng, cands);
        spinReel(reel(id), cands, chosen, rng, () => { set(chosen.value); then(); }, { duration: dur });
      };

      const lvlChoice = main.querySelector('#gen-level').value;
      const stepLevel = () => {
        if (lvlChoice !== 'roll') {
          picks.level = parseInt(lvlChoice, 10);
          landReel(reel('level'), 'Level ' + picks.level);
          return stepRace();
        }
        runStep('level', 'level', levelCandidates(), v => picks.level = v, 1.25, stepRace);
      };
      const stepRace = () => runStep('race', 'race', raceCandidates(), v => picks.race = v, 1.25, stepClass);
      const stepClass = () => runStep('class', 'class', classCandidates(picks), v => picks.cls = v, 1.25, stepClass2);
      // small-chance multiclass — derived fresh each spin, not lockable
      const stepClass2 = () => {
        const mc = G().multiclass || {};
        picks.cls2 = null; picks.levels2 = 0;
        const cands = class2Candidates(picks);
        const wants = picks.level >= (mc.minLevel || 4) && rng() < (mc.chance || 0) && cands.length;
        if (!wants) { idleReel('class2', 'single class'); return stepAlignment(); }
        status.textContent = 'Rolling second class…';
        const chosen = weightedPick(rng, cands);
        const lv2 = 1 + Math.floor(rng() * Math.floor(picks.level / 2));  // 1..half
        spinReel(reel('class2'), cands, chosen, rng, () => {
          picks.cls2 = chosen.value; picks.levels2 = lv2;
          const winEl = reel('class2').querySelector('.win');
          if (winEl) winEl.textContent = chosen.label + ' ' + lv2;        // show the split
          stepAlignment();
        }, { duration: 1.0 });
      };
      const stepAlignment = () => runStep('alignment', 'alignment', alignmentCandidates(picks), v => picks.alignment = v, 1.25, spinAbilities);

      // …the six ability reels only depend on the class, so they run together
      const spinAbilities = () => {
        status.textContent = 'Rolling abilities…';
        picks.abilities = {};
        let landed = 0;
        const oneDone = () => { if (++landed === ABILITIES.length) stepSkillTheme(); };
        ABILITIES.forEach((ab, idx) => {
          if (locks[ab] !== undefined) {
            picks.abilities[ab] = locks[ab];
            landReel(reel(ab), String(locks[ab]));
            oneDone(); return;
          }
          const cands = abilityCandidates(ab, picks.cls, syn);
          const chosen = weightedPick(rng, cands);
          setTimeout(() => spinReel(reel(ab), cands, chosen, rng, () => {
            picks.abilities[ab] = chosen.value;
            oneDone();
          }, { duration: 0.85 }), idx * 140);
        });
      };
      const stepSkillTheme = () => runStep('skilltheme', 'skill focus',
        skillThemeCandidates(picks, syn), v => picks.skillTheme = v, 1.0, stepFeatBundle);
      const stepFeatBundle = () => {
        const cands = featBundleCandidates(picks, syn);
        // silently pre-roll a backup path so high-level builds that drain the
        // primary chain stay deterministic from picks alone
        const withBackup = primary => {
          const rest = cands.filter(x => x.value !== primary);
          picks.featBundle2 = rest.length ? weightedPick(rng, rest).value : null;
        };
        if (locks.featbundle !== undefined) {
          const hit = cands.find(x => x.value === locks.featbundle);
          if (hit) { picks.featBundle = hit.value; withBackup(hit.value);
                     landReel(reel('featbundle'), hit.label); return stepSpellTheme(); }
          delete locks.featbundle; reel('featbundle').classList.remove('locked');
        }
        status.textContent = 'Rolling feat path…';
        const chosen = weightedPick(rng, cands);
        withBackup(chosen.value);
        spinReel(reel('featbundle'), cands, chosen, rng, () => {
          picks.featBundle = chosen.value; stepSpellTheme();
        }, { duration: 1.0 });
      };
      const stepSpellTheme = () => {
        const cands = spellPathCandidates(picks);
        if (!cands.length) {                  // non-caster (or themeless occult caster)
          picks.spellTheme = null;
          // "class list" only if a class actually gets spells (Ninja is in
          // the engine's caster table but has no spell list in the data)
          const bc = baseCharacter(picks);
          const castsAnything = !!PF.spellSlots(bc, picks.cls) ||
            (picks.cls2 && !!PF.spellSlots(bc, picks.cls2));
          idleReel('spelltheme', castsAnything ? 'class list' : 'no spellcasting');
          return endSpin();
        }
        runStep('spelltheme', 'spell path', cands, v => picks.spellTheme = v, 1.0, endSpin);
      };
      const endSpin = () => { spinning = false; finishSpin(); };

      stepLevel();
    }

    spinBtn.addEventListener('click', spin);
    saveBtn.addEventListener('click', () => { if (picks) api.onSave(buildCharacter(picks)); });
    main.querySelector('#gen-cancel').addEventListener('click', api.onCancel);
  }

  window.PFGEN = { renderView, buildCharacter, legalAlignments, alignmentCandidates,
                   abilityCandidates, levelCandidates, raceCandidates, classCandidates,
                   class2Candidates, skillThemeCandidates, distributeSkills,
                   featBundleCandidates, featAllowance, spellPathCandidates,
                   assignSpells, applyGear, mulberry32, weightedPick };
})();
