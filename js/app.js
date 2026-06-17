/* Pathfinder 1e Character Vault — main application. */
'use strict';

(() => {
  const esc = Library.esc;
  const fmt = n => (n >= 0 ? '+' + n : String(n));
  const $ = sel => document.querySelector(sel);

  // ---------------- persistence ----------------
  const STORE = 'pf1e.vault.characters';
  let characters = [];
  const deletedIds = new Set();
  try { characters = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { characters = []; }

  // Merge-on-save so two open tabs can't silently clobber each other's characters.
  let storageWarned = false;
  function save() {
    const c = current();
    if (c) c.updated = Date.now();
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { stored = []; }
    if (!Array.isArray(stored)) stored = [];
    const byId = new Map(stored.filter(x => x && x.id).map(x => [x.id, x]));
    for (const mine of characters) {
      const other = byId.get(mine.id);
      if (!other || (mine.updated || 0) >= (other.updated || 0)) byId.set(mine.id, mine);
    }
    for (const id of deletedIds) byId.delete(id);
    characters = [...byId.values()].map(patch);
    try {
      localStorage.setItem(STORE, JSON.stringify(characters));
    } catch (err) {
      // quota exceeded, private-mode, or storage disabled — the change is in memory only
      if (!storageWarned && typeof uiAlert === 'function') {
        storageWarned = true;
        uiAlert('Your changes could not be saved to this browser\'s storage' +
          (/quota/i.test(err.message) ? ' (it\'s full)' : '') +
          '. Use Export on the character card to save a backup file before closing this tab.',
          { title: 'Could not save' });
      }
    }
  }

  // merged UI preferences (sidebar state, dismissed notices) in one localStorage key
  const UI_PREF = 'pf1e.vault.ui';
  function loadUiPrefs() { try { return JSON.parse(localStorage.getItem(UI_PREF) || '{}'); } catch (e) { return {}; } }
  function saveUiPref(key, val) {
    const p = loadUiPrefs(); p[key] = val;
    try { localStorage.setItem(UI_PREF, JSON.stringify(p)); } catch (e) { /* non-critical */ }
  }

  function exportCharacter(c) {
    if (!c) return;
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || 'character').replace(/[^\w\- ]/g, '').trim() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.addEventListener('storage', e => {
    if (e.key !== STORE) return;
    try { characters = (JSON.parse(e.newValue || '[]')).map(patch); } catch (err) { return; }
    if (state.view === 'roster') render();
  });

  // narrow = sidebar becomes an overlay drawer instead of an inline column
  const isNarrow = () => window.matchMedia('(max-width: 980px)').matches;

  let state = { view: 'roster', charId: null, builderTab: 'profile' };
  // default the drawer closed on phones (where it would otherwise crush the
  // content), open on desktop; an explicit user preference always wins.
  const _sbPref = loadUiPrefs().sidebarHidden;
  state.sidebarHidden = (_sbPref === undefined) ? isNarrow() : _sbPref;
  const current = () => characters.find(c => c.id === state.charId) || null;

  // persist=false for responsive auto-toggles (tap-a-nav, backdrop, resize) so
  // the saved preference reflects intent only, not viewport accidents.
  function setSidebarHidden(v, persist = true) {
    state.sidebarHidden = v;
    if (persist) saveUiPref('sidebarHidden', v);
    render();
  }

  // re-render when crossing the narrow breakpoint so the drawer/inline layout
  // stays coherent; auto-close the drawer when entering narrow.
  let _wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    const n = isNarrow();
    if (n === _wasNarrow) return;
    _wasNarrow = n;
    if (n) state.sidebarHidden = true;
    render();
  });

  // migrate/patch loaded characters with new fields, and coerce malformed shapes
  // (a bad hand-edited or imported file shouldn't be able to crash the app)
  function patch(c) {
    if (!c || typeof c !== 'object') c = {};
    const fresh = PF.newCharacter('');
    for (const k of Object.keys(fresh)) {
      const def = fresh[k];
      if (c[k] === undefined) { c[k] = def; continue; }
      // ensure structural fields have the right container type
      if (Array.isArray(def) && !Array.isArray(c[k])) c[k] = def;
      else if (def && typeof def === 'object' && !Array.isArray(def) &&
               (typeof c[k] !== 'object' || c[k] === null || Array.isArray(c[k]))) c[k] = def;
    }
    if (typeof c.name !== 'string' || !c.name) c.name = 'Unnamed';
    if (!c.id) c.id = 'pc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return c;
  }
  characters = (Array.isArray(characters) ? characters : []).map(patch);

  // ---------------- shell ----------------
  // Re-renders rebuild the whole DOM; keep the user's place when the view is unchanged.
  let lastRenderKey = '';

  function focusSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    for (const [k, v] of Object.entries(el.dataset)) {
      const attr = 'data-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      return `[${attr}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    }
    return null;
  }

  function render() {
    const pop = document.getElementById('ref-popover');
    if (pop) pop.style.display = 'none';

    const renderKey = [state.view, state.builderTab, state.charId].join('|');
    const sameView = renderKey === lastRenderKey;
    lastRenderKey = renderKey;
    const oldMain = document.getElementById('main');
    const scroll = (sameView && oldMain) ? oldMain.scrollTop : 0;
    // keep <details> expanders open across in-place updates (same view = same structure)
    const detailsState = (sameView && oldMain)
      ? [...oldMain.querySelectorAll('details')].map(d => d.open) : null;
    let focusSel = null, selStart = null, selEnd = null;
    const ae = document.activeElement;
    if (sameView && oldMain && ae && oldMain.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
      focusSel = focusSelector(ae);
      try { selStart = ae.selectionStart; selEnd = ae.selectionEnd; } catch (e) { /* not a text field */ }
    }

    const c = current();
    const app = $('#app');
    const builderTabs = [
      ['play', '▶ Play'],
      ['profile', 'Profile'], ['abilities', 'Abilities'], ['race', 'Race'],
      ['classes', 'Classes'], ['skills', 'Skills'], ['feats', 'Feats & Traits'],
      ['spells', 'Spells'], ['gear', 'Gear'], ['companions', 'Companions'], ['notes', 'Notes'],
    ];
    app.innerHTML = `
      ${state.sidebarHidden ? '<button id="sb-open" class="sb-toggle no-print" title="Show menu">☰</button>' : ''}
      ${(!state.sidebarHidden && isNarrow()) ? '<div class="sb-backdrop no-print"></div>' : ''}
      <div class="sidebar ${state.sidebarHidden ? 'collapsed' : ''}">
        <div class="logo">Pathfinder 1e<small>Character Vault</small></div>
        <div class="nav-item sb-hide" id="sb-hide">« Hide menu</div>
        <div class="nav-item ${state.view === 'roster' ? 'active' : ''}" data-nav="roster">⚔ Characters</div>
        ${c ? `
          <div style="padding:8px 18px 2px;color:var(--accent);font-size:.9em;border-top:1px solid var(--border);margin-top:6px">${esc(c.name)}</div>
          ${builderTabs.map(([k, l]) =>
            `<div class="nav-item sub ${state.view === 'builder' && state.builderTab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}
          <div class="nav-item sub ${state.view === 'sheet' ? 'active' : ''}" data-nav="sheet">📜 Character Sheet</div>
        ` : ''}
        <div class="nav-item ${state.view === 'library' ? 'active' : ''}" data-nav="library" style="border-top:1px solid var(--border);margin-top:6px">📚 Rules Library</div>
        <div class="nav-item ${state.view === 'credits' ? 'active' : ''}" data-nav="credits">⚖ License &amp; Credits</div>
        <div class="spacer"></div>
        <div class="foot">Open Game Content under the OGL v1.0a. Your characters are stored only in this browser.</div>
      </div>
      <div class="main" id="main"></div>`;

    const sbOpen = app.querySelector('#sb-open');
    if (sbOpen) sbOpen.addEventListener('click', () => setSidebarHidden(false));
    app.querySelector('#sb-hide').addEventListener('click', () => setSidebarHidden(true));
    const sbBackdrop = app.querySelector('.sb-backdrop');
    if (sbBackdrop) sbBackdrop.addEventListener('click', () => setSidebarHidden(true, false));
    app.querySelectorAll('[data-nav]').forEach(el =>
      el.addEventListener('click', () => { state.view = el.dataset.nav; if (isNarrow()) state.sidebarHidden = true; render(); }));
    app.querySelectorAll('[data-tab]').forEach(el =>
      el.addEventListener('click', () => { state.view = 'builder'; state.builderTab = el.dataset.tab; if (isNarrow()) state.sidebarHidden = true; render(); }));

    const main = $('#main');
    try {
      if (state.view === 'roster') renderRoster(main);
      else if (state.view === 'library') Library.render(main, {});
      else if (state.view === 'credits') renderCredits(main);
      else if (state.view === 'sheet' && c) renderSheet(main, c);
      else if (state.view === 'builder' && c) renderBuilder(main, c);
      else renderRoster(main);
    } catch (err) {
      console.error('render error', err);
      main.innerHTML = `<div class="panel">
        <h2 class="err">Something went wrong displaying this view</h2>
        <p>${c ? 'Character "' + esc(c.name) + '" couldn\'t be displayed' : 'This view couldn\'t be displayed'}.
           The rest of your data is safe — nothing was deleted.</p>
        <p class="small muted">Technical detail: ${esc(err.message)}</p>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="primary" id="err-roster">← Back to Characters</button>
          ${c ? '<button id="err-export">Export this character (backup)</button>' : ''}
          ${c ? '<button class="danger" id="err-del">Delete this character</button>' : ''}
        </div></div>`;
      const back = main.querySelector('#err-roster');
      if (back) back.onclick = () => { state.view = 'roster'; state.charId = null; render(); };
      const exp = main.querySelector('#err-export');
      if (exp && c) exp.onclick = () => exportCharacter(c);
      const del = main.querySelector('#err-del');
      if (del && c) del.onclick = () => uiConfirm(`Delete "${c.name}"? This cannot be undone.`, () => {
        characters = characters.filter(x => x.id !== c.id);
        deletedIds.add(c.id);
        state.view = 'roster'; state.charId = null;
        save(); render();
      }, { title: 'Delete character', danger: true, okLabel: 'Delete' });
    }

    // restore the user's place after an in-place update
    if (detailsState) {
      [...main.querySelectorAll('details')].forEach((d, i) => {
        if (detailsState[i] !== undefined) d.open = detailsState[i];
      });
    }
    if (scroll) main.scrollTop = scroll;
    if (focusSel) {
      const el = main.querySelector(focusSel);
      if (el) {
        el.focus({ preventScroll: true });
        if (selStart != null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* number inputs */ }
        }
      }
    }
  }

  // ---------------- roster ----------------
  function renderRoster(main) {
    const showBackupNote = !loadUiPrefs().seenBackupNote && characters.length;
    main.innerHTML = `
      <h2>Characters</h2>
      ${showBackupNote ? `<div class="panel no-print" id="backup-note" style="border-color:var(--accent);display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:1.3em">💾</span>
        <div style="flex:1"><b>Your characters live only in this browser.</b>
          Clearing your browser data (or switching devices/browsers) will lose them. Use <b>Export</b>
          on a character to save a backup file, and <b>Import JSON</b> to restore it anywhere.</div>
        <button class="small" id="backup-dismiss">Got it</button>
      </div>` : ''}
      <div class="no-print" style="display:flex;gap:8px">
        <button class="primary" id="new-char">+ New Character</button>
        <button id="import-char">Import JSON</button>
        <input type="file" id="import-file" accept=".json" style="display:none">
      </div>
      <div class="roster-grid" id="roster"></div>`;
    const dismiss = $('#backup-dismiss');
    if (dismiss) dismiss.addEventListener('click', () => { saveUiPref('seenBackupNote', true); render(); });
    const grid = $('#roster');
    if (!characters.length) {
      grid.innerHTML = '<p class="muted">No characters yet. Create one to get started!</p>';
    } else {
      grid.innerHTML = characters.map(c => {
        try {
          const cls = [...PF.classLevels(c)].map(([k, v]) => k + ' ' + v).join(' / ') || 'No class';
          return `<div class="char-card" data-id="${c.id}">
            <h3>${esc(c.name)}</h3>
            <div class="meta">${esc([c.race || 'No race', cls].join(' — '))}</div>
            <div class="meta small">Level ${(c.levels || []).length} • Updated ${new Date(c.updated).toLocaleDateString()}</div>
            <div class="actions no-print">
              <button class="small" data-open="${c.id}">Open</button>
              <button class="small" data-sheet="${c.id}">Sheet</button>
              <button class="small" data-export="${c.id}">Export</button>
              <button class="small" data-copy="${c.id}">Duplicate</button>
              <button class="small danger" data-del="${c.id}">Delete</button>
            </div>
          </div>`;
        } catch (err) {
          // an individual character's data is corrupt — isolate it so the rest still load
          return `<div class="char-card" data-id="${esc(c && c.id || '')}">
            <h3 class="err">⚠ ${esc((c && c.name) || 'Unreadable character')}</h3>
            <div class="meta small err">This character's data couldn't be read (${esc(err.message)}).</div>
            <div class="actions no-print">
              <button class="small" data-export="${esc(c && c.id || '')}">Export (backup)</button>
              <button class="small danger" data-del="${esc(c && c.id || '')}">Delete</button>
            </div>
          </div>`;
        }
      }).join('');
    }
    $('#new-char').addEventListener('click', () => {
      const c = PF.newCharacter('New Character');
      characters.push(c); save();
      state.charId = c.id; state.view = 'builder'; state.builderTab = 'profile';
      render();
    });
    $('#import-char').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const c = patch(JSON.parse(r.result));
          c.id = 'pc_' + Date.now().toString(36);
          characters.push(c); save(); render();
        } catch (err) { uiAlert('Could not read character file: ' + err.message, { title: 'Import failed' }); }
      };
      r.readAsText(f);
    });
    grid.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      state.charId = b.dataset.open; state.view = 'builder'; state.builderTab = 'profile'; render();
    }));
    grid.querySelectorAll('[data-sheet]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); state.charId = b.dataset.sheet; state.view = 'sheet'; render();
    }));
    grid.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      exportCharacter(characters.find(x => x.id === b.dataset.export));
    }));
    grid.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const src = characters.find(x => x.id === b.dataset.copy);
      const c = JSON.parse(JSON.stringify(src));
      c.id = 'pc_' + Date.now().toString(36); c.name += ' (copy)';
      characters.push(c); save(); render();
    }));
    grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const c = characters.find(x => x.id === b.dataset.del);
      uiConfirm(`Delete ${c.name}? This cannot be undone.`, () => {
        characters = characters.filter(x => x.id !== c.id);
        deletedIds.add(c.id);
        if (state.charId === c.id) state.charId = null;
        save(); render();
      }, { title: 'Delete character', danger: true, okLabel: 'Delete' });
    }));
    grid.querySelectorAll('.char-card').forEach(card => card.addEventListener('click', () => {
      state.charId = card.dataset.id; state.view = 'builder'; state.builderTab = 'profile'; render();
    }));
  }

  // ---------------- license & credits ----------------
  function renderCredits(main) {
    const link = (url, label) => `<a href="${url}" target="_blank" rel="noopener">${esc(label)}</a>`;
    main.innerHTML = `
      <h2>License &amp; Credits</h2>
      <div class="panel">
        <p><b>Pathfinder 1e Character Vault</b> is a free, fan-made tool. It is not published by,
        endorsed by, or affiliated with Paizo Inc. All your data stays in your own browser.</p>
        <p>Pathfinder and associated names are trademarks of Paizo Inc. For more about Paizo and
        official Pathfinder products, visit ${link('https://paizo.com', 'paizo.com')}.</p>
      </div>
      <div class="panel">
        <h3>Game content</h3>
        <p>The game rules in this app are Open Game Content, used under the terms of the
        <b>Open Game License v1.0a</b>. You can read the full license at
        ${link('https://www.opengamingfoundation.org/ogl.html', 'opengamingfoundation.org')}
        or on the ${link('https://aonprd.com/OGL.aspx', 'Archives of Nethys')}.</p>
        <p>Rules data was compiled from these freely available, OGL-licensed community datasets:</p>
        <ul>
          <li>${link('https://github.com/devonjones/PSRD-Data', 'PSRD-Data')} — the Pathfinder Reference Document (16 core hardcovers)</li>
          <li>${link('https://gitlab.com/foundryvtt_pathfinder1e/foundryvtt-pathfinder1', 'FoundryVTT Pathfinder 1e system')} — later hardcover classes, spells and items</li>
          <li>${link('https://github.com/GammaRBurst/PathfinderUtilities', 'PathfinderUtilities')} — the complete feat corpus</li>
        </ul>
      </div>
      <div class="panel">
        <h3>Software</h3>
        <ul>
          <li>PDF export uses ${link('https://github.com/parallax/jsPDF', 'jsPDF')} (MIT License).</li>
          <li>Built as a static web app — no tracking, no accounts, no server.</li>
        </ul>
      </div>
      <div class="panel">
        <h3>Full Open Game License text</h3>
        <p class="muted">The complete OGL v1.0a (including the Section 15 copyright notices for the
        content used) is published at the links above. If you'd like it reproduced in full on this
        page, paste it into the marked area in <code>js/app.js</code> (<code>renderCredits</code>).</p>
        <!-- OGL-FULL-TEXT: paste the Open Game License v1.0a and Section 15 notices here if desired -->
      </div>`;
  }

  // ---------------- sheet view ----------------
  function renderSheet(main, c) {
    main.innerHTML = `
      <div class="no-print" style="margin-bottom:10px;display:flex;gap:8px">
        <button id="print-btn" class="primary">🖨 Print</button>
        <button id="pdf-btn" class="primary">⬇ Download PDF</button>
        <button id="back-btn">← Back to builder</button>
      </div>` + Sheet.render(c);
    attachRefPopovers(main, c);
    // click-to-roll on saves and skills; result shows as a toast and lands in the Play log
    main.querySelectorAll('.roller').forEach(el => el.addEventListener('click', () => {
      const entry = logRoll(c, el.dataset.rollLabel, parseInt(el.dataset.rollMod, 10) || 0);
      let toast = document.getElementById('roll-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'roll-toast';
        document.body.appendChild(toast);
      }
      toast.innerHTML = `<b>${esc(entry.label)}</b>: ${entry.d20} ${entry.mod >= 0 ? '+' : ''}${entry.mod} =
        <b style="font-size:1.3em">${entry.total}</b>
        ${entry.d20 === 20 ? ' — natural 20!' : entry.d20 === 1 ? ' — natural 1' : ''}`;
      toast.className = entry.d20 === 20 ? 'nat20' : entry.d20 === 1 ? 'nat1' : '';
      toast.style.display = 'block';
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }));
    $('#print-btn').addEventListener('click', () => window.print());
    $('#back-btn').addEventListener('click', () => { state.view = 'builder'; render(); });
    $('#pdf-btn').addEventListener('click', async () => {
      const btn = $('#pdf-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Generating PDF…';
      try {
        await exportSheetPDF(c);
      } catch (err) {
        uiAlert('PDF generation failed (' + err.message + ').\nYou can use Print → "Save as PDF" instead.', { title: 'PDF export' });
      }
      btn.disabled = false;
      btn.textContent = '⬇ Download PDF';
    });
  }

  // ----- hover detail popover for .ref spans on the sheet -----
  function refDetailHTML(type, name, extra, ctx) {
    const find = (arr, n) => (arr || []).find(x => x.name === n);
    let entry = null;
    switch (type) {
      case 'feats': entry = PF.getFeat(name); break;
      case 'traits': entry = find(PFDATA.traits, name); break;
      case 'racialTraits': entry = find(PFDATA.racialTraits, name); break;
      case 'spells': entry = PF.getSpell(name); break;
      case 'classes': entry = PF.getClass(name); break;
      case 'races': entry = PF.getRace(name); break;
      case 'archetypes':
        entry = (PFDATA.archetypes || []).find(a => a.name.toLowerCase() === name.toLowerCase());
        break;
      case 'skills':
        entry = (PFDATA.skills || []).find(s => name.startsWith(s.name));
        type = 'skills';
        break;
      case 'companionSpecies': entry = PF.getCompSpecies(name); break;
      case 'familiarSpecies': entry = PF.getFamiliarSpecies(name); break;
      case 'gear': {
        const w = PF.getWeapon(name); if (w) { type = 'weapons'; entry = w; break; }
        const a = PF.getArmor(name); if (a) { type = 'armors'; entry = a; break; }
        const it = PF.getItem(name); if (it) { type = 'items'; entry = it; break; }
        break;
      }
      case 'racetrait': {
        const race = PF.getRace(extra);
        const rt = race && (race.traits || []).find(t => t.name === name);
        if (!rt) return null;
        return `<h2>${esc(rt.name)}</h2><p class="tag">${esc(race.name)} racial trait — ${esc(race.source)}</p><p>${esc(rt.body)}</p>`;
      }
    }
    if (!entry) return null;
    let html = Library.detailHTML(type, entry);
    if (type === 'feats' && ctx) {
      const res = PF.checkFeatPrereqs(ctx, entry);
      if (res.clauses.length) {
        const icon = s => s === 'met' ? '<span class="ok">✓</span>' : s === 'unmet' ? '<span class="err">✗</span>' : '<span class="muted">?</span>';
        html = `<div class="small" style="border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px">
          ${res.clauses.map(cl => `${icon(cl.status)} ${esc(cl.text)}`).join('<br>')}</div>` + html;
      }
    }
    return html;
  }

  function attachRefPopovers(container, ctx) {
    let pop = document.getElementById('ref-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'ref-popover';
      pop.style.display = 'none';
      document.body.appendChild(pop);
      // keep the popover open while the cursor is inside it (e.g. to scroll long entries)
      pop.addEventListener('mouseenter', () => clearTimeout(pop._hideT));
      pop.addEventListener('mouseleave', () => {
        pop._hideT = setTimeout(() => { pop.style.display = 'none'; }, 150);
      });
    }
    container.addEventListener('mouseover', e => {
      const t = e.target.closest('.ref');
      if (!t) return;
      clearTimeout(pop._hideT);
      const html = refDetailHTML(t.dataset.rt, t.dataset.rn, t.dataset.rx, ctx);
      if (!html) return;
      pop.innerHTML = html;
      pop.style.display = 'block';
      // position below the term, clamped to the viewport; flip above if needed
      const r = t.getBoundingClientRect();
      const pw = Math.min(440, window.innerWidth - 24);
      pop.style.width = pw + 'px';
      let x = Math.min(r.left, window.innerWidth - pw - 12);
      let y = r.bottom + 8;
      const ph = pop.offsetHeight;
      if (y + ph > window.innerHeight - 12) {
        y = r.top - ph - 8;
        if (y < 12) y = Math.max(12, window.innerHeight - ph - 12);
      }
      pop.style.left = Math.max(12, x) + 'px';
      pop.style.top = y + 'px';
    });
    container.addEventListener('mouseout', e => {
      if (!e.target.closest('.ref')) return;
      pop._hideT = setTimeout(() => { pop.style.display = 'none'; }, 150);
    });
  }

  async function exportSheetPDF(c) {
    // native vector/text PDF (selectable text, clean page breaks, no white-margin slices)
    PDF.exportSheet(c);
  }

  // ---------------- builder ----------------
  function renderBuilder(main, c) {
    const tabs = {
      play: tabPlay,
      profile: tabProfile, abilities: tabAbilities, race: tabRace, classes: tabClasses,
      skills: tabSkills, feats: tabFeats, spells: tabSpells, gear: tabGear,
      companions: tabCompanions, notes: tabNotes,
    };
    (tabs[state.builderTab] || tabProfile)(main, c);
  }

  function field(label, html) {
    return `<div class="field"><label>${esc(label)}</label>${html}</div>`;
  }
  function input(id, value, attrs = '') {
    return `<input id="${id}" value="${esc(value == null ? '' : value)}" ${attrs}>`;
  }
  function bind(id, c, setter, evt = 'change') {
    const el = $('#' + id);
    if (el) el.addEventListener(evt, () => { setter(el.value, el); save(); });
    return el;
  }

  function statBar(c) {
    const t = PF.totals(c);
    const hp = PF.hpBreakdown(c);
    const ac = PF.acBreakdown(c);
    const sv = PF.saves(c);
    return `<div class="panel" style="display:flex;flex-wrap:wrap;align-items:center;gap:2px">
      <span class="stat-big"><span class="v">${c.levels.length}</span><span class="l">Level</span></span>
      <span class="stat-big"><span class="v">${hp.total}</span><span class="l">HP</span></span>
      <span class="stat-big"><span class="v">${ac.total}</span><span class="l">AC</span></span>
      <span class="stat-big"><span class="v">${fmt(t.bab)}</span><span class="l">BAB</span></span>
      <span class="stat-big"><span class="v">${fmt(sv.fort)}</span><span class="l">Fort</span></span>
      <span class="stat-big"><span class="v">${fmt(sv.ref)}</span><span class="l">Ref</span></span>
      <span class="stat-big"><span class="v">${fmt(sv.will)}</span><span class="l">Will</span></span>
    </div>`;
  }

  // ----- play mode -----
  function logRoll(c, label, mod, dice, bonusDice, noD20) {
    const entry = { label, time: Date.now() };
    const parts = [];
    if (noD20) {
      // flat dice roll (no d20) — e.g. "Sneak Attack 3d6", "Fireball 8d6"
      entry.pure = true;
      const r = dice ? PF.rollDice(dice) : null;
      entry.total = r ? r.total : 0;
      if (r) entry.breakdown = `${dice} → ${r.rolls.join('+')}${r.mod ? (r.mod > 0 ? '+' : '') + r.mod : ''}`;
    } else {
      const d20 = 1 + Math.floor(Math.random() * 20);
      entry.d20 = d20; entry.mod = mod; entry.total = d20 + mod;
      if (dice) {
        const dmg = PF.rollDice(dice);
        if (dmg) parts.push(`${dice} → ${dmg.rolls.join('+')}${dmg.mod ? (dmg.mod > 0 ? '+' : '') + dmg.mod : ''} = ${dmg.total}`);
      }
      // bonusDice: "1d6 fire;1d6 cold" — elemental/special damage from enchantments
      if (bonusDice) {
        for (const grp of bonusDice.split(';')) {
          const m = /(\d*d\d+(?:[+-]\d+)?)\s*(.*)/.exec(grp.trim());
          if (!m) continue;
          const r = PF.rollDice(m[1]);
          if (r) parts.push(`${m[1]}${m[2] ? ' ' + m[2] : ''} → ${r.total}`);
        }
      }
      if (parts.length) entry.extra = parts.join(' • ');
    }
    if (!c.play) c.play = PF.newPlayState();
    c.play.rolls.unshift(entry);
    c.play.rolls = c.play.rolls.slice(0, 30);
    save();
    return entry;
  }

  function rollChip(label, mod, extra, bonusDice) {
    return `<button class="small roll-chip" data-roll-label="${esc(label)}" data-roll-mod="${mod}"
      ${extra ? `data-roll-dice="${esc(extra)}"` : ''}${bonusDice ? ` data-roll-bonus="${esc(bonusDice)}"` : ''}>${esc(label)} ${fmt(mod)}</button>`;
  }

  // render a custom roll button from a resolved {mod, dice, bonus, noD20} spec
  function customRollChip(label, i, r) {
    const disp = r.noD20
      ? `${esc(label)} <span class="muted">${esc(r.dice || '')}</span>`
      : `${esc(label)} ${fmt(r.mod)}${r.dice ? ' <span class="muted">(' + esc(r.dice) + ')</span>' : ''}`;
    const attrs = r.noD20
      ? `data-roll-nod20="1" data-roll-dice="${esc(r.dice || '')}"`
      : `data-roll-mod="${r.mod}"${r.dice ? ` data-roll-dice="${esc(r.dice)}"` : ''}${r.bonus ? ` data-roll-bonus="${esc(r.bonus)}"` : ''}`;
    return `<span class="custom-roll-wrap" style="white-space:nowrap">
      <button class="small roll-chip" data-roll-label="${esc(label)}" ${attrs}>${disp}</button>
      <button class="small danger" data-delcustomroll="${i}" title="remove">✕</button></span>`;
  }

  // generic modal shell for the play-tab forms
  function openModal(title, bodyHTML, opts = {}) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const widthStyle = opts.width ? `width:${opts.width};` : '';
    overlay.innerHTML = `<div class="modal" style="height:auto;max-height:90vh;overflow-y:auto;${widthStyle}">
      <h3><button class="modal-close" id="mdl-x">${esc(opts.closeLabel || 'Cancel')}</button>${esc(title)}</h3>
      <div id="mdl-body">${bodyHTML}</div></div>`;
    root.appendChild(overlay);
    const close = () => { if (overlay.parentNode) root.removeChild(overlay); };
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    overlay.querySelector('#mdl-x').addEventListener('click', close);
    return { overlay, close, body: overlay.querySelector('#mdl-body') };
  }

  // styled replacements for the browser's native confirm()/prompt()/alert()
  function uiConfirm(message, onConfirm, opts = {}) {
    const m = openModal(opts.title || 'Please confirm', `
      <p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
        <button id="uc-cancel">Cancel</button>
        <button id="uc-ok" class="${opts.danger ? 'danger' : 'primary'}">${esc(opts.okLabel || 'OK')}</button>
      </div>`, { width: '420px', closeLabel: '✕' });
    m.body.querySelector('#uc-cancel').addEventListener('click', m.close);
    m.body.querySelector('#uc-ok').addEventListener('click', () => { m.close(); onConfirm(); });
    m.body.querySelector('#uc-ok').focus();
  }

  // fields: [{ key, label, placeholder, value, type }]; onOk receives {key: value}
  function uiPrompt(title, fields, onOk, opts = {}) {
    const m = openModal(title, `
      ${(opts.intro ? `<p class="small muted">${esc(opts.intro)}</p>` : '')}
      ${fields.map(f => `<div class="field"><label>${esc(f.label)}</label>
        <input id="up-${f.key}" type="${f.type || 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.value != null ? f.value : '')}"></div>`).join('')}
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
        <button id="up-cancel">Cancel</button>
        <button id="up-ok" class="primary">${esc(opts.okLabel || 'OK')}</button>
      </div>`, { width: '440px', closeLabel: '✕' });
    const submit = () => {
      const vals = {};
      fields.forEach(f => { vals[f.key] = m.body.querySelector('#up-' + f.key).value.trim(); });
      const req = fields.find(f => f.required !== false);  // first field required by default
      if (req && !vals[req.key]) { m.body.querySelector('#up-' + req.key).focus(); return; }
      m.close(); onOk(vals);
    };
    m.body.querySelector('#up-ok').addEventListener('click', submit);
    m.body.querySelector('#up-cancel').addEventListener('click', m.close);
    m.body.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    const first = m.body.querySelector('input'); if (first) first.focus();
  }

  function uiAlert(message, opts = {}) {
    const m = openModal(opts.title || 'Notice', `
      <p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div style="margin-top:14px;text-align:right"><button id="ua-ok" class="primary">OK</button></div>`,
      { width: '420px', closeLabel: '✕' });
    m.body.querySelector('#ua-ok').addEventListener('click', m.close);
    m.body.querySelector('#ua-ok').focus();
  }

  // expose for the other modules (library.js, pdf.js) so dialogs are uniform site-wide
  window.UI = { confirm: uiConfirm, prompt: uiPrompt, alert: uiAlert, modal: openModal };

  // effect targets and bonus types shared by the buff form (must match engine.effective)
  const BUFF_TARGETS = [
    ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
    ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
    ['attack', 'Attack rolls'], ['damage', 'Damage rolls'],
    ['armor', 'Armor bonus (AC)'], ['natural', 'Natural armor (AC)'],
    ['deflection', 'Deflection (AC)'], ['dodge', 'Dodge (AC)'], ['acMisc', 'Misc AC'],
    ['fort', 'Fortitude'], ['ref', 'Reflex'], ['will', 'Will'], ['saves', 'All saves'],
    ['skills', 'All skills'], ['init', 'Initiative'], ['speed', 'Speed (ft)'],
    ['cmb', 'CMB'], ['cmd', 'CMD'],
    ['carryStr', 'Carrying capacity (+Str)'], ['carryMult', 'Carrying capacity (× multiplier)'],
  ];
  const BUFF_TYPES = ['untyped', 'enhancement', 'morale', 'competence', 'luck', 'sacred',
    'profane', 'insight', 'resistance', 'alchemical', 'circumstance', 'size', 'dodge', 'racial'];

  function customBuffForm(onSave, existing) {
    let rows = existing ? JSON.parse(JSON.stringify(existing.changes || [])) : [{ target: 'attack', type: 'untyped', value: 1 }];
    if (!rows.length) rows = [{ target: 'attack', type: 'untyped', value: 1 }];
    let name = existing ? existing.name : '';
    let note = existing ? (existing.note || '') : '';
    const m = openModal((existing ? 'Edit' : 'Create') + ' Buff / Condition', '');
    const tOpts = (sel) => BUFF_TARGETS.map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const yOpts = (sel) => BUFF_TYPES.map(t => `<option ${sel === t ? 'selected' : ''}>${t}</option>`).join('');
    function draw() {
      m.body.innerHTML = `
        <div class="grid2">
          <div class="field"><label>Name</label><input id="bf-name" value="${esc(name)}" placeholder="Rage, Prayer, Sickened…"></div>
          <div class="field"><label>Note (optional)</label><input id="bf-note" value="${esc(note)}" placeholder="duration, source…"></div>
        </div>
        <h4>Effects <span class="small muted">— same-type bonuses don't stack; dodge/untyped/circumstance do; use negatives for penalties</span></h4>
        <table class="data" style="width:100%"><tr><th>Affects</th><th>Bonus type</th><th class="num">Value</th><th></th></tr>
          ${rows.map((r, i) => `<tr>
            <td><select data-bf-target="${i}">${tOpts(r.target)}</select></td>
            <td><select data-bf-type="${i}">${yOpts(r.type)}</select></td>
            <td class="num"><input class="tiny" type="number" data-bf-val="${i}" value="${r.value}"></td>
            <td><button class="small danger" data-bf-del="${i}">✕</button></td>
          </tr>`).join('')}
        </table>
        <button class="small" id="bf-addrow">+ add effect</button>
        <div style="margin-top:12px"><button class="primary" id="bf-save">${existing ? 'Save changes' : 'Add to play'}</button></div>`;
      // keep name/note in sync so they survive table redraws
      m.body.querySelector('#bf-name').addEventListener('input', e => { name = e.target.value; });
      m.body.querySelector('#bf-note').addEventListener('input', e => { note = e.target.value; });
      m.body.querySelectorAll('[data-bf-target]').forEach(el => el.addEventListener('change', () => { rows[+el.dataset.bfTarget].target = el.value; }));
      m.body.querySelectorAll('[data-bf-type]').forEach(el => el.addEventListener('change', () => { rows[+el.dataset.bfType].type = el.value; }));
      m.body.querySelectorAll('[data-bf-val]').forEach(el => el.addEventListener('change', () => { rows[+el.dataset.bfVal].value = parseInt(el.value, 10) || 0; }));
      m.body.querySelectorAll('[data-bf-del]').forEach(el => el.addEventListener('click', () => { rows.splice(+el.dataset.bfDel, 1); if (!rows.length) rows.push({ target: 'attack', type: 'untyped', value: 0 }); draw(); }));
      m.body.querySelector('#bf-addrow').addEventListener('click', () => { rows.push({ target: 'attack', type: 'untyped', value: 0 }); draw(); });
      m.body.querySelector('#bf-save').addEventListener('click', () => {
        name = m.body.querySelector('#bf-name').value.trim();
        if (!name) { m.body.querySelector('#bf-name').focus(); return; }
        note = m.body.querySelector('#bf-note').value.trim();
        const changes = rows.filter(r => r.value).map(r => ({ target: r.target, type: r.type, value: r.value }));
        m.close();
        onSave({ name, active: true, custom: true, note, changes });
      });
      const nm = m.body.querySelector('#bf-name'); if (nm && !existing) nm.focus();
    }
    draw();
  }

  function customAttackForm(comp, onSave) {
    const m = openModal('Add Attack — ' + (comp.name || comp.type), `
      <div class="grid2">
        <div class="field"><label>Name</label><input id="af-label" placeholder="claw, gore, slam, bite"></div>
        <div class="field"><label>Number of attacks</label><input class="tiny" id="af-count" type="number" value="1" min="1" max="8"></div>
        <div class="field"><label>Attack uses</label><select id="af-atkab">
          <option value="str">Strength</option><option value="dex">Dexterity</option><option value="none">flat (no ability)</option></select></div>
        <div class="field"><label>Damage dice</label><input id="af-dice" placeholder="1d6, 2d8"></div>
        <div class="field"><label>Strength to damage</label><select id="af-mult">
          <option value="1">×1 (one-handed / primary)</option>
          <option value="1.5">×1½ (two-handed / primary natural)</option>
          <option value="0.5">×½ (off-hand / secondary natural)</option>
          <option value="0">none</option></select></div>
        <div class="field"><label>Extra attack bonus</label><input class="tiny" id="af-atkbonus" type="number" value="0"></div>
        <div class="field"><label>Extra flat damage</label><input class="tiny" id="af-dmgbonus" type="number" value="0"></div>
        <div class="field"><label>Bonus damage dice</label><input id="af-bonusdice" placeholder="1d6 fire (optional)"></div>
      </div>
      <p class="small muted">Attack and damage scale with the companion's BAB, ability scores, size and any
        Atk/Dmg adjustments — so buffs and stat changes update them automatically.</p>
      <div style="margin-top:8px"><button class="primary" id="af-save">Add attack</button></div>`);
    m.body.querySelector('#af-save').addEventListener('click', () => {
      const label = m.body.querySelector('#af-label').value.trim();
      if (!label) { m.body.querySelector('#af-label').focus(); return; }
      m.close();
      onSave({
        label,
        count: parseInt(m.body.querySelector('#af-count').value, 10) || 1,
        atkAbility: m.body.querySelector('#af-atkab').value,
        dice: m.body.querySelector('#af-dice').value.trim(),
        dmgMult: m.body.querySelector('#af-mult').value,
        atkBonus: parseInt(m.body.querySelector('#af-atkbonus').value, 10) || 0,
        dmgBonus: parseInt(m.body.querySelector('#af-dmgbonus').value, 10) || 0,
        bonusDice: m.body.querySelector('#af-bonusdice').value.trim(),
      });
    });
    m.body.querySelector('#af-label').focus();
  }

  // player custom roll button: attack (scales with BAB/ability/buffs), ability check, flat d20, or flat dice
  function customRollForm(onSave) {
    let kind = 'attack';
    const m = openModal('Add Custom Roll', '');
    const abSel = (id, val) => `<select id="${id}">${
      [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'],
       ['wis', 'Wisdom'], ['cha', 'Charisma'], ['none', 'none']].map(([k, l]) =>
        `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    function draw() {
      let fields = '';
      if (kind === 'attack') {
        fields = `<div class="grid2">
          <div class="field"><label>Attack uses</label>${abSel('cr-atkab', 'str')}</div>
          <div class="field"><label>Extra attack bonus</label><input class="tiny" id="cr-atkbonus" type="number" value="0"></div>
          <div class="field"><label>Damage dice</label><input id="cr-dice" placeholder="1d8, 2d6"></div>
          <div class="field"><label>Strength to damage</label><select id="cr-mult">
            <option value="1">×1 (one-handed / primary)</option>
            <option value="1.5">×1½ (two-handed)</option>
            <option value="0.5">×½ (off-hand / secondary)</option>
            <option value="0">none</option></select></div>
          <div class="field"><label>Extra flat damage</label><input class="tiny" id="cr-dmgbonus" type="number" value="0"></div>
          <div class="field"><label>Bonus damage dice</label><input id="cr-bonusdice" placeholder="1d6 fire (optional)"></div>
        </div>
        <p class="small muted">Rolls d20 + BAB + ability + size + your live attack adjustments (so buffs apply), then damage.</p>`;
      } else if (kind === 'check') {
        fields = `<div class="grid2">
          <div class="field"><label>Ability</label>${abSel('cr-ability', 'dex')}</div>
          <div class="field"><label>Extra bonus</label><input class="tiny" id="cr-bonus" type="number" value="0"></div>
          <div class="field"><label><input type="checkbox" id="cr-usebab"> add BAB (maneuvers)</label></div>
        </div>
        <p class="small muted">Rolls d20 + the chosen ability modifier (live) + extra. Tick "add BAB" for combat maneuvers.</p>`;
      } else if (kind === 'd20') {
        fields = `<div class="grid2">
          <div class="field"><label>Fixed modifier</label><input class="tiny" id="cr-mod" type="number" value="0"></div>
          <div class="field"><label>Bonus dice (optional)</label><input id="cr-bonusdice" placeholder="2d6"></div>
        </div>
        <p class="small muted">Rolls d20 + a fixed number that doesn't change with stats.</p>`;
      } else {
        fields = `<div class="field"><label>Dice to roll</label><input id="cr-dice" placeholder="3d6, 8d6, 2d8+5"></div>
        <p class="small muted">Just rolls dice (no d20) — sneak attack, fireball, healing, etc.</p>`;
      }
      m.body.innerHTML = `
        <div class="grid2">
          <div class="field"><label>Label</label><input id="cr-label" value="${esc(m._label || '')}" placeholder="Power Attack, Bull Rush, Sneak Attack…"></div>
          <div class="field"><label>Roll type</label><select id="cr-kind">
            <option value="attack" ${kind === 'attack' ? 'selected' : ''}>Attack (scales with BAB &amp; ability)</option>
            <option value="check" ${kind === 'check' ? 'selected' : ''}>Ability check / maneuver (d20 + ability)</option>
            <option value="d20" ${kind === 'd20' ? 'selected' : ''}>d20 + fixed modifier</option>
            <option value="flat" ${kind === 'flat' ? 'selected' : ''}>Flat dice (no d20)</option>
          </select></div>
        </div>
        ${fields}
        <div style="margin-top:10px"><button class="primary" id="cr-save">Add roll button</button></div>`;
      m.body.querySelector('#cr-label').addEventListener('input', e => { m._label = e.target.value; });
      m.body.querySelector('#cr-kind').addEventListener('change', e => { kind = e.target.value; draw(); });
      m.body.querySelector('#cr-save').addEventListener('click', () => {
        const label = m.body.querySelector('#cr-label').value.trim();
        if (!label) { m.body.querySelector('#cr-label').focus(); return; }
        const q = s => m.body.querySelector(s);
        let cr;
        if (kind === 'attack') {
          cr = { label, kind, atkAbility: q('#cr-atkab').value, atkBonus: parseInt(q('#cr-atkbonus').value, 10) || 0,
                 dice: q('#cr-dice').value.trim(), dmgMult: q('#cr-mult').value,
                 dmgBonus: parseInt(q('#cr-dmgbonus').value, 10) || 0, bonusDice: q('#cr-bonusdice').value.trim() };
        } else if (kind === 'check') {
          cr = { label, kind, ability: q('#cr-ability').value, useBab: q('#cr-usebab').checked,
                 bonus: parseInt(q('#cr-bonus').value, 10) || 0 };
        } else if (kind === 'd20') {
          cr = { label, kind, mod: parseInt(q('#cr-mod').value, 10) || 0, bonusDice: q('#cr-bonusdice').value.trim() };
        } else {
          cr = { label, kind: 'flat', dice: q('#cr-dice').value.trim() };
          if (!cr.dice) { q('#cr-dice').focus(); return; }
        }
        m.close();
        onSave(cr);
      });
      const lb = m.body.querySelector('#cr-label'); if (lb && !m._label) lb.focus();
    }
    draw();
  }

  function tabPlay(main, c) {
    if (!c.play) { c.play = PF.newPlayState(); }
    const p = c.play;
    if (!p.customRolls) p.customRolls = [];
    const e = PF.effective(c);           // live stats with buffs/conditions applied
    const buffed = e !== c;
    const hp = PF.currentHP(e);          // max HP must reflect Con buffs (e.g. Bear's Endurance)
    const ac = PF.acBreakdown(e);
    const sv = PF.saves(e);
    const t = PF.totals(e);
    const cm = PF.combatManeuvers(e);
    const init = PF.abilityMod(e, 'dex') + (e.combat.miscInit || 0);
    const race = PF.getRace(c.race);
    const sizeM = PF.SIZE_MOD[(race && race.size) || 'Medium'] || 0;
    const hpClass = hp.current <= 0 ? 'err' : (hp.current <= hp.max / 3 ? 'warn' : 'ok');

    // attack lines from equipped weapons (using buffed stats); ammo excluded, tracked below
    const weaponRows = c.gear.filter(g => g.kind === 'weapon' && !PF.gearIsAmmo(g)).map(g => {
      const w = PF.getWeapon(g.name);
      const mw = PF.magicWeapon(g);
      const ranged = PF.isRangedWeapon(w);
      const abM = ranged ? PF.abilityMod(e, 'dex') : PF.abilityMod(e, 'str');
      const atkMod = t.bab + abM + sizeM + mw.atk + (e.combat.miscAttack || 0);
      const dmgMod = (ranged ? 0 : PF.abilityMod(e, 'str')) + mw.dmg + (e.combat.miscDamage || 0);
      const dice = w && /\d*d\d+/.test(w.dmgM) ? w.dmgM.match(/\d*d\d+/)[0] + (dmgMod ? (dmgMod > 0 ? '+' : '') + dmgMod : '') : null;
      return rollChip(PF.gearDisplayName(g), atkMod, dice, mw.dmgBonus);
    }).join(' ');

    // ammunition with quick -/+ to track shots fired (adjusts gear quantity)
    const ammoRows = c.gear.map((g, gi) => ({ g, gi })).filter(x => PF.gearIsAmmo(x.g)).map(({ g, gi }) =>
      `<span style="white-space:nowrap;margin-right:10px">${esc(PF.gearDisplayName(g))}
        <button class="small" data-ammo="${gi}:-1">−</button>
        <b ${(g.qty || 0) <= 0 ? 'class="err"' : ''}>${g.qty || 0}</b>
        <button class="small" data-ammo="${gi}:1">+</button></span>`).join(' ');

    // skill chips for skills with ranks
    const skillChips = Object.keys(c.skills).filter(k => c.skills[k] > 0).sort()
      .map(name => rollChip(name, PF.skillBonus(e, name))).join(' ');

    // resolve a custom roll definition against the character's current (buffed) stats
    const resolveCustomRoll = cr => {
      if (cr.kind === 'attack') {
        const abM = cr.atkAbility && cr.atkAbility !== 'none' ? PF.abilityMod(e, cr.atkAbility) : 0;
        const mod = t.bab + abM + sizeM + (cr.atkBonus || 0) + (e.combat.miscAttack || 0);
        let dmgFlat = (cr.dmgBonus || 0) + (e.combat.miscDamage || 0);
        const mult = parseFloat(cr.dmgMult);
        if (mult) dmgFlat += Math.floor(PF.abilityMod(e, 'str') * mult);
        const dice = cr.dice ? cr.dice + (dmgFlat ? (dmgFlat > 0 ? '+' : '') + dmgFlat : '') : '';
        return { mod, dice, bonus: cr.bonusDice || '', noD20: false };
      }
      if (cr.kind === 'check') {
        const abM = cr.ability && cr.ability !== 'none' ? PF.abilityMod(e, cr.ability) : 0;
        return { mod: abM + (cr.bonus || 0) + (cr.useBab ? t.bab : 0), dice: '', bonus: '', noD20: false };
      }
      if (cr.kind === 'd20') return { mod: cr.mod || 0, dice: '', bonus: cr.bonusDice || '', noD20: false };
      if (cr.kind === 'flat') return { mod: 0, dice: cr.dice || '', bonus: '', noD20: true };
      // legacy {d20:bool, mod, dice}
      if (cr.d20) return { mod: cr.mod || 0, dice: cr.dice || '', bonus: '', noD20: false };
      return { mod: 0, dice: cr.dice || '', bonus: '', noD20: true };
    };

    // companions in play (eidolons, animal companions, mounts, familiars)
    const COMBATANTS = ['animal companion', 'mount', 'familiar', 'eidolon'];
    let companionsHtml = '';
    (c.companions || []).forEach((comp, ci) => {
      if (comp.type === 'cohort') {
        const linked = comp.linkedId && characters.find(x => x.id === comp.linkedId);
        if (linked) companionsHtml += `<p class="small muted">🛡 Cohort <b>${esc(comp.name || linked.name)}</b> is a full character —
          <a href="#" data-opencomp="${esc(linked.id)}">open their sheet</a> to play them.</p>`;
        return;
      }
      if (!COMBATANTS.includes(comp.type)) return;
      if (!comp.play) comp.play = PF.newCompanionPlay();
      if (!comp.play.buffs) comp.play.buffs = [];
      const d = PF.companionDerived(c, comp);
      if (!d.abilities) return;
      const cp = comp.play;
      const maxHp = d.hp;
      const cur = maxHp - (cp.hpDamage || 0);
      const hpCls = cur <= 0 ? 'err' : cur <= maxHp / 3 ? 'warn' : 'ok';
      const ac = d.ac + (cp.acMisc || 0);
      const sv = { fort: d.saves.fort + (cp.saveMisc || 0), ref: d.saves.ref + (cp.saveMisc || 0), will: d.saves.will + (cp.saveMisc || 0) };
      const initMod = PF.mod(d.abilities.dex || 10);
      const allAtk = PF.companionAttacks(c, comp, d);
      const seenDel = new Set();
      const atkChips = allAtk.map(a => {
        let chip = `<button class="small roll-chip" data-roll-label="${esc((comp.name || comp.type) + ': ' + a.label)}"
          data-roll-mod="${a.atk}" data-roll-dice="${esc(a.dice)}"${a.bonusDice ? ` data-roll-bonus="${esc(a.bonusDice)}"` : ''} title="${esc(a.note || '')}">${esc(a.label)} ${fmt(a.atk)}</button>`;
        if (a.customIdx != null && !seenDel.has(a.customIdx)) {
          seenDel.add(a.customIdx);
          chip += ` <button class="small danger" data-comp-delatk="${ci}:${a.customIdx}" title="remove custom attack">✕</button>`;
        }
        return chip;
      }).join(' ');
      companionsHtml += `<div style="border-top:1px solid var(--border);padding:10px 0">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b style="color:var(--accent)">${esc(comp.name || '(unnamed)')}</b>
          <span class="small muted">${esc(comp.type)}${comp.species ? ' — ' + esc(comp.species) : ''}${comp.type === 'eidolon' ? ' — ' + esc(comp.form) : ''}</span>
          <span class="pill"><b class="${hpCls}">${cur}</b>/${maxHp} HP</span>
          <span class="pill">AC ${ac}</span>
          <input class="tiny" type="number" data-comp-amt="${ci}" value="1" min="1">
          <button class="small danger" data-comp-dmg="${ci}">Dmg</button>
          <button class="small" data-comp-heal="${ci}">Heal</button>
        </div>
        <p style="margin:6px 0 2px">
          ${[['Init', initMod + (d.buffInit || 0)], ['Fort', sv.fort], ['Ref', sv.ref], ['Will', sv.will]].map(([l, m]) =>
            `<button class="small roll-chip" data-roll-label="${esc((comp.name || comp.type) + ': ' + l)}" data-roll-mod="${m}">${l} ${fmt(m)}</button>`).join(' ')}
          ${atkChips}
          <button class="small" data-comp-addatk="${ci}">+ attack</button>
        </p>
        <div class="small" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px">
          <span class="muted">Effects:</span>
          <button class="small" data-comp-addbuff="${ci}">+ Buff</button>
          <button class="small" data-comp-addcond="${ci}">+ Condition</button>
          <button class="small" data-comp-addcustombuff="${ci}">+ Custom</button>
          ${(cp.buffs || []).map((b, bi) => `<span class="pill ${b.active ? 'gold' : ''}" style="white-space:nowrap"
              title="${esc(Library.changesText(b.changes) || b.note || '')}">
            <input type="checkbox" data-comp-buffact="${ci}:${bi}" ${b.active ? 'checked' : ''}> ${esc(b.name)}
            <a href="#" data-comp-buffdel="${ci}:${bi}">✕</a></span>`).join(' ')}
        </div>
        <div class="small" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px">
          <span class="muted">Adjust:</span>
          ${[['atkMisc', 'Atk'], ['dmgMisc', 'Dmg'], ['acMisc', 'AC'], ['saveMisc', 'Saves']].map(([k, l]) =>
            `<label>${l} <input class="tiny" type="number" data-comp-misc="${ci}:${k}" value="${cp[k] || 0}"></label>`).join(' ')}
          <input style="flex:1;min-width:120px" placeholder="active effects / notes…" data-comp-note="${ci}" value="${esc(cp.note || '')}">
        </div>
        ${comp.attacks ? `<div class="small muted">Build notes: ${esc(comp.attacks)}</div>` : ''}
      </div>`;
    });
    if (companionsHtml) companionsHtml = `<div class="panel"><h3>Companions</h3>${companionsHtml}</div>`;

    // spell slots per caster class
    let slotsHtml = '';
    for (const [clsName] of PF.classLevels(c)) {
      const slots = PF.spellSlots(c, clsName);
      if (!slots) continue;
      const used = (p.slotsUsed[clsName] = p.slotsUsed[clsName] || {});
      slotsHtml += `<div style="margin-top:6px"><b>${esc(clsName)}</b> <span class="small muted">(DC 10 + level + ${PF.casterInfo(clsName).ability.toUpperCase()})</span>
        <table class="data small"><tr><th>Level</th>${slots.filter(s => s.total != null && s.lvl > 0).map(s => `<th class="num">${s.lvl}</th>`).join('')}</tr>
        <tr><td>Used / total</td>${slots.filter(s => s.total != null && s.lvl > 0).map(s => {
          const u = used[s.lvl] || 0;
          return `<td class="num" style="white-space:nowrap">
            <button class="small" data-slot="${esc(clsName)}:${s.lvl}:-1">−</button>
            <b class="${u >= s.total ? 'err' : ''}">${u}</b>/${s.total}
            <button class="small" data-slot="${esc(clsName)}:${s.lvl}:1">+</button></td>`;
        }).join('')}</tr></table></div>`;
    }

    main.innerHTML = `<h2>▶ Play — ${esc(c.name)}</h2>
      <div class="panel" style="display:flex;flex-wrap:wrap;align-items:center;gap:2px">
        <span class="stat-big"><span class="v ${hpClass}">${hp.current}${hp.temp ? '+' + hp.temp : ''}</span><span class="l">HP / ${hp.max}</span></span>
        <span class="stat-big"><span class="v">${ac.total}</span><span class="l">AC (T ${ac.touch} / FF ${ac.flat})</span></span>
        <span class="stat-big"><span class="v">${fmt(init)}</span><span class="l">Init</span></span>
        <span class="stat-big"><span class="v">${fmt(sv.fort)}</span><span class="l">Fort</span></span>
        <span class="stat-big"><span class="v">${fmt(sv.ref)}</span><span class="l">Ref</span></span>
        <span class="stat-big"><span class="v">${fmt(sv.will)}</span><span class="l">Will</span></span>
        <span class="stat-big"><span class="v">${fmt(cm.cmb)}</span><span class="l">CMB</span></span>
        <span class="stat-big"><span class="v">${cm.cmd}</span><span class="l">CMD</span></span>
        <span class="stat-big"><span class="v">${PF.speed(e)}</span><span class="l">Speed</span></span>
        ${buffed ? '<span class="pill gold" title="active buffs/conditions are applied to these numbers">⚡ live</span>' : ''}
        <span style="flex:1"></span>
        <button id="rest-btn" title="Restores spell slots, removes nonlethal damage, heals character level in HP">🌙 Rest</button>
      </div>

      <div class="row">
        <div class="panel" style="flex:1;min-width:300px">
          <h3>Hit Points</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <input class="tiny" type="number" id="hp-amt" value="1" min="1">
            <button class="danger" id="hp-dmg">Damage</button>
            <button id="hp-heal" class="primary">Heal</button>
            <label class="small">Temp HP <input class="tiny" type="number" id="hp-temp" value="${p.hpTemp || 0}"></label>
            <label class="small">Nonlethal <input class="tiny" type="number" id="hp-nl" value="${p.nonlethal || 0}"></label>
          </div>
          ${hp.current <= 0 ? `<p class="err"><b>${hp.current <= -PF.abilityScore(c, 'con') ? 'Dead' : hp.current < 0 ? 'Dying' : 'Disabled'}</b></p>` : ''}
          ${p.nonlethal >= hp.current && hp.current > 0 ? '<p class="warn">Unconscious (nonlethal ≥ current HP)</p>' : ''}
          ${(() => {
            const carry = PF.carryCapacity(e), load = PF.gearWeight(c);
            const tier = load > carry.heavy ? '<span class="err">over capacity</span>'
              : load > carry.medium ? '<span class="err">heavy load</span>'
              : load > carry.light ? '<span class="warn">medium load</span>' : '<span class="ok">light load</span>';
            const boosted = (e.combat.carryMult || 1) > (c.combat.carryMult || 1) || (e.combat.carryStrBonus || 0) > (c.combat.carryStrBonus || 0);
            return `<p class="small" style="margin-top:8px"><b>Carrying:</b> ${load} lbs — Light ${carry.light} / Med ${carry.medium} / Heavy ${carry.heavy} • ${tier}${boosted ? ' <span class="pill gold" style="font-size:.7em">boosted</span>' : ''}</p>`;
          })()}

          <h3 style="margin-top:14px">Buffs & Conditions</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="primary small" id="add-buff">+ Buff / Spell Effect</button>
            <button class="primary small" id="add-cond">+ Condition</button>
            <button class="small" id="add-custom-buff">+ Custom</button>
          </div>
          <table class="data small" style="margin-top:6px">
            ${(p.buffs || []).map((b, i) => `<tr>
              <td style="width:24px"><input type="checkbox" data-bact="${i}" ${b.active ? 'checked' : ''}></td>
              <td><b class="${b.active ? 'ok' : 'muted'}">${esc(b.name)}</b>
                ${(b.custom || b.fromSpell) ? `<a href="#" class="small" data-bedit="${i}" style="margin-left:6px">edit</a>` : ''}
                <div class="small muted">${Library.changesText(b.changes) || ''}${b.note ? ' — ' + esc(b.note) : ''}</div>
                ${b.scales ? '<div class="small warn">scales with level — edit values below</div>' : ''}
                ${b.active && b.changes && b.changes.length ? `<details class="small"><summary style="cursor:pointer;color:var(--accent)">edit values</summary>
                  ${b.changes.map((ch, j) => `<label style="margin-right:8px">${esc(ch.target)}
                    <input class="tiny" type="number" data-bval="${i}:${j}" value="${ch.value}"></label>`).join('')}
                </details>` : ''}
              </td>
              <td style="width:30px"><button class="small danger" data-bdel="${i}">✕</button></td>
            </tr>`).join('') || '<tr><td class="muted">Nothing active. Add Haste, Rage, conditions…</td></tr>'}
          </table>

          <h3 style="margin-top:14px">Trackers <span class="small muted">(charges, ammo, rage rounds…)</span></h3>
          <button class="small" id="add-counter">+ Tracker</button>
          ${(p.counters || []).map((k, i) => `<div style="margin-top:4px;display:flex;gap:6px;align-items:center">
            <input style="width:150px" data-cntname="${i}" value="${esc(k.name)}">
            <button class="small" data-cntmod="${i}:-1">−</button>
            <b>${k.cur}</b>${k.max ? ' / ' + k.max : ''}
            <button class="small" data-cntmod="${i}:1">+</button>
            <button class="small danger" data-cntdel="${i}">✕</button>
          </div>`).join('')}
        </div>

        <div class="panel" style="flex:1;min-width:300px">
          <h3>🎲 Rolls <span class="small muted">— click to roll d20 + modifier</span></h3>
          <p>${rollChip('Initiative', init)} ${rollChip('Fortitude', sv.fort)} ${rollChip('Reflex', sv.ref)} ${rollChip('Will', sv.will)}
             ${rollChip('CMB', cm.cmb)}</p>
          ${weaponRows ? `<p><b class="small muted">ATTACKS</b><br>${weaponRows}</p>` : ''}
          ${ammoRows ? `<p><b class="small muted">AMMUNITION</b><br>${ammoRows}</p>` : ''}
          ${skillChips ? `<p><b class="small muted">SKILLS</b><br>${skillChips}</p>` : ''}
          <p><b class="small muted">CUSTOM</b> <button class="small" id="add-custom-roll">+ add</button><br>
            ${(p.customRolls || []).map((cr, i) => customRollChip(cr.label || 'Roll', i, resolveCustomRoll(cr))).join(' ')}</p>
          <div id="roll-log" style="margin-top:8px;max-height:260px;overflow-y:auto;border-top:1px solid var(--border)">
            ${(p.rolls || []).map(r => r.pure
              ? `<div class="small" style="padding:3px 0;border-bottom:1px solid #2c251d">
                  <b>${esc(r.label)}</b>: <b style="color:var(--accent)">${r.total}</b>
                  ${r.breakdown ? `<span class="muted"> • ${esc(r.breakdown)}</span>` : ''}
                </div>`
              : `<div class="small" style="padding:3px 0;border-bottom:1px solid #2c251d">
                  <b>${esc(r.label)}</b>: <span class="${r.d20 === 20 ? 'ok' : r.d20 === 1 ? 'err' : ''}">${r.d20}</span>
                  ${r.mod >= 0 ? '+' : ''}${r.mod} = <b style="color:var(--accent)">${r.total}</b>
                  ${r.d20 === 20 ? ' <span class="ok">nat 20!</span>' : r.d20 === 1 ? ' <span class="err">nat 1</span>' : ''}
                  ${r.extra ? `<span class="muted"> • dmg ${esc(r.extra)}</span>` : ''}
                </div>`).join('') || '<p class="muted small">No rolls yet.</p>'}
          </div>
          ${(p.rolls || []).length ? '<button class="small" id="clear-rolls" style="margin-top:6px">Clear log</button>' : ''}
        </div>
      </div>

      ${companionsHtml}
      ${slotsHtml ? `<div class="panel"><h3>Spell Slots</h3>${slotsHtml}
        <p class="small muted">Buffed stats don't change save DCs unless the buff raises the casting ability.</p></div>` : ''}
      <p class="small muted">Buffs use proper bonus-type stacking (same-type bonuses don't stack; dodge and untyped do).
        Manual adjustments from the Notes tab are added separately. The printable sheet always shows base (unbuffed) values.</p>`;

    // ---- handlers ----
    const adj = fn => { fn(); save(); render(); };
    $('#hp-dmg').addEventListener('click', () => adj(() => {
      let amt = parseInt($('#hp-amt').value, 10) || 0;
      const fromTemp = Math.min(amt, p.hpTemp || 0);
      p.hpTemp = (p.hpTemp || 0) - fromTemp;
      p.hpDamage = (p.hpDamage || 0) + (amt - fromTemp);
    }));
    $('#hp-heal').addEventListener('click', () => adj(() => {
      const amt = parseInt($('#hp-amt').value, 10) || 0;
      p.hpDamage = Math.max(0, (p.hpDamage || 0) - amt);
      p.nonlethal = Math.max(0, (p.nonlethal || 0) - amt);
    }));
    bind('hp-temp', c, v => { c.play.hpTemp = parseInt(v, 10) || 0; render(); });
    bind('hp-nl', c, v => { c.play.nonlethal = parseInt(v, 10) || 0; render(); });
    $('#rest-btn').addEventListener('click', () => adj(() => {
      p.slotsUsed = {};
      p.nonlethal = 0;
      p.hpDamage = Math.max(0, (p.hpDamage || 0) - c.levels.length);
      for (const comp of c.companions || []) {
        if (comp.play && comp.play.hpDamage) {
          const d = PF.companionDerived(c, comp);
          comp.play.hpDamage = Math.max(0, comp.play.hpDamage - (d.hd || 1));
        }
      }
    }));
    // companion handlers
    main.querySelectorAll('[data-comp-dmg]').forEach(b => b.addEventListener('click', () => adj(() => {
      const ci = +b.dataset.compDmg;
      const amt = parseInt(main.querySelector(`[data-comp-amt="${ci}"]`).value, 10) || 0;
      const comp = c.companions[ci];
      comp.play.hpDamage = (comp.play.hpDamage || 0) + amt;
    })));
    main.querySelectorAll('[data-comp-heal]').forEach(b => b.addEventListener('click', () => adj(() => {
      const ci = +b.dataset.compHeal;
      const amt = parseInt(main.querySelector(`[data-comp-amt="${ci}"]`).value, 10) || 0;
      const comp = c.companions[ci];
      comp.play.hpDamage = Math.max(0, (comp.play.hpDamage || 0) - amt);
    })));
    main.querySelectorAll('[data-comp-misc]').forEach(el => el.addEventListener('change', () => {
      const [ci, key] = el.dataset.compMisc.split(':');
      c.companions[+ci].play[key] = parseInt(el.value, 10) || 0;
      save(); render();
    }));
    main.querySelectorAll('[data-comp-note]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.compNote].play.note = el.value; save();
    }));
    main.querySelectorAll('[data-comp-addatk]').forEach(b => b.addEventListener('click', () => {
      const comp = c.companions[+b.dataset.compAddatk];
      customAttackForm(comp, atk => {
        if (!comp.play.customAttacks) comp.play.customAttacks = [];
        comp.play.customAttacks.push(atk);
        save(); render();
      });
    }));
    main.querySelectorAll('[data-comp-delatk]').forEach(b => b.addEventListener('click', () => {
      const [ci, j] = b.dataset.compDelatk.split(':');
      c.companions[+ci].play.customAttacks.splice(+j, 1);
      save(); render();
    }));
    // companion buffs / conditions / spell effects
    const addCompBuff = (comp, b, scales) => {
      if (!comp.play.buffs) comp.play.buffs = [];
      comp.play.buffs.push({ name: b.name, active: true, scales, fromSpell: b.fromSpell,
                             changes: JSON.parse(JSON.stringify(b.changes || [])), note: b.note || '' });
      save(); render();
    };
    main.querySelectorAll('[data-comp-addbuff]').forEach(b => b.addEventListener('click', () => {
      const comp = c.companions[+b.dataset.compAddbuff];
      Library.pickModal('buffs', 'Add Buff / Spell Effect — ' + (comp.name || comp.type),
        x => addCompBuff(comp, x, x.scales));
    }));
    main.querySelectorAll('[data-comp-addcond]').forEach(b => b.addEventListener('click', () => {
      const comp = c.companions[+b.dataset.compAddcond];
      Library.pickModal('conditions', 'Add Condition — ' + (comp.name || comp.type), x => addCompBuff(comp, x));
    }));
    main.querySelectorAll('[data-comp-addcustombuff]').forEach(b => b.addEventListener('click', () => {
      const comp = c.companions[+b.dataset.compAddcustombuff];
      customBuffForm(buff => { if (!comp.play.buffs) comp.play.buffs = []; comp.play.buffs.push(buff); save(); render(); });
    }));
    main.querySelectorAll('[data-comp-buffact]').forEach(el => el.addEventListener('change', () => {
      const [ci, bi] = el.dataset.compBuffact.split(':');
      c.companions[+ci].play.buffs[+bi].active = el.checked; save(); render();
    }));
    main.querySelectorAll('[data-comp-buffdel]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const [ci, bi] = a.dataset.compBuffdel.split(':');
      c.companions[+ci].play.buffs.splice(+bi, 1); save(); render();
    }));
    main.querySelectorAll('[data-opencomp]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      state.charId = a.dataset.opencomp; state.builderTab = 'play'; render();
    }));
    $('#add-buff').addEventListener('click', () =>
      Library.pickModal('buffs', 'Add Buff / Spell Effect', b => {
        p.buffs.push({ name: b.name, active: true, scales: b.scales, fromSpell: b.fromSpell,
                       changes: JSON.parse(JSON.stringify(b.changes || [])), note: b.note || '' });
        save(); render();
      }));
    $('#add-cond').addEventListener('click', () =>
      Library.pickModal('conditions', 'Add Condition', b => {
        p.buffs.push({ name: b.name, active: true,
                       changes: JSON.parse(JSON.stringify(b.changes)), note: b.note || '' });
        save(); render();
      }));
    $('#add-custom-buff').addEventListener('click', () => {
      customBuffForm(buff => { p.buffs.push(buff); save(); render(); });
    });
    main.querySelectorAll('[data-bact]').forEach(el => el.addEventListener('change', () => {
      p.buffs[+el.dataset.bact].active = el.checked; save(); render();
    }));
    main.querySelectorAll('[data-bdel]').forEach(b => b.addEventListener('click', () => {
      p.buffs.splice(+b.dataset.bdel, 1); save(); render();
    }));
    main.querySelectorAll('[data-bedit]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const i = +a.dataset.bedit;
      const wasActive = p.buffs[i].active;
      customBuffForm(buff => { buff.active = wasActive; p.buffs[i] = buff; save(); render(); }, p.buffs[i]);
    }));
    main.querySelectorAll('[data-bval]').forEach(el => el.addEventListener('change', () => {
      const [i, j] = el.dataset.bval.split(':');
      p.buffs[+i].changes[+j].value = parseInt(el.value, 10) || 0; save(); render();
    }));
    main.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => {
      const [cls, lvl, d] = b.dataset.slot.split(':');
      const u = p.slotsUsed[cls] = p.slotsUsed[cls] || {};
      u[lvl] = Math.max(0, (u[lvl] || 0) + parseInt(d, 10));
      save(); render();
    }));
    $('#add-counter').addEventListener('click', () => {
      uiPrompt('Add Tracker', [
        { key: 'name', label: 'Name', placeholder: 'Wand of CLW, Arrows, Rage rounds…' },
        { key: 'max', label: 'Maximum (optional)', type: 'number', placeholder: 'blank for none', required: false },
      ], vals => {
        const max = parseInt(vals.max, 10) || 0;
        p.counters.push({ name: vals.name, cur: max || 0, max });
        save(); render();
      });
    });
    main.querySelectorAll('[data-cntmod]').forEach(b => b.addEventListener('click', () => {
      const [i, d] = b.dataset.cntmod.split(':');
      const k = p.counters[+i];
      k.cur = Math.max(0, k.cur + parseInt(d, 10));
      if (k.max) k.cur = Math.min(k.cur, k.max);
      save(); render();
    }));
    main.querySelectorAll('[data-cntdel]').forEach(b => b.addEventListener('click', () => {
      p.counters.splice(+b.dataset.cntdel, 1); save(); render();
    }));
    main.querySelectorAll('[data-cntname]').forEach(el => el.addEventListener('change', () => {
      p.counters[+el.dataset.cntname].name = el.value; save();
    }));
    const clearBtn = $('#clear-rolls');
    if (clearBtn) clearBtn.addEventListener('click', () => { p.rolls = []; save(); render(); });
    main.querySelectorAll('.roll-chip').forEach(b => b.addEventListener('click', () => {
      logRoll(c, b.dataset.rollLabel, parseInt(b.dataset.rollMod, 10) || 0,
        b.dataset.rollDice, b.dataset.rollBonus, b.dataset.rollNod20 === '1');
      render();
    }));
    $('#add-custom-roll').addEventListener('click', () => {
      customRollForm(cr => { p.customRolls.push(cr); save(); render(); });
    });
    main.querySelectorAll('[data-ammo]').forEach(b => b.addEventListener('click', () => {
      const [gi, d] = b.dataset.ammo.split(':');
      const g = c.gear[+gi];
      g.qty = Math.max(0, (g.qty || 0) + parseInt(d, 10));
      save(); render();
    }));
    main.querySelectorAll('[data-delcustomroll]').forEach(b => b.addEventListener('click', () => {
      p.customRolls.splice(+b.dataset.delcustomroll, 1); save(); render();
    }));
  }

  // ----- profile -----
  function tabProfile(main, c) {
    main.innerHTML = `<h2>Profile — ${esc(c.name)}</h2>${statBar(c)}
      <div class="panel"><div class="grid3">
        ${field('Character Name', input('f-name', c.name))}
        ${field('Player', input('f-player', c.player))}
        ${field('Alignment', `<select id="f-align">${['LG','NG','CG','LN','N','CN','LE','NE','CE'].map(a =>
          `<option ${c.alignment === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
        ${field('Deity', input('f-deity', c.deity))}
        ${field('Homeland', input('f-home', c.homeland))}
        ${field('XP', input('f-xp', c.xp, 'type="number"'))}
        ${field('Gender', input('f-gender', c.gender))}
        ${field('Age', input('f-age', c.age))}
        ${field('Height', input('f-height', c.height))}
        ${field('Weight', input('f-weight', c.weight))}
        ${field('Hair', input('f-hair', c.hair))}
        ${field('Eyes', input('f-eyes', c.eyes))}
        ${field('Languages', input('f-langs', c.languages))}
      </div></div>`;
    bind('f-name', c, v => { c.name = v; render(); });
    bind('f-player', c, v => c.player = v);
    bind('f-align', c, v => c.alignment = v);
    bind('f-deity', c, v => c.deity = v);
    bind('f-home', c, v => c.homeland = v);
    bind('f-xp', c, v => c.xp = parseInt(v, 10) || 0);
    bind('f-gender', c, v => c.gender = v);
    bind('f-age', c, v => c.age = v);
    bind('f-height', c, v => c.height = v);
    bind('f-weight', c, v => c.weight = v);
    bind('f-hair', c, v => c.hair = v);
    bind('f-eyes', c, v => c.eyes = v);
    bind('f-langs', c, v => c.languages = v);
  }

  // ----- abilities -----
  function tabAbilities(main, c) {
    const rm = PF.racialMods(c);
    const pb = PF.pointBuyCost(c);
    main.innerHTML = `<h2>Ability Scores</h2>${statBar(c)}
      <div class="panel">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          ${field('Method', `<select id="ab-method">
            <option value="pointbuy" ${c.abilityMethod === 'pointbuy' ? 'selected' : ''}>Point Buy</option>
            <option value="roll" ${c.abilityMethod === 'roll' ? 'selected' : ''}>Roll (4d6 drop lowest)</option>
            <option value="manual" ${c.abilityMethod === 'manual' ? 'selected' : ''}>Manual</option>
          </select>`)}
          ${c.abilityMethod === 'pointbuy' ? field('Budget', `<select id="ab-budget">
            ${[10, 15, 20, 25].map(b => `<option ${c.pointBuyBudget === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>`) : ''}
          ${c.abilityMethod === 'pointbuy' ? `<div style="margin-top:14px">Spent:
            <b class="${pb > c.pointBuyBudget ? 'err' : 'ok'}">${pb}</b> / ${c.pointBuyBudget}</div>` : ''}
          ${c.abilityMethod === 'roll' ? `<button id="ab-roll" style="margin-top:14px">🎲 Roll All</button>` : ''}
        </div>
        <div class="ab-grid" style="margin-top:14px">
          ${PF.ABILITIES.map(ab => {
            const total = PF.abilityScore(c, ab);
            return `<div class="ab-cell">
              <div class="ab-name">${PF.ABILITY_NAMES[ab]}</div>
              <input type="number" id="ab-${ab}" value="${c.abilities[ab]}" min="3" max="25">
              <div class="ab-detail">racial ${fmt(rm[ab])} • level ${fmt(c.levelIncreases[ab] || 0)} • misc ${fmt(c.abilityMisc[ab] || 0)}</div>
              <div class="ab-mod">${total} <span class="muted">(${fmt(PF.mod(total))})</span></div>
            </div>`;
          }).join('')}
        </div>
        <p class="small muted">Total = base + racial + level increases (+1 every 4 levels) + misc (belts, tomes, etc.).</p>
        <div class="grid2">
          <div><h4>Level increases (+1 each at levels 4, 8, 12, 16, 20 — you have ${Math.floor(c.levels.length / 4)})</h4>
            <div class="stat-mini-row">
              ${PF.ABILITIES.map(ab => `<label class="stat-mini">${ab.toUpperCase()}
                <input class="tiny" type="number" id="li-${ab}" value="${c.levelIncreases[ab] || 0}" min="0"></label>`).join('')}
              <span class="${sumVals(c.levelIncreases) > Math.floor(c.levels.length / 4) ? 'err' : 'muted'} small">
                (${sumVals(c.levelIncreases)} assigned)</span>
            </div>
          </div>
          <div><h4>Misc / enhancement</h4>
            <div class="stat-mini-row">
              ${PF.ABILITIES.map(ab => `<label class="stat-mini">${ab.toUpperCase()}
                <input class="tiny" type="number" id="mi-${ab}" value="${c.abilityMisc[ab] || 0}"></label>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    bind('ab-method', c, v => { c.abilityMethod = v; render(); });
    if ($('#ab-budget')) bind('ab-budget', c, v => { c.pointBuyBudget = parseInt(v, 10); render(); });
    if ($('#ab-roll')) $('#ab-roll').addEventListener('click', () => {
      for (const ab of PF.ABILITIES) {
        const dice = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => b - a);
        c.abilities[ab] = dice[0] + dice[1] + dice[2];
      }
      save(); render();
    });
    for (const ab of PF.ABILITIES) {
      bind('ab-' + ab, c, v => { c.abilities[ab] = parseInt(v, 10) || 10; render(); });
      bind('li-' + ab, c, v => { c.levelIncreases[ab] = parseInt(v, 10) || 0; render(); });
      bind('mi-' + ab, c, v => { c.abilityMisc[ab] = parseInt(v, 10) || 0; render(); });
    }
  }
  const sumVals = o => Object.values(o).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);

  // ----- race -----
  function tabRace(main, c) {
    const race = PF.getRace(c.race);
    const groups = {};
    for (const r of PFDATA.races) (groups[r.subtype || 'other'] = groups[r.subtype || 'other'] || []).push(r);
    main.innerHTML = `<h2>Race</h2>${statBar(c)}
      <div class="row">
        <div class="panel" style="max-width:380px">
          ${field('Race', `<select id="race-sel"><option value="">— choose —</option>
            ${Object.entries(groups).map(([g, rs]) => `<optgroup label="${esc(g)}">${rs.map(r =>
              `<option ${c.race === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>`).join('')}
          </select>`)}
          ${race && race.flex ? field(`Flexible bonus (+${race.flex} to one ability)`,
            `<select id="race-flex">${PF.ABILITIES.map(ab =>
              `<option value="${ab}" ${c.flexChoice === ab ? 'selected' : ''}>${PF.ABILITY_NAMES[ab]}</option>`).join('')}</select>`) : ''}
          ${race ? `
            <p><b>Size:</b> ${esc(race.size)} • <b>Speed:</b> ${race.speed} ft.</p>
            <p><b>Ability modifiers:</b> ${Object.entries(race.mods).map(([k, v]) => fmt(v) + ' ' + k.toUpperCase()).join(', ') || (race.flex ? `+${race.flex} any` : '—')}</p>
            <p class="small muted">${esc(race.languages)}</p>
            <h4>Alternate racial traits</h4>
            <div>${c.altTraits.map(a => `<span class="pill gold">${esc(a)} <a href="#" data-deltrait="${esc(a)}">✕</a></span>`).join(' ') || '<span class="muted small">none selected</span>'}</div>
            <button class="small" id="add-alt" style="margin-top:6px">+ Add alternate trait</button>
          ` : '<p class="muted">Pick a race to see its details. All races from the Core Rulebook, ARG and Bestiaries are available.</p>'}
        </div>
        <div class="panel" style="flex:2" id="race-detail">
          ${race ? Library.detailHTML('races', race) : ''}
        </div>
      </div>`;
    bind('race-sel', c, v => { c.race = v; render(); });
    if ($('#race-flex')) bind('race-flex', c, v => { c.flexChoice = v; render(); });
    if ($('#add-alt')) $('#add-alt').addEventListener('click', () =>
      Library.pickModal('racialTraits', 'Alternate Racial Traits — ' + c.race, t => {
        if (!c.altTraits.includes(t.name)) c.altTraits.push(t.name);
        save(); render();
      }, { race: singularRace(c.race) }));
    main.querySelectorAll('[data-deltrait]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      c.altTraits = c.altTraits.filter(x => x !== a.dataset.deltrait);
      save(); render();
    }));
  }
  function singularRace(name) { return name; }

  // ----- classes -----
  function tabClasses(main, c) {
    const playable = PFDATA.classes.filter(x => ['core', 'base', 'hybrid'].includes(x.subtype));
    const others = PFDATA.classes.filter(x => !['core', 'base', 'hybrid'].includes(x.subtype));
    // keep the dropdown on the last-used class across re-renders (adding multiple levels)
    const selCls = state.clsSel || (c.levels.length ? c.levels[c.levels.length - 1].cls : null);
    const opt = x => `<option ${x.name === selCls ? 'selected' : ''}>${esc(x.name)}</option>`;
    const clsOptions = `<optgroup label="Core / Base / Hybrid">${playable.map(opt).join('')}</optgroup>
      <optgroup label="Prestige / NPC">${others.map(opt).join('')}</optgroup>`;
    main.innerHTML = `<h2>Classes & Levels</h2>${statBar(c)}
      <div class="row">
        <div class="panel" style="flex:3">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="cls-add-sel">${clsOptions}</select>
            <button class="primary" id="cls-add">+ Add Level</button>
            ${field('HP per level', `<select id="hp-mode">
              <option value="avg" ${c.hpMode === 'avg' ? 'selected' : ''}>Average (die/2 + 1)</option>
              <option value="roll" ${c.hpMode === 'roll' ? 'selected' : ''}>Rolled (enter below)</option>
              <option value="max" ${c.hpMode === 'max' ? 'selected' : ''}>Maximum</option>
            </select>`)}
            ${field('Favored class', `<select id="fav-cls"><option value=""></option>${[...PF.classLevels(c)].map(([k]) =>
              `<option ${c.favoredClass === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>`)}
          </div>
          <div id="level-list" style="margin-top:10px">
            ${c.levels.map((l, i) => `
              <div class="level-row">
                <span class="lvl-no">${i + 1}</span>
                <b style="min-width:110px">${esc(l.cls)}</b>
                <span class="muted small">d${PF.hitDie(l.cls)}</span>
                ${c.hpMode === 'roll' && i > 0 ? `<label class="small">HP <input class="tiny" type="number" data-hp="${i}" value="${l.hp || ''}" min="1" max="12"></label>` : ''}
                <label class="small">FCB <select data-fcb="${i}">
                  <option value=""></option>
                  <option value="hp" ${l.fcb === 'hp' ? 'selected' : ''}>+1 HP</option>
                  <option value="skill" ${l.fcb === 'skill' ? 'selected' : ''}>+1 Skill</option>
                  <option value="other" ${l.fcb === 'other' ? 'selected' : ''}>Other</option>
                </select></label>
                <input style="flex:1" placeholder="archetype(s), notes…" data-arch="${i}" value="${esc((l.archetypes || []).join(', '))}">
                <button class="small danger" data-dellvl="${i}">✕</button>
              </div>`).join('') || '<p class="muted">No levels yet — add your first class level above.</p>'}
          </div>
          <p class="small muted" style="margin-top:8px">FCB = favored class bonus. Type archetype names freely, or browse them in the panel on the right / the Library.</p>
        </div>
        <div class="panel" style="flex:2" id="cls-detail">
          ${renderClassSummary(c)}
        </div>
      </div>`;
    $('#cls-add').addEventListener('click', () => {
      const cls = $('#cls-add-sel').value;
      state.clsSel = cls;
      c.levels.push({ cls, archetypes: [], hp: null, fcb: '' });
      if (!c.favoredClass) c.favoredClass = cls;
      save(); render();
    });
    $('#cls-add-sel').addEventListener('change', e => { state.clsSel = e.target.value; });
    bind('hp-mode', c, v => { c.hpMode = v; render(); });
    bind('fav-cls', c, v => c.favoredClass = v);
    main.querySelectorAll('[data-dellvl]').forEach(b => b.addEventListener('click', () => {
      c.levels.splice(parseInt(b.dataset.dellvl, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-hp]').forEach(el => el.addEventListener('change', () => {
      c.levels[parseInt(el.dataset.hp, 10)].hp = parseInt(el.value, 10) || null; save(); render();
    }));
    main.querySelectorAll('[data-fcb]').forEach(el => el.addEventListener('change', () => {
      c.levels[parseInt(el.dataset.fcb, 10)].fcb = el.value; save(); render();
    }));
    main.querySelectorAll('[data-arch]').forEach(el => el.addEventListener('change', () => {
      c.levels[parseInt(el.dataset.arch, 10)].archetypes =
        el.value.split(',').map(s => s.trim()).filter(Boolean);
      save();
    }));
  }

  function renderClassSummary(c) {
    const entries = [...PF.classLevels(c)];
    if (!entries.length) return '<p class="muted">Class details appear here.</p>';
    let h = '';
    for (const [clsName, lvl] of entries) {
      const cls = PF.getClass(clsName);
      if (!cls) continue;
      const row = PF.progRow(clsName, lvl);
      h += `<h3>${esc(clsName)} ${lvl}</h3>
        <p class="small muted">${esc(cls.desc || '')}</p>
        <p class="small"><b>HD</b> ${esc(cls.hd)} • <b>Skill ranks</b> ${cls.ranks != null ? cls.ranks + ' + Int' : '?'} •
        ${row ? `<b>BAB</b> ${esc(row.bab)} • <b>F/R/W</b> +${row.fort}/+${row.ref}/+${row.will}` : ''}</p>
        ${row && row.special ? `<p class="small"><b>Current features:</b> ${esc(row.special)}</p>` : ''}
        ${cls.prog ? `<details><summary class="small" style="cursor:pointer;color:var(--accent)">Full progression & features</summary>
          <table class="data small"><tr><th>Lv</th><th>BAB</th><th>F</th><th>R</th><th>W</th><th>Special</th></tr>
          ${cls.prog.map(p => `<tr ${p.level === lvl ? 'style="background:rgba(201,162,39,.12)"' : ''}>
            <td>${p.level}</td><td>${esc(p.bab)}</td><td>${p.fort}</td><td>${p.ref}</td><td>${p.will}</td>
            <td>${esc(p.special || '')}</td></tr>`).join('')}</table></details>` : ''}
        ${archetypeLinks(clsName)}`;
    }
    return h;
  }

  function archetypeLinks(clsName) {
    const archs = PFDATA.archetypes.filter(a => a.class.toLowerCase() === clsName.toLowerCase());
    if (!archs.length) return '';
    return `<p class="small"><b>${archs.length} archetypes available</b> — view in
      <a href="#" data-lib-arch="${esc(clsName)}">Library</a></p>`;
  }

  // ----- skills -----
  function tabSkills(main, c) {
    const budget = PF.skillPointsBudget(c);
    const spent = PF.skillPointsSpent(c);
    const cs = PF.classSkillSet(c);
    const maxRanks = c.levels.length;
    // expand skills: knowledge/craft/profession/perform get common subskills + any with ranks
    const skillRows = [];
    for (const sk of PFDATA.skills) {
      if (['Knowledge', 'Craft', 'Profession', 'Perform'].includes(sk.name)) continue;
      skillRows.push({ name: sk.name, sk });
    }
    const KNOW = ['arcana', 'dungeoneering', 'engineering', 'geography', 'history', 'local', 'nature', 'nobility', 'planes', 'religion'];
    for (const k of KNOW) skillRows.push({ name: `Knowledge (${k})`, sk: PFDATA.skills.find(s => s.name === 'Knowledge') });
    for (const base of ['Craft', 'Profession', 'Perform']) {
      const existing = Object.keys(c.skills).filter(n => n.startsWith(base + ' ('));
      const names = existing.length ? existing : [base + ' (any)'];
      for (const n of names) skillRows.push({ name: n, sk: PFDATA.skills.find(s => s.name === base) });
    }
    skillRows.sort((a, b) => a.name.localeCompare(b.name));

    main.innerHTML = `<h2>Skills</h2>${statBar(c)}
      <div class="panel">
        <p>Skill points: <b class="${spent > budget ? 'err' : 'ok'}">${spent}</b> / ${budget} spent
          <span class="muted small">(class ranks + Int${PF.getRace(c.race) && c.race === 'Human' ? ' + human bonus' : ''} + favored class)</span>
          • Max ranks per skill: <b>${maxRanks}</b>
          • Armor check penalty: <b>${PF.armorCheckPenalty(c)}</b>
          <button class="small" id="add-custom-skill" style="float:right">+ Custom skill</button></p>
        <table class="data">
          <tr><th>Skill</th><th class="num">Total</th><th class="num">Ranks</th><th class="num">Class</th>
              <th class="num">Ability</th><th class="num">Misc</th><th></th></tr>
          ${skillRows.map(({ name, sk }) => {
            const ranks = parseInt(c.skills[name], 10) || 0;
            const natural = PF.isClassSkill(c, name, true);
            const isCs = natural || (c.classSkillExtra || []).includes(name);
            const ab = (sk && sk.ability) || 'int';
            const total = ranks + PF.abilityMod(c, ab) + (isCs && ranks > 0 ? 3 : 0) +
              (parseInt(c.skillMisc[name], 10) || 0) + (sk && sk.acp ? PF.armorCheckPenalty(c) : 0);
            return `<tr>
              <td>${esc(name)}${sk && sk.trained ? '<span class="muted small" title="trained only">*</span>' : ''}${sk && sk.custom ? ' <span class="pill gold" style="font-size:.7em">HB</span>' : ''}</td>
              <td class="num"><b>${fmt(total)}</b></td>
              <td class="num"><input class="tiny" type="number" min="0" max="${maxRanks}" data-rank="${esc(name)}" value="${ranks || ''}"></td>
              <td class="num"><input type="checkbox" data-csk="${esc(name)}" ${isCs ? 'checked' : ''} ${natural ? 'disabled' : ''}
                title="${natural ? 'class skill (from your classes)' : 'mark as class skill (trait, archetype, homebrew)'}"></td>
              <td class="num">${ab.toUpperCase()} ${fmt(PF.abilityMod(c, ab))}</td>
              <td class="num"><input class="tiny" type="number" data-misc="${esc(name)}" value="${c.skillMisc[name] || ''}"></td>
              <td>${name.includes('(any)') ? `<button class="small" data-spec="${esc(name.split(' (')[0])}">name it</button>` : ''}</td>
            </tr>`;
          }).join('')}
        </table>
        <p class="small muted">* trained only — usable untrained ranks are still tracked. The Class checkbox grants +3 once you put a rank in;
        boxes from your classes are locked, others can be ticked for traits or homebrew. “HB” marks custom skills.</p>
      </div>`;
    main.querySelectorAll('[data-rank]').forEach(el => el.addEventListener('change', () => {
      const v = parseInt(el.value, 10) || 0;
      if (v > 0) c.skills[el.dataset.rank] = v; else delete c.skills[el.dataset.rank];
      save(); render();
    }));
    main.querySelectorAll('[data-misc]').forEach(el => el.addEventListener('change', () => {
      const v = parseInt(el.value, 10) || 0;
      if (v) c.skillMisc[el.dataset.misc] = v; else delete c.skillMisc[el.dataset.misc];
      save(); render();
    }));
    main.querySelectorAll('[data-spec]').forEach(b => b.addEventListener('click', () => {
      uiPrompt(`${b.dataset.spec} specialty`, [
        { key: 'spec', label: 'Specialty', placeholder: 'weaponsmithing, sailor, oratory…' },
      ], vals => { c.skills[`${b.dataset.spec} (${vals.spec})`] = 1; save(); render(); });
    }));
    main.querySelectorAll('[data-csk]').forEach(el => el.addEventListener('change', () => {
      const name = el.dataset.csk;
      if (!c.classSkillExtra) c.classSkillExtra = [];
      if (el.checked) { if (!c.classSkillExtra.includes(name)) c.classSkillExtra.push(name); }
      else c.classSkillExtra = c.classSkillExtra.filter(x => x !== name);
      save(); render();
    }));
    $('#add-custom-skill').addEventListener('click', () =>
      Custom.formModal('skills', () => render()));
  }

  // ----- feats & traits -----
  function tabFeats(main, c) {
    const lvl = c.levels.length;
    const baseFeats = Math.max(0, Math.ceil(lvl / 2));
    main.innerHTML = `<h2>Feats & Traits</h2>${statBar(c)}
      <div class="row">
        <div class="panel">
          <h3>Feats <span class="small muted">(${c.feats.length} taken — level ${lvl} grants ${baseFeats} base; bonus feats from class/race/human not counted automatically)</span></h3>
          <button class="primary small" id="add-feat">+ Add Feat</button>
          <table class="data" style="margin-top:8px">
            ${c.feats.map((f, i) => {
              const feat = PF.getFeat(f.name);
              const chk = feat ? PF.checkFeatPrereqs(c, feat) : { status: 'unknown', clauses: [] };
              const unmet = chk.clauses.filter(x => x.status === 'unmet').map(x => x.text).join('; ');
              return `<tr><td style="width:30%"><b>${esc(f.name)}</b>
                ${chk.status === 'unmet' ? `<span class="err" title="${esc('Unmet: ' + unmet)}">⚠</span>` : ''}
                ${feat ? `<div class="small muted">${esc(feat.types.join(', '))}</div>` : ''}
                ${chk.status === 'unmet' ? `<div class="small err">unmet: ${esc(unmet)}</div>` : ''}</td>
                <td class="small">${feat ? esc(feat.desc || feat.prereq) : ''}</td>
                <td><input class="small" style="width:120px" placeholder="note" data-fnote="${i}" value="${esc(f.note || '')}"></td>
                <td><button class="small danger" data-delfeat="${i}">✕</button></td></tr>`;
            }).join('') || '<tr><td class="muted">No feats yet.</td></tr>'}
          </table>
        </div>
        <div class="panel">
          <h3>Traits <span class="small muted">(standard: 2, from different categories)</span></h3>
          <button class="primary small" id="add-trait">+ Add Trait</button>
          <table class="data" style="margin-top:8px">
            ${c.traits.map((tn, i) => {
              const tr = PFDATA.traits.find(x => x.name === tn);
              return `<tr><td><b>${esc(tn)}</b>${tr ? `<div class="small muted">${esc(tr.category)}</div>` : ''}</td>
                <td><button class="small danger" data-deltr="${i}">✕</button></td></tr>`;
            }).join('') || '<tr><td class="muted">No traits yet.</td></tr>'}
          </table>
        </div>
      </div>`;
    $('#add-feat').addEventListener('click', () =>
      Library.pickModal('feats', 'Add Feat', f => { c.feats.push({ name: f.name, note: '' }); save(); render(); },
        { qualifyChar: c }));
    $('#add-trait').addEventListener('click', () =>
      Library.pickModal('traits', 'Add Trait', t => { c.traits.push(t.name); save(); render(); }));
    main.querySelectorAll('[data-delfeat]').forEach(b => b.addEventListener('click', () => {
      c.feats.splice(parseInt(b.dataset.delfeat, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-deltr]').forEach(b => b.addEventListener('click', () => {
      c.traits.splice(parseInt(b.dataset.deltr, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-fnote]').forEach(el => el.addEventListener('change', () => {
      c.feats[parseInt(el.dataset.fnote, 10)].note = el.value; save();
    }));
  }

  // ----- spells -----
  function tabSpells(main, c) {
    const casters = [...PF.classLevels(c)].filter(([k]) => PF.casterInfo(k));
    if (!casters.length) {
      main.innerHTML = `<h2>Spells</h2>${statBar(c)}
        <div class="panel"><p class="muted">No spellcasting classes. Add levels in a casting class (Wizard, Cleric, Sorcerer, Oracle, Magus…) to manage spells.</p></div>`;
      return;
    }
    let h = `<h2>Spells</h2>${statBar(c)}`;
    for (const [clsName, lvl] of casters) {
      const info = PF.casterInfo(clsName);
      const slots = PF.spellSlots(c, clsName);
      const known = PF.spellsKnownRow(c, clsName);
      const mySpells = c.spells.filter(s => s.cls === clsName);
      h += `<div class="panel">
        <h3>${esc(clsName)} ${lvl} <span class="small muted">— ${info.kind} caster, ${PF.ABILITY_NAMES[info.ability]}-based
          (uses ${esc(info.list)} spell list)</span></h3>`;
      if (slots) {
        // include 0-level column for classes whose cantrips/orisons are known but slot-free (e.g. summoner)
        const cols = slots.slice();
        if (known && known[0] != null && !cols.some(s => s.lvl === 0)) {
          cols.unshift({ lvl: 0, base: null, bonus: 0, total: '∞' });
        }
        const cell = s => s.total == null ? '—' : s.total;
        h += `<table class="data small"><tr><th>Spell level</th>${cols.map(s => `<th class="num">${s.lvl}</th>`).join('')}</tr>
          <tr><td>Slots/day (incl. ability bonus)</td>${cols.map(s => `<td class="num">${cell(s)}</td>`).join('')}</tr>
          ${known ? `<tr><td>Spells known</td>${cols.map(s => `<td class="num">${known[s.lvl] == null ? '—' : known[s.lvl]}</td>`).join('')}</tr>` : ''}
          <tr><td>Save DC</td>${cols.map(s => `<td class="num">${s.total == null ? '—' : 10 + s.lvl + PF.abilityMod(c, info.ability)}</td>`).join('')}</tr>
        </table>`;
      } else {
        h += '<p class="small muted">No slot table at this level (or non-standard caster) — track manually below.</p>';
      }
      h += `<button class="primary small" data-addspell="${esc(clsName)}" style="margin-top:8px">+ Add Spell</button>`;
      const byLvl = {};
      for (const s of mySpells) (byLvl[s.lvl] = byLvl[s.lvl] || []).push(s);
      for (const sl of Object.keys(byLvl).sort((a, b) => a - b)) {
        h += `<h4>Level ${sl}</h4><table class="data small">`;
        for (const s of byLvl[sl]) {
          const spell = PF.getSpell(s.name);
          const gi = c.spells.indexOf(s);
          h += `<tr><td style="width:26%"><b>${esc(s.name)}</b></td>
            <td class="small muted">${spell ? esc(spell.school + ' — ' + (spell.desc || '').slice(0, 90)) : ''}</td>
            <td style="width:110px"><label class="small">prep/cast <input class="tiny" type="number" min="0" data-prep="${gi}" value="${s.prepared || ''}"></label></td>
            <td><button class="small danger" data-delspell="${gi}">✕</button></td></tr>`;
        }
        h += '</table>';
      }
      h += '</div>';
    }
    main.innerHTML = h;
    main.querySelectorAll('[data-addspell]').forEach(b => b.addEventListener('click', () => {
      const clsName = b.dataset.addspell;
      const info = PF.casterInfo(clsName);
      Library.pickModal('spells', `Add ${clsName} Spell`, (sp, st) => {
        const lvlForClass = sp.levels[info.list] != null ? sp.levels[info.list] :
          (sp.levels[clsName] != null ? sp.levels[clsName] : (st.slvl !== '' && st.slvl != null ? parseInt(st.slvl, 10) : 0));
        c.spells.push({ name: sp.name, cls: clsName, lvl: lvlForClass, prepared: 0 });
        save(); render();
      }, { cls: info.list });
    }));
    main.querySelectorAll('[data-delspell]').forEach(b => b.addEventListener('click', () => {
      c.spells.splice(parseInt(b.dataset.delspell, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-prep]').forEach(el => el.addEventListener('change', () => {
      c.spells[parseInt(el.dataset.prep, 10)].prepared = parseInt(el.value, 10) || 0; save();
    }));
  }

  // ----- gear -----
  function tabGear(main, c) {
    const cap = PF.carryCapacity(c);
    const load = PF.gearWeight(c);
    const loadCls = load > cap.medium ? 'err' : load > cap.light ? 'warn' : 'ok';
    main.innerHTML = `<h2>Gear & Wealth</h2>${statBar(c)}
      <div class="panel">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary small" id="add-weapon">+ Weapon</button>
          <button class="primary small" id="add-armor">+ Armor/Shield</button>
          <button class="primary small" id="add-item">+ Item / Magic Item</button>
          <button class="small" id="add-custom">+ Custom</button>
          <span style="flex:1"></span>
          <label>PP <input class="tiny" type="number" id="m-pp" value="${c.money.pp || 0}"></label>
          <label>GP <input class="tiny" type="number" id="m-gp" value="${c.money.gp || 0}"></label>
          <label>SP <input class="tiny" type="number" id="m-sp" value="${c.money.sp || 0}"></label>
          <label>CP <input class="tiny" type="number" id="m-cp" value="${c.money.cp || 0}"></label>
        </div>
        <table class="data" style="margin-top:10px">
          <tr><th>Item</th><th>Kind</th><th class="num">Qty</th><th class="num">Weight (ea)</th><th class="num">Equipped</th><th>Note</th><th></th></tr>
          ${c.gear.map((g, i) => {
            const enchantable = g.kind === 'weapon' || g.kind === 'armor';
            return `<tr>
            <td><b>${esc(PF.gearDisplayName(g))}</b>
              ${enchantable ? `<details class="small"><summary style="cursor:pointer;color:var(--accent)">✨ enchantment</summary>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:3px">
                  <label>+ <input class="tiny" type="number" min="0" max="10" data-genh="${i}" value="${g.enh || 0}" title="enhancement bonus"></label>
                  ${(g.enh || 0) > 0 ? '' : `<label><input type="checkbox" data-gmw="${i}" ${g.mw ? 'checked' : ''}> masterwork</label>`}
                  <label>abilities <input style="width:130px" data-gspec="${i}" value="${esc(g.special || '')}" placeholder="${g.kind === 'weapon' ? 'flaming, keen' : 'fortification'}"></label>
                  ${g.kind === 'weapon' ? `<label>bonus dmg <input style="width:100px" data-gdmg="${i}" value="${esc(g.dmgBonus || '')}" placeholder="1d6 fire"></label>` : ''}
                </div></details>` : ''}
            </td><td class="small muted">${esc(g.kind)}</td>
            <td class="num"><input class="tiny" type="number" min="1" data-qty="${i}" value="${g.qty || 1}"></td>
            <td class="num"><input class="tiny" data-w="${i}" value="${esc(g.weight != null ? g.weight : '')}"></td>
            <td class="num"><input type="checkbox" data-eq="${i}" ${g.equipped ? 'checked' : ''}></td>
            <td><input style="width:140px" data-gnote="${i}" value="${esc(g.note || '')}"></td>
            <td><button class="small danger" data-delgear="${i}">✕</button></td>
          </tr>`; }).join('') || '<tr><td class="muted" colspan="7">No gear yet.</td></tr>'}
        </table>
        <p>Total weight: <b class="${loadCls}">${load} lbs</b>
          — Light ≤ ${cap.light}, Medium ≤ ${cap.medium}, Heavy ≤ ${cap.heavy}
          • Wealth ≈ <b>${PF.totalGold(c).toFixed(1)} gp</b></p>
        <p class="small" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <span class="muted">Carrying capacity adjustments:</span>
          <label>+Str <input class="tiny" type="number" id="carry-str" value="${c.combat.carryStrBonus || 0}"
            title="treat Strength as higher for carrying — masterwork backpack +1, muleback cords +8"></label>
          <label>× <input class="tiny" type="number" id="carry-mult" min="1" step="0.5" value="${c.combat.carryMult || 1}"
            title="multiply all load limits — Ant Haul ×3"></label>
          <span class="muted small">(masterwork backpack +1, muleback cords +8, Ant Haul ×3; temporary effects can also be toggled as buffs on the Play tab)</span>
        </p>
        <p class="small muted">Check “Equipped” on armor/shields to apply AC, max-Dex and armor check penalties everywhere.</p>
      </div>`;
    const addGear = (entry, kind) => {
      c.gear.push({
        name: entry.name, kind,
        qty: 1, equipped: kind === 'armor',
        weight: parseFloat(String(entry.weight || '').replace(/[^\d.]/g, '')) || 0,
        cost: entry.cost || entry.price || '', note: '',
      });
      save(); render();
    };
    $('#add-weapon').addEventListener('click', () => Library.pickModal('weapons', 'Add Weapon', e => addGear(e, 'weapon')));
    $('#add-armor').addEventListener('click', () => Library.pickModal('armors', 'Add Armor or Shield', e => addGear(e, 'armor')));
    $('#add-item').addEventListener('click', () => Library.pickModal('items', 'Add Item', e => addGear(e, 'item')));
    $('#add-custom').addEventListener('click', () => {
      uiPrompt('Add Custom Item', [
        { key: 'name', label: 'Item name', placeholder: 'e.g. Mysterious Locket' },
      ], vals => { c.gear.push({ name: vals.name, kind: 'custom', qty: 1, weight: 0, note: '' }); save(); render(); });
    });
    for (const [id, key] of [['m-pp', 'pp'], ['m-gp', 'gp'], ['m-sp', 'sp'], ['m-cp', 'cp']]) {
      bind(id, c, v => c.money[key] = parseInt(v, 10) || 0);
    }
    bind('carry-str', c, v => { c.combat.carryStrBonus = parseInt(v, 10) || 0; render(); });
    bind('carry-mult', c, v => { c.combat.carryMult = Math.max(1, parseFloat(v) || 1); render(); });
    main.querySelectorAll('[data-delgear]').forEach(b => b.addEventListener('click', () => {
      c.gear.splice(parseInt(b.dataset.delgear, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-qty]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.qty, 10)].qty = parseInt(el.value, 10) || 1; save(); render();
    }));
    main.querySelectorAll('[data-w]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.w, 10)].weight = parseFloat(el.value) || 0; save(); render();
    }));
    main.querySelectorAll('[data-eq]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.eq, 10)].equipped = el.checked; save(); render();
    }));
    main.querySelectorAll('[data-gnote]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.gnote, 10)].note = el.value; save();
    }));
    main.querySelectorAll('[data-genh]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.genh, 10)].enh = Math.max(0, Math.min(10, parseInt(el.value, 10) || 0)); save(); render();
    }));
    main.querySelectorAll('[data-gmw]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.gmw, 10)].mw = el.checked; save(); render();
    }));
    main.querySelectorAll('[data-gspec]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.gspec, 10)].special = el.value; save(); render();
    }));
    main.querySelectorAll('[data-gdmg]').forEach(el => el.addEventListener('change', () => {
      c.gear[parseInt(el.dataset.gdmg, 10)].dmgBonus = el.value; save(); render();
    }));
  }

  // ----- companions -----
  function compStatBlock(c, comp) {
    const d = PF.companionDerived(c, comp);
    const sv = d.saves;
    let h = '<div class="small" style="background:var(--panel2);border:1px solid var(--border);border-radius:5px;padding:8px 12px;margin:6px 0">';
    if (d.warnings.length) h += `<p class="warn" style="margin:2px 0">⚠ ${esc(d.warnings.join('; '))}</p>`;
    if (d.abilities) {
      h += `<p style="margin:2px 0"><b style="color:var(--accent)">Effective level ${d.lvl}</b>
        ${d.hd ? ` • HD ${d.hd}${d.hdDie ? 'd' + d.hdDie : ' (as master)'}` : ''} • HP ${d.hp}
        • AC ${d.ac} <span class="muted">(nat ${fmt(d.natArmor)})</span> • BAB ${fmt(d.bab)}</p>`;
      h += `<p style="margin:2px 0">${PF.ABILITIES.map(k =>
        `${k.toUpperCase()} ${d.abilities[k]} (${fmt(PF.mod(d.abilities[k]))})`).join(' • ')}</p>`;
      h += `<p style="margin:2px 0">Fort ${fmt(sv.fort)} • Ref ${fmt(sv.ref)} • Will ${fmt(sv.will)}
        • ${esc(d.size)}${d.speed ? ' • ' + esc(d.speed) : ''}</p>`;
      if (d.attacks) h += `<p style="margin:2px 0"><b>Attacks:</b> ${esc(d.attacks)}</p>`;
      if (d.skills != null) h += `<p style="margin:2px 0"><b>Skill ranks:</b> ${esc(d.skills)} • <b>Feats:</b> ${esc(d.feats)}</p>`;
      if (d.special) h += `<p style="margin:2px 0"><b>Special:</b> ${esc(d.special)}</p>`;
    }
    for (const [k, v] of Object.entries(d.extras)) {
      if (v) h += `<p style="margin:2px 0"><b>${esc(k)}:</b> ${esc(v)}</p>`;
    }
    return h + '</div>';
  }

  function tabCompanions(main, c) {
    if (!c.companions) c.companions = [];
    const TYPE_LABEL = {
      'animal companion': '🐺 Animal Companion', mount: '🐴 Mount', familiar: '🦉 Familiar',
      eidolon: '👁 Eidolon', cohort: '🛡 Cohort', follower: '👥 Followers', other: '◆ Other',
    };
    main.innerHTML = `<h2>Companions</h2>${statBar(c)}
      <div class="panel no-print" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="muted small">Add:</span>
        ${Object.entries(TYPE_LABEL).map(([t, l]) => `<button class="small" data-addcomp="${t}">${l}</button>`).join('')}
      </div>
      <div id="comp-list">
        ${c.companions.map((comp, i) => renderCompanion(c, comp, i)).join('') ||
          '<p class="muted">No companions yet. Animal companions and familiars pick a species from the published lists; eidolons pick a base form; cohorts can link to another character in your vault.</p>'}
      </div>`;

    function renderCompanion(c, comp, i) {
      const isAnimal = comp.type === 'animal companion' || comp.type === 'mount';
      const isFam = comp.type === 'familiar';
      const isEid = comp.type === 'eidolon';
      const isLead = comp.type === 'cohort' || comp.type === 'follower';
      const auto = PF.companionAutoLevel(c, comp);
      let extra = '';
      if (isAnimal) {
        extra = `<button class="small" data-pickspecies="${i}">${comp.species ? esc(comp.species) : 'choose species…'}</button>`;
      } else if (isFam) {
        extra = `<button class="small" data-pickfam="${i}">${comp.species ? esc(comp.species) : 'choose animal…'}</button>`;
      } else if (isEid) {
        extra = `<label class="small">Base form <select data-form="${i}">
          ${['Quadruped', 'Biped', 'Serpentine'].map(f => `<option ${comp.form === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></label>`;
      } else if (comp.type === 'cohort') {
        extra = `<label class="small">Linked character <select data-link="${i}">
          <option value="">— none —</option>
          ${characters.filter(x => x.id !== c.id).map(x =>
            `<option value="${x.id}" ${comp.linkedId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>
        ${comp.linkedId ? `<button class="small" data-opencomp="${esc(comp.linkedId)}">Open sheet →</button>` : ''}
        <label class="small">Leadership modifiers <input class="tiny" type="number" data-leadmod="${i}" value="${comp.leadMod || 0}" title="reputation, base of operations, etc."></label>`;
      } else if (comp.type === 'follower') {
        extra = `<label class="small">Leadership modifiers <input class="tiny" type="number" data-leadmod="${i}" value="${comp.leadMod || 0}"></label>`;
      }
      const linked = comp.linkedId && characters.find(x => x.id === comp.linkedId);
      return `<div class="panel" data-comp="${i}">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b style="color:var(--accent)">${TYPE_LABEL[comp.type] || comp.type}</b>
          <input style="width:170px" placeholder="name" data-cname="${i}" value="${esc(comp.name)}">
          ${extra}
          ${!isLead && comp.type !== 'other' ? `<label class="small">Eff. level <input class="tiny" type="number" data-eff="${i}"
            placeholder="${auto}" value="${comp.effOverride != null && comp.effOverride !== '' ? comp.effOverride : ''}" title="blank = auto from class levels (${auto})"></label>` : ''}
          ${!isLead && comp.type !== 'other' ? `<label class="small">HP override <input class="tiny" type="number" data-chp="${i}" value="${comp.hpOverride || ''}"></label>` : ''}
          <span style="flex:1"></span>
          <button class="small danger" data-delcomp="${i}">✕</button>
        </div>
        ${linked ? `<div class="small muted" style="margin-top:4px">Linked: ${esc(linked.name)} — ${esc(linked.race || '')} ${esc([...PF.classLevels(linked)].map(([k, v]) => k + ' ' + v).join('/'))}, level ${linked.levels.length}</div>` : ''}
        ${compStatBlock(c, comp)}
        <div class="grid2 small">
          <div class="field"><label>Attacks / combat notes</label>
            <textarea rows="2" data-catk="${i}">${esc(comp.attacks)}</textarea></div>
          <div class="field"><label>${isEid ? 'Evolutions' : isFam ? 'Special abilities' : comp.type === 'follower' ? 'Follower roster' : 'Tricks / abilities'}</label>
            <textarea rows="2" data-ctricks="${i}">${esc(comp.tricks)}</textarea></div>
          <div class="field"><label>Gear</label>
            <textarea rows="2" data-cgear="${i}">${esc(comp.gear)}</textarea></div>
          <div class="field"><label>Notes</label>
            <textarea rows="2" data-cnotes="${i}">${esc(comp.notes)}</textarea></div>
        </div>
        ${!isLead && comp.type !== 'other' ? `<details class="small"><summary style="cursor:pointer;color:var(--accent)">Ability score overrides</summary>
          ${PF.ABILITIES.map(ab => `<label style="margin-right:8px">${ab.toUpperCase()}
            <input class="tiny" type="number" data-cab="${i}:${ab}" value="${(comp.abilityOverride || {})[ab] != null ? comp.abilityOverride[ab] : ''}" placeholder="auto"></label>`).join('')}
          <label style="margin-left:10px">Misc natural armor <input class="tiny" type="number" data-cnat="${i}" value="${comp.miscNatArmor || 0}"></label>
        </details>` : ''}
      </div>`;
    }

    main.querySelectorAll('[data-addcomp]').forEach(b => b.addEventListener('click', () => {
      const comp = PF.newCompanion(b.dataset.addcomp);
      const open = (sp) => { if (sp) comp.species = sp.name; c.companions.push(comp); save(); render(); };
      if (comp.type === 'animal companion' || comp.type === 'mount') {
        Library.pickModal('companionSpecies', 'Choose Animal Companion', open);
      } else if (comp.type === 'familiar') {
        Library.pickModal('familiarSpecies', 'Choose Familiar', open);
      } else open(null);
    }));
    main.querySelectorAll('[data-delcomp]').forEach(b => b.addEventListener('click', () => {
      c.companions.splice(parseInt(b.dataset.delcomp, 10), 1); save(); render();
    }));
    main.querySelectorAll('[data-cname]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.cname].name = el.value; save();
    }));
    main.querySelectorAll('[data-eff]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.eff].effOverride = el.value === '' ? null : parseInt(el.value, 10); save(); render();
    }));
    main.querySelectorAll('[data-chp]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.chp].hpOverride = parseInt(el.value, 10) || null; save(); render();
    }));
    main.querySelectorAll('[data-form]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.form].form = el.value; save(); render();
    }));
    main.querySelectorAll('[data-link]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.link].linkedId = el.value; save(); render();
    }));
    main.querySelectorAll('[data-leadmod]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.leadmod].leadMod = parseInt(el.value, 10) || 0; save(); render();
    }));
    main.querySelectorAll('[data-opencomp]').forEach(b => b.addEventListener('click', () => {
      state.charId = b.dataset.opencomp; state.builderTab = 'profile'; render();
    }));
    main.querySelectorAll('[data-pickspecies]').forEach(b => b.addEventListener('click', () =>
      Library.pickModal('companionSpecies', 'Choose Animal Companion', sp => {
        c.companions[+b.dataset.pickspecies].species = sp.name; save(); render();
      })));
    main.querySelectorAll('[data-pickfam]').forEach(b => b.addEventListener('click', () =>
      Library.pickModal('familiarSpecies', 'Choose Familiar', sp => {
        c.companions[+b.dataset.pickfam].species = sp.name; save(); render();
      })));
    for (const [attr, key] of [['catk', 'attacks'], ['ctricks', 'tricks'], ['cgear', 'gear'], ['cnotes', 'notes']]) {
      main.querySelectorAll(`[data-${attr}]`).forEach(el => el.addEventListener('change', () => {
        c.companions[+el.dataset[attr]][key] = el.value; save();
      }));
    }
    main.querySelectorAll('[data-cab]').forEach(el => el.addEventListener('change', () => {
      const [i, ab] = el.dataset.cab.split(':');
      const comp = c.companions[+i];
      if (!comp.abilityOverride) comp.abilityOverride = {};
      if (el.value === '') delete comp.abilityOverride[ab];
      else comp.abilityOverride[ab] = parseInt(el.value, 10);
      save(); render();
    }));
    main.querySelectorAll('[data-cnat]').forEach(el => el.addEventListener('change', () => {
      c.companions[+el.dataset.cnat].miscNatArmor = parseInt(el.value, 10) || 0; save(); render();
    }));
  }

  // ----- notes -----
  function tabNotes(main, c) {
    main.innerHTML = `<h2>Notes</h2>${statBar(c)}
      <div class="panel">
        ${field('Combat adjustments', '')}
        <div class="grid3">
          ${[['naturalArmor', 'Natural armor'], ['deflection', 'Deflection AC'], ['dodge', 'Dodge AC'], ['miscAC', 'Misc AC'],
             ['miscInit', 'Init misc'], ['miscFort', 'Fort misc'], ['miscRef', 'Ref misc'], ['miscWill', 'Will misc'],
             ['miscAttack', 'Attack misc'], ['miscCMB', 'CMB misc'], ['miscCMD', 'CMD misc'], ['hpMisc', 'HP misc'],
             ['speedMisc', 'Speed misc (ft)']].map(([k, l]) =>
            `<label class="small">${l} <input class="tiny" type="number" data-cb="${k}" value="${c.combat[k] || 0}"></label>`).join('')}
        </div>
        <p class="small muted">Use these for buffs, magic items, class features and feats that the sheet doesn't compute automatically (rings of protection, amulets of natural armor, Dodge, Iron Will…).</p>
      </div>
      <div class="panel">
        ${field('Adventure notes', `<textarea id="nt-notes" rows="8" style="width:100%">${esc(c.notes)}</textarea>`)}
        ${field('Background / personality', `<textarea id="nt-back" rows="8" style="width:100%">${esc(c.backstory)}</textarea>`)}
      </div>`;
    main.querySelectorAll('[data-cb]').forEach(el => el.addEventListener('change', () => {
      c.combat[el.dataset.cb] = parseInt(el.value, 10) || 0; save();
    }));
    bind('nt-notes', c, v => c.notes = v);
    bind('nt-back', c, v => c.backstory = v);
  }

  // ---------------- boot ----------------
  function boot() {
    const missing = ['classes', 'races', 'feats', 'spells', 'items', 'skills', 'traits', 'weapons', 'armors', 'archetypes', 'racialTraits']
      .filter(k => !window.PFDATA || !PFDATA[k]);
    if (missing.length) {
      $('#app').innerHTML = `<div class="boot">Missing data files: ${missing.join(', ')}.<br>
        Run <code>python build_data.py</code> in the app folder to regenerate them.</div>`;
      return;
    }
    render();
  }
  boot();
})();
