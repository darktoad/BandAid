# -*- coding: utf-8 -*-
import warnings; warnings.filterwarnings("ignore")
import xml.etree.ElementTree as ET
import verovio, cairosvg, io, os
from PIL import Image, ImageDraw, ImageFont

W,H=1700,2200
SERIF="/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS ="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
f_title=ImageFont.truetype(SERIF,46)
f_cap  =ImageFont.truetype(SANS,27)

def clean_xml(src):
    tree=ET.parse(src); root=tree.getroot()
    for tag in ('work','movement-title','movement-number','credit'):
        for e in root.findall(tag): root.remove(e)
    # strip tempo/metronome directions so they don't render as a missing-glyph box
    for parent in root.iter():
        for d in list(parent.findall('direction')):
            if d.find('.//metronome') is not None or d.find('.//words') is not None:
                parent.remove(d)
    tmp=src+".clean.musicxml"; tree.write(tmp,encoding='UTF-8',xml_declaration=True); return tmp

def render_pages(musicxml, scale):
    tk=verovio.toolkit()
    tk.setOptions({"pageWidth":int(W/ (200/72) /scale*72) if False else 2550,
                   "pageHeight":3300,"scale":scale,"adjustPageHeight":True,
                   "pageMarginLeft":40,"pageMarginRight":40,"pageMarginTop":30,"pageMarginBottom":30,
                   "footer":"none","header":"none"})
    tk.loadFile(musicxml)
    imgs=[]
    for pg in range(1,tk.getPageCount()+1):
        svg=tk.renderToSVG(pg)
        png=cairosvg.svg2png(bytestring=svg.encode(),output_width=1500,background_color="white")
        imgs.append(Image.open(io.BytesIO(png)).convert("RGB"))
    return imgs

def page_canvas(title,caption,notation_img,cont=False):
    cv=Image.new("RGB",(W,H),"white"); d=ImageDraw.Draw(cv)
    top=70
    d.text((70,top),title,font=f_title,fill="#111"); top+=64
    if caption:
        d.text((72,top),caption,font=f_cap,fill="#555"); top+=44
    d.line((70,top,W-70,top),fill="#aaaaaa",width=2); top+=24
    avail_h=H-top-70; avail_w=W-140
    iw,ih=notation_img.size; sc=min(avail_w/iw, avail_h/ih, 1.0)
    nimg=notation_img.resize((int(iw*sc),int(ih*sc)))
    x=(W-nimg.size[0])//2
    cv.paste(nimg,(x,top))
    return cv

import chartbook_tunes
tunes=[(k.split('/')[-1].replace('_multipart.musicxml',''),k,t,c,sc) for (k,t,c,sc) in chartbook_tunes.TUNES]

pages=[Image.open("pages_legend.png").convert("RGB")]
for key,fp,title,cap,scale in tunes:
    imgs=render_pages(clean_xml(fp),scale)
    for i,im in enumerate(imgs):
        t=title if i==0 else title+"  (cont.)"
        c=cap if i==0 else ""
        pages.append(page_canvas(t,c,im))
pages.append(Image.open("pages_obs.png").convert("RGB"))

out="/mnt/user-data/outputs/FiddleSet_Chartbook.pdf"
pages[0].save(out,save_all=True,append_images=pages[1:],resolution=200.0)
print("PDF pages:",len(pages),"->",out)
