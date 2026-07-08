// scripts/remix/compile.ts
/**
 * canonical MusicXML + recipe → variant MusicXML ("the machine"). Deterministic:
 * same inputs, byte-identical output. See the plan/spec for the normative
 * expansion semantics; every rule here traces to one of those bullets.
 */
import { loadDoc, serializeDoc, parseStructure, partMeasures, type Section } from './structure';
import { validateRecipe, type RemixPass } from './recipe';

const els = (parent: Element, tag: string): Element[] =>
  Array.from(parent.getElementsByTagName(tag)) as Element[];

/** Measure indexes (1-based) for one iteration of a section. */
function iterationMeasures(sec: Section, iteration: number, collapse: boolean): number[] {
  const highest = sec.endings.reduce((a, e) => Math.max(a, ...e.numbers), 0);
  const wanted = collapse ? highest : iteration;
  const out: number[] = [];
  for (let mi = sec.start; mi <= sec.end; mi++) {
    const span = sec.endings.find((e) => mi >= e.start && mi <= e.stop);
    if (!span) out.push(mi);
    else if (span.numbers.includes(wanted) || (!sec.endings.some((e) => e.numbers.includes(wanted)) && span.numbers.includes(highest))) {
      out.push(mi);
    }
  }
  return out;
}

function sectionIterations(sec: Section, repeats: RemixPass['repeats']): number {
  if (repeats === 'off') return 1;
  const counts = repeats !== undefined && repeats !== 'as-written' ? repeats : undefined;
  const n = counts?.[sec.label];
  if (n !== undefined) return n;
  const maxEnding = sec.endings.reduce((a, e) => Math.max(a, ...e.numbers), 0);
  if (maxEnding > 0) return maxEnding;
  return sec.backwardRepeat ? 2 : 1;
}

function filterLyrics(measure: Element, sec: Section, lyrics: RemixPass['lyrics']): void {
  const isChorus = sec.label.toLowerCase() === 'chorus';
  for (const l of els(measure, 'lyric')) {
    const num = parseInt(l.getAttribute('number') ?? '1', 10);
    let keep = false;
    if (lyrics !== undefined && lyrics !== 'off') {
      if (isChorus) keep = lyrics.chorus === true && num === 1;
      else if (lyrics.verse !== undefined) keep = num === lyrics.verse;
    }
    if (keep) l.setAttribute('number', '1');
    else l.parentNode?.removeChild(l);
  }
}

function stripRepeatMarks(measure: Element): void {
  for (const tag of ['repeat', 'ending']) {
    for (const e of els(measure, tag)) e.parentNode?.removeChild(e);
  }
  for (const b of els(measure, 'barline')) {
    const hasChild = Array.from(b.childNodes).some((n) => n.nodeType === 1);
    if (!hasChild) b.parentNode?.removeChild(b);
  }
}

export function compileRemix(canonicalXml: string, rawRecipe: unknown): string {
  const doc = loadDoc(canonicalXml);
  const structure = parseStructure(doc);
  const recipe = validateRecipe(rawRecipe, structure);
  const measures = partMeasures(doc);
  const part = measures[0].parentNode as Element;
  const byLabel = new Map(structure.sections.map((s) => [s.label, s]));

  // Plan every emitted measure first: [sourceIndex, section, passIndex, isPassStart].
  const emitted: Array<{ src: number; sec: Section; pass: number; passStart: boolean; label?: string }> = [];
  recipe.passes.forEach((pass, pi) => {
    const order = (pass.sections ?? structure.sections.map((s) => s.label)).map((l) => byLabel.get(l)!);
    const seq: Array<{ src: number; sec: Section }> = [];
    for (const sec of order) {
      const k = sectionIterations(sec, pass.repeats);
      const collapse = pass.repeats === 'off';
      for (let i = 1; i <= k; i++) {
        for (const src of iterationMeasures(sec, i, collapse)) seq.push({ src, sec });
      }
    }
    if (pass.endWith !== undefined) {
      const sec = byLabel.get(pass.endWith)!;
      for (const src of iterationMeasures(sec, 1, true)) seq.push({ src, sec });
    }
    seq.forEach((s, i) => emitted.push({ ...s, pass: pi, passStart: i === 0, label: pass.label }));
  });
  if (emitted.length === 0) throw new Error(`[${recipe.songId}.${recipe.variantId}] recipe emits no measures`);

  // Build the flattened part.
  const initialAttributes = els(measures[0], 'attributes')[0] ?? null;
  const clones = emitted.map((e, i) => {
    const m = measures[e.src - 1].cloneNode(true) as Element;
    stripRepeatMarks(m);
    filterLyrics(m, e.sec, recipe.passes[e.pass].lyrics);
    if (i === 0 && e.src !== 1 && initialAttributes && els(m, 'attributes').length === 0) {
      m.insertBefore(initialAttributes.cloneNode(true), m.firstChild);
    }
    if (e.passStart) {
      if (e.label !== undefined) {
        const d = doc.createElement('direction');
        d.setAttribute('placement', 'above');
        const dt = doc.createElement('direction-type');
        const w = doc.createElement('words');
        w.setAttribute('font-weight', 'bold');
        w.appendChild(doc.createTextNode(e.label));
        dt.appendChild(w);
        d.appendChild(dt);
        m.insertBefore(d, m.firstChild);
      }
      if (e.pass > 0) {
        const p = doc.createElement('print');
        p.setAttribute('new-page', 'yes');
        m.insertBefore(p, m.firstChild);
      }
    }
    m.setAttribute('number', String(i + 1));
    return m;
  });

  // Final barline on the last measure.
  const last = clones[clones.length - 1];
  const bar = doc.createElement('barline');
  bar.setAttribute('location', 'right');
  const style = doc.createElement('bar-style');
  style.appendChild(doc.createTextNode('light-heavy'));
  bar.appendChild(style);
  last.appendChild(bar);

  // Swap the measures under the part.
  for (const m of measures) part.removeChild(m);
  for (const c of clones) part.appendChild(c);

  const body = serializeDoc(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- GENERATED by scripts/remix from remixes/${recipe.songId}.${recipe.variantId}.remix.json - do not hand-edit -->\n` +
    body +
    '\n'
  );
}
