/* ============================================================================
 * data/bundles.js  —  Authored content for the Random Character Generator
 * ----------------------------------------------------------------------------
 * This file is pure DATA. The pipeline (js/generator.js, not yet built) reads
 * it via the global PFGENDATA. Nothing here runs rules — legality is enforced
 * at generation time by the existing engine (PF.checkFeatPrereqs, abilityScore,
 * CASTERS, etc.). All feat / spell / weapon / armor strings below are REAL
 * names from data/*.js — the generator matches on exact name, so a typo just
 * means that pick is silently skipped (never a crash). Keep that contract.
 *
 * DRAFT STATUS: tables are complete in SHAPE. Content coverage is a first cut —
 * core combat styles + the main caster paths are populated; sections marked
 * "// EXPAND:" are where we add breadth next. See memory/random-character-generator.md
 * ============================================================================ */
window.PFGENDATA = window.PFGENDATA || {};

/* ---------------------------------------------------------------------------
 * 1. CLASS PROFILES
 * One row per PC-rollable class. NPC + prestige classes are omitted (a level-1
 * roll can't enter a prestige class). Unchained variants are roll:false so we
 * don't double-roll the same flavor — flip these if you'd rather feature them.
 *
 *   roll     : eligible for the class wheel
 *   keys     : ability priority for stat weighting + the auto ability-increases
 *              (first entry is the "key ability"; finesse classes list dex|str).
 *              May list 2-4 abilities in priority order — the generator splits
 *              a FIXED stat budget across them (KEY_SHARES in generator.js),
 *              so MAD classes get wider-but-flatter spreads, not more total
 *              points. Give a class a 3rd key only when it genuinely needs
 *              three stats (Paladin, Monk…), not just "would like" them.
 *   role     : 'martial' | 'arcane' | 'divine' | 'nature' | 'skill' | 'gish'
 *   defense  : preferred armor weight -> feeds gearKits ('heavy'..'none')
 *   weapon   : default weaponPref if no feat bundle overrides it
 *   tags     : free-form match tags for bundle/skill weighting
 * Caster ability + spell list come from PF.CASTERS at runtime; 'list' here is a
 * convenience hint for spellThemes lookup (must match a spellThemes list key).
 * ------------------------------------------------------------------------- */
