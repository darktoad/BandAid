# -*- coding: utf-8 -*-
"""ABC (melody+chords) -> 4-part MusicXML (fiddle notation; guitar/uke/bass tab).
Fingering for fretted parts uses a position-aware, campanella-weighted DP optimizer."""
import warnings; warnings.filterwarnings("ignore")
import copy
from music21 import converter, clef, articulations, note, instrument, stream, metadata, harmony, interval
import xml.etree.ElementTree as ET
import optimize

GUITAR={1:64,2:59,3:55,4:50,5:45,6:40}
UKE_HIGHG={1:69,2:64,3:60,4:67}            # A E C g  (re-entrant)
BASS={1:43,2:38,3:33,4:28}                 # G D A E

# Fingering weights (see SKILL.md). Campanella-forward for uke; cleaner position blocks for guitar.
UKE_W=dict(shift=1.0, jump=2.5, cross=-0.7, same_slide=0.9, high=0.10, open=-0.4, oct=0.45)
GTR_W=dict(shift=1.0, jump=2.0, cross=-0.15, same_slide=0.4, high=0.12, open=-0.25, oct=0.0)
BASS_W=dict(shift=1.0, jump=2.0, cross=0.0, same_slide=0.5, high=0.06, open=-0.3, low=0.03)

def best_fret(midi,tuning,maxfret=15):
    c=[(midi-o,st) for st,o in tuning.items() if 0<=midi-o<=maxfret]
    if not c: return None
    c.sort(key=lambda x:(x[0],-x[1])); return c[0]

def strip_chords(p):
    for cs in list(p.recurse().getElementsByClass(harmony.ChordSymbol)): p.remove(cs,recurse=True)

def set_first_clef(p,cl):
    m=p.getElementsByClass('Measure').first()
    for c in list(m.getElementsByClass(clef.Clef)): m.remove(c)
    m.insert(0,cl)

def attach(n,st,fr):
    si=articulations.StringIndication(); si.number=st
    fi=articulations.FretIndication(); fi.number=fr
    n.articulations=[si,fi]

def fold_uke(part, lo=60, hi=81):
    """Octave-fold each note into the playable window, smoothing toward the previous note."""
    prev=None
    for n in part.recurse().notes:
        if not n.isNote: continue
        m=n.pitch.midi
        cands=[m+12*k for k in range(-4,5) if lo<=m+12*k<=hi]
        if not cands:
            cands=[min((m+12*k for k in range(-4,5)),
                       key=lambda x:0 if lo<=x<=hi else min(abs(x-lo),abs(x-hi)))]
        target=prev if prev is not None else 69
        best=min(cands,key=lambda x:abs(x-target))
        if best!=m: n.transpose(interval.Interval(best-m),inPlace=True)
        prev=best

def fret_part(part, tuning, weights, maxfret, window, allow_octave):
    """Assign string/fret to every note via the DP optimizer; apply chosen octave."""
    set_first_clef(part,clef.TabClef()); strip_chords(part)
    notes=[n for n in part.recurse().notes if n.isNote]
    pitches=[n.pitch.midi for n in notes]
    path=optimize.optimize(pitches,tuning,weights,maxfret=maxfret,window=window,allow_octave=allow_octave)
    for n,(sp,st,fr) in zip(notes,path):
        if sp!=n.pitch.midi: n.pitch.midi=sp
        attach(n,st,fr)

def make_bass(melody):
    # read chords from the ORIGINAL melody (before stripping) keyed by measure index
    mel_meas=list(melody.getElementsByClass('Measure'))
    chordmap={i:sorted(((cs.offset,cs.root().pitchClass) for cs in m.getElementsByClass(harmony.ChordSymbol)),key=lambda x:x[0])
              for i,m in enumerate(mel_meas)}
    bass=copy.deepcopy(melody); strip_chords(bass); set_first_clef(bass,clef.TabClef())
    ts=melody.recurse().getElementsByClass('TimeSignature').first()
    barDur=ts.barDuration.quarterLength
    is68=(ts.numerator==6 and ts.denominator==8)
    beats=[(0.0,1.5),(1.5,1.5)] if is68 else [(b,1.0) for b in range(int(barDur))]
    cur=None; events=[]
    for idx,m in enumerate(bass.getElementsByClass('Measure')):
        evs=chordmap.get(idx,[])
        orig=m.duration.quarterLength
        for el in list(m.notesAndRests): m.remove(el)
        if orig<barDur-1e-6:
            r=note.Rest(); r.quarterLength=orig; m.insert(0,r)
            for off,pc in evs: cur=pc
            continue
        ei=0
        for i,(boff,bdur) in enumerate(beats):
            while ei<len(evs) and evs[ei][0]<=boff+1e-6: cur=evs[ei][1]; ei+=1
            if cur is None: cur=7
            pc = cur if i%2==0 else (cur+7)%12     # root on strong beat, fifth on weak
            events.append((m,boff,bdur,pc))
    path=optimize.optimize_bass([pc for *_,pc in events], BASS, BASS_W)
    for (m,boff,bdur,pc),(sp,st,fr) in zip(events,path):
        n=note.Note(); n.pitch.midi=sp; n.quarterLength=bdur; attach(n,st,fr); m.insert(boff,n)
    return bass

