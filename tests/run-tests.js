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
  'data/companions.js', 'data/buffs.js', 'data/bundles.js',
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
}

// ---------------- result ----------------
console.log('%d passed, %d failed', passed, failed);
process.exit(failed ? 1 : 0);