PFGENDATA.classProfiles = {
  // --- Core ---
  Barbarian: { roll:true,  keys:['str','con'],       role:'martial', defense:'medium', weapon:'twoHanded',  tags:['rage','frontline'] },
  Bard:      { roll:true,  keys:['cha','dex'],       role:'arcane',  defense:'light',  weapon:'finesse',    tags:['face','support'], list:'Bard' },
  Cleric:    { roll:true,  keys:['wis','str'],       role:'divine',  defense:'heavy',  weapon:'oneHand',    tags:['healer','support'], list:'Cleric' },
  Druid:     { roll:true,  keys:['wis','con'],       role:'nature',  defense:'medium', weapon:'oneHand',    tags:['wild','support'], list:'Druid' },
  Fighter:   { roll:true,  keys:['str','dex'],       role:'martial', defense:'heavy',  weapon:'twoHanded',  tags:['frontline','versatile'] },
  Monk:      { roll:true,  keys:['dex','wis','str'], role:'martial', defense:'none',   weapon:'unarmed',    tags:['mobile','lawful'] },
  Paladin:   { roll:true,  keys:['str','cha','con'], role:'divine',  defense:'heavy',  weapon:'oneHand',    tags:['frontline','smite'], list:'Paladin' },
  Ranger:    { roll:true,  keys:['dex','wis','str'], role:'martial', defense:'medium', weapon:'ranged',     tags:['wild','skirmish'], list:'Ranger' },
  Rogue:     { roll:true,  keys:['dex','int'],       role:'skill',   defense:'light',  weapon:'finesse',    tags:['skill','sneak'] },
  Sorcerer:  { roll:true,  keys:['cha','con'],       role:'arcane',  defense:'none',   weapon:'none',       tags:['blaster','spont'], list:'Wizard' },
  Wizard:    { roll:true,  keys:['int','dex'],       role:'arcane',  defense:'none',   weapon:'none',       tags:['blaster','control'], list:'Wizard' },
  // --- Base (APG / UC / UM / ACG-era) ---
  Alchemist:    { roll:true, keys:['int','dex'],     role:'gish',    defense:'light',  weapon:'ranged',     tags:['bomb','skill'], list:'Alchemist' },
  Cavalier:     { roll:true, keys:['str','cha'],     role:'martial', defense:'heavy',  weapon:'mounted',    tags:['mounted','frontline'] },
  Inquisitor:   { roll:true, keys:['wis','str'],     role:'divine',  defense:'medium', weapon:'oneHand',    tags:['skill','support'], list:'Cleric' },
  Oracle:       { roll:true, keys:['cha','con'],     role:'divine',  defense:'heavy',  weapon:'oneHand',    tags:['healer','blaster'], list:'Cleric' },
  Summoner:     { roll:true, keys:['cha','con'],     role:'arcane',  defense:'light',  weapon:'none',       tags:['pet','support'], list:'Summoner' },
  Witch:        { roll:true, keys:['int','con'],     role:'arcane',  defense:'none',   weapon:'none',       tags:['control','hex'], list:'Witch' },
  Magus:        { roll:true, keys:['int','str','con'], role:'gish',  defense:'medium', weapon:'oneHand',    tags:['gish','blaster'], list:'Magus' },
  Ninja:        { roll:true, keys:['dex','cha'],     role:'skill',   defense:'light',  weapon:'finesse',    tags:['skill','sneak'] },
  Samurai:      { roll:true, keys:['str','dex'],     role:'martial', defense:'heavy',  weapon:'mounted',    tags:['mounted','frontline'] },
  Gunslinger:   { roll:true, keys:['dex','wis'],     role:'martial', defense:'light',  weapon:'ranged',     tags:['ranged','grit'] },
  // --- Hybrid (ACG) ---
  Arcanist:     { roll:true, keys:['int','con'],     role:'arcane',  defense:'none',   weapon:'none',       tags:['blaster','control'], list:'Wizard' },
  Bloodrager:   { roll:true, keys:['str','con','cha'], role:'gish',  defense:'medium', weapon:'twoHanded',  tags:['rage','frontline'], list:'Bloodrager' },
  Brawler:      { roll:true, keys:['str','dex','con'], role:'martial', defense:'light', weapon:'unarmed',   tags:['unarmed','frontline'] },
  Hunter:       { roll:true, keys:['wis','dex'],     role:'nature',  defense:'medium', weapon:'ranged',     tags:['pet','wild'], list:'Druid' },
  Investigator: { roll:true, keys:['int','dex'],     role:'skill',   defense:'light',  weapon:'finesse',    tags:['skill','face'], list:'Alchemist' },
  Shaman:       { roll:true, keys:['wis','con'],     role:'divine',  defense:'none',   weapon:'none',       tags:['hex','support'], list:'Shaman' },
  Skald:        { roll:true, keys:['cha','str'],     role:'gish',    defense:'medium', weapon:'twoHanded',  tags:['rage','support'], list:'Bard' },
  Slayer:       { roll:true, keys:['dex','str'],     role:'martial', defense:'medium', weapon:'twoWeapon',  tags:['skill','sneak'] },
  Swashbuckler: { roll:true, keys:['dex','cha'],     role:'martial', defense:'light',  weapon:'finesse',    tags:['finesse','panache'] },
  Warpriest:    { roll:true, keys:['wis','str','con'], role:'divine', defense:'heavy',  weapon:'twoHanded', tags:['frontline','healer'], list:'Cleric' },
  // --- Occult / Unchained (rollable but lower default weight via rarity) ---
  Kineticist:   { roll:true, keys:['con','dex'],     role:'arcane',  defense:'light',  weapon:'none',       tags:['blaster'] },
  Mesmerist:    { roll:true, keys:['cha','dex'],     role:'arcane',  defense:'light',  weapon:'finesse',    tags:['face','control'] },
  Occultist:    { roll:true, keys:['int','str'],     role:'gish',    defense:'medium', weapon:'oneHand',    tags:['gish'] },
  Psychic:      { roll:true, keys:['int','con'],     role:'arcane',  defense:'none',   weapon:'none',       tags:['control','blaster'] },
  Spiritualist: { roll:true, keys:['wis','con'],     role:'divine',  defense:'light',  weapon:'oneHand',    tags:['pet','support'] },
  Medium:       { roll:true, keys:['cha','wis'],     role:'divine',  defense:'medium', weapon:'oneHand',    tags:['support'] },
  Vigilante:    { roll:true, keys:['dex','cha'],     role:'skill',   defense:'light',  weapon:'finesse',    tags:['skill','face'] },
  Shifter:      { roll:true, keys:['wis','dex','str'], role:'nature', defense:'light',  weapon:'natural',   tags:['wild','natural'] },
  // Unchained dupes — off by default to avoid double-flavor rolls
  'Barbarian (Unchained)': { roll:false, keys:['str','con'], role:'martial', defense:'medium', weapon:'twoHanded', tags:['rage'] },
  'Monk (Unchained)':      { roll:false, keys:['dex','wis','str'], role:'martial', defense:'none', weapon:'unarmed', tags:['mobile'] },
  'Rogue (Unchained)':     { roll:false, keys:['dex','int'], role:'skill',   defense:'light',  weapon:'finesse',   tags:['skill'] },
  'Summoner (Unchained)':  { roll:false, keys:['cha','con'], role:'arcane',  defense:'light',  weapon:'none',      tags:['pet'] },
};

/* ---------------------------------------------------------------------------
 * 2. RACE WEIGHTING
 * Per-race authoring would be 79 rows; instead weight by rarity bucket (from
 * each race's `subtype`/`source`) with a few flavor overrides. Generator looks
 * up a race's subtype, falls to bucket weight, then applies any name override.
 * ------------------------------------------------------------------------- */
PFGENDATA.raceRarity = {
  bucketWeight: {           // matched against race.subtype (lowercased)
    'core race':       10,
    'featured race':    4,
    'uncommon race':    1.5,
    'other race':       0.8, // 36 races: settlement/planar/obscure splatbook
    'monster race':     0.2, // 6 races: drow noble, svirfneblin… rare but rollable
    '':                 1,   // safety default for anything unclassified
  },
  // optional explicit per-race multipliers (name -> factor)
  override: {
    Human: 1.4, 'Half-Elf': 1.1, 'Half-Orc': 1.1,   // the "default fantasy" bump
  },
};

/* ---------------------------------------------------------------------------
 * 3. RACE -> CLASS SYNERGY
 * After a race lands, nudge the class wheel toward classes whose key ability
 * the race boosts. Generic rule handled in code (race.mods[keyAbility] > 0 =>
 * x1.6); this table is just flavor overrides for iconic pairings.
 * ------------------------------------------------------------------------- */
PFGENDATA.raceClassFlavor = {
  Dwarf:    { Cleric:1.4, Fighter:1.3, Ranger:1.2 },
  Elf:      { Wizard:1.5, Magus:1.3, Ranger:1.2 },
  Halfling: { Rogue:1.4, Bard:1.2 },
  Gnome:    { Bard:1.3, Sorcerer:1.3, Alchemist:1.2 },
  'Half-Orc': { Barbarian:1.4, Fighter:1.2 },
  Human:    {}, // good at everything; relies on the generic rule
};

