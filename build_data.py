#!/usr/bin/env python3
"""Compile PSRD-Data (Pathfinder 1e PRD) sqlite books into JS data files for the app.

Reads:  psrd/PSRD-Data-release/book-*.db
Writes: data/*.js  (each sets a key on window.PFDATA)
"""
import json
import os
import re
import sqlite3
import sys
from html import unescape
from html.parser import HTMLParser

SRC = os.path.join('psrd', 'PSRD-Data-release')
OUT = 'data'

BOOKS = {
    'cr': 'Core Rulebook',
    'apg': "Advanced Player's Guide",
    'acg': 'Advanced Class Guide',
    'arg': 'Advanced Race Guide',
    'um': 'Ultimate Magic',
    'uc': 'Ultimate Combat',
    'ue': 'Ultimate Equipment',
    'ucampaign': 'Ultimate Campaign',
    'ma': 'Mythic Adventures',
    'tech': 'Technology Guide',
    'gmg': 'GameMastery Guide',
    'b1': 'Bestiary',
    'b2': 'Bestiary 2',
    'b3': 'Bestiary 3',
    'b4': 'Bestiary 4',
    'mc': 'Monster Codex',
    'npc': 'NPC Codex',
}
# priority for dedup (earlier wins)
FEAT_PRIORITY = ['cr', 'apg', 'acg', 'arg', 'um', 'uc', 'ucampaign', 'ma', 'tech', 'b1', 'mc']
SPELL_PRIORITY = ['cr', 'apg', 'um', 'uc', 'acg', 'arg', 'tech', 'mc', 'ma']
ITEM_PRIORITY = ['ue', 'cr', 'apg', 'arg', 'acg', 'um', 'uc', 'tech', 'ma', 'mc', 'b1', 'b2', 'b3', 'b4']

TAG_RE = re.compile(r'<[^>]+>')


def strip_html(s):
    if not s:
        return ''
    return unescape(TAG_RE.sub(' ', s)).replace('\xa0', ' ').strip()


class TableParser(HTMLParser):
    """Parse an HTML table into caption + list of rows of cell dicts."""

    def __init__(self):
        super().__init__()
        self.caption = ''
        self.rows = []          # body rows
        self.head_rows = []     # thead rows
        self.seq = []           # ordered ('head'|'body', row) pairs
        self._row = None
        self._cell = None
        self._in_caption = False
        self._in_thead = False
        self._in_sup = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'caption':
            self._in_caption = True
        elif tag == 'thead':
            self._in_thead = True
        elif tag == 'tr':
            self._row = []
        elif tag == 'sup':
            self._in_sup += 1
        elif tag in ('td', 'th'):
            def safe_int(v):
                m = re.match(r'\d+', str(v or '1'))
                return int(m.group(0)) if m else 1
            self._cell = {
                'text': '',
                'colspan': safe_int(a.get('colspan', 1)),
                'rowspan': safe_int(a.get('rowspan', 1)),
            }

    def handle_endtag(self, tag):
        if tag == 'sup':
            self._in_sup = max(0, self._in_sup - 1)
        elif tag == 'caption':
            self._in_caption = False
        elif tag == 'thead':
            self._in_thead = False
        elif tag == 'tr':
            if self._row is not None:
                if self._in_thead:
                    self.head_rows.append(self._row)
                    self.seq.append(('head', self._row))
                else:
                    self.rows.append(self._row)
                    self.seq.append(('body', self._row))
            self._row = None
        elif tag in ('td', 'th') and self._cell is not None and self._row is not None:
            self._cell['text'] = unescape(self._cell['text']).replace('\xa0', ' ').strip()
            self._row.append(self._cell)
            self._cell = None

    def handle_data(self, data):
        if self._in_sup:
            return
        if self._in_caption:
            self.caption += data
        elif self._cell is not None:
            self._cell['text'] += data

    def handle_entityref(self, name):
        self.handle_data(unescape('&%s;' % name))


def parse_table(html):
    p = TableParser()
    p.feed(html)
    p.caption = p.caption.strip()
    return p


def flatten_header(head_rows):
    """Flatten 1-2 header rows (with colspan groups) into a flat column list."""
    if not head_rows:
        return []
    if len(head_rows) == 1:
        return [c['text'] for c in head_rows[0]]
    row1, row2 = head_rows[0], head_rows[1]
    cols = []
    i2 = 0
    for c in row1:
        if c['colspan'] > 1:
            for _ in range(c['colspan']):
                sub = row2[i2]['text'] if i2 < len(row2) else ''
                cols.append((c['text'] + ' ' + sub).strip())
                i2 += 1
        else:
            cols.append(c['text'])
    return cols


class Book:
    def __init__(self, key):
        self.key = key
        self.name = BOOKS[key]
        con = sqlite3.connect(os.path.join(SRC, 'book-%s.db' % key))
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        cur.execute('SELECT * FROM sections ORDER BY lft')
        self.rows = [dict(r) for r in cur.fetchall()]
        self.by_id = {r['section_id']: r for r in self.rows}
        self.children = {}
        for r in self.rows:
            self.children.setdefault(r['parent_id'], []).append(r)

        def detail(table, key_col='section_id'):
            try:
                cur.execute('SELECT * FROM %s' % table)
                out = {}
                for r in cur.fetchall():
                    out.setdefault(r[key_col], []).append(dict(r))
                return out
            except sqlite3.OperationalError:
                return {}

        self.animal_companion_details = detail('animal_companion_details')
        self.class_details = detail('class_details')
        self.spell_details = detail('spell_details')
        self.spell_lists = detail('spell_lists')
        self.item_details = detail('item_details')
        self.feat_types = detail('feat_types')
        self.skill_attributes = detail('skill_attributes')
        con.close()

    def kids(self, sid):
        return self.children.get(sid, [])

    def descendants(self, sid):
        out = []
        for c in self.kids(sid):
            out.append(c)
            out.extend(self.descendants(c['section_id']))
        return out

    def ancestors(self, sid):
        out = []
        r = self.by_id.get(sid)
        while r and r.get('parent_id') in self.by_id:
            r = self.by_id[r['parent_id']]
            out.append(r)
        return out

    def subtree_html(self, sid, depth=0, max_heading=3):
        """Render a section and its descendants as HTML."""
        r = self.by_id[sid]
        parts = []
        if depth > 0:
            h = min(2 + depth, 5)
            parts.append('<h%d>%s</h%d>' % (h, r['name'] or '', h))
        if r.get('description') and r.get('type') != 'section':
            parts.append('<p class="pf-desc"><i>%s</i></p>' % r['description'])
        elif r.get('description') and not r.get('body'):
            parts.append('<p>%s</p>' % r['description'])
        if r.get('body'):
            parts.append(r['body'])
        for c in self.kids(sid):
            parts.append(self.subtree_html(c['section_id'], depth + 1))
        return '\n'.join(p for p in parts if p)

    def subtree_text(self, sid):
        return strip_html(self.subtree_html(sid))


# ---------------------------------------------------------------- classes

LEVEL_RE = re.compile(r'^(\d+)(st|nd|rd|th)?$')


def parse_level_value(text):
    m = LEVEL_RE.match(text.strip())
    return int(m.group(1)) if m else None


def canonical_class_cols(cols):
    """Map header texts to canonical keys (level/bab/fort/ref/will/special/...).

    Headers vary across books: "Ref Save" vs "Reflex Save", and some tables
    (ACG Swashbuckler) lost the qualifier header row entirely, leaving a bare
    "Bonus" plus three "Save" columns — those follow the standard Fort/Ref/Will
    order, so bare "Save" columns are assigned positionally.
    """
    canon = []
    bare_saves = 0
    for col in cols:
        cl = col.strip().lower()
        if cl in ('base attack bonus', 'bonus', 'attack bonus'):
            canon.append('bab')
        elif cl in ('fort save', 'fortitude save'):
            canon.append('fort')
        elif cl in ('ref save', 'reflex save'):
            canon.append('ref')
        elif cl in ('will save',):
            canon.append('will')
        elif cl == 'save' and bare_saves < 3:
            canon.append(('fort', 'ref', 'will')[bare_saves])
            bare_saves += 1
        else:
            canon.append(cl)
    return canon


def parse_class_table(html):
    """Parse a class progression table -> list of per-level dicts."""
    t = parse_table(html)
    cols = flatten_header(t.head_rows)
    canon = canonical_class_cols(cols)
    if not cols or 'bab' not in canon:
        return None
    levels = []
    for row in t.rows:
        cells = [c['text'] for c in row]
        if len(cells) < 2:
            continue
        lvl = parse_level_value(cells[0])
        if lvl is None:
            continue
        entry = {'level': lvl, 'spd': {}, 'extra': {}}
        for i, col in enumerate(cols):
            if i >= len(cells):
                break
            v = cells[i]
            cl = canon[i]
            if cl == 'level':
                continue
            elif cl == 'bab':
                entry['bab'] = v
            elif cl == 'fort':
                entry['fort'] = parse_bonus(v)
            elif cl == 'ref':
                entry['ref'] = parse_bonus(v)
            elif cl == 'will':
                entry['will'] = parse_bonus(v)
            elif cl == 'special':
                entry['special'] = v
            elif 'spells per day' in cl:
                slot = spell_col_level(col)
                if slot is not None:
                    entry['spd'][slot] = parse_intish(v)
            else:
                entry['extra'][col] = v
        if not entry['spd']:
            del entry['spd']
        if not entry['extra']:
            del entry['extra']
        levels.append(entry)
    return levels or None


def spell_col_level(col):
    m = re.search(r'(\d+)(st|nd|rd|th)?\s*$', col.strip())
    return int(m.group(1)) if m else None


def parse_bonus(v):
    m = re.match(r'^\+?(-?\d+)', v.strip())
    return int(m.group(1)) if m else None


