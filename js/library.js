/* Library: searchable browser over all compiled PRD content; doubles as picker. */
'use strict';

const Library = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const uniq = arr => [...new Set(arr.filter(Boolean))].sort();

  const TYPES = {
    races: { label: 'Races', data: () => PFDATA.races },
    classes: { label: 'Classes', data: () => PFDATA.classes },
    archetypes: { label: 'Archetypes', data: () => PFDATA.archetypes },
    feats: { label: 'Feats', data: () => PFDATA.feats },
    spells: { label: 'Spells', data: () => PFDATA.spells },
    traits: { label: 'Character Traits', data: () => PFDATA.traits },
    racialTraits: { label: 'Alt. Racial Traits', data: () => PFDATA.racialTraits },
    weapons: { label: 'Weapons', data: () => PFDATA.weapons },
    armors: { label: 'Armor & Shields', data: () => PFDATA.armors },
    items: { label: 'Equipment & Magic Items', data: () => PFDATA.items },
    skills: { label: 'Skills', data: () => PFDATA.skills },
    companionSpecies: { label: 'Animal Companions', data: () => (PFDATA.companions || {}).species || [] },
    familiarSpecies: { label: 'Familiars', data: () => (PFDATA.companions || {}).familiarSpecies || [] },
    buffs: { label: 'Buffs & Spell Effects', data: () => PF.buffLibrary() },
    conditions: { label: 'Conditions', data: () => PF.CONDITIONS },
  };

  const CHANGE_LABELS = {
    str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
    attack: 'attack rolls', damage: 'damage', armor: 'armor AC', natural: 'natural armor',
    deflection: 'deflection AC', dodge: 'dodge AC', acMisc: 'AC', fort: 'Fort', ref: 'Ref',
    will: 'Will', saves: 'all saves', skills: 'all skills', init: 'initiative', speed: 'speed',
    cmb: 'CMB', cmd: 'CMD',
  };

  function changesText(changes) {
    return (changes || []).map(ch =>
      `${ch.value >= 0 ? '+' : ''}${ch.value} ${CHANGE_LABELS[ch.target] || ch.target}` +
      (ch.type && ch.type !== 'untyped' ? ` (${ch.type})` : '')).join(', ');
  }

  // ---------------- filters per type ----------------
  function filterControls(type, state) {
    const out = [];
    const sel = (key, label, options) => {
      const opts = ['<option value="">' + esc(label) + ': all</option>']
        .concat(options.map(o => `<option value="${esc(o)}" ${state[key] === o ? 'selected' : ''}>${esc(o)}</option>`));
      return `<select data-f="${key}">${opts.join('')}</select>`;
    };
    if (type === 'feats') {
      out.push(sel('ftype', 'Type', uniq(PFDATA.feats.flatMap(f => f.types))));
      if (state.qualifyChar) {
        out.push(`<select data-f="qual">
          <option value="">Qualified: all</option>
          <option value="yes" ${state.qual === 'yes' ? 'selected' : ''}>Qualified only</option>
        </select>`);
      }
      out.push(`<select data-f="fsort">
        <option value="">Sort: name</option>
        <option value="tree" ${state.fsort === 'tree' ? 'selected' : ''}>Sort: feat trees</option>
      </select>`);
    } else if (type === 'spells') {
      out.push(sel('cls', 'Class', uniq(PFDATA.spells.flatMap(s => Object.keys(s.levels)))));
      out.push(sel('slvl', 'Level', ['0','1','2','3','4','5','6','7','8','9']));
      out.push(sel('school', 'School', uniq(PFDATA.spells.map(s => s.school))));
    } else if (type === 'buffs') {
      out.push(sel('bcls', 'Class', uniq(PF.buffLibrary().flatMap(b => Object.keys(b.levels || {})))));
      out.push(`<select data-f="beff">
        <option value="">All effects</option>
        <option value="yes" ${state.beff === 'yes' ? 'selected' : ''}>With auto-effects only</option>
      </select>`);
    } else if (type === 'items') {
      out.push(sel('cat', 'Category', uniq(PFDATA.items.map(i => i.category))));
    } else if (type === 'archetypes') {
      out.push(sel('acls', 'Class', uniq(PFDATA.archetypes.map(a => a.class))));
    } else if (type === 'traits') {
      out.push(sel('tcat', 'Category', uniq(PFDATA.traits.map(t => t.category))));
    } else if (type === 'racialTraits') {
      out.push(sel('race', 'Race', uniq(PFDATA.racialTraits.map(t => t.race))));
    } else if (type === 'weapons') {
      out.push(sel('prof', 'Proficiency', uniq(PFDATA.weapons.map(w => w.prof))));
    } else if (type === 'classes') {
      out.push(sel('csub', 'Type', uniq(PFDATA.classes.map(c => c.subtype))));
    } else if (type === 'races') {
      out.push(sel('rsub', 'Group', uniq(PFDATA.races.map(r => r.subtype))));
    }
    return out.join('');
  }

  function applyFilters(type, list, state) {
    const q = (state.q || '').toLowerCase();
    return list.filter(x => {
      if (q && !x.name.toLowerCase().includes(q)) {
        // also search description text for feats/spells
        const extra = (x.desc || '') + (x.prereq || '');
        if (!extra.toLowerCase().includes(q)) return false;
      }
      if (type === 'feats' && state.ftype && !x.types.includes(state.ftype)) return false;
      if (type === 'feats' && state.qual === 'yes' && state.qualifyChar &&
          PF.checkFeatPrereqs(state.qualifyChar, x).status === 'unmet') return false;
      if (type === 'spells') {
        if (state.cls && !(state.cls in x.levels)) return false;
        if (state.slvl !== '' && state.slvl != null) {
          if (state.cls) { if (String(x.levels[state.cls]) !== String(state.slvl)) return false; }
          else if (!Object.values(x.levels).some(l => String(l) === String(state.slvl))) return false;
        }
        if (state.school && x.school !== state.school) return false;
      }
      if (type === 'buffs') {
        if (state.bcls && !(x.levels && state.bcls in x.levels)) return false;
        if (state.beff === 'yes' && !(x.changes && x.changes.length)) return false;
      }
      if (type === 'items' && state.cat && x.category !== state.cat) return false;
      if (type === 'archetypes' && state.acls && x.class !== state.acls) return false;
      if (type === 'traits' && state.tcat && x.category !== state.tcat) return false;
      if (type === 'racialTraits' && state.race && x.race !== state.race) return false;
      if (type === 'weapons' && state.prof && x.prof !== state.prof) return false;
      if (type === 'classes' && state.csub && x.subtype !== state.csub) return false;
      if (type === 'races' && state.rsub && x.subtype !== state.rsub) return false;
      return true;
    });
  }

  function rowMeta(type, x) {
    switch (type) {
      case 'feats': return x.types.join(', ') + ' — ' + x.source;
      case 'spells': return esc(x.school) + ' ' + esc(x.levelText || Object.entries(x.levels).map(([c, l]) => c + ' ' + l).join(', ')).slice(0, 70);
      case 'items': return [x.category, x.price].filter(Boolean).join(' — ');
      case 'archetypes': return x.class + ' — ' + x.source;
      case 'traits': return x.category + ' — ' + x.source;
      case 'racialTraits': return x.race + ' — ' + x.source;
      case 'weapons': return `${x.prof}, ${x.dmgM} ${x.crit}` + (x.cost ? ', ' + x.cost : '');
      case 'armors': return `${x.group} — AC ${x.bonus}, ${x.cost}`;
      case 'classes': return x.subtype + ' — ' + x.source;
      case 'races': return x.subtype + ' — ' + x.source;
      case 'skills': return (x.ability || '').toUpperCase() + (x.trained ? ' — trained only' : '');
      case 'companionSpecies': return [x.base && x.base.size, x.base && x.base.attack, x.source].filter(Boolean).join(' — ');
      case 'familiarSpecies': return [x.size, x.melee, x.source].filter(Boolean).join(' — ');
      case 'buffs': case 'conditions':
        return changesText(x.changes)
          || esc([x.school, x.levelText].filter(Boolean).join(' ')).slice(0, 70)
          || (x.note || '').slice(0, 60)
          || '(no auto-effects — add manually)';
      default: return x.source || '';
    }
  }

  // ---------------- detail rendering ----------------
  function statLine(label, val) {
    if (val == null || val === '') return '';
    return `<p style="margin:2px 0"><b style="color:var(--accent)">${esc(label)}</b> ${val}</p>`;
  }

  function detailHTML(type, x) {
    if (!x) return '<p class="muted">Select an entry on the left.</p>';
    let h = `<h2>${esc(x.name)}</h2><p class="tag">${esc(x.source || '')}</p>`;
    switch (type) {
      case 'feats':
        if (x.desc) h += `<p><i>${esc(x.desc)}</i></p>`;
        h += statLine('Type', esc(x.types.join(', ')));
        h += statLine('Prerequisites', esc(x.prereq));
        if (x.benefit) h += `<h4>Benefit</h4>${x.benefit}`;
        if (x.normal) h += `<h4>Normal</h4>${x.normal}`;
        if (x.special) h += `<h4>Special</h4>${x.special}`;
        if (!x.benefit && x.body) h += x.body;
        break;
      case 'spells':
        h += statLine('School', esc(x.school + (x.sub ? ' (' + x.sub + ')' : '') + (x.descriptor ? ' [' + x.descriptor + ']' : '')));
        h += statLine('Level', esc(x.levelText || Object.entries(x.levels).map(([c, l]) => c + ' ' + l).join(', ')));
        h += statLine('Casting Time', esc(x.cast));
        h += statLine('Components', esc(x.comp));
        h += statLine('Range', esc(x.range));
        h += statLine('Duration', esc(x.duration));
        h += statLine('Saving Throw', esc(x.save));
        h += statLine('Spell Resistance', esc(x.sr));
        h += '<hr>' + (x.html || '');
        break;
      case 'items':
        h += statLine('Category', esc([x.category, x.sub].filter(Boolean).join(' / ')));
        h += statLine('Price', esc(x.price));
        h += statLine('Weight', esc(x.weight));
        h += statLine('Slot', esc(x.slot));
        h += statLine('Caster Level', esc(x.cl));
        h += statLine('Aura', esc(x.aura));
        h += '<hr>' + (x.html || '');
        break;
      case 'weapons':
        h += statLine('Proficiency', esc(x.prof));
        h += statLine('Group', esc(x.group));
        h += statLine('Cost', esc(x.cost));
        h += statLine('Damage (S/M)', esc(x.dmgS + ' / ' + x.dmgM));
        h += statLine('Critical', esc(x.crit));
        h += statLine('Range', esc(x.range));
        h += statLine('Weight', esc(x.weight));
        h += statLine('Type', esc(x.dtype));
        h += statLine('Special', esc(x.special));
        break;
      case 'armors':
        h += statLine('Group', esc(x.group));
        h += statLine('Cost', esc(x.cost));
        h += statLine('Armor/Shield Bonus', esc(x.bonus));
        h += statLine('Max Dex Bonus', esc(x.maxDex));
        h += statLine('Armor Check Penalty', esc(x.acp));
        h += statLine('Arcane Spell Failure', esc(x.asf));
        h += statLine('Speed (30 ft. / 20 ft.)', esc((x.spd30 || '—') + ' / ' + (x.spd20 || '—')));
        h += statLine('Weight', esc(x.weight));
        break;
      case 'races': {
        h += statLine('Group', esc(x.subtype));
        const mods = Object.entries(x.mods || {}).map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + k.toUpperCase()).join(', ');
        h += statLine('Ability Modifiers', esc(mods || (x.flex ? '+' + x.flex + ' to one ability score' : '—')));
        h += statLine('Size', esc(x.size));
        h += statLine('Speed', esc(x.speed + ' ft.'));
        h += '<hr>' + (x.html || '');
        break;
      }
      case 'classes': {
        h += statLine('Type', esc(x.subtype));
        h += statLine('Hit Die', esc(x.hd));
        h += statLine('Alignment', esc(x.alignment));
        h += statLine('Skill Ranks/Level', x.ranks != null ? esc(x.ranks + ' + Int modifier') : '');
        h += statLine('Class Skills', esc((x.classSkills || []).join(', ')));
        h += '<hr>' + (x.html || '');
        break;
      }
      case 'companionSpecies': {
        const b = x.base || {};
        h += statLine('Size', esc(b.size));
        h += statLine('Speed', esc(b.speed));
        h += statLine('AC', esc(b.ac));
        h += statLine('Attacks', esc(b.attack));
        h += statLine('Ability Scores', esc(b.abilitiesText));
        h += statLine('Special Qualities', esc(b.sq));
        h += statLine('Special Attacks', esc(b.sa));
        for (const a of (x.adv || [])) {
          h += `<h4>${a.level}th-Level Advancement</h4>`;
          h += statLine('Size', esc(a.size));
          h += statLine('AC', esc(a.ac));
          h += statLine('Attacks', esc(a.attack));
          h += statLine('Ability Scores', esc(a.abilitiesText));
          h += statLine('Special', esc([a.sa, a.sq, a.bonusFeat].filter(Boolean).join('; ')));
        }
        break;
      }
      case 'familiarSpecies': {
        h += statLine('Size', esc(x.size));
        h += statLine('Speed', esc(x.speed));
        h += statLine('AC', esc(x.ac));
        h += statLine('Melee', esc(x.melee));
        h += statLine('Ability Scores', esc(PF.ABILITIES.map(k => k.toUpperCase() + ' ' + (x.abilities[k] != null ? x.abilities[k] : '—')).join(', ')));
        h += statLine('Senses', esc(x.senses));
        h += statLine('Skills', esc(x.skills));
        h += statLine('Special Qualities', esc(x.sq));
        break;
      }
      case 'buffs': case 'conditions':
        if (x.levels && Object.keys(x.levels).length) h += statLine('Spell Level', esc(x.levelText || Object.entries(x.levels).map(([cc, l]) => cc + ' ' + l).join(', ')));
        if (x.school) h += statLine('School', esc(x.school));
        h += statLine('Mechanical effects', esc(changesText(x.changes) || (x.fromSpell ? 'none auto-detected' : '—')));
        if (x.scales) h += '<p class="small warn">Some values scale with level — adjust after adding.</p>';
        if (x.fromSpell && !(x.changes && x.changes.length)) h += '<p class="small muted">Auto-parsing found no fixed bonuses in this spell\'s text. It can still be added as a tracked effect, then refined with the "edit" link in the Play tab.</p>';
        if (x.note) h += statLine('Note', esc(x.note));
        h += '<hr>' + (x.html || '');
        break;
      default:
        if (x.category) h += statLine('Category', esc(x.category));
        if (x.race) h += statLine('Race', esc(x.race));
        if (x.class) h += statLine('Class', esc(x.class));
        if (x.ability) h += statLine('Key Ability', esc(x.ability.toUpperCase()));
        h += '<hr>' + (x.html || x.body || (x.desc ? '<p>' + esc(x.desc) + '</p>' : ''));
    }
    return h;
  }

  // qualification panel shown in pickers when a character context is provided
  function prereqCheckHTML(c, feat) {
    const res = PF.checkFeatPrereqs(c, feat);
    if (!res.clauses.length) return '<p class="small ok">✓ No prerequisites.</p>';
    const icon = s => s === 'met' ? '<span class="ok">✓</span>' : s === 'unmet' ? '<span class="err">✗</span>' : '<span class="muted">?</span>';
    return `<div class="panel" style="padding:8px 12px;margin:0 0 10px">
      <b class="${res.status === 'met' ? 'ok' : res.status === 'unmet' ? 'err' : 'muted'}">
        ${res.status === 'met' ? '✓ Prerequisites met' : res.status === 'unmet' ? '✗ Prerequisites not met' : '? Some prerequisites can\'t be verified'}</b>
      <div class="small" style="margin-top:4px">${res.clauses.map(cl => `${icon(cl.status)} ${esc(cl.text)}`).join('<br>')}</div>
      ${res.clauses.some(cl => cl.status === 'unknown') ? '<div class="small muted" style="margin-top:4px">? = class features, proficiencies etc. the app can\'t check — verify yourself.</div>' : ''}
    </div>`;
  }

  // ---------------- main render ----------------
  // opts: { type, fixed (hide type selector), onPick(entry), pickLabel, presets {} }
  function render(container, opts = {}) {
    const state = Object.assign({ type: opts.type || 'feats', q: '' }, opts.presets || {});
    let selected = null;

    // order feats so each feat chain appears as an indented tree
    function treeOrder(list) {
      const inList = new Map(list.map(x => [x.name.toLowerCase(), x]));
      const children = new Map();
      const roots = [];
      for (const x of list) {
        const parent = PF.featParents(x).map(n => inList.get(n.toLowerCase())).find(p => p && p !== x);
        if (parent) {
          if (!children.has(parent)) children.set(parent, []);
          children.get(parent).push(x);
        } else roots.push(x);
      }
      const out = [];
      const visit = (x, depth) => {
        if (out.length > 5000) return;
        out.push({ x, depth });
        for (const ch of (children.get(x) || []).sort((a, b) => a.name.localeCompare(b.name))) visit(ch, depth + 1);
      };
      for (const r of roots.sort((a, b) => a.name.localeCompare(b.name))) visit(r, 0);
      return out;
    }

    function draw() {
      const prevResults = container.querySelector('.lib-results');
      const listScroll = prevResults ? prevResults.scrollTop : 0;
      const list = applyFilters(state.type, TYPES[state.type].data(), state);
      list.sort((a, b) => a.name.localeCompare(b.name));
      let ordered;
      if (state.type === 'feats' && state.fsort === 'tree') {
        ordered = treeOrder(list).slice(0, 400);
      } else {
        ordered = list.slice(0, 400).map(x => ({ x, depth: 0 }));
      }
      const shown = ordered.map(o => o.x);
      const typeSel = opts.fixed ? '' :
        `<select data-f="type">${Object.entries(TYPES).map(([k, v]) =>
          `<option value="${k}" ${state.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`;
      const canCreate = typeof Custom !== 'undefined' && Custom.creatable(state.type);
      container.innerHTML = `
        <div class="lib-wrap">
          <div class="lib-list">
            <div class="lib-filters">
              ${typeSel}
              <input type="text" data-f="q" placeholder="Search..." value="${esc(state.q)}">
              ${filterControls(state.type, state)}
              ${canCreate ? '<button id="lib-new-custom" class="small" title="Add a homebrew entry to the database">+ Homebrew</button>' : ''}
            </div>
            <div class="lib-count">${list.length} entries${list.length > 400 ? ' (showing first 400)' : ''}</div>
            <div class="lib-results">
              ${ordered.map(({ x, depth }, i) => {
                let badge = '';
                if (state.type === 'feats' && state.qualifyChar) {
                  const st = PF.checkFeatPrereqs(state.qualifyChar, x).status;
                  badge = st === 'met' ? '<span class="ok" title="prerequisites met">✓</span> '
                        : st === 'unmet' ? '<span class="err" title="prerequisites not met">✗</span> '
                        : '<span class="muted" title="has prerequisites the app can\'t verify">?</span> ';
                }
                return `
                <div class="lib-row ${selected === x ? 'sel' : ''}" data-i="${i}" ${depth ? `style="padding-left:${12 + depth * 18}px"` : ''}>
                  <div class="nm">${depth ? '<span class="muted">└ </span>' : ''}${badge}${esc(x.name)}</div>
                  <div class="src">${rowMeta(state.type, x)}</div>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="lib-detail">
            ${opts.onPick && selected ? `<button class="primary" id="lib-pick" style="float:right">${esc(opts.pickLabel || 'Add')}</button>` : ''}
            ${selected && selected.custom ? `<button class="small danger" id="lib-del-custom" style="float:right;margin-right:8px">Delete homebrew</button>` : ''}
            ${state.type === 'feats' && state.qualifyChar && selected ? prereqCheckHTML(state.qualifyChar, selected) : ''}
            ${detailHTML(state.type, selected)}
          </div>
        </div>`;

      container.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
          if (el.dataset.f === 'type') {
            const t = el.value;
            for (const k of Object.keys(state)) if (k !== 'q') delete state[k];
            state.type = t; selected = null;
          } else {
            state[el.dataset.f] = el.value;
          }
          const qEl = container.querySelector('[data-f=q]');
          state.q = qEl ? qEl.value : state.q;
          const pos = el.selectionStart;
          draw();
          if (el.dataset.f === 'q') {
            const nq = container.querySelector('[data-f=q]');
            nq.focus(); nq.setSelectionRange(pos, pos);
          }
        });
      });
      const newResults = container.querySelector('.lib-results');
      if (newResults && listScroll) newResults.scrollTop = listScroll;
      container.querySelectorAll('.lib-row').forEach(el => {
        el.addEventListener('click', () => {
          selected = shown[parseInt(el.dataset.i, 10)];
          draw();
        });
      });
      const pick = container.querySelector('#lib-pick');
      if (pick) pick.addEventListener('click', () => opts.onPick(selected, state));
      const newBtn = container.querySelector('#lib-new-custom');
      if (newBtn) newBtn.addEventListener('click', () =>
        Custom.formModal(state.type, entry => {
          if (opts.onPick) { opts.onPick(entry, state); return; }
          selected = entry;
          draw();
        }));
      const delBtn = container.querySelector('#lib-del-custom');
      if (delBtn) delBtn.addEventListener('click', () => {
        const doDelete = () => { Custom.remove(state.type, selected.name); selected = null; draw(); };
        const msg = `Delete homebrew entry "${selected.name}" from the database?`;
        if (window.UI && window.UI.confirm) window.UI.confirm(msg, doDelete, { title: 'Delete homebrew', danger: true, okLabel: 'Delete' });
        else if (confirm(msg)) doDelete();
      });
    }
    draw();
  }

  // ---------------- picker modal ----------------
  function pickModal(type, title, onPick, presets) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
      <h3><button class="modal-close" id="m-close">Close</button>${esc(title)}</h3>
      <div class="m-body" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
    </div>`;
    root.appendChild(overlay);
    const close = () => root.removeChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#m-close').addEventListener('click', close);
    render(overlay.querySelector('.m-body'), {
      type, fixed: true, presets,
      onPick: (entry, state) => { onPick(entry, state); close(); },
      pickLabel: 'Add',
    });
    return { close };
  }

  return { render, pickModal, detailHTML, esc, TYPES, changesText };
})();
