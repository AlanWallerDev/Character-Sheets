#!/usr/bin/env node
/* Engine & generator test harness — run with:  node tests/run-tests.js
 *
 * Loads the REAL compiled data files plus js/engine.js and js/generator.js in
 * a vm sandbox (window shim, no browser), then asserts rules-math invariants.
 * Pure engine functions only — nothing here touches the DOM modules.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'data/skills.js', 'data/races.js', 'data/racialtraits.js', 'data/classes.js',
  'data/archetypes.js', 'data/classabilities.js', 'data/mythicabilities.js',
  'data/mythicpaths.js', 'data/mythicspells.js', 'data/feats.js', 'data/spells.js',
  'data/weapons.js', 'data/armors.js', 'data/items.js', 'data/traits.js',
  'data/companions.js', 'data/evolutions.js', 'data/buffs.js', 'data/bundles.js',
  'js/engine.js', 'js/generator.js',
];

const sandbox = { console };
sandbox.window = sandbox;      // scripts use both `window.X` and bare `X`
vm.createContext(sandbox);
const src = files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')
  + '\n;window.__PF = PF;';    // PF is a top-level const, not a window property
vm.runInContext(src, sandbox, { filename: 'app-bundle.js' });

const PF = sandbox.__PF;
const PFDATA = sandbox.PFDATA;
const PFGEN = sandbox.PFGEN;
const GEN = sandbox.PFGENDATA || {};

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('  FAIL  ' + name + (detail !== undefined ? '  (got: ' + JSON.stringify(detail) + ')' : ''));
}

// ---------------- pure math ----------------
check('mod(10) = 0', PF.mod(10) === 0);
check('mod(7) = -2', PF.mod(7) === -2);
check('mod(18) = +4', PF.mod(18) === 4);
check('iterAttacks(16) = 16/11/6/1', JSON.stringify(PF.iterAttacks(16)) === '[16,11,6,1]', PF.iterAttacks(16));
check('iterAttacks(0) = single attack', JSON.stringify(PF.iterAttacks(0)) === '[0]', PF.iterAttacks(0));
check('bonusSlots(mod +5, spell lvl 1) = 2', PF.bonusSlots(5, 1) === 2, PF.bonusSlots(5, 1));
check('bonusSlots(mod +1, spell lvl 2) = 0 (mod < level)', PF.bonusSlots(1, 2) === 0);
check('point buy: all 10s costs 0', PF.pointBuyCost(PF.newCharacter('')) === 0);

// typed-bonus stacking
check('same-type bonuses take the best', PF.stackTotal([{ type: 'enhancement', value: 2 }, { type: 'enhancement', value: 4 }]) === 4);
check('dodge bonuses stack', PF.stackTotal([{ type: 'dodge', value: 1 }, { type: 'dodge', value: 1 }]) === 2);
check('typed penalty tracked separately from bonus', PF.stackTotal([{ type: 'morale', value: 2 }, { type: 'morale', value: -2 }]) === 0);

// ---------------- a real fighter from real data ----------------
const c = PF.newCharacter('Test Fighter');
c.race = 'Human'; c.flexChoice = 'str';
c.abilities = { str: 15, dex: 14, con: 14, int: 10, wis: 10, cha: 8 };
for (let i = 0; i < 5; i++) c.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });

check('human flexible +2 applied to Str', PF.abilityScore(c, 'str') === 17, PF.abilityScore(c, 'str'));
check('fighter 5 BAB = +5', PF.totals(c).bab === 5, PF.totals(c).bab);
check('fighter 5 avg HP = 10+2 + 4×(6+2)', PF.hpBreakdown(c).total === 44, PF.hpBreakdown(c).total);
const fa = PF.featAllowance(c);
check('feat allowance parts sum to total', fa.total === fa.base + fa.classBonus + fa.racial, fa);
check('feat allowance base = ceil(5/2)', fa.base === 3, fa.base);
check('human racial bonus feat detected', fa.racial === 1, fa.racial);
check('fighter bonus feats detected (levels 1,2,4)', fa.classBonus >= 3, fa.classBonus);

const pa = PF.getFeat('Power Attack');
check('Power Attack exists in data', !!pa);
check('Power Attack prereqs met (Str 17, BAB +5)', PF.checkFeatPrereqs(c, pa).status === 'met', PF.checkFeatPrereqs(c, pa));
const weak = PF.newCharacter('Weak Wizard');
weak.levels.push({ cls: 'Wizard', archetypes: [], hp: null, fcb: '' });
check('Power Attack prereqs unmet for Str 10 wizard', PF.checkFeatPrereqs(weak, pa).status === 'unmet');

// null/missing entries must not throw — the picker checks prereqs before any
// row is selected, and app.js checks feats the data set doesn't contain
check('featPrereqs(null) returns []', Array.isArray(PF.featPrereqs(null)) && PF.featPrereqs(null).length === 0);
check('featPrereqs(undefined) returns []', Array.isArray(PF.featPrereqs(undefined)) && PF.featPrereqs(undefined).length === 0);
check('checkFeatPrereqs with null feat is met, no throw', PF.checkFeatPrereqs(c, null).status === 'met');

// shared weapon attack line
c.gear.push({ name: 'Longsword', kind: 'weapon', qty: 1, equipped: true, weight: 4 });
const wa = PF.weaponAttack(c, c.gear[0]);
check('longsword to-hit = BAB +5, Str +3', wa.mods[0] === 8, wa.mods);
check('longsword rollable damage = 1d8+3', wa.dice === '1d8+3', wa.dice);
const wamw = PF.weaponAttack(c, Object.assign({}, c.gear[0], { mw: true }));
check('masterwork adds +1 to hit, not damage', wamw.mods[0] === 9 && wamw.dice === '1d8+3', wamw);

// speed: medium armor slows a 30-ft race; dwarves are never slowed
c.gear.push({ name: 'Breastplate', kind: 'armor', equipped: true, weight: 30 });
check('medium armor slows 30 ft to 20 ft', PF.speed(c) === 20, PF.speed(c));
const sb = PF.speedBreakdown(c);
check('speedBreakdown total matches speed()', sb.total === PF.speed(c), sb);
check('speedBreakdown names armor as the reason', sb.reasons.includes('armor'), sb.reasons);
const dw = PF.newCharacter('Dwarf');
dw.race = 'Dwarf';
dw.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
dw.gear.push({ name: 'Breastplate', kind: 'armor', equipped: true, weight: 30 });
check('dwarf slow-and-steady ignores armor', PF.speed(dw) === 20, PF.speed(dw));

// skill bonus composition (class skill +3, ability, ACP)
c.skills['Climb'] = 3;
const expClimb = 3 + PF.abilityMod(c, 'str') + 3 + PF.armorCheckPenalty(c);
check('skillBonus = ranks + ability + class +3 + ACP', PF.skillBonus(c, 'Climb') === expClimb,
  { got: PF.skillBonus(c, 'Climb'), expected: expClimb });

// ---------------- generator invariants ----------------
const r1 = PFGEN.mulberry32(1234), r2 = PFGEN.mulberry32(1234);
check('seeded RNG deterministic', [r1(), r1(), r1()].join() === [r2(), r2(), r2()].join());

const picks = {
  seed: 42, level: 5, race: 'Human', cls: 'Fighter', cls2: null, levels2: 0,
  alignment: 'N', abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 8 },
  spellTheme: null, featBundle2: null,
};
picks.skillTheme = ((GEN.skillThemes || [])[0] || {}).id || null;
const fbCands = PFGEN.featBundleCandidates(picks, 0.7);
picks.featBundle = fbCands.length ? fbCands[0].value : null;
const gc = PFGEN.buildCharacter(picks);
check('generated character has the rolled level count', gc.levels.length === 5, gc.levels.length);
check('generated skills within engine budget', PF.skillPointsSpent(gc) <= PF.skillPointsBudget(gc),
  { spent: PF.skillPointsSpent(gc), budget: PF.skillPointsBudget(gc) });
check('generated feats within allowance', gc.feats.length <= PF.featAllowance(gc).total,
  { feats: gc.feats.length, allowed: PF.featAllowance(gc).total });
check('no generated feat with unmet prereqs', gc.feats.every(f => {
  const ft = PF.getFeat(f.name);
  return !ft || PF.checkFeatPrereqs(gc, ft).status !== 'unmet';
}), gc.feats.map(f => f.name));
check('same seed + picks reproduce the same character',
  JSON.stringify(Object.assign({}, PFGEN.buildCharacter(picks), { id: 0, created: 0, updated: 0 })) ===
  JSON.stringify(Object.assign({}, gc, { id: 0, created: 0, updated: 0 })));

const wpicks = {
  seed: 7, level: 5, race: 'Elf', cls: 'Wizard', cls2: null, levels2: 0, alignment: 'N',
  abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 10, cha: 10 },
  skillTheme: null, featBundle: null, featBundle2: null, spellTheme: null,
};
const wc = PFGEN.buildCharacter(wpicks);
check('generated wizard has spells', wc.spells.length > 0, wc.spells.length);
check('every generated spell is on its class list', wc.spells.every(s => PF.spellOnClassList(s.name, s.cls)),
  wc.spells.filter(s => !PF.spellOnClassList(s.name, s.cls)).map(s => s.name));

// ---------------- feat-bundle integrity ----------------
// every feat named in every bundle must exist in the compiled data (typo guard)
const badNames = [];
for (const b of GEN.featBundles) for (const n of b.feats) if (!PF.getFeat(n)) badNames.push(b.id + ': ' + n);
check('every bundle feat name exists in the data', badNames.length === 0, badNames);

// every rollable class must have at least one themed (non-generalist) bundle by L10
const themedless = [];
for (const [cls, prof] of Object.entries(GEN.classProfiles)) {
  if (!prof.roll) continue;
  const any = GEN.featBundles.some(b => {
    if (b.id === 'generalist' || (b.minLevel || 1) > 10) return false;
    if (b.requiresCasting && !PF.casterInfo(cls)) return false;
    if (!b.classes && !b.roles) return false;
    return (b.classes || []).includes(cls) || (b.roles || []).includes(prof.role);
  });
  if (!any) themedless.push(cls);
}
check('every rollable class has a themed bundle by L10', themedless.length === 0, themedless);

// the new class-identity bundles are offered to their classes and build legally
const bundleCombos = [
  ['Kineticist', 8, 'kinetic-blaster', { str: 10, dex: 14, con: 17, int: 10, wis: 12, cha: 8 }],
  ['Shifter',    6, 'savage-shifter',  { str: 14, dex: 14, con: 12, int: 10, wis: 15, cha: 8 }],
  ['Druid',      9, 'wild-shepherd',   { str: 10, dex: 12, con: 14, int: 10, wis: 17, cha: 8 }],
  ['Alchemist',  7, 'grenadier',       { str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 8 }],
  ['Witch',      7, 'hexweaver',       { str: 8,  dex: 12, con: 14, int: 17, wis: 10, cha: 10 }],
  ['Gunslinger', 6, 'powder-grit',     { str: 10, dex: 17, con: 12, int: 10, wis: 14, cha: 8 }],
  ['Bard',       8, 'virtuoso',        { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 17 }],
];
for (const [cls, level, bundle, abilities] of bundleCombos) {
  const p = { seed: 99, level, race: 'Human', cls, cls2: null, levels2: 0, alignment: 'N',
              abilities, skillTheme: null, featBundle: bundle, featBundle2: null, spellTheme: null };
  const cands = PFGEN.featBundleCandidates(p, 0.7);
  check(cls + ': ' + bundle + ' is offered', cands.some(x => x.value === bundle), cands.map(x => x.value));
  const label = (GEN.featBundles.find(b => b.id === bundle) || {}).label;
  const ch = PFGEN.buildCharacter(p);
  check(cls + ': feats within allowance', ch.feats.length <= PF.featAllowance(ch).total,
    { feats: ch.feats.length, allowed: PF.featAllowance(ch).total });
  check(cls + ': no unmet prereqs', ch.feats.every(f => {
    const ft = PF.getFeat(f.name);
    return !ft || PF.checkFeatPrereqs(ch, ft).status !== 'unmet';
  }), ch.feats.map(f => f.name));
  check(cls + ': took at least one ' + bundle + ' feat', ch.feats.some(f => f.note === label),
    ch.feats.map(f => f.name + ' [' + f.note + ']'));
}

// ---------------- named-skill trait bonuses (regression) ----------------
// "Dangerously Curious" grants +1 on Use Magic Device (a single named skill).
// It must NOT auto-apply as an all-skills bonus (skillMiscAll), which inflated
// every skill and double-counted with the generator's per-skill skillMisc.
{
  const s = PF.newCharacter('Named Skill Trait');
  s.race = 'Human'; s.flexChoice = 'cha';
  s.abilities = { str: 10, dex: 14, con: 12, int: 12, wis: 10, cha: 15 };
  s.levels.push({ cls: 'Rogue', archetypes: [], hp: null, fcb: '' });
  s.traits = ['Dangerously Curious', 'Reactionary', 'Resilient', 'Deft Dodger'];
  s.skills['Diplomacy'] = 1;
  const fc = PF.featureChanges(s);
  check('named-skill trait does not emit an all-skills change',
    !fc.some(x => x.target === 'skills'), fc);
  check('effective() skillMiscAll stays 0 with a named-skill trait',
    (PF.effective(s).skillMiscAll || 0) === 0, PF.effective(s).skillMiscAll);
  const es = PF.effective(s);
  check('Diplomacy = 1 rank + 3 Cha + 3 class (no +all inflation)',
    PF.skillBonus(es, 'Diplomacy') === 7, PF.skillBonus(es, 'Diplomacy'));
  // always-on trait bonuses to specific defenses/init MUST still auto-apply
  check('Reactionary still auto-applies +2 init',
    fc.some(x => x.target === 'init' && x.value === 2), fc);
  check('Resilient still auto-applies +1 Fort',
    fc.some(x => x.target === 'fort' && x.value === 1), fc);
  check('Deft Dodger still auto-applies +1 Ref',
    fc.some(x => x.target === 'ref' && x.value === 1), fc);
  // a genuine all-skills phrase must still map to the 'skills' target
  check('genuine "all skill checks" bonus still maps to skills',
    PF.parseChanges('<p>+2 competence bonus on all skill checks.</p>', { permanent: true })
      .some(x => x.target === 'skills'));
  // …and the named skill now auto-applies to THAT skill (target 'skill' + name)
  check('named-skill trait emits a single-skill change (Use Magic Device)',
    fc.some(x => x.target === 'skill' && x.skill === 'Use Magic Device' && x.value === 1), fc);
  check('the single-skill bonus reaches that skill via effective()',
    (parseInt(es.skillMisc['Use Magic Device'], 10) || 0) === 1, es.skillMisc);
}

// ---------------- buff targets: named skill / attack→CMB / max HP ----------------
{
  // parser: "+10 competence bonus on Stealth checks" → single-skill change
  const p1 = PF.parseChanges('<p>You gain a +10 competence bonus on Stealth checks.</p>');
  check('parser captures a named-skill bonus with its skill',
    p1.some(x => x.target === 'skill' && x.skill === 'Stealth' && x.value === 10 && x.type === 'competence'), p1);
  const p2 = PF.parseChanges('<p>You gain a +2 bonus on Knowledge (arcana) checks.</p>');
  check('parser keeps the Knowledge subskill', p2.some(x => x.target === 'skill' && x.skill === 'Knowledge (arcana)'), p2);
  const p3 = PF.parseChanges('<p>You gain a +20 enhancement bonus to fly speed.</p>');
  check('"fly speed" is a speed bonus, not the Fly skill',
    p3.some(x => x.target === 'speed') && !p3.some(x => x.target === 'skill'), p3);
  const p4 = PF.parseChanges('<p>You gain a +2 bonus on Perception and Sense Motive checks.</p>');
  check('two named skills in one clause both captured',
    ['Perception', 'Sense Motive'].every(n => p4.some(x => x.target === 'skill' && x.skill === n)), p4);

  const b = PF.newCharacter('Buffed');
  b.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
  b.skills['Stealth'] = 1;
  b.play = PF.newPlayState();
  b.play.buffs = [{ name: 'Sneaky Cloak', active: true, changes: [{ target: 'skill', skill: 'Stealth', type: 'competence', value: 5 }] }];
  let eb = PF.effective(b);
  const baseStealth = PF.skillBonus(b, 'Stealth');
  check('single-skill buff raises only that skill (+5 Stealth)',
    PF.skillBonus(eb, 'Stealth') === baseStealth + 5, { base: baseStealth, buffed: PF.skillBonus(eb, 'Stealth') });
  check('other skills untouched by a single-skill buff',
    PF.skillBonus(eb, 'Perception') === PF.skillBonus(b, 'Perception'));
  // same-type stacking applies inside the skill bucket: competence +2 and +5 → +5
  b.play.buffs.push({ name: 'Lesser Cloak', active: true, changes: [{ target: 'skill', skill: 'Stealth', type: 'competence', value: 2 }] });
  eb = PF.effective(b);
  check('same-type single-skill bonuses take the best, not the sum',
    PF.skillBonus(eb, 'Stealth') === baseStealth + 5, PF.skillBonus(eb, 'Stealth'));

  // attack-roll bonuses apply to CMB (maneuver checks are attack rolls)
  b.play.buffs = [{ name: 'Bless', active: true, changes: [{ target: 'attack', type: 'luck', value: 2 }] }];
  eb = PF.effective(b);
  check('attack buff (+2) raises CMB by 2',
    PF.combatManeuvers(eb).cmb === PF.combatManeuvers(b).cmb + 2,
    { base: PF.combatManeuvers(b).cmb, buffed: PF.combatManeuvers(eb).cmb });
  check('attack buff does not touch CMD', PF.combatManeuvers(eb).cmd === PF.combatManeuvers(b).cmd);
  // the Shaken condition's −2 attack now correctly drops CMB too
  b.play.buffs = [JSON.parse(JSON.stringify(PF.CONDITIONS.find(x => x.name === 'Shaken')))];
  b.play.buffs[0].active = true;
  eb = PF.effective(b);
  check('Shaken (−2 attack) lowers CMB by 2', PF.combatManeuvers(eb).cmb === PF.combatManeuvers(b).cmb - 2,
    PF.combatManeuvers(eb).cmb);

  // max-HP target
  b.play.buffs = [{ name: 'Vitality', active: true, changes: [{ target: 'hpMax', type: 'untyped', value: 10 }] }];
  eb = PF.effective(b);
  check('hpMax buff (+10) raises max HP by 10',
    PF.hpBreakdown(eb).total === PF.hpBreakdown(b).total + 10,
    { base: PF.hpBreakdown(b).total, buffed: PF.hpBreakdown(eb).total });
}

// ---------------- class-ability prerequisites ----------------
// build_data now parses a `prereq` string from the "<strong>Prerequisite</strong>"
// clause on class abilities, and the feat qualification pipeline is reused for
// them: a clause naming another class ability is checked against c.classAbilities.
{
  const abils = PFDATA.classAbilities || [];
  const withPre = abils.filter(a => a.prereq);
  check('some class abilities carry a parsed prereq', withPre.length > 0, withPre.length);

  const greater = abils.find(a => a.name === 'Elemental Whispers, Greater');
  check('Elemental Whispers, Greater has a prereq', greater && /elemental whispers/i.test(greater.prereq || ''),
    greater && greater.prereq);
  check('base Elemental Whispers ability exists in data',
    abils.some(a => a.name.toLowerCase() === 'elemental whispers'));

  const kin = PF.newCharacter('Kineticist Test');
  kin.levels.push({ cls: 'Kineticist', archetypes: [], hp: null, fcb: '' });
  check('greater wild talent prereq unmet without the base talent',
    PF.checkFeatPrereqs(kin, greater).status === 'unmet', PF.checkFeatPrereqs(kin, greater));
  kin.classAbilities = [{ name: 'Elemental Whispers', cls: 'Kineticist' }];
  check('greater wild talent prereq met once the base talent is chosen',
    PF.checkFeatPrereqs(kin, greater).status === 'met', PF.checkFeatPrereqs(kin, greater));

  // a class ability WITHOUT a parsed prereq reports met with no clauses
  const noPre = abils.find(a => !a.prereq);
  check('class ability with no prereq => met, zero clauses',
    noPre && PF.checkFeatPrereqs(kin, noPre).status === 'met' &&
      PF.checkFeatPrereqs(kin, noPre).clauses.length === 0, noPre && noPre.name);

  // required class abilities must NOT leak into the feat-tree parent list
  check('class-ability prereqs are not reported as feat parents',
    PF.featParents(greater).length === 0, PF.featParents(greater));

  // "greater X" prose is reconciled with a "X, Greater" entry name so the chain
  // still checks (Gravity Master needs gravity control + greater gravity control)
  const gm = abils.find(a => a.name === 'Gravity Master');
  if (gm) {
    const gk = PF.newCharacter('Gravity Kineticist');
    gk.levels.push({ cls: 'Kineticist', archetypes: [], hp: null, fcb: '' });
    gk.classAbilities = [
      { name: 'Gravity Control', cls: 'Kineticist' },
      { name: 'Gravity Control, Greater', cls: 'Kineticist' },
    ];
    const res = PF.checkFeatPrereqs(gk, gm);
    check('Gravity Master met when both gravity-control talents are held',
      res.status === 'met', res);
    check('no Gravity Master prereq clause is left unverifiable',
      res.clauses.every(cl => cl.status !== 'unknown'), res.clauses);
  }

  // feat prereq parsing is unchanged: feats never match class-ability names
  // (allowAbilities is keyed off the entry's `classes` array, which feats lack)
  check('feat clause parsing unaffected — Power Attack still met',
    PF.checkFeatPrereqs(c, pa).status === 'met');

  // ---- prose talent chains (data-derived from "must have the X talent" text) ----
  const totem = abils.find(a => a.name === 'Spirit Totem, Greater');
  check('greater totem carries a chained prereq', totem && /spirit totem/i.test(totem.prereq || ''),
    totem && totem.prereq);
  if (totem) {
    const bbn = PF.newCharacter('Barb');
    bbn.levels.push({ cls: 'Barbarian', archetypes: [], hp: null, fcb: '' });
    check('greater totem unmet without the base totem',
      PF.checkFeatPrereqs(bbn, totem).status === 'unmet', PF.checkFeatPrereqs(bbn, totem));
    bbn.classAbilities = [{ name: 'Spirit Totem', cls: 'Barbarian' }];
    check('greater totem met once the base totem is chosen',
      PF.checkFeatPrereqs(bbn, totem).status === 'met', PF.checkFeatPrereqs(bbn, totem));
  }

  // ---- authored advanced-talent level gate (rogue advanced talents = rogue 10) ----
  const dispel = abils.find(a => a.name === 'Dispelling Attack');
  check('Dispelling Attack gated at Rogue level 10', dispel && /rogue level 10th/i.test(dispel.prereq || ''),
    dispel && dispel.prereq);
  if (dispel) {
    const r5 = PF.newCharacter('Rogue 5');
    for (let i = 0; i < 5; i++) r5.levels.push({ cls: 'Rogue', archetypes: [], hp: null, fcb: '' });
    check('advanced talent unmet for a level-5 rogue (level gate)',
      PF.checkFeatPrereqs(r5, dispel).clauses.some(cl => /level 10th/i.test(cl.text) && cl.status === 'unmet'),
      PF.checkFeatPrereqs(r5, dispel).clauses);
    const r10 = PF.newCharacter('Rogue 10');
    for (let i = 0; i < 10; i++) r10.levels.push({ cls: 'Rogue', archetypes: [], hp: null, fcb: '' });
    r10.classAbilities = [{ name: 'Major Magic', cls: 'Rogue' }];  // satisfies the chained clause too
    check('advanced talent level gate met for a level-10 rogue',
      PF.checkFeatPrereqs(r10, dispel).clauses.every(cl => cl.status === 'met'),
      PF.checkFeatPrereqs(r10, dispel).clauses);
    // class-LEVEL gate, not character level: a rogue 5 / fighter 5 still fails
    const multi = PF.newCharacter('Rogue 5 / Fighter 5');
    for (let i = 0; i < 5; i++) multi.levels.push({ cls: 'Rogue', archetypes: [], hp: null, fcb: '' });
    for (let i = 0; i < 5; i++) multi.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
    check('advanced talent gate keys off class level, not character level',
      PF.checkFeatPrereqs(multi, dispel).clauses.some(cl => /level 10th/i.test(cl.text) && cl.status === 'unmet'),
      PF.checkFeatPrereqs(multi, dispel).clauses);
  }
}

// ---------------- experience / XP tracks ----------------
// xpForLevel: known Core Rulebook thresholds on each track
check('xpForLevel(1, medium) = 0', PF.xpForLevel(1, 'medium') === 0, PF.xpForLevel(1, 'medium'));
check('xpForLevel(2, medium) = 2000', PF.xpForLevel(2, 'medium') === 2000, PF.xpForLevel(2, 'medium'));
check('xpForLevel(20, medium) = 3,600,000', PF.xpForLevel(20, 'medium') === 3600000, PF.xpForLevel(20, 'medium'));
check('xpForLevel(2, slow) = 3000', PF.xpForLevel(2, 'slow') === 3000, PF.xpForLevel(2, 'slow'));
check('xpForLevel(20, slow) = 5,350,000', PF.xpForLevel(20, 'slow') === 5350000, PF.xpForLevel(20, 'slow'));
check('xpForLevel(2, fast) = 1300', PF.xpForLevel(2, 'fast') === 1300, PF.xpForLevel(2, 'fast'));
check('xpForLevel(20, fast) = 2,400,000', PF.xpForLevel(20, 'fast') === 2400000, PF.xpForLevel(20, 'fast'));
// track is monotonically increasing on all three tracks
['slow', 'medium', 'fast'].forEach(tk => {
  let ok = true;
  for (let lv = 2; lv <= 20; lv++) if (PF.xpForLevel(lv, tk) <= PF.xpForLevel(lv - 1, tk)) ok = false;
  check(`${tk} track strictly increasing L1..L20`, ok);
});
// unknown / missing track falls back to medium
check('unknown track falls back to medium', PF.xpForLevel(5, 'bogus') === PF.xpForLevel(5, 'medium'));
check('missing track falls back to medium', PF.xpForLevel(5) === PF.xpForLevel(5, 'medium'));
// out-of-range levels clamp to 1..20
check('xpForLevel clamps below 1 to L1', PF.xpForLevel(0, 'medium') === 0);
check('xpForLevel clamps above 20 to L20', PF.xpForLevel(99, 'medium') === 3600000);

// levelForXp: boundaries are inclusive (reaching a threshold = that level)
check('levelForXp(0) = 1', PF.levelForXp(0, 'medium') === 1, PF.levelForXp(0, 'medium'));
check('levelForXp(1999) = 1 (just under)', PF.levelForXp(1999, 'medium') === 1, PF.levelForXp(1999, 'medium'));
check('levelForXp(2000) = 2 (exact threshold)', PF.levelForXp(2000, 'medium') === 2, PF.levelForXp(2000, 'medium'));
check('levelForXp(2001) = 2', PF.levelForXp(2001, 'medium') === 2, PF.levelForXp(2001, 'medium'));
check('levelForXp(huge) caps at 20', PF.levelForXp(99999999, 'medium') === 20, PF.levelForXp(99999999, 'medium'));
check('levelForXp(negative) = 1', PF.levelForXp(-500, 'medium') === 1, PF.levelForXp(-500, 'medium'));
check('levelForXp exact on fast track L10 = 71000', PF.levelForXp(71000, 'fast') === 10, PF.levelForXp(71000, 'fast'));
// xpForLevel / levelForXp round-trip at every threshold, every track
['slow', 'medium', 'fast'].forEach(tk => {
  let ok = true;
  for (let lv = 1; lv <= 20; lv++) if (PF.levelForXp(PF.xpForLevel(lv, tk), tk) !== lv) ok = false;
  check(`${tk}: levelForXp(xpForLevel(lv)) round-trips`, ok);
});

// xpProgress: mid-band character
const xc = PF.newCharacter('XP Test');
xc.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });   // level 1
xc.xp = 1467;
let xp = PF.xpProgress(xc);
check('xpProgress current reflects c.xp', xp.current === 1467, xp);
check('xpProgress nextThreshold = 2000', xp.nextThreshold === 2000, xp);
check('xpProgress toNext = 533', xp.toNext === 533, xp);
check('xpProgress pctToNext ~= 73%', xp.pctToNext === 73, xp.pctToNext);
check('xpProgress not yet eligible below threshold', xp.canLevel === false, xp);

// exactly at the next threshold => eligible to level up
xc.xp = 2000;
xp = PF.xpProgress(xc);
check('xpProgress canLevel at exact threshold', xp.canLevel === true, xp);
check('xpProgress toNext = 0 at threshold', xp.toNext === 0, xp);

// track selection is honoured
xc.xpTrack = 'fast'; xc.xp = 1300;
xp = PF.xpProgress(xc);
check('xpProgress honours xpTrack (fast L2 = 1300)', xp.nextThreshold === 1300 && xp.canLevel, xp);
xc.xpTrack = 'medium';

// level-20 character: no next threshold, capped progress
const cap = PF.newCharacter('Capped');
for (let i = 0; i < 20; i++) cap.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
cap.xp = 4000000;
xp = PF.xpProgress(cap);
check('xpProgress at L20 has null nextThreshold', xp.nextThreshold === null, xp);
check('xpProgress at L20 pctToNext = 100', xp.pctToNext === 100, xp);
check('xpProgress at L20 never canLevel', xp.canLevel === false, xp);

// XP below the current level's floor clamps pct to 0 (manual-level inconsistency)
const inc = PF.newCharacter('Inconsistent');
for (let i = 0; i < 5; i++) inc.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
inc.xp = 0;
xp = PF.xpProgress(inc);
check('xpProgress pct clamps to 0 when xp below level floor', xp.pctToNext === 0, xp);
check('xpProgress exposes xpLevel for consistency checks', xp.xpLevel === 1, xp.xpLevel);

// generator now seeds XP from the shared table (track minimum for the level)
if (PFGEN && typeof PFGEN.buildCharacter === 'function') {
  try {
    const gc = PFGEN.buildCharacter({ seed: 12345, level: 5, race: 'Human', cls: 'Fighter', alignment: 'N' });
    check('generator XP matches shared medium-track minimum for its level',
      gc.xp === PF.xpForLevel(gc.levels.length, gc.xpTrack || 'medium'), { xp: gc.xp, lv: gc.levels.length });
  } catch (e) {
    check('generator buildCharacter ran for XP check', false, String(e && e.message));
  }
}

// ---------------- class progression tables (data integrity) ----------------
// Every class must ship a complete progression table — 10 rows for prestige
// classes, 20 for everything else — with a parseable BAB string and numeric
// fort/ref/will in every row. An empty or gap-riddled table silently zeroes
// totals() for that class (the shipped ACG Swashbuckler table once had no
// rows at all, and Brawler's ref column was dropped by a header variant).
for (const cls of PFDATA.classes) {
  const prog = cls.prog || [];
  const want = cls.subtype === 'prestige' ? 10 : 20;
  check(cls.name + ' has ' + want + ' progression rows', prog.length === want, prog.length);
  let bad = null;
  prog.forEach((row, i) => {
    const rowOk = row.level === i + 1 &&
      /^\+?-?\d+/.test(row.bab || '') &&
      ['fort', 'ref', 'will'].every(k => typeof row[k] === 'number');
    if (!rowOk && !bad) bad = row;
  });
  check(cls.name + ' rows all have level/bab/fort/ref/will', bad === null, bad);
}

// regression: ACG header variants (Swashbuckler's bare "Bonus"/"Save" columns,
// Brawler's "Reflex Save") must still yield real base values through totals()
const swash = PF.newCharacter('Swash');
for (let i = 0; i < 2; i++) swash.levels.push({ cls: 'Swashbuckler', archetypes: [], hp: null, fcb: '' });
const swt = PF.totals(swash);
check('swashbuckler 2 BAB = +2 (full BAB)', swt.bab === 2, swt);
check('swashbuckler 2 base saves F0/R3/W0', swt.fort === 0 && swt.ref === 3 && swt.will === 0, swt);
const brawler = PF.newCharacter('Brawler');
for (let i = 0; i < 2; i++) brawler.levels.push({ cls: 'Brawler', archetypes: [], hp: null, fcb: '' });
const brt = PF.totals(brawler);
check('brawler 2 base Ref = +3 (good Ref)', brt.ref === 3, brt);

// ---------------- eidolon evolutions ----------------
{
  check('evolution catalog loaded (APG + UM)', (PFDATA.evolutions || []).length >= 60, (PFDATA.evolutions || []).length);
  check('Hooves (Ultimate Magic) is in the catalog', !!PF.getEvolution('Hooves'));
  const ev = PF.newCharacter('Summoner');
  for (let i = 0; i < 8; i++) ev.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
  const eid = PF.newCompanion('eidolon');
  eid.form = 'Quadruped';
  ev.companions = [eid];

  // pool: L8 summoner → 11 points; empty spend
  check('L8 eidolon pool max = 11', PF.evolutionPool(ev, eid).max === 11, PF.evolutionPool(ev, eid).max);
  check('empty pool spends 0', PF.evolutionPool(ev, eid).spent === 0);

  // one entry per selection (repeated Improved Natural Armor = two entries)
  eid.evolutions = [
    { name: 'Improved Natural Armor', choice: '' },  // 1pt
    { name: 'Improved Natural Armor', choice: '' },  // 1pt (×2 total)
    { name: 'Ability Increase', choice: 'str' },     // 2pt
    { name: 'Claws', choice: '' },                   // 1pt
    { name: 'Large', choice: '' },                   // 4pt
  ];
  const pool = PF.evolutionPool(ev, eid);
  // Ability Increase (Str) costs double (4) because Large is in the build
  check('pool spent = 1+1+4+1+4 = 11 (Str increase doubled while Large)', pool.spent === 11, pool.spent);
  check('pool exactly at budget 11/11 is not over', pool.over === false, pool);

  const eff = PF.eidolonEvolutionEffects(eid);
  check('Improved Natural Armor ×2 → +4 natural armor (before Large)',
    eff.natArmor === 6, eff.natArmor);   // INA +4 and Large +2
  check('Ability Increase applies +2 to the chosen ability', eff.abil.str >= 2, eff.abil.str);
  check('Large sets size to Large', eff.size === 'Large', eff.size);

  const d = PF.companionDerived(ev, eid);
  check('derived eidolon size is Large', d.size === 'Large', d.size);
  // Quadruped Str 14 + L8 str/dex bonus (+3) + Ability Increase (+2) + Large (+8) = 27
  check('Large + boosts fold into Str', d.abilities.str === 27, d.abilities.str);
  check('evolution natural armor reaches the derived block', d.natArmor >= 6, d.natArmor);
  check('claws appear in the attack line, size-scaled', /claws \(1d6\)/i.test(d.attacks), d.attacks);

  // prerequisites: free-form-granted limbs satisfy Claws on a quadruped
  check('Claws qualifies on a quadruped (free legs)',
    PF.evolutionPrereqs(ev, eid, PF.getEvolution('Claws')).ok, PF.evolutionPrereqs(ev, eid, PF.getEvolution('Claws')).reasons);
  // Pounce is quadruped-only
  eid.form = 'Biped';
  check('Pounce blocked on a biped (quadruped form only)',
    !PF.evolutionPrereqs(ev, eid, PF.getEvolution('Pounce')).ok);
  eid.form = 'Quadruped';
  // Large is gated at summoner level 8
  const ev4 = PF.newCharacter('Low Summoner');
  for (let i = 0; i < 4; i++) ev4.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
  const eid4 = PF.newCompanion('eidolon'); eid4.form = 'Quadruped'; ev4.companions = [eid4];
  check('Large blocked below summoner level 8',
    !PF.evolutionPrereqs(ev4, eid4, PF.getEvolution('Large')).ok,
    PF.evolutionPrereqs(ev4, eid4, PF.getEvolution('Large')).reasons);

  // over-budget detection
  eid.evolutions = [{ name: 'Large', choice: '' }, { name: 'Breath Weapon', choice: 'fire' },
    { name: 'Fast Healing', choice: '' }, { name: 'Large', choice: '' }];
  check('pool flags over budget when overspent', PF.evolutionPool(ev, eid).over === true, PF.evolutionPool(ev, eid));

  // per-selection choices: the same evolution taken for different functions
  const ms = PF.newCharacter('Multi-Select'); for (let i = 0; i < 10; i++) ms.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
  const me = PF.newCompanion('eidolon'); me.form = 'Quadruped'; ms.companions = [me];
  check('Limbs has an arms/legs choice spec', PF.evolutionChoiceSpec('Limbs').options.join() === 'arms,legs');
  check('Flight upgrades are add-ons: magic flight + stackable fly speed',
    (PF.evolutionAddons('Flight') || []).map(a => a.id).join() === 'magic,speed');
  me.evolutions = [
    { name: 'Ability Increase', choice: 'str' },
    { name: 'Ability Increase', choice: 'dex' },   // second selection, different ability
    { name: 'Limbs', choice: 'arms' },
    { name: 'Limbs', choice: 'legs' },             // two limb sets, distinct functions
  ];
  const meff = PF.eidolonEvolutionEffects(me);
  check('two Ability Increases apply to their two different abilities',
    meff.abil.str === 2 && meff.abil.dex === 2, meff.abil);
  check('both Limbs selections are pooled (2pt each ×2 = 4)',
    PF.evolutionPool(ms, me).spent === 2 + 2 + 2 + 2, PF.evolutionPool(ms, me).spent);
  check('distinct-choice selections surface as separate notes',
    meff.notes.filter(n => /^Limbs/.test(n)).length === 2, meff.notes);

  // ---- softcover + Unchained coverage (Foundry compendium sources) ----
  check('catalog includes the softcover evolutions (Bleed etc.)',
    ['Bleed', 'Sticky', 'Slippery', 'Sacrifice', 'Sickening', 'Celestial Appearance', 'Fiendish Appearance',
     'Rider Bond', 'Shared Evolution', 'Shared Slot', 'Extra Feat'].every(n => !!PF.getEvolution(n)),
    ['Bleed', 'Sticky', 'Slippery'].map(n => !!PF.getEvolution(n)));
  check('catalog includes the Unchained variant set', !!PF.getEvolution('Bite (UC)') && !!PF.getEvolution('Large (UC)'));
  check('full catalog spans standard + softcover + Unchained (139)', (PFDATA.evolutions || []).length === 139, (PFDATA.evolutions || []).length);
  check('Bleed is 1 pt and repeatable', PF.getEvolution('Bleed').cost === 1 && PF.getEvolution('Bleed').repeatable === true);
  check('Unchained "Requirements: Summoner level 9th" parses as a level gate',
    PF.getEvolution('Breath Weapon (UC)').minLevel === 9, PF.getEvolution('Breath Weapon (UC)').minLevel);
  {
    const uc = PF.newCharacter('Unchained'); for (let i = 0; i < 6; i++) uc.levels.push({ cls: 'Summoner (Unchained)', archetypes: [], hp: null, fcb: '' });
    const ue = PF.newCompanion('eidolon'); ue.form = 'Quadruped'; uc.companions = [ue];
    check('eidolon auto-level counts Summoner (Unchained) levels', PF.companionAutoLevel(uc, ue) === 6, PF.companionAutoLevel(uc, ue));
    // UC attack variants share the base evolution's dice; UC Large does NOT
    // inherit standard Large's stat block (its numbers differ in Unchained)
    ue.evolutions = [{ name: 'Sting (UC)', choice: '' }, { name: 'Large (UC)', choice: '' }];
    const ud = PF.companionDerived(uc, ue);
    check('Sting (UC) auto-applies a sting attack', /sting \(1d4\)/i.test(ud.attacks), ud.attacks);
    check('Large (UC) is tracked as a note, not standard Large stats',
      ud.size === 'Medium' && /Large \(UC\)/.test(ud.special), { size: ud.size, special: ud.special });
  }

  // ---- add-on upgrades (extra points on top of the base cost) ----
  check('Poison is NOT repeatable ("no more than once per round" is not a repeat clause)',
    PF.getEvolution('Poison').repeatable === false, PF.getEvolution('Poison').repeatable);
  check('Breath Weapon carries a +1 use/day add-on at 1pt', (PF.evolutionAddons('Breath Weapon') || [])[0].cost === 1);
  const au = PF.newCharacter('Addons'); for (let i = 0; i < 20; i++) au.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
  const ax = PF.newCompanion('eidolon'); ax.form = 'Quadruped'; au.companions = [ax];
  // Breath Weapon (4) + 2 extra uses (1 each) = 6
  ax.evolutions = [{ name: 'Breath Weapon', choice: 'fire', addons: { use: 2 } }];
  check('Breath Weapon with 2 extra uses costs 4+1+1 = 6', PF.evolutionPool(au, ax).spent === 6, PF.evolutionPool(au, ax).spent);
  check('breath add-ons surface in the notes', PF.eidolonEvolutionEffects(ax).notes.some(n => /Breath Weapon \(fire; \+1 use\/day/.test(n)),
    PF.eidolonEvolutionEffects(ax).notes);
  // Fast Healing (4) + 2 upgrades (2 each) = 8
  ax.evolutions = [{ name: 'Fast Healing', choice: '', addons: { heal: 2 } }];
  check('Fast Healing +2 upgrades costs 4+2+2 = 8', PF.evolutionPool(au, ax).spent === 8, PF.evolutionPool(au, ax).spent);
  // Large (4) + Huge add-on (6) = 10; Huge stats REPLACE Large's
  ax.evolutions = [{ name: 'Large', choice: '', addons: { huge: 1 } }];
  check('Huge = Large 4 + 6-point add-on = 10', PF.evolutionPool(au, ax).spent === 10, PF.evolutionPool(au, ax).spent);
  const dh = PF.companionDerived(au, ax);
  check('Huge add-on sets size to Huge', dh.size === 'Huge', dh.size);
  const hugeEff = PF.eidolonEvolutionEffects(ax);
  check('Huge grants +16 Str (replacing Large\'s +8)', hugeEff.abil.str === 16, hugeEff.abil.str);
  check('Huge grants +5 natural armor', hugeEff.natArmor === 5, hugeEff.natArmor);
  // Ability Increase on Str/Con costs double while Large
  ax.evolutions = [{ name: 'Large', choice: '' }, { name: 'Ability Increase', choice: 'str' }, { name: 'Ability Increase', choice: 'dex' }];
  check('Ability Increase (Str) costs 4 on a Large eidolon; (Dex) stays 2 — 4+4+2 = 10',
    PF.evolutionPool(au, ax).spent === 10, PF.evolutionPool(au, ax).spent);
  // an illegal duplicate of a non-repeatable evolution applies its effect once
  ax.evolutions = [{ name: 'Large', choice: '' }, { name: 'Large', choice: '' }];
  const dupEff = PF.eidolonEvolutionEffects(ax);
  check('duplicate non-repeatable Large applies only once (+8 Str, size Large)',
    dupEff.abil.str === 8 && dupEff.size === 'Large', dupEff);

  // ---- contextual catalog: no (UC)/standard twins in the same list ----
  {
    const std = PF.newCharacter('Chained'); std.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
    const cat1 = PF.evolutionCatalogFor(std);
    check('standard summoner sees no (UC) entries', !cat1.some(e => /\(UC\)$/i.test(e.name)), cat1.length);
    check('standard list still has Bite and Bleed', ['Bite', 'Bleed'].every(n => cat1.some(e => e.name === n)));
    const unch = PF.newCharacter('Unchained'); unch.levels.push({ cls: 'Summoner (Unchained)', archetypes: [], hp: null, fcb: '' });
    check('eidolonIsUnchained detects the class', PF.eidolonIsUnchained(unch) === true && PF.eidolonIsUnchained(std) === false);
    const cat2 = PF.evolutionCatalogFor(unch);
    check('unchained summoner sees Bite (UC) but not standard Bite',
      cat2.some(e => e.name === 'Bite (UC)') && !cat2.some(e => e.name === 'Bite'), cat2.length);
    check('unchained list keeps un-reprinted standard evolutions (Bleed)', cat2.some(e => e.name === 'Bleed'));
    check('opts.all returns the full 139', PF.evolutionCatalogFor(unch, { all: true }).length === 139);
  }

  // ---- structured eidolon attacks (Play-tab chips) ----
  {
    const sc = PF.newCharacter('Serpent'); sc.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
    const se = PF.newCompanion('eidolon'); se.form = 'Serpentine'; sc.companions = [se];
    let d = PF.companionDerived(sc, se);
    check('eidolon derivation emits a structured attack list', Array.isArray(d.attackList) && d.attackList.length >= 2, d.attackList);
    let chips = PF.companionAttacks(sc, se, d);
    const bite = chips.find(a => /^bite/.test(a.label));
    const tail = chips.find(a => /^tail slap/.test(a.label));
    const strM = PF.mod(d.abilities.str);
    check('tail slap is secondary: −5 to hit vs bite', bite && tail && tail.atk === bite.atk - 5, { bite: bite && bite.atk, tail: tail && tail.atk });
    check('secondary damage adds ½ Str', tail.dice === '1d6' + (Math.floor(strM / 2) ? '+' + Math.floor(strM / 2) : ''), tail.dice);
    check('primary damage adds full Str', bite.dice === '1d6' + (strM ? '+' + strM : ''), bite.dice);
    // Improved Damage steps the chosen attack's damage die
    se.evolutions = [{ name: 'Improved Damage', choice: 'bite' }];
    d = PF.companionDerived(sc, se);
    check('Improved Damage (bite) steps 1d6 → 1d8', d.attackList.find(a => a.label === 'bite').dice === '1d8', d.attackList);
    // Energy Attacks adds 1d6 of the chosen energy to every natural attack
    se.evolutions = [{ name: 'Energy Attacks', choice: 'fire' }];
    d = PF.companionDerived(sc, se);
    check('Energy Attacks (fire) adds 1d6 fire bonus dice to attacks',
      d.attackList.every(a => a.bonusDice === '1d6 fire'), d.attackList);
    chips = PF.companionAttacks(sc, se, d);
    check('energy bonus dice reach the roll chips', chips.some(a => a.bonusDice === '1d6 fire'), chips);
    // amulet of mighty fists: enhancement to hit and damage on every natural attack
    se.evolutions = [];
    se.atkEnh = 1;
    d = PF.companionDerived(sc, se);
    const chips2 = PF.companionAttacks(sc, se, d);
    const bite2 = chips2.find(a => /^bite/.test(a.label));
    check('attack enhancement (+1) raises to-hit by 1', bite2.atk === bite.atk + 1, { was: bite.atk, now: bite2.atk });
    check('attack enhancement (+1) raises damage by 1', bite2.dice === '1d6+' + (strM + 1), bite2.dice);
    // per-attack build edits: dmg adjust and hide
    se.atkEnh = 0;
    se.attackMods = { 'tail slap': { atk: 0, dmg: 2, dice: '', off: false }, 'bite': { atk: 0, dmg: 0, dice: '', off: true } };
    d = PF.companionDerived(sc, se);
    const chips3 = PF.companionAttacks(sc, se, d);
    check('hidden attack (bite) is dropped from the chips', !chips3.some(a => /^bite/.test(a.label)), chips3.map(a => a.label));
    const tail3 = chips3.find(a => /^tail slap/.test(a.label));
    check('per-attack damage adjustment applies (+2)', tail3.dice === '1d6+' + (Math.floor(strM / 2) + 2), tail3.dice);
  }

  // maximum-attacks cap: base bite + claws(2) + sting(1) = 4 > L1 max of 3
  const at = PF.newCharacter('Attacker'); at.levels.push({ cls: 'Summoner', archetypes: [], hp: null, fcb: '' });
  const ae = PF.newCompanion('eidolon'); ae.form = 'Quadruped'; at.companions = [ae];
  ae.evolutions = [{ name: 'Claws', choice: '' }, { name: 'Sting', choice: '' }];
  const da = PF.companionDerived(at, ae);
  check('natural attack count = base bite + 2 claws + sting = 4', da.attackCount === 4, da.attackCount);
  check('max attacks at level 1 = 3', da.maxAttacks === 3, da.maxAttacks);
  check('exceeding the attack cap raises a warning',
    da.warnings.some(w => /exceed the maximum/.test(w)), da.warnings);
  // rake grants attacks that do NOT count toward the cap
  ae.evolutions.push({ name: 'Rake', choice: '' });
  const dr = PF.companionDerived(at, ae);
  check('rake attacks are excluded from the cap count', dr.attackCount === 4, dr.attackCount);
  check('rake still shows in the attack line', /rake/i.test(dr.attacks), dr.attacks);
}

// ---------------- Str-to-damage multipliers ----------------
{
  const th = PF.newCharacter('Two-Hander');
  th.abilities = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  for (let i = 0; i < 1; i++) th.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
  const gs = { name: 'Greatsword', kind: 'weapon', qty: 1, equipped: true };
  const ls = { name: 'Longsword', kind: 'weapon', qty: 1, equipped: true };
  check('greatsword is recognized as two-handed', PF.isTwoHandedWeapon(PF.getWeapon('Greatsword')));
  check('two-handed damage = floor(Str × 1.5)', PF.weaponAttack(th, gs).dice === '2d6+4', PF.weaponAttack(th, gs).dice);
  check('one-handed damage stays ×1', PF.weaponAttack(th, ls).dice === '1d8+3', PF.weaponAttack(th, ls).dice);
  check('off-hand override halves the bonus', PF.weaponAttack(th, Object.assign({}, ls, { strMult: '0.5' })).dice === '1d8+1',
    PF.weaponAttack(th, Object.assign({}, ls, { strMult: '0.5' })).dice);
  check('×0 override drops Str entirely', PF.weaponAttack(th, Object.assign({}, ls, { strMult: '0' })).dice === '1d8',
    PF.weaponAttack(th, Object.assign({}, ls, { strMult: '0' })).dice);
  // Str penalties are never multiplied — a Str 8 two-hander takes the full −1, not −2
  const weakTh = PF.newCharacter('Weak');
  weakTh.abilities = { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  weakTh.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
  check('Str penalty applied in full on a two-hander', PF.weaponAttack(weakTh, gs).dice === '2d6-1',
    PF.weaponAttack(weakTh, gs).dice);
}

// ---------------- ability damage & negative levels (play state) ----------------
{
  const pd = PF.newCharacter('Poisoned');
  pd.abilities = { str: 14, dex: 10, con: 14, int: 10, wis: 10, cha: 10 };
  for (let i = 0; i < 4; i++) pd.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
  pd.play = PF.newPlayState();
  const baseHp = PF.hpBreakdown(pd).total;
  pd.play.abilityDamage = { str: 4, con: 2 };
  check('hasPlayPenalties sees ability damage', PF.hasPlayPenalties(pd));
  const eff = PF.effective(pd);
  check('ability damage lowers the effective score', PF.abilityScore(eff, 'str') === 10, PF.abilityScore(eff, 'str'));
  check('Con damage lowers max HP via the Con modifier', PF.hpBreakdown(eff).total === baseHp - 4,
    { base: baseHp, now: PF.hpBreakdown(eff).total });
  check('sheet view (buffs:false) ignores play-state damage', PF.abilityScore(PF.effective(pd, { buffs: false }), 'str') === 14);
  pd.play.abilityDamage = {};
  pd.play.negLevels = 2;
  const nl = PF.effective(pd);
  const baseSv = PF.saves(pd, {});
  check('negative levels subtract from attack', (nl.combat.miscAttack || 0) === -2, nl.combat.miscAttack);
  check('negative levels subtract 5 HP each', PF.hpBreakdown(nl).total === baseHp - 10,
    { base: baseHp, now: PF.hpBreakdown(nl).total });
  check('negative levels subtract from all saves', PF.saves(nl).fort === PF.saves(PF.effective(pd, { buffs: false })).fort - 2,
    { with: PF.saves(nl).fort });
}

// ---------------- stored gear is excluded from encumbrance ----------------
{
  const sg = PF.newCharacter('Packrat');
  sg.levels.push({ cls: 'Fighter', archetypes: [], hp: null, fcb: '' });
  sg.gear.push({ name: 'Heavy crate', kind: 'custom', qty: 1, weight: 100 });
  const carried = PF.gearWeight(sg);
  sg.gear[0].stored = true;
  check('stored gear does not count toward carried weight', PF.gearWeight(sg) === carried - 100,
    { carried, stored: PF.gearWeight(sg) });
}

// ---------------- result ----------------
console.log('%d passed, %d failed', passed, failed);
process.exit(failed ? 1 : 0);