def parse_intish(v):
    v = v.strip()
    m = re.match(r'^(\d+)', v)
    if m:
        return int(m.group(1))
    return None  # em-dash / blank


def parse_spells_known_table(html):
    t = parse_table(html)
    cols = flatten_header(t.head_rows)
    out = {}
    for row in t.rows:
        cells = [c['text'] for c in row]
        if not cells:
            continue
        lvl = parse_level_value(cells[0])
        if lvl is None:
            continue
        known = {}
        for i, col in enumerate(cols[1:], start=1):
            if i >= len(cells):
                break
            slot = spell_col_level(col)
            if slot is not None:
                known[slot] = parse_intish(cells[i])
        out[lvl] = known
    return out


CLASS_SKILL_RE = re.compile(r"class skills are ([^.]+)\.", re.I)
RANKS_RE = re.compile(r"(\d+)\s*\+\s*Int modifier", re.I)


def parse_class_skills(text):
    m = CLASS_SKILL_RE.search(text)
    skills = []
    if m:
        raw = m.group(1)
        raw = raw.replace(', and ', ', ').replace(' and ', ', ')
        for part in raw.split(','):
            part = part.strip()
            if not part:
                continue
            # strip trailing ability "(Int)" but keep "(all skills, taken individually)" hints
            part = re.sub(r'\s*\((Str|Dex|Con|Int|Wis|Cha)\)\s*$', '', part)
            if part:
                skills.append(part)
    ranks = None
    rm = RANKS_RE.search(text)
    if rm:
        ranks = int(rm.group(1))
    return skills, ranks


def extract_classes(books):
    classes = []
    for key in ['cr', 'apg', 'um', 'uc', 'acg']:
        bk = books[key]
        for r in bk.rows:
            if r['type'] != 'class':
                continue
            sid = r['section_id']
            det = (bk.class_details.get(sid) or [{}])[0]
            sub = bk.descendants(sid)
            # progression table: caption "Table: <Name>"
            prog = None
            spells_known = None
            for s in sub:
                if s['type'] == 'table' and s.get('body'):
                    t = parse_table(s['body'])
                    cap = t.caption.lower()
                    # some books caption the progression table "Table: <Name>",
                    # others (ACG) just "<Name>"
                    if cap in (('table: %s' % r['name']).lower(), r['name'].lower()):
                        prog = parse_class_table(s['body'])
                    elif cap.startswith('table:') and 'spells known' in cap:
                        spells_known = parse_spells_known_table(s['body'])
            if prog is None:  # fallback: first table with BAB column
                for s in sub:
                    if s['type'] == 'table' and s.get('body') and 'Base Attack Bonus' in s['body']:
                        prog = parse_class_table(s['body'])
                        if prog:
                            break
            text = bk.subtree_text(sid)
            skills, ranks = parse_class_skills(text)
            classes.append({
                'name': r['name'],
                'source': bk.name,
                'subtype': r['subtype'] or '',
                'hd': (det.get('hit_die') or '').strip() or None,
                'alignment': strip_html(det.get('alignment') or '') or None,
                'desc': r.get('description') or '',
                'classSkills': skills,
                'ranks': ranks,
                'prog': prog,
                'spellsKnown': spells_known,
                'html': bk.subtree_html(sid),
            })
    return classes


# ---------------------------------------------------------------- archetypes

def extract_mythic_abilities(books):
    # Mythic path abilities (the powers a mythic character selects), grouped under
    # "Nth-Tier <Path> Path Abilities" sections in the Mythic Adventures book.
    bk = books.get('ma')
    if not bk:
        return []
    pat = re.compile(r'(\d+)(?:st|nd|rd|th)-Tier\s+(Archmage|Champion|Guardian|Hierophant|Marshal|Trickster|Universal)\s+Path\s+Abilit', re.I)
    out, seen = [], set()
    for r in bk.rows:
        if r['type'] != 'ability':
            continue
        path = tier = None
        for a in bk.ancestors(r['section_id']):
            m = pat.search(a.get('name') or '')
            if m:
                tier = int(m.group(1))
                path = m.group(2).title()
                break
        if not path:
            continue
        k = r['name'].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append({
            'name': r['name'],
            'path': path,
            'tier': tier,
            'source': bk.name,
            'html': bk.subtree_html(r['section_id']),
        })
    return out


def extract_mythic_paths():
    out = []
    for d in load_nedb('mythic-paths'):
        name = re.sub(r'^\(Mythic\)\s*', '', d.get('name', '').strip())
        if not name:
            continue
        s = d.get('system', {})
        desc = s.get('description') or {}
        html = clean_foundry_html(desc.get('value') if isinstance(desc, dict) else '')
        # drop the leading "Source … pg. N" line and de-link external <a> tags
        html = re.sub(r'^\s*<p>\s*Source.*?<br\s*/?>', '<p>', html, flags=re.I | re.S)
        html = re.sub(r'<a\b[^>]*>(.*?)</a>', r'\1', html, flags=re.S)
        out.append({'name': name, 'source': COMPENDIUM_SRC, 'html': html})
    return out


def extract_mythic_spells(books):
    bk = books.get('ma')
    if not bk:
        return []
    out, seen = [], set()
    for r in bk.rows:
        if r['type'] != 'mythic_spell':
            continue
        k = r['name'].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append({'name': r['name'], 'base': re.sub(r',?\s*Mythic\s*$', '', r['name']).strip(),
                    'source': bk.name, 'html': bk.subtree_html(r['section_id'])})
    return out


def extract_archetypes(books):
    out = []
    seen = set()
    for key in ['apg', 'acg', 'um', 'uc', 'arg', 'tech']:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'class_archetype':
                continue
            name = r['name']
            m = re.search(r'\(([^)]+)\)\s*$', name)
            cls = m.group(1) if m else ''
            if not cls:
                for a in bk.ancestors(r['section_id']):
                    am = re.match(r'^(.*?) Archetypes?$', a['name'] or '')
                    if am:
                        cls = am.group(1)
                        break
            base = re.sub(r'\s*\([^)]+\)\s*$', '', name)
            k = (base.lower(), cls.lower())
            if k in seen:
                continue
            seen.add(k)
            out.append({
                'name': base,
                'class': cls,
                'source': bk.name,
                'html': bk.subtree_html(r['section_id']),
            })
        # ARG stores racial archetypes as plain sections under "Racial Archetypes"
        if key == 'arg':
            for r in bk.rows:
                if r['type'] == 'section' and r.get('name') and re.search(r'\([A-Z][a-z]+\)$', r['name']):
                    par = bk.by_id.get(r['parent_id'])
                    if par and par.get('name') == 'Racial Archetypes':
                        m = re.search(r'\(([^)]+)\)\s*$', r['name'])
                        cls = m.group(1) if m else ''
                        base = re.sub(r'\s*\([^)]+\)\s*$', '', r['name'])
                        race = ''
                        for a in bk.ancestors(r['section_id']):
                            if a['type'] == 'race':
                                race = a['name']
                        k = (base.lower(), cls.lower())
                        if k in seen:
                            continue
                        seen.add(k)
                        out.append({
                            'name': base + (' [%s]' % race if race else ''),
                            'class': cls,
                            'source': bk.name,
                            'html': bk.subtree_html(r['section_id']),
                        })
    return out


# ---------------------------------------------------------------- feats

def extract_feats(books):
    feats = {}
    for key in FEAT_PRIORITY:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'feat':
                continue
            sid = r['section_id']
            types = sorted({t['feat_type'] for t in bk.feat_types.get(sid, [])})
            prereq = benefit = normal = special = ''
            for c in bk.kids(sid):
                nm = (c['name'] or '').lower()
                content = (c.get('body') or '') or ('<p>%s</p>' % c['description'] if c.get('description') else '')
                if nm.startswith('prerequisite'):
                    prereq = strip_html(content)
                elif nm.startswith('benefit'):
                    benefit = content
                elif nm.startswith('normal'):
                    normal = content
                elif nm.startswith('special'):
                    special = content
                elif nm in ('goal', 'completion benefit', 'note', 'leadership modifiers'):
                    special += content
            name = r['name']
            is_mythic = any(t.lower() == 'mythic' for t in types)
            display = name + (' (Mythic)' if is_mythic and '(mythic)' not in name.lower() else '')
            k = display.lower()
            if k in feats:
                continue
            feats[k] = {
                'name': display,
                'source': bk.name,
                'types': types,
                'desc': r.get('description') or '',
                'prereq': prereq,
                'benefit': benefit,
                'normal': normal,
                'special': special,
                'body': r.get('body') or '',
            }
    return list(feats.values())


# ---------------------------------------------------------------- spells

def extract_spells(books):
    spells = {}
    for key in SPELL_PRIORITY:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'spell':
                continue
            sid = r['section_id']
            det = (bk.spell_details.get(sid) or [{}])[0]
            levels = {}
            for sl in bk.spell_lists.get(sid, []):
                levels[sl['class']] = sl['level']
            k = r['name'].lower()
            if k in spells:
                for c, l in levels.items():
                    spells[k]['levels'].setdefault(c, l)
                continue
            spells[k] = {
                'name': r['name'],
                'source': bk.name,
                'school': det.get('school') or '',
                'sub': strip_html(det.get('subschool_text') or '') or None,
                'descriptor': strip_html(det.get('descriptor_text') or '') or None,
                'levels': levels,
                'levelText': strip_html(det.get('level_text') or ''),
                'cast': det.get('casting_time') or '',
                'comp': det.get('component_text') or '',
                'range': det.get('range') or '',
                'duration': det.get('duration') or '',
                'save': det.get('saving_throw') or '',
                'sr': det.get('spell_resistance') or '',
                'desc': r.get('description') or '',
                'html': bk.subtree_html(sid),
            }
    return list(spells.values())


# ---------------------------------------------------------------- items