/* ---------------------------------------------------------------------------
 * 4. LEVEL CURVE  (level is rolled, weighted toward low/mid)
 * Index = character level 1..20, value = relative weight.
 * ------------------------------------------------------------------------- */
PFGENDATA.levelCurve = [
  /*1*/14, /*2*/12, /*3*/12, /*4*/11, /*5*/11, /*6*/9, /*7*/8, /*8*/8,
  /*9*/6, /*10*/6, /*11*/4, /*12*/4, /*13*/3, /*14*/3, /*15*/2, /*16*/2,
  /*17*/1, /*18*/1, /*19*/1, /*20*/2,   // bump 20 slightly (capstone fantasy)
];

/* Multiclass: only above this level, and only this often. */
PFGENDATA.multiclass = { minLevel: 4, chance: 0.18, maxClasses: 2 };

/* ---------------------------------------------------------------------------
 * 5. SKILL-FOCUS THEMES  (rolled reel -> biases the auto skill distributor)
 * `skills` is a priority order; distributor pours ranks down the list (class
 * skills first per RAW), then spills to remaining class skills. `fitRoles`
 * weights which themes are likely for the rolled class.
 * ------------------------------------------------------------------------- */
/* Knowledge/Perform/Craft/Profession must be named with their parenthetical
 * subskill ("Knowledge (arcana)") — the Skills tab only renders those rows,
 * never the bare base skill. */
PFGENDATA.skillThemes = [
  { id:'face',       label:'Silver Tongue',  skills:['Diplomacy','Bluff','Sense Motive','Intimidate','Perform (oratory)'],                       fitRoles:['arcane','divine','skill'] },
  { id:'scout',      label:'Pathfinder',     skills:['Perception','Stealth','Survival','Acrobatics','Climb'],                                    fitRoles:['martial','skill','nature'] },
  { id:'infiltrator',label:'Shadow & Lock',  skills:['Stealth','Disable Device','Perception','Sleight of Hand','Escape Artist'],                 fitRoles:['skill'] },
  { id:'loremaster', label:'Loremaster',     skills:['Knowledge (arcana)','Knowledge (history)','Spellcraft','Linguistics','Appraise'],          fitRoles:['arcane','divine'] },
  { id:'wilderness', label:'Wild Warden',    skills:['Survival','Handle Animal','Ride','Knowledge (nature)','Climb','Swim'],                     fitRoles:['nature','martial'] },
  { id:'athlete',    label:'Iron Body',      skills:['Climb','Swim','Acrobatics','Intimidate','Perception'],                                     fitRoles:['martial'] },
  { id:'mystic',     label:'Arcane Savant',  skills:['Spellcraft','Knowledge (arcana)','Use Magic Device','Knowledge (planes)','Fly'],           fitRoles:['arcane','gish'] },
  { id:'healer',     label:'Mercy & Mend',   skills:['Heal','Sense Motive','Diplomacy','Knowledge (religion)','Spellcraft'],                     fitRoles:['divine'] },
];

/* ---------------------------------------------------------------------------
 * 6. FEAT BUNDLES  (ordered chains; generator walks them, taking each feat
 * whose PF.checkFeatPrereqs passes at the rolled level until feat slots run
 * out). A bundle self-weights up when `favors` abilities are high and when the
 * class matches `classes`/`roles`. `weapon` sets the concept's weaponPref
 * (drives gearKits). Author chains in dependency order (prereqs before payoff).
 *   classes : explicit class names (optional)
 *   roles   : class roles this fits (optional; OR-matched with classes)
 *   minLevel: don't offer below this
 *   requiresCasting: only offer if PF.casterInfo(class) is truthy — keeps
 *     metamagic/Spell Focus bundles away from Kineticist/Psychic/Medium etc.,
 *     whose casting the engine doesn't support
 * EXPAND: add reach-fighter, grapple, dirty-trick, metamagic-blaster variants,
 * teamwork bundles, style-feat (e.g. Crane/Dragon) chains.
 * ------------------------------------------------------------------------- */
