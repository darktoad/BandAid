/**
 * Pure MusicXML → chord-timeline extraction for the chord overlay.
 *
 * Chords come from `<harmony>` elements. A harmony is anchored to the beat where it
 * begins: we walk each measure in document order, tracking the running duration position
 * (in `<divisions>` units) so a harmony's beat = position / divisions-per-beat + 1. Today's
 * songs place one harmony at each bar's start (beat 1), but this supports sub-bar harmony.
 *
 * String-based (no DOM) so it runs identically in the browser and in Node tests. Bars are
 * indexed by `<measure>` order → 1-based, matching alphaTab's `bar` (its master-bar index + 1).
 */

export interface ChordOnset {
  bar: number; // 1-based, by measure order
  beat: number; // 1-based beat within the bar
  label: string; // display label, e.g. "C", "Am", "D7", "G/B"
  root: string; // root with accidental, e.g. "C", "F#", "Bb"
  kind: string; // raw MusicXML kind, e.g. "major", "minor", "dominant"
}

/** A chord as it should be shown within one bar (anchored at its first beat). */
export interface BarChord {
  beat: number;
  label: string;
  root: string;
  kind: string;
}

const MEASURE_RE = /<measure\b[^>]*>([\s\S]*?)<\/measure>/g;
// Relevant in-measure tokens, matched in document order.
const TOKEN_RE =
  /<divisions>(\d+)<\/divisions>|<time\b[^>]*>([\s\S]*?)<\/time>|<harmony\b[^>]*>([\s\S]*?)<\/harmony>|<backup\b[^>]*>([\s\S]*?)<\/backup>|<forward\b[^>]*>([\s\S]*?)<\/forward>|<note\b[^>]*>([\s\S]*?)<\/note>/g;

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}
function intTag(xml: string, name: string): number | null {
  const v = tag(xml, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const KIND_SUFFIX: Record<string, string> = {
  major: '',
  minor: 'm',
  augmented: 'aug',
  diminished: 'dim',
  dominant: '7',
  'major-seventh': 'maj7',
  'minor-seventh': 'm7',
  'diminished-seventh': 'dim7',
  'augmented-seventh': 'aug7',
  'half-diminished': 'm7b5',
  'major-minor': 'mMaj7',
  'major-sixth': '6',
  'minor-sixth': 'm6',
  'dominant-ninth': '9',
  'major-ninth': 'maj9',
  'minor-ninth': 'm9',
  'suspended-second': 'sus2',
  'suspended-fourth': 'sus4',
  power: '5',
  none: '',
  '': '',
};

function accidental(alter: number | null): string {
  if (alter === 1) return '#';
  if (alter === -1) return 'b';
  if (alter === 2) return '##';
  if (alter === -2) return 'bb';
  return '';
}

function suffixForKind(kind: string, kindBlock: string): string {
  if (kind in KIND_SUFFIX) return KIND_SUFFIX[kind];
  // Fall back to the engraver's display text, then the raw kind string.
  const textAttr = kindBlock.match(/text="([^"]*)"/);
  if (textAttr) return textAttr[1];
  return kind;
}

function parseHarmony(block: string): Omit<ChordOnset, 'bar' | 'beat'> | null {
  const rootStep = tag(block, 'root-step');
  if (!rootStep) return null; // e.g. a "none"/N.C. harmony — skip
  const rootAlter = intTag(block, 'root-alter');
  const root = `${rootStep}${accidental(rootAlter)}`;

  const kindBlockMatch = block.match(/<kind\b[^>]*>([\s\S]*?)<\/kind>/);
  const kind = kindBlockMatch ? kindBlockMatch[1].trim() : 'major';
  let label = `${root}${suffixForKind(kind, kindBlockMatch?.[0] ?? '')}`;

  const bassStep = tag(block, 'bass-step');
  if (bassStep) {
    const bassAlter = intTag(block, 'bass-alter');
    label += `/${bassStep}${accidental(bassAlter)}`;
  }
  return { label, root, kind };
}

/** Extract all chord onsets across the score, in document order (bar then beat ascending). */
export function parseChordTimeline(musicXml: string): ChordOnset[] {
  const onsets: ChordOnset[] = [];
  let divisions = 1; // <divisions> persists across measures until redefined
  let beatType = 4; // denominator of the active time signature

  let measureMatch: RegExpExecArray | null;
  MEASURE_RE.lastIndex = 0;
  let barIndex = 0;
  while ((measureMatch = MEASURE_RE.exec(musicXml)) !== null) {
    barIndex += 1;
    const body = measureMatch[1];
    let pos = 0; // running position within the bar, in divisions

    let tok: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((tok = TOKEN_RE.exec(body)) !== null) {
      const [, divs, timeBlock, harmonyBlock, backupBlock, forwardBlock, noteBlock] = tok;

      if (divs !== undefined) {
        divisions = Number(divs);
      } else if (timeBlock !== undefined) {
        const bt = intTag(timeBlock, 'beat-type');
        if (bt) beatType = bt;
      } else if (harmonyBlock !== undefined) {
        const chord = parseHarmony(harmonyBlock);
        if (chord) {
          const offset = intTag(harmonyBlock, 'offset') ?? 0;
          const divisionsPerBeat = (divisions * 4) / beatType;
          const rawBeat = (pos + offset) / divisionsPerBeat + 1;
          // Snap away float noise so on-beat harmonies land on exact integers.
          const beat = Math.abs(rawBeat - Math.round(rawBeat)) < 1e-6 ? Math.round(rawBeat) : rawBeat;
          onsets.push({ bar: barIndex, beat, ...chord });
        }
      } else if (backupBlock !== undefined) {
        pos -= intTag(backupBlock, 'duration') ?? 0;
      } else if (forwardBlock !== undefined) {
        pos += intTag(forwardBlock, 'duration') ?? 0;
      } else if (noteBlock !== undefined) {
        // Chord-stacked notes share the previous note's onset, so they don't advance time.
        const isChordNote = /<chord\s*\/>/.test(noteBlock);
        if (!isChordNote) pos += intTag(noteBlock, 'duration') ?? 0;
      }
    }
  }
  return onsets;
}

/**
 * The chords to display for one bar: the chord active at the bar's start (carried forward
 * from an earlier onset and re-shown at beat 1) followed by any further onsets within the
 * bar at their beats. Consecutive duplicates of the same chord are collapsed.
 */
export function chordsForBar(timeline: ChordOnset[], bar: number): BarChord[] {
  let active: ChordOnset | undefined;
  const within: ChordOnset[] = [];
  for (const o of timeline) {
    if (o.bar < bar || (o.bar === bar && o.beat <= 1)) {
      active = o; // most recent onset at or before this bar's start
    } else if (o.bar === bar) {
      within.push(o);
    }
  }

  const list: BarChord[] = [];
  if (active) list.push({ beat: 1, label: active.label, root: active.root, kind: active.kind });
  for (const o of within.sort((a, b) => a.beat - b.beat)) {
    list.push({ beat: o.beat, label: o.label, root: o.root, kind: o.kind });
  }
  // Collapse consecutive duplicates (same chord sounding back-to-back within the bar).
  return list.filter((c, i) => i === 0 || c.label !== list[i - 1].label);
}