WEAPON_HDR = 'Dmg (M)'


def table_segments(t):
    """Split a parsed table into segments, each with its own header block + rows."""
    segments = []
    current = None
    for kind, row in t.seq:
        if kind == 'head':
            if current is not None and current['open']:
                current['head'].append(row)
            else:
                current = {'head': [row], 'rows': [], 'open': True}
                segments.append(current)
        else:
            if current is None:
                current = {'head': [], 'rows': [], 'open': False}
                segments.append(current)
            current['open'] = False
            current['rows'].append(row)
    return segments


PROF_RE = re.compile(r'\b(Simple|Martial|Exotic|Firearms?|Ammunition)\b', re.I)


def extract_weapon_tables(books):
    weapons = {}
    for key in ['cr', 'ue', 'apg', 'arg', 'acg', 'uc', 'um', 'tech']:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'table' or not r.get('body') or WEAPON_HDR not in r['body']:
                continue
            t = parse_table(r['body'])
            cap_prof = PROF_RE.search(t.caption or '')
            for seg in table_segments(t):
                cols = flatten_header(seg['head'])
                if not cols or WEAPON_HDR not in cols:
                    continue
                label = cols[0]
                lab_prof = PROF_RE.search(label)
                prof = (lab_prof or cap_prof)
                prof_name = prof.group(1).title() if prof else 'Other'
                if prof_name == 'Firearms':
                    prof_name = 'Firearm'
                group = label if not lab_prof else ''
                idx = {c.strip(): i for i, c in enumerate(cols)}

                def g(cells, *names):
                    for n in names:
                        for c, i in idx.items():
                            if c.startswith(n) and i < len(cells):
                                return cells[i].strip()
                    return ''
                for row in seg['rows']:
                    cells = [c['text'] for c in row]
                    if row and row[0]['colspan'] > 1:
                        group = cells[0]
                        continue
                    if len(cells) < 4 or not cells[0]:
                        continue
                    name = cells[0].strip()
                    k = name.lower()
                    if k in weapons:
                        continue
                    weapons[k] = {
                        'name': name,
                        'prof': prof_name,
                        'group': group,
                        'cost': g(cells, 'Cost', 'Price'),
                        'dmgS': g(cells, 'Dmg (S)'),
                        'dmgM': g(cells, 'Dmg (M)'),
                        'crit': g(cells, 'Critical'),
                        'range': g(cells, 'Range'),
                        'weight': g(cells, 'Weight'),
                        'dtype': g(cells, 'Type'),
                        'special': g(cells, 'Special'),
                        'source': bk.name,
                    }
    return list(weapons.values())


def extract_armor_tables(books):
    armors = {}
    for key in ['cr', 'ue', 'apg', 'arg', 'uc', 'tech']:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'table' or not r.get('body'):
                continue
            if 'Armor/Shield Bonus' not in r['body'] and 'Armor Check Penalty' not in r['body']:
                continue
            t = parse_table(r['body'])
            for seg in table_segments(t):
                cols = flatten_header(seg['head'])
                if not cols:
                    continue
                has_bonus = any(c.startswith('Armor/Shield Bonus') or c.startswith('Armor Bonus') for c in cols)
                has_cost = any(c.startswith('Cost') or c.startswith('Price') for c in cols)
                if not (has_bonus and has_cost):
                    continue
                group = ''
                idx = {c.strip(): i for i, c in enumerate(cols)}

                def g(cells, *names):
                    for n in names:
                        for c, i in idx.items():
                            if (c.startswith(n) or n in c) and i < len(cells):
                                return cells[i].strip()
                    return ''
                for row in seg['rows']:
                    cells = [c['text'] for c in row]
                    if row and row[0]['colspan'] > 1:
                        group = cells[0].title()
                        continue
                    if len(cells) < 4 or not cells[0]:
                        continue
                    name = cells[0].strip()
                    k = name.lower()
                    if k in armors:
                        continue
                    armors[k] = {
                        'name': name,
                        'group': group.title(),
                        'cost': g(cells, 'Cost', 'Price'),
                        'bonus': g(cells, 'Armor/Shield Bonus', 'Armor Bonus'),
                        'maxDex': g(cells, 'Maximum Dex Bonus', 'Max Dex'),
                        'acp': g(cells, 'Armor Check Penalty'),
                        'asf': g(cells, 'Arcane Spell Failure'),
                        'spd30': g(cells, '30 ft'),
                        'spd20': g(cells, '20 ft'),
                        'weight': g(cells, 'Weight'),
                        'source': bk.name,
                    }
    return list(armors.values())


ITEM_CATEGORIES = [
    'Weapons', 'Weapon Descriptions', 'Armor and Shields', 'Armor', 'Shields',
    'Specific Weapons', 'Specific Armor', 'Specific Shields', 'Magic Weapons', 'Magic Armor',
    'Rings', 'Rods', 'Staves', 'Wands', 'Potions', 'Scrolls', 'Wondrous Items',
    'Artifacts', 'Cursed Items', 'Intelligent Items', 'Magic Items',
    'Adventuring Gear', 'Special Substances and Items', 'Tools and Skill Kits',
    'Clothing', 'Food, Drink, and Lodging', 'Mounts and Related Gear', 'Transport',
    'Spellcasting and Services', 'Goods and Services', 'Gear', 'Equipment',
    'Animals and Animal-Related Gear', 'Alchemical Remedies', 'Alchemical Tools',
    'Alchemical Weapons', 'Poisons', 'Black Market', 'Technological Equipment',
    'Pharmaceuticals', 'Cybertech', 'Technological Weapons', 'Technological Armor',
    'Vehicles', 'Siege Engines', 'Dungeon Gear', 'Entertainment and Trade Goods',
    'Hirelings, Servants, and Services', 'Lodging', 'Books',
]


def extract_items(books):
    items = {}
    for key in ITEM_PRIORITY:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'item':
                continue
            sid = r['section_id']
            det = (bk.item_details.get(sid) or [{}])[0]
            anc = [a['name'] for a in bk.ancestors(sid) if a.get('name')]  # nearest-first
            cat = ''
            for a in anc:
                if a in ITEM_CATEGORIES:
                    cat = a
                    break
            if not cat:
                cat = anc[0] if anc else ''
            sub = anc[0] if anc else ''
            if sub == cat:
                sub = ''
            k = r['name'].lower()
            if k in items:
                continue
            items[k] = {
                'name': r['name'],
                'source': bk.name,
                'category': cat,
                'sub': sub,
                'price': strip_html(det.get('price') or ''),
                'weight': strip_html(det.get('weight') or ''),
                'slot': strip_html(det.get('slot') or '') or None,
                'cl': strip_html(str(det.get('cl') or '')) or None,
                'aura': strip_html(det.get('aura') or '') or None,
                'html': bk.subtree_html(sid),
            }
    return list(items.values())


# ---------------------------------------------------------------- races

ABILITY_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']
AB_KEYS = {'Strength': 'str', 'Dexterity': 'dex', 'Constitution': 'con',
           'Intelligence': 'int', 'Wisdom': 'wis', 'Charisma': 'cha'}
MOD_RE = re.compile(r'([+–—-]\s?\d+)\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)', re.I)
ANY_MOD_RE = re.compile(r'\+\s?(\d+) to One Ability Score', re.I)


def parse_ability_mods(text):
    mods = {}
    for m in MOD_RE.finditer(text):
        val = m.group(1).replace('–', '-').replace('—', '-').replace(' ', '')
        mods[AB_KEYS[m.group(2).title()]] = int(val)
    flex = None
    fm = ANY_MOD_RE.search(text)
    if fm:
        flex = int(fm.group(1))
    return mods, flex


SIZE_RE = re.compile(r'\b(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\b')
SPEED_RE = re.compile(r'base speed of (\d+) feet', re.I)


def singular(name):
    specials = {
        'Dwarves': 'Dwarf', 'Elves': 'Elf', 'Halflings': 'Halfling', 'Gnomes': 'Gnome',
        'Half-Elves': 'Half-Elf', 'Half-Orcs': 'Half-Orc', 'Humans': 'Human',
        'Aasimars': 'Aasimar', 'Catfolk': 'Catfolk', 'Dhampirs': 'Dhampir', 'Drow': 'Drow',
        'Fetchlings': 'Fetchling', 'Goblins': 'Goblin', 'Hobgoblins': 'Hobgoblin',
        'Ifrits': 'Ifrit', 'Kobolds': 'Kobold', 'Orcs': 'Orc', 'Oreads': 'Oread',
        'Ratfolk': 'Ratfolk', 'Sylphs': 'Sylph', 'Tengus': 'Tengu', 'Tieflings': 'Tiefling',
        'Undines': 'Undine', 'Changelings': 'Changeling', 'Duergar': 'Duergar',
        'Gillmen': 'Gillman', 'Gripplis': 'Grippli', 'Kitsune': 'Kitsune', 'Merfolk': 'Merfolk',
        'Nagaji': 'Nagaji', 'Samsarans': 'Samsaran', 'Strix': 'Strix', 'Sulis': 'Suli',
        'Svirfneblin': 'Svirfneblin', 'Vanaras': 'Vanara', 'Vishkanyas': 'Vishkanya',
        'Wayangs': 'Wayang',
    }
    return specials.get(name, name)