PFGENDATA.featBundles = [
  { id:'two-handed-power', label:'Two-Handed Devastator', roles:['martial','gish'], weapon:'twoHanded',
    favors:{str:2,con:1}, minLevel:1,
    feats:['Power Attack','Furious Focus','Cleave','Great Cleave','Cornugon Smash','Vital Strike','Dazing Assault','Improved Vital Strike'] },

  { id:'archery', label:'Deadeye Archer', roles:['martial'], classes:['Ranger','Fighter','Gunslinger'], weapon:'ranged',
    favors:{dex:2,wis:1}, minLevel:1,
    feats:['Point-Blank Shot','Precise Shot','Rapid Shot','Deadly Aim','Manyshot','Improved Precise Shot','Clustered Shots'] },

  { id:'sword-and-board', label:'Shield Wall', roles:['martial','divine'], weapon:'sword-board',
    favors:{str:1,con:2}, minLevel:1,
    feats:['Shield Focus','Power Attack','Improved Shield Bash','Shield Slam','Bashing Finish','Greater Shield Focus','Toughness'] },

  { id:'two-weapon', label:'Whirling Blades', roles:['martial','skill'], weapon:'twoWeapon',
    favors:{dex:2,str:1}, minLevel:1,
    feats:['Two-Weapon Fighting','Double Slice','Improved Two-Weapon Fighting','Two-Weapon Rend','Greater Two-Weapon Fighting'] },

  { id:'finesse-duelist', label:'Elegant Duelist', roles:['martial','skill'], classes:['Swashbuckler','Rogue','Ninja','Bard','Magus'], weapon:'finesse',
    favors:{dex:2,cha:1}, minLevel:1,
    feats:['Weapon Finesse','Weapon Focus','Slashing Grace','Combat Reflexes','Dodge','Mobility'] },

  { id:'mobile-skirmisher', label:'Wind Dancer', roles:['martial','skill'], weapon:'finesse',
    favors:{dex:2}, minLevel:1,
    feats:['Dodge','Mobility','Combat Reflexes','Spring Attack','Lunge'] },

  { id:'mounted-charger', label:'Lance & Hoof', classes:['Cavalier','Paladin','Samurai','Fighter'], weapon:'mounted',
    favors:{str:2}, minLevel:1,
    feats:['Mounted Combat','Ride-By Attack','Spirited Charge','Power Attack','Furious Focus'] },

  { id:'maneuver-bruiser', label:'Bonebreaker', roles:['martial'], weapon:'twoHanded',
    favors:{str:2,con:1}, minLevel:1,
    feats:['Power Attack','Improved Bull Rush','Improved Sunder','Combat Reflexes','Stand Still','Lunge'] },

  { id:'rager', label:'Unstoppable Rager', classes:['Barbarian','Bloodrager','Skald'], weapon:'twoHanded',
    favors:{str:2,con:1}, minLevel:1,
    feats:['Power Attack','Furious Focus','Raging Vitality','Extra Rage','Extra Rage Power'] },

  { id:'unarmed', label:'Iron Fist', classes:['Monk','Brawler'], weapon:'unarmed',
    favors:{dex:1,str:1,wis:1}, minLevel:1,
    feats:['Dodge','Mobility','Combat Reflexes','Power Attack','Spring Attack'] },

  // --- Casters ---
  { id:'blaster-evoker', label:'Stormcaller', roles:['arcane'], classes:['Wizard','Sorcerer','Arcanist','Magus'], weapon:'none',
    favors:{int:1,cha:1}, minLevel:1, requiresCasting:true,
    feats:['Spell Focus','Spell Penetration','Greater Spell Focus','Empower Spell','Greater Spell Penetration','Maximize Spell','Quicken Spell'] },

  { id:'controller', label:'Puppeteer', roles:['arcane','divine'], weapon:'none',
    favors:{int:1,wis:1,cha:1}, minLevel:1, requiresCasting:true,
    feats:['Spell Focus','Improved Initiative','Greater Spell Focus','Spell Penetration','Heighten Spell','Quicken Spell'] },

  { id:'summoner-conjurer', label:'Caller of Beasts', roles:['arcane','divine','nature'], weapon:'none',
    favors:{int:1,cha:1,wis:1}, minLevel:1, requiresCasting:true,
    feats:['Spell Focus','Augment Summoning','Spell Penetration','Greater Spell Focus'] },

  { id:'battle-caster', label:'War Mage', roles:['gish','divine'], classes:['Magus','Warpriest','Cleric','Bloodrager','Inquisitor'], weapon:'oneHand',
    favors:{str:1,wis:1,int:1}, minLevel:1, requiresCasting:true,
    feats:['Combat Casting','Power Attack','Weapon Focus','Toughness','Iron Will'] },

  // --- Fallback (NO gates) — the only bundle guaranteed eligible for every
  // class (occult non-casters are locked out of the requiresCasting bundles);
  // the pipeline also drains leftover slots from this chain when a rolled
  // bundle runs dry at high level.
  { id:'generalist', label:'Seasoned Adventurer', favors:{}, minLevel:1,
    feats:['Toughness','Improved Initiative','Iron Will','Great Fortitude','Lightning Reflexes','Dodge','Combat Reflexes','Alertness','Athletic'] },
];

/* ---------------------------------------------------------------------------
 * 7. SPELL THEMES  (per spell-list, FLAT priority-ordered name lists)
 * Keyed by the THEME-lookup list in classProfiles[cls].list. CONTRACT: the
 * pipeline uses classProfiles.list to pick a theme, but PF.CASTERS[cls].list
 * for actual level bucketing/legality — the two DIVERGE for Sorcerer (themes
 * under Wizard, levels from Sorcerer list) and Inquisitor (themes under
 * Cleric, levels from Inquisitor list); off-list names are skipped per the
 * usual contract. Shared coverage: Wizard themes -> Wizard/Sorcerer/Arcanist;
 * Cleric -> Cleric/Oracle/Warpriest/Inquisitor; Druid -> Druid/Hunter;
 * Bard -> Bard/Skald. Ranger has its OWN list (371 spells, L1-4) and themes.
 * Ninja: engine lists it as a caster but ZERO spells exist on a Ninja list —
 * pipeline must treat empty caster lists as non-casters.
 *
 * Each theme is a FLAT `spells:[...]` list ordered by priority (roughly low ->
 * high level). The generator looks up each spell's ACTUAL level on the chosen
 * class's list and buckets it there, filling each castable level up to that
 * class's known/prepared count; off-list or unknown names are skipped, and
 * remaining high-level slots are back-filled by the pipeline. This means we do
 * NOT hardcode spell levels here (the data owns them) — a theme is just "these
 * spells, in this order of preference." NAMING: every word capitalized
 * ("Cone Of Cold"), modifiers suffixed ("Invisibility, Greater" / "Heal, Mass"
 * / "Create Greater Undead"), apostrophes require "double quotes".
 * EXPAND: deepen high-level picks; add occult-class lists if the engine grows
 * spellcasting support for Psychic/Mesmerist/Occultist/etc.
 * ------------------------------------------------------------------------- */
