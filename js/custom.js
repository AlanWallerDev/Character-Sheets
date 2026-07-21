/* Homebrew content: user-created entries persisted in localStorage and merged
   into PFDATA so they behave exactly like published content everywhere. */
'use strict';

const Custom = (() => {
  const STORE = 'pf1e.vault.custom';
  const esc = Library.esc;   // custom.js loads after library.js (see index.html)

  const splitList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const para = s => s ? '<p>' + esc(s).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>' : '';

  function parseScores(text, defaults) {
    const vals = Object.assign({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, defaults || {});
    for (const m of String(text || '').matchAll(/(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/gi)) {
      vals[m[1].toLowerCase()] = parseInt(m[2], 10);
    }
    return vals;
  }

  function parseSpellLevels(text) {
    const levels = {};
    for (const part of splitList(text)) {
      const m = /^(.+?)\s+(\d)$/.exec(part.trim());
      if (m) levels[m[1].trim()] = parseInt(m[2], 10);
    }
    return levels;
  }

  const ABILITY_OPTS = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
                        ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
  const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation',
                   'illusion', 'necromancy', 'transmutation', 'universal'];

  // field kinds: text (default), textarea, select [options], check
  const SCHEMAS = {
    feats: {
      label: 'Feat',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'types', label: 'Types (comma-separated)', ph: 'Combat, Teamwork' },
        { k: 'prereq', label: 'Prerequisites', ph: 'Str 13, Power Attack' },
        { k: 'desc', label: 'Short description' },
        { k: 'benefit', label: 'Benefit', kind: 'textarea' },
        { k: 'normal', label: 'Normal', kind: 'textarea' },
        { k: 'special', label: 'Special', kind: 'textarea' },
      ],
      post: f => ({ types: splitList(f.types), desc: f.desc, prereq: f.prereq,
                    benefit: para(f.benefit), normal: para(f.normal), special: para(f.special), body: '' }),
    },
    spells: {
      label: 'Spell',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'school', label: 'School', kind: 'select', options: SCHOOLS },
        { k: 'levelsText', label: 'Class levels (comma-separated)', ph: 'Wizard 3, Summoner 2', req: 1 },
        { k: 'cast', label: 'Casting time', ph: '1 standard action' },
        { k: 'comp', label: 'Components', ph: 'V, S, M (a pinch of dust)' },
        { k: 'range', label: 'Range', ph: 'close (25 ft. + 5 ft./2 levels)' },
        { k: 'duration', label: 'Duration', ph: '1 round/level' },
        { k: 'save', label: 'Saving throw', ph: 'Will negates' },
        { k: 'sr', label: 'Spell resistance', ph: 'yes' },
        { k: 'desc', label: 'Description', kind: 'textarea', req: 1 },
      ],
      post: f => ({ school: f.school, sub: null, descriptor: null,
                    levels: parseSpellLevels(f.levelsText), levelText: f.levelsText,
                    cast: f.cast, comp: f.comp, range: f.range, duration: f.duration,
                    save: f.save, sr: f.sr, desc: (f.desc || '').slice(0, 120), html: para(f.desc) }),
    },
    traits: {
      label: 'Character Trait',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'category', label: 'Category', kind: 'select',
          options: ['Combat', 'Faith', 'Magic', 'Social', 'Regional', 'Religion', 'Race', 'Campaign', 'Drawback', 'Other'] },
        { k: 'desc', label: 'Description', kind: 'textarea', req: 1 },
      ],
      post: f => ({ category: f.category, html: para(f.desc) }),
    },
    racialTraits: {
      label: 'Alternate Racial Trait',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'race', label: 'Race', req: 1, ph: 'Dwarf' },
        { k: 'desc', label: 'Description', kind: 'textarea', req: 1 },
      ],
      post: f => ({ race: f.race, html: para(f.desc) }),
    },
    archetypes: {
      label: 'Archetype',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'class', label: 'Class', req: 1, ph: 'Fighter' },
        { k: 'desc', label: 'Features / rules text', kind: 'textarea', req: 1 },
      ],
      post: f => ({ class: f.class, html: para(f.desc) }),
    },
    classAbilities: {
      label: 'Class Ability',
      fields: [
        { k: 'name', label: 'Name', req: 1, ph: 'Greater Smashing' },
        { k: 'classesText', label: 'Class(es), comma-separated', req: 1, ph: 'Barbarian, Skald' },
        { k: 'kind', label: 'Type', kind: 'select',
          options: [['', '—'], ['Ex', 'Extraordinary (Ex)'], ['Su', 'Supernatural (Su)'], ['Sp', 'Spell-like (Sp)']] },
        { k: 'desc', label: 'Description', kind: 'textarea', req: 1 },
      ],
      post: f => ({ classes: splitList(f.classesText), kind: f.kind || '', html: para(f.desc) }),
    },
    weapons: {
      label: 'Weapon',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'prof', label: 'Proficiency', kind: 'select', options: ['Simple', 'Martial', 'Exotic', 'Firearm'] },
        { k: 'group', label: 'Group', kind: 'select',
          options: ['Light Melee Weapons', 'One-Handed Melee Weapons', 'Two-Handed Melee Weapons', 'Ranged Weapons', 'Ammunition'] },
        { k: 'cost', label: 'Cost', ph: '15 gp' },
        { k: 'dmgS', label: 'Damage (S)', ph: '1d6' },
        { k: 'dmgM', label: 'Damage (M)', ph: '1d8' },
        { k: 'crit', label: 'Critical', ph: '19–20/×2' },
        { k: 'range', label: 'Range', ph: '— or 30 ft.' },
        { k: 'weight', label: 'Weight', ph: '4 lbs.' },
        { k: 'dtype', label: 'Damage type', ph: 'S' },
        { k: 'special', label: 'Special', ph: 'trip, reach' },
      ],
      post: f => f,
    },
    armors: {
      label: 'Armor / Shield',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'group', label: 'Group', kind: 'select', options: ['Light Armor', 'Medium Armor', 'Heavy Armor', 'Shields', 'Extras'] },
        { k: 'cost', label: 'Cost', ph: '150 gp' },
        { k: 'bonus', label: 'Armor/Shield bonus', ph: '+4' },
        { k: 'maxDex', label: 'Max Dex bonus', ph: '+4' },
        { k: 'acp', label: 'Armor check penalty', ph: '–2' },
        { k: 'asf', label: 'Arcane spell failure', ph: '20%' },
        { k: 'spd30', label: 'Speed (30 ft.)', ph: '20 ft.' },
        { k: 'spd20', label: 'Speed (20 ft.)', ph: '15 ft.' },
        { k: 'weight', label: 'Weight', ph: '25 lbs.' },
      ],
      post: f => f,
    },
    items: {
      label: 'Item / Magic Item',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'category', label: 'Category', kind: 'select',
          options: ['Adventuring Gear', 'Wondrous Items', 'Rings', 'Rods', 'Staves', 'Potions', 'Scrolls',
                    'Wands', 'Artifacts', 'Cursed Items', 'Tools and Skill Kits', 'Clothing', 'Other'] },
        { k: 'price', label: 'Price', ph: '2,500 gp' },
        { k: 'weight', label: 'Weight', ph: '1 lb.' },
        { k: 'slot', label: 'Slot', ph: 'neck, belt, none…' },
        { k: 'cl', label: 'Caster level', ph: '5' },
        { k: 'aura', label: 'Aura', ph: 'faint evocation' },
        { k: 'desc', label: 'Description', kind: 'textarea', req: 1 },
      ],
      post: f => ({ category: f.category, sub: '', price: f.price, weight: f.weight,
                    slot: f.slot || null, cl: f.cl || null, aura: f.aura || null, html: para(f.desc) }),
    },
    skills: {
      label: 'Skill',
      fields: [
        { k: 'name', label: 'Name', req: 1, ph: 'Sailing' },
        { k: 'ability', label: 'Key ability', kind: 'select', options: ABILITY_OPTS },
        { k: 'trained', label: 'Trained only', kind: 'check' },
        { k: 'acp', label: 'Armor check penalty applies', kind: 'check' },
        { k: 'desc', label: 'Description', kind: 'textarea' },
      ],
      post: f => ({ ability: f.ability, trained: !!f.trained, acp: !!f.acp,
                    desc: (f.desc || '').slice(0, 120), html: para(f.desc) }),
    },
    companionSpecies: {
      label: 'Animal Companion Species',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'size', label: 'Size', kind: 'select', options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge'] },
        { k: 'speed', label: 'Speed', ph: '40 ft., climb 20 ft.' },
        { k: 'ac', label: 'Natural armor', ph: '+2 natural armor' },
        { k: 'attack', label: 'Attacks', ph: 'bite (1d6), 2 claws (1d4)' },
        { k: 'abilitiesText', label: 'Ability scores', ph: 'Str 13, Dex 15, Con 14, Int 2, Wis 12, Cha 6', req: 1 },
        { k: 'sq', label: 'Special qualities', ph: 'low-light vision, scent' },
        { k: 'sa', label: 'Special attacks', ph: 'trip' },
      ],
      post: f => ({
        base: { size: f.size, speed: f.speed, ac: f.ac, attack: f.attack,
                abilitiesText: f.abilitiesText,
                abilities: { kind: 'scores', vals: parseScores(f.abilitiesText, { int: 2, cha: 6 }) },
                sq: f.sq, sa: f.sa, bonusFeat: '' },
        adv: [],
      }),
    },
    familiarSpecies: {
      label: 'Familiar',
      fields: [
        { k: 'name', label: 'Name', req: 1 },
        { k: 'size', label: 'Size', kind: 'select', options: ['Fine', 'Diminutive', 'Tiny', 'Small'] },
        { k: 'speed', label: 'Speed', ph: '20 ft., fly 40 ft. (good)' },
        { k: 'ac', label: 'AC line', ph: '14, touch 14, flat-footed 12 (+2 Dex, +2 size)' },
        { k: 'melee', label: 'Melee attacks', ph: 'bite +4 (1d3–4)' },
        { k: 'abilitiesText', label: 'Ability scores', ph: 'Str 3, Dex 15, Con 8, Int 2, Wis 12, Cha 7', req: 1 },
        { k: 'senses', label: 'Senses', ph: 'low-light vision' },
        { k: 'skills', label: 'Skills', ph: 'Perception +5, Stealth +10' },
        { k: 'sq', label: 'Special qualities' },
      ],
      post: f => ({ size: f.size, speed: f.speed, ac: f.ac, melee: f.melee,
                    senses: f.senses, skills: f.skills, feats: '', sq: f.sq,
                    abilities: parseScores(f.abilitiesText, { int: 2 }) }),
    },
  };

  // ---------------- store ----------------
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; }
  }
  function saveStore(store) {
    try {
      localStorage.setItem(STORE, JSON.stringify(store));
    } catch (err) {
      // quota exceeded / private mode — the entry still works for this session
      const msg = 'This homebrew entry could not be saved to browser storage' +
        (/quota/i.test(err.message) ? ' (it\'s full)' : '') +
        ' — it will be gone after this tab closes.';
      if (window.UI && window.UI.alert) window.UI.alert(msg, { title: 'Could not save' });
    }
  }

  function dataArray(type) {
    if (type === 'companionSpecies') return (PFDATA.companions || {}).species;
    if (type === 'familiarSpecies') return (PFDATA.companions || {}).familiarSpecies;
    return PFDATA[type];
  }

  function mergeAll() {
    const store = loadStore();
    for (const [type, entries] of Object.entries(store)) {
      const arr = dataArray(type);
      if (!arr) continue;
      for (const e of entries) {
        e.custom = true;
        if (!arr.some(x => x.custom && x.name === e.name)) arr.push(e);
      }
    }
  }

  function add(type, entry) {
    entry.custom = true;
    entry.source = entry.source || 'Homebrew';
    const store = loadStore();
    (store[type] = store[type] || []).push(entry);
    saveStore(store);
    const arr = dataArray(type);
    if (arr) arr.push(entry);
    PF.invalidateCaches();   // so the new entry appears in buff pickers / feat prereqs without a reload
    return entry;
  }

  // Sanitize markup arriving from an imported vault backup. Legit homebrew HTML
  // is only ever generated by para() (p/br + escaped text), but a shared file
  // could carry anything — strip every tag outside a small formatting whitelist,
  // then strip all attributes (onclick, style, href…) from what remains.
  const HTML_OK = /^(p|br|b|i|em|strong|u|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|caption|hr)$/i;
  function cleanHtml(s) {
    return String(s || '').replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/g,
      (m, slash, tag) => HTML_OK.test(tag) ? '<' + slash + tag.toLowerCase() + '>' : '')
      .replace(/<!--[\s\S]*?-->/g, '');
  }

  // Import one entry from a vault backup: only known types, only free names.
  // Returns true when the entry was added.
  function addImported(type, entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (!SCHEMAS[type]) return false;
    const name = String(entry.name || '').trim();
    if (!name) return false;
    const arr = dataArray(type);
    if (!arr || arr.some(x => x.name.toLowerCase() === name.toLowerCase())) return false;
    const e = JSON.parse(JSON.stringify(entry));
    e.name = name;
    for (const k of ['html', 'benefit', 'normal', 'special', 'body']) {
      if (e[k] != null) e[k] = cleanHtml(e[k]);
    }
    e.source = 'Homebrew';
    add(type, e);
    return true;
  }

  function remove(type, name) {
    const store = loadStore();
    store[type] = (store[type] || []).filter(e => e.name !== name);
    saveStore(store);
    const arr = dataArray(type);
    if (arr) {
      const i = arr.findIndex(x => x.custom && x.name === name);
      if (i >= 0) arr.splice(i, 1);
    }
    PF.invalidateCaches();
  }

  const creatable = type => !!SCHEMAS[type];

  // ---------------- form modal ----------------
  function formModal(type, onDone) {
    const schema = SCHEMAS[type];
    if (!schema) return;
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const fieldHTML = f => {
      const id = 'cf-' + f.k;
      if (f.kind === 'textarea') {
        return `<div class="field" style="grid-column:1/-1"><label>${esc(f.label)}${f.req ? ' *' : ''}</label>
          <textarea id="${id}" rows="4" placeholder="${esc(f.ph || '')}"></textarea></div>`;
      }
      if (f.kind === 'select') {
        const opts = f.options.map(o => Array.isArray(o)
          ? `<option value="${esc(o[0])}">${esc(o[1])}</option>` : `<option>${esc(o)}</option>`).join('');
        return `<div class="field"><label>${esc(f.label)}</label><select id="${id}">${opts}</select></div>`;
      }
      if (f.kind === 'check') {
        return `<div class="field"><label>&nbsp;</label><label style="display:flex;gap:6px;align-items:center">
          <input type="checkbox" id="${id}"> ${esc(f.label)}</label></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}${f.req ? ' *' : ''}</label>
        <input id="${id}" placeholder="${esc(f.ph || '')}"></div>`;
    };
    overlay.innerHTML = `<div class="modal" style="height:auto;max-height:90vh;overflow-y:auto">
      <h3><button class="modal-close" id="cf-close">Cancel</button>Create Homebrew ${esc(schema.label)}</h3>
      <div class="grid2">${schema.fields.map(fieldHTML).join('')}</div>
      <p class="small err" id="cf-err" style="display:none"></p>
      <div style="margin-top:10px"><button class="primary" id="cf-save">Save to database</button>
      <span class="small muted" style="margin-left:8px">Saved homebrew entries appear in pickers, the Library and hover popovers, marked as “Homebrew”.</span></div>
    </div>`;
    root.appendChild(overlay);
    const close = Library.modalKeys(overlay, () => root.removeChild(overlay));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#cf-close').addEventListener('click', close);
    overlay.querySelector('#cf-save').addEventListener('click', () => {
      const vals = {};
      for (const f of schema.fields) {
        const el = overlay.querySelector('#cf-' + f.k);
        vals[f.k] = f.kind === 'check' ? el.checked : el.value.trim();
      }
      const err = overlay.querySelector('#cf-err');
      const missing = schema.fields.filter(f => f.req && !vals[f.k]);
      if (missing.length) {
        err.textContent = 'Required: ' + missing.map(f => f.label).join(', ');
        err.style.display = 'block';
        return;
      }
      const arr = dataArray(type) || [];
      if (arr.some(x => x.name.toLowerCase() === vals.name.toLowerCase())) {
        err.textContent = `"${vals.name}" already exists — pick a different name.`;
        err.style.display = 'block';
        return;
      }
      const entry = Object.assign({ name: vals.name, source: 'Homebrew' }, schema.post(vals));
      entry.name = vals.name;
      add(type, entry);
      close();
      if (onDone) onDone(entry);
    });
    overlay.querySelector('#cf-name') && overlay.querySelector('#cf-name').focus();
  }

  mergeAll();

  return { SCHEMAS, creatable, add, addImported, remove, formModal, loadStore };
})();