def extract_races(books):
    races = {}
    order = ['arg', 'cr', 'b1', 'b2', 'b3', 'b4']
    for key in order:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'race':
                continue
            sid = r['section_id']
            name = singular(r['name'])
            if 'Characters' in name:  # e.g. "Lycanthropic Player Characters" rules section
                continue
            k = name.lower()
            if k in races:
                continue
            sub = bk.descendants(sid)
            # locate "<X> Racial Traits" section
            traits = []
            mods, flex = {}, None
            size = None
            speed = None
            languages = ''
            rt_sec = None
            for s in sub:
                if s.get('name') and re.search(r'Racial Traits$', s['name'] or '') and s['type'] == 'section':
                    rt_sec = s
                    break
            if rt_sec:
                for c in bk.kids(rt_sec['section_id']):
                    nm = c['name'] or ''
                    body = (c.get('body') or '') + ' ' + (c.get('description') or '')
                    full = nm + ': ' + strip_html(body)
                    m2, f2 = parse_ability_mods(nm + ' ' + strip_html(body))
                    if m2 and re.search(r'(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)', nm):
                        mods.update(m2)
                    if f2 and ('Ability' in nm or 'ability' in nm):
                        flex = f2
                    sm = SIZE_RE.search(nm)
                    if sm and ('size' in strip_html(body).lower() or nm in ('Small', 'Medium')):
                        size = sm.group(1)
                    spm = SPEED_RE.search(body)
                    if spm:
                        speed = int(spm.group(1))
                    if nm.lower().startswith('language'):
                        languages = strip_html(body)
                    traits.append({'name': nm, 'body': strip_html(body)})
            races[k] = {
                'name': name,
                'source': bk.name,
                'subtype': (r.get('subtype') or '').replace('_', ' '),
                'mods': mods,
                'flex': flex,
                'size': size or 'Medium',
                'speed': speed or 30,
                'languages': languages,
                'traits': traits,
                'desc': r.get('description') or '',
                'html': bk.subtree_html(sid),
            }
    return list(races.values())


def extract_racial_traits(books):
    """Alternate racial traits (ARG/APG/CR)."""
    out = []
    seen = set()
    for key in ['arg', 'apg', 'cr']:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] != 'racial_trait':
                continue
            race = (r.get('subtype') or '').replace('_', ' ').title()
            k = (r['name'].lower(), race.lower())
            if k in seen:
                continue
            seen.add(k)
            out.append({
                'name': r['name'],
                'race': race,
                'source': bk.name,
                'html': bk.subtree_html(r['section_id']),
            })
    return out


# ---------------------------------------------------------------- traits

def extract_traits(books):
    out = []
    seen = set()
    for key in ['apg', 'ucampaign']:
        bk = books.get(key)
        if not bk:
            continue
        for r in bk.rows:
            if r['type'] not in ('trait', 'drawback'):
                continue
            if r['type'] == 'drawback':
                cat = 'Drawback'
            else:
                cat = ''
                for a in bk.ancestors(r['section_id']):
                    nm = a.get('name') or ''
                    if re.search(r'Traits?$', nm) and nm.lower() not in ('character traits', 'traits'):
                        cat = re.sub(r'\s*Traits?$', '', nm)
                        break
            k = r['name'].lower()
            if k in seen:
                continue
            seen.add(k)
            out.append({
                'name': r['name'],
                'category': cat,
                'source': bk.name,
                'html': bk.subtree_html(r['section_id']),
            })
    return out


# ---------------------------------------------------------------- skills

def extract_skills(books):
    bk = books['cr']
    out = []
    for r in bk.rows:
        if r['type'] != 'skill':
            continue
        att = (bk.skill_attributes.get(r['section_id']) or [{}])[0]
        out.append({
            'name': r['name'],
            'ability': (att.get('attribute') or '').lower()[:3],
            'acp': bool(att.get('armor_check_penalty')),
            'trained': bool(att.get('trained_only')),
            'desc': r.get('description') or '',
            'html': bk.subtree_html(r['section_id']),
        })
    return out


# ---------------------------------------------------------------- companions

ABIL_STAT_RE = re.compile(r'(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)', re.I)
ABIL_DELTA_RE = re.compile(r'(Str|Dex|Con|Int|Wis|Cha)\s*([+-]\s?\d+)', re.I)


def parse_ability_block(s):
    """'Str 13, Dex 17, ...' -> {'str':13,...}; 'Str +8, Dex -2' -> {'str':'+8',...}"""
    s = (s or '').replace('&ndash;', '-').replace('–', '-')
    fixed = {m.group(1).lower(): int(m.group(2)) for m in ABIL_STAT_RE.finditer(s)}
    if fixed:
        return {'kind': 'scores', 'vals': fixed}
    deltas = {m.group(1).lower(): int(m.group(2).replace(' ', '')) for m in ABIL_DELTA_RE.finditer(s)}
    if deltas:
        return {'kind': 'deltas', 'vals': deltas}
    return None


def extract_companion_species(books):
    out = {}
    for key in ['cr', 'apg', 'um', 'arg', 'b1', 'b2', 'b3', 'b4', 'mc']:
        bk = books.get(key)
        if not bk:
            continue
        details = getattr(bk, 'animal_companion_details', None)
        if details is None:
            continue
        for sid, rows in details.items():
            sec = bk.by_id.get(sid)
            if not sec:
                continue
            name = sec['name']
            k = name.lower()
            for d in rows:
                entry = {
                    'size': strip_html(d.get('size') or ''),
                    'speed': strip_html(d.get('speed') or ''),
                    'ac': strip_html(d.get('ac') or ''),
                    'attack': strip_html(d.get('attack') or ''),
                    'abilitiesText': strip_html(d.get('ability_scores') or ''),
                    'abilities': parse_ability_block(d.get('ability_scores')),
                    'sq': strip_html(d.get('special_qualities') or ''),
                    'sa': strip_html(d.get('special_attacks') or ''),
                    'bonusFeat': strip_html(d.get('bonus_feat') or ''),
                }
                lvl = strip_html(str(d.get('level') or ''))
                if k not in out:
                    out[k] = {'name': name, 'source': bk.name, 'base': None, 'adv': []}
                if lvl:
                    entry['level'] = parse_bonus(lvl) or int(re.sub(r'\D', '', lvl) or 0)
                    out[k]['adv'].append(entry)
                elif out[k]['base'] is None:
                    out[k]['base'] = entry
    return sorted([v for v in out.values() if v['base']], key=lambda x: x['name'])


def parse_generic_table(html, level_col=True):
    """Generic: header cols -> list of row dicts keyed by header text."""
    t = parse_table(html)
    cols = flatten_header(t.head_rows)
    rows = []
    for r in t.rows:
        cells = [c['text'] for c in r]
        if not cells or (level_col and parse_level_value(cells[0]) is None and '–' not in cells[0] and '-' not in cells[0]):
            continue
        rows.append({cols[i]: cells[i] for i in range(min(len(cols), len(cells)))})
    return rows


def extract_companion_tables(books):
    cr, apg = books['cr'], books['apg']
    out = {}
    for r in cr.rows:
        if r['type'] == 'table' and r.get('body'):
            if 'Animal Companion Base Statistics' in r['body']:
                out['acProg'] = parse_generic_table(r['body'])
            elif 'Cohort Level' in r['body']:
                out['leadership'] = parse_generic_table(r['body'], level_col=False)
            elif 'Natural Armor Adj' in r['body'] and 'Master Class Level' in r['body']:
                out['familiarProg'] = parse_generic_table(r['body'], level_col=False)
    for r in apg.rows:
        if r['type'] == 'table' and r.get('body') and 'Eidolon Base Statistics' in r['body']:
            out['eidolonProg'] = parse_generic_table(r['body'])
            break
    # eidolon base forms
    forms = []
    for r in apg.rows:
        if r['name'] in ('Biped', 'Quadruped', 'Serpentine') and r['type'] == 'section':
            anc = [a.get('name') for a in apg.ancestors(r['section_id'])]
            if any(n and ('Eidolon' in n or n == 'Base Forms') for n in anc):
                if any(f['name'] == r['name'] for f in forms):
                    continue
                forms.append({'name': r['name'], 'text': apg.subtree_text(r['section_id']),
                              'html': apg.subtree_html(r['section_id'])})
    out['eidolonForms'] = forms
    # familiar special-ability benefits table (Bat -> +3 Fly etc.)
    for r in cr.rows:
        if r['type'] == 'table' and r.get('body') and 'master gains a +3' in r['body'].lower():
            t = parse_table(r['body'])
            out['familiarBenefits'] = [
                {'name': row[0]['text'], 'benefit': row[1]['text']}
                for row in t.rows if len(row) >= 2 and row[0]['text']]
            break
    return out


# ---------------------------------------------------------------- eidolon evolutions
# The Summoner eidolon's evolution catalog (APG), grouped in the source into
# 1/2/3/4-point sections. Each evolution carries its point cost, whether it can
# be taken more than once, any prerequisite evolutions / minimum summoner level
# / base-form restriction (all parsed from the rules text), and the full text
# for the picker and hover popovers. The app tracks these against the eidolon's
# evolution pool and auto-applies the cleanly quantifiable ones.
_FORM_WORDS = {'biped': 'Biped', 'quadruped': 'Quadruped', 'serpentine': 'Serpentine'}


def parse_evolution(name, cost, body, source_name):
    t = strip_html(body).lower()
    prereq_evos = sorted({m.group(1).strip()
                          for m in re.finditer(r'must have the ([a-z][a-z ()]*?) evolution', t)})
    lvl = 0
    m = re.search(r'must be at least (\d+)\w* level', t)
    if m:
        lvl = int(m.group(1))
    forms = []
    m = re.search(r'available to eidolons of the ([a-z]+)(?:\s+(?:and|or)\s+([a-z]+))? base forms?', t)
    if m:
        forms = [_FORM_WORDS[g] for g in m.groups() if g in _FORM_WORDS]
    # repeatable if the text says so directly ("more than once") or gates repeats
    # on level ("can be taken once for every five levels"). The "taken/selected"
    # anchor avoids matching passive scaling ("resistance increases … for every").
    repeatable = 'more than once' in t or bool(
        re.search(r'(?:taken|selected|applied)\b[^.]*\bfor every\b', t))
    return {
        'name': name,
        'cost': cost,
        'source': source_name,
        'repeatable': repeatable,
        'prereqEvos': prereq_evos,
        'minLevel': lvl,
        'forms': forms,
        'desc': strip_html(body)[:150],
        'html': '<h4>%s</h4>%s' % (name, body),
    }