PFGENDATA.spellThemes = {
  // ===== ARCANE (Wizard / Sorcerer / Arcanist) =====
  Wizard: [
    { id:"evoker", label:"Evoker — Blasting", spells:[
      "Acid Splash","Ray Of Frost","Magic Missile","Burning Hands","Shocking Grasp","Mage Armor","Shield",
      "Scorching Ray","Acid Arrow","Flaming Sphere","Mirror Image","Glitterdust","Fireball","Lightning Bolt",
      "Haste","Dispel Magic","Fly","Wall Of Fire","Ice Storm","Dimension Door","Invisibility, Greater",
      "Black Tentacles","Cone Of Cold","Cloudkill","Wall Of Force","Teleport","Feeblemind","Chain Lightning",
      "Disintegrate","Dispel Magic, Greater","Freezing Sphere","True Seeing","Delayed Blast Fireball",
      "Prismatic Spray","Forcecage","Plane Shift","Polar Ray","Horrid Wilting","Maze","Moment Of Prescience",
      "Meteor Swarm","Time Stop","Prismatic Sphere","Power Word Kill"] },
    { id:"controller", label:"Enchanter — Control & Illusion", spells:[
      "Daze","Ghost Sound","Mage Hand","Charm Person","Grease","Color Spray","Enlarge Person","Mage Armor",
      "Glitterdust","Web","Invisibility","Hideous Laughter","Blur","Haste","Slow","Stinking Cloud","Hold Person",
      "Displacement","Black Tentacles","Confusion","Charm Monster","Dimension Door","Hold Monster",
      "Dominate Person","Feeblemind","Cloudkill","Wall Of Force","Suggestion, Mass","Dispel Magic, Greater",
      "Disintegrate","Flesh To Stone","Repulsion","Insanity","Reverse Gravity","Hold Person, Mass","Forcecage",
      "Irresistible Dance","Maze","Mind Blank","Prismatic Wall","Dominate Monster","Wail Of The Banshee",
      "Weird","Time Stop"] },
    { id:"conjurer", label:"Conjurer — Summoning", spells:[
      "Acid Splash","Mage Hand","Summon Monster I","Mage Armor","Grease","Unseen Servant","Color Spray",
      "Summon Monster II","Web","Glitterdust","Acid Arrow","Create Pit","Summon Monster III","Stinking Cloud",
      "Sleet Storm","Phantom Steed","Summon Monster IV","Black Tentacles","Dimension Door","Solid Fog",
      "Summon Monster V","Cloudkill","Wall Of Stone","Teleport","Summon Monster VI","Acid Fog","Wall Of Iron",
      "Planar Binding","Summon Monster VII","Forcecage","Plane Shift","Teleport, Greater","Summon Monster VIII",
      "Maze","Incendiary Cloud","Planar Binding, Greater","Summon Monster IX","Gate","Teleportation Circle",
      "Meteor Swarm"] },
    { id:"necromancer", label:"Necromancer — Death & Fear", spells:[
      "Disrupt Undead","Touch Of Fatigue","Bleed","Chill Touch","Ray Of Enfeeblement","Cause Fear","Mage Armor",
      "Shield","False Life","Command Undead","Blindness/Deafness","Spectral Hand","Scare","Vampiric Touch",
      "Ray Of Exhaustion","Animate Dead","Bestow Curse","Enervation","Fear","Contagion","Black Tentacles",
      "Waves Of Fatigue","Magic Jar","Blight","Feeblemind","Circle Of Death","Create Undead","Eyebite",
      "Undeath To Death","Finger Of Death","Waves Of Exhaustion","Control Undead","Horrid Wilting",
      "Create Greater Undead","Clone","Trap The Soul","Wail Of The Banshee","Energy Drain","Soul Bind",
      "Power Word Kill"] },
  ],
  // ===== DIVINE (Cleric / Oracle / Warpriest / Inquisitor) =====
  Cleric: [
    { id:"healer", label:"Healer", spells:[
      "Stabilize","Detect Magic","Guidance","Light","Resistance","Cure Light Wounds","Bless","Shield Of Faith",
      "Protection From Evil","Divine Favor","Cure Moderate Wounds","Restoration, Lesser","Aid","Remove Paralysis",
      "Status","Cure Serious Wounds","Remove Disease","Prayer","Dispel Magic","Magic Circle Against Evil",
      "Cure Critical Wounds","Restoration","Death Ward","Neutralize Poison","Freedom Of Movement",
      "Cure Light Wounds, Mass","Breath Of Life","Spell Resistance","Raise Dead","True Seeing",
      "Cure Moderate Wounds, Mass","Heal","Heroes' Feast","Cure Serious Wounds, Mass","Resurrection","Regenerate",
      "Restoration, Greater","Cure Critical Wounds, Mass","Earthquake","Heal, Mass","True Resurrection","Miracle"] },
    { id:"war", label:"War Priest — Buff & Smite", spells:[
      "Guidance","Light","Resistance","Divine Favor","Bless","Shield Of Faith","Doom","Protection From Evil",
      "Spiritual Weapon","Bull's Strength","Aid","Sound Burst","Hold Person","Magic Vestment","Prayer",
      "Searing Light","Dispel Magic","Bestow Curse","Divine Power","Holy Smite","Spiritual Ally","Air Walk",
      "Restoration","Righteous Might","Flame Strike","Slay Living","Spell Resistance","True Seeing","Blade Barrier",
      "Harm","Heal","Bull's Strength, Mass","Dispel Magic, Greater","Destruction","Fire Storm","Holy Word",
      "Summon Monster VII","Earthquake","Implosion","Storm Of Vengeance","Gate"] },
    { id:"shadow", label:"Death Priest — Debuff & Undeath", spells:[
      "Bleed","Guidance","Detect Magic","Resistance","Bane","Cause Fear","Doom","Inflict Light Wounds",
      "Protection From Good","Death Knell","Hold Person","Desecrate","Inflict Moderate Wounds","Silence",
      "Animate Dead","Bestow Curse","Inflict Serious Wounds","Contagion","Searing Light","Inflict Critical Wounds",
      "Unholy Blight","Poison","Death Ward","Freedom Of Movement","Slay Living","Inflict Light Wounds, Mass",
      "Plane Shift","Harm","Create Undead","Blade Barrier","Word Of Recall","Destruction","Blasphemy",
      "Create Greater Undead","Unholy Aura","Antimagic Field","Energy Drain","Implosion"] },
  ],
  // ===== NATURE (Druid / Ranger / Hunter) =====
  Druid: [
    { id:"elementalist", label:"Elementalist — Storm & Flame", spells:[
      "Create Water","Detect Magic","Flare","Guidance","Light","Produce Flame","Faerie Fire","Entangle",
      "Obscuring Mist","Cure Light Wounds","Flaming Sphere","Flame Blade","Barkskin","Heat Metal","Fog Cloud",
      "Call Lightning","Sleet Storm","Protection From Energy","Ice Storm","Flame Strike","Cure Serious Wounds",
      "Air Walk","Wall Of Thorns","Call Lightning Storm","Stoneskin","Baleful Polymorph","Fire Seeds","Sirocco",
      "Wall Of Stone","Dispel Magic, Greater","Fire Storm","Sunbeam","Heal","Animate Plants","Sunburst",
      "Whirlwind","Earthquake","Storm Of Vengeance","Elemental Swarm"] },
    { id:"warden", label:"Wild Warden — Battlefield", spells:[
      "Detect Magic","Guidance","Know Direction","Resistance","Entangle","Longstrider","Goodberry",
      "Cure Light Wounds","Faerie Fire","Spike Growth","Barkskin","Hold Animal","Stone Call","Fog Cloud",
      "Spike Stones","Sleet Storm","Call Lightning","Remove Disease","Command Plants","Ice Storm",
      "Cure Serious Wounds","Freedom Of Movement","Wall Of Thorns","Baleful Polymorph","Stoneskin","Tree Stride",
      "Wall Of Stone","Stone Tell","Dispel Magic, Greater","Cure Light Wounds, Mass","Heal","Creeping Doom",
      "Animate Plants","Repel Metal Or Stone","Animal Shapes","Earthquake","Shambler","World Wave",
      "Storm Of Vengeance"] },
    { id:"beastmaster", label:"Beastmaster — Summon & Shape", spells:[
      "Detect Magic","Guidance","Light","Stabilize","Summon Nature's Ally I","Magic Fang","Charm Animal",
      "Cure Light Wounds","Summon Nature's Ally II","Barkskin","Dominate Animal","Summon Nature's Ally III",
      "Magic Fang, Greater","Summon Nature's Ally IV","Animal Growth","Cure Serious Wounds",
      "Summon Nature's Ally V","Tree Stride","Summon Nature's Ally VI","Stone Tell","Summon Nature's Ally VII",
      "Heal","Animate Plants","Summon Nature's Ally VIII","Animal Shapes","Summon Nature's Ally IX","Shapechange",
      "Elemental Swarm"] },
  ],
  // ===== RANGER (own list, spell levels 1-4) =====
  Ranger: [
    { id:"deadeye", label:"Deadeye — Archery & the Hunt", spells:[
      "Gravity Bow","Longshot","Aspect Of The Falcon","Hunter's Howl","Longstrider","Endure Elements",
      "Cure Light Wounds","Barkskin","Hunter's Eye","Perceive Cues","Cat's Grace","Wind Wall","Chameleon Stride",
      "Named Bullet","Instant Enemy","Darkvision","Cure Moderate Wounds","Aspect Of The Stag","Water Walk",
      "Bow Spirit","Freedom Of Movement","Cure Serious Wounds","Nondetection","Commune With Nature"] },
    { id:"warden", label:"Warden — Wilderness & Companion", spells:[
      "Entangle","Longstrider","Pass Without Trace","Magic Fang","Delay Poison","Lead Blades",
      "Summon Nature's Ally I","Feather Step","Barkskin","Spike Growth","Snare","Hold Animal","Bloodhound",
      "Summon Nature's Ally II","Cure Light Wounds","Versatile Weapon","Magic Fang, Greater","Remove Disease",
      "Neutralize Poison","Summon Nature's Ally III","Cure Moderate Wounds","Protection From Energy",
      "Animal Growth","Terrain Bond","Tree Stride","Summon Nature's Ally IV","Cure Serious Wounds",
      "Freedom Of Movement"] },
  ],
  // ===== BARD / SKALD =====
  Bard: [
    { id:"enchanter", label:"Enchanter — Charm & Command", spells:[
      "Daze","Ghost Sound","Lullaby","Message","Charm Person","Hideous Laughter","Sleep","Grease",
      "Cure Light Wounds","Hold Person","Suggestion","Blindness/Deafness","Calm Emotions","Confusion",
      "Charm Monster","Good Hope","Dispel Magic","Dominate Person","Hold Monster","Shout","Cure Critical Wounds",
      "Suggestion, Mass","Mind Fog","Shadow Walk","Irresistible Dance","Geas/Quest","Heroism, Greater"] },
    { id:"maestro", label:"Maestro — Buff & Support", spells:[
      "Detect Magic","Mage Hand","Prestidigitation","Resistance","Cure Light Wounds","Heroism","Saving Finale",
      "Grease","Remove Fear","Mirror Image","Cure Moderate Wounds","Glitterdust","Blur","Haste","Good Hope",
      "Displacement","Dispel Magic","Cure Critical Wounds","Freedom Of Movement","Shout","Dimension Door",
      "Cure Light Wounds, Mass","Heroism, Greater","Shadow Walk","Cure Moderate Wounds, Mass","Heroes' Feast",
      "Project Image"] },
    { id:"trickster", label:"Trickster — Illusion & Stealth", spells:[
      "Ghost Sound","Dancing Lights","Mage Hand","Disguise Self","Silent Image","Ventriloquism","Charm Person",
      "Invisibility","Mirror Image","Minor Image","Glitterdust","Major Image","Displacement","Confusion",
      "Gaseous Form","Invisibility, Greater","Hallucinatory Terrain","Mislead","Shadow Evocation","Mind Fog",
      "Project Image","Veil"] },
  ],
  // ===== WITCH =====
  Witch: [
    { id:"hexweaver", label:"Hexweaver — Control", spells:[
      "Daze","Detect Magic","Touch Of Fatigue","Light","Ill Omen","Mage Armor","Charm Person","Sleep","Command",
      "Hold Person","Web","Blindness/Deafness","False Life","Bestow Curse","Vampiric Touch","Dispel Magic",
      "Stinking Cloud","Confusion","Black Tentacles","Charm Monster","Hold Monster","Dominate Person","Feeblemind",
      "Baleful Polymorph","Dispel Magic, Greater","Suggestion, Mass","Slay Living","Insanity","Hold Person, Mass",
      "Irresistible Dance","Horrid Wilting","Trap The Soul","Dominate Monster","Wail Of The Banshee",
      "Power Word Kill"] },
    { id:"plaguebringer", label:"Plaguebringer — Curse & Decay", spells:[
      "Bleed","Touch Of Fatigue","Detect Magic","Daze","Ray Of Enfeeblement","Cause Fear","Chill Touch",
      "Mage Armor","Blindness/Deafness","Death Knell","False Life","Frostbite","Bestow Curse","Vampiric Touch",
      "Ray Of Exhaustion","Enervation","Fear","Slay Living","Waves Of Fatigue","Feeblemind","Harm","Eyebite",
      "Waves Of Exhaustion","Horrid Wilting","Symbol Of Death","Wail Of The Banshee"] },
  ],
  // ===== MAGUS =====
  Magus: [
    { id:"spellblade", label:"Spellblade — Spellstrike", spells:[
      "Acid Splash","Detect Magic","Light","Ray Of Frost","Shocking Grasp","True Strike","Frostbite","Shield",
      "Enlarge Person","Frigid Touch","Mirror Image","Bull's Strength","Blur","Vampiric Touch","Haste",
      "Displacement","Force Hook Charge","Dimension Door","Wall Of Fire","Invisibility, Greater","Stoneskin",
      "Cone Of Cold","Teleport","Baleful Polymorph","Chain Lightning","Disintegrate","True Seeing"] },
    { id:"warmage", label:"War Mage — Blast & Defend", spells:[
      "Acid Splash","Detect Magic","Light","Daze","Shocking Grasp","Magic Missile","Shield","Color Spray",
      "Scorching Ray","Acid Arrow","Mirror Image","Blur","Fireball","Lightning Bolt","Haste","Sleet Storm",
      "Ice Storm","Black Tentacles","Dimension Door","Stoneskin","Cone Of Cold","Overland Flight",
      "Chain Lightning","Disintegrate","Dispel Magic, Greater"] },
  ],
  // ===== SUMMONER =====
  Summoner: [
    { id:"conductor", label:"Conductor — Eidolon Buffs", spells:[
      "Mage Armor","Shield","Enlarge Person","Rejuvenate Eidolon, Lesser","Summon Monster I","Magic Fang",
      "Bull's Strength","Haste","Barkskin","Glitterdust","Summon Monster II","Heroism","Black Tentacles",
      "Displacement","Stoneskin","Dimension Door","Invisibility, Greater","Summon Monster IV","Teleport",
      "Wall Of Stone","Summon Monster V","Heroism, Greater","True Seeing","Summon Monster VII","Dominate Monster",
      "Summon Monster VIII"] },
    { id:"warder", label:"Warder — Defense & Control", spells:[
      "Mage Armor","Shield","Protection From Evil","Grease","Summon Monster I","Glitterdust","Barkskin",
      "Summon Monster II","Black Tentacles","Stoneskin","Dispel Magic","Wall Of Ice","Summon Monster IV",
      "Dimension Door","Baleful Polymorph","Wall Of Stone","Teleport","Summon Monster V","True Seeing",
      "Dispel Magic, Greater","Summon Monster VII"] },
  ],
  // ===== ALCHEMIST / INVESTIGATOR (extracts) =====
  Alchemist: [
    { id:"mutagenist", label:"Mutagenist — Self Buff", spells:[
      "Shield","Enlarge Person","True Strike","Cure Light Wounds","Bomber's Eye","Bull's Strength","Barkskin",
      "Invisibility","Blur","Cat's Grace","Heroism","Displacement","Haste","Fly","Invisibility, Greater",
      "Stoneskin","Freedom Of Movement","Cure Critical Wounds","Overland Flight","Spell Resistance",
      "Beast Shape III","Heal","True Seeing","Tongues"] },
    { id:"chirurgeon", label:"Chirurgeon — Heal & Restore", spells:[
      "Cure Light Wounds","Shield","Endure Elements","Touch Of The Sea","Cure Moderate Wounds","Restoration, Lesser",
      "Delay Poison","See Invisibility","Cure Serious Wounds","Remove Disease","Neutralize Poison","Heroism",
      "Cure Critical Wounds","Restoration","Death Ward","Freedom Of Movement","Spell Resistance","Heal",
      "True Seeing"] },
  ],
  // ===== PALADIN =====
  Paladin: [
    { id:"crusader", label:"Crusader — Smite & Buff", spells:[
      "Divine Favor","Bless Weapon","Bless","Protection From Evil","Cure Light Wounds","Bull's Strength",
      "Litany Of Righteousness","Shield Other","Resist Energy","Magic Weapon, Greater","Magic Circle Against Evil",
      "Prayer","Holy Sword","Cure Serious Wounds","Dispel Magic","Restoration"] },
    { id:"defender", label:"Defender — Protect & Mend", spells:[
      "Cure Light Wounds","Restoration, Lesser","Divine Favor","Shield Other","Resist Energy","Bull's Strength",
      "Magic Circle Against Evil","Daylight","Remove Curse","Cure Serious Wounds","Restoration","Neutralize Poison",
      "Holy Sword","Death Ward"] },
  ],
  // ===== BLOODRAGER (mostly L1-4) =====
  Bloodrager: [
    { id:"bloodrager", label:"Bloodrager — Rage Magic", spells:[
      "Shocking Grasp","Enlarge Person","Shield","True Strike","Mage Armor","Magic Missile","Burning Hands",
      "Bull's Strength","Mirror Image","Frigid Touch","Scorching Ray","Resist Energy","Fireball","Lightning Bolt",
      "Haste","Magic Weapon, Greater","Rage","Vampiric Touch","Stoneskin","Ice Storm","Fear","Wall Of Fire",
      "Elemental Body I","Beast Shape II"] },
  ],
  // ===== SHAMAN =====
  Shaman: [
    { id:"spiritspeaker", label:"Spirit Speaker — Hex & Curse", spells:[
      "Guidance","Detect Magic","Stabilize","Light","Bane","Cause Fear","Inflict Light Wounds","Cure Light Wounds",
      "Doom","Hold Person","Spiritual Weapon","Frostbite","Inflict Moderate Wounds","Bestow Curse","Call Lightning",
      "Magic Vestment","Inflict Serious Wounds","Divine Power","Fear","Ice Storm","Cure Critical Wounds",
      "Slay Living","Flame Strike","Baleful Polymorph","Harm","Heal","Dispel Magic, Greater","Fire Storm",
      "Horrid Wilting","Sunburst","Wail Of The Banshee","Storm Of Vengeance"] },
    { id:"mender", label:"Mender — Heal & Restore", spells:[
      "Guidance","Stabilize","Detect Magic","Resistance","Cure Light Wounds","Bless","Protection From Evil",
      "Remove Fear","Cure Moderate Wounds","Restoration, Lesser","Aid","Remove Paralysis","Resist Energy",
      "Cure Serious Wounds","Remove Blindness/Deafness","Magic Vestment","Cure Critical Wounds","Restoration",
      "Divine Power","Neutralize Poison","Cure Light Wounds, Mass","Breath Of Life","Heal","Restoration, Greater",
      "Cure Moderate Wounds, Mass","Cure Serious Wounds, Mass","Regenerate","Cure Critical Wounds, Mass",
      "Heal, Mass"] },
  ],
};

