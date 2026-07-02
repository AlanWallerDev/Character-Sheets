/* ============================================================================
 * js/generator.js — Random Character Generator (slot-machine reels)
 * ----------------------------------------------------------------------------
 * Phase 0: Level / Race / Class reels -> legal single-class character ->
 * Save to Vault. Weights come from PFGENDATA (data/bundles.js); legality and
 * character math come from the engine (PF). Later phases add ability reels,
 * archetypes, skill themes, feat/spell bundles, gear (see design memory).
 *
 * Contract with app.js: PFGEN.renderView(container, { onSave, onCancel }).
 * The view manages its own DOM during spins (no app re-renders mid-animation);
 * it only calls the api hooks, which save/navigate.
 * ============================================================================ */
(function () {
  'use strict';
  const G = () => window.PFGENDATA || {};

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

  // Class alignment restrictions (free text in class data) -> a legal alignment.
  function legalAlignment(clsName) {
    const k = (PFDATA.classes || []).find(x => x.name === clsName);
    const t = ((k && k.alignment) || '').toLowerCase();
    if (/lawful good\b/.test(t) && !/any/.test(t)) return 'LG';   // Paladin
    if (/any nonlawful/.test(t)) return 'CN';                     // Barbarian…
    if (/any lawful/.test(t)) return 'LN';                        // Monk…
    if (/any neutral/.test(t)) return 'N';                        // Druid…
    return 'N';                                                   // always legal
  }

  // ---------- build a real character object from the picks ----------
  function buildCharacter(picks) {
    const c = PF.newCharacter(picks.race + ' ' + picks.cls);
    const prof = (G().classProfiles || {})[picks.cls] || {};
    const race = (PFDATA.races || []).find(r => r.name === picks.race);
    c.race = picks.race;
    if (race && race.flex) c.flexChoice = (prof.keys || ['str'])[0];
    c.alignment = legalAlignment(picks.cls);
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
      .gen-reel-label{font-size:.85em;color:var(--muted,#999);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
      .gen-reel-window{height:${ITEM_H * VISIBLE}px;overflow:hidden;border:1px solid var(--border,#444);border-radius:8px;position:relative;background:rgba(0,0,0,.25)}
      .gen-reel-window::before,.gen-reel-window::after{content:'';position:absolute;left:0;right:0;height:${ITEM_H}px;pointer-events:none;z-index:1}
      .gen-reel-window::before{top:0;background:linear-gradient(rgba(0,0,0,.55),transparent)}
      .gen-reel-window::after{bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.55))}
      .gen-reel-strip{will-change:transform}
      .gen-reel-strip div{height:${ITEM_H}px;line-height:${ITEM_H}px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
      .gen-reel.done .gen-reel-window{border-color:var(--accent,#c9a227)}
      .gen-reel.done .gen-reel-strip div{color:var(--accent,#c9a227);font-weight:bold}
    `;
    document.head.appendChild(st);
  }

  // Fill a reel strip with filler rows + the chosen label last, then animate
  // so the chosen row stops on the center line. Calls done() after landing.
  function spinReel(reelEl, candidates, chosen, rng, done) {
    const strip = reelEl.querySelector('.gen-reel-strip');
    const rows = [];
    const fillers = Math.min(22, Math.max(12, candidates.length));
    for (let i = 0; i < fillers; i++)
      rows.push(candidates[Math.floor(rng() * candidates.length)].label);
    rows.push(chosen.label);                       // lands on center row
    rows.push('');                                 // padding below center
    strip.innerHTML = rows.map(r => `<div>${r}</div>`).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    reelEl.classList.remove('done');
    // force reflow so the transition below actually animates
    void strip.offsetHeight;
    const target = (rows.length - 2 - 1) * ITEM_H; // chosen row -> middle row
    strip.style.transition = 'transform 1.25s cubic-bezier(.15,.85,.25,1)';
    strip.style.transform = 'translateY(-' + target + 'px)';
    let fired = false;
    const finish = () => {
      if (fired) return; fired = true;
      reelEl.classList.add('done');
      done();
    };
    strip.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 1500);                      // safety net
  }

  // ---------- the view ----------
  function renderView(main, api) {
    injectCss();
    main.innerHTML = `<h2>🎲 Random Character</h2>
      <div class="panel">
        <p class="small muted">Spin the reels — each result weights the next
        (your race nudges your class, and later phases will chain abilities,
        feats and spells the same way). Everything rolled is rules-legal.</p>
        <div class="gen-reels">
          ${['Level', 'Race', 'Class'].map(l => `
            <div class="gen-reel" data-reel="${l.toLowerCase()}">
              <div class="gen-reel-label">${l}</div>
              <div class="gen-reel-window"><div class="gen-reel-strip"><div></div><div style="color:var(--muted,#888)">—</div><div></div></div></div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="primary" id="gen-spin">🎰 Spin</button>
          <button id="gen-save" style="display:none">💾 Save to Vault</button>
          <button id="gen-cancel">← Back</button>
          <span class="small muted" id="gen-status"></span>
        </div>
        <div id="gen-result" style="margin-top:12px"></div>
      </div>`;

    const reel = name => main.querySelector(`[data-reel="${name}"]`);
    const status = main.querySelector('#gen-status');
    const saveBtn = main.querySelector('#gen-save');
    const spinBtn = main.querySelector('#gen-spin');
    let picks = null;

    function spin() {
      const seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
      const rng = mulberry32(seed);
      picks = { seed };
      spinBtn.disabled = true;
      saveBtn.style.display = 'none';
      main.querySelector('#gen-result').innerHTML = '';
      status.textContent = 'Rolling level…';

      const lvlCands = levelCandidates();
      const lvl = weightedPick(rng, lvlCands);
      spinReel(reel('level'), lvlCands, lvl, rng, () => {
        picks.level = lvl.value;
        status.textContent = 'Rolling race…';
        const raceCands = raceCandidates();
        const race = weightedPick(rng, raceCands);
        spinReel(reel('race'), raceCands, race, rng, () => {
          picks.race = race.value;
          status.textContent = 'Rolling class…';
          const clsCands = classCandidates(picks);
          const cls = weightedPick(rng, clsCands);
          spinReel(reel('class'), clsCands, cls, rng, () => {
            picks.cls = cls.value;
            status.textContent = '';
            spinBtn.disabled = false;
            spinBtn.textContent = '🎰 Spin Again';
            saveBtn.style.display = '';
            main.querySelector('#gen-result').innerHTML =
              `<b>${picks.race} ${picks.cls}</b>, level ${picks.level}
               <span class="small muted">(alignment ${legalAlignment(picks.cls)},
               seed ${picks.seed})</span>`;
          });
        });
      });
    }

    spinBtn.addEventListener('click', spin);
    saveBtn.addEventListener('click', () => { if (picks) api.onSave(buildCharacter(picks)); });
    main.querySelector('#gen-cancel').addEventListener('click', api.onCancel);
  }

  window.PFGEN = { renderView, buildCharacter, legalAlignment,
                   levelCandidates, raceCandidates, classCandidates, mulberry32, weightedPick };
})();