# Ultimate Magic adds a second batch of evolutions that aren't in the sqlite
# books — they live only in the PSRD JSON release tree. Walk that file's
# X-Point sections and parse each evolution the same way.
def extract_um_evolutions():
    import glob
    files = glob.glob(os.path.join(SRC, 'ultimate_magic', '**', 'evolutions.json'), recursive=True)
    if not files:
        return []
    with open(files[0], encoding='utf-8') as fh:
        root = json.load(fh)
    out = []

    def walk(node):
        if not isinstance(node, dict):
            return
        m = re.match(r'(\d)-Point Evolutions', node.get('name') or '')
        if m:
            cost = int(m.group(1))
            for ch in node.get('sections', []) or []:
                if ch.get('name') and ch.get('type') == 'ability':
                    out.append(parse_evolution(ch['name'], cost, ch.get('body') or '', 'Ultimate Magic'))
            return
        for k in ('sections', 'subsections'):
            for s in node.get(k, []) or []:
                walk(s)

    walk(root)
    return out


def extract_eidolon_evolutions(books):
    apg = books['apg']
    out, seen = [], set()
    for r in apg.rows:
        m = re.match(r'(\d)-Point Evolutions', r['name'] or '')
        if not m:
            continue
        cost = int(m.group(1))
        for ch in apg.kids(r['section_id']):
            if not ch.get('name'):
                continue
            out.append(parse_evolution(ch['name'], cost, ch.get('body') or '', apg.name))
            seen.add(ch['name'].lower())
    for e in extract_um_evolutions():
        if e['name'].lower() not in seen:
            out.append(e)
            seen.add(e['name'].lower())
    out.sort(key=lambda e: (e['cost'], e['name'].lower()))
    return out


def extract_familiar_species(books):
    out = []
    seen = set()
    for key in ['b1', 'b3', 'b2', 'b4']:
        bk = books.get(key)
        if not bk:
            continue
        con = sqlite3.connect(os.path.join(SRC, 'book-%s.db' % key))
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        try:
            cur.execute("SELECT d.*, s.name AS sname FROM creature_details d JOIN sections s "
                        "ON d.section_id=s.section_id WHERE s.name LIKE 'Familiar, %'")
        except sqlite3.OperationalError:
            con.close()
            continue
        for d in cur.fetchall():
            d = dict(d)
            name = re.sub(r'^Familiar,\s*', '', d['sname'])
            k = name.lower()
            if k in seen:
                continue
            seen.add(k)
            abil = {}
            for ab in ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']:
                v = strip_html(str(d.get(ab) or ''))
                m = re.match(r'(\d+)', v)
                abil[ab[:3]] = int(m.group(1)) if m else None
            out.append({
                'name': name,
                'source': bk.name,
                'size': strip_html(d.get('size') or ''),
                'speed': strip_html(d.get('speed') or ''),
                'ac': strip_html(d.get('ac') or ''),
                'melee': strip_html(d.get('melee') or ''),
                'senses': strip_html(d.get('senses') or ''),
                'skills': strip_html(d.get('skills') or ''),
                'feats': strip_html(d.get('feats') or ''),
                'sq': strip_html(d.get('special_qualities') or ''),
                'abilities': abil,
            })
        con.close()
    return sorted(out, key=lambda x: x['name'])


def extract_companions(books):
    data = extract_companion_tables(books)
    data['species'] = extract_companion_species(books)
    data['familiarSpecies'] = extract_familiar_species(books)
    return data


# ================================================================
# Supplementary sources for post-2014 books missing from the PRD:
#  - FoundryVTT pf1 system compendia (foundry-db/packs/*.db NeDB + foundry/packs/classes/*.yaml)
#  - PathfinderUtilities feat database (pfu/feats.js, all 165 books)
# ================================================================

FOUNDRY_NEDB = os.path.join('foundry-db', 'packs')
FOUNDRY_YAML = os.path.join('foundry', 'packs')
PFU = 'pfu'
COMPENDIUM_SRC = 'PF1e Compendium'


def load_nedb(name):
    path = os.path.join(FOUNDRY_NEDB, name + '.db')
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


FSCHOOLS = {'abj': 'abjuration', 'con': 'conjuration', 'div': 'divination', 'enc': 'enchantment',
            'evo': 'evocation', 'ill': 'illusion', 'nec': 'necromancy', 'trs': 'transmutation',
            'tra': 'transmutation', 'uni': 'universal', 'misc': 'universal'}

FSKILLS = {'acr': 'Acrobatics', 'apr': 'Appraise', 'art': 'Artistry', 'blf': 'Bluff', 'clm': 'Climb',
           'crf': 'Craft', 'dev': 'Disable Device', 'dip': 'Diplomacy', 'dis': 'Disguise',
           'esc': 'Escape Artist', 'fly': 'Fly', 'han': 'Handle Animal', 'hea': 'Heal',
           'int': 'Intimidate', 'kar': 'Knowledge (arcana)', 'kdu': 'Knowledge (dungeoneering)',
           'ken': 'Knowledge (engineering)', 'kge': 'Knowledge (geography)', 'khi': 'Knowledge (history)',
           'klo': 'Knowledge (local)', 'kna': 'Knowledge (nature)', 'kno': 'Knowledge (nobility)',
           'kpl': 'Knowledge (planes)', 'kre': 'Knowledge (religion)', 'lin': 'Linguistics',
           'lor': 'Lore', 'per': 'Perception', 'prf': 'Perform', 'pro': 'Profession', 'rid': 'Ride',
           'sen': 'Sense Motive', 'slt': 'Sleight of Hand', 'spl': 'Spellcraft', 'ste': 'Stealth',
           'sur': 'Survival', 'swm': 'Swim', 'umd': 'Use Magic Device'}

PZO_BOOKS = {
    'PZO1110': 'Core Rulebook', 'PZO1115': "Advanced Player's Guide", 'PZO1117': 'Ultimate Magic',
    'PZO1118': 'Ultimate Combat', 'PZO1121': 'Ultimate Equipment', 'PZO1125': 'Ultimate Campaign',
    'PZO1129': 'Advanced Class Guide', 'PZO1131': 'Pathfinder Unchained', 'PZO1132': 'Occult Adventures',
    'PZO1134': 'Ultimate Intrigue', 'PZO1135': 'Horror Adventures', 'PZO1136': 'Adventurer\'s Guide',
    'PZO1139': 'Book of the Damned', 'PZO1140': 'Ultimate Wilderness', 'PZO1141': 'Planar Adventures',
    'PZO1121-2': 'Ultimate Equipment', 'PZO92102': 'Concordance of Rivals',
}

FRANGE = {'touch': 'touch', 'close': 'close (25 ft. + 5 ft./2 levels)',
          'medium': 'medium (100 ft. + 10 ft./level)', 'long': 'long (400 ft. + 40 ft./level)',
          'personal': 'personal', 'unlimited': 'unlimited', 'seeText': 'see text'}


def src_from_desc(html, fallback=COMPENDIUM_SRC):
    m = re.search(r'<strong>Source</strong>\s*<em>([^<]+?)(?:\s+pg\.[^<]*)?</em>', html or '')
    return m.group(1).strip() if m else fallback


def clean_foundry_html(html):
    # Foundry inline document links: "@Compendium[id]{Label}" / "@UUID[id]{Label}"
    # → just "Label"; drop any unlabeled leftovers.
    if not html:
        return html
    html = re.sub(r'@\w+\[[^\]]*\]\{([^}]*)\}', r'\1', html)
    html = re.sub(r'@\w+\[[^\]]*\]', '', html)
    return html


def foundry_prereq(html):
    # Class abilities that gate on something (another wild talent, a base talent,
    # a race, etc.) lead with a "<strong>Prerequisite(s)</strong> …" clause —
    # kineticist wild talents especially. Pull that clause out as plain text so it
    # can be shown and machine-checked, mirroring how feats carry a `prereq` string.
    # The clause is bounded by the next <br>/<strong>/</p>, so prose never runs away.
    if not html:
        return ''
    m = re.search(r'<strong>\s*Prerequisites?\s*(?:&nbsp;|:|\s)*</strong>\s*(.*?)(?:<br|</p>|<strong>|$)',
                  html, re.I | re.S)
    if not m:
        return ''
    txt = re.sub(r'<[^>]+>', '', m.group(1)).replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', txt).strip().strip(';').strip(',').strip()


# Prose talent/power chains: "…must have the <name> rogue talent before choosing…",
# "…a barbarian must have the <name> rage power…", etc. The <name> is captured up
# to the ability-type word; we keep it ONLY when it resolves to a real class-ability
# entry (see resolve_ability), so runaway prose ("an Intelligence score of 12…") and
# non-ability requirements are dropped rather than emitted as bogus prereqs.
_CHAIN_RE = re.compile(
    r'must (?:have|possess|already have|first have|have taken|have selected|have chosen)'
    r'(?:\s+(?:the|taken|selected|chosen))?\s+(.+?)\s+'
    r'(?:rogue talent|ninja trick|master trick|slayer talent|investigator talent|'
    r'talent|hex|rage power|arcanist exploit|magus arcana|arcana|discovery|'
    r'revelation|trick|gift)\b', re.I)


