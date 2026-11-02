import pdfplumber, sys, re, json
F, OUT = sys.argv[1], sys.argv[2]
FACTIONS = {}  # upper -> proper
def clean(s):
    if s is None: return ''
    s = s.replace('\x07','').replace('\xad','').replace('✹','').replace('UPDATE','').replace('NEU\n','')
    s = re.sub(r'-\n(?=[a-zäöüß])', '', s)      # Trennstrich mitten im Wort
    s = re.sub(r'-\n', '-', s)
    s = s.replace('\n',' ')
    s = re.sub(r'(?<![\w-])([A-ZÄÖÜ]) (?=[a-zäöüß])', r'\1', s)  # "G lockenschlags"
    s = re.sub(r'\s+',' ', s).strip()
    s = re.sub(r'(?<![\w-])([A-ZÄÖÜ]) (?=[a-zäöüß])', r'\1', s)
    s = re.sub(r'(?<=\w)- (?=[A-ZÄÖÜ])', '-', s)
    s = s.replace('Gryph hunden','Gryphhunden').replace('Th anquol','Thanquol').replace('Kh inerai','Khinerai')
    return s
def num(s):
    m = re.search(r'\d+', s or ''); return int(m.group()) if m else None
def proper(up):
    up = clean(up)
    return up
units, others, ror = [], [], []
alliance_by_page = lambda p: 'Ordnung' if p<=23 else 'Chaos' if p<=38 else 'Tod' if p<=46 else 'Zerstörung'
with pdfplumber.open(F) as pdf:
    for i,p in enumerate(pdf.pages):
        pn = i+1
        if pn < 3: continue
        lines = (p.extract_text() or '').splitlines()
        tables = p.extract_tables()
        if 3 <= pn <= 55:
            # Fraktionskopf: erste Zeile nach "OKTOBER 2026"
            idx = next(k for k,l in enumerate(lines) if 'OKTOBER 2026' in l)
            fac = clean(lines[idx+1]); legends=False; alliance=alliance_by_page(pn)
        elif pn == 56:
            fac='Allgemein'; alliance='Alle'; legends=False
        elif 57 <= pn <= 62:
            for t in tables:
                for r in t:
                    if not r or not r[0] or len(r)<4: continue
                    name = clean(r[0]); pts=num(r[2])
                    if pts is None or name.upper().startswith('NAME'): continue
                    allowed = clean(r[3]).split(':',1)[-1]
                    facs=[clean(x).rstrip('.') for x in re.split(r',(?![^()]*\))', allowed) if clean(x)]
                    ror.append(dict(name=name, units=[clean(x) for x in (r[1] or '').split('•') if clean(x)], points=pts, factions=facs, notes=''))
            continue
        else:
            hdr = next((l for l in lines if 'WARHAMMER-LEGENDEN' in l), '')
            alliance = clean(hdr.split('–')[-1]).capitalize() if '–' in hdr else 'Legenden'
            legends=True
        kind=None
        for t in tables:
            for r in t:
                if r is None: continue
                r = [x for x in r]
                # White Dwarf hat Zusatzspalte "Ausgabe"
                if len(r)==7: r = [r[0]] + r[2:]
                if len(r)==5 and r[0] and r[0].strip() in ('TYP',): kind='other'; continue
                c0 = clean(r[0])
                if pn>=63 and all(x in (None,'') for x in r[1:]) and c0:
                    fac = proper(c0); kind=None; continue
                if c0.upper().endswith('HELDEN'): kind='hero'; continue
                if c0.upper().endswith('EINHEITEN'): kind='unit'; continue
                if c0.upper()=='TYP': kind='other'; continue
                if c0.upper()=='NAME': kind='manif'; continue
                if kind in ('hero','unit') and len(r)>=6:
                    pts=num(r[2]); 
                    if pts is None or not c0: continue
                    notes=clean(r[4])
                    units.append(dict(faction=fac, alliance=alliance, name=c0, hero=kind=='hero', models=num(r[1]) or 1,
                        points=pts, info=clean(r[3]), notes=notes, legends=legends or 'Warhammer-Legenden-Einheit' in notes,
                        reinforce=not('nicht verstärkt' in notes) and (num(r[1]) or 1)>1))
                elif kind=='other' and len(r)>=4:
                    if num(r[2]) is None: continue
                    others.append(dict(faction=fac, type=c0, name=clean(r[1]), points=num(r[2]), notes=clean(r[3])))
                elif kind=='manif' and len(r)>=2:
                    if num(r[1]) is None: continue
                    others.append(dict(faction=fac, type='Manifestationslehre', name=c0, points=num(r[1]), notes=clean(r[2]) if len(r)>2 else ''))
# Fraktionsnamen normalisieren (Großschreibung aus dem Kopf)
def nice(f):
    if f in ('Allgemein',): return f
    s = f.title() if f.isupper() else f
    for a,b in [(' Der ',' der '),(' Des ',' des '),(' Von ',' von ')]: s=s.replace(a,b)
    return s
units=[u for u in units if u['faction']!='WHITE DWARF']
others=[o for o in others if o['faction']!='WHITE DWARF']
for u in units: u['faction']=nice(u['faction'])
for o in others: o['faction']=nice(o['faction'])
json.dump(dict(source='Schlachtprofile Oktober 2026 (Games Workshop, Download für den persönlichen Gebrauch)', units=units, others=others, regiments_of_renown=ror), open(OUT,'w'), ensure_ascii=False, indent=0)
from collections import Counter
c=Counter((u['alliance'],u['faction'],u['legends']) for u in units)
for k,v in sorted(c.items()): print(k,v)
print(len(units),'units',len(others),'others',len(ror),'RoR')
