<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { ChordOnset } from './chordTimeline';
  import { chordsForBar } from './chordTimeline';
  import { shapeFor, type Instrument } from './chordShapes';
  import ChordDiagram from './ChordDiagram.svelte';

  /**
   * The chord overlay strip. It mirrors the sheet music: a row of `barsPerRow` bars
   * (the same count the notation wraps at), aligned to row boundaries. The current-bar
   * highlight sweeps across a *stable* set; the set only changes when the current bar
   * crosses into the next row, and that page-turn slides in. Each bar is subdivided into
   * beat segments with a progress track that fills in time with playback.
   */
  let {
    timeline,
    currentBar,
    barProgress,
    beatsPerBar,
    barsPerRow,
    measureCount,
    instrument,
    showCharts,
  }: {
    timeline: ChordOnset[];
    currentBar: number;
    barProgress: number; // 0..1 within the current bar
    beatsPerBar: number;
    barsPerRow: number; // matches the notation's bars-per-row for 1:1 alignment
    measureCount: number;
    instrument: Instrument;
    showCharts: boolean;
  } = $props();

  // Svelte's fly is JS-driven (inline styles), so the CSS reduced-motion kill-switch
  // can't reach it — honor the preference here by zeroing the page-turn duration.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let n = $derived(Math.max(1, barsPerRow));
  // The row of bars containing the current bar, aligned to row boundaries.
  let pageStart = $derived(Math.floor((currentBar - 1) / n) * n + 1);
  let bars = $derived(
    Array.from({ length: n }, (_, i) => pageStart + i).filter((b) => b >= 1 && b <= measureCount),
  );
  let beats = $derived(Array.from({ length: Math.max(1, beatsPerBar) }, (_, i) => i));

  // Fill fraction (0..1) of beat segment `i` in `bar`: past bars full, future empty, the
  // current bar fills segment-by-segment from the live within-bar progress.
  function segFill(bar: number, i: number): number {
    if (bar !== currentBar) return bar < currentBar ? 1 : 0;
    return Math.min(1, Math.max(0, barProgress * beatsPerBar - i));
  }
  // Centre a chord over the segment of the beat it starts on.
  function leftPct(beat: number): number {
    return ((beat - 1 + 0.5) / beatsPerBar) * 100;
  }
</script>

<div class="strip" class:nocharts={!showCharts} style={`--n:${n}`}>
  {#key pageStart}
    <div class="page" in:fly={{ x: 40, duration: reducedMotion ? 0 : 220 }}>
      {#each bars as bar (bar)}
        <div class="bar" class:current={bar === currentBar}>
          <div class="chords">
            {#each chordsForBar(timeline, bar) as c (`${c.beat}-${c.label}`)}
              {@const shape = showCharts ? shapeFor(c.label, instrument) : null}
              <div class="chord" style={`left:${leftPct(c.beat)}%`}>
                <span class="name">{c.label}</span>
                {#if shape}<ChordDiagram {shape} />{/if}
              </div>
            {/each}
          </div>
          <div class="beats">
            {#each beats as i}
              <div class="seg" class:downbeat={i === 0}>
                <div class="fill" style={`width:${segFill(bar, i) * 100}%`}></div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/key}
</div>

<style>
  .strip {
    position: relative;
    overflow: hidden; /* clip the page-turn slide */
    flex: 0 0 auto;
    padding: 0.6rem 0.7rem 0.7rem;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .page {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  /* Every bar occupies a fixed 1/N of the row, so width never depends on how many
     bars remain — the last row just leaves empty slots on the right. */
  .bar {
    flex: 0 0 calc((100% - (var(--n) - 1) * 0.5rem) / var(--n));
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.45rem 0.4rem 0.4rem;
    border: 1px solid transparent;
    border-radius: 10px;
    color: var(--muted); /* tints the chord name + diagram (currentColor) */
  }
  .bar.current {
    border-color: var(--accent);
    background: rgba(217, 138, 61, 0.08);
    color: var(--accent);
  }

  /* Chords are absolutely placed over their starting beat; this row reserves their height. */
  .chords {
    position: relative;
    height: 60px;
  }
  .chord {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .name {
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1;
  }
  /* With the diagrams hidden, spend their space on the name instead — a big chord
     letter reads at music-stand distance, which is the point of names-only mode. */
  .strip.nocharts .chords {
    height: 34px;
  }
  .strip.nocharts .chord {
    top: auto;
    bottom: 2px; /* sit the larger name just above the beat track */
  }
  .strip.nocharts .name {
    font-size: 1.55rem;
    font-weight: 700;
  }
  .bar.current .name {
    color: var(--ink);
  }

  .beats {
    display: flex;
    gap: 3px;
    height: 12px;
  }
  .seg {
    position: relative;
    flex: 1 1 0;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  /* The downbeat carries a brighter top edge so the "1" of each bar is distinct. */
  .seg.downbeat {
    border-top: 2px solid var(--muted);
  }
  .bar.current .seg.downbeat {
    border-top-color: var(--accent);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--muted);
  }
  .bar.current .fill {
    background: var(--accent);
  }
</style>