def chain_candidate(html):
    t = re.sub(r'@\w+\[[^\]]*\]\{([^}]*)\}', r'\1', html or '')
    t = re.sub(r'<[^>]+>', ' ', t).replace('&nbsp;', ' ').replace('&amp;', '&')
    t = re.sub(r'\s+', ' ', t)
    m = _CHAIN_RE.search(t)
    if not m:
        return ''
    cand = m.group(1).strip().strip('.,;').strip()
    # a couple of leading determiners can survive the capture
    cand = re.sub(r'^(?:a|an|the|another)\s+', '', cand, flags=re.I).strip()
    # bail on obvious non-names (score/level/class prose) — resolve_ability is the
    # real gate, this just avoids long junk strings
    return '' if len(cand) > 40 or not cand else cand


def resolve_ability(name, name_map):
    # name_map: {lower-cased ability name -> canonical name}. Returns the canonical
    # name if `name` matches an entry directly or via the "greater/lesser/improved X"
    # <-> "X, Greater" reordering the compendium uses, else None.
    key = (name or '').strip().lower()
    if key in name_map:
        return name_map[key]
    m = re.match(r'^(greater|improved|lesser|master)\s+(.+)$', key)
    if m and '%s, %s' % (m.group(2), m.group(1)) in name_map:
        return name_map['%s, %s' % (m.group(2), m.group(1))]
    return None


# Advanced talents unlock at a fixed class level (Core: rogue/slayer 10th) but the
# compendium marks them nowhere, so this is an authored, conservative list — only
# names we're confident are *advanced* (mis-tagging a normal talent would wrongly
# gate a low-level character). Keyed by class name; entries are validated against
# real ability names at build time, so unknown names are silently dropped. Extend
# as needed. Level comes from the class's own advanced-talent rule.
ADVANCED_TALENTS = {
    'Rogue': (10, [
        # Core Rulebook advanced rogue talents
        'Crippling Strike', 'Defensive Roll', 'Dispelling Attack', 'Familiar', 'Feat',
        'Improved Evasion (Talent)', 'Opportunist', 'Skill Mastery', 'Slippery Mind',
        # Advanced Player's Guide (and other high-confidence) advanced rogue talents
        'Another Day', 'Confounding Blades', 'Deadly Sneak', 'Entanglement of Blades',
        'Fast Tumble', 'Frugal Trapsmith', 'Getaway Master', 'Hard Minded', 'Hard to Fool',
        "Hunter's Surprise", 'Knock-Out Blow', 'Master of Disguise', 'Rumormonger',
        'Stealthy Sniper', 'Thoughtful Reexamining', 'Weapon Snatcher',
    ]),
    'Rogue (Unchained)': (10, [
        'Crippling Strike (UC)', 'Deadly Sneak (UC)', 'Defensive Roll (UC)',
        'Dispelling Attack (UC)', 'Feat (UC)', 'Improved Evasion (UC)',
        'Master of Disguise (UC)', 'Opportunist (UC)', 'Skill Mastery (UC)',
        'Slippery Mind (UC)',
    ]),
}


def foundry_spell_levels(learned):
    NORM = {'sorcerer/wizard': ['Sorcerer', 'Wizard'], 'cleric/oracle': ['Cleric', 'Oracle'],
            'unchained summoner': ['Summoner (Unchained)'], 'summoner (unchained)': ['Summoner (Unchained)']}
    levels = {}
    for cls, lvl in (learned or {}).get('class', []):
        key = str(cls).strip().lower()
        names = NORM.get(key)
        if not names:
            names = [' '.join(w.capitalize() for w in part.strip().split()) for part in key.split('/')]
        for n in names:
            if n:
                levels.setdefault(n, lvl)
    return levels


def extract_foundry_spells(existing):
    # `existing` maps lower-case name -> already-built spell dict (from PSRD). For
    # spells PSRD already has, we still MERGE the Foundry class-list assignments
    # (learnedAt) so occult classes / the Unchained Summoner / etc. pick up the
    # core spells on their lists; PSRD's own levels win on conflict (setdefault).
    out = []
    for d in load_nedb('spells'):
        name = d.get('name', '').strip()
        if not name:
            continue
        s = d.get('system', {})
        flv = foundry_spell_levels(s.get('learnedAt'))
        key = name.lower()
        if key in existing:
            lv = existing[key]['levels']
            for cls, lvl in flv.items():
                lv.setdefault(cls, lvl)
            continue
        html = clean_foundry_html(s.get('shortDescription') or '')
        if not html:
            continue
        acts = s.get('actions') or [{}]
        act = acts[0] if acts else {}
        comp = s.get('components') or {}
        comps = [c for c, lbl in [('verbal', 'V'), ('somatic', 'S'), ('thought', 'T'), ('emotion', 'E'),
                                  ('material', 'M'), ('focus', 'F'), ('divineFocus', 'DF')] if comp.get(c)
                 for c in [lbl]]
        rng = act.get('range') or {}
        units = rng.get('units') or ''
        range_text = FRANGE.get(units, '')
        if not range_text and rng.get('value'):
            range_text = '%s %s' % (rng.get('value'), units or 'ft.')
        actv = act.get('activation') or {}
        cast = ('%s %s action' % (actv.get('cost') or 1, actv.get('type') or 'standard')) \
            if actv.get('type') in ('standard', 'swift', 'move', 'full') else (actv.get('type') or '')
        spell = {
            'name': name,
            'source': COMPENDIUM_SRC,
            'school': FSCHOOLS.get(s.get('school'), s.get('school') or ''),
            'sub': s.get('subschool') or None,
            'descriptor': s.get('types') or None,
            'levels': flv,
            'levelText': '',
            'cast': cast,
            'comp': ', '.join(comps),
            'range': range_text,
            'duration': (act.get('duration') or {}).get('value') or '',
            'save': (act.get('save') or {}).get('description') or '',
            'sr': '',
            'desc': strip_html(html)[:140],
            'html': html,
        }
        existing[key] = spell
        out.append(spell)
    return out


def extract_foundry_classfeatures():
    # Selectable class sub-features (rage powers, bloodlines, hexes, arcana,
    # discoveries, revelations, talents, etc.) from the pf1 class-abilities pack.
    out, seen = [], set()
    for d in load_nedb('class-abilities'):
        name = d.get('name', '').strip()
        if not name or name.lower() in seen:
            continue
        s = d.get('system', {})
        desc = s.get('description') or {}
        html = clean_foundry_html(desc.get('value') if isinstance(desc, dict) else '')
        if not html:
            continue
        classes = []
        for a in (s.get('associations') or {}).get('classes') or []:
            nm = a[0] if isinstance(a, list) and a else (a if isinstance(a, str) else None)
            if nm and nm not in classes:
                classes.append(nm)
        seen.add(name.lower())
        out.append({
            'name': name,
            'classes': classes,
            'kind': {'su': 'Su', 'ex': 'Ex', 'sp': 'Sp'}.get(s.get('abilityType'), ''),
            'source': COMPENDIUM_SRC,
            'html': html,
        })

    # Second pass: now that every ability name is known, derive machine-checkable
    # prerequisites. Three sources, joined with "; " (feat-prereq syntax the engine
    # already parses): an explicit "Prerequisite:" clause, a prose talent/power
    # chain (validated against real ability names), and the authored advanced-talent
    # level gate. checkFeatPrereqs turns ability-name clauses into c.classAbilities
    # checks and "<Class> level Nth" into a class-level check.
    name_map = {e['name'].lower(): e['name'] for e in out}
    advanced = {}
    for cls, (lvl, names) in ADVANCED_TALENTS.items():
        for n in names:
            canon = resolve_ability(n, name_map)
            if canon:
                advanced.setdefault(canon, []).append((cls, lvl))
    ordinal = lambda n: '%d%s' % (n, {1: 'st', 2: 'nd', 3: 'rd'}.get(n if n < 20 else n % 10, 'th'))
    for e in out:
        parts, low = [], set()
        def add(clause):
            if clause and clause.lower() not in low:
                parts.append(clause)
                low.add(clause.lower())
        add(foundry_prereq(e['html']))
        chain = resolve_ability(chain_candidate(e['html']), name_map)
        # don't restate a chain the explicit clause already names
        if chain and chain.lower() not in ' ; '.join(parts).lower():
            add(chain)
        for cls, lvl in advanced.get(e['name'], []):
            add('%s level %s' % (cls, ordinal(lvl)))
        if parts:
            e['prereq'] = '; '.join(parts)
    return out


def extract_foundry_races(existing):
    out = []
    for d in load_nedb('races'):
        name = d.get('name', '').strip()
        if not name or singular(name).lower() in existing or name.lower() in existing:
            continue
        s = d.get('system', {})
        html = (s.get('description') or {}).get('value') or ''
        mods = {}
        for ch in s.get('changes') or []:
            if ch.get('target') == 'ability' and ch.get('subTarget') in AB_KEYS.values():
                try:
                    mods[ch['subTarget']] = mods.get(ch['subTarget'], 0) + int(float(ch.get('formula') or 0))
                except ValueError:
                    pass
        text = strip_html(html)
        _, flex = parse_ability_mods(text)
        size_m = re.search(r'\b(Fine|Diminutive|Tiny|Small|Medium|Large|Huge)\b', text)
        spd_m = re.search(r'(?:base )?speed (?:of |is )?(\d+) f', text, re.I)
        langs = (s.get('languages') or {})
        lang_list = langs.get('value') if isinstance(langs, dict) else None
        out.append({
            'name': name,
            'source': src_from_desc(html),
            'subtype': 'other race',
            'mods': mods,
            'flex': flex if not mods else None,
            'size': size_m.group(1) if size_m else 'Medium',
            'speed': int(spd_m.group(1)) if spd_m else 30,
            'languages': ', '.join(x.capitalize() for x in lang_list) if lang_list else '',
            'traits': [],
            'desc': '',
            'html': html,
        })
        existing.add(name.lower())
    return out


