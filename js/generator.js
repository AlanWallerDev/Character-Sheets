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
    const ok = legalAlignments(picks.cls);
    return ALIGNS.filter(a => ok.includes(a.code)).map(a => ({
      value: a.code, label: a.label,
      weight: a.code.endsWith('E') ? 0.35 : 1,   // evil PCs are rare, not impossible
    }));
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
  function distributeSkills(c, themeId) {
    const theme = (G().skillThemes || []).find(t => t.id === themeId);
    if (!theme) return;
    let budget = PF.skillPointsBudget(c);
    const cap = c.levels.length;
    const seen = new Set(), themeOrder = [], spillOrder = [];
    const push = (arr, n) => { if (!seen.has(n)) { seen.add(n); arr.push(n); } };
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
  // Mirror the Feats tab's allowance math exactly (app.js tabFeats):
  // ceil(level/2) base + class "Bonus feat" features + racial bonus feat.
  function featAllowance(c) {
    let n = Math.max(0, Math.ceil(c.levels.length / 2));
    for (const grp of PF.classFeatures(c)) for (const f of grp.features)
      if (/^bonus feat/i.test(f.name)) n += f.levels.length;
    const race = PF.getRace(c.race);
    if (race && (race.traits || []).some(t => /bonus feat/i.test(t.name))) n += 1;
    return n;
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
    const cls = picks.cls;
    const info = PF.casterInfo(cls);
    if (!info) return;
    const slots = PF.spellSlots(c, cls);
    if (!slots) return;                       // no casting yet at this level
    const known = PF.spellsKnownRow(c, cls);  // per-level max for spontaneous; null = prepared
    const prof = (G().classProfiles || {})[cls] || {};
    const themes = (G().spellThemes || {})[prof.list] || [];
    const theme = themes.find(t => t.id === picks.spellTheme);
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
    const c = PF.newCharacter(picks.race + ' ' + picks.cls);
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
    c.levels = Array.from({ length: picks.level }, () => ({
      cls: picks.cls, archetypes: [], hp: null, fcb: 'hp',
    }));
    return c;
  }

  function buildCharacter(picks) {
    const c = baseCharacter(picks);
    if (picks.skillTheme) distributeSkills(c, picks.skillTheme);  // needs levels + abilities set
    if (picks.featBundle) applyFeats(c, picks);
    assignSpells(c, picks);                   // no-op for non-casters; themeless casters back-fill
    applyGear(c, picks);
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
      .gen-slider{display:flex;align-items:center;gap:8px;font-size:.9em;color:var(--muted,#999)}
      .gen-slider input{-webkit-appearance:none;appearance:none;width:140px;height:6px;border-radius:3px;
        background:rgba(255,255,255,.15);outline:none;cursor:pointer}
      .gen-slider input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;
        border-radius:50%;background:#f4df9a;border:2px solid #1a1410;box-shadow:0 0 3px rgba(0,0,0,.6)}
      .gen-slider input::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
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
    const filler = () => candidates[Math.floor(rng() * candidates.length)].label;
    const rows = [];
    const pre = Math.min(22, Math.max(12, candidates.length));
    for (let i = 0; i < pre; i++) rows.push(filler());
    rows.push(chosen.label);                       // lands on center row
    for (let i = 0; i < 4; i++) rows.push(filler()); // visible "almosts" below
    strip.innerHTML = rows.map((r, i) =>
      `<div${i === pre ? ' class="win"' : ''}>${r}</div>`).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    reelEl.classList.remove('done');
    // force reflow so the transition below actually animates
    void strip.offsetHeight;
    const target = (pre - 1) * ITEM_H;             // chosen row -> middle row
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
        Everything rolled is rules-legal.</p>
        <div class="gen-reels">
          ${reelHTML('level', 'Level')}${reelHTML('race', 'Race')}${reelHTML('class', 'Class')}${reelHTML('alignment', 'Alignment')}
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
      main.querySelector('#gen-result').innerHTML =
        `<b>${picks.race} ${picks.cls}</b>, level ${picks.level} — ${alignLabel}<br>
         <span class="small">${finals}</span>
         <span class="small muted">(incl. racial mods${incr ? ' & +' + incr + ' level increases' : ''} — seed ${picks.seed})</span><br>
         <span class="small">🎯 ${theme.label || ''}${topSkills ? ' — ' + topSkills + '…' : ''}</span><br>
         <span class="small">⚔ ${bundle.label || ''} (${c.feats.length} feats)${featList ? ' — ' + featList : ''}</span>${spellLine}<br>
         <span class="small">🎒 ${gearNames || 'no gear'} — ${c.money.gp} gp banked</span>`;
    }

    function spin() {
      const syn = parseInt(main.querySelector('#gen-syn').value, 10) / 100;
      const seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
      const rng = mulberry32(seed);
      picks = { seed };
      spinBtn.disabled = true;
      saveBtn.style.display = 'none';
      main.querySelector('#gen-result').innerHTML = '';

      // dependent reels spin in sequence… (a pinned level lands instantly)
      const lvlChoice = main.querySelector('#gen-level').value;
      const seq = [
        { id: 'level',     label: 'level',     cands: () => levelCandidates(),        set: v => picks.level = v },
        { id: 'race',      label: 'race',      cands: () => raceCandidates(),         set: v => picks.race = v },
        { id: 'class',     label: 'class',     cands: () => classCandidates(picks),   set: v => picks.cls = v },
        { id: 'alignment', label: 'alignment', cands: () => alignmentCandidates(picks), set: v => picks.alignment = v },
      ];
      if (lvlChoice !== 'roll') {
        picks.level = parseInt(lvlChoice, 10);
        landReel(reel('level'), 'Level ' + picks.level);
        seq.shift();
      }
      let i = 0;
      const next = () => {
        if (i < seq.length) {
          const st = seq[i++];
          status.textContent = 'Rolling ' + st.label + '…';
          const cands = st.cands();
          const chosen = weightedPick(rng, cands);
          spinReel(reel(st.id), cands, chosen, rng, () => { st.set(chosen.value); next(); });
        } else spinAbilities();
      };
      // …the six ability reels only depend on the class, so they run together
      const spinAbilities = () => {
        status.textContent = 'Rolling abilities…';
        picks.abilities = {};
        let landed = 0;
        ABILITIES.forEach((ab, idx) => {
          const cands = abilityCandidates(ab, picks.cls, syn);
          const chosen = weightedPick(rng, cands);
          setTimeout(() => spinReel(reel(ab), cands, chosen, rng, () => {
            picks.abilities[ab] = chosen.value;
            if (++landed === ABILITIES.length) spinSkillTheme();
          }, { duration: 0.85 }), idx * 140);
        });
      };
      const spinSkillTheme = () => {
        status.textContent = 'Rolling skill focus…';
        const cands = skillThemeCandidates(picks, syn);
        const chosen = weightedPick(rng, cands);
        spinReel(reel('skilltheme'), cands, chosen, rng, () => {
          picks.skillTheme = chosen.value;
          spinFeatBundle();
        }, { duration: 1.0 });
      };
      const spinFeatBundle = () => {
        status.textContent = 'Rolling feat path…';
        const cands = featBundleCandidates(picks, syn);
        const chosen = weightedPick(rng, cands);
        // silently pre-roll a backup path so high-level builds that drain the
        // primary chain stay deterministic from picks alone
        const rest = cands.filter(x => x.value !== chosen.value);
        picks.featBundle2 = rest.length ? weightedPick(rng, rest).value : null;
        spinReel(reel('featbundle'), cands, chosen, rng, () => {
          picks.featBundle = chosen.value;
          spinSpellTheme();
        }, { duration: 1.0 });
      };
      const spinSpellTheme = () => {
        const cands = spellPathCandidates(picks);
        if (!cands.length) {                  // non-caster (or themeless occult caster)
          picks.spellTheme = null;
          // "class list" only if this class actually gets spells (Ninja is in
          // the engine's caster table but has no spell list in the data)
          const castsAnything = !!PF.spellSlots(baseCharacter(picks), picks.cls);
          const strip = reel('spelltheme').querySelector('.gen-reel-strip');
          strip.style.transition = 'none'; strip.style.transform = 'translateY(0)';
          strip.innerHTML = '<div></div><div style="color:var(--muted,#888)">' +
            (castsAnything ? 'class list' : 'no spellcasting') + '</div><div></div>';
          finishSpin();
          return;
        }
        status.textContent = 'Rolling spell path…';
        const chosen = weightedPick(rng, cands);
        spinReel(reel('spelltheme'), cands, chosen, rng, () => {
          picks.spellTheme = chosen.value;
          finishSpin();
        }, { duration: 1.0 });
      };
      next();
    }

    spinBtn.addEventListener('click', spin);
    saveBtn.addEventListener('click', () => { if (picks) api.onSave(buildCharacter(picks)); });
    main.querySelector('#gen-cancel').addEventListener('click', api.onCancel);
  }

  window.PFGEN = { renderView, buildCharacter, legalAlignments, alignmentCandidates,
                   abilityCandidates, levelCandidates, raceCandidates, classCandidates,
                   skillThemeCandidates, distributeSkills, featBundleCandidates,
                   featAllowance, spellPathCandidates, assignSpells, applyGear,
                   mulberry32, weightedPick };
})();
