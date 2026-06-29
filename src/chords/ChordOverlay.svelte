<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChordOnset } from './chordTimeline';
  import { chordsForBar } from './chordTimeline';
  import { shapeFor, type Instrument } from './chordShapes';
  import ChordDiagram from './ChordDiagram.svelte';

  /**
   * The chord overlay strip: a fit-to-width row of bars starting at the current bar, each
   * subdivided into beat segments. A segmented progress track fills the current bar in time
   * with playback (downbeat accented); chord name + (optional) diagram sit over the beat each
   * chord begins on. Highlight + fill direction convey current vs. upcoming — no labels.
   */
  let {
    timeline,
    currentBar,
    barProgress,
    beatsPerBar,
    measureCount,
    instrument,
    showCharts,
  }: {
    timeline: ChordOnset[];
    currentBar: number;
    barProgress: number; // 0..1 within the current bar
    beatsPerBar: number;
    measureCount: number;
    instrument: Instrument;
    showCharts: boolean;
  } = $props();

  const MIN_BAR_PX = 132; // ~2 bars on a phone, more on wider screens
  let stripEl: HTMLElement;
  let visibleCount = $state(2);

  onMount(() => {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? stripEl.clientWidth;
      visibleCount = Math.max(1, Math.floor(w / MIN_BAR_PX));
    });
    if (stripEl) ro.observe(stripEl);
    return () => ro.disconnect();
  });

  let bars = $derived(
    Array.from({ length: visibleCount }, (_, i) => currentBar + i).filter(
      (b) => b >= 1 && b <= measureCount,
    ),
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

<div class="strip" bind:this={stripEl}>
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

<style>
  .strip {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
    padding: 0.6rem 0.7rem 0.7rem;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .bar {
    flex: 1 1 0;
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