def extract_foundry_weapons(existing):
    out = []
    PROF = {'simple': 'Simple', 'martial': 'Martial', 'exotic': 'Exotic'}
    GROUP = {'light': 'Light Melee Weapons', '1h': 'One-Handed Melee Weapons',
             '2h': 'Two-Handed Melee Weapons', 'ranged': 'Ranged Weapons', 'ammo': 'Ammunition'}
    for d in load_nedb('weapons-and-ammo'):
        name = d.get('name', '').strip()
        if not name or name.lower() in existing:
            continue
        s = d.get('system', {})
        html = (s.get('description') or {}).get('value') or ''
        text = strip_html(html)
        def g(pat):
            m = re.search(pat, text)
            return m.group(1).strip() if m else ''
        out.append({
            'name': name,
            'prof': PROF.get(s.get('weaponType'), 'Other'),
            'group': GROUP.get(s.get('weaponSubtype'), ''),
            'cost': g(r'Cost\s+([\d,]+(?:\.\d+)?\s*[gsc]p)'),
            'dmgS': g(r'Damage\s+([^;(]+?)\s*\(small\)'),
            'dmgM': g(r'\(small\),?\s*([^;(]+?)\s*\(medium\)'),
            'crit': g(r'Critical\s+([^;]+);'),
            'range': g(r'Range\s+([^;]+);'),
            'weight': g(r'Weight\s+([\d.]+\s*lbs?\.?)'),
            'dtype': g(r'Type\s+([A-Z, /and]+?)(?:;|$)'),
            'special': g(r'Special\s+([^<;]+?)(?:\.|$)'),
            'source': src_from_desc(html),
        })
        existing.add(name.lower())
    return out


def extract_foundry_armors(existing):
    out = []
    for d in load_nedb('armors-and-shields'):
        name = d.get('name', '').strip()
        if not name or name.lower() in existing:
            continue
        s = d.get('system', {})
        a = s.get('armor') or {}
        html = (s.get('description') or {}).get('value') or ''
        text = strip_html(html)
        grp = 'Shields' if s.get('slot') == 'shield' else ''
        if not grp:
            gm = re.search(r'\b(Light|Medium|Heavy)\b', text)
            grp = (gm.group(1) + ' Armor') if gm else 'Light Armor'
        price = s.get('price')
        out.append({
            'name': name,
            'group': grp,
            'cost': ('%s gp' % '{:,}'.format(int(price))) if isinstance(price, (int, float)) and price else '',
            'bonus': '+%d' % (a.get('value') or 0),
            'maxDex': ('+%d' % a['dex']) if a.get('dex') is not None else '—',
            'acp': ('-%d' % a['acp']) if a.get('acp') else '0',
            'asf': ('%d%%' % s['spellFailure']) if s.get('spellFailure') else '',
            'spd30': '', 'spd20': '',
            'weight': '%s lbs.' % ((s.get('weight') or {}).get('value') or 0),
            'source': src_from_desc(html),
        })
        existing.add(name.lower())
    return out


def extract_foundry_items(existing):
    out = []
    CONSUM = {'potion': 'Potions', 'scroll': 'Scrolls', 'wand': 'Wands'}
    WOND_SLOTS = {'belt', 'body', 'chest', 'eyes', 'feet', 'hands', 'head', 'headband',
                  'neck', 'shoulders', 'wrists', 'ring', 'slotless'}
    for d in load_nedb('items'):
        name = d.get('name', '').strip()
        if not name or name.lower() in existing or d.get('type') in ('weapon',):
            continue
        s = d.get('system', {})
        html = (s.get('description') or {}).get('value') or ''
        slot = s.get('slot') or ''
        if d.get('type') == 'consumable':
            cat = CONSUM.get(s.get('consumableType') or s.get('subType'), 'Adventuring Gear')
        elif slot == 'ring':
            cat = 'Rings'
        elif slot in WOND_SLOTS or d.get('type') == 'loot' and re.search(r'<strong>Aura</strong>', html):
            cat = 'Wondrous Items'
        elif d.get('type') == 'container':
            cat = 'Adventuring Gear'
        else:
            cat = 'Adventuring Gear'
        price = s.get('price')
        cl_m = re.search(r'<strong>CL</strong>\s*(\d+)', html)
        aura_m = re.search(r'<strong>Aura</strong>\s*([^;<]+)', html)
        out.append({
            'name': name,
            'source': src_from_desc(html),
            'category': cat,
            'sub': '',
            'price': ('{:,} gp'.format(int(price))) if isinstance(price, (int, float)) and price else '',
            'weight': str((s.get('weight') or {}).get('value') or ''),
            'slot': slot or None,
            'cl': cl_m.group(1) if cl_m else None,
            'aura': strip_html(aura_m.group(1)) if aura_m else None,
            'html': html,
        })
        existing.add(name.lower())
    return out


# ---------------- new classes (Occult Adventures etc.) ----------------

