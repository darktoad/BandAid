# -*- coding: utf-8 -*-
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
fig=plt.figure(figsize=(8.5,11),dpi=200); fig.patch.set_facecolor("white")
ax=fig.add_axes([0,0,1,1]); ax.axis("off"); ax.set_xlim(0,100); ax.set_ylim(0,100)
ax.text(6,95,"8.  Orange Blossom Special",ha="left",va="top",fontsize=20,
        fontweight="bold",family="DejaVu Serif",color="#111")
ax.text(6,90.5,"Key of E · chords & structure only",ha="left",va="top",fontsize=12,color="#555")
ax.plot([6,94],[88.7,88.7],color="#999",lw=1)

ax.add_patch(FancyBboxPatch((6,80),88,6.5,boxstyle="round,pad=0.3",fc="#fbecea",ec="#d99",lw=1))
note=("Orange Blossom Special (Ervin T. Rouse) is still under copyright, so the melody is intentionally\n"
      "omitted. Below is the chord framework only — work the fiddle breaks out by ear from a recording.")
ax.text(10,84.7,note,ha="left",va="top",fontsize=10,color="#7a2a22",linespacing=1.5)

def block(y,title,rows):
    ax.text(8,y,title,ha="left",va="top",fontsize=13,fontweight="bold",
            family="DejaVu Serif",color="#1b3a5b")
    yy=y-3
    for r in rows:
        ax.text(11,yy,r,ha="left",va="top",fontsize=12.5,family="DejaVu Sans Mono",color="#222")
        yy-=3.4
    return yy

y=block(75,"Fiddle break (the main event) — vamp in E",
    ["| E   | E   | E   | E   |   (drive; train-rhythm)",
     "| E   | E   | B7  | E   |   ...repeat as long as the break runs"])
y=block(y-2,"Verse / sung section",
    ["| E   | E   | B7  | B7  |",
     "| E   | E   | B7  | E   |"])
y=block(y-2,"Performance notes",
    ["- Whole tune lives on two chords: E (I) and B7 (V7).",
     "- Trade fiddle breaks; guitar/uke drive straight-eight rhythm.",
     "- Bass: root-five on E, walk E->B7 on the change.",
     "- Key can move (F, G) to suit the fiddler — keep the I–V7 shape."])
fig.savefig("pages_obs.png",dpi=200); print("obs ok")
