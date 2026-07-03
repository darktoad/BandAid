/**
 * Pure ChordPro → SongSheet parser for the lyrics sheet.
 *
 * String-based (no DOM) so it runs identically in the browser and in Node tests —
 * the same approach as src/chords/chordTimeline.ts. Lyrics-only: performance notes live
 * in the library manifest, not here. Unknown directives are ignored, so files stay
 * compatible with standard ChordPro tooling.
 */

import { transposeChordLabel } from '../chords/transposeChord';

export interface ChordToken {
  sym: string;
  index: number; // char offset into `text` where the chord lands
}
export interface LyricLine {
  chords: ChordToken[];
  text: string;
}
/** A line split for rendering: a chord (possibly empty) and the run of text under it. */
export interface LyricChunk {
  sym: string;
  text: string;
}
export interface LyricSection {
  label?: string;
  kind: 'verse' | 'chorus' | 'other';
  lines: LyricLine[];
}
export interface SongSheet {
  sections: LyricSection[];
}

const SECTION_START = /^\{(?:start_of_(verse|chorus)|sov|soc)(?::\s*(.*?))?\}$/i;
const SECTION_END = /^\{(?:end_of_(?:verse|chorus)|eov|eoc)\}$/i;
const DIRECTIVE = /^\{.*\}$/;

/** Parse one raw line into its text (chords stripped) + chord onsets. */
function parseLine(raw: string): LyricLine {
  const chords: ChordToken[] = [];
  let text = '';
  const re = /\[([^\]]*)\]|([^[]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) chords.push({ sym: m[1], index: text.length });
    else text += m[2];
  }
  return { chords, text };
}

export function parseChordPro(input: string): SongSheet {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;

  const ensure = (): LyricSection => {
    if (!current) {
      current = { kind: 'other', lines: [] };
      sections.push(current);
    }
    return current;
  };

  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const start = SECTION_START.exec(line);
    if (start) {
      const kind = start[1]?.toLowerCase() === 'chorus' || /^\{soc/i.test(line) ? 'chorus' : 'verse';
      current = { kind, label: start[2]?.trim() || undefined, lines: [] };
      sections.push(current);
      continue;
    }
    if (SECTION_END.test(line)) {
      current = null;
      continue;
    }
    if (DIRECTIVE.test(line)) continue; // ignore unknown directives

    ensure().lines.push(parseLine(raw));
  }

  return { sections };
}

/**
 * A sheet with every chord symbol transposed (lyrics untouched). Returns the input
 * sheet unchanged for a 0-semitone transpose so `$derived` consumers keep identity.
 */
export function transposeSheet(sheet: SongSheet, semitones: number, preferFlats: boolean): SongSheet {
  if (semitones % 12 === 0) return sheet;
  return {
    sections: sheet.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({
        ...l,
        chords: l.chords.map((c) => ({ ...c, sym: transposeChordLabel(c.sym, semitones, preferFlats) })),
      })),
    })),
  };
}

/**
 * Split a line into chord-anchored chunks for chord-over-word rendering.
 *
 * Chunks are word-granular: a chord anchors to its first word and the rest of the run
 * becomes chord-less word chunks, so a long lyric under one chord wraps at any word
 * boundary instead of overflowing a narrow screen. Trailing whitespace rides with its
 * word (the renderer preserves it via `white-space: pre`).
 */
export function lineChunks(line: LyricLine): LyricChunk[] {
  const out: LyricChunk[] = [];
  const push = (sym: string, text: string) => {
    // Word + its trailing spaces per piece; pure-whitespace runs survive as their own
    // piece. An empty run still emits one chunk so an end-of-line chord keeps a slot.
    const pieces = text.match(/\S+\s*|\s+/g) ?? [text];
    pieces.forEach((p, i) => out.push({ sym: i === 0 ? sym : '', text: p }));
  };
  const cs = line.chords;
  const first = cs[0]?.index ?? line.text.length;
  if (cs.length === 0 || first > 0) push('', line.text.slice(0, first));
  for (let i = 0; i < cs.length; i++) {
    const end = cs[i + 1]?.index ?? line.text.length;
    push(cs[i].sym, line.text.slice(cs[i].index, end));
  }
  return out;
}
