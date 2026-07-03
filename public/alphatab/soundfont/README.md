# florestan-strings.sf2

"040 Florestan String Quartet" by Nando Florestan — solo strings at the GM programs
(bank 0): 40 Violin, 41 Viola, 42 Cello, 43 Contrabass.

- **License:** Public Domain (embedded in the file's SF2 `ICOP` field).
- **Source:** https://dev.nando.audio/pages/soundfonts.html
  (`_static/sf2/040_Florestan_String_Quartet.zip`, renamed here).

Loaded by `createRenderer.ts` as an *appended* soundfont over alphaTab's bundled
sonivox base: alphaTab's preset lookup scans backwards, so these string presets win
over sonivox's for programs 40–43 while sonivox keeps serving everything else
(including the metronome/count-in percussion).