def bab_string(kind, lvl):
    total = {'low': lvl // 2, 'med': (3 * lvl) // 4, 'high': lvl}.get(kind, lvl // 2)
    parts = []
    b = total
    while (not parts or b > 0) and len(parts) < 4:
        parts.append('+%d' % b)
        b -= 5
        if b <= 0:
            break
    return '/'.join(parts) if parts else '+0'


def extract_foundry_classes(existing_classes):
    try:
        import yaml
    except ImportError:
        print('  (pyyaml not available — skipping foundry classes)')
        return []
    have = {c['name'].lower() for c in existing_classes}
    by_name = {c['name']: c for c in existing_classes}
    nedb_classes = load_nedb('classes')
    nedb_desc = {d['name'].lower(): (d.get('system', {}).get('description') or {}).get('value') or ''
                 for d in nedb_classes}
    # per-level class features (the "Special" column) from classAssociations links
    features_by_class = {}
    for d in nedb_classes:
        bylvl = {}
        for a in ((d.get('system', {}).get('links') or {}).get('classAssociations') or []):
            lvl, nm = a.get('level'), a.get('name')
            if lvl and nm:
                bylvl.setdefault(int(lvl), []).append(nm)
        features_by_class[d['name'].lower()] = bylvl
    out = []
    import glob as _glob
    for path in sorted(_glob.glob(os.path.join(FOUNDRY_YAML, 'classes', '*.yaml'))):
        with open(path, encoding='utf-8') as fh:
            d = yaml.safe_load(fh)
        name = d.get('name', '').strip()
        if not name or name.lower() in have:
            continue
        s = d.get('system', {})
        if s.get('subType') in ('racial', 'mythic'):
            continue
        casting = s.get('casting') or None
        # donor spell tables: all 9-level casters share Sorcerer/Wizard tables,
        # 6-level casters share the Bard table, 4-level casters the Paladin table
        donor = None
        if casting:
            prog_kind = casting.get('progression')
            if prog_kind == 'high':
                donor = by_name.get('Sorcerer' if casting.get('type') == 'spontaneous' else 'Wizard')
            elif prog_kind == 'med':
                donor = by_name.get('Bard')
            elif prog_kind == 'low':
                donor = by_name.get('Paladin')
        saves = {k: (v or {}).get('value') for k, v in (s.get('savingThrows') or {}).items()}
        feats_by_lvl = features_by_class.get(name.lower(), {})
        prog = []
        for lvl in range(1, 21):
            row = {
                'level': lvl,
                'bab': bab_string(s.get('bab') or 'low', lvl),
                'fort': 2 + lvl // 2 if saves.get('fort') == 'high' else lvl // 3,
                'ref': 2 + lvl // 2 if saves.get('ref') == 'high' else lvl // 3,
                'will': 2 + lvl // 2 if saves.get('will') == 'high' else lvl // 3,
                'special': ', '.join(feats_by_lvl.get(lvl, [])),
            }
            if donor and donor.get('prog'):
                drow = next((p for p in donor['prog'] if p['level'] == lvl), None)
                if drow and drow.get('spd'):
                    row['spd'] = drow['spd']
            prog.append(row)
        spells_known = donor.get('spellsKnown') if (donor and casting and casting.get('type') == 'spontaneous') else None
        cs = s.get('classSkills') or []
        if isinstance(cs, dict):
            codes = [k for k, v in cs.items() if v]
        else:
            codes = list(cs)
        skills = sorted(FSKILLS[k] for k in codes if k in FSKILLS)
        srcs = s.get('sources') or []
        src = PZO_BOOKS.get((srcs[0] or {}).get('id') if srcs else None, COMPENDIUM_SRC)
        desc_html = nedb_desc.get(name.lower()) or (s.get('description') or {}).get('value') or ''
        has_feats = any(feats_by_lvl.values())
        note = ('<p class="pf-desc"><i>BAB and saves derived from the class\'s standard '
                'categories%s%s.</i></p>' %
                ('; spell slots use the standard %s-progression table' % casting.get('progression') if donor else '',
                 '; class features per level shown in the Special column' if has_feats else ''))
        out.append({
            'name': name,
            'source': src,
            'subtype': s.get('subType') or 'base',
            'hd': 'd%s' % (s.get('hd') or 8),
            'alignment': None,
            'desc': strip_html(desc_html)[:200],
            'classSkills': skills,
            'ranks': s.get('skillsPerLevel'),
            'prog': prog,
            'spellsKnown': spells_known,
            'casting': ({'ability': casting.get('ability'), 'type': casting.get('type'),
                         'progression': casting.get('progression')} if casting else None),
            'html': note + desc_html,
        })
        have.add(name.lower())
    return out


# ---------------- common buffs (spell effects etc.) ----------------

BUFF_TYPE_MAP = {'enh': 'enhancement', 'comp': 'competence', 'competence': 'competence',
                 'base': 'untyped', 'alchemical': 'alchemical', 'luck': 'luck', 'morale': 'morale',
                 'dodge': 'dodge', 'deflection': 'deflection', 'untyped': 'untyped',
                 'sacred': 'sacred', 'profane': 'profane', 'insight': 'insight',
                 'resist': 'resistance', 'size': 'size', 'circumstance': 'circumstance'}

BUFF_TARGETS = {'str': 'str', 'dex': 'dex', 'con': 'con', 'int': 'int', 'wis': 'wis', 'cha': 'cha',
                'attack': 'attack', 'mattack': 'attack', 'rattack': 'attack',
                'wdamage': 'damage', 'damage': 'damage', 'sdamage': 'damage',
                'aac': 'armor', 'sac': 'armor', 'nac': 'natural',
                'fort': 'fort', 'ref': 'ref', 'will': 'will', 'allSavingThrows': 'saves',
                'skills': 'skills', 'init': 'init', 'landSpeed': 'speed', 'allSpeeds': 'speed',
                'cmb': 'cmb', 'cmd': 'cmd'}


def extract_foundry_buffs():
    out = []
    for d in load_nedb('commonbuffs'):
        s = d.get('system', {})
        changes = []
        scales = False
        for ch in s.get('changes') or []:
            sub = ch.get('subTarget')
            mod = BUFF_TYPE_MAP.get(ch.get('modifier'), 'untyped')
            formula = str(ch.get('formula') or '0')
            try:
                val = int(float(formula))
            except ValueError:
                val = 1
                scales = True
            if sub == 'ac':
                tgt = {'dodge': 'dodge', 'deflection': 'deflection'}.get(mod, 'acMisc')
            else:
                tgt = BUFF_TARGETS.get(sub)
            if not tgt:
                continue
            changes.append({'target': tgt, 'type': mod, 'value': val})
        if not changes:
            continue
        out.append({
            'name': d.get('name', ''),
            'source': COMPENDIUM_SRC,
            'changes': changes,
            'scales': scales,
            'html': (s.get('description') or {}).get('value') or '',
        })
    return sorted(out, key=lambda x: x['name'])


# ---------------- complete feat corpus (PathfinderUtilities) ----------------

PFU_TYPES = ['Achievement', 'Alignment', 'Armor Mastery', 'Betrayal', 'Blood Hex', 'Called Shot',
             'Combat', 'Combination', 'Conduit', 'Coven', 'Critical', 'Damnation', 'Esoteric',
             'Faction', 'Familiar', 'Gathlain Court Title', 'General', 'Grit', 'Hero Point',
             'Item Creation', 'Item Mastery', 'Meditation', 'Metamagic', 'Monster', 'Mythic',
             'Origin', 'Panache', 'Performance', 'Possession', 'Shield Mastery', 'Stare', 'Story',
             'Style', 'Targeting', 'Teamwork', 'Trick', 'Weapon Mastery', 'Words Of Power']

SMALL_WORDS = {'of', 'the', 'and', 'or', 'in', 'with', 'to', 'a', 'an', 'for', 'at', 'by', 'on'}


def feat_title(name):
    words = name.split(' ')
    out = []
    for i, w in enumerate(words):
        if i > 0 and w in SMALL_WORDS:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return ' '.join(out)


def para_html(s):
    s = (s or '').strip()
    return '<p>%s</p>' % s if s else ''


def extract_pfu_feats(existing):
    path = os.path.join(PFU, 'feats.js')
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as fh:
        raw = fh.read()
    manuals = []
    man_path = os.path.join(PFU, 'manuals.js')
    if os.path.exists(man_path):
        with open(man_path, encoding='utf-8') as fh:
            man_raw = fh.read()
    else:
        man_raw = raw
    mm = re.search(r'var manuals = `(.*?)`', man_raw, re.S)
    if mm:
        manuals = [l.strip() for l in mm.group(1).strip().split('\n')]

    # referenced tables AND lists live in a separate file; feat text marks them as [[[N]]]
    tables = []
    tbl_path = os.path.join(PFU, 'tables.js')
    if os.path.exists(tbl_path):
        with open(tbl_path, encoding='utf-8') as fh:
            tbl_raw = fh.read()
        tables = [t.replace('´´´', '"').strip()
                  for t in re.findall(r'`(.*?)`', tbl_raw, re.S)]

    def clean(s):
        # this dataset uses triple acute accents as quotation marks
        return (s or '').replace('´´´', '"')

    def resolve_tables(html):
        def repl(m):
            i = int(m.group(1))
            tbl = tables[i] if 0 <= i < len(tables) else ''
            return ('</p>' + tbl + '<p>') if tbl else ''
        return re.sub(r'\[\[\[(\d+)\]\]\]', repl, html)

    def field(s):  # cleaned, paragraph-wrapped, with any table references inlined
        return resolve_tables(para_html(clean(s)))

    out = []
    body = re.search(r'var feats\d* = `(.*?)`', raw, re.S)
    if not body:
        return []
    for line in body.group(1).split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        f = line.split('|')
        if len(f) < 28 or not f[1]:
            continue
        types = []
        for t in (f[2] or '').split(';'):
            t = t.strip()
            if t.isdigit() and int(t) < len(PFU_TYPES):
                types.append(PFU_TYPES[int(t)])
        name = feat_title(f[1].strip())
        if 'Mythic' in types and '(mythic)' not in name.lower():
            name += ' (Mythic)'
        k = name.lower()
        if k in existing:
            continue
        existing.add(k)
        # columns 26/27/28 = source_gen / source_det / page; prefer the detailed source
        src_i = (f[27].strip() if len(f) > 27 else '') or f[26].strip()
        source = manuals[int(src_i)] if src_i.isdigit() and int(src_i) < len(manuals) else COMPENDIUM_SRC
        source = re.sub(r'\s*\(\d{4}\)$', '', source)
        page = f[28].strip() if len(f) > 28 else ''
        special = ' '.join(x for x in [f[17], f[21]] if x.strip())
        nomark = lambda s: re.sub(r'\[\[\[\d+\]\]\]', '', clean(s)).strip()
        out.append({
            'name': name,
            'source': source + ((' p.' + page) if page else ''),
            'types': types or ['General'],
            'desc': nomark(f[12]),
            'prereq': nomark(f[14]),
            'benefit': field(f[15]),
            'normal': field(f[16]),
            'special': field(special),
            'body': field(f[13]) if f[13].strip() and f[13] != f[15] else '',
        })
    return out


# ---------------------------------------------------------------- write

def write_js(fname, key, data):
    os.makedirs(OUT, exist_ok=True)
    js = json.dumps(data, ensure_ascii=True, separators=(',', ':'))
    js = js.replace('</', '<\\/')
    with open(os.path.join(OUT, fname), 'w', encoding='utf-8') as f:
        f.write('window.PFDATA=window.PFDATA||{};PFDATA.%s=%s;\n' % (key, js))
    size = os.path.getsize(os.path.join(OUT, fname))
    n = len(data) if isinstance(data, list) else len(data.keys())
    print('%-22s %6d entries  %8.1f KB' % (fname, n, size / 1024))


def main():
    print('Loading books...')
    books = {}
    for key in BOOKS:
        path = os.path.join(SRC, 'book-%s.db' % key)
        if os.path.exists(path):
            books[key] = Book(key)
    print('Loaded %d books' % len(books))

    classes = extract_classes(books)
    classes += extract_foundry_classes(classes)
    write_js('classes.js', 'classes', classes)

    write_js('archetypes.js', 'archetypes', extract_archetypes(books))

    feats = extract_feats(books)
    feats += extract_pfu_feats({f['name'].lower() for f in feats})
    write_js('feats.js', 'feats', feats)

    spells = extract_spells(books)
    spells += extract_foundry_spells({s['name'].lower(): s for s in spells})
    # The source spell-list data never tags the Shaman's orisons (0-level spells),
    # even though the class grants them — so a Shaman ends up with no cantrips to
    # pick. Tag the canonical Shaman orison list at level 0.
    SHAMAN_ORISONS = {'bleed', 'create water', 'detect magic', 'detect poison', 'guidance',
                      'light', 'mending', 'purify food and drink', 'read magic', 'resistance',
                      'spark', 'stabilize'}
    for sp in spells:
        if sp['name'].lower() in SHAMAN_ORISONS:
            sp['levels'].setdefault('Shaman', 0)
    # Same gap for the Unchained Summoner: levels 1-6 are present but its 0-level
    # cantrips are missing. They match the chained Summoner's 0-level list, so
    # mirror those (data-derived rather than hand-listed).
    for sp in spells:
        if sp['levels'].get('Summoner') == 0:
            sp['levels'].setdefault('Summoner (Unchained)', 0)
    write_js('spells.js', 'spells', spells)

    weapons = extract_weapon_tables(books)
    weapons += extract_foundry_weapons({w['name'].lower() for w in weapons})
    write_js('weapons.js', 'weapons', weapons)

    armors = extract_armor_tables(books)
    armors += extract_foundry_armors({a['name'].lower() for a in armors})
    write_js('armors.js', 'armors', armors)

    items = extract_items(books)
    items += extract_foundry_items({i['name'].lower() for i in items})
    write_js('items.js', 'items', items)

    races = extract_races(books)
    races += extract_foundry_races({r['name'].lower() for r in races})
    write_js('races.js', 'races', races)
    write_js('racialtraits.js', 'racialTraits', extract_racial_traits(books))
    write_js('traits.js', 'traits', extract_traits(books))
    write_js('skills.js', 'skills', extract_skills(books))
    write_js('companions.js', 'companions', extract_companions(books))
    write_js('evolutions.js', 'evolutions', extract_eidolon_evolutions(books))
    write_js('classabilities.js', 'classAbilities', extract_foundry_classfeatures())
    write_js('mythicabilities.js', 'mythicAbilities', extract_mythic_abilities(books))
    write_js('mythicpaths.js', 'mythicPaths', extract_mythic_paths())
    write_js('mythicspells.js', 'mythicSpells', extract_mythic_spells(books))
    write_js('buffs.js', 'buffs', extract_foundry_buffs())
    print('Done.')


if __name__ == '__main__':
    main()
