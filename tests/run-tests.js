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

// ---------------- result ----------------
console.log('%d passed, %d failed', passed, failed);
process.exit(failed ? 1 : 0);
