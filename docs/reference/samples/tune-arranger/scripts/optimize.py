# -*- coding: utf-8 -*-
"""Position-aware fingering optimizers (Viterbi/DP), shared by all fretted parts."""
INF=float('inf')

def _viterbi(states, ncost, tcost):
    dp=[]; bk=[]
    for i,cs in enumerate(states):
        dp.append([INF]*len(cs)); bk.append([-1]*len(cs))
        for j,c in enumerate(cs):
            n=ncost(c,i)
            if i==0: dp[i][j]=n
            else:
                best=INF;b=-1
                for k,pc in enumerate(states[i-1]):
                    v=dp[i-1][k]+tcost(pc,c)
                    if v<best: best,b=v,k
                dp[i][j]=best+n; bk[i][j]=b
    if not dp: return []
    j=min(range(len(dp[-1])),key=lambda x:dp[-1][x]); path=[]
    for i in range(len(dp)-1,-1,-1):
        path.append(states[i][j])
        if i>0: j=bk[i][j]
    path.reverse(); return path

def _tcost(w):
    def f(p,c):
        _,sa,fa=p; _,sb,fb=c; df=abs(fb-fa)
        cost=w['shift']*df + w.get('jump',0)*max(0,df-3)
        cost += w.get('cross',0) if sb!=sa else (w.get('same_slide',0) if fb!=fa else 0)
        return cost
    return f

def candidates(midi, tuning, maxfret, window, allow_octave):
    octs=[midi-24,midi-12,midi,midi+12,midi+24] if allow_octave else [midi]
    out=[]
    for sp in octs:
        if window and not (window[0]<=sp<=window[1]): continue
        for st,o in tuning.items():
            fr=sp-o
            if 0<=fr<=maxfret: out.append((sp,st,fr))
    if not out:
        for sp in [midi,midi-12,midi+12,midi-24,midi+24]:
            for st,o in tuning.items():
                fr=sp-o
                if 0<=fr<=maxfret: out.append((sp,st,fr))
            if out: break
    return out

def optimize(pitches, tuning, w, maxfret=12, window=(60,81), allow_octave=True):
    """Melodic parts (fiddle-derived guitar/uke). Returns [(sounding_pitch,string,fret)]."""
    S=[candidates(m,tuning,maxfret,window,allow_octave) for m in pitches]
    def ncost(c,i):
        sp,st,fr=c
        return w['oct']*abs(sp-pitches[i]) + w['high']*fr + (w['open'] if fr==0 else 0)
    return _viterbi(S, ncost, _tcost(w))

def optimize_bass(pcs, tuning, w, low=28, high=45, maxfret=7):
    """Bass: pcs = pitch-class target per beat (root on strong beats, fifth on weak).
    Optimizer picks register/string/fret to keep a low, parked, ergonomic shape."""
    S=[]
    for pc in pcs:
        cs=[(m,st,m-o) for m in range(low,high+1) if m%12==pc%12
                       for st,o in tuning.items() if 0<=m-o<=maxfret]
        if not cs:
            cs=[(m,st,m-o) for m in range(low-12,high+13) if m%12==pc%12
                           for st,o in tuning.items() if 0<=m-o<=maxfret+5]
        S.append(cs)
    def ncost(c,i):
        sp,st,fr=c
        return w.get('low',0)*(sp-low) + w['high']*fr + (w['open'] if fr==0 else 0)
    return _viterbi(S, ncost, _tcost(w))

def metrics(placements):  # [(string,fret)]
    frets=[f for _,f in placements]; strings=[s for s,_ in placements]
    if not frets: return dict(travel=0,big=0,maxfret=0,s1=0,cross=0,n=0)
    travel=sum(abs(frets[i]-frets[i-1]) for i in range(1,len(frets)))
    big=sum(1 for i in range(1,len(frets)) if abs(frets[i]-frets[i-1])>3)
    cross=sum(1 for i in range(1,len(strings)) if strings[i]!=strings[i-1])
    s1=round(100.0*sum(1 for s in strings if s==1)/len(strings))
    return dict(travel=travel,big=big,maxfret=max(frets),s1=s1,cross=cross,n=len(frets))
