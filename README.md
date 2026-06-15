# Character Sheets — Pathfinder 1e Character Vault

A local, offline web app for creating, managing, and *playing* Pathfinder First Edition
characters, with the published rules content compiled in from freely available, OGL-licensed
datasets. No install, no account, no server — it's a static site and all of your data stays in
your browser.

## Running it

Everything is static — open it however you like:

- **Easiest:** double-click `index.html` (works straight from disk), or
- Serve it: `python -m http.server 8741` in this folder, then open <http://localhost:8741>.

Characters are saved automatically in your browser (localStorage). Use **Export** on a
character card to back one up as a JSON file, and **Import JSON** to restore or share.

On narrow screens (phones, small windows) the layout adapts, and the side menu can be collapsed
with **« Hide menu** to free up space — a floating **☰** button brings it back. The preference
is remembered.

## What's included

Compiled from three freely available OGL datasets covering the whole Pathfinder 1e line
(2009–2019): the official PRD via [PSRD-Data](https://github.com/devonjones/PSRD-Data)
(16 hardcovers), the [FoundryVTT pf1 system](https://gitlab.com/foundryvtt_pathfinder1e/foundryvtt-pathfinder1)
compendia (later hardcovers: Occult Adventures, Ultimate Intrigue, Horror Adventures,
Ultimate Wilderness, Pathfinder Unchained…), and the
[PathfinderUtilities](https://github.com/GammaRBurst/PathfinderUtilities) feat database
(all 165 books incl. Player Companions, Campaign Setting volumes and Adventure Paths):

| Content | Count |
| --- | --- |
| Classes (core, base, hybrid, occult, vigilante, shifter, unchained, prestige, NPC) | 67 |
| Archetypes | 386 |
| Feats — the complete corpus from all 165 books | 3,695 |
| Spells (class lists, schools, full descriptions; incl. all psychic magic) | 2,944 |
| Equipment & magic items | 3,354 |
| Weapons / armor with full stat blocks | 603 / 102 |
| Playable races | 79 |
| Alternate racial traits | 293 |
| Character traits | 226 |
| Skills | 26 |
| Buffs & spell effects (25 curated + the full spell library) | ~2,950 |
| Companion species (animal companions, familiars, eidolon forms) | 69 + |

## Features

### Building a character

- **Roster** — multiple characters, duplicate, export/import JSON, print.
- **Abilities** — point buy (with budget tracking), 4d6 roller, or manual; racial modifiers
  (including flexible "+2 any" races), level increases and enhancement bonuses tracked separately.
- **Race** — every race with parsed size, speed, languages and racial traits; alternate racial
  trait picker.
- **Classes** — level-by-level multiclassing, archetype notes, favored class bonuses,
  average/rolled/max HP, full progression tables in-app. The class dropdown remembers your last
  pick so adding several levels in a row is quick.
- **Skills** — per-rank tracking with class-skill +3, armor check penalty, ability mods and
  point-budget validation (incl. favored class and human bonus ranks). Any skill can be toggled
  as a class skill (for traits/archetypes/homebrew), and you can add custom skills.
- **Feats & traits** — searchable pickers with full benefit text. The feat picker **evaluates
  prerequisites against your character** (✓/✗/? per feat — ability scores, BAB, feat chains,
  skill ranks, class/caster levels, spellcasting; class features it can't verify show "?"),
  offers a **"Qualified only"** filter, and a **feat-tree sort** that nests each chain under its
  base feat. You can still take feats you don't qualify for — they're flagged ⚠ with the unmet
  requirements on the Feats tab and the printed sheet, and the hover popover shows the
  clause-by-clause check.
- **Spells** — slots per day including ability-bonus slots, save DCs, spells known for
  spontaneous casters, and a spell browser filtered to your class's list.
- **Gear** — weapons/armor/items with real stats; AC, max Dex, ACP, speed and encumbrance
  computed from what you equip; money tracking. Each weapon/armor has an **✨ enchantment**
  editor (enhancement bonus, masterwork, special abilities, bonus damage dice) that feeds attack,
  damage, AC and the armor check penalty, displaying as e.g. "+1 Flaming Longsword" everywhere.
  **Ammunition** is recognized automatically and tracked as a quantity rather than listed as an
  attack.
- **Companions** — connected subsheets for animal companions & mounts, familiars, eidolons, and
  cohorts/followers, each auto-scaled from your effective class level (HD, BAB, saves, abilities,
  evolution pools, Leadership counts…). Cohorts can link to another character in your vault.

### Playing a character

- **▶ Play** — in-session management on its own tab: current HP with damage/heal/temp/nonlethal
  (flags disabled/dying/unconscious), spell-slot expenditure per class and level, and a **Rest**
  button (restores slots, clears nonlethal, heals level HP — and heals companions their HD).
  - **Buffs & conditions** with proper bonus-type stacking that live-update AC, saves, attacks,
    skills and speed. The **+ Buff / Spell Effect** picker covers the **entire spell database**
    (~2,950 entries, searchable by class/level/school): the 25 hand-curated effects (Haste,
    Bull's Strength…) carry precise mechanics, and every other spell has its bonuses **auto-parsed
    from its description**; anything the parser can't read is still addable as a tracked effect and
    refined with "edit". All 16 standard conditions and a from-scratch custom builder round it out.
  - **Custom roll buttons** in four flavors: an **Attack** that scales with your BAB, ability,
    size and active buffs (with Str-to-damage multiplier and bonus dice), an **ability check /
    maneuver** (d20 + a live ability modifier, optionally +BAB), a fixed **d20 + modifier**, or a
    **flat dice** roll like `3d6` / `8d6`.
  - **Click-to-roll** chips for initiative, saves, attacks (with damage dice) and skills, with a
    nat-20/nat-1 aware roll log; **trackers** for charges/ammo/rage rounds; and an **ammunition**
    counter with −/＋ for shots fired.
  - **Companions fight too** — each gets its own HP tracker, roll chips parsed from its stat block,
    quick Atk/Dmg/AC/Saves adjustments, and custom attacks that scale with its stats.
- **Sheet** — printable parchment-style character sheet. Saves and skill totals are
  click-to-roll there too. Hovering any underlined term — feats, traits, spells, gear, skills,
  class, race, companion species — pops up a card with its full rules text. **Print** opens the
  browser dialog; **Download PDF** generates a clean, **native** US-letter PDF (selectable text,
  page breaks that never split a table row, page numbers) using locally bundled jsPDF.

### Reference & customization

- **Rules Library** — browse and search everything above, independent of any character.
- **Homebrew content** — every picker (feats, spells, traits, racial traits, archetypes, weapons,
  armor, items, animal companions, familiars) has a **+ Homebrew** button to add a custom entry to
  your database, and the Skills tab has **+ Custom skill**. Homebrew entries persist, appear in
  pickers / the Library / hover popovers marked "Homebrew", feed the same calculations as published
  content, and can be deleted from the Library.

## Known limits

- The 12 post-PRD classes (Psychic, Kineticist, Vigilante, Shifter, unchained variants, …) carry
  full descriptions, accurate class skills/HD/saves/BAB, per-level class features in the Special
  column, and spell slots from the standard 9/6/4-level progression tables. BAB and saves are
  derived from the class's standard categories rather than a transcribed table, and the Special
  column lists the headline feature(s) gained at each level (some incremental higher-level gains —
  e.g. an ability's numeric scaling — may not be itemized).
- Archetypes and alternate racial traits cover the PRD books; post-2014 softcover archetypes
  aren't included (add via Homebrew if needed).
- Archetypes are informational — the app shows their rules text but doesn't automatically swap
  class features in the calculations.
- Auto-parsed spell buffs aren't perfect — complex or oddly-worded spells may parse partially or
  not at all (then editable by hand), and scaling values land at a base you may need to bump.
- Conditional modifiers the app doesn't compute (rage, magic items, etc.) go in the **Notes** tab's
  adjustment fields; the Play tab's buffs cover most situational effects live.
- Storage is per-browser localStorage — there's no cloud sync or shared accounts. Use Export/Import
  to move characters between devices.

## Rebuilding the data

The `data/*.js` files are generated by `build_data.py` from the source datasets. The raw source
downloads (~280 MB) are **not** committed to the repo — only the compiled `data/*.js` the app
needs at runtime. To regenerate them, re-download the sources (the PSRD-Data sqlite books, the
FoundryVTT pf1 packs, and the PathfinderUtilities feat database — see the links above), place them
where `build_data.py` expects, then run:

```
python build_data.py
```

## Hosting

It's a static site with relative paths, so any static host works and updates are just a push:

- **GitHub Pages** — Settings → Pages → deploy from `main` / root. Push to update.
- **Cloudflare Pages / Netlify** — connect the repo, no build command, output dir `/`; adds a
  custom domain and Brotli compression.

Over the wire the dataset is ~3.3 MB gzipped (≈2.7 MB with Brotli) and cached after the first
load; the `?v=` query strings on the script/style tags ensure clients pick up updates. Saved
characters live in localStorage keyed to the site's origin, so deploying updates to the same URL
never wipes anyone's characters.

## License & attribution

All game content is Open Game Content under the OGL v1.0a, sourced from the community datasets
linked above. This app is a fan-made tool and is not affiliated with or endorsed by Paizo Inc.
