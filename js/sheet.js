/* Character sheet renderer (screen + print). */
'use strict';

const Sheet = (() => {
  const esc = Library.esc;
  const fmt = n => (n >= 0 ? '+' + n : String(n));

  // hoverable reference: app.js shows a detail popover for these
  function ref(type, name, label, extra) {
    if (!name) return esc(label || '');
    return `<span class="ref" data-rt="${esc(type)}" data-rn="${esc(name)}"${extra ? ` data-rx="${esc(extra)}"` : ''}>${esc(label || name)}</span>`;
  }

  function render(c) {
    const t = PF.totals(c);
    const hp = PF.hpBreakdown(c);
    const ac = PF.acBreakdown(c);
    const sv = PF.saves(c);
    const cm = PF.combatManeuvers(c);
    const race = PF.getRace(c.race);
    const classesStr = [...PF.classLevels(c)].map(([k, v]) => {
      const archs = uniqArchetypes(c, k);
      return `${ref('classes', k)}${archs.length ? ' (' + archs.map(a => ref('archetypes', a)).join(', ') + ')' : ''} ${v}`;
    }).join(' / ') || '—';
    const init = PF.abilityMod(c, 'dex') + (c.combat.miscInit || 0);
    const acp = PF.armorCheckPenalty(c);
    const cap = PF.carryCapacity(c);
    const load = PF.gearWeight(c);

    let h = `<div class="sheet">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <h1 style="margin:0">${esc(c.name)}</h1>
        <div class="muted">${esc(c.player ? 'Player: ' + c.player : '')}</div>
      </div>
      <div class="sheet-sec muted small">
        ${[esc(c.alignment), race ? ref('races', race.name) : '', classesStr, 'Level ' + t.level].filter(Boolean).join(' • ')}
        ${c.deity ? ' • ' + esc(c.deity) : ''}${c.homeland ? ' • ' + esc(c.homeland) : ''}
      </div>
      <div class="sheet-sec">`;

    // ability block
    for (const ab of PF.ABILITIES) {
      const sc = PF.abilityScore(c, ab);
      h += `<span class="stat-big"><span class="v">${sc}</span><span class="l">${ab.toUpperCase()} ${fmt(PF.mod(sc))}</span></span>`;
    }
    h += `</div><div class="sheet-sec">
      <span class="stat-big"><span class="v">${hp.total}</span><span class="l">Hit Points</span></span>
      <span class="stat-big"><span class="v">${ac.total}</span><span class="l">AC (T ${ac.touch} / FF ${ac.flat})</span></span>
      <span class="stat-big"><span class="v">${fmt(init)}</span><span class="l">Initiative</span></span>
      <span class="stat-big"><span class="v">${PF.speed(c)} ft</span><span class="l">Speed</span></span>
      <span class="stat-big"><span class="v">${fmt(t.bab)}</span><span class="l">BAB</span></span>
      <span class="stat-big"><span class="v">${fmt(cm.cmb)}</span><span class="l">CMB</span></span>
      <span class="stat-big"><span class="v">${cm.cmd}</span><span class="l">CMD</span></span>
      <span class="stat-big roller" data-roll-label="Fortitude" data-roll-mod="${sv.fort}" title="click to roll"><span class="v">${fmt(sv.fort)}</span><span class="l">Fortitude</span></span>
      <span class="stat-big roller" data-roll-label="Reflex" data-roll-mod="${sv.ref}" title="click to roll"><span class="v">${fmt(sv.ref)}</span><span class="l">Reflex</span></span>
      <span class="stat-big roller" data-roll-label="Will" data-roll-mod="${sv.will}" title="click to roll"><span class="v">${fmt(sv.will)}</span><span class="l">Will</span></span>
    </div>`;

    // attacks (ammunition is excluded here and tracked separately below)
    const weapons = c.gear.filter(g => g.kind === 'weapon' && !PF.gearIsAmmo(g));
    const ammo = c.gear.filter(g => PF.gearIsAmmo(g));
    if (weapons.length) {
      h += `<h3>Attacks</h3><table class="data"><tr><th>Weapon</th><th>Attack</th><th>Damage</th><th>Critical</th><th>Type</th></tr>`;
      for (const g of weapons) {
        const w = PF.getWeapon(g.name);
        const mw = PF.magicWeapon(g);
        const ranged = PF.isRangedWeapon(w);
        const abM = ranged ? PF.abilityMod(c, 'dex') : PF.abilityMod(c, 'str');
        const sizeM = PF.SIZE_MOD[(race && race.size) || 'Medium'] || 0;
        const atk = PF.iterAttacks(t.bab).map(b => fmt(b + abM + sizeM + mw.atk + (c.combat.miscAttack || 0))).join('/');
        const dmgMod = (ranged ? 0 : PF.abilityMod(c, 'str')) + mw.dmg;
        const dmgText = (w ? w.dmgM : '—') + (dmgMod ? ' ' + fmt(dmgMod) : '') + (mw.dmgBonus ? ' + ' + mw.dmgBonus : '');
        h += `<tr><td>${ref('gear', g.name, PF.gearDisplayName(g))}</td><td>${atk}</td>
          <td>${esc(dmgText)}</td>
          <td>${esc(w ? w.crit : '')}</td><td>${esc(w ? w.dtype : '')}</td></tr>`;
      }
      h += '</table>';
    }
    if (ammo.length) {
      h += `<p class="small"><b>Ammunition:</b> ` + ammo.map(g =>
        `${esc(PF.gearDisplayName(g))} ×${g.qty || 1}`).join(', ') + '</p>';
    }

    // skills
    const ranks = Object.entries(c.skills).filter(([, r]) => r > 0);
    if (ranks.length) {
      h += `<h3>Skills</h3><table class="data"><tr><th>Skill</th><th class="num">Total</th><th class="num">Ranks</th><th class="num">Ability</th><th class="num">Misc</th></tr>`;
      for (const [name, r] of ranks.sort((a, b) => a[0].localeCompare(b[0]))) {
        const ab = PF.skillAbility(name);
        const isCs = PF.isClassSkill(c, name);
        h += `<tr><td>${ref('skills', name)}${isCs ? ' <span class="muted small">(class)</span>' : ''}</td>
          <td class="num roller" data-roll-label="${esc(name)}" data-roll-mod="${PF.skillBonus(c, name)}" title="click to roll"><b>${fmt(PF.skillBonus(c, name))}</b></td>
          <td class="num">${r}</td><td class="num">${ab.toUpperCase()} ${fmt(PF.abilityMod(c, ab))}</td>
          <td class="num">${(parseInt(c.skillMisc[name], 10) || 0) + (isCs && r > 0 ? 3 : 0)}</td></tr>`;
      }
      h += `</table><div class="small muted">Armor check penalty: ${acp}</div>`;
    }

    // class features (base "Special" column with archetype replacements applied)
    const cf = PF.classFeatures(c);
    if (cf.some(g => g.features.length || g.unmatchedArch.length)) {
      h += `<h3>Class Features</h3>`;
      const multi = cf.length > 1;
      for (const grp of cf) {
        if (!grp.features.length && !grp.unmatchedArch.length) continue;
        if (multi) h += `<p class="small" style="margin:.5em 0 .2em"><b>${ref('classes', grp.clsName)} ${grp.lvl}</b></p>`;
        h += '<p>' + grp.features.map(f => {
          const isArch = f.source !== 'class';
          const disp = f.name.charAt(0).toUpperCase() + f.name.slice(1);
          const label = ref(isArch ? 'archfeat' : 'classfeat', f.name, disp, isArch ? f.source : grp.clsName);
          const lvls = `<span class="muted small"> (Lv ${f.levels.join(', ')})</span>`;
          const alt = f.alteredBy.length ? `<span class="muted small"> — altered by ${esc(f.alteredBy.join(', '))}</span>`
            : (f.complex ? `<span class="muted small"> — modifies class features (see description)</span>` : '');
          return `<span class="pill${isArch ? ' gold' : ''}">${label}${lvls}${alt}</span>`;
        }).join(' ') + '</p>';
        if (grp.unmatchedArch.length) {
          h += `<p class="small muted">Archetype not recognized (typed as a note): ${grp.unmatchedArch.map(esc).join(', ')}</p>`;
        }
      }
    }

    // feats & traits
    if (c.feats.length) {
      h += `<h3>Feats</h3><p>` + c.feats.map(f => {
        const feat = PF.getFeat(f.name || f);
        const unmet = feat && PF.checkFeatPrereqs(c, feat).status === 'unmet';
        return `<span class="pill${unmet ? ' pill-unmet' : ''}"${unmet ? ' title="prerequisites not met — hover the name for details"' : ''}>${unmet ? '⚠ ' : ''}${ref('feats', f.name || f)}${f.note ? ' <span class="muted">(' + esc(f.note) + ')</span>' : ''}</span>`;
      }).join(' ') + '</p>';
    }
    if (c.traits.length) {
      const findTrait = tn => (PFDATA.traits || []).find(x => x.name === tn);
      const traitCat = {};
      c.traits.forEach(tn => { const tr = findTrait(tn); if (tr && tr.category) traitCat[tr.category] = (traitCat[tr.category] || 0) + 1; });
      h += `<h3>Traits</h3><p>` + c.traits.map(tn => {
        const tr = findTrait(tn);
        const dup = tr && tr.category && traitCat[tr.category] > 1;
        return `<span class="pill${dup ? ' pill-unmet' : ''}"${dup ? ` title="More than one ${esc(tr.category)} trait — only one per category is allowed"` : ''}>${dup ? '⚠ ' : ''}${ref('traits', tn)}</span>`;
      }).join(' ') + '</p>';
    }
    if (race) {
      // standard traits with the ones replaced by chosen alternates removed
      const rtData = PF.racialTraits(c);
      h += `<h3>Racial Traits</h3><p>`;
      h += rtData.standard.filter(s => !s.replaced).map(s =>
        `<span class="pill">${ref('racetrait', s.name, s.name, race.name)}</span>`).join(' ');
      if (rtData.alternates.length) h += ' ' + rtData.alternates.map(a =>
        `<span class="pill gold">${ref('racialTraits', a.name)} <span class="muted small">(alt${a.complex ? ', modifies traits' : ''})</span></span>`).join(' ');
      h += '</p>';
      if (rtData.unmatched.length) h += `<p class="small muted">Alternate racial trait not recognized: ${rtData.unmatched.map(esc).join(', ')}</p>`;
    }
    if (c.languages) h += `<p><b>Languages:</b> ${esc(c.languages)}</p>`;

    // spells
    for (const [clsName] of PF.classLevels(c)) {
      const slots = PF.spellSlots(c, clsName);
      if (!slots) continue;
      const info = PF.casterInfo(clsName);
      h += `<h3>${esc(clsName)} Spells <span class="small muted">(${info.kind}, ${info.ability.toUpperCase()}-based)</span></h3>`;
      h += `<table class="data"><tr><th>Spell Level</th>${slots.map(s => `<th class="num">${s.lvl}</th>`).join('')}</tr>`;
      h += `<tr><td>Slots/Day (incl. bonus)</td>${slots.map(s => `<td class="num">${s.total == null ? '—' : s.total}</td>`).join('')}</tr>`;
      h += `<tr><td>Save DC</td>${slots.map(s => `<td class="num">${s.total == null ? '—' : 10 + s.lvl + PF.abilityMod(c, info.ability)}</td>`).join('')}</tr></table>`;
      const known = c.spells.filter(s => s.cls === clsName);
      if (known.length) {
        const byLvl = {};
        for (const s of known) (byLvl[s.lvl] = byLvl[s.lvl] || []).push(s);
        for (const lvl of Object.keys(byLvl).sort((a, b) => a - b)) {
          h += `<p><b>Level ${lvl}:</b> ` + byLvl[lvl].map(s =>
            `${ref('spells', s.name)}${s.prepared ? ' <span class="muted small">(×' + s.prepared + ')</span>' : ''}`).join(', ') + '</p>';
        }
      }
    }

    // gear
    if (c.gear.length) {
      h += `<h3>Gear</h3><table class="data"><tr><th>Item</th><th class="num">Qty</th><th class="num">Weight</th><th>Notes</th></tr>`;
      for (const g of c.gear) {
        h += `<tr><td>${ref('gear', g.name, PF.gearDisplayName(g))}${g.equipped ? ' <span class="muted small">(equipped)</span>' : ''}</td>
          <td class="num">${g.qty || 1}</td><td class="num">${esc(g.weight || '')}</td><td>${esc(g.note || '')}</td></tr>`;
      }
      h += `</table>
      <p class="small muted">Total weight: ${load} lbs — Light ${cap.light} / Medium ${cap.medium} / Heavy ${cap.heavy}
      ${load > cap.medium ? '<span class="err">(heavy load)</span>' : load > cap.light ? '<span class="warn">(medium load)</span>' : ''}</p>
      <p><b>Money:</b> ${c.money.pp || 0} pp, ${c.money.gp || 0} gp, ${c.money.sp || 0} sp, ${c.money.cp || 0} cp</p>`;
    }

    // companions
    for (const comp of (c.companions || [])) {
      const d = PF.companionDerived(c, comp);
      const label = comp.type.replace(/\b\w/g, m => m.toUpperCase());
      const spType = comp.type === 'familiar' ? 'familiarSpecies' : 'companionSpecies';
      h += `<h3>${esc(comp.name || '(unnamed)')} <span class="small muted">— ${esc(label)}${comp.species ? ', ' + ref(spType, comp.species) : ''}${comp.type === 'eidolon' ? ', ' + esc(comp.form) : ''}</span></h3>`;
      if (d.abilities) {
        h += `<div class="sheet-sec">`;
        for (const ab of PF.ABILITIES) {
          h += `<span class="stat-big"><span class="v">${d.abilities[ab]}</span><span class="l">${ab.toUpperCase()} ${fmt(PF.mod(d.abilities[ab]))}</span></span>`;
        }
        h += `</div>
        <p class="small"><b>Level ${d.lvl}</b>${d.hd ? ` • HD ${d.hd}${d.hdDie ? 'd' + d.hdDie : ''}` : ''}
          • <b>HP</b> ${d.hp} • <b>AC</b> ${d.ac} • <b>BAB</b> ${fmt(d.bab)}
          • <b>F/R/W</b> ${fmt(d.saves.fort)}/${fmt(d.saves.ref)}/${fmt(d.saves.will)}
          • ${esc(d.size)}${d.speed ? ', ' + esc(d.speed) : ''}</p>`;
        if (d.attacks || comp.attacks) h += `<p class="small"><b>Attacks:</b> ${esc(comp.attacks || d.attacks)}</p>`;
        if (d.special) h += `<p class="small"><b>Special:</b> ${esc(d.special)}</p>`;
      }
      const bits = Object.entries(d.extras).filter(([, v]) => v).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`);
      if (bits.length) h += `<p class="small">${bits.join(' • ')}</p>`;
      if (comp.tricks) h += `<p class="small"><b>Abilities/tricks:</b> ${esc(comp.tricks)}</p>`;
      if (comp.gear) h += `<p class="small"><b>Gear:</b> ${esc(comp.gear)}</p>`;
      if (comp.notes) h += `<p class="small">${esc(comp.notes)}</p>`;
    }

    if (c.notes) h += `<h3>Notes</h3><p>${esc(c.notes).replace(/\n/g, '<br>')}</p>`;
    if (c.backstory) h += `<h3>Background</h3><p>${esc(c.backstory).replace(/\n/g, '<br>')}</p>`;

    h += '</div>';
    return h;
  }

  function uniqArchetypes(c, cls) {
    const set = new Set();
    for (const l of c.levels) if (l.cls === cls && l.archetypes) l.archetypes.forEach(a => set.add(a));
    return [...set];
  }

  return { render };
})();
