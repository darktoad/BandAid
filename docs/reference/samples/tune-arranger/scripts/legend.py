# -*- coding: utf-8 -*-
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

fig=plt.figure(figsize=(8.5,11),dpi=200); fig.patch.set_facecolor("white")
ax=fig.add_axes([0,0,1,1]); ax.axis("off"); ax.set_xlim(0,100); ax.set_ylim(0,100)

ax.text(50,96.5,"Reading the Tablature — String Map",ha="center",va="top",
        fontsize=20,fontweight="bold",family="DejaVu Serif")
ax.text(50,92,"How the tab lines map to the actual strings on each instrument",
        ha="center",va="top",fontsize=11,color="#444")

ax.add_patch(FancyBboxPatch((7,81.5),86,7,boxstyle="round,pad=0.3",fc="#f4f1e8",ec="#cbb88a",lw=1))
rule=("Rule: tab lines are ordered by string NUMBER, not by pitch. The top line is always\n"
      "string 1; the bottom line is the highest-numbered string. For most instruments that\n"
      "also means top = highest pitch. Numbers on a line are FRET numbers (0 = open string).")
ax.text(10,86.8,rule,ha="left",va="top",fontsize=10.4,color="#222",linespacing=1.5)

def diagram(y_top,title,lines,callout=None,accent=None):
    x0,x1=29,64; n=len(lines); gap=2.0
    ax.text(8,y_top+1.1,title,ha="left",va="bottom",fontsize=13,fontweight="bold",
            family="DejaVu Serif",color="#1b3a5b")
    for i,(sn,lab) in enumerate(lines):
        y=y_top-i*gap
        acc = accent is not None and i==accent
        col="#b3450f" if acc else "#222"; lw=2.6 if acc else 1.2
        ax.plot([x0,x1],[y,y],color=col,lw=lw,solid_capstyle="round")
        ax.text(x0-1.4,y,f"string {sn}",ha="right",va="center",fontsize=9,
                family="DejaVu Sans Mono",color=col)
        tag = "  \u2190 top" if i==0 else ("  \u2190 bottom" if i==n-1 else "")
        ax.text(x1+1.4,y,lab+tag,ha="left",va="center",fontsize=9.8,color=col,
                fontweight=("bold" if acc else "normal"))
    if callout:
        ax.text(29,y_top-(n-1)*gap-1.5,callout,ha="left",va="top",fontsize=9.3,
                color="#b3450f",style="italic",linespacing=1.4)

diagram(77,"Guitar — standard tuning (E A D G B E)",
    [(1,"e\u2032  high E (E4)"),(2,"B  (B3)"),(3,"G  (G3)"),(4,"D  (D3)"),(5,"A  (A2)"),(6,"E  low E (E2)")])

diagram(58.5,"Ukulele — high-G, re-entrant (g C E A)",
    [(1,"A  (A4)"),(2,"E  (E4)"),(3,"C  (C4)"),(4,"g  HIGH g (G4)")],
    callout=("Your high-G string is string 4 = the BOTTOM line. Being re-entrant, it sounds HIGHER\n"
             "than the C and E strings drawn above it \u2014 so the bottom line is NOT your lowest note."),
    accent=3)

diagram(43,"Bass (U-Bass) — standard tuning (E A D G)",
    [(1,"G  (G2)"),(2,"D  (D2)"),(3,"A  (A1)"),(4,"E  low E (E1)")])

ax.add_patch(FancyBboxPatch((7,4),86,7.5,boxstyle="round,pad=0.3",fc="#eef3f7",ec="#9bb6cc",lw=1))
foot=("In this book the Fiddle line is standard notation; Guitar, Ukulele and Bass use tab with the\n"
      "maps above. Big John McNeil is arranged in all four parts. The other tunes are melody +\n"
      "chords \u2014 play the melody on any instrument, or read the chord symbols for backup.")
ax.text(10,10.3,foot,ha="left",va="top",fontsize=10,color="#333",linespacing=1.5)

fig.savefig("pages_legend.png",dpi=200); print("ok")
