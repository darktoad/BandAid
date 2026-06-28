<script lang="ts">
  import Renderer from '../renderer/Renderer.svelte';
  import type { RendererController, TrackInfo } from '../renderer/createRenderer';
  import { createLocalTransport, type LocalTransport } from '../transport/localTransport';
  import type { SessionStore } from '../session/types';

  /**
   * Chord-Changes-in-Time view (M1). A presentation template over the unified music
   * model + session transport: alphaTab renders chord symbols above a selectable staff,
   * its cursor is the playhead, and the local-transport controller drives + stamps it.
   * Local choices (part, tempo %, count-in) live here; only Transport is written to the
   * session store. This thin slice ships play/pause + tempo + tap-a-bar seek; the
   * scrubber and audio toggles are fast-follows.
   */
  let { song, store }: {
    song: { id: string; url: string; title: string };
    store: SessionStore;
  } = $props();

  let controller = $state<RendererController | undefined>(undefined);
  let transport = $state<LocalTransport | undefined>(undefined);
  let tracks = $state<TrackInfo[]>([]);
  let backingPart = $state(1); // default: guitar tab (track index 1, decision D3)
  let bar = $state(1);
  let playing = $state(false);
  let canPlay = $state(false); // true once the soundfont/player is loaded
  let speedPct = $state(100);
  let scalePct = $state(100); // notation zoom (local presentation, not transport)
  let tempoBpm = $state(120); // replaced by the score's real tempo once it loads
  let errorMsg = $state<string | null>(null);

  function onReady(c: RendererController, t: TrackInfo[]) {
    controller = c;
    tracks = t;
    if (t.length && !t.some((x) => x.index === backingPart)) backingPart = t[0].index;
    c.soloPart(backingPart);

    // Stand up the sole writer of Transport from the score's own timing (M1: no
    // separate Song metadata layer yet — that arrives with library-browsing).
    const info = c.getSongInfo();
    tempoBpm = info?.tempoBpm ?? 120;
    transport = createLocalTransport({
      songId: song.id,
      defaultTempoBpm: tempoBpm,
      measureCount: info?.measureCount ?? Number.MAX_SAFE_INTEGER,
      renderer: c,
      store,
    });
  }

  function selectPart(index: number) {
    backingPart = index;
    controller?.soloPart(index);
  }

  function togglePlay() {
    if (!transport) return;
    if (playing) transport.pause();
    else transport.play();
  }

  function onSpeed(e: Event) {
    speedPct = Number((e.target as HTMLInputElement).value);
    transport?.setTempoPercent(speedPct / 100);
  }

  function onScale(e: Event) {
    scalePct = Number((e.target as HTMLInputElement).value);
    controller?.setScale(scalePct / 100);
  }

  // Spacebar toggles play/pause on laptop (FR-11). Ignore when typing in a control.
  function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space') return;
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (canPlay) togglePlay();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<header class="topbar">
  <span class="brand">BandAid</span>
  <span class="tag">{song.title} · chord changes</span>
</header>

<div class="controls">
  <button onclick={togglePlay} disabled={!transport || !canPlay}>
    {!canPlay ? '⏳ Loading…' : playing ? '⏸ Pause' : '▶ Play'}
  </button>

  <label class="speed">
    Tempo
    <input type="range" min="50" max="110" step="5" value={speedPct} oninput={onSpeed} disabled={!transport} />
    <span class="readout">{speedPct}% · {Math.round((tempoBpm * speedPct) / 100)} bpm</span>
  </label>

  <label class="speed">
    Size
    <input type="range" min="75" max="225" step="25" value={scalePct} oninput={onScale} disabled={!controller} />
    <span class="readout">{scalePct}%</span>
  </label>

  <div class="parts">
    {#each tracks as t}
      <button class:active={t.index === backingPart} onclick={() => selectPart(t.index)}>{t.name}</button>
    {/each}
  </div>

  <span class="readout">bar {bar}</span>
</div>

{#if errorMsg}
  <div class="error">Renderer error: {errorMsg}</div>
{/if}

<main class="stage">
  <Renderer
    musicXmlUrl={song.url}
    onready={onReady}
    onposition={(b) => (bar = b)}
    onplaying={(p) => (playing = p)}
    onplayable={() => (canPlay = true)}
    onerror={(e) => (errorMsg = e.message)}
  />
</main>

<style>
  .topbar {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { font-weight: 700; letter-spacing: 0.02em; }
  .tag { color: var(--muted); font-size: 0.85rem; }

  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .speed { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--muted); }
  .parts { display: inline-flex; gap: 0.4rem; }
  .parts button { padding: 0.35rem 0.6rem; font-size: 0.85rem; }
  .parts button.active { border-color: var(--accent); color: var(--accent); }
  .readout { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; }

  .error {
    padding: 0.5rem 1rem;
    background: #3a1d1d;
    color: #f1b4b4;
    font-size: 0.85rem;
  }

  .stage { flex: 1; min-height: 0; }
</style>