/* ---------------------------------------------------------------------------
 * 8. GEAR KITS  (keyed by concept.weaponPref; armor chosen from defense tier)
 * Generator buys what the budget for the rolled level allows; these are the
 * THEMED priorities. Weapon/armor names are real (data/weapons.js, armors.js).
 * `armorByTier` lets one kit serve light/medium/heavy users.
 * ------------------------------------------------------------------------- */
PFGENDATA.gearKits = {
  twoHanded:  { weapons:['Greatsword','Greataxe','Falchion'],            misc:['Backpack'] },
  oneHand:    { weapons:['Longsword','Warhammer','Battleaxe'],           misc:['Backpack'] },
  'sword-board':{ weapons:['Longsword','Heavy Steel Shield','Warhammer'], misc:['Backpack'] },
  twoWeapon:  { weapons:['Shortsword','Shortsword','Kukri'],             misc:['Backpack'] },
  finesse:    { weapons:['Rapier','Dagger','Shortsword'],                misc:['Backpack'] },
  ranged:     { weapons:['Longbow','Dagger'],                            misc:['Arrows (20)','Backpack'] },
  mounted:    { weapons:['Lance','Longsword'],                           misc:['Backpack'] },
  unarmed:    { weapons:['Sai','Nunchaku'],                              misc:['Backpack'] },
  natural:    { weapons:['Dagger'],                                      misc:['Backpack'] },
  none:       { weapons:['Dagger','Quarterstaff'],                       misc:['Spell Component Pouch','Backpack'] },
  // Armor offered by the class's defense tier, best-first — each tier ends in
  // cheap fallbacks so a level-1 budget still buys SOMETHING wearable
  armorByTier: {
    heavy:  ['Full plate','Half-plate','Breastplate','Chainmail','Scale mail','Leather'],
    medium: ['Breastplate','Chain shirt','Scale mail','Hide','Leather'],
    light:  ['Chain shirt','Studded leather','Leather','Padded'],
    none:   [],
  },
};

/* ---------------------------------------------------------------------------
 * 9. WEALTH BY LEVEL  (PF1e Core "Character Wealth by Level" table)
 * Index 0 = level 1 (average class starting wealth). The generator buys the
 * gear kit from this budget and banks the remainder as coin — mundane gear
 * only for now (EXPAND: spend high-level wealth on magic weapons/armor).
 * ------------------------------------------------------------------------- */
PFGENDATA.wealthByLevel = [
  150, 1000, 3000, 6000, 10500, 16000, 23500, 33000, 46000, 62000,
  82000, 108000, 140000, 185000, 240000, 315000, 410000, 530000, 685000, 880000,
];