def patch_staff_details(fp):
    tree=ET.parse(fp); root=tree.getroot()
    names={sp.get('id'):(sp.find('part-name').text or '') for sp in root.iter('score-part')}
    G=[('E',2),('A',2),('D',3),('G',3),('B',3),('E',4)]
    U=[('G',4),('C',4),('E',4),('A',4)]
    B=[('E',1),('A',1),('D',2),('G',2)]
    def sd(lines,tun):
        e=ET.Element('staff-details'); ET.SubElement(e,'staff-lines').text=str(lines)
        for i,(s,o) in enumerate(tun,1):
            t=ET.SubElement(e,'staff-tuning'); t.set('line',str(i))
            ET.SubElement(t,'tuning-step').text=s; ET.SubElement(t,'tuning-octave').text=str(o)
        return e
    cfg={}
    for pid,nm in names.items():
        if 'Guitar' in nm: cfg[pid]=(6,G)
        elif 'Ukulele' in nm: cfg[pid]=(4,U)
        elif 'Bass' in nm: cfg[pid]=(4,B)
    for part in root.iter('part'):
        if part.get('id') not in cfg: continue
        lines,tun=cfg[part.get('id')]; attr=part.find('measure').find('attributes')
        for old in attr.findall('staff-details'): attr.remove(old)
        attr.append(sd(lines,tun))
    tree.write(fp,encoding='UTF-8',xml_declaration=True)

def build(tune_key, abc, title, composer, outdir="out"):
    src=converter.parse(abc,format='abc'); melody=src.parts[0]
    fiddle=copy.deepcopy(melody); set_first_clef(fiddle,clef.TrebleClef())
    fiddle.partName="Fiddle"; fiddle.insert(0,instrument.Violin())

    guitar=copy.deepcopy(melody).transpose(-12)
    fret_part(guitar,GUITAR,GTR_W,maxfret=10,window=None,allow_octave=False)
    guitar.partName="Guitar (tab)"; guitar.insert(0,instrument.AcousticGuitar())

    uke=copy.deepcopy(melody); fold_uke(uke)
    fret_part(uke,UKE_HIGHG,UKE_W,maxfret=9,window=(60,81),allow_octave=True)
    uke.partName="Ukulele (tab, high-G)"
    try: uke.insert(0,instrument.Ukulele())
    except Exception: pass

    bass=make_bass(melody); bass.partName="Bass (tab)"
    try: bass.insert(0,instrument.AcousticBass())
    except Exception: bass.insert(0,instrument.Bass())

    sc=stream.Score(); sc.insert(0,metadata.Metadata())
    sc.metadata.title=title; sc.metadata.composer=composer
    for p in (fiddle,guitar,uke,bass): sc.insert(0,p)
    fp=f"{outdir}/{tune_key}_multipart.musicxml"; sc.write('musicxml',fp=fp); patch_staff_details(fp)
    return fp

if __name__=="__main__":
    import tunes
    meta={"01_Big_John_McNeil":("Big John McNeil","Peter Milne (1824-1908)"),
     "02_Blackberry_Blossom":("Blackberry Blossom","Trad."),
     "03_Wabash_Cannonball":("Wabash Cannonball","Trad. (Roff 1882 / Kindt 1904)"),
     "04_Irish_Washerwoman":("The Irish Washerwoman","Trad."),
     "05_Soldiers_Joy":("Soldier's Joy","Trad."),
     "06_Old_Blue":("Old Blue","Trad."),
     "07_Billy_in_the_Lowground":("Billy in the Lowground","Trad.")}
    for k,(t,c) in meta.items():
        print(k,"->",build(k,tunes.tunes[k],t,c).split("/")[-1])
