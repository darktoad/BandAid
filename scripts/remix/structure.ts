// scripts/remix/structure.ts
/**
 * Read the form-level structure out of a canonical MusicXML file: sections
 * (spans between <rehearsal> marks), repeat barlines, volta endings, and which
 * lyric lines exist. This is the "what can a recipe reference" surface; the
 * compiler validates recipes against it and expands passes from it.
 *
 * Conventions this enforces (hard errors, never guesses):
 * - Single-part scores only (canonical band charts are one part today).
 * - Section labels are <rehearsal> marks; measures before the first mark belong
 *   to an implicit section only when there are NO marks at all (label "all").
 * - A repeat/volta group must sit entirely inside one section — label sections
 *   at repeat-group boundaries.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface EndingSpan {
  numbers: number[];
  start: number; // 1-based measure index, inclusive
  stop: number;
}

export interface Section {
  label: string;
  start: number;
  end: number;
  backwardRepeat: boolean;
  endings: EndingSpan[];
}

export interface SongStructure {
  measureCount: number;
  sections: Section[];
  lyricNumbers: number[];
}

export function loadDoc(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}

export function serializeDoc(doc: Document): string {
  return new XMLSerializer().serializeToString(doc as never);
}

const els = (parent: Element | Document, tag: string): Element[] =>
  Array.from(parent.getElementsByTagName(tag)) as Element[];

/** The <measure> elements of the single <part>, in document order. */
export function partMeasures(doc: Document): Element[] {
  const parts = els(doc, 'part').filter((p) => p.getElementsByTagName('measure').length > 0);
  if (parts.length !== 1) {
    throw new Error(
      `remix compiler does not support multi-part scores — single part only (found ${parts.length} parts)`,
    );
  }
  return Array.from(parts[0].childNodes).filter(
    (n): n is Element => n.nodeType === 1 && n.nodeName === 'measure',
  );
}

export function parseStructure(doc: Document): SongStructure {
  const measures = partMeasures(doc);

  // Section starts: measures carrying a <rehearsal> mark.
  const starts: Array<{ label: string; index: number }> = [];
  measures.forEach((m, i) => {
    const marks = els(m, 'rehearsal');
    if (marks.length > 0) starts.push({ label: marks[0].textContent?.trim() ?? '', index: i + 1 });
  });

  const bounds =
    starts.length === 0
      ? [{ label: 'all', index: 1 }]
      : starts[0].index === 1
        ? starts
        : [{ label: '', index: 1 }, ...starts]; // unlabeled preamble: unreferencable

  const sections: Section[] = bounds.map((b, i) => {
    const start = b.index;
    const end = (bounds[i + 1]?.index ?? measures.length + 1) - 1;

    let backwardRepeat = false;
    const open: Partial<Record<string, { numbers: number[]; start: number }>> = {};
    const endings: EndingSpan[] = [];
    for (let mi = start; mi <= end; mi++) {
      const m = measures[mi - 1];
      for (const r of els(m, 'repeat')) {
        if (r.getAttribute('direction') === 'backward') backwardRepeat = true;
      }
      for (const e of els(m, 'ending')) {
        const numbers = (e.getAttribute('number') ?? '')
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        const key = numbers.join(',');
        const type = e.getAttribute('type');
        if (type === 'start') open[key] = { numbers, start: mi };
        else if (type === 'stop' || type === 'discontinue') {
          const o = open[key];
          if (o) {
            endings.push({ numbers: o.numbers, start: o.start, stop: mi });
            delete open[key];
          }
        }
      }
    }
    return { label: b.label, start, end, backwardRepeat, endings };
  });

  // Repeat groups must not cross section boundaries: a forward repeat inside a
  // section requires its backward repeat in the same section.
  for (const sec of sections) {
    let openForward = 0;
    for (let mi = sec.start; mi <= sec.end; mi++) {
      for (const r of els(measures[mi - 1], 'repeat')) {
        if (r.getAttribute('direction') === 'forward') openForward++;
        if (r.getAttribute('direction') === 'backward' && openForward > 0) openForward--;
      }
    }
    if (openForward > 0) {
      throw new Error(
        `repeat group starting in section "${sec.label}" crosses its boundary — add the rehearsal mark at the repeat-group boundary`,
      );
    }
  }

  const lyricNumbers = [
    ...new Set(els(doc, 'lyric').map((l) => parseInt(l.getAttribute('number') ?? '1', 10))),
  ].sort((a, b) => a - b);

  return { measureCount: measures.length, sections, lyricNumbers };
}
