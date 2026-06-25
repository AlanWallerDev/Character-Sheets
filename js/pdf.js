/* Native (vector/text) PDF character-sheet export via jsPDF.
   Produces selectable text, real page breaks (never splits a table row), and controlled margins. */
'use strict';

const PDF = (() => {
  const fmt = n => (n >= 0 ? '+' + n : String(n));

  const COL = {
    head: [122, 47, 18],   // dark red headings
    rule: [150, 120, 80],  // section underline
    text: [25, 22, 18],
    muted: [120, 110, 92],
    faint: [205, 195, 175],
    warn: [150, 60, 20],
  };

  function exportSheet(c) {
    if (!window.jspdf) {
      const msg = 'PDF library not loaded (check the vendor/ folder).';
      if (window.UI && window.UI.alert) window.UI.alert(msg, { title: 'PDF export' }); else alert(msg);
      return;
    }
    c = PF.effective(c, { buffs: false });   // bake permanent feature/trait bonuses into the base
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 42;
    const right = pageW - M;
    const avail = right - M;
    const bottom = pageH - 34;   // leave room for footer
    let y = M;

    const font = (style, size, color) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      const cc = color || COL.text;
      doc.setTextColor(cc[0], cc[1], cc[2]);
    };
    const ensure = h => { if (y + h > bottom) { doc.addPage(); y = M; } };

    function sectionHeader(title) {
      ensure(28);
      y += 6;
      font('bold', 12.5, COL.head);
      doc.text(title, M, y + 8);
      doc.setDrawColor(COL.rule[0], COL.rule[1], COL.rule[2]);
      doc.setLineWidth(0.8);
      doc.line(M, y + 12, right, y + 12);
      y += 22;
    }

    function para(text, opts = {}) {
      const size = opts.size || 9.5;
      const lh = size * 1.3;
      font(opts.style || 'normal', size, opts.color);
      const indent = opts.indent || 0;
      const lines = doc.splitTextToSize(String(text || ''), avail - indent);
      for (const ln of lines) {
        ensure(lh);
        doc.text(ln, M + indent, y + size);
        y += lh;
      }
    }

    // label: value runs (e.g. "Languages: Common, Elven")
    function keyVal(label, value) {
      const size = 9.5, lh = size * 1.35;
      font('bold', size, COL.text);
      const labelW = doc.getTextWidth(label + '  ');
      const lines = doc.splitTextToSize(String(value || ''), avail - labelW);
      ensure(lh * lines.length);
      doc.text(label, M, y + size);
      font('normal', size, COL.text);
      lines.forEach((ln, i) => { doc.text(ln, M + labelW, y + size + i * lh); });
      y += lh * lines.length;
    }

    // grid of small boxes: items = [{label, value}]
    function statGrid(items, perRow) {
      const gap = 6;
      const boxW = (avail - gap * (perRow - 1)) / perRow;
      const boxH = 32;
      for (let i = 0; i < items.length; i += perRow) {
        const rowItems = items.slice(i, i + perRow);
        ensure(boxH + gap);
        let x = M;
        for (const it of rowItems) {
          doc.setDrawColor(COL.rule[0], COL.rule[1], COL.rule[2]);
          doc.setLineWidth(0.6);
          doc.roundedRect(x, y, boxW, boxH, 3, 3);
          font('bold', 13, COL.head);
          doc.text(String(it.value), x + boxW / 2, y + 15, { align: 'center' });
          font('normal', 6.5, COL.muted);
          doc.text(String(it.label).toUpperCase(), x + boxW / 2, y + 26, { align: 'center' });
          x += boxW + gap;
        }
        y += boxH + gap;
      }
    }

    // table with header, wrapping cells, per-row page breaks
    function table(headers, rows, fractions, aligns) {
      if (!rows.length) return;
      const w = fractions.map(f => f * avail);
      const lh = 11;
      const pad = 3;
      const drawHeader = () => {
        ensure(lh + 5);
        font('bold', 8.5, COL.head);
        let x = M;
        headers.forEach((hd, i) => {
          const a = (aligns && aligns[i]) || 'left';
          const tx = a === 'right' ? x + w[i] - pad : (a === 'center' ? x + w[i] / 2 : x + pad);
          doc.text(String(hd), tx, y + 8, { align: a });
          x += w[i];
        });
        doc.setDrawColor(COL.rule[0], COL.rule[1], COL.rule[2]);
        doc.setLineWidth(0.6);
        doc.line(M, y + 11, right, y + 11);
        y += lh + 4;
      };
      drawHeader();
      for (const row of rows) {
        font('normal', 8.5, COL.text);
        const cellLines = row.map((cell, i) => doc.splitTextToSize(String(cell == null ? '' : cell), w[i] - pad * 2));
        const rowH = Math.max(1, ...cellLines.map(cl => cl.length)) * lh;
        if (y + rowH > bottom) { doc.addPage(); y = M; drawHeader(); font('normal', 8.5, COL.text); }
        let x = M;
        cellLines.forEach((cl, i) => {
          const a = (aligns && aligns[i]) || 'left';
          const tx = a === 'right' ? x + w[i] - pad : (a === 'center' ? x + w[i] / 2 : x + pad);
          doc.text(cl, tx, y + 8, { align: a });
          x += w[i];
        });
        y += rowH + 2;
        doc.setDrawColor(COL.faint[0], COL.faint[1], COL.faint[2]);
        doc.setLineWidth(0.3);
        doc.line(M, y - 1, right, y - 1);
      }
      y += 6;
    }

    // ---------------- gather data ----------------
    const t = PF.totals(c);
    const hp = PF.hpBreakdown(c);
    const ac = PF.acBreakdown(c);
    const sv = PF.saves(c);
    const cm = PF.combatManeuvers(c);
    const race = PF.getRace(c.race);
    const sizeM = PF.SIZE_MOD[(race && race.size) || 'Medium'] || 0;
    const init = PF.abilityMod(c, 'dex') + (c.combat.miscInit || 0);
    const classesStr = [...PF.classLevels(c)].map(([k, v]) => k + ' ' + v).join(' / ') || '—';

    // ---------------- header ----------------
    font('bold', 20, COL.head);
    doc.text(c.name || 'Character', M, y + 16);
    y += 26;
    const subBits = [c.alignment, race ? race.name : '', classesStr, 'Level ' + t.level, c.deity, c.homeland].filter(Boolean);
    para(subBits.join('   •   '), { size: 10, color: COL.muted });
    if (c.player) para('Player: ' + c.player, { size: 9, color: COL.muted });
    y += 4;

    // ---------------- abilities ----------------
    statGrid(PF.ABILITIES.map(ab => {
      const sc = PF.abilityScore(c, ab);
      return { label: ab.toUpperCase() + '  ' + fmt(PF.mod(sc)), value: sc };
    }), 6);

    // ---------------- combat ----------------
    statGrid([
      { label: 'Hit Points', value: hp.total },
      { label: 'AC', value: ac.total },
      { label: 'Touch', value: ac.touch },
      { label: 'Flat-Footed', value: ac.flat },
      { label: 'Initiative', value: fmt(init) },
      { label: 'Speed', value: PF.speed(c) + ' ft' },
      { label: 'BAB', value: fmt(t.bab) },
      { label: 'CMB', value: fmt(cm.cmb) },
      { label: 'CMD', value: cm.cmd },
      { label: 'Fortitude', value: fmt(sv.fort) },
      { label: 'Reflex', value: fmt(sv.ref) },
      { label: 'Will', value: fmt(sv.will) },
    ], 6);

    // ---------------- attacks ----------------
    const weapons = c.gear.filter(g => g.kind === 'weapon');
    if (weapons.length) {
      sectionHeader('Attacks');
      const rows = weapons.map(g => {
        const w = PF.getWeapon(g.name);
        const mw = PF.magicWeapon(g);
        const ranged = PF.isRangedWeapon(w);
        const abM = ranged ? PF.abilityMod(c, 'dex') : PF.abilityMod(c, 'str');
        const atk = PF.iterAttacks(t.bab).map(b => fmt(b + abM + sizeM + mw.atk + (c.combat.miscAttack || 0))).join('/');
        const dmgMod = (ranged ? 0 : PF.abilityMod(c, 'str')) + mw.dmg;
        const dmg = (w ? w.dmgM : '—') + (dmgMod ? ' ' + fmt(dmgMod) : '') + (mw.dmgBonus ? ' + ' + mw.dmgBonus : '');
        return [PF.gearDisplayName(g), atk, dmg, w ? w.crit : '', w ? w.dtype : ''];
      });
      table(['Weapon', 'Attack', 'Damage', 'Crit', 'Type'], rows,
        [0.40, 0.20, 0.22, 0.10, 0.08], ['left', 'left', 'left', 'left', 'left']);
    }

    // ---------------- skills ----------------
    const skillRows = Object.entries(c.skills).filter(([, r]) => r > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, r]) => {
        const ab = PF.skillAbility(name);
        const isCs = PF.isClassSkill(c, name);
        return [name + (isCs ? ' (c)' : ''), fmt(PF.skillBonus(c, name)), String(r),
          ab.toUpperCase() + ' ' + fmt(PF.abilityMod(c, ab))];
      });
    if (skillRows.length) {
      sectionHeader('Skills');
      table(['Skill', 'Total', 'Ranks', 'Ability'], skillRows,
        [0.52, 0.16, 0.14, 0.18], ['left', 'right', 'right', 'right']);
      para('Armor check penalty: ' + PF.armorCheckPenalty(c) + '   •   (c) = class skill', { size: 8, color: COL.muted });
    }

    // ---------------- class features & abilities ----------------
    const cf = PF.classFeatures(c);
    const abilByClass = {};
    for (const a of (c.classAbilities || [])) (abilByClass[a.cls] = abilByClass[a.cls] || []).push(a.name);
    if (cf.some(g => g.features.length) || Object.keys(abilByClass).length) {
      sectionHeader('Class Features');
      const multi = cf.length > 1;
      for (const grp of cf) {
        const abils = abilByClass[grp.clsName] || [];
        if (!grp.features.length && !abils.length) continue;
        const featStr = grp.features.map(f => {
          const disp = f.name.charAt(0).toUpperCase() + f.name.slice(1);
          return disp + (f.levels.length ? ' (' + f.levels.join(',') + ')' : '');
        }).join(', ');
        if (multi) { if (featStr) keyVal(grp.clsName + ' ' + grp.lvl + ':', featStr); }
        else if (featStr) para(featStr, { size: 9.5 });
        if (abils.length) keyVal(multi ? '  Abilities:' : 'Abilities:', abils.join(', '));
      }
    }

    // ---------------- feats / traits ----------------
    if (c.feats.length) {
      sectionHeader('Feats');
      for (const f of c.feats) {
        const feat = PF.getFeat(f.name);
        const unmet = feat && PF.checkFeatPrereqs(c, feat).status === 'unmet';
        const tag = feat ? '  (' + feat.types.join(', ') + ')' : '';
        keyVal((unmet ? '! ' : '• ') + (f.name || f), (f.note ? f.note + ' ' : '') + (feat && feat.desc ? '— ' + feat.desc : '') + tag);
      }
    }
    if (c.traits.length) {
      sectionHeader('Traits');
      para(c.traits.join(', '), { size: 9.5 });
    }
    if (race) {
      // standard traits with alternate-replaced ones removed, then the alternates
      const rtData = PF.racialTraits(c);
      const rtList = rtData.standard.filter(s => !s.replaced).map(s => s.name)
        .concat(rtData.alternates.map(a => a.name + ' (alt)'));
      sectionHeader('Racial Traits');
      para(rtList.join(', ') || '—', { size: 9.5 });
    }
    if (c.languages) { ensure(16); keyVal('Languages:', c.languages); }

    // ---------------- spells ----------------
    for (const [clsName] of PF.classLevels(c)) {
      const slots = PF.spellSlots(c, clsName);
      if (!slots) continue;
      const info = PF.casterInfo(clsName);
      sectionHeader(clsName + ' Spells');
      const lvls = slots.filter(s => s.total != null && s.lvl > 0);
      if (lvls.length) {
        const frac = [0.24].concat(lvls.map(() => 0.76 / lvls.length));
        const aligns = ['left'].concat(lvls.map(() => 'center'));
        table(['Spell Level'].concat(lvls.map(s => String(s.lvl))), [
          ['Slots/Day'].concat(lvls.map(s => String(s.total))),
          ['Save DC'].concat(lvls.map(s => String(10 + s.lvl + PF.abilityMod(c, info.ability)))),
        ], frac, aligns);
      }
      const known = c.spells.filter(s => s.cls === clsName);
      if (known.length) {
        const byLvl = {};
        for (const s of known) (byLvl[s.lvl] = byLvl[s.lvl] || []).push(s);
        for (const lvl of Object.keys(byLvl).sort((a, b) => a - b)) {
          keyVal('Level ' + lvl + ':', byLvl[lvl].map(s => s.name + (s.prepared ? ' (x' + s.prepared + ')' : '')).join(', '));
        }
      }
    }
    // spell-like abilities / spells not tied to a casting class
    const otherSpells = c.spells.filter(s => !s.cls);
    if (otherSpells.length) {
      sectionHeader('Spell-Like Abilities & Other Spells');
      para(otherSpells.map(s => s.name + (s.note ? ' (' + s.note + ')' : '')).join(', '), { size: 9.5 });
    }

    // ---------------- gear ----------------
    if (c.gear.length) {
      sectionHeader('Gear');
      const rows = c.gear.map(g => [
        PF.gearDisplayName(g) + (g.equipped ? '  (equipped)' : ''),
        String(g.qty || 1), String(g.weight != null ? g.weight : ''), g.note || '',
      ]);
      table(['Item', 'Qty', 'Wt', 'Notes'], rows, [0.52, 0.10, 0.12, 0.26], ['left', 'right', 'right', 'left']);
      const cap = PF.carryCapacity(c);
      para(`Total weight: ${PF.gearWeight(c)} lbs  (Light ${cap.light} / Medium ${cap.medium} / Heavy ${cap.heavy})`, { size: 8.5, color: COL.muted });
      const m = c.money;
      keyVal('Money:', `${m.pp || 0} pp, ${m.gp || 0} gp, ${m.sp || 0} sp, ${m.cp || 0} cp`);
    }

    // ---------------- companions ----------------
    for (const comp of (c.companions || [])) {
      if (comp.type === 'cohort') continue;
      const d = PF.companionDerived(c, comp);
      if (!d.abilities) continue;
      const label = comp.type.replace(/\b\w/g, ch => ch.toUpperCase());
      sectionHeader(`${comp.name || '(unnamed)'} — ${label}${comp.species ? ', ' + comp.species : ''}${comp.type === 'eidolon' ? ', ' + comp.form : ''}`);
      para(PF.ABILITIES.map(ab => ab.toUpperCase() + ' ' + d.abilities[ab] + ' (' + fmt(PF.mod(d.abilities[ab])) + ')').join('   '), { size: 9 });
      para(`Level ${d.lvl}${d.hd ? ' • HD ' + d.hd + (d.hdDie ? 'd' + d.hdDie : '') : ''} • HP ${d.hp} • AC ${d.ac} • BAB ${fmt(d.bab)} • F/R/W ${fmt(d.saves.fort)}/${fmt(d.saves.ref)}/${fmt(d.saves.will)} • ${d.size}${d.speed ? ', ' + d.speed : ''}`, { size: 9 });
      if (d.attacks || comp.attacks) para('Attacks: ' + (comp.attacks || d.attacks), { size: 9 });
      if (d.special) para('Special: ' + d.special, { size: 9 });
      if (comp.tricks) para((comp.type === 'eidolon' ? 'Evolutions: ' : 'Abilities: ') + comp.tricks, { size: 9 });
    }

    // ---------------- notes ----------------
    if (c.notes) { sectionHeader('Notes'); para(c.notes, { size: 9.5 }); }
    if (c.backstory) { sectionHeader('Background'); para(c.backstory, { size: 9.5 }); }

    // ---------------- footer (page numbers) ----------------
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      font('normal', 7.5, COL.muted);
      doc.text(`${c.name || 'Character'}  —  page ${i} of ${pages}`, pageW / 2, pageH - 18, { align: 'center' });
    }

    const fname = (c.name || 'character').replace(/[^\w\- ]/g, '').trim() || 'character';
    doc.save(fname + '.pdf');
  }

  return { exportSheet };
})();
