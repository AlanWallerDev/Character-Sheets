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

  // ---------- build a real character object from the picks ----------
  function buildCharacter(picks) {
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
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <button class="primary" id="gen-spin">🎰 Spin</button>
          <button id="gen-save" style="display:none">💾 Save to Vault</button>
          <button id="gen-cancel">← Back</button>
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
      const incr = Math.floor(picks.level / 4);
      main.querySelector('#gen-result').innerHTML =
        `<b>${picks.race} ${picks.cls}</b>, level ${picks.level} — ${alignLabel}<br>
         <span class="small">${finals}</span>
         <span class="small muted">(incl. racial mods${incr ? ' & +' + incr + ' level increases' : ''} — seed ${picks.seed})</span>`;
    }

    function spin() {
      const syn = parseInt(main.querySelector('#gen-syn').value, 10) / 100;
      const seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
      const rng = mulberry32(seed);
      picks = { seed };
      spinBtn.disabled = true;
      saveBtn.style.display = 'none';
      main.querySelector('#gen-result').innerHTML = '';

      // dependent reels spin in sequence…
      const seq = [
        { id: 'level',     label: 'level',     cands: () => levelCandidates(),        set: v => picks.level = v },
        { id: 'race',      label: 'race',      cands: () => raceCandidates(),         set: v => picks.race = v },
        { id: 'class',     label: 'class',     cands: () => classCandidates(picks),   set: v => picks.cls = v },
        { id: 'alignment', label: 'alignment', cands: () => alignmentCandidates(picks), set: v => picks.alignment = v },
      ];
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
            if (++landed === ABILITIES.length) finishSpin();
          }, { duration: 0.85 }), idx * 140);
        });
      };
      next();
    }

    spinBtn.addEventListener('click', spin);
    saveBtn.addEventListener('click', () => { if (picks) api.onSave(buildCharacter(picks)); });
    main.querySelector('#gen-cancel').addEventListener('click', api.onCancel);
  }

  window.PFGEN = { renderView, buildCharacter, legalAlignments, alignmentCandidates,
                   abilityCandidates, levelCandidates, raceCandidates, classCandidates,
                   mulberry32, weightedPick };
})();
